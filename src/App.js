// src/App.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { auth, db } from './firebase/config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, get, onValue, off } from 'firebase/database';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import './App.css';

// ==================== IMPORT ATTENDANCE REMINDER ====================
import attendanceReminder from './utils/AttendanceReminder';

// Konfigurasi API
const API_BASE_URL = 'https://backendtest-azure.vercel.app';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [reminderInitialized, setReminderInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // ==================== IZIN STATE ====================
  const [izinPendingCount, setIzinPendingCount] = useState(0);
  const [izinInitialized, setIzinInitialized] = useState(false);

  // ==================== PENGUMUMAN STATE ====================
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0);
  const [announcementInitialized, setAnnouncementInitialized] = useState(false);

  // ==================== CHECK IZIN ACCESS ====================
  // ✅ Semua user login bisa akses izin
  const hasIzinAccess = useCallback((userData) => {
    return !!userData?.uid;
  }, []);

  // ==================== CHECK ANNOUNCEMENT ACCESS ====================
  // ✅ Semua user login bisa akses pengumuman
  const hasAnnouncementAccess = useCallback((userData) => {
    return !!userData?.uid;
  }, []);

  // ==================== TOKEN MANAGEMENT ====================
  
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
        console.warn('⚠️ Token verification failed');
        return false;
      }
    } catch (error) {
      console.warn('⚠️ Token verification error:', error.message);
      return false;
    }
  }, []);

  const getFreshToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    
    try {
      const token = await auth.currentUser.getIdToken(true);
      localStorage.setItem('authToken', token);
      console.log('✅ Fresh token obtained from Firebase');
      return token;
    } catch (error) {
      console.error('❌ Failed to get fresh token:', error);
      return null;
    }
  }, []);

  const refreshTokenPeriodically = useCallback(() => {
    const interval = setInterval(async () => {
      if (auth.currentUser) {
        try {
          const token = await auth.currentUser.getIdToken(true);
          localStorage.setItem('authToken', token);
          console.log('🔄 Token refreshed automatically');
        } catch (error) {
          console.error('❌ Failed to refresh token:', error);
        }
      }
    }, 50 * 60 * 1000);
    
    return interval;
  }, []);

  // ==================== USER MANAGEMENT ====================
  
  const loadUserData = useCallback(async (uid) => {
    try {
      const snapshot = await get(ref(db, `users_auth/${uid}`));
      const userData = snapshot.val();
      
      if (userData) {
        const validRoles = ['developer', 'admin', 'wakil_kepala', 'staff_tu', 'guru', 'siswa'];
        if (!userData.role || !validRoles.includes(userData.role)) {
          userData.role = 'siswa';
        }
        
        if (userData.email === 'zaki5go@gmail.com' && userData.role !== 'developer') {
          userData.role = 'developer';
        }
        
        return {
          uid: uid,
          ...userData
        };
      }
      return null;
    } catch (error) {
      console.error('❌ Error loading user data:', error);
      return null;
    }
  }, []);

  const setUserAndSave = useCallback((userData) => {
    if (userData) {
      const userToSave = {
        uid: userData.uid,
        email: userData.email,
        nama: userData.nama || userData.email?.split('@')[0] || 'User',
        role: userData.role || 'siswa',
        kelas: userData.kelas || '',
        jurusan: userData.jurusan || '',
        fpId: userData.fpId || null,
        photoUrl: userData.photoUrl || '',
        subject: userData.subject || '',
        bidang: userData.bidang || '',
        noHp: userData.noHp || '',
        parentPhone: userData.parentPhone || '',
        registeredAt: userData.registeredAt || Date.now()
      };
      
      localStorage.setItem('currentUser', JSON.stringify(userToSave));
      setUser(userToSave);
      
      if (typeof window !== 'undefined') {
        window.currentUser = userToSave;
      }
      
      window.dispatchEvent(new CustomEvent('userLoggedIn', { 
        detail: { user: userToSave } 
      }));
      
      console.log('✅ User set and saved:', userToSave.nama);
    } else {
      localStorage.removeItem('currentUser');
      if (typeof window !== 'undefined') {
        window.currentUser = null;
      }
      setUser(null);
    }
  }, []);

  // ==================== IZIN INITIALIZATION ====================
  
  const initializeIzin = useCallback(async (userData) => {
    if (izinInitialized) {
      console.log('📝 Izin system already initialized');
      return;
    }

    if (!userData && user) {
      userData = user;
    }

    if (!userData || !hasIzinAccess(userData)) {
      console.log('📝 User does not have izin access');
      return;
    }

    try {
      console.log('📝 Initializing Izin system for user:', userData.nama);
      
      // ===== LISTEN FOR IZIN PENDING COUNT =====
      const izinRef = ref(db, 'izin');
      const unsubscribe = onValue(izinRef, (snapshot) => {
        const data = snapshot.val();
        let pending = 0;
        
        if (data) {
          const userRole = userData?.role;
          const userUid = userData?.uid;
          const userFpId = userData?.fpId;
          
          for (const [key, izin] of Object.entries(data)) {
            // Jika siswa, hanya hitung izin miliknya yang pending
            if (userRole === 'siswa') {
              if (izin.studentId == userUid || izin.studentId == userFpId) {
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
        
        // Dispatch event untuk update badge
        window.dispatchEvent(new CustomEvent('izinBadgeUpdate', {
          detail: { count: pending }
        }));
      });
      
      if (window._izinUnsubscribe) {
        window._izinUnsubscribe();
      }
      window._izinUnsubscribe = unsubscribe;
      
      setIzinInitialized(true);
      console.log('✅ Izin system initialized, pending count:', izinPendingCount);
      
    } catch (error) {
      console.error('❌ Failed to initialize Izin system:', error);
    }
  }, [izinInitialized, user, hasIzinAccess]);

  // ==================== ANNOUNCEMENT INITIALIZATION ====================
  
  const initializeAnnouncement = useCallback(async (userData) => {
    if (announcementInitialized) {
      console.log('📢 Announcement system already initialized');
      return;
    }

    if (!userData && user) {
      userData = user;
    }

    if (!userData || !hasAnnouncementAccess(userData)) {
      console.log('📢 User does not have announcement access');
      return;
    }

    try {
      console.log('📢 Initializing Announcement system for user:', userData.nama);
      
      // ===== LISTEN FOR UNREAD ANNOUNCEMENTS =====
      const announcementsRef = ref(db, 'announcements');
      const unsubscribe = onValue(announcementsRef, (snapshot) => {
        const data = snapshot.val();
        let unread = 0;
        const now = Date.now();
        const userRole = userData?.role;
        const userUid = userData?.uid;
        
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
        
        // Dispatch event untuk update badge
        window.dispatchEvent(new CustomEvent('announcementBadgeUpdate', {
          detail: { count: unread }
        }));
        
        console.log('📢 Announcement unread count updated:', unread);
      });
      
      if (window._announcementUnsubscribe) {
        window._announcementUnsubscribe();
      }
      window._announcementUnsubscribe = unsubscribe;
      
      setAnnouncementInitialized(true);
      console.log('✅ Announcement system initialized, unread count:', announcementUnreadCount);
      
    } catch (error) {
      console.error('❌ Failed to initialize Announcement system:', error);
    }
  }, [announcementInitialized, user, hasAnnouncementAccess]);

  // ==================== INITIALIZE ATTENDANCE REMINDER ====================
  
  const initializeAttendanceReminder = useCallback(async () => {
    if (reminderInitialized) {
      console.log('⏰ Attendance reminder already initialized');
      return;
    }

    try {
      console.log('⏰ Auto-initializing attendance reminder system...');
      
      const configSnapshot = await get(ref(db, 'system_config/attendance_reminder'));
      const config = configSnapshot.val();
      
      const isEnabled = config?.enabled !== false;
      
      if (!isEnabled) {
        console.log('⏰ Attendance reminder is disabled in system config');
        return;
      }

      attendanceReminder.start();
      setReminderInitialized(true);
      
      console.log('✅ Attendance reminder initialized successfully');
      
      setTimeout(() => {
        attendanceReminder.checkAndSendReminders();
      }, 3000);
      
    } catch (error) {
      console.error('❌ Failed to initialize attendance reminder:', error);
    }
  }, [reminderInitialized]);

  // ==================== HANDLE TAB CHANGE ====================
  
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    
    if (tab === 'izin') {
      // Inisialisasi izin jika belum
      if (!izinInitialized && user) {
        initializeIzin(user);
      }
    }
    
    if (tab === 'announcements') {
      // Inisialisasi pengumuman jika belum
      if (!announcementInitialized && user) {
        initializeAnnouncement(user);
      }
    }
    
    // Dispatch event untuk tab change
    window.dispatchEvent(new CustomEvent('tabChange', {
      detail: { tab }
    }));
  }, [user, izinInitialized, initializeIzin, announcementInitialized, initializeAnnouncement]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // ==================== AUTH STATE MANAGEMENT ====================
  
  useEffect(() => {
    console.log('🔐 App initializing...');
    
    let isMounted = true;
    let tokenRefreshInterval = null;

    console.log('⏰ [AUTO] Starting attendance reminder system...');
    
    setTimeout(() => {
      if (isMounted && !reminderInitialized) {
        initializeAttendanceReminder();
      }
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;
      
      console.log('🔐 Auth state changed:', firebaseUser ? 'User logged in' : 'No user');
      
      if (firebaseUser) {
        try {
          let token = localStorage.getItem('authToken');
          
          if (token) {
            const isValid = await verifyToken(token);
            if (!isValid) {
              console.log('🔄 Token invalid, getting fresh token...');
              token = await getFreshToken();
            }
          } else {
            console.log('🔄 No token, getting fresh token...');
            token = await getFreshToken();
          }
          
          if (!token) {
            console.warn('⚠️ No token available, but continuing...');
          }
          
          const userData = await loadUserData(firebaseUser.uid);
          
          if (userData) {
            if (!userData.email) {
              userData.email = firebaseUser.email || '';
            }
            
            if (userData.email) {
              if (typeof window.resetLoginAttempts === 'function') {
                window.resetLoginAttempts(userData.email);
              }
              localStorage.removeItem('lastLoginEmail');
            }
            
            setUserAndSave(userData);
            
            // ⭐ INITIALIZE IZIN if user has access ⭐
            if (hasIzinAccess(userData)) {
              setTimeout(() => {
                initializeIzin(userData);
              }, 1800);
            }
            
            // ⭐ INITIALIZE ANNOUNCEMENT if user has access ⭐
            if (hasAnnouncementAccess(userData)) {
              setTimeout(() => {
                initializeAnnouncement(userData);
              }, 2000);
            }
            
            if (tokenRefreshInterval) {
              clearInterval(tokenRefreshInterval);
            }
            tokenRefreshInterval = refreshTokenPeriodically();
            
            console.log('✅ User authenticated:', userData.nama);
          } else {
            console.warn('⚠️ No user data found for uid:', firebaseUser.uid);
            await handleLogout();
          }
        } catch (error) {
          console.error('❌ Auth state handling error:', error);
          await handleLogout();
        }
      } else {
        localStorage.removeItem('currentUser');
        localStorage.removeItem('authToken');
        if (typeof window !== 'undefined') {
          window.currentUser = null;
        }
        setUser(null);
        setIzinInitialized(false);
        setAnnouncementInitialized(false);
        setActiveTab('dashboard');
        setIzinPendingCount(0);
        setAnnouncementUnreadCount(0);
        
        if (window._izinUnsubscribe) {
          window._izinUnsubscribe();
          window._izinUnsubscribe = null;
        }
        
        if (window._announcementUnsubscribe) {
          window._announcementUnsubscribe();
          window._announcementUnsubscribe = null;
        }
        
        if (tokenRefreshInterval) {
          clearInterval(tokenRefreshInterval);
          tokenRefreshInterval = null;
        }
        console.log('👤 User signed out');
      }
      
      setAuthChecked(true);
      setLoading(false);
    });

    // ===== LISTEN FOR PAGE EVENTS =====
    const handleVisibilityChange = () => {
      if (!document.hidden && isMounted) {
        console.log('👁️ Tab visible - checking reminder...');
        if (!reminderInitialized) {
          initializeAttendanceReminder();
        } else {
          setTimeout(() => {
            attendanceReminder.checkAndSendReminders();
          }, 2000);
        }
        
        // ⭐ Refresh izin data on tab visibility ⭐
        if (user && hasIzinAccess(user) && izinInitialized) {
          console.log('📝 Refreshing izin data on tab visibility...');
          if (window._izinUnsubscribe) {
            // Re-trigger listener by re-fetching
            const izinRef = ref(db, 'izin');
            onValue(izinRef, (snapshot) => {
              const data = snapshot.val();
              let pending = 0;
              if (data) {
                const userRole = user?.role;
                const userUid = user?.uid;
                const userFpId = user?.fpId;
                for (const [key, izin] of Object.entries(data)) {
                  if (userRole === 'siswa') {
                    if (izin.studentId == userUid || izin.studentId == userFpId) {
                      if (izin.status === 'pending') pending++;
                    }
                  } else if (['guru', 'staff_tu', 'wakil_kepala', 'admin', 'developer'].includes(userRole)) {
                    if (izin.status === 'pending') pending++;
                  }
                }
              }
              setIzinPendingCount(pending);
              window.dispatchEvent(new CustomEvent('izinBadgeUpdate', {
                detail: { count: pending }
              }));
            }, { onlyOnce: true });
          }
        }
        
        // ⭐ Refresh announcement data on tab visibility ⭐
        if (user && hasAnnouncementAccess(user) && announcementInitialized) {
          console.log('📢 Refreshing announcement data on tab visibility...');
          if (window._announcementUnsubscribe) {
            const announcementsRef = ref(db, 'announcements');
            onValue(announcementsRef, (snapshot) => {
              const data = snapshot.val();
              let unread = 0;
              const now = Date.now();
              const userRole = user?.role;
              const userUid = user?.uid;
              
              if (data) {
                for (const [key, announcement] of Object.entries(data)) {
                  if (announcement.expiryDate) {
                    const expiryDate = new Date(announcement.expiryDate).getTime();
                    if (now > expiryDate) continue;
                  }
                  if (announcement.readBy && announcement.readBy[userUid]) {
                    continue;
                  }
                  if (announcement.targetRoles && announcement.targetRoles.length > 0) {
                    if (!announcement.targetRoles.includes(userRole)) {
                      continue;
                    }
                  }
                  unread++;
                }
              }
              setAnnouncementUnreadCount(unread);
              window.dispatchEvent(new CustomEvent('announcementBadgeUpdate', {
                detail: { count: unread }
              }));
            }, { onlyOnce: true });
          }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleWindowFocus = () => {
      if (isMounted) {
        console.log('🔄 Window focused - checking reminder...');
        if (!reminderInitialized) {
          initializeAttendanceReminder();
        }
        
        // ⭐ Refresh izin data on window focus ⭐
        if (user && hasIzinAccess(user) && izinInitialized) {
          console.log('📝 Refreshing izin data on window focus...');
          if (window._izinUnsubscribe) {
            const izinRef = ref(db, 'izin');
            onValue(izinRef, (snapshot) => {
              const data = snapshot.val();
              let pending = 0;
              if (data) {
                const userRole = user?.role;
                const userUid = user?.uid;
                const userFpId = user?.fpId;
                for (const [key, izin] of Object.entries(data)) {
                  if (userRole === 'siswa') {
                    if (izin.studentId == userUid || izin.studentId == userFpId) {
                      if (izin.status === 'pending') pending++;
                    }
                  } else if (['guru', 'staff_tu', 'wakil_kepala', 'admin', 'developer'].includes(userRole)) {
                    if (izin.status === 'pending') pending++;
                  }
                }
              }
              setIzinPendingCount(pending);
              window.dispatchEvent(new CustomEvent('izinBadgeUpdate', {
                detail: { count: pending }
              }));
            }, { onlyOnce: true });
          }
        }
        
        // ⭐ Refresh announcement data on window focus ⭐
        if (user && hasAnnouncementAccess(user) && announcementInitialized) {
          console.log('📢 Refreshing announcement data on window focus...');
          if (window._announcementUnsubscribe) {
            const announcementsRef = ref(db, 'announcements');
            onValue(announcementsRef, (snapshot) => {
              const data = snapshot.val();
              let unread = 0;
              const now = Date.now();
              const userRole = user?.role;
              const userUid = user?.uid;
              
              if (data) {
                for (const [key, announcement] of Object.entries(data)) {
                  if (announcement.expiryDate) {
                    const expiryDate = new Date(announcement.expiryDate).getTime();
                    if (now > expiryDate) continue;
                  }
                  if (announcement.readBy && announcement.readBy[userUid]) {
                    continue;
                  }
                  if (announcement.targetRoles && announcement.targetRoles.length > 0) {
                    if (!announcement.targetRoles.includes(userRole)) {
                      continue;
                    }
                  }
                  unread++;
                }
              }
              setAnnouncementUnreadCount(unread);
              window.dispatchEvent(new CustomEvent('announcementBadgeUpdate', {
                detail: { count: unread }
              }));
            }, { onlyOnce: true });
          }
        }
      }
    };
    window.addEventListener('focus', handleWindowFocus);

    const handleUserLoggedIn = async (e) => {
      if (e.detail && e.detail.user) {
        console.log('✅ User logged in event received:', e.detail.user.nama);
        
        let token = localStorage.getItem('authToken');
        if (!token && auth.currentUser) {
          token = await getFreshToken();
        }
        
        setUserAndSave(e.detail.user);
        
        // ⭐ Initialize izin on login ⭐
        if (hasIzinAccess(e.detail.user)) {
          setTimeout(() => {
            initializeIzin(e.detail.user);
          }, 1300);
        }
        
        // ⭐ Initialize announcement on login ⭐
        if (hasAnnouncementAccess(e.detail.user)) {
          setTimeout(() => {
            initializeAnnouncement(e.detail.user);
          }, 1500);
        }
      }
    };
    window.addEventListener('userLoggedIn', handleUserLoggedIn);

    const handleUserLoggedOut = () => {
      console.log('🚪 User logged out event received');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
      localStorage.removeItem('login_attempts_data');
      localStorage.removeItem('lastLoginEmail');
      if (typeof window !== 'undefined') {
        window.currentUser = null;
      }
      setUser(null);
      setIzinInitialized(false);
      setAnnouncementInitialized(false);
      setActiveTab('dashboard');
      setIzinPendingCount(0);
      setAnnouncementUnreadCount(0);
      
      if (window._izinUnsubscribe) {
        window._izinUnsubscribe();
        window._izinUnsubscribe = null;
      }
      
      if (window._announcementUnsubscribe) {
        window._announcementUnsubscribe();
        window._announcementUnsubscribe = null;
      }
      
      if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
      }
    };
    window.addEventListener('userLoggedOut', handleUserLoggedOut);

    // ===== LISTEN FOR TAB CHANGE =====
    const handleTabChangeEvent = (e) => {
      if (e.detail && e.detail.tab) {
        setActiveTab(e.detail.tab);
      }
    };
    window.addEventListener('tabChange', handleTabChangeEvent);

    // ===== LISTEN FOR IZIN BADGE UPDATE =====
    const handleIzinBadgeUpdate = (e) => {
      if (e.detail && typeof e.detail.count === 'number') {
        setIzinPendingCount(e.detail.count);
      }
    };
    window.addEventListener('izinBadgeUpdate', handleIzinBadgeUpdate);

    // ===== LISTEN FOR ANNOUNCEMENT BADGE UPDATE =====
    const handleAnnouncementBadgeUpdate = (e) => {
      if (e.detail && typeof e.detail.count === 'number') {
        setAnnouncementUnreadCount(e.detail.count);
      }
    };
    window.addEventListener('announcementBadgeUpdate', handleAnnouncementBadgeUpdate);

    const savedUser = localStorage.getItem('currentUser');
    if (savedUser && !auth.currentUser) {
      try {
        const userData = JSON.parse(savedUser);
        console.log('📦 Saved user found:', userData.nama);
      } catch (e) {
        console.warn('Failed to parse saved user:', e);
        localStorage.removeItem('currentUser');
      }
    }

    return () => {
      isMounted = false;
      unsubscribe();
      window.removeEventListener('userLoggedIn', handleUserLoggedIn);
      window.removeEventListener('userLoggedOut', handleUserLoggedOut);
      window.removeEventListener('tabChange', handleTabChangeEvent);
      window.removeEventListener('izinBadgeUpdate', handleIzinBadgeUpdate);
      window.removeEventListener('announcementBadgeUpdate', handleAnnouncementBadgeUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      
      if (window._izinUnsubscribe) {
        window._izinUnsubscribe();
        window._izinUnsubscribe = null;
      }
      
      if (window._announcementUnsubscribe) {
        window._announcementUnsubscribe();
        window._announcementUnsubscribe = null;
      }
      
      if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
      }
      
      console.log('🧹 App cleanup complete');
    };
  }, [loadUserData, setUserAndSave, verifyToken, getFreshToken, refreshTokenPeriodically, initializeAttendanceReminder, reminderInitialized, initializeIzin, hasIzinAccess, user, izinInitialized, initializeAnnouncement, hasAnnouncementAccess, announcementInitialized]);

  // ==================== HANDLERS ====================
  
  const handleLoginSuccess = useCallback((userData) => {
    console.log('✅ Login success, setting user:', userData.nama);
    setUserAndSave(userData);
    
    // ⭐ Initialize izin on login success ⭐
    if (hasIzinAccess(userData)) {
      setTimeout(() => {
        initializeIzin(userData);
      }, 1000);
    }
    
    // ⭐ Initialize announcement on login success ⭐
    if (hasAnnouncementAccess(userData)) {
      setTimeout(() => {
        initializeAnnouncement(userData);
      }, 1200);
    }
  }, [setUserAndSave, hasIzinAccess, initializeIzin, hasAnnouncementAccess, initializeAnnouncement]);

  const handleLogout = useCallback(async () => {
    console.log('🚪 Logging out...');
    
    try {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
      localStorage.removeItem('login_attempts_data');
      localStorage.removeItem('lastLoginEmail');
      
      if (typeof window !== 'undefined') {
        window.currentUser = null;
      }
      
      if (window._izinUnsubscribe) {
        window._izinUnsubscribe();
        window._izinUnsubscribe = null;
      }
      
      if (window._announcementUnsubscribe) {
        window._announcementUnsubscribe();
        window._announcementUnsubscribe = null;
      }
      
      if (window._lockoutInterval) {
        clearInterval(window._lockoutInterval);
        window._lockoutInterval = null;
      }
      
      await signOut(auth);
      setUser(null);
      setIzinInitialized(false);
      setAnnouncementInitialized(false);
      setIzinPendingCount(0);
      setAnnouncementUnreadCount(0);
      setReminderInitialized(false);
      setActiveTab('dashboard');
      
      window.dispatchEvent(new CustomEvent('userLoggedOut'));
      
      console.log('✅ Logout successful');
    } catch (error) {
      console.error('❌ Logout error:', error);
    }
  }, []);

  // ==================== RENDER CONTENT ====================
  
  const renderContent = useCallback(() => {
    if (!user) return null;
    
    return (
      <Dashboard 
        user={user} 
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        announcementUnreadCount={announcementUnreadCount}
        izinPendingCount={izinPendingCount}
      />
    );
  }, [user, activeTab, handleTabChange, handleLogout, sidebarOpen, toggleSidebar, announcementUnreadCount, izinPendingCount]);

  // ==================== RENDER ====================
  
  if (loading || !authChecked) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Memuat sistem...</p>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '8px' }}>
          Menghubungkan ke Firebase...
        </p>
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

  if (!user) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-container">
      {renderContent()}
    </div>
  );
}

export default App;