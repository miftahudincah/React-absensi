// src/pages/tabs/StaffTab.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ref, onValue, set, remove, update, push, get } from 'firebase/database';
import { db } from '../../firebase/config';
import './StaffTab.css';

const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const StaffTab = ({ user }) => {
  // ==================== STATE ====================
  const [staffData, setStaffData] = useState([]);
  const [usersAuth, setUsersAuth] = useState([]);
  const [allCodes, setAllCodes] = useState([]);
  const [attendanceData, setAttendanceData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [error, setError] = useState(null);
  const [filterJabatan, setFilterJabatan] = useState('all');
  const [filterDepartemen, setFilterDepartemen] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState({ sending: false, lastResult: null });
  
  // NEW: Photo cache state
  const [photoCache, setPhotoCache] = useState({});
  
  // State untuk modal tambah/edit
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [formData, setFormData] = useState({
    id: '',
    nama: '',
    jabatan: 'guru',
    departemen: '',
    email: '',
    noHp: '',
    alamat: '',
    gender: 'Laki-laki'
  });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  
  // State untuk generate kode
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedStaffForCode, setSelectedStaffForCode] = useState(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  
  // State untuk toast notification
  const [toast, setToast] = useState({ show: false, message: '', type: '' });

  // ==================== ROLE PERMISSIONS ====================
  const rawRole = user?.role || 'siswa';
  const role = rawRole.toString().toLowerCase().trim();
  
  const isSiswa = role === 'siswa';
  const isGuru = role === 'guru';
  const isStaffTU = role === 'staff_tu';
  const isWakilKepala = role === 'wakil_kepala';
  const isAdmin = role === 'admin';
  const isDeveloper = role === 'developer';
  
  const canViewAll = ['developer', 'admin', 'wakil_kepala', 'staff_tu', 'guru'].includes(role);
  const canManageStaff = ['developer', 'admin', 'wakil_kepala'].includes(role);
  const canGenerateCode = ['developer', 'admin', 'wakil_kepala'].includes(role);
  const canDeleteStaff = ['developer', 'admin', 'wakil_kepala'].includes(role);
  const canExport = !isSiswa;
  const canSendReminder = ['developer', 'admin', 'wakil_kepala'].includes(role);

  console.log('🔍 STAFF TAB - Raw Role:', rawRole);
  console.log('🔍 STAFF TAB - Normalized Role:', role);
  console.log('🔍 STAFF TAB - isDeveloper:', isDeveloper);
  console.log('🔍 STAFF TAB - canManageStaff:', canManageStaff);

  // ==================== TOAST NOTIFICATION ====================
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: '' });
    }, 3000);
  };

  // ==================== GET STAFF PHOTO - NEW ====================
  const getStaffPhoto = useCallback((staffId, staffName, staffEmail) => {
    // Check cache
    if (photoCache[staffId]) {
      return photoCache[staffId];
    }

    // Find matching user auth
    const userAuth = usersAuth.find(u => {
      // Check various ID matches
      const fpMatch = u.fpId && String(u.fpId) === String(staffId);
      const userIdMatch = u.userId && String(u.userId) === String(staffId);
      const uidMatch = u.uid && String(u.uid) === String(staffId);
      const staffIdMatch = u.staffId && String(u.staffId) === String(staffId);
      
      // Check name (case insensitive)
      const nameMatch = u.nama && staffName && 
        u.nama.toLowerCase().trim() === staffName.toLowerCase().trim();
      
      // Check email (case insensitive)
      const emailMatch = u.email && staffEmail && 
        u.email.toLowerCase().trim() === staffEmail.toLowerCase().trim();
      
      return fpMatch || userIdMatch || uidMatch || staffIdMatch || nameMatch || emailMatch;
    });

    let photoUrl;

    if (userAuth) {
      // Check photoUrl in various formats
      const rawPhotoUrl = userAuth.photoUrl || userAuth.photoURL || userAuth.foto || '';
      
      if (rawPhotoUrl && rawPhotoUrl !== 'null' && rawPhotoUrl !== 'undefined' && rawPhotoUrl.trim() !== '') {
        // Add timestamp to avoid cache
        const separator = rawPhotoUrl.includes('?') ? '&' : '?';
        photoUrl = rawPhotoUrl + separator + 't=' + Date.now();
        console.log(`📸 Staff photo found for ${staffName}: ${photoUrl}`);
      } else {
        // Fallback to avatar
        const initial = staffName ? staffName.charAt(0).toUpperCase() : 'S';
        photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(staffName || 'Staff')}&background=9b59b6&color=fff&size=64&bold=true`;
        console.log(`🎨 Avatar fallback for staff ${staffName}`);
      }
    } else {
      // No user auth, use avatar
      const initial = staffName ? staffName.charAt(0).toUpperCase() : 'S';
      photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(staffName || 'Staff')}&background=9b59b6&color=fff&size=64&bold=true`;
      console.log(`🎨 Avatar fallback (no auth) for staff ${staffName}`);
    }

    // Save to cache
    setPhotoCache(prev => {
      const newCache = { ...prev };
      if (newCache[staffId]) {
        delete newCache[staffId];
      }
      return { ...newCache, [staffId]: photoUrl };
    });

    return photoUrl;
  }, [usersAuth, photoCache]);

  // ==================== REFRESH STAFF PHOTO CACHE ====================
  const refreshStaffPhotoCache = useCallback((staffId) => {
    setPhotoCache(prev => {
      const newCache = { ...prev };
      if (newCache[staffId]) {
        delete newCache[staffId];
      }
      return newCache;
    });
  }, []);

  // ==================== REFRESH ALL STAFF PHOTO CACHE ====================
  const refreshAllStaffPhotoCache = useCallback(() => {
    setPhotoCache({});
  }, []);

  // ==================== GET STAFF PHONE NUMBER ====================
  const getStaffPhoneNumber = (staff) => {
    if (!staff) return null;
    
    if (staff.noHp && staff.noHp !== '-' && staff.noHp !== '') {
      return staff.noHp;
    }
    
    const userAuth = usersAuth.find(u => 
      u.staffId == staff.id || 
      u.uid == staff.id || 
      u.fpId == staff.id ||
      u.userId == staff.id ||
      (u.email && staff.email && u.email.toLowerCase() === staff.email.toLowerCase())
    );
    if (userAuth?.noHp && userAuth.noHp !== '-' && userAuth.noHp !== '') {
      return userAuth.noHp;
    }
    if (userAuth?.phoneNumber && userAuth.phoneNumber !== '-' && userAuth.phoneNumber !== '') {
      return userAuth.phoneNumber;
    }
    
    return null;
  };

  // ==================== GET USER AUTH FOR STAFF ====================
  const getUserAuthForStaff = useCallback((staffId, staffName, staffEmail) => {
    return usersAuth.find(u => {
      const fpMatch = u.fpId && String(u.fpId) === String(staffId);
      const userIdMatch = u.userId && String(u.userId) === String(staffId);
      const uidMatch = u.uid && String(u.uid) === String(staffId);
      const staffIdMatch = u.staffId && String(u.staffId) === String(staffId);
      const nameMatch = u.nama && staffName && 
        u.nama.toLowerCase().trim() === staffName.toLowerCase().trim();
      const emailMatch = u.email && staffEmail && 
        u.email.toLowerCase().trim() === staffEmail.toLowerCase().trim();
      return fpMatch || userIdMatch || uidMatch || staffIdMatch || nameMatch || emailMatch;
    });
  }, [usersAuth]);

  // ==================== SEND WHATSAPP NOTIFICATION ====================
  const sendWhatsAppNotification = async (phoneNumber, message, type) => {
    if (!phoneNumber || phoneNumber === '-' || phoneNumber === '') {
      console.log('⚠️ No phone number provided, skipping notification');
      setWhatsappStatus({ sending: false, lastResult: { success: false, error: 'No phone number' } });
      return { success: false, error: 'No phone number' };
    }

    let formattedNumber = phoneNumber.toString().replace(/[^0-9]/g, '');
    if (formattedNumber.startsWith('0')) {
      formattedNumber = '62' + formattedNumber.substring(1);
    }
    if (!formattedNumber.startsWith('62')) {
      formattedNumber = '62' + formattedNumber;
    }

    setWhatsappStatus({ sending: true, lastResult: null });

    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: formattedNumber,
          message: message
        })
      });

      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ WhatsApp ${type} notification sent to ${formattedNumber}`);
        setWhatsappStatus({ 
          sending: false, 
          lastResult: { success: true, phoneNumber: formattedNumber, type } 
        });
        return { success: true, data: data.data };
      } else {
        console.error(`❌ Failed to send WhatsApp ${type}:`, data.error);
        setWhatsappStatus({ 
          sending: false, 
          lastResult: { success: false, error: data.error || 'Unknown error' } 
        });
        return { success: false, error: data.error || 'Unknown error' };
      }
    } catch (error) {
      console.error(`❌ WhatsApp send error:`, error);
      setWhatsappStatus({ 
        sending: false, 
        lastResult: { success: false, error: error.message } 
      });
      return { success: false, error: error.message };
    }
  };

  // ==================== SEND STAFF REMINDER NOTIFICATION ====================
  const sendStaffReminderNotification = async (staff) => {
    const phoneNumber = getStaffPhoneNumber(staff);
    if (!phoneNumber) {
      console.log(`⚠️ No phone for staff ${staff.nama}`);
      return { success: false, error: 'No phone number' };
    }

    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sekolah';
    const dateStr = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    
    const message = `*🔔 PENGINGAT ABSENSI STAFF - ${schoolName}*

👤 *Staff:* ${staff.nama}
🆔 *ID:* ${staff.id}
📋 *Jabatan:* ${staff.jabatan || '-'}
🏢 *Departemen:* ${staff.departemen || '-'}
📅 *Tanggal:* ${dateStr}
⏰ *Waktu:* ${timeStr} WIB

⚠️ *Anda belum melakukan absensi masuk hari ini!*
Segera lakukan absensi melalui sistem.

--- 
📱 *Sistem Absensi IoT*
🔔 Ini adalah pengingat otomatis.`;

    return await sendWhatsAppNotification(phoneNumber, message, 'staff_reminder');
  };

  // ==================== SEND BULK REMINDER STAFF ====================
  const sendBulkReminderStaff = async () => {
    if (!canSendReminder) {
      showToast('⚠️ Anda tidak memiliki akses untuk mengirim pengingat!', 'error');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    
    const checkedInIds = new Set();
    attendanceData
      .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
      .forEach(a => checkedInIds.add(a.staffId));

    const absentStaff = filteredStaff.filter(s => !checkedInIds.has(s.id));

    if (absentStaff.length === 0) {
      showToast('✅ Semua staff sudah absen hari ini!', 'success');
      return;
    }

    if (!window.confirm(`⚠️ Kirim pengingat WhatsApp ke ${absentStaff.length} staff yang belum absen hari ini?`)) {
      return;
    }

    setWhatsappStatus({ sending: true, lastResult: null });
    let successCount = 0;
    let failCount = 0;

    for (const staff of absentStaff) {
      const result = await sendStaffReminderNotification(staff);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setWhatsappStatus({ 
      sending: false, 
      lastResult: { 
        success: true, 
        message: `✅ Terkirim: ${successCount}, Gagal: ${failCount}` 
      } 
    });

    showToast(`✅ Pengingat terkirim!\n📨 Berhasil: ${successCount}\n❌ Gagal: ${failCount}`, 'success');

    if (typeof window.logActivity === 'function') {
      window.logActivity('send_bulk_reminder_staff_tab', `Mengirim pengingat WhatsApp ke ${successCount} staff dari halaman Staff`);
    }
  };

  // ==================== AMBIL DATA DARI FIREBASE ====================
  useEffect(() => {
    let isMounted = true;

    const staffRef = ref(db, 'staff');
    const unsubscribeStaff = onValue(staffRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          // ⭐ EXCLUDE DEVELOPER FROM STAFF DATA ⭐
          if (item && typeof item === 'object' && item.jabatan !== 'developer') {
            list.push({
              id: key,
              ...item,
              name: item.nama || item.name || 'Staff',
              jabatan: item.jabatan || 'guru',
              departemen: item.departemen || '-',
              email: item.email || '',
              noHp: item.noHp || '',
              alamat: item.alamat || '',
              gender: item.gender || 'Laki-laki',
              createdAt: item.createdAt || Date.now(),
              _source: 'staff'
            });
          }
        });
      }
      list.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
      setStaffData(list);
      setLoading(false);
    }, (error) => {
      console.error('Firebase staff error:', error);
      setError('Gagal memuat data staff dari server');
      setLoading(false);
    });

    const usersAuthRef = ref(db, 'users_auth');
    const unsubscribeUsersAuth = onValue(usersAuthRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const authList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const auth = data[key];
          // ⭐ EXCLUDE DEVELOPER FROM USERS_AUTH ⭐
          if (auth && auth.role !== 'developer') {
            authList.push({ uid: key, ...auth });
          }
        });
      }
      setUsersAuth(authList);
      // Refresh photo cache when users_auth changes
      setPhotoCache({});
    });

    const codesRef = ref(db, 'codes');
    const unsubscribeCodes = onValue(codesRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object') {
            // ⭐ SKIP CODES FOR DEVELOPER ⭐
            if (item.targetRole === 'developer') return;
            list.push({
              code: key,
              ...item,
              createdAt: item.createdAt || Date.now()
            });
          }
        });
      }
      setAllCodes(list);
    });

    const attendanceRef = ref(db, 'staff_attendance');
    const unsubscribeAttendance = onValue(attendanceRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(date => {
          const dailyRecords = data[date];
          if (dailyRecords) {
            Object.keys(dailyRecords).forEach(id => {
              const record = dailyRecords[id];
              if (record) {
                // ⭐ EXCLUDE DEVELOPER ATTENDANCE ⭐
                if (record.jabatan && record.jabatan === 'developer') return;
                list.push({
                  id: date + "-" + id,
                  staffId: id,
                  date: date,
                  timeIn: record.timeIn,
                  timeOut: record.timeOut,
                  status: record.timeOut ? "Pulang" : "Hadir",
                  timestamp: record.timestamp || Date.now(),
                  jabatan: record.jabatan || 'guru'
                });
              }
            });
          }
        });
      }
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setAttendanceData(list);
      setLoadingAttendance(false);
    }, (error) => {
      console.error('Firebase staff attendance error:', error);
      setLoadingAttendance(false);
    });

    return () => {
      isMounted = false;
      unsubscribeStaff();
      unsubscribeUsersAuth();
      unsubscribeCodes();
      unsubscribeAttendance();
    };
  }, []);

  // ==================== FILTER DATA ====================
  const filteredStaff = useMemo(() => {
    let data = [...staffData];
    
    if (filterJabatan !== 'all') {
      data = data.filter(s => s.jabatan === filterJabatan);
    }
    
    if (filterDepartemen !== 'all') {
      data = data.filter(s => s.departemen === filterDepartemen);
    }
    
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      data = data.filter(s =>
        (s.nama && s.nama.toLowerCase().includes(search)) ||
        (s.email && s.email.toLowerCase().includes(search)) ||
        (s.id && s.id.toLowerCase().includes(search)) ||
        (s.jabatan && s.jabatan.toLowerCase().includes(search)) ||
        (s.departemen && s.departemen.toLowerCase().includes(search)) ||
        (s.noHp && s.noHp.includes(search))
      );
    }
    
    return data;
  }, [staffData, filterJabatan, filterDepartemen, searchTerm]);

  // ==================== GET STAFF WITHOUT ACCOUNT ====================
  const getStaffWithoutAccount = useMemo(() => {
    const registeredEmails = new Set();
    const registeredIds = new Set();
    usersAuth.forEach(a => {
      if (a.email) registeredEmails.add(a.email.toLowerCase());
      if (a.fpId) registeredIds.add(a.fpId.toString());
      if (a.userId) registeredIds.add(a.userId.toString());
      if (a.staffId) registeredIds.add(a.staffId.toString());
    });

    const staffWithCode = new Set();
    allCodes.forEach(c => {
      if (!c.used && (c.type === 'guru' || c.type === 'staff') && c.linkedId) {
        staffWithCode.add(c.linkedId.toString());
      }
    });

    return staffData.filter(s => {
      const email = s.email?.toLowerCase() || '';
      const idStr = s.id?.toString() || '';
      return !registeredEmails.has(email) && 
             !registeredIds.has(idStr) && 
             !staffWithCode.has(idStr) &&
             s.email && s.email !== '';
    });
  }, [staffData, usersAuth, allCodes]);

  // ==================== GET STAFF WITH ACCOUNT ====================
  const getStaffWithAccount = useMemo(() => {
    const registeredEmails = new Set();
    const registeredIds = new Set();
    usersAuth.forEach(a => {
      if (a.email) registeredEmails.add(a.email.toLowerCase());
      if (a.fpId) registeredIds.add(a.fpId.toString());
      if (a.userId) registeredIds.add(a.userId.toString());
      if (a.staffId) registeredIds.add(a.staffId.toString());
    });

    return staffData.filter(s => {
      const email = s.email?.toLowerCase() || '';
      const idStr = s.id?.toString() || '';
      return registeredEmails.has(email) || registeredIds.has(idStr);
    });
  }, [staffData, usersAuth]);

  // ==================== GET ROLE INFO ====================
  const getRoleDisplayName = (role) => {
    const names = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala Sekolah',
      staff_tu: 'Staff TU',
      guru: 'Guru',
      siswa: 'Siswa'
    };
    return names[role] || role;
  };

  const getRoleIcon = (role) => {
    const icons = {
      developer: '💻',
      admin: '👑',
      wakil_kepala: '👔',
      staff_tu: '📋',
      guru: '👨‍🏫',
      siswa: '👨‍🎓'
    };
    return icons[role] || '👤';
  };

  const getRoleColor = (role) => {
    const colors = {
      developer: '#9b59b6',
      admin: '#e74c3c',
      wakil_kepala: '#3498db',
      staff_tu: '#607d8b',
      guru: '#f39c12',
      siswa: '#e67e22'
    };
    return colors[role] || '#7f8c8d';
  };

  // ==================== GET JABATAN LABEL ====================
  const getJabatanLabel = (jabatan) => {
    const labels = {
      'kepala_sekolah': '👑 Kepala Sekolah',
      'wakil_kepala': '👔 Wakil Kepala Sekolah',
      'staff_tu': '📋 Staff TU',
      'guru': '👨‍🏫 Guru',
      'staff': '👔 Staff'
    };
    return labels[jabatan] || jabatan || 'Guru';
  };

  const getJabatanColor = (jabatan) => {
    const colors = {
      'kepala_sekolah': '#e74c3c',
      'wakil_kepala': '#9b59b6',
      'staff_tu': '#3498db',
      'guru': '#f39c12',
      'staff': '#1abc9c'
    };
    return colors[jabatan] || '#7f8c8d';
  };

  // ==================== CRUD OPERATIONS ====================
  const openAddModal = () => {
    setModalMode('add');
    setSelectedStaff(null);
    setFormData({
      id: '',
      nama: '',
      jabatan: 'guru',
      departemen: '',
      email: '',
      noHp: '',
      alamat: '',
      gender: 'Laki-laki'
    });
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (staff) => {
    setModalMode('edit');
    setSelectedStaff(staff);
    setFormData({
      id: staff.id || '',
      nama: staff.nama || '',
      jabatan: staff.jabatan || 'guru',
      departemen: staff.departemen || '',
      email: staff.email || '',
      noHp: staff.noHp || '',
      alamat: staff.alamat || '',
      gender: staff.gender || 'Laki-laki'
    });
    setFormError('');
    setShowModal(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmitStaff = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');

    try {
      if (!formData.nama || formData.nama.trim() === '') {
        setFormError('Nama staff wajib diisi!');
        setFormLoading(false);
        return;
      }

      if (!formData.noHp || formData.noHp.trim() === '') {
        setFormError('Nomor WhatsApp wajib diisi!');
        setFormLoading(false);
        return;
      }

      if (formData.email && !formData.email.includes('@')) {
        setFormError('Email tidak valid!');
        setFormLoading(false);
        return;
      }

      let staffId = formData.id.trim();
      
      if (modalMode === 'add') {
        if (!staffId) {
          setFormError('ID Staff wajib diisi!');
          setFormLoading(false);
          return;
        }

        const existingStaff = staffData.find(s => s.id === staffId);
        if (existingStaff) {
          setFormError(`ID "${staffId}" sudah digunakan oleh ${existingStaff.nama}!`);
          setFormLoading(false);
          return;
        }

        const existingAuth = usersAuth.find(u => 
          u.fpId === staffId || u.userId === staffId || u.uid === staffId || u.staffId === staffId
        );
        if (existingAuth) {
          setFormError(`ID "${staffId}" sudah terdaftar sebagai akun!`);
          setFormLoading(false);
          return;
        }
      } else {
        staffId = selectedStaff.id;
      }

      const staffPayload = {
        nama: formData.nama.trim(),
        jabatan: formData.jabatan,
        departemen: formData.departemen || '-',
        email: formData.email || '',
        noHp: formData.noHp.trim(),
        alamat: formData.alamat || '',
        gender: formData.gender || 'Laki-laki',
        updatedAt: Date.now()
      };

      if (modalMode === 'add') {
        staffPayload.createdAt = Date.now();
        staffPayload.createdBy = user?.name || user?.email || 'System';
      } else {
        staffPayload.updatedBy = user?.name || user?.email || 'System';
      }

      await set(ref(db, `staff/${staffId}`), staffPayload);
      
      showToast(
        modalMode === 'add' 
          ? `✅ Staff ${formData.nama} berhasil ditambahkan! (ID: ${staffId})` 
          : `✅ Staff ${formData.nama} berhasil diupdate!`,
        'success'
      );
      
      setShowModal(false);
      
      const snapshot = await new Promise((resolve) => {
        onValue(ref(db, 'staff'), (snap) => resolve(snap), { onlyOnce: true });
      });
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object' && item.jabatan !== 'developer') {
            list.push({ id: key, ...item });
          }
        });
        list.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
        setStaffData(list);
      }

    } catch (error) {
      console.error('Submit staff error:', error);
      setFormError('❌ Gagal menyimpan data: ' + error.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteStaff = async (staffId, staffName) => {
    if (!window.confirm(`⚠️ Yakin ingin menghapus staff "${staffName}"?\n\nData yang dihapus tidak dapat dikembalikan!`)) return;
    
    try {
      await remove(ref(db, `staff/${staffId}`));
      showToast(`✅ Staff "${staffName}" berhasil dihapus!`, 'success');
      setStaffData(prev => prev.filter(s => s.id !== staffId));
      // Remove from photo cache
      refreshStaffPhotoCache(staffId);
    } catch (error) {
      console.error('Delete staff error:', error);
      showToast('❌ Gagal menghapus staff: ' + error.message, 'error');
    }
  };

  // ==================== DELETE ALL STAFF (DEV ONLY) ====================
  const deleteAllStaff = async () => {
    if (!isDeveloper) {
      showToast('❌ Akses ditolak! Hanya role Developer yang dapat menghapus semua data.', 'error');
      return;
    }

    const totalData = filteredStaff.length;
    if (totalData === 0) {
      showToast('📭 Tidak ada data staff yang dapat dihapus.', 'info');
      return;
    }

    let filterDesc = '';
    if (filterJabatan !== 'all' && filterDepartemen !== 'all') {
      filterDesc = `Jabatan ${filterJabatan} & Departemen ${filterDepartemen}`;
    } else if (filterJabatan !== 'all') {
      filterDesc = `Jabatan ${filterJabatan}`;
    } else if (filterDepartemen !== 'all') {
      filterDesc = `Departemen ${filterDepartemen}`;
    } else if (searchTerm) {
      filterDesc = `Pencarian "${searchTerm}"`;
    } else {
      filterDesc = 'SEMUA DATA';
    }

    const confirmMessage = `⚠️ PERINGATAN!\n\nAnda akan menghapus SEMUA data staff (${totalData} staff) dari database.\n\n📌 Filter: ${filterDesc}\n\nTindakan ini TIDAK DAPAT DIURUNGKAN!\n\nKetik "HAPUS SEMUA" untuk melanjutkan:`;
    
    const userInput = prompt(confirmMessage);
    if (userInput !== 'HAPUS SEMUA') {
      showToast('❌ Penghapusan dibatalkan.', 'info');
      return;
    }

    if (!window.confirm(`⚠️ KONFIRMASI FINAL!\n\nApakah Anda YAKIN ingin menghapus ${totalData} data staff secara permanen?`)) {
      showToast('❌ Penghapusan dibatalkan.', 'info');
      return;
    }

    setDeleteAllLoading(true);

    try {
      let deletedCount = 0;
      for (const staff of filteredStaff) {
        await remove(ref(db, `staff/${staff.id}`));
        refreshStaffPhotoCache(staff.id);
        deletedCount++;
        console.log(`✅ Menghapus staff: ${staff.nama} (${staff.id})`);
      }
      setStaffData(prev => prev.filter(s => !filteredStaff.some(f => f.id === s.id)));
      showToast(`✅ Berhasil menghapus ${deletedCount} data staff!\n📌 Filter: ${filterDesc}`, 'success');
    } catch (error) {
      console.error('Delete all staff error:', error);
      showToast('❌ Gagal menghapus semua data: ' + error.message, 'error');
    } finally {
      setDeleteAllLoading(false);
    }
  };

  // ==================== GENERATE CODE ====================
  const openGenerateModal = (staff) => {
    setSelectedStaffForCode(staff);
    setGeneratedCode('');
    setShowGenerateModal(true);
  };

  const handleGenerateCode = async () => {
    if (!selectedStaffForCode) {
      showToast('❌ Pilih staff terlebih dahulu!', 'error');
      return;
    }

    const hasAccount = usersAuth.some(a => 
      a.email?.toLowerCase() === selectedStaffForCode.email?.toLowerCase() ||
      a.fpId == selectedStaffForCode.id ||
      a.userId == selectedStaffForCode.id ||
      a.staffId == selectedStaffForCode.id
    );
    
    if (hasAccount) {
      showToast(`❌ Staff ${selectedStaffForCode.nama} sudah memiliki akun!`, 'error');
      setShowGenerateModal(false);
      return;
    }

    const hasActiveCode = allCodes.some(c => 
      !c.used && (c.type === 'guru' || c.type === 'staff') && c.linkedId == selectedStaffForCode.id
    );
    
    if (hasActiveCode) {
      showToast(`❌ Staff ${selectedStaffForCode.nama} masih memiliki kode aktif!`, 'error');
      setShowGenerateModal(false);
      return;
    }

    setGeneratingCode(true);
    
    try {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      const code = `REG-${timestamp.slice(-3)}${random}`;
      
      let targetRole = 'guru';
      let typeDisplay = 'GURU';
      if (selectedStaffForCode.jabatan === 'kepala_sekolah') {
        targetRole = 'admin';
        typeDisplay = 'KEPALA SEKOLAH';
      } else if (selectedStaffForCode.jabatan === 'wakil_kepala') {
        targetRole = 'wakil_kepala';
        typeDisplay = 'WAKIL KEPALA';
      } else if (selectedStaffForCode.jabatan === 'staff_tu') {
        targetRole = 'staff_tu';
        typeDisplay = 'STAFF TU';
      }

      const codeData = {
        used: false,
        createdAt: Date.now(),
        type: 'staff',
        createdBy: user?.name || user?.email || 'System',
        createdRole: user?.role || 'system',
        linkedId: selectedStaffForCode.id,
        linkedEmail: selectedStaffForCode.email || '',
        linkedName: selectedStaffForCode.nama,
        targetRole: targetRole,
        requireId: true,
        staffJabatan: selectedStaffForCode.jabatan,
        nama: selectedStaffForCode.nama,
        email: selectedStaffForCode.email || '',
        roleLabel: typeDisplay,
        noHp: selectedStaffForCode.noHp || ''
      };

      await set(ref(db, `codes/${code}`), codeData);
      
      setGeneratedCode(code);
      showToast(`✅ Kode untuk ${selectedStaffForCode.nama} (${typeDisplay}) berhasil dibuat!`, 'success');
      
      const codesRef = ref(db, 'codes');
      const snapshot = await new Promise((resolve) => {
        onValue(codesRef, (snap) => resolve(snap), { onlyOnce: true });
      });
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object' && item.targetRole !== 'developer') {
            list.push({ code: key, ...item });
          }
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setAllCodes(list);
      }
      
    } catch (error) {
      console.error('Generate code error:', error);
      showToast('❌ Gagal membuat kode: ' + error.message, 'error');
    } finally {
      setGeneratingCode(false);
    }
  };

  // ==================== EXPORT FUNCTIONS ====================
  const exportToExcel = () => {
    if (!canExport) {
      showToast('Anda tidak memiliki akses untuk mengekspor data!', 'error');
      return;
    }
    
    setExportLoading(true);
    
    try {
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      
      let csv = '\uFEFF';
      csv += `"LAPORAN DATA STAFF/GURU"\n`;
      csv += `"Tanggal Cetak: ${dateNow} ${timeNow}"\n\n`;
      csv += `"No","ID","Nama","Jabatan","Departemen","Email","No HP","Gender","Alamat","Status Akun","WA Terdaftar"\n`;
      
      filteredStaff.forEach((item, index) => {
        const hasAccount = usersAuth.some(a => 
          a.email?.toLowerCase() === item.email?.toLowerCase() ||
          a.fpId == item.id ||
          a.userId == item.id ||
          a.staffId == item.id
        );
        const status = hasAccount ? 'Punya Akun' : 'Belum Punya Akun';
        const hasWA = getStaffPhoneNumber(item) ? 'Ya' : 'Tidak';
        csv += `"${index + 1}","${item.id}","${item.nama || '-'}","${item.jabatan || '-'}","${item.departemen || '-'}","${item.email || '-'}","${item.noHp || '-'}","${item.gender || '-'}","${item.alamat || '-'}","${status}","${hasWA}"\n`;
      });
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `data_staff_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      
      showToast('✅ Data berhasil diekspor ke Excel!', 'success');
    } catch (error) {
      console.error('Export Excel error:', error);
      showToast('❌ Gagal mengekspor data: ' + error.message, 'error');
    } finally {
      setExportLoading(false);
    }
  };

  const exportToPDF = () => {
    if (!canExport) {
      showToast('Anda tidak memiliki akses untuk mengekspor data!', 'error');
      return;
    }
    
    setExportLoading(true);
    
    try {
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        showToast('❌ Popup diblokir! Izinkan popup untuk mengekspor PDF.', 'error');
        setExportLoading(false);
        return;
      }
      
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Laporan Data Staff - ${dateNow}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { text-align: center; color: #333; }
            .info { text-align: center; color: #666; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { background: #f39c12; color: white; padding: 8px; text-align: left; }
            td { padding: 6px 8px; border: 1px solid #ddd; }
            tr:nth-child(even) { background: #f9f9f9; }
            .footer { margin-top: 20px; text-align: center; color: #999; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>📊 LAPORAN DATA STAFF/GURU</h1>
          <p class="info">Tanggal Cetak: ${dateNow} ${timeNow}</p>
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>ID</th>
                <th>Nama</th>
                <th>Jabatan</th>
                <th>Departemen</th>
                <th>Email</th>
                <th>No HP</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
      `;
      
      filteredStaff.forEach((item, index) => {
        const hasAccount = usersAuth.some(a => 
          a.email?.toLowerCase() === item.email?.toLowerCase() ||
          a.fpId == item.id ||
          a.userId == item.id ||
          a.staffId == item.id
        );
        const status = hasAccount ? '✅ Punya Akun' : '⏳ Belum';
        html += `
          <tr>
            <td>${index + 1}</td>
            <td>${item.id}</td>
            <td>${item.nama || '-'}</td>
            <td>${item.jabatan || '-'}</td>
            <td>${item.departemen || '-'}</td>
            <td>${item.email || '-'}</td>
            <td>${item.noHp || '-'}</td>
            <td>${status}</td>
          </tr>
        `;
      });
      
      html += `
            </tbody>
          </table>
          <div class="footer">
            <p>Total Staff: ${filteredStaff.length} orang</p>
            <p>Dicetak oleh: ${user?.name || user?.email || 'System'}</p>
            <p>&copy; ${new Date().getFullYear()} Sistem Absensi IoT</p>
          </div>
        </body>
        </html>
      `;
      
      printWindow.document.write(html);
      printWindow.document.close();
      
      setTimeout(() => {
        printWindow.print();
      }, 500);
      
      showToast('✅ Data berhasil diekspor ke PDF!', 'success');
    } catch (error) {
      console.error('Export PDF error:', error);
      showToast('❌ Gagal mengekspor data: ' + error.message, 'error');
    } finally {
      setExportLoading(false);
    }
  };

  // ==================== RENDER ====================
  if (!canViewAll) {
    return (
      <div className="staff-tab-container">
        <div className="staff-tab-header">
          <h2>👥 Data Staff</h2>
        </div>
        <div className="staff-access-denied">
          <div className="access-denied-icon">⛔</div>
          <h3>Akses Ditolak</h3>
          <p>Anda tidak memiliki izin untuk mengakses halaman ini.</p>
          <p className="access-role">Role: {user?.role || 'Unknown'}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="staff-tab-container">
        <div className="staff-tab-header">
          <h2>👥 Data Staff</h2>
        </div>
        <div className="staff-loading">
          <div className="loading-spinner"></div>
          <p>⏳ Memuat data staff...</p>
        </div>
      </div>
    );
  }

  let filterButtonLabel = 'Semua Data';
  if (filterJabatan !== 'all' && filterDepartemen !== 'all') {
    filterButtonLabel = `Jabatan ${filterJabatan} & Departemen ${filterDepartemen}`;
  } else if (filterJabatan !== 'all') {
    filterButtonLabel = `Jabatan ${filterJabatan}`;
  } else if (filterDepartemen !== 'all') {
    filterButtonLabel = `Departemen ${filterDepartemen}`;
  } else if (searchTerm) {
    filterButtonLabel = `"${searchTerm}"`;
  }

  const totalDataToDelete = filteredStaff.length;

  const today = new Date().toISOString().split('T')[0];
  const checkedInIds = new Set();
  attendanceData
    .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
    .forEach(a => checkedInIds.add(a.staffId));
  const absentToday = filteredStaff.filter(s => !checkedInIds.has(s.id));

  return (
    <div className="staff-tab-container">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`staff-toast ${toast.type}`}>
          {toast.message}
        </div>
      )}

      {/* Header - Mobile Friendly */}
      <div className="staff-tab-header">
        <div className="header-left">
          <h2>👥 Data Staff & Guru</h2>
          <p className="header-subtitle">Kelola data staff dan guru</p>
        </div>
        <div className="header-actions">
          {canExport && (
            <div className="export-buttons">
              <button className="btn-export-excel" onClick={exportToExcel} disabled={exportLoading} title="Export Excel">
                📊
              </button>
              <button className="btn-export-pdf" onClick={exportToPDF} disabled={exportLoading} title="Export PDF">
                📄
              </button>
            </div>
          )}
          {canManageStaff && (
            <button className="btn-add-staff" onClick={openAddModal} title="Tambah Staff">
              ➕
            </button>
          )}
        </div>
      </div>

      {/* WhatsApp Status Banner */}
      {whatsappStatus.lastResult && (
        <div className="whatsapp-status-banner-staff">
          <span>{whatsappStatus.lastResult.success ? '✅' : '❌'}</span>
          <span>
            {whatsappStatus.lastResult.success 
              ? `WhatsApp terkirim ke ${whatsappStatus.lastResult.phoneNumber || 'nomor staff'}`
              : `WhatsApp gagal: ${whatsappStatus.lastResult.error || 'Unknown error'}`
            }
          </span>
          {whatsappStatus.sending && <span className="loading-dots">⏳</span>}
          <button onClick={() => setWhatsappStatus({ sending: false, lastResult: null })}>✖</button>
        </div>
      )}

      {/* Reminder Banner */}
      {canSendReminder && (
        <div className="reminder-banner-staff">
          <div>
            <span>🔔</span>
            <span><strong>{absentToday.length}</strong> staff belum absen hari ini</span>
          </div>
          <button
            onClick={sendBulkReminderStaff}
            disabled={whatsappStatus.sending || absentToday.length === 0}
          >
            {whatsappStatus.sending ? '⏳' : `📱 (${absentToday.length})`}
          </button>
        </div>
      )}

      {/* Developer Banner */}
      {isDeveloper && (
        <div className="developer-banner-staff">
          <span className="dev-icon">💻</span>
          <div className="dev-info">
            <span className="dev-status">Developer Mode</span>
            <span className="dev-badge highlight-red">🗑️ Hapus</span>
            <span className="dev-badge highlight-orange">🔔 Reminder</span>
          </div>
          <span className="dev-count">{filteredStaff.length}</span>
        </div>
      )}

      {/* Delete All Banner - Developer Only */}
      {isDeveloper && totalDataToDelete > 0 && (
        <div className="delete-all-banner-staff">
          <div className="banner-left">
            <span className="banner-icon">⚠️</span>
            <span className="banner-info">
              <strong>{totalDataToDelete}</strong> staff
              <span className="banner-filter">({filterButtonLabel})</span>
            </span>
          </div>
          <button
            className="btn-delete-banner-staff"
            onClick={deleteAllStaff}
            disabled={deleteAllLoading}
          >
            {deleteAllLoading ? '⏳' : `🗑️`}
          </button>
        </div>
      )}

      {/* Stats Cards - Mobile Friendly */}
      <div className="staff-stats-grid">
        <div className="stat-card">
          <span className="stat-number">{staffData.length}</span>
          <span className="stat-label">👥 Total</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{getStaffWithAccount.length}</span>
          <span className="stat-label">✅ Akun</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{getStaffWithoutAccount.length}</span>
          <span className="stat-label">⏳ Belum</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{allCodes.filter(c => !c.used && (c.type === 'guru' || c.type === 'staff')).length}</span>
          <span className="stat-label">🔑 Kode</span>
        </div>
      </div>

      {/* Filter & Search - Mobile Friendly */}
      <div className="staff-filter-section">
        <div className="search-box">
          <input
            type="text"
            placeholder="🔍 Cari staff..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-box">
          <select value={filterJabatan} onChange={(e) => setFilterJabatan(e.target.value)}>
            <option value="all">📋 Semua</option>
            <option value="kepala_sekolah">👑 KS</option>
            <option value="wakil_kepala">👔 WK</option>
            <option value="staff_tu">📋 TU</option>
            <option value="guru">👨‍🏫 Guru</option>
          </select>
        </div>
        <div className="filter-box">
          <select value={filterDepartemen} onChange={(e) => setFilterDepartemen(e.target.value)}>
            <option value="all">📂 Semua</option>
            {Array.from(new Set(staffData.map(s => s.departemen).filter(d => d && d !== '-'))).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Staff Table - Mobile Friendly Cards WITH PHOTOS */}
      <div className="staff-table-wrapper">
        {filteredStaff.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <h3>Tidak Ada Data Staff</h3>
          </div>
        ) : (
          <div className="staff-cards">
            {filteredStaff.map((item, index) => {
              const hasAccount = usersAuth.some(a => 
                a.email?.toLowerCase() === item.email?.toLowerCase() ||
                a.fpId == item.id ||
                a.userId == item.id ||
                a.staffId == item.id
              );
              
              const hasActiveCode = allCodes.some(c => 
                !c.used && (c.type === 'guru' || c.type === 'staff') && c.linkedId == item.id
              );

              const hasWA = getStaffPhoneNumber(item);
              
              // Get staff photo
              const photoUrl = getStaffPhoto(item.id, item.nama, item.email);
              const userAuth = getUserAuthForStaff(item.id, item.nama, item.email);

              return (
                <div key={item.id || index} className="staff-card">
                  <div className="staff-card-header">
                    <div className="staff-card-name">
                      {/* NEW: Staff Avatar with Photo */}
                      <div className="staff-card-avatar-wrapper">
                        <img 
                          src={photoUrl} 
                          alt={item.nama || 'Staff'}
                          className="staff-card-avatar-img"
                          onError={(e) => {
                            const initial = item.nama ? item.nama.charAt(0).toUpperCase() : 'S';
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama || 'Staff')}&background=9b59b6&color=fff&size=64&bold=true`;
                          }}
                          style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: hasAccount ? '2px solid #4caf50' : '2px solid #ff9800'
                          }}
                        />
                        {hasAccount && (
                          <span className="staff-card-badge" title="Memiliki akun">✅</span>
                        )}
                      </div>
                      <div>
                        <div className="staff-card-title">{item.nama || '-'}</div>
                        <div className="staff-card-id">ID: {item.id}</div>
                        {userAuth && userAuth.photoUrl && userAuth.photoUrl !== 'null' && (
                          <div className="staff-card-photo-status" style={{ fontSize: '10px', color: '#4caf50' }}>
                            📸 Foto tersedia
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="jabatan-badge" style={{ background: getJabatanColor(item.jabatan) }}>
                      {getJabatanLabel(item.jabatan)}
                    </span>
                  </div>
                  
                  <div className="staff-card-body">
                    <div className="staff-card-row">
                      <span className="staff-card-label">📂 Departemen</span>
                      <span>{item.departemen || '-'}</span>
                    </div>
                    <div className="staff-card-row">
                      <span className="staff-card-label">📧 Email</span>
                      <span className="staff-email">{item.email || '-'}</span>
                    </div>
                    <div className="staff-card-row">
                      <span className="staff-card-label">📱 No HP</span>
                      <span className="staff-phone" style={{ color: hasWA ? '#25d366' : 'var(--text-muted)' }}>
                        {item.noHp || '-'}
                        {hasWA && <span> 📱</span>}
                      </span>
                    </div>
                    <div className="staff-card-row">
                      <span className="staff-card-label">📋 Status</span>
                      <span>
                        {hasAccount ? (
                          <span className="status-badge status-active">✅ Punya Akun</span>
                        ) : hasActiveCode ? (
                          <span className="status-badge status-waiting">⏳ Kode Aktif</span>
                        ) : (
                          <span className="status-badge status-inactive">⏳ Belum</span>
                        )}
                      </span>
                    </div>
                  </div>
                  
                  <div className="staff-card-actions">
                    {hasAccount && (
                      <button
                        className="btn-action btn-refresh-photo"
                        onClick={() => refreshStaffPhotoCache(item.id)}
                        title="Refresh Foto"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#4a90e2',
                          cursor: 'pointer',
                          fontSize: '14px',
                          padding: '4px 8px',
                          borderRadius: '4px'
                        }}
                      >
                        🔄
                      </button>
                    )}
                    {canGenerateCode && !hasAccount && (
                      <button
                        className="btn-action btn-generate"
                        onClick={() => openGenerateModal(item)}
                        disabled={hasActiveCode}
                        title="Generate Kode"
                      >
                        🔑
                      </button>
                    )}
                    {canManageStaff && (
                      <>
                        <button
                          className="btn-action btn-edit"
                          onClick={() => openEditModal(item)}
                          title="Edit Staff"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-action btn-delete"
                          onClick={() => handleDeleteStaff(item.id, item.nama)}
                          title="Hapus Staff"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="staff-footer">
        <span>🔄 Real-time</span>
        <span>📱 {new Date().toLocaleString('id-ID')}</span>
        {isDeveloper && (
          <span className="dev-footer">💻 Developer</span>
        )}
      </div>

      {/* ======================================== */}
      {/* MODAL TAMBAH/EDIT STAFF */}
      {/* ======================================== */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modalMode === 'add' ? '➕ Tambah Staff' : '✏️ Edit Staff'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>✖</button>
            </div>
            
            <form onSubmit={handleSubmitStaff} className="modal-form">
              <div className="modal-body-scroll">
                {formError && <div className="form-error">{formError}</div>}
                
                <div className="form-group">
                  <label>🆔 ID Staff *</label>
                  <input
                    type="text"
                    name="id"
                    value={formData.id}
                    onChange={handleFormChange}
                    placeholder="Contoh: STF-001, GURU-001"
                    required={modalMode === 'add'}
                    disabled={modalMode === 'edit'}
                    className={modalMode === 'edit' ? 'disabled-input' : ''}
                  />
                  {modalMode === 'add' ? (
                    <small>Masukkan ID unik untuk staff ini</small>
                  ) : (
                    <small>ID tidak dapat diubah saat edit</small>
                  )}
                </div>

                <div className="form-group">
                  <label>👤 Nama Lengkap *</label>
                  <input
                    type="text"
                    name="nama"
                    value={formData.nama}
                    onChange={handleFormChange}
                    placeholder="Masukkan nama lengkap"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>📋 Jabatan *</label>
                  <select
                    name="jabatan"
                    value={formData.jabatan}
                    onChange={handleFormChange}
                    required
                  >
                    <option value="guru">👨‍🏫 Guru</option>
                    <option value="staff_tu">📋 Staff TU</option>
                    <option value="wakil_kepala">👔 Wakil Kepala Sekolah</option>
                    <option value="kepala_sekolah">👑 Kepala Sekolah</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>📂 Departemen</label>
                  <input
                    type="text"
                    name="departemen"
                    value={formData.departemen}
                    onChange={handleFormChange}
                    placeholder="Contoh: Matematika, IPA, TU"
                  />
                </div>

                <div className="form-group">
                  <label>📧 Email</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleFormChange}
                    placeholder="email@sekolah.sch.id"
                  />
                  <small>Email akan digunakan untuk login</small>
                </div>

                <div className="form-group">
                  <label>📱 No WhatsApp *</label>
                  <input
                    type="text"
                    name="noHp"
                    value={formData.noHp}
                    onChange={handleFormChange}
                    placeholder="08123456789"
                    required
                  />
                  <small>Nomor WhatsApp untuk notifikasi absensi</small>
                </div>

                <div className="form-group">
                  <label>👤 Jenis Kelamin</label>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleFormChange}
                  >
                    <option value="Laki-laki">👨 Laki-laki</option>
                    <option value="Perempuan">👩 Perempuan</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>📍 Alamat</label>
                  <textarea
                    name="alamat"
                    value={formData.alamat}
                    onChange={handleFormChange}
                    placeholder="Masukkan alamat lengkap"
                    rows="2"
                  />
                </div>
              </div>
              
              <div className="modal-footer-sticky">
                <button 
                  type="button" 
                  className="btn-cancel" 
                  onClick={() => setShowModal(false)}
                >
                  ✖ Batal
                </button>
                <button 
                  type="submit" 
                  className="btn-save" 
                  disabled={formLoading}
                >
                  {formLoading ? '⏳ Menyimpan...' : (modalMode === 'add' ? '💾 Simpan Staff' : '💾 Update Staff')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Generate Kode */}
      {showGenerateModal && selectedStaffForCode && (
        <div className="modal-overlay" onClick={() => setShowGenerateModal(false)}>
          <div className="modal-box modal-generate" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔑 Generate Kode</h3>
              <button className="modal-close" onClick={() => setShowGenerateModal(false)}>✖</button>
            </div>
            <div className="modal-body">
              <div className="generate-info">
                <p><strong>👤 Staff:</strong> {selectedStaffForCode.nama}</p>
                <p><strong>📧 Email:</strong> {selectedStaffForCode.email || '-'}</p>
                <p><strong>📱 No HP:</strong> {selectedStaffForCode.noHp || '-'}</p>
                <p><strong>👔 Jabatan:</strong> {getJabatanLabel(selectedStaffForCode.jabatan)}</p>
                <p><strong>🆔 ID:</strong> {selectedStaffForCode.id}</p>
              </div>

              {generatedCode ? (
                <div className="generated-code-display">
                  <p>✅ Kode berhasil dibuat:</p>
                  <div className="code-box">{generatedCode}</div>
                  <button 
                    className="btn-copy-code"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedCode);
                      showToast('📋 Kode disalin!', 'success');
                    }}
                  >
                    📋 Salin
                  </button>
                </div>
              ) : (
                <div className="generate-action">
                  <p>⚠️ Staff ini belum memiliki kode registrasi.</p>
                  <button 
                    className="btn-generate-code"
                    onClick={handleGenerateCode}
                    disabled={generatingCode}
                  >
                    {generatingCode ? '⏳' : '🚀 Generate'}
                  </button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-close" onClick={() => setShowGenerateModal(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffTab;