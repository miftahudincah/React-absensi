// src/pages/Dashboard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { signOut } from 'firebase/auth';
import { ref, onValue, set, get } from 'firebase/database';
import { auth, db } from '../firebase/config';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import DashboardContent from '../components/DashboardContent';
// Import tabs
import AttendanceTab from './tabs/AttendanceTab';
import StaffAttendanceTab from './tabs/StaffAttendanceTab';
import StudentsTab from './tabs/StudentsTab';
import StaffTab from './tabs/StaffTab';
import UsersTab from './tabs/UsersTab';
import RekapTab from './tabs/RekapTab';
import ConfigTab from './tabs/ConfigTab';
import ProfileTab from './tabs/ProfileTab';
// Import new tabs
import FriendsTab from './tabs/FriendsTab';
import ChatTab from './tabs/ChatTab';
import StatusTab from './tabs/StatusTab';
// ⭐ IMPORT IZIN TAB ⭐
import IzinTab from './tabs/IzinTab';
// ⭐ IMPORT ANNOUNCEMENT TAB ⭐
import AnnouncementsTab from './tabs/AnnouncementsTab';
// ⭐ IMPORT AI TAB ⭐
import AITab from './tabs/AITab';
// ⭐ IMPORT LOGS TAB ⭐
import LogsTab from './tabs/LogsTab';
import './Dashboard.css';

// ==================== IMPORT ATTENDANCE REMINDER ====================
import attendanceReminder from '../utils/AttendanceReminder';

// Konfigurasi API
const API_BASE_URL = 'https://backendtest-azure.vercel.app';

const Dashboard = ({ user, onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [schoolName, setSchoolName] = useState('Sistem Absensi');
  const [schoolLogo, setSchoolLogo] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [studentInfo, setStudentInfo] = useState({
    kelas: '',
    jurusan: ''
  });
  const [stats, setStats] = useState({
    totalStudents: 0,
    hadirToday: 0,
    tidakHadir: 0,
    terlambat: 0
  });
  const [dbData, setDbData] = useState({
    users: [],
    attendance: []
  });
  
  // ==================== STATUS STATE ====================
  const [statusUnviewedCount, setStatusUnviewedCount] = useState(0);
  const [statusInitialized, setStatusInitialized] = useState(false);
  
  // ==================== IZIN STATE ====================
  const [izinPendingCount, setIzinPendingCount] = useState(0);
  const [izinInitialized, setIzinInitialized] = useState(false);
  
  // ==================== ANNOUNCEMENT STATE ====================
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0);
  const [announcementInitialized, setAnnouncementInitialized] = useState(false);
  
  // ==================== STATE UNTUK REMINDER ====================
  const [reminderStats, setReminderStats] = useState({
    total: 0,
    sent: 0,
    pending: 0
  });
  const [reminderLoading, setReminderLoading] = useState(false);
  const [lastReminderCheck, setLastReminderCheck] = useState(null);

  // ==================== CHECK STATUS ACCESS ====================
  const hasStatusAccess = useCallback((userData) => {
    return !!userData?.uid;
  }, []);

  // ==================== CHECK IZIN ACCESS ====================
  const hasIzinAccess = useCallback((userData) => {
    return !!userData?.uid;
  }, []);

  // ==================== CHECK ANNOUNCEMENT ACCESS ====================
  const hasAnnouncementAccess = useCallback((userData) => {
    return !!userData?.uid;
  }, []);

  // ==================== CHECK AI ACCESS ====================
  const hasAIAccess = useCallback((userData) => {
    if (!userData?.uid) return false;
    const allowedRoles = ['developer', 'admin'];
    return allowedRoles.includes(userData?.role);
  }, []);

  // ==================== CHECK LOGS ACCESS ====================
  const hasLogsAccess = useCallback((userData) => {
    if (!userData?.uid) return false;
    const allowedRoles = ['developer', 'admin'];
    return allowedRoles.includes(userData?.role);
  }, []);

  // ==================== AMBIL DATA SISWA (KELAS & JURUSAN) ====================
  
  useEffect(() => {
    if (user?.role === 'siswa' && user?.fpId) {
      const studentRef = ref(db, `users/${user.fpId}`);
      const unsubscribe = onValue(studentRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          console.log('📚 Student data loaded:', data);
          setStudentInfo({
            kelas: data.kelas || '',
            jurusan: data.jurusan || ''
          });
          
          if (user) {
            user.kelas = data.kelas || '';
            user.jurusan = data.jurusan || '';
            const savedUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
            savedUser.kelas = data.kelas || '';
            savedUser.jurusan = data.jurusan || '';
            localStorage.setItem('currentUser', JSON.stringify(savedUser));
          }
        }
      });
      
      return () => unsubscribe();
    }
    
    if (user?.role === 'siswa' && !user?.fpId) {
      const usersRef = ref(db, 'users');
      const unsubscribe = onValue(usersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          for (const [id, student] of Object.entries(data)) {
            if (student.nama === user.nama || student.email === user.email) {
              console.log('📚 Student found by name/email:', student);
              setStudentInfo({
                kelas: student.kelas || '',
                jurusan: student.jurusan || ''
              });
              if (user) {
                user.kelas = student.kelas || '';
                user.jurusan = student.jurusan || '';
                user.fpId = id;
                const savedUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
                savedUser.kelas = student.kelas || '';
                savedUser.jurusan = student.jurusan || '';
                savedUser.fpId = id;
                localStorage.setItem('currentUser', JSON.stringify(savedUser));
              }
              break;
            }
          }
        }
      });
      return () => unsubscribe();
    }
  }, [user]);

  // ==================== TOKEN MANAGEMENT ====================
  
  const getAuthToken = useCallback(async () => {
    if (auth.currentUser) {
      try {
        console.log('🔑 Getting fresh token from Firebase...');
        const token = await auth.currentUser.getIdToken(true);
        localStorage.setItem('authToken', token);
        console.log('✅ Fresh token obtained from Firebase (length: ' + token.length + ')');
        return token;
      } catch (error) {
        console.error('❌ Failed to get Firebase token:', error);
        try {
          const token = await auth.currentUser.getIdToken(false);
          localStorage.setItem('authToken', token);
          console.log('✅ Firebase token obtained (cached)');
          return token;
        } catch (retryError) {
          console.error('❌ Failed to get Firebase token on retry:', retryError);
        }
      }
    }
    
    const token = localStorage.getItem('authToken');
    if (token) {
      console.log('📦 Token from localStorage (length: ' + token.length + ')');
      return token;
    }
    
    console.warn('⚠️ No token available');
    return null;
  }, []);

  const verifyToken = useCallback(async (token) => {
    if (!token) return false;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        console.log('✅ Token verified with backend');
        return true;
      } else {
        console.warn('⚠️ Token verification failed with status:', response.status);
        return false;
      }
    } catch (error) {
      console.warn('⚠️ Token verification error:', error.message);
      return true;
    }
  }, []);

  // ==================== PHOTO MANAGEMENT ====================
  
  const getOldPhotoUrl = useCallback(async (uid) => {
    try {
      console.log('📸 Getting old photo URL for uid:', uid);
      const photoRef = ref(db, `users_auth/${uid}/photoUrl`);
      const snapshot = await get(photoRef);
      const photo = snapshot.val();
      console.log('📸 Old photo URL:', photo ? 'Found' : 'Not found');
      return photo;
    } catch (error) {
      console.error('❌ Error getting old photo:', error);
      return null;
    }
  }, []);

  const deletePhotoFromSupabase = useCallback(async (photoUrl) => {
    if (!photoUrl) return true;
    if (!photoUrl.includes('supabase.co')) {
      console.log('Not a Supabase URL, skipping delete');
      return true;
    }
    
    try {
      const token = await getAuthToken();
      if (!token) {
        console.warn('⚠️ No token for delete, skipping');
        return false;
      }
      
      console.log('🗑️ Deleting old photo from Supabase...');
      const response = await fetch(`${API_BASE_URL}/api/storage/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fileUrl: photoUrl }),
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Old photo deleted from Supabase');
        return true;
      } else {
        console.warn('⚠️ Failed to delete old photo:', result.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Error deleting photo:', error);
      return false;
    }
  }, [getAuthToken]);

  const uploadProfilePhoto = useCallback(async (file) => {
    if (!file) return;
    if (!user?.uid) {
      window.alert('User tidak ditemukan!');
      return;
    }
    
    if (!file.type.match('image.*')) {
      window.alert('Hanya file gambar yang diperbolehkan!');
      return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
      window.alert('Ukuran gambar maksimal 2MB!');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      console.log('📤 Starting profile photo upload...');
      
      const oldPhotoUrl = await getOldPhotoUrl(user.uid);
      if (oldPhotoUrl && oldPhotoUrl !== 'null' && oldPhotoUrl !== 'undefined') {
        console.log('📸 Old photo found');
      } else {
        console.log('📸 No old photo found');
      }

      setUploadProgress(20);

      const token = await getAuthToken();
      if (!token) {
        throw new Error('Tidak dapat memperoleh token autentikasi. Silakan logout dan login kembali.');
      }
      console.log('🔑 Token obtained for upload (length: ' + token.length + ')');

      const isValid = await verifyToken(token);
      if (!isValid) {
        console.warn('⚠️ Token verification failed, refreshing...');
        if (auth.currentUser) {
          const newToken = await auth.currentUser.getIdToken(true);
          localStorage.setItem('authToken', newToken);
          console.log('🔄 Token refreshed');
        }
      }

      setUploadProgress(40);

      const formData = new FormData();
      formData.append('image', file);
      formData.append('userId', user.uid);
      formData.append('folder', 'profiles');

      console.log('📤 Uploading to:', `${API_BASE_URL}/api/upload`);
      
      let uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      setUploadProgress(70);

      if (uploadResponse.status === 401) {
        console.warn('⚠️ Token expired, refreshing and retrying...');
        
        if (auth.currentUser) {
          const newToken = await auth.currentUser.getIdToken(true);
          localStorage.setItem('authToken', newToken);
          console.log('🔄 Token refreshed, retrying upload...');
          
          uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${newToken}`,
            },
            body: formData,
          });
        } else {
          throw new Error('User tidak terautentikasi untuk refresh token');
        }
      }

      if (!uploadResponse.ok) {
        let errorMessage = `Upload gagal (${uploadResponse.status})`;
        try {
          const errorData = await uploadResponse.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          const errorText = await uploadResponse.text();
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const uploadResult = await uploadResponse.json();

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Upload failed');
      }

      const newPhotoUrl = uploadResult.data.url;
      console.log('✅ New photo URL obtained');

      setUploadProgress(85);

      if (oldPhotoUrl && oldPhotoUrl !== 'null' && oldPhotoUrl !== 'undefined' && oldPhotoUrl.includes('supabase.co')) {
        console.log('🗑️ Deleting old photo...');
        await deletePhotoFromSupabase(oldPhotoUrl);
      }

      await set(ref(db, `users_auth/${user.uid}/photoUrl`), newPhotoUrl);
      console.log('✅ New photo URL saved to Firebase');

      setProfilePhoto(newPhotoUrl);
      
      const savedUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      savedUser.photoUrl = newPhotoUrl;
      localStorage.setItem('currentUser', JSON.stringify(savedUser));
      
      setUploadProgress(100);

      window.alert('✅ Foto profil berhasil diperbarui!');
      
    } catch (error) {
      console.error('❌ Upload error:', error);
      window.alert('❌ Gagal upload foto: ' + error.message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [user, getAuthToken, verifyToken, deletePhotoFromSupabase, getOldPhotoUrl]);

  const handleProfilePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      uploadProfilePhoto(file);
    }
    e.target.value = '';
  };

  // ==================== LOGOUT ====================
  
  const handleLogout = async () => {
    try {
      if (attendanceReminder && attendanceReminder.isRunning) {
        attendanceReminder.stop();
        console.log('⏰ Attendance reminder stopped on logout');
      }
      
      if (window.cleanupStatusSystem) {
        window.cleanupStatusSystem();
        console.log('📸 Status system cleaned up on logout');
      }
      
      if (window._announcementUnsubscribe) {
        window._announcementUnsubscribe();
        window._announcementUnsubscribe = null;
        console.log('📢 Announcement system cleaned up on logout');
      }
      
      await signOut(auth);
      localStorage.removeItem('authToken');
      localStorage.removeItem('currentUser');
      if (onLogout) onLogout();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    
    window.dispatchEvent(new CustomEvent('tabChange', {
      detail: { tab: tabId }
    }));
  };

  // ==================== HANDLE STATUS UPDATE ====================
  const handleStatusUpdate = useCallback((count) => {
    setStatusUnviewedCount(count);
    
    window.dispatchEvent(new CustomEvent('statusBadgeUpdate', {
      detail: { count }
    }));
  }, []);

  // ==================== HANDLE IZIN UPDATE ====================
  const handleIzinUpdate = useCallback((count) => {
    setIzinPendingCount(count);
    
    window.dispatchEvent(new CustomEvent('izinBadgeUpdate', {
      detail: { count }
    }));
  }, []);

  // ==================== HANDLE ANNOUNCEMENT UPDATE ====================
  const handleAnnouncementUpdate = useCallback((count) => {
    setAnnouncementUnreadCount(count);
    
    window.dispatchEvent(new CustomEvent('announcementBadgeUpdate', {
      detail: { count }
    }));
  }, []);

  // ==================== HANDLER START CHAT FROM FRIENDS ====================
  const handleStartChatFromFriends = useCallback((friendUid, friendName, friendEmail) => {
    console.log('💬 Starting chat from friends:', friendName, friendUid);
    
    setActiveTab('chat');
    
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('startChatWithFriend', {
        detail: {
          friendUid,
          friendName,
          friendEmail
        }
      }));
    }, 300);
  }, []);

  // ==================== REMINDER FUNCTIONS ====================
  
  const getReminderStats = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const reminderRef = ref(db, 'attendance_reminders');
      const snapshot = await get(reminderRef);
      const data = snapshot.val();
      
      let total = 0;
      let sent = 0;
      
      if (data) {
        for (const [userId, reminders] of Object.entries(data)) {
          for (const [key, reminder] of Object.entries(reminders)) {
            if (reminder.date === today) {
              total++;
              if (reminder.sent) sent++;
            }
          }
        }
      }
      
      setReminderStats({
        total,
        sent,
        pending: total - sent
      });
      
      setLastReminderCheck(new Date());
      
      return { total, sent, pending: total - sent };
    } catch (error) {
      console.error('❌ Error getting reminder stats:', error);
      return null;
    }
  }, []);

  const handleManualReminder = useCallback(async () => {
    const hasPermission = ['developer', 'admin', 'wakil_kepala', 'guru', 'staff_tu'].includes(user?.role);
    
    if (!hasPermission) {
      window.alert('❌ Anda tidak memiliki akses untuk mengirim pengingat!');
      return;
    }

    setReminderLoading(true);
    
    try {
      console.log('🔔 Manually triggering attendance reminder...');
      await attendanceReminder.triggerReminderManually();
      
      setTimeout(() => {
        getReminderStats();
      }, 3000);
      
      window.alert('✅ Pengingat absensi telah dikirim!');
    } catch (error) {
      console.error('❌ Error triggering reminder:', error);
      window.alert('❌ Gagal mengirim pengingat: ' + error.message);
    } finally {
      setReminderLoading(false);
    }
  }, [user, getReminderStats]);

  // ==================== STATUS INITIALIZATION ====================
  const initializeStatus = useCallback(() => {
    if (statusInitialized) return;
    if (!user || !hasStatusAccess(user)) return;

    try {
      console.log('📸 Initializing Status system in Dashboard...');
      
      window.dispatchEvent(new CustomEvent('uiReady', {
        detail: { currentUser: user }
      }));
      
      setStatusInitialized(true);
      console.log('✅ Status system initialized in Dashboard');
    } catch (error) {
      console.error('❌ Failed to initialize Status system:', error);
    }
  }, [user, hasStatusAccess, statusInitialized]);

  // ==================== IZIN INITIALIZATION ====================
  const initializeIzin = useCallback(() => {
    if (izinInitialized) return;
    if (!user || !hasIzinAccess(user)) return;

    try {
      console.log('📝 Initializing Izin system in Dashboard...');
      
      // Dapatkan count izin pending
      const izinRef = ref(db, 'izin');
      const unsubscribe = onValue(izinRef, (snapshot) => {
        const data = snapshot.val();
        let pending = 0;
        
        if (data) {
          const userRole = user?.role;
          const userUid = user?.uid;
          
          for (const [key, izin] of Object.entries(data)) {
            // Jika siswa, hanya hitung izin miliknya yang pending
            if (userRole === 'siswa') {
              if (izin.studentId == userUid || izin.studentId == user.fpId) {
                if (izin.status === 'pending') pending++;
              }
            } 
            // Jika guru/staff/admin/developer, hitung semua izin yang pending
            else if (['guru', 'staff_tu', 'wakil_kepala', 'admin', 'developer'].includes(userRole)) {
              if (izin.status === 'pending') pending++;
            }
          }
        }
        
        setIzinPendingCount(pending);
        handleIzinUpdate(pending);
      });
      
      if (window._izinUnsubscribe) {
        window._izinUnsubscribe();
      }
      window._izinUnsubscribe = unsubscribe;
      
      setIzinInitialized(true);
      console.log('✅ Izin system initialized in Dashboard');
    } catch (error) {
      console.error('❌ Failed to initialize Izin system:', error);
    }
  }, [user, hasIzinAccess, izinInitialized, handleIzinUpdate]);

  // ==================== ANNOUNCEMENT INITIALIZATION ====================
  const initializeAnnouncement = useCallback(() => {
    if (announcementInitialized) return;
    if (!user || !hasAnnouncementAccess(user)) return;

    try {
      console.log('📢 Initializing Announcement system in Dashboard...');
      
      // Dapatkan count pengumuman belum dibaca
      const announcementsRef = ref(db, 'announcements');
      const unsubscribe = onValue(announcementsRef, (snapshot) => {
        const data = snapshot.val();
        let unread = 0;
        const now = Date.now();
        const userRole = user?.role;
        const userUid = user?.uid;
        
        if (data) {
          for (const [key, announcement] of Object.entries(data)) {
            // Cek apakah pengumuman masih aktif
            if (announcement.expiryDate) {
              const expiryDate = new Date(announcement.expiryDate).getTime();
              if (now > expiryDate) continue;
            }
            
            // Cek apakah pengumuman sudah dibaca oleh user
            if (announcement.readBy && announcement.readBy[userUid]) {
              continue;
            }
            
            // Cek apakah pengumuman untuk role user
            if (announcement.targetRoles && announcement.targetRoles.length > 0) {
              if (!announcement.targetRoles.includes(userRole)) {
                continue;
              }
            }
            
            unread++;
          }
        }
        
        setAnnouncementUnreadCount(unread);
        handleAnnouncementUpdate(unread);
        
        console.log('📢 Announcement unread count updated:', unread);
      });
      
      if (window._announcementUnsubscribe) {
        window._announcementUnsubscribe();
      }
      window._announcementUnsubscribe = unsubscribe;
      
      setAnnouncementInitialized(true);
      console.log('✅ Announcement system initialized in Dashboard');
    } catch (error) {
      console.error('❌ Failed to initialize Announcement system:', error);
    }
  }, [user, hasAnnouncementAccess, announcementInitialized, handleAnnouncementUpdate]);

  // ==================== UPDATE STATS ====================
  
  const updateStats = useCallback((users, attendance) => {
    try {
      let students = users || dbData.users || [];
      let attendanceData = attendance || dbData.attendance || [];
      
      const isSiswa = user?.role === 'siswa';
      if (isSiswa) {
        const userKelas = studentInfo.kelas || user?.kelas || '';
        const userJurusan = studentInfo.jurusan || user?.jurusan || '';
        
        console.log('🔍 FILTER STATS - Kelas:', userKelas, 'Jurusan:', userJurusan);
        
        if (userKelas) {
          students = students.filter(s => s.kelas === userKelas);
        }
        if (userJurusan) {
          students = students.filter(s => s.jurusan === userJurusan);
        }
        
        if (userKelas) {
          attendanceData = attendanceData.filter(a => a.kelas === userKelas);
        }
        if (userJurusan) {
          attendanceData = attendanceData.filter(a => a.jurusan === userJurusan);
        }
        
        console.log('📊 Filtered students:', students.length);
        console.log('📊 Filtered attendance:', attendanceData.length);
      }
      
      const today = new Date().toISOString().split('T')[0];
      
      const todayAttendance = attendanceData.filter(a => a.date === today);
      const hadirSet = new Set();
      const terlambatSet = new Set();
      let hadir = 0;
      let terlambat = 0;
      
      todayAttendance.forEach(record => {
        if (record.status === 'Hadir' || record.status === 'Pulang') {
          if (!hadirSet.has(record.studentId)) {
            hadirSet.add(record.studentId);
            hadir++;
          }
          if (record.timeIn && record.timeIn > '07:30') {
            terlambatSet.add(record.studentId);
          }
        }
      });
      terlambat = terlambatSet.size;
      
      const totalStudents = students.length;
      const tidakHadir = totalStudents - hadir;
      
      setStats({
        totalStudents,
        hadirToday: hadir,
        tidakHadir: tidakHadir > 0 ? tidakHadir : 0,
        terlambat
      });
    } catch (error) {
      console.error('Error updating stats:', error);
    }
  }, [dbData.users, dbData.attendance, user, studentInfo]);

  // ==================== RENDER CONTENT ====================
  
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardContent 
          stats={stats} 
          user={user} 
          profilePhoto={profilePhoto}
          onStatusUpdate={handleStatusUpdate}
          onTabChange={handleTabChange}
        />;
      case 'profile':
        return <ProfileTab user={user} />;
      case 'status':
        return <StatusTab user={user} onStatusUpdate={handleStatusUpdate} />;
      case 'friends':
        return <FriendsTab user={user} onStartChat={handleStartChatFromFriends} />;
      case 'chat':
        return <ChatTab user={user} />;
      // ⭐ ANNOUNCEMENT TAB ⭐
      case 'announcements':
        return <AnnouncementsTab user={user} />;
      // ⭐ AI TAB ⭐
      case 'ai':
        return <AITab user={user} />;
      // ⭐ LOGS TAB ⭐
      case 'logs':
        return <LogsTab user={user} />;
      case 'attendance':
        return <AttendanceTab user={user} />;
      case 'staff-attendance':
        return <StaffAttendanceTab user={user} />;
      case 'students':
        return <StudentsTab user={user} />;
      case 'staff':
        return <StaffTab user={user} />;
      case 'users':
        return <UsersTab user={user} />;
      case 'rekap':
        return <RekapTab user={user} />;
      case 'config':
        return <ConfigTab user={user} />;
      // ⭐ IZIN ONLINE TAB ⭐
      case 'izin':
        return <IzinTab user={user} />;
      default:
        return (
          <div className="tab-content">
            <h2>📄 Halaman {activeTab}</h2>
            <p>Konten untuk {activeTab} akan segera ditambahkan.</p>
          </div>
        );
    }
  };

  // ==================== USE EFFECT ====================

  useEffect(() => {
    console.log('📊 Dashboard mounted, user:', user?.uid);
    
    if (!user) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    try {
      // Initialize Status system if user has access
      if (hasStatusAccess(user)) {
        setTimeout(() => {
          initializeStatus();
        }, 1500);
      }

      // ⭐ INITIALIZE IZIN SYSTEM ⭐
      if (hasIzinAccess(user)) {
        setTimeout(() => {
          initializeIzin();
        }, 1800);
      }

      // ⭐ INITIALIZE ANNOUNCEMENT SYSTEM ⭐
      if (hasAnnouncementAccess(user)) {
        setTimeout(() => {
          initializeAnnouncement();
        }, 2000);
      }

      // 1. Ambil Nama Sekolah
      const schoolNameRef = ref(db, 'system_config/schoolName');
      const unsubscribeSchoolName = onValue(schoolNameRef, (snapshot) => {
        if (!isMounted) return;
        const name = snapshot.val();
        if (name) setSchoolName(name);
        console.log('🏫 School name loaded:', name);
      });

      // 2. Ambil Logo Sekolah
      const schoolLogoRef = ref(db, 'system_config/schoolLogo');
      const unsubscribeSchoolLogo = onValue(schoolLogoRef, (snapshot) => {
        if (!isMounted) return;
        const logo = snapshot.val();
        if (logo && logo !== 'null' && logo !== 'undefined') {
          setSchoolLogo(logo);
        }
        console.log('🖼️ School logo loaded:', logo ? 'Yes' : 'No');
      });

      // 3. Ambil Foto Profil User
      let unsubscribeUserPhoto = null;
      if (user.uid) {
        const userPhotoRef = ref(db, `users_auth/${user.uid}/photoUrl`);
        unsubscribeUserPhoto = onValue(userPhotoRef, (snapshot) => {
          if (!isMounted) return;
          const photo = snapshot.val();
          if (photo && photo !== 'null' && photo !== 'undefined') {
            setProfilePhoto(photo);
          }
          console.log('👤 Profile photo loaded:', photo ? 'Yes' : 'No');
        });
      }

      // 4. Ambil Data Siswa (users)
      const usersRef = ref(db, 'users');
      const unsubscribeUsers = onValue(usersRef, (snapshot) => {
        if (!isMounted) return;
        const data = snapshot.val();
        const usersList = [];
        if (data) {
          Object.keys(data).forEach(key => {
            usersList.push({ id: key, ...data[key] });
          });
        }
        setDbData(prev => ({ ...prev, users: usersList }));
        updateStats(usersList, dbData.attendance);
        console.log('👥 Users loaded:', usersList.length);
        
        if (isMounted) {
          setLoading(false);
        }
      });

      // 5. Ambil Data Absensi
      const attendanceRef = ref(db, 'absensi');
      const unsubscribeAttendance = onValue(attendanceRef, (snapshot) => {
        if (!isMounted) return;
        const data = snapshot.val();
        const attendanceList = [];
        if (data) {
          Object.keys(data).forEach(date => {
            const dailyRecords = data[date];
            if (dailyRecords) {
              Object.keys(dailyRecords).forEach(id => {
                const record = dailyRecords[id];
                if (record) {
                  attendanceList.push({
                    id: date + "-" + id,
                    studentId: id,
                    date: date,
                    timeIn: record.in,
                    timeOut: record.out,
                    nama: record.nama,
                    kelas: record.kelas,
                    jurusan: record.jurusan,
                    status: (record.out) ? "Pulang" : "Hadir",
                    timestamp: record.timestamp || Date.now()
                  });
                }
              });
            }
          });
        }
        attendanceList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setDbData(prev => ({ ...prev, attendance: attendanceList }));
        updateStats(dbData.users, attendanceList);
        console.log('📋 Attendance loaded:', attendanceList.length);
      });

      // 6. Get reminder stats if user has permission
      const hasReminderPermission = ['developer', 'admin', 'wakil_kepala', 'guru', 'staff_tu'].includes(user?.role);
      if (hasReminderPermission) {
        setTimeout(() => {
          getReminderStats();
        }, 3000);
      }

      // 7. Listen for status badge updates
      const handleStatusBadgeUpdate = (e) => {
        if (e.detail && typeof e.detail.count === 'number') {
          setStatusUnviewedCount(e.detail.count);
        }
      };
      window.addEventListener('statusBadgeUpdate', handleStatusBadgeUpdate);

      // 8. Listen for izin badge updates
      const handleIzinBadgeUpdate = (e) => {
        if (e.detail && typeof e.detail.count === 'number') {
          setIzinPendingCount(e.detail.count);
        }
      };
      window.addEventListener('izinBadgeUpdate', handleIzinBadgeUpdate);

      // 9. Listen for announcement badge updates
      const handleAnnouncementBadgeUpdate = (e) => {
        if (e.detail && typeof e.detail.count === 'number') {
          setAnnouncementUnreadCount(e.detail.count);
        }
      };
      window.addEventListener('announcementBadgeUpdate', handleAnnouncementBadgeUpdate);

      // Cleanup function
      return () => {
        isMounted = false;
        unsubscribeSchoolName();
        unsubscribeSchoolLogo();
        if (unsubscribeUserPhoto) unsubscribeUserPhoto();
        unsubscribeUsers();
        unsubscribeAttendance();
        window.removeEventListener('statusBadgeUpdate', handleStatusBadgeUpdate);
        window.removeEventListener('izinBadgeUpdate', handleIzinBadgeUpdate);
        window.removeEventListener('announcementBadgeUpdate', handleAnnouncementBadgeUpdate);
        console.log('🧹 Dashboard unmounted, listeners removed');
      };

    } catch (error) {
      console.error('❌ Error setting up Firebase listeners:', error);
      setLoading(false);
      return () => {};
    }
  }, [user, updateStats, dbData.users, dbData.attendance, getReminderStats, hasStatusAccess, initializeStatus, hasIzinAccess, initializeIzin, hasAnnouncementAccess, initializeAnnouncement]);

  // ==================== RENDER ====================
  
  const isSiswa = user?.role === 'siswa';
  const userKelas = studentInfo.kelas || user?.kelas || '-';
  const userJurusan = studentInfo.jurusan || user?.jurusan || '-';
  const hasReminderPermission = ['developer', 'admin', 'wakil_kepala', 'guru', 'staff_tu'].includes(user?.role);
  const hasStatusAccessUser = hasStatusAccess(user);
  const hasIzinAccessUser = hasIzinAccess(user);
  const hasAnnouncementAccessUser = hasAnnouncementAccess(user);
  const hasAIAccessUser = hasAIAccess(user);
  const hasLogsAccessUser = hasLogsAccess(user);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Memuat data...</p>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '8px' }}>
          Menghubungkan ke Firebase...
        </p>
        {statusInitialized && (
          <p style={{ fontSize: '12px', color: 'rgba(255,107,107,0.6)', marginTop: '4px' }}>
            📸 Status system siap digunakan
          </p>
        )}
        {izinInitialized && (
          <p style={{ fontSize: '12px', color: 'rgba(255,152,0,0.6)', marginTop: '4px' }}>
            📝 Izin Online siap digunakan
          </p>
        )}
        {announcementInitialized && (
          <p style={{ fontSize: '12px', color: 'rgba(0,188,212,0.6)', marginTop: '4px' }}>
            📢 Pengumuman siap digunakan
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <Sidebar
        user={user}
        schoolName={schoolName}
        schoolLogo={schoolLogo}
        profilePhoto={profilePhoto}
        activeTab={activeTab}
        sidebarOpen={sidebarOpen}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
        onToggleSidebar={toggleSidebar}
      />

      <main className="main-content">
        <Header
          user={user}
          schoolName={schoolName}
          schoolLogo={schoolLogo}
          profilePhoto={profilePhoto}
          onToggleSidebar={toggleSidebar}
          onProfilePhotoChange={handleProfilePhotoChange}
          uploading={uploading}
          uploadProgress={uploadProgress}
          statusUnviewedCount={statusUnviewedCount}
          izinPendingCount={izinPendingCount}
          announcementUnreadCount={announcementUnreadCount}
        />
        
        <div className="main-body">
          {/* Banner info untuk siswa */}
          {isSiswa && (
            <div className="student-info-banner" style={{
              background: 'linear-gradient(135deg, rgba(0,188,212,0.15), rgba(0,188,212,0.05))',
              borderRadius: '16px',
              padding: '14px 20px',
              marginBottom: '20px',
              border: '1px solid rgba(0,188,212,0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              flexWrap: 'wrap'
            }}>
              <span style={{ fontSize: '28px' }}>👨‍🎓</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 'bold', fontSize: '14px' }}>Kelas:</span>
                <span style={{ color: '#00bcd4', fontWeight: 'bold', fontSize: '16px' }}>
                  {userKelas !== '-' ? userKelas : 'Belum ditentukan'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>|</span>
                <span style={{ fontWeight: 'bold', fontSize: '14px' }}>Jurusan:</span>
                <span style={{ color: '#00bcd4', fontWeight: 'bold', fontSize: '16px' }}>
                  {userJurusan !== '-' ? userJurusan : 'Belum ditentukan'}
                </span>
              </div>
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
                📊 Dashboard menampilkan data untuk kelas Anda
              </span>
            </div>
          )}

          {/* ==================== PENGUMUMAN BANNER ==================== */}
          {hasAnnouncementAccessUser && (
            <div className="announcement-banner" style={{
              background: `linear-gradient(135deg, ${announcementUnreadCount > 0 ? 'rgba(0,188,212,0.15)' : 'rgba(76,175,80,0.08)'}, rgba(0,188,212,0.04))`,
              borderRadius: '12px',
              padding: '12px 18px',
              marginBottom: '20px',
              border: `1px solid ${announcementUnreadCount > 0 ? 'rgba(0,188,212,0.3)' : 'rgba(76,175,80,0.2)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => handleTabChange('announcements')}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `linear-gradient(135deg, ${announcementUnreadCount > 0 ? 'rgba(0,188,212,0.25)' : 'rgba(76,175,80,0.15)'}, rgba(0,188,212,0.08))`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `linear-gradient(135deg, ${announcementUnreadCount > 0 ? 'rgba(0,188,212,0.15)' : 'rgba(76,175,80,0.08)'}, rgba(0,188,212,0.04))`;
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '24px' }}>📢</span>
              <div>
                <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
                  Pengumuman
                  {announcementUnreadCount > 0 && (
                    <span style={{ 
                      marginLeft: '8px',
                      background: '#00bcd4',
                      color: 'white',
                      padding: '1px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 'bold'
                    }}>
                      {announcementUnreadCount} baru
                    </span>
                  )}
                </span>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {announcementUnreadCount > 0 
                    ? `🔔 ${announcementUnreadCount} pengumuman belum dibaca` 
                    : '✅ Semua pengumuman telah dibaca'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>→</span>
            </div>
          </div>
          )}

          {/* ==================== IZIN ONLINE BANNER - SEMUA USER ==================== */}
          {hasIzinAccessUser && (
            <div className="izin-banner" style={{
              background: `linear-gradient(135deg, ${izinPendingCount > 0 ? 'rgba(255,152,0,0.15)' : 'rgba(76,175,80,0.08)'}, rgba(255,152,0,0.04))`,
              borderRadius: '12px',
              padding: '12px 18px',
              marginBottom: '20px',
              border: `1px solid ${izinPendingCount > 0 ? 'rgba(255,152,0,0.3)' : 'rgba(76,175,80,0.2)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => handleTabChange('izin')}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `linear-gradient(135deg, ${izinPendingCount > 0 ? 'rgba(255,152,0,0.25)' : 'rgba(76,175,80,0.15)'}, rgba(255,152,0,0.08))`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `linear-gradient(135deg, ${izinPendingCount > 0 ? 'rgba(255,152,0,0.15)' : 'rgba(76,175,80,0.08)'}, rgba(255,152,0,0.04))`;
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '24px' }}>📝</span>
              <div>
                <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
                  Izin Online
                  {izinPendingCount > 0 && (
                    <span style={{ 
                      marginLeft: '8px',
                      background: '#ff9800',
                      color: 'white',
                      padding: '1px 10px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 'bold'
                    }}>
                      {izinPendingCount} pending
                    </span>
                  )}
                </span>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {izinPendingCount > 0 
                    ? `🔔 ${izinPendingCount} pengajuan izin menunggu persetujuan` 
                    : '✅ Tidak ada izin pending'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>→</span>
            </div>
          </div>
          )}

        {renderContent()}
      </div>
    </main>
  </div>
  );
};

export default Dashboard;