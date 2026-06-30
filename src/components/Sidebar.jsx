// src/components/Sidebar.jsx
import React, { useState, useEffect } from 'react';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase/config';
import './Sidebar.css';

const Sidebar = ({
  user,
  schoolName,
  schoolLogo,
  profilePhoto,
  activeTab,
  sidebarOpen,
  onTabChange,
  onLogout,
  onToggleSidebar
}) => {
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [friendRequests, setFriendRequests] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unviewedStatus, setUnviewedStatus] = useState(0);
  const [izinPendingCount, setIzinPendingCount] = useState(0);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);

  const getRoleDisplayName = (role) => {
    const names = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala Sekolah',
      staff_tu: 'Staff TU',
      guru: 'Guru',
      siswa: 'Siswa'
    };
    return names[role] || role.toUpperCase();
  };

  const getRoleIcon = (role) => {
    const icons = {
      developer: '👨‍💻',
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

  // ==================== ROLE PERMISSIONS ====================
  
  const hasFullAccess = () => {
    const fullAccessRoles = ['developer', 'admin', 'wakil_kepala'];
    return fullAccessRoles.includes(user?.role);
  };

  const hasStaffAccess = () => {
    const staffRoles = ['guru', 'staff_tu'];
    return staffRoles.includes(user?.role);
  };

  const isSiswa = () => {
    return user?.role === 'siswa';
  };

  // ==================== IZIN ONLINE ACCESS ====================
  const hasIzinAccess = () => {
    return user?.role && user?.role !== '';
  };

  // ==================== AI ACCESS ====================
  const hasAIAccess = () => {
    const allowedRoles = ['developer', 'admin'];
    return allowedRoles.includes(user?.role);
  };

  // ==================== LOG AKTIVITAS ACCESS ====================
  const hasLogAccess = () => {
    const allowedRoles = ['developer', 'admin'];
    return allowedRoles.includes(user?.role);
  };

  // ==================== GET UNREAD COUNTS ====================
  const getUnreadCounts = async () => {
    if (!user?.uid || !db) return;

    try {
      const requestsSnapshot = await get(ref(db, 'friendships/requests'));
      const requests = requestsSnapshot.val();
      if (requests) {
        const pending = Object.values(requests).filter(
          req => req.to === user.uid && req.status === 'pending'
        );
        setFriendRequests(pending.length);
      }

      const inboxSnapshot = await get(ref(db, `chats/${user.uid}/inbox`));
      const inbox = inboxSnapshot.val();
      if (inbox) {
        let total = 0;
        Object.values(inbox).forEach(chat => {
          if (chat.unreadCount) total += chat.unreadCount;
        });
        setUnreadMessages(total);
      }

      const statusSnapshot = await get(ref(db, 'statuses'));
      const statuses = statusSnapshot.val();
      if (statuses) {
        let unviewed = 0;
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        
        for (const [userId, userStatuses] of Object.entries(statuses)) {
          if (userId === user.uid) continue;
          
          const friendCheck = await get(ref(db, `friendships/list/${user.uid}/${userId}`));
          if (!friendCheck.exists()) continue;
          
          if (userStatuses) {
            for (const [statusId, status] of Object.entries(userStatuses)) {
              if (status.createdAt && (now - status.createdAt) < twentyFourHours) {
                if (!status.viewedBy || !status.viewedBy[user.uid]) {
                  unviewed++;
                }
              }
            }
          }
        }
        setUnviewedStatus(unviewed);
      }

      const izinSnapshot = await get(ref(db, 'izin'));
      const izinData = izinSnapshot.val();
      if (izinData) {
        let pending = 0;
        const userRole = user?.role;
        const userUid = user?.uid;
        
        for (const [key, izin] of Object.entries(izinData)) {
          if (userRole === 'siswa') {
            if (izin.siswaUid === userUid && izin.status === 'pending') {
              pending++;
            }
          } 
          else if (['guru', 'staff_tu', 'wakil_kepala', 'admin', 'developer'].includes(userRole)) {
            if (izin.status === 'pending') {
              pending++;
            }
          }
        }
        setIzinPendingCount(pending);
      }

      await getUnreadAnnouncements();

    } catch (error) {
      console.error('Error getting unread counts:', error);
    }
  };

  // ==================== GET UNREAD ANNOUNCEMENTS ====================
  const getUnreadAnnouncements = async () => {
    if (!user?.uid || !db) return;

    try {
      const announcementsRef = ref(db, 'announcements');
      const snapshot = await get(announcementsRef);
      const data = snapshot.val();
      
      if (data) {
        let unread = 0;
        const now = Date.now();
        const userRole = user?.role;
        
        for (const [key, announcement] of Object.entries(data)) {
          if (announcement.expiryDate) {
            const expiryDate = new Date(announcement.expiryDate).getTime();
            if (now > expiryDate) continue;
          }
          
          if (announcement.readBy && announcement.readBy[user.uid]) {
            continue;
          }
          
          if (announcement.targetRoles && announcement.targetRoles.length > 0) {
            if (!announcement.targetRoles.includes(userRole)) {
              continue;
            }
          }
          
          unread++;
        }
        
        setUnreadAnnouncements(unread);
      } else {
        setUnreadAnnouncements(0);
      }
    } catch (error) {
      console.error('Error getting unread announcements:', error);
    }
  };

  // ==================== TIME & DATE ====================
  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('id-ID', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
      }));
      setCurrentDate(now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }));
    };
    
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // ==================== GET UNREAD COUNTS ON MOUNT ====================
  useEffect(() => {
    if (user?.uid && db) {
      getUnreadCounts();

      const requestsRef = ref(db, 'friendships/requests');
      const inboxRef = ref(db, `chats/${user.uid}/inbox`);
      const statusRef = ref(db, 'statuses');
      const izinRef = ref(db, 'izin');
      const announcementsRef = ref(db, 'announcements');
      
      const requestsUnsub = onValue(requestsRef, () => {
        getUnreadCounts();
      });

      const inboxUnsub = onValue(inboxRef, () => {
        getUnreadCounts();
      });

      const statusUnsub = onValue(statusRef, () => {
        getUnreadCounts();
      });

      const izinUnsub = onValue(izinRef, () => {
        getUnreadCounts();
      });

      const announcementsUnsub = onValue(announcementsRef, () => {
        getUnreadAnnouncements();
      });

      return () => {
        off(requestsRef);
        off(inboxRef);
        off(statusRef);
        off(izinRef);
        off(announcementsRef);
        requestsUnsub();
        inboxUnsub();
        statusUnsub();
        izinUnsub();
        announcementsUnsub();
      };
    }
  }, [user?.uid]);

  // ==================== MENU ITEMS ====================
  const menuItems = [
    { 
      id: 'dashboard', 
      label: 'Dashboard',
      description: 'Dashboard utama',
      icon: '📊'
    },
    { 
      id: 'profile', 
      label: 'Profil',
      description: 'Profil pengguna',
      icon: '👤',
      showForAll: true
    },
    { 
      id: 'status', 
      label: 'Status',
      description: 'Lihat dan bagikan status',
      icon: '📸',
      showForAll: true,
      badge: unviewedStatus
    },
    { 
      id: 'friends', 
      label: 'Teman',
      description: 'Manajemen teman',
      icon: '👥',
      showForAll: true,
      badge: friendRequests
    },
    { 
      id: 'chat', 
      label: 'Chat',
      description: 'Pesan pribadi',
      icon: '💬',
      showForAll: true,
      badge: unreadMessages
    },
    { 
      id: 'announcements', 
      label: 'Pengumuman',
      description: 'Lihat dan kelola pengumuman',
      icon: '📢',
      showForAll: true,
      badge: unreadAnnouncements
    },
    { 
      id: 'ai', 
      label: 'AI Assistant',
      description: 'Asisten AI untuk membantu tugas sekolah',
      icon: '🤖',
      requireAI: true
    },
    { 
      id: 'logs', 
      label: 'Log Aktivitas',
      description: 'Lihat riwayat aktivitas sistem',
      icon: '📋',
      requireLog: true
    },
    { 
      id: 'attendance', 
      label: 'Absensi Siswa',
      description: 'Lihat absensi siswa',
      icon: '📋'
    },
    { 
      id: 'staff-attendance', 
      label: 'Absensi Staff',
      description: 'Lihat absensi staff',
      icon: '👔',
      requireStaff: true 
    },
    { 
      id: 'students', 
      label: 'Data Siswa',
      description: 'Kelola data siswa',
      icon: '👨‍🎓'
    },
    { 
      id: 'staff', 
      label: 'Data Staff',
      description: 'Kelola data staff',
      icon: '👥',
      requireStaff: true 
    },
    { 
      id: 'users', 
      label: 'Manajemen User',
      description: 'Kelola user',
      icon: '🔐',
      requireStaff: true 
    },
    { 
      id: 'rekap', 
      label: 'Rekap Siswa',
      description: 'Rekapitulasi data siswa',
      icon: '📊',
      requireStaff: true
    },
    { 
      id: 'izin', 
      label: 'Izin Online',
      description: 'Ajukan dan kelola izin online',
      icon: '📝',
      requireIzin: true,
      badge: izinPendingCount
    },
    { 
      id: 'config', 
      label: 'Pengaturan',
      description: 'Pengaturan sistem',
      icon: '⚙️',
      requireAdmin: true 
    }
  ];

  // ==================== RENDER ====================
  
  return (
    <>
      {sidebarOpen && <div className="sidebar-overlay" onClick={onToggleSidebar}></div>}
      
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* ===== HEADER - FIXED TOP ===== */}
        <div className="sidebar-header">
          <div className="sidebar-logo">
            {schoolLogo ? (
              <img src={schoolLogo} alt="Logo Sekolah" className="sidebar-logo-img" />
            ) : (
              <span className="sidebar-logo-icon">📱</span>
            )}
            <div className="sidebar-school-name-wrapper">
              <h2 className="sidebar-school-name">{schoolName}</h2>
              <div className="sidebar-school-name-underline"></div>
            </div>
          </div>
          <button className="sidebar-close" onClick={onToggleSidebar} aria-label="Close sidebar">
            ✖
          </button>
        </div>
        
        {/* ===== USER PROFILE - FIXED ===== */}
        <div className="sidebar-user">
          <div className="sidebar-avatar-wrapper">
            <div className="sidebar-avatar">
              <img 
                src={profilePhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.nama || 'User')}&background=00bcd4&color=fff&size=120&bold=true`} 
                alt="Avatar"
                onError={(e) => {
                  e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.nama?.charAt(0) || 'U')}&background=00bcd4&color=fff&size=120&bold=true`;
                }}
              />
            </div>
            <div className="sidebar-user-status" style={{ background: getRoleColor(user?.role) }}></div>
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.nama || user?.email || 'User'}</div>
            <div className={`sidebar-user-role role-${user?.role}`}>
              {getRoleIcon(user?.role)} {getRoleDisplayName(user?.role)}
            </div>
            {user?.kelas && (
              <div className="sidebar-user-class">📚 {user.kelas}</div>
            )}
            {user?.jurusan && (
              <div className="sidebar-user-major">🎓 {user.jurusan}</div>
            )}
          </div>
        </div>

        {/* ===== DATE & TIME + LOGOUT ===== */}
        <div className="sidebar-datetime-wrapper">
          <div className="sidebar-datetime">
            <div className="sidebar-time">{currentTime}</div>
            <div className="sidebar-date">{currentDate}</div>
          </div>
          
          {/* ===== TOMBOL LOGOUT DI BAWAH JAM ===== */}
          <button className="sidebar-logout" onClick={onLogout}>
            <span className="logout-icon">🚪</span>
            <span className="logout-text">Logout</span>
          </button>
        </div>
        
        {/* ============================================================ */}
        {/* ===== SCROLLABLE CONTENT AREA ===== */}
        {/* ============================================================ */}
        <div className="sidebar-scrollable">
          
          {/* ===== NAVIGATION ===== */}
          <nav className="sidebar-nav">
            {menuItems.map((item) => {
              let shouldShow = true;

              if (item.showForAll) {
                shouldShow = true;
              } else if (item.requireAdmin) {
                shouldShow = user?.role === 'developer' || user?.role === 'admin';
              } else if (item.requireStaff) {
                const staffRoles = ['developer', 'admin', 'wakil_kepala', 'guru', 'staff_tu'];
                shouldShow = staffRoles.includes(user?.role);
              } else if (item.requireIzin) {
                shouldShow = hasIzinAccess();
              } else if (item.requireAI) {
                shouldShow = hasAIAccess();
              } else if (item.requireLog) {
                shouldShow = hasLogAccess();
              } else if (isSiswa()) {
                const studentMenus = ['dashboard', 'profile', 'status', 'friends', 'chat', 'announcements', 'attendance', 'students', 'rekap', 'izin'];
                shouldShow = studentMenus.includes(item.id);
              } else {
                shouldShow = true;
              }

              if (!shouldShow) return null;
              
              const isActive = activeTab === item.id;
              const badgeCount = item.id === 'friends' ? friendRequests : 
                                item.id === 'chat' ? unreadMessages : 
                                item.id === 'status' ? unviewedStatus :
                                item.id === 'izin' ? izinPendingCount :
                                item.id === 'announcements' ? unreadAnnouncements :
                                item.badge || 0;
              
              return (
                <button 
                  key={item.id}
                  className={`sidebar-btn ${isActive ? 'active' : ''} ${item.id === 'status' ? 'status-menu-item' : ''} ${item.id === 'izin' ? 'izin-menu-item' : ''} ${item.id === 'announcements' ? 'announcement-menu-item' : ''} ${item.id === 'ai' ? 'ai-menu-item' : ''} ${item.id === 'logs' ? 'logs-menu-item' : ''}`}
                  onClick={() => { 
                    onTabChange(item.id); 
                    if (window.innerWidth <= 768) {
                      onToggleSidebar();
                    }
                  }}
                  title={item.description}
                >
                  <span className="sidebar-btn-icon">{item.icon || '📄'}</span>
                  <span className="sidebar-btn-label">{item.label}</span>
                  {badgeCount > 0 && (
                    <span className="sidebar-badge">{badgeCount > 99 ? '99+' : badgeCount}</span>
                  )}
                  {isActive && <span className="sidebar-btn-indicator"></span>}
                  {item.id === 'status' && badgeCount > 0 && (
                    <span className="status-pulse" style={{
                      position: 'absolute',
                      right: '8px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#ff6b6b',
                      animation: 'pulse-dot 1.5s infinite'
                    }}></span>
                  )}
                  {item.id === 'izin' && badgeCount > 0 && (
                    <span className="izin-pulse" style={{
                      position: 'absolute',
                      right: '8px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#ff9800',
                      animation: 'pulse-dot 1.5s infinite'
                    }}></span>
                  )}
                  {item.id === 'announcements' && badgeCount > 0 && (
                    <span className="announcement-pulse" style={{
                      position: 'absolute',
                      right: '8px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#00bcd4',
                      animation: 'pulse-dot 1.5s infinite'
                    }}></span>
                  )}
                  {item.id === 'ai' && (
                    <span className="ai-sparkle" style={{
                      position: 'absolute',
                      right: '8px',
                      fontSize: '12px',
                      animation: 'sparkle 2s infinite'
                    }}>✨</span>
                  )}
                  {item.id === 'logs' && (
                    <span className="logs-indicator" style={{
                      position: 'absolute',
                      right: '8px',
                      fontSize: '10px',
                      color: '#ff9800'
                    }}>●</span>
                  )}
                </button>
              );
            })}
          </nav>
          
          {/* ===== SOCIAL SUMMARY ===== */}
          <div className="sidebar-social-summary">
            <div className={`social-summary-item ${friendRequests > 0 ? 'has-notification' : ''}`} title="Permintaan teman">
              <span className="social-summary-icon">👥</span>
              <span className="social-summary-count" data-count={friendRequests}>{friendRequests}</span>
              <span className="social-summary-label">Teman</span>
            </div>
            <div className={`social-summary-item ${unreadMessages > 0 ? 'has-notification' : ''}`} title="Pesan belum dibaca">
              <span className="social-summary-icon">💬</span>
              <span className="social-summary-count" data-count={unreadMessages}>{unreadMessages}</span>
              <span className="social-summary-label">Chat</span>
            </div>
            <div className={`social-summary-item ${unviewedStatus > 0 ? 'has-notification' : ''}`} title="Status belum dilihat">
              <span className="social-summary-icon">📸</span>
              <span className="social-summary-count" data-count={unviewedStatus}>{unviewedStatus}</span>
              <span className="social-summary-label">Status</span>
            </div>
            <div className={`social-summary-item ${unreadAnnouncements > 0 ? 'has-notification has-announcement' : ''}`} 
                 title="Pengumuman belum dibaca" 
                 style={{ cursor: 'pointer' }} 
                 onClick={() => {
                   onTabChange('announcements');
                   if (window.innerWidth <= 768) onToggleSidebar();
                 }}
            >
              <span className="social-summary-icon">📢</span>
              <span className="social-summary-count" data-count={unreadAnnouncements}>{unreadAnnouncements}</span>
              <span className="social-summary-label">Info</span>
            </div>
            <div className={`social-summary-item ${izinPendingCount > 0 ? 'has-notification' : ''}`} 
                 title="Izin pending" 
                 style={{ cursor: 'pointer' }} 
                 onClick={() => {
                   onTabChange('izin');
                   if (window.innerWidth <= 768) onToggleSidebar();
                 }}
            >
              <span className="social-summary-icon">📝</span>
              <span className="social-summary-count" data-count={izinPendingCount}>{izinPendingCount}</span>
              <span className="social-summary-label">Izin</span>
            </div>
          </div>
          
          {/* ===== FOOTER INFO ===== */}
          <div className="sidebar-footer-info">
            <div className="sidebar-user-role-info">
              <span className="role-info-label">Role:</span>
              <span className={`role-info-value role-${user?.role}`}>
                {getRoleIcon(user?.role)} {getRoleDisplayName(user?.role)}
              </span>
            </div>
            <div className="sidebar-version">
              <span>📱 v6.6</span>
            </div>
          </div>
          
        </div>
        {/* ===== END SCROLLABLE CONTENT AREA ===== */}
        {/* ============================================================ */}
        
      </aside>
    </>
  );
};

export default Sidebar;