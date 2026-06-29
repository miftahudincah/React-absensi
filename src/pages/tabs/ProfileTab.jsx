// src/pages/tabs/ProfileTab.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ref, update, get, set, onValue, off } from 'firebase/database';
import { db, auth } from '../../firebase/config';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider, signOut } from 'firebase/auth';
import './ProfileTab.css';

// Konfigurasi API
const API_BASE_URL = 'https://backendtest-azure.vercel.app';

const ProfileTab = ({ user }) => {
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [profileData, setProfileData] = useState({
    nama: '',
    email: '',
    role: '',
    kelas: '',
    jurusan: '',
    noHp: '',
    alamat: '',
    foto: ''
  });
  const [isEditing, setIsEditing] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [oldPhotoUrl, setOldPhotoUrl] = useState('');
  const fileInputRef = useRef(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // State untuk ubah password
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  
  // Refs untuk mencegah infinite loop
  const isMounted = useRef(true);
  const loadTimeoutRef = useRef(null);
  const unsubscribeRefs = useRef([]);

  // Cek role
  const isSiswa = user?.role === 'siswa';
  const isFullAccess = ['developer', 'admin', 'wakil_kepala'].includes(user?.role);
  
  // Siswa hanya bisa ubah foto profil, tidak bisa edit data lainnya
  const canEditData = !isSiswa;
  const canEditPhoto = true;

  // ==================== TOKEN MANAGEMENT ====================
  const getAuthToken = useCallback(async () => {
    let token = localStorage.getItem('authToken');
    if (token) return token;
    
    if (auth.currentUser) {
      try {
        token = await auth.currentUser.getIdToken();
        localStorage.setItem('authToken', token);
        return token;
      } catch (error) {
        console.error('❌ Failed to get Firebase token:', error);
        return null;
      }
    }
    return null;
  }, []);

  // ==================== DELETE PHOTO FROM SUPABASE ====================
  const deletePhotoFromSupabase = useCallback(async (photoUrl) => {
    if (!photoUrl || !photoUrl.includes('supabase.co')) return true;
    
    try {
      const token = await getAuthToken();
      if (!token) return false;

      const response = await fetch(`${API_BASE_URL}/api/storage/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fileUrl: photoUrl }),
      });

      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('❌ Error deleting photo:', error);
      return false;
    }
  }, [getAuthToken]);

  // ==================== UPLOAD PHOTO TO SUPABASE ====================
  const uploadPhotoToSupabase = useCallback(async (file) => {
    setUploadingPhoto(true);
    
    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Tidak dapat memperoleh token autentikasi');
      }

      const formData = new FormData();
      formData.append('image', file);
      formData.append('userId', user.uid);
      formData.append('folder', 'profiles');

      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = `Upload gagal (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          const errorText = await response.text();
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      return result.data.url;
    } catch (error) {
      console.error('❌ Upload photo error:', error);
      throw error;
    } finally {
      if (isMounted.current) {
        setUploadingPhoto(false);
      }
    }
  }, [user?.uid, getAuthToken]);

  // ==================== LOAD PROFILE DATA ====================
  const loadProfileData = useCallback(async () => {
    if (!user?.uid) {
      if (isMounted.current) setInitialLoading(false);
      return;
    }

    // Clear previous timeout
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }

    setLoading(true);
    
    try {
      console.log('🔍 [ProfileTab] Loading profile for user:', user?.uid);

      // ===== STEP 1: Ambil data dari users_auth =====
      const userAuthRef = ref(db, `users_auth/${user.uid}`);
      const snapshot = await get(userAuthRef);
      const authData = snapshot.val() || {};
      console.log('📋 [ProfileTab] Data from users_auth:', authData);

      // ===== STEP 2: Inisialisasi data dasar =====
      let profile = {
        nama: authData.nama || user.nama || '',
        email: authData.email || user.email || '',
        role: authData.role || user.role || '',
        kelas: authData.kelas || user.kelas || '',
        jurusan: authData.jurusan || user.jurusan || '',
        noHp: authData.noHp || user.noHp || '',
        alamat: authData.alamat || user.alamat || '',
        foto: authData.photoUrl || user.photoUrl || ''
      };

      // ===== STEP 3: Untuk SISWA, ambil dari node users =====
      if (user.role === 'siswa') {
        let fpId = user.fpId || authData.fpId || user.id || user.userId;
        
        if (!fpId) {
          const allUsersAuth = await get(ref(db, 'users_auth'));
          const allAuthData = allUsersAuth.val() || {};
          for (const [uid, data] of Object.entries(allAuthData)) {
            if (uid === user.uid) {
              fpId = data.fpId || data.userId;
              break;
            }
          }
        }

        if (fpId) {
          try {
            const userRef = ref(db, `users/${fpId}`);
            const userSnapshot = await get(userRef);
            const userData = userSnapshot.val() || {};
            
            if (userData.nama) profile.nama = userData.nama;
            if (userData.kelas) profile.kelas = userData.kelas;
            if (userData.jurusan) profile.jurusan = userData.jurusan;
            if (userData.noHp) profile.noHp = userData.noHp;
            if (userData.alamat) profile.alamat = userData.alamat;
            if (userData.parentPhone) profile.noHp = userData.parentPhone;
          } catch (error) {
            console.warn('⚠️ [ProfileTab] Error loading users data:', error);
          }
        }
      }

      // ===== STEP 4: Untuk STAFF, ambil dari node staff =====
      if (user.role !== 'siswa' && user.role !== 'developer') {
        let staffId = user.staffId || authData.staffId || user.userId;

        if (!staffId) {
          const allUsersAuth = await get(ref(db, 'users_auth'));
          const allAuthData = allUsersAuth.val() || {};
          for (const [uid, data] of Object.entries(allAuthData)) {
            if (uid === user.uid) {
              staffId = data.staffId || data.userId;
              break;
            }
          }
        }

        if (staffId) {
          try {
            const staffRef = ref(db, `staff/${staffId}`);
            const staffSnapshot = await get(staffRef);
            const staffData = staffSnapshot.val() || {};

            if (staffData.nama) profile.nama = staffData.nama;
            if (staffData.noHp) profile.noHp = staffData.noHp;
            if (staffData.alamat) profile.alamat = staffData.alamat;
          } catch (error) {
            console.warn('⚠️ [ProfileTab] Error loading staff data:', error);
          }
        }
      }

      // ===== STEP 5: Set data ke state =====
      if (isMounted.current) {
        setProfileData(profile);
        setOldPhotoUrl(profile.foto || '');
        
        if (profile.foto) {
          setPhotoPreview(profile.foto);
        }

        console.log('✅ [ProfileTab] Final profile data loaded');
        setInitialLoading(false);
      }

    } catch (error) {
      console.error('❌ [ProfileTab] Error loading profile:', error);
      if (isMounted.current) {
        setMessage({ text: '❌ Gagal memuat data profil', type: 'error' });
        setInitialLoading(false);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [user]);

  // ==================== SETUP REAL-TIME LISTENER ====================
  useEffect(() => {
    if (!user?.uid) return;

    isMounted.current = true;

    // Cleanup previous listeners
    unsubscribeRefs.current.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    unsubscribeRefs.current = [];

    // Load data initially
    loadProfileData();

    // Setup real-time listener for profile changes
    const userAuthRef = ref(db, `users_auth/${user.uid}`);
    const unsubscribe = onValue(userAuthRef, (snapshot) => {
      if (!isMounted.current) return;
      
      const data = snapshot.val();
      if (data) {
        // Update profile data without full reload
        setProfileData(prev => ({
          ...prev,
          nama: data.nama || prev.nama,
          email: data.email || prev.email,
          role: data.role || prev.role,
          foto: data.photoUrl || prev.foto,
          noHp: data.noHp || prev.noHp,
          alamat: data.alamat || prev.alamat
        }));
        
        if (data.photoUrl && data.photoUrl !== oldPhotoUrl) {
          setOldPhotoUrl(data.photoUrl);
          setPhotoPreview(data.photoUrl);
        }
      }
    });

    unsubscribeRefs.current.push(unsubscribe);

    // Cleanup
    return () => {
      isMounted.current = false;
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
      unsubscribeRefs.current.forEach(unsub => {
        try { unsub(); } catch (e) {}
      });
      unsubscribeRefs.current = [];
    };
  }, [user?.uid, loadProfileData, oldPhotoUrl]);

  // ==================== HANDLE PHOTO UPLOAD ====================
  const handlePhotoChange = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setMessage({ text: '❌ Ukuran foto maksimal 2MB', type: 'error' });
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setMessage({ text: '❌ Format foto harus JPG, PNG, GIF, atau WEBP', type: 'error' });
      return;
    }

    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (isMounted.current) {
        setPhotoPreview(e.target.result);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // ==================== FORMAT NOMOR WHATSAPP ====================
  const formatPhoneDisplay = useCallback((phone) => {
    if (!phone) return '-';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length <= 4) return cleaned;
    if (cleaned.length <= 8) return cleaned.substring(0, 4) + '-' + cleaned.substring(4);
    if (cleaned.length <= 12) return cleaned.substring(0, 4) + '-' + cleaned.substring(4, 8) + '-' + cleaned.substring(8);
    return cleaned.substring(0, 4) + '-' + cleaned.substring(4, 8) + '-' + cleaned.substring(8, 12) + '-' + cleaned.substring(12);
  }, []);

  // ==================== CHANGE PASSWORD HANDLERS ====================
  const handlePasswordChange = useCallback((e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (passwordError) setPasswordError('');
    if (passwordSuccess) setPasswordSuccess(false);
  }, [passwordError, passwordSuccess]);

  const handleShowPassword = useCallback(() => {
    setShowPassword(prev => !prev);
  }, []);

  const resetPasswordForm = useCallback(() => {
    setPasswordData({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
    setShowChangePassword(false);
    setChangingPassword(false);
    setPasswordError('');
    setPasswordSuccess(false);
    setMessage({ text: '', type: '' });
  }, []);

  const validatePasswordForm = useCallback(() => {
    // Validasi current password
    if (!passwordData.currentPassword || passwordData.currentPassword.length < 6) {
      setPasswordError('Password saat ini minimal 6 karakter');
      return false;
    }

    // Validasi new password
    if (!passwordData.newPassword || passwordData.newPassword.length < 6) {
      setPasswordError('Password baru minimal 6 karakter');
      return false;
    }

    // Validasi confirm password
    if (!passwordData.confirmPassword) {
      setPasswordError('Harap konfirmasi password baru');
      return false;
    }

    // Validasi password match
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('Konfirmasi password tidak cocok');
      return false;
    }

    // Validasi password berbeda
    if (passwordData.newPassword === passwordData.currentPassword) {
      setPasswordError('Password baru harus berbeda dengan password saat ini');
      return false;
    }

    return true;
  }, [passwordData]);

  const handleChangePassword = useCallback(async () => {
    // Reset error dan success
    setPasswordError('');
    setPasswordSuccess(false);

    // Validasi form
    if (!validatePasswordForm()) {
      return;
    }

    setChangingPassword(true);
    setMessage({ text: '⏳ Memproses perubahan password...', type: 'info' });

    try {
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        throw new Error('User tidak ditemukan. Silakan login kembali.');
      }

      // Pastikan email tersedia untuk reautentikasi
      const userEmail = currentUser.email;
      if (!userEmail) {
        throw new Error('Email user tidak ditemukan. Silakan login kembali.');
      }

      console.log('🔑 Attempting to change password for:', userEmail);

      // Step 1: Re-autentikasi user dengan password saat ini
      const credential = EmailAuthProvider.credential(
        userEmail,
        passwordData.currentPassword
      );

      await reauthenticateWithCredential(currentUser, credential);
      console.log('✅ Reauthentication successful');

      // Step 2: Update password
      await updatePassword(currentUser, passwordData.newPassword);
      console.log('✅ Password updated successfully');

      // Step 3: Update database record
      await update(ref(db, `users_auth/${user.uid}`), {
        passwordChangedAt: new Date().toISOString(),
        lastPasswordChange: new Date().toISOString()
      });
      console.log('✅ Database updated');

      // Step 4: Set success state
      setPasswordSuccess(true);
      setMessage({ 
        text: '✅ Password berhasil diubah!', 
        type: 'success' 
      });

      // Step 5: Reset form setelah sukses
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });

      // Step 6: Log aktivitas
      if (typeof window.logActivity === 'function') {
        window.logActivity('change_password', `User ${user?.nama || user?.email} mengubah password`);
      }

      // Step 7: Tawarkan logout untuk keamanan
      setTimeout(() => {
        if (window.confirm(
          '✅ Password berhasil diubah!\n\n' +
          'Untuk keamanan, Anda akan logout dari semua perangkat.\n' +
          'Silakan login kembali dengan password baru.\n\n' +
          'Apakah Anda ingin logout sekarang?'
        )) {
          signOut(auth)
            .then(() => {
              localStorage.removeItem('currentUser');
              localStorage.removeItem('authToken');
              window.location.href = '/login';
            })
            .catch((err) => {
              console.error('❌ Logout error:', err);
              window.location.reload();
            });
        } else {
          // Tutup modal jika user memilih tidak logout
          setShowChangePassword(false);
        }
      }, 1500);

    } catch (error) {
      console.error('❌ Error changing password:', error);
      
      let errorMessage = '❌ Gagal mengubah password';
      
      switch (error.code) {
        case 'auth/wrong-password':
          errorMessage = '❌ Password saat ini salah. Silakan coba lagi.';
          break;
        case 'auth/too-many-requests':
          errorMessage = '❌ Terlalu banyak percobaan. Coba lagi nanti.';
          break;
        case 'auth/user-not-found':
          errorMessage = '❌ User tidak ditemukan. Silakan login ulang.';
          break;
        case 'auth/requires-recent-login':
          errorMessage = '❌ Sesi login sudah lama. Silakan login ulang untuk mengubah password.';
          break;
        case 'auth/network-request-failed':
          errorMessage = '❌ Koneksi internet bermasalah. Periksa koneksi Anda.';
          break;
        default:
          errorMessage = `❌ Gagal mengubah password: ${error.message}`;
      }
      
      setPasswordError(errorMessage);
      setMessage({ text: errorMessage, type: 'error' });
    } finally {
      setChangingPassword(false);
    }
  }, [passwordData, user, validatePasswordForm]);

  // ==================== SAVE PROFILE ====================
  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage({ text: '', type: '' });
    setSaveSuccess(false);

    try {
      console.log('💾 [ProfileTab] Starting save...');

      // ⭐ UNTUK SISWA: HANYA UPDATE FOTO PROFIL
      if (isSiswa) {
        let newPhotoUrl = profileData.foto;

        // Upload photo if changed
        if (photoFile) {
          try {
            newPhotoUrl = await uploadPhotoToSupabase(photoFile);
            
            if (oldPhotoUrl && oldPhotoUrl !== newPhotoUrl) {
              await deletePhotoFromSupabase(oldPhotoUrl);
            }
          } catch (uploadError) {
            setMessage({ text: `❌ Gagal upload foto: ${uploadError.message}`, type: 'error' });
            setSaving(false);
            return;
          }
        }

        // Hanya update photoUrl untuk siswa
        await update(ref(db, `users_auth/${user.uid}`), {
          photoUrl: newPhotoUrl || '',
          updatedAt: new Date().toISOString()
        });
        console.log('✅ Updated photo for student');

        // Update localStorage
        const savedUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        savedUser.photoUrl = newPhotoUrl || '';
        localStorage.setItem('currentUser', JSON.stringify(savedUser));

        // Update state
        setProfileData(prev => ({ ...prev, foto: newPhotoUrl || '' }));
        setOldPhotoUrl(newPhotoUrl || '');
        setPhotoFile(null);
        
        setMessage({ text: '✅ Foto profil berhasil diperbarui!', type: 'success' });
        setSaveSuccess(true);
        setIsEditing(false);
        
        setSaving(false);
        return;
      }

      // ===== UNTUK NON-SISWA: UPDATE SEMUA DATA =====
      if (!profileData.nama.trim()) {
        setMessage({ text: '❌ Nama tidak boleh kosong', type: 'error' });
        setSaving(false);
        return;
      }

      let newPhotoUrl = profileData.foto;

      // Upload photo if changed
      if (photoFile) {
        try {
          newPhotoUrl = await uploadPhotoToSupabase(photoFile);
          
          if (oldPhotoUrl && oldPhotoUrl !== newPhotoUrl) {
            await deletePhotoFromSupabase(oldPhotoUrl);
          }
        } catch (uploadError) {
          setMessage({ text: `❌ Gagal upload foto: ${uploadError.message}`, type: 'error' });
          setSaving(false);
          return;
        }
      }

      // Prepare update data
      const updateData = {
        nama: profileData.nama.trim(),
        email: profileData.email,
        noHp: profileData.noHp || '',
        alamat: profileData.alamat || '',
        photoUrl: newPhotoUrl || '',
        updatedAt: new Date().toISOString()
      };

      console.log('📤 [ProfileTab] Updating users_auth with:', updateData);

      // Update users_auth
      await update(ref(db, `users_auth/${user.uid}`), updateData);
      console.log('✅ Updated users_auth');

      // Update staff untuk staff
      if (user.role !== 'siswa' && user.role !== 'developer') {
        let staffId = user.staffId || user.id || user.userId;
        
        if (!staffId) {
          const authSnapshot = await get(ref(db, `users_auth/${user.uid}`));
          const authData = authSnapshot.val() || {};
          staffId = authData.staffId || authData.userId;
        }
        
        if (staffId) {
          const staffUpdateData = {
            nama: profileData.nama.trim(),
            email: profileData.email,
            noHp: profileData.noHp || '',
            alamat: profileData.alamat || '',
            updatedAt: Date.now()
          };
          
          await update(ref(db, `staff/${staffId}`), staffUpdateData);
          console.log('✅ Updated staff node');
        } else {
          console.warn('⚠️ No staffId found, skipping staff update');
        }
      }

      // Update localStorage
      const savedUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      savedUser.nama = profileData.nama.trim();
      savedUser.photoUrl = newPhotoUrl || '';
      savedUser.noHp = profileData.noHp || '';
      savedUser.alamat = profileData.alamat || '';
      localStorage.setItem('currentUser', JSON.stringify(savedUser));
      console.log('✅ Updated localStorage');

      // Update state
      setProfileData(prev => ({
        ...prev,
        foto: newPhotoUrl || '',
        nama: profileData.nama.trim(),
        noHp: profileData.noHp || '',
        alamat: profileData.alamat || ''
      }));
      setOldPhotoUrl(newPhotoUrl || '');
      setPhotoFile(null);
      
      setMessage({ text: '✅ Profil berhasil diperbarui!', type: 'success' });
      setSaveSuccess(true);
      setIsEditing(false);
      
      console.log('✅ Profile save completed successfully');

    } catch (error) {
      console.error('❌ Error saving profile:', error);
      setMessage({ text: `❌ Gagal menyimpan: ${error.message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [profileData, photoFile, oldPhotoUrl, isSiswa, user, uploadPhotoToSupabase, deletePhotoFromSupabase]);

  // ==================== CANCEL EDIT ====================
  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setPhotoFile(null);
    setPhotoPreview(profileData.foto || '');
    setMessage({ text: '', type: '' });
  }, [profileData.foto]);

  // ==================== GET ROLE INFO ====================
  const getRoleDisplayName = useCallback((role) => {
    const names = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala Sekolah',
      staff_tu: 'Staff TU',
      guru: 'Guru',
      siswa: 'Siswa'
    };
    return names[role] || role;
  }, []);

  const getRoleIcon = useCallback((role) => {
    const icons = {
      developer: '👨‍💻',
      admin: '👑',
      wakil_kepala: '👔',
      staff_tu: '📋',
      guru: '👨‍🏫',
      siswa: '👨‍🎓'
    };
    return icons[role] || '👤';
  }, []);

  const getRoleColor = useCallback((role) => {
    const colors = {
      developer: '#9b59b6',
      admin: '#e74c3c',
      wakil_kepala: '#3498db',
      staff_tu: '#607d8b',
      guru: '#f39c12',
      siswa: '#e67e22'
    };
    return colors[role] || '#7f8c8d';
  }, []);

  // ==================== RENDER ====================
  if (initialLoading) {
    return (
      <div className="profile-container">
        <div className="profile-loading">
          <div className="loading-spinner"></div>
          <p>⏳ Memuat profil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-container">
      {/* Header */}
      <div className="profile-header">
        <div className="profile-header-left">
          <h1>👤 Profil Pengguna</h1>
          <p className="profile-subtitle">
            {isSiswa ? 'Kelola foto profil Anda' : 'Kelola informasi profil Anda'}
          </p>
        </div>
        <div className="profile-header-actions">
          {!isEditing ? (
            <>
              <button 
                className="btn-change-password" 
                onClick={() => setShowChangePassword(true)}
                disabled={changingPassword}
              >
                🔑 Ubah Password
              </button>
              <button className="btn-edit-profile" onClick={() => setIsEditing(true)}>
                {isSiswa ? '📷 Ganti Foto' : '✏️ Edit Profil'}
              </button>
            </>
          ) : (
            <div className="profile-action-buttons">
              <button className="btn-cancel-profile" onClick={handleCancel} disabled={saving || uploadingPhoto}>
                ❌ Batal
              </button>
              <button className="btn-save-profile" onClick={handleSave} disabled={saving || uploadingPhoto}>
                {saving ? '⏳ Menyimpan...' : uploadingPhoto ? '📤 Uploading...' : '💾 Simpan'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`profile-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Modal Ubah Password */}
      {showChangePassword && (
        <div className="password-modal-overlay" onClick={() => !changingPassword && resetPasswordForm()}>
          <div className="password-modal" onClick={(e) => e.stopPropagation()}>
            <div className="password-modal-header">
              <h2>🔑 Ubah Password</h2>
              <button 
                className="password-modal-close" 
                onClick={resetPasswordForm}
                disabled={changingPassword}
              >
                ✕
              </button>
            </div>
            
            <div className="password-modal-body">
              {/* Error Message */}
              {passwordError && (
                <div className="password-error-message" style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  background: 'rgba(244,67,54,0.12)',
                  border: '1px solid rgba(244,67,54,0.2)',
                  color: '#f44336',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span>❌</span>
                  <span>{passwordError}</span>
                </div>
              )}

              {/* Success Message */}
              {passwordSuccess && (
                <div className="password-success-message" style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  background: 'rgba(76,175,80,0.12)',
                  border: '1px solid rgba(76,175,80,0.2)',
                  color: '#4caf50',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span>✅</span>
                  <span>Password berhasil diubah! Anda akan diarahkan ke halaman login.</span>
                </div>
              )}

              <div className="password-field">
                <label>Password Saat Ini</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="currentPassword"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordChange}
                    placeholder="Masukkan password saat ini"
                    disabled={changingPassword || passwordSuccess}
                    className="password-input"
                    autoComplete="current-password"
                  />
                  <button 
                    type="button"
                    className="password-toggle"
                    onClick={handleShowPassword}
                    disabled={changingPassword || passwordSuccess}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="password-field">
                <label>Password Baru</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="newPassword"
                    value={passwordData.newPassword}
                    onChange={handlePasswordChange}
                    placeholder="Masukkan password baru (min. 6 karakter)"
                    disabled={changingPassword || passwordSuccess}
                    className="password-input"
                    autoComplete="new-password"
                  />
                </div>
                <span className="password-hint">Minimal 6 karakter</span>
              </div>

              <div className="password-field">
                <label>Konfirmasi Password Baru</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="confirmPassword"
                    value={passwordData.confirmPassword}
                    onChange={handlePasswordChange}
                    placeholder="Konfirmasi password baru"
                    disabled={changingPassword || passwordSuccess}
                    className="password-input"
                    autoComplete="new-password"
                  />
                </div>
                {passwordData.newPassword && passwordData.confirmPassword && !passwordSuccess && (
                  <span className={`password-match ${passwordData.newPassword === passwordData.confirmPassword ? 'match' : 'mismatch'}`}>
                    {passwordData.newPassword === passwordData.confirmPassword ? '✅ Password cocok' : '❌ Password tidak cocok'}
                  </span>
                )}
                {passwordData.newPassword && passwordData.newPassword.length >= 6 && (
                  <span className="password-strength" style={{
                    display: 'block',
                    fontSize: '12px',
                    marginTop: '4px',
                    color: passwordData.newPassword.length >= 8 ? '#4caf50' : '#ff9800'
                  }}>
                    {passwordData.newPassword.length >= 8 ? '✅ Password kuat' : '⚠️ Gunakan minimal 8 karakter untuk keamanan lebih baik'}
                  </span>
                )}
              </div>

              <div className="password-info">
                <p>📌 <strong>Tips Keamanan:</strong></p>
                <ul>
                  <li>Gunakan password yang kuat dan mudah diingat</li>
                  <li>Kombinasikan huruf besar, huruf kecil, angka, dan simbol</li>
                  <li>Jangan gunakan password yang sama dengan akun lain</li>
                  <li>Anda akan diminta login ulang setelah perubahan password</li>
                </ul>
              </div>
            </div>

            <div className="password-modal-footer">
              <button 
                className="btn-password-cancel" 
                onClick={resetPasswordForm}
                disabled={changingPassword || passwordSuccess}
              >
                Batal
              </button>
              <button 
                className="btn-password-save" 
                onClick={handleChangePassword}
                disabled={
                  changingPassword || 
                  passwordSuccess ||
                  !passwordData.currentPassword || 
                  !passwordData.newPassword || 
                  !passwordData.confirmPassword ||
                  passwordData.newPassword !== passwordData.confirmPassword ||
                  passwordData.newPassword.length < 6
                }
              >
                {changingPassword ? '⏳ Mengubah...' : '✅ Ubah Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Content */}
      <div className="profile-content">
        {/* Avatar Section */}
        <div className="profile-avatar-section">
          <div className="profile-avatar-container">
            <img
              src={photoPreview || profileData.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(profileData.nama || 'User')}&background=00bcd4&color=fff&size=200&bold=true`}
              alt="Profile"
              className={`profile-avatar ${uploadingPhoto ? 'uploading' : ''}`}
              onError={(e) => {
                e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profileData.nama?.charAt(0) || 'U')}&background=00bcd4&color=fff&size=200&bold=true`;
              }}
            />
            {uploadingPhoto && (
              <div className="profile-avatar-spinner">
                <div className="spinner"></div>
              </div>
            )}
            {isEditing && !uploadingPhoto && (
              <div className="profile-avatar-edit">
                <button
                  className="btn-change-photo"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                >
                  📷 Ganti Foto
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handlePhotoChange}
                  style={{ display: 'none' }}
                  disabled={uploadingPhoto}
                />
                <span className="photo-hint">Max 2MB (JPG/PNG/GIF/WEBP)</span>
              </div>
            )}
          </div>
          <div className="profile-role-badge" style={{ background: getRoleColor(profileData.role) }}>
            {getRoleIcon(profileData.role)} {getRoleDisplayName(profileData.role)}
          </div>
        </div>

        {/* Info Section */}
        <div className="profile-info-section">
          <div className="profile-info-grid">
            {/* Nama */}
            <div className="profile-field">
              <label>👤 Nama Lengkap</label>
              {isEditing && !isSiswa ? (
                <input
                  type="text"
                  name="nama"
                  value={profileData.nama}
                  onChange={(e) => setProfileData(prev => ({ ...prev, nama: e.target.value }))}
                  placeholder="Masukkan nama lengkap"
                  className="profile-input"
                  disabled={saving || uploadingPhoto}
                />
              ) : (
                <div className="profile-value">{profileData.nama || '-'}</div>
              )}
            </div>

            {/* Email */}
            <div className="profile-field">
              <label>📧 Email</label>
              {isEditing && !isSiswa ? (
                <input
                  type="email"
                  name="email"
                  value={profileData.email}
                  onChange={(e) => setProfileData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Masukkan email"
                  className="profile-input"
                  disabled
                />
              ) : (
                <div className="profile-value">{profileData.email || '-'}</div>
              )}
              {isEditing && !isSiswa && (
                <span className="field-hint">Email tidak dapat diubah</span>
              )}
            </div>

            {/* Role */}
            <div className="profile-field">
              <label>🎯 Peran</label>
              <div className="profile-value role-display">
                {getRoleIcon(profileData.role)} {getRoleDisplayName(profileData.role)}
              </div>
            </div>

            {/* ⭐ KELAS - HANYA UNTUK SISWA */}
            {isSiswa && (
              <div className="profile-field">
                <label>📚 Kelas</label>
                <div className="profile-value">{profileData.kelas || '-'}</div>
                <span className="field-hint">Hubungi admin untuk mengubah kelas</span>
              </div>
            )}

            {/* ⭐ JURUSAN - HANYA UNTUK SISWA */}
            {isSiswa && (
              <div className="profile-field">
                <label>🎓 Jurusan</label>
                <div className="profile-value">{profileData.jurusan || '-'}</div>
                <span className="field-hint">Hubungi admin untuk mengubah jurusan</span>
              </div>
            )}

            {/* No HP / WhatsApp */}
            <div className="profile-field">
              <label>📱 No. WhatsApp</label>
              {isEditing && !isSiswa ? (
                <input
                  type="text"
                  name="noHp"
                  value={profileData.noHp}
                  onChange={(e) => setProfileData(prev => ({ ...prev, noHp: e.target.value }))}
                  placeholder="Masukkan nomor WhatsApp"
                  className="profile-input"
                  disabled={saving || uploadingPhoto}
                />
              ) : (
                <div className="profile-value" style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  color: profileData.noHp ? '#25D366' : 'var(--text-muted)'
                }}>
                  {profileData.noHp && profileData.noHp !== '-' ? (
                    <>
                      <span style={{ fontSize: '18px' }}>📱</span>
                      <span style={{ fontWeight: 'bold' }}>{formatPhoneDisplay(profileData.noHp)}</span>
                      <span style={{ 
                        fontSize: '10px', 
                        background: '#25D366', 
                        color: 'white', 
                        padding: '2px 8px', 
                        borderRadius: '12px' 
                      }}>
                        WA
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Belum diisi</span>
                  )}
                </div>
              )}
            </div>

            {/* Alamat - Hanya untuk non-siswa */}
            {!isSiswa && (
              <div className="profile-field profile-field-full">
                <label>📍 Alamat</label>
                {isEditing && !isSiswa ? (
                  <textarea
                    name="alamat"
                    value={profileData.alamat}
                    onChange={(e) => setProfileData(prev => ({ ...prev, alamat: e.target.value }))}
                    placeholder="Masukkan alamat"
                    className="profile-textarea"
                    rows="3"
                    disabled={saving || uploadingPhoto}
                  />
                ) : (
                  <div className="profile-value">{profileData.alamat || '-'}</div>
                )}
              </div>
            )}

            {/* Terakhir update */}
            <div className="profile-field profile-field-full">
              <label>🕐 Terakhir Diperbarui</label>
              <div className="profile-value text-muted">
                {new Date().toLocaleString('id-ID', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="profile-footer">
        <p className="footer-info">
          🔒 Data profil disimpan dengan aman di Firebase &amp; Supabase
          <span className="footer-divider">•</span>
          {profileData.role === 'siswa' ? '👨‍🎓 Data siswa' : '👔 Data staff'}
          <span className="footer-divider">•</span>
          🆔 UID: {user?.uid?.slice(0, 8)}...
        </p>
        {profileData.noHp && profileData.noHp !== '-' && (
          <p className="footer-info footer-wa-info" style={{ 
            fontSize: '12px', 
            color: '#25D366', 
            marginTop: '4px',
            borderTop: '1px solid var(--border)',
            paddingTop: '8px'
          }}>
            📱 WhatsApp terdaftar: <strong>{formatPhoneDisplay(profileData.noHp)}</strong>
          </p>
        )}
        {isSiswa && (
          <p className="footer-info footer-student-info" style={{ 
            fontSize: '12px', 
            color: 'var(--text-muted)', 
            marginTop: '4px',
            borderTop: '1px solid var(--border)',
            paddingTop: '8px'
          }}>
            📌 Siswa hanya dapat mengubah <strong>foto profil</strong>. 
            Untuk mengubah data lainnya, silakan hubungi guru atau admin.
          </p>
        )}
        {saveSuccess && (
          <p className="footer-info footer-success" style={{ 
            fontSize: '12px', 
            color: '#4caf50', 
            marginTop: '4px',
            borderTop: '1px solid var(--border)',
            paddingTop: '8px',
            fontWeight: 'bold'
          }}>
            ✅ Data berhasil disimpan!
          </p>
        )}
      </div>
    </div>
  );
};

export default ProfileTab;