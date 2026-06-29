// src/components/DashboardContent.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue, off, get, set, update, remove } from 'firebase/database';
import { db } from '../firebase/config';
import './DashboardContent.css';

// ==================== CONSTANTS ====================
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const API_BASE_URL = 'https://backendtest-azure.vercel.app';

// ==================== UPLOAD HELPERS ====================
const uploadToBackend = async (file, folder, userId) => {
  try {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('folder', folder);
    formData.append('userId', userId || 'anonymous');

    const token = localStorage.getItem('authToken');

    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      headers: {
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Upload failed');
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Upload failed');
    }

    return {
      url: result.data.url,
      path: result.data.path,
      storage: result.data.storage || 'supabase'
    };
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
};

const uploadWithFallback = async (file, folder, userId) => {
  try {
    return await uploadToBackend(file, folder, userId);
  } catch (error) {
    console.warn('Backend upload failed, using base64 fallback:', error.message);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve({
          url: e.target.result,
          path: `base64_${folder}/${userId || 'anonymous'}/${Date.now()}`,
          storage: 'base64'
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};

// ==================== MAIN COMPONENT ====================
const DashboardContent = ({ stats, user, profilePhoto, onTabChange }) => {
  // ==================== STATE ====================
  const [greeting, setGreeting] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [animatedStats, setAnimatedStats] = useState({
    totalStudents: 0,
    hadirToday: 0,
    tidakHadir: 0,
    terlambat: 0
  });
  const [attendancePercentage, setAttendancePercentage] = useState(0);

  // ==================== STATUS STATE ====================
  const [myStatuses, setMyStatuses] = useState([]);
  const [friendsStatuses, setFriendsStatuses] = useState([]);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);

  // ==================== STATUS MODAL STATE ====================
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewerModal, setShowViewerModal] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusImage, setStatusImage] = useState(null);
  const [statusImagePreview, setStatusImagePreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [currentStatusList, setCurrentStatusList] = useState([]);
  const [currentStatusIndex, setCurrentStatusIndex] = useState(0);
  const [currentStatusOwnerId, setCurrentStatusOwnerId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [friendsCache, setFriendsCache] = useState(new Map());

  // ==================== REFS ====================
  const fileInputRef = useRef(null);
  const statusesListenerRef = useRef(null);
  const statusViewerIntervalRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const statsRef = useRef(null);
  const animationDone = useRef(false);

  // ==================== ROLE HELPERS ====================
  const isSiswa = user?.role === 'siswa';
  const hasReminderPermission = ['developer', 'admin', 'wakil_kepala', 'guru', 'staff_tu'].includes(user?.role);

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

  // ==================== AVATAR HELPER ====================
  const getAvatarUrl = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=00bcd4&color=fff&size=100`;
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days} h`;
    if (hours > 0) return `${hours} jam`;
    if (minutes > 0) return `${minutes} m`;
    return 'Baru saja';
  };

  // ==================== TOAST ====================
  const showToast = (message, type = 'info') => {
    setToastMessage({ message, type });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000);
  };

  // ==================== CHECK FRIEND ====================
  const isFriend = useCallback(async (userId) => {
    if (!user) return false;
    if (userId === user.uid) return true;
    if (friendsCache.has(userId)) return friendsCache.get(userId);
    
    try {
      const snapshot = await get(ref(db, `friendships/list/${user.uid}/${userId}`));
      const result = snapshot.exists();
      setFriendsCache(prev => new Map(prev).set(userId, result));
      return result;
    } catch (err) {
      console.error("Error checking friend status:", err);
      return false;
    }
  }, [user, friendsCache]);

  // ==================== STATUS LISTENER ====================
  useEffect(() => {
    if (!user?.uid) return;

    const setupStatusListener = () => {
      if (statusesListenerRef.current) {
        off(ref(db, 'statuses'), statusesListenerRef.current);
        statusesListenerRef.current = null;
      }

      const listener = onValue(ref(db, 'statuses'), async (snapshot) => {
        const data = snapshot.val();
        await processStatusData(data);
      });

      statusesListenerRef.current = listener;
    };

    setupStatusListener();

    return () => {
      if (statusesListenerRef.current) {
        off(ref(db, 'statuses'), statusesListenerRef.current);
        statusesListenerRef.current = null;
      }
      if (statusViewerIntervalRef.current) {
        clearInterval(statusViewerIntervalRef.current);
        statusViewerIntervalRef.current = null;
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, [user]);

  // ==================== PROCESS STATUS DATA ====================
  const processStatusData = useCallback(async (data) => {
    if (!user?.uid) return;

    const now = Date.now();
    let groupedByUser = {};

    if (data) {
      for (const [userId, userStatuses] of Object.entries(data)) {
        if (!userStatuses) continue;
        
        const isFriendUser = await isFriend(userId);
        
        for (const [statusId, status] of Object.entries(userStatuses)) {
          if (!status) continue;
          
          const createdAt = status.createdAt;
          if (createdAt && (now - createdAt) >= TWENTY_FOUR_HOURS) {
            await remove(ref(db, `statuses/${userId}/${statusId}`)).catch(() => {});
            continue;
          }
          
          if (createdAt && (now - createdAt) < TWENTY_FOUR_HOURS) {
            if (!groupedByUser[userId]) groupedByUser[userId] = [];
            groupedByUser[userId].push({
              id: statusId,
              userId: userId,
              isNew: userId !== user.uid && (!status.viewedBy || !status.viewedBy[user.uid]),
              ...status
            });
          }
        }
      }
    }

    // Sort each user's statuses
    for (const userId of Object.keys(groupedByUser)) {
      groupedByUser[userId].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    // Update state
    const myStatusesList = groupedByUser[user?.uid] || [];
    const friendStatusesList = [];
    
    for (const [userId, statuses] of Object.entries(groupedByUser)) {
      if (userId === user?.uid) continue;
      const isFriendUser = await isFriend(userId);
      if (isFriendUser) {
        friendStatusesList.push(...statuses.map(s => ({ ...s, userId })));
      }
    }
    
    myStatusesList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    friendStatusesList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    setMyStatuses(myStatusesList);
    setFriendsStatuses(friendStatusesList);
    
    // Count unviewed
    let count = 0;
    for (const status of [...myStatusesList, ...friendStatusesList]) {
      if (status.userId !== user.uid && !status.viewedBy?.[user.uid]) {
        count++;
      }
    }
    setUnviewedCount(count);
    
    // Update badge
    window.dispatchEvent(new CustomEvent('statusBadgeUpdate', {
      detail: { count }
    }));
    
    setIsLoadingStatus(false);
  }, [user, isFriend]);

  // ==================== CREATE STATUS ====================
  const handleCreateStatus = async () => {
    if (!user) {
      showToast("Anda harus login!", "error");
      return;
    }

    const text = statusText.trim();
    const imageFile = statusImage;

    if (!text && !imageFile) {
      showToast("Masukkan teks atau pilih gambar!", "error");
      return;
    }

    setIsUploading(true);

    let mediaUrl = null;
    let type = 'text';

    try {
      if (imageFile) {
        if (imageFile.size > 5 * 1024 * 1024) {
          showToast("Ukuran gambar maksimal 5MB!", "error");
          setIsUploading(false);
          return;
        }

        const result = await uploadWithFallback(imageFile, 'status', user.uid);
        mediaUrl = result.url;
        type = 'image';
      }

      const statusId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const statusData = {
        text: text || (type === 'image' ? '📸 ' : ''),
        mediaUrl: mediaUrl,
        type: type,
        userName: user.nama || user.email || 'User',
        userPhoto: user.photoUrl || null,
        userId: user.uid,
        createdAt: Date.now(),
        viewedBy: {
          [user.uid]: true
        }
      };

      await set(ref(db, `statuses/${user.uid}/${statusId}`), statusData);
      
      setStatusText('');
      setStatusImage(null);
      setStatusImagePreview(null);
      setShowCreateModal(false);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      showToast("✅ Status berhasil diposting!", "success");

    } catch (err) {
      console.error("Create status error:", err);
      showToast("❌ Gagal posting status: " + err.message, "error");
    } finally {
      setIsUploading(false);
    }
  };

  // ==================== OPEN STATUS VIEWER ====================
  const openStatusViewer = useCallback(async (userId) => {
    if (!user) {
      showToast("Anda harus login!", "error");
      return;
    }

    const isOwnStatus = userId === user.uid;
    if (!isOwnStatus) {
      const isFriendUser = await isFriend(userId);
      if (!isFriendUser) {
        showToast("❌ Anda hanya bisa melihat status teman!", "error");
        return;
      }
    }

    try {
      const snapshot = await get(ref(db, `statuses/${userId}`));
      const statusesData = snapshot.val();
      
      if (!statusesData) {
        showToast("Tidak ada status dari pengguna ini", "info");
        return;
      }

      const now = Date.now();
      const userStatuses = Object.keys(statusesData)
        .filter(key => (now - (statusesData[key].createdAt || 0)) < TWENTY_FOUR_HOURS)
        .map(key => ({ id: key, ...statusesData[key] }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      if (userStatuses.length === 0) {
        showToast("Status sudah kadaluarsa", "info");
        return;
      }

      if (!isOwnStatus) {
        let hasNewStatus = false;
        for (const status of userStatuses) {
          if (!status.viewedBy || !status.viewedBy[user.uid]) {
            await update(ref(db, `statuses/${userId}/${status.id}/viewedBy`), {
              [user.uid]: true
            });
            hasNewStatus = true;
          }
        }
      }

      setCurrentStatusList(userStatuses);
      setCurrentStatusIndex(0);
      setCurrentStatusOwnerId(userId);
      setShowViewerModal(true);
      
      if (statusViewerIntervalRef.current) {
        clearInterval(statusViewerIntervalRef.current);
      }
      statusViewerIntervalRef.current = setInterval(() => {
        setCurrentStatusIndex(prev => {
          if (prev < userStatuses.length - 1) {
            return prev + 1;
          } else {
            clearInterval(statusViewerIntervalRef.current);
            setShowViewerModal(false);
            return prev;
          }
        });
      }, 5000);

    } catch (err) {
      console.error("Error opening status viewer:", err);
      showToast("Gagal memuat status: " + err.message, "error");
    }
  }, [user, isFriend]);

  // ==================== NAVIGATION ====================
  const nextStatus = useCallback(() => {
    if (currentStatusIndex < currentStatusList.length - 1) {
      setCurrentStatusIndex(prev => prev + 1);
    } else {
      setShowViewerModal(false);
      if (statusViewerIntervalRef.current) {
        clearInterval(statusViewerIntervalRef.current);
        statusViewerIntervalRef.current = null;
      }
    }
  }, [currentStatusIndex, currentStatusList.length]);

  const prevStatus = useCallback(() => {
    if (currentStatusIndex > 0) {
      setCurrentStatusIndex(prev => prev - 1);
    }
  }, [currentStatusIndex]);

  // ==================== DELETE STATUS ====================
  const deleteCurrentStatus = useCallback(async () => {
    const currentStatus = currentStatusList[currentStatusIndex];
    if (!currentStatus || currentStatus.userId !== user?.uid) {
      showToast("Anda hanya dapat menghapus status Anda sendiri!", "error");
      return;
    }

    if (!window.confirm("Hapus status ini?")) return;

    setShowViewerModal(false);
    if (statusViewerIntervalRef.current) {
      clearInterval(statusViewerIntervalRef.current);
      statusViewerIntervalRef.current = null;
    }

    try {
      await remove(ref(db, `statuses/${user.uid}/${currentStatus.id}`));
      showToast("✅ Status dihapus", "success");
    } catch (err) {
      console.error("Delete status error:", err);
      showToast("❌ Gagal menghapus status: " + err.message, "error");
    }
  }, [currentStatusList, currentStatusIndex, user]);

  // ==================== ANIMATE STATS ====================
  const animateCounter = (target, setter, duration = 800) => {
    if (target === 0) { setter(0); return null; }
    const start = 0;
    const increment = target / (duration / 16);
    let current = start;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setter(target);
        clearInterval(timer);
      } else {
        setter(Math.floor(current));
      }
    }, 16);
    return timer;
  };

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const hours = now.getHours();
      let greetingText = '';
      if (hours < 5) greetingText = '🌙 Selamat Malam';
      else if (hours < 12) greetingText = '🌅 Selamat Pagi';
      else if (hours < 15) greetingText = '☀️ Selamat Siang';
      else if (hours < 18) greetingText = '🌤️ Selamat Sore';
      else greetingText = '🌙 Selamat Malam';
      setGreeting(greetingText);
      setCurrentDate(now.toLocaleDateString('id-ID', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }));
      setCurrentTime(now.toLocaleTimeString('id-ID', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }));
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Animate stats once
  useEffect(() => {
    if (animationDone.current) {
      setAnimatedStats({
        totalStudents: stats.totalStudents || 0,
        hadirToday: stats.hadirToday || 0,
        tidakHadir: stats.tidakHadir || 0,
        terlambat: stats.terlambat || 0
      });
      const percentage = stats.totalStudents > 0 ? Math.round((stats.hadirToday / stats.totalStudents) * 100) : 0;
      setAttendancePercentage(percentage);
      return;
    }

    const timers = [];
    const percentage = stats.totalStudents > 0 ? Math.round((stats.hadirToday / stats.totalStudents) * 100) : 0;
    setAttendancePercentage(percentage);
    
    timers.push(animateCounter(stats.totalStudents || 0, (val) => 
      setAnimatedStats(prev => ({ ...prev, totalStudents: val }))
    ));
    timers.push(animateCounter(stats.hadirToday || 0, (val) => 
      setAnimatedStats(prev => ({ ...prev, hadirToday: val }))
    ));
    timers.push(animateCounter(stats.tidakHadir || 0, (val) => 
      setAnimatedStats(prev => ({ ...prev, tidakHadir: val }))
    ));
    timers.push(animateCounter(stats.terlambat || 0, (val) => 
      setAnimatedStats(prev => ({ ...prev, terlambat: val }))
    ));
    
    setTimeout(() => { animationDone.current = true; }, 900);
    return () => timers.forEach(timer => timer && clearInterval(timer));
  }, []);

  useEffect(() => {
    if (animationDone.current) {
      setAnimatedStats({
        totalStudents: stats.totalStudents || 0,
        hadirToday: stats.hadirToday || 0,
        tidakHadir: stats.tidakHadir || 0,
        terlambat: stats.terlambat || 0
      });
      const percentage = stats.totalStudents > 0 ? Math.round((stats.hadirToday / stats.totalStudents) * 100) : 0;
      setAttendancePercentage(percentage);
    }
  }, [stats]);

  // ==================== STATUS COLOR ====================
  const getStatusColor = (percentage) => {
    if (percentage >= 80) return '#4caf50';
    if (percentage >= 60) return '#ff9800';
    if (percentage >= 40) return '#f44336';
    return '#d32f2f';
  };

  const getStatusText = (percentage) => {
    if (percentage >= 80) return '🌟 Sangat Baik';
    if (percentage >= 60) return '📊 Baik';
    if (percentage >= 40) return '⚠️ Cukup';
    return '🔴 Perlu Perhatian';
  };

  const statusColor = getStatusColor(attendancePercentage);
  const statusTextLabel = getStatusText(attendancePercentage);

  // ==================== HANDLE TAB CHANGE ====================
  const handleTabChange = (tabId) => {
    if (onTabChange) onTabChange(tabId);
    else window.dispatchEvent(new CustomEvent('tabChange', { detail: { tab: tabId } }));
  };

  // ==================== RENDER STATUS ITEMS ====================
  const renderStatusItems = () => {
    const items = [];

    // ===== STATUS SAYA =====
    const hasMyStatus = myStatuses.length > 0;
    const myLatest = hasMyStatus ? myStatuses[0] : null;
    
    items.push(
      <div 
        key="my-status"
        className="status-item"
        onClick={() => {
          if (hasMyStatus) {
            openStatusViewer(user?.uid);
          } else {
            setShowCreateModal(true);
          }
        }}
      >
        <div className="status-avatar-wrapper">
          <div className="status-avatar">
            <img 
              src={user?.photoUrl || getAvatarUrl(user?.nama || 'User')} 
              alt={user?.nama || 'User'}
              onError={(e) => { e.target.src = getAvatarUrl(user?.nama || 'User'); }}
            />
            {hasMyStatus ? (
              <div className="status-ring active"></div>
            ) : (
              <div className="status-add-icon">+</div>
            )}
          </div>
        </div>
        <div className="status-name">Status Saya</div>
        <div className="status-time">
          {hasMyStatus ? formatTimeAgo(myLatest.createdAt) : 'Tambah Status'}
        </div>
        {hasMyStatus && myStatuses.length > 1 && (
          <div className="status-badge">{myStatuses.length}</div>
        )}
      </div>
    );

    // ===== STATUS TEMAN =====
    const groupedFriends = {};
    for (const status of friendsStatuses) {
      if (!groupedFriends[status.userId]) {
        groupedFriends[status.userId] = [];
      }
      groupedFriends[status.userId].push(status);
    }

    for (const [userId, statuses] of Object.entries(groupedFriends)) {
      const latest = statuses[0];
      const isViewed = latest.viewedBy?.[user?.uid];
      
      items.push(
        <div 
          key={`friend-${userId}`}
          className={`status-item ${!isViewed ? 'unviewed' : ''}`}
          onClick={() => openStatusViewer(userId)}
        >
          <div className="status-avatar-wrapper">
            <div className="status-avatar">
              <img 
                src={latest.userPhoto || getAvatarUrl(latest.userName)} 
                alt={latest.userName}
                onError={(e) => { e.target.src = getAvatarUrl(latest.userName); }}
              />
              {!isViewed && <div className="status-ring"></div>}
            </div>
          </div>
          <div className="status-name">{latest.userName}</div>
          <div className="status-time">{formatTimeAgo(latest.createdAt)}</div>
          {statuses.length > 1 && (
            <div className="status-count">+{statuses.length - 1}</div>
          )}
        </div>
      );
    }

    return items;
  };

  // ==================== RENDER VIEWER MODAL ====================
  const renderViewerModal = () => {
    if (!showViewerModal || currentStatusList.length === 0) return null;

    const currentStatus = currentStatusList[currentStatusIndex];
    if (!currentStatus) return null;

    const isOwner = currentStatusOwnerId === user?.uid;
    const isFirst = currentStatusIndex === 0;
    const isLast = currentStatusIndex === currentStatusList.length - 1;

    const viewerCount = currentStatus.viewedBy ? Object.keys(currentStatus.viewedBy).length : 0;

    return (
      <div 
        className="modal-overlay open modal-status-viewer" 
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowViewerModal(false);
            if (statusViewerIntervalRef.current) {
              clearInterval(statusViewerIntervalRef.current);
              statusViewerIntervalRef.current = null;
            }
          }
        }}
      >
        <div className="modal-status-viewer-content">
          <div className="status-viewer-header">
            <img 
              src={currentStatus.userPhoto || getAvatarUrl(currentStatus.userName)} 
              alt={currentStatus.userName}
              className="status-viewer-avatar"
              onError={(e) => { e.target.src = getAvatarUrl(currentStatus.userName); }}
            />
            <div className="status-viewer-user-info">
              <strong>{currentStatus.userName}</strong>
              <span>{formatTimeAgo(currentStatus.createdAt)}</span>
            </div>
            <button 
              className="status-viewer-close"
              onClick={() => {
                setShowViewerModal(false);
                if (statusViewerIntervalRef.current) {
                  clearInterval(statusViewerIntervalRef.current);
                  statusViewerIntervalRef.current = null;
                }
              }}
            >
              ✕
            </button>
          </div>

          <div className="status-viewer-media" onClick={nextStatus}>
            {currentStatus.type === 'image' && currentStatus.mediaUrl ? (
              <img 
                src={currentStatus.mediaUrl} 
                alt="Status" 
                className="status-full-image"
                onError={(e) => {
                  e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23333"/><text x="100" y="100" text-anchor="middle" dy=".3em" fill="%23fff" font-size="20">📸</text></svg>';
                }}
              />
            ) : (
              <div className="status-full-text">{currentStatus.text}</div>
            )}
          </div>

          <div className="status-viewer-nav">
            <button 
              className="status-nav-btn"
              disabled={isFirst}
              onClick={prevStatus}
            >
              ◀
            </button>
            <span className="status-counter">
              {currentStatusIndex + 1} / {currentStatusList.length}
            </span>
            <button 
              className="status-nav-btn"
              disabled={isLast}
              onClick={nextStatus}
            >
              ▶
            </button>
          </div>

          <div className="status-viewer-actions">
            {isOwner ? (
              <button 
                className="status-action-btn danger"
                onClick={deleteCurrentStatus}
              >
                🗑️ Hapus
              </button>
            ) : (
              <button 
                className="status-action-btn primary"
                onClick={() => {
                  const targetUserId = currentStatus.userId;
                  const targetUserName = currentStatus.userName;
                  
                  handleTabChange('chat');
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('startChatWithFriend', {
                      detail: {
                        friendUid: targetUserId,
                        friendName: targetUserName,
                        friendEmail: currentStatus.userEmail || ''
                      }
                    }));
                  }, 300);
                  
                  setShowViewerModal(false);
                  if (statusViewerIntervalRef.current) {
                    clearInterval(statusViewerIntervalRef.current);
                    statusViewerIntervalRef.current = null;
                  }
                }}
              >
                💬 Balas
              </button>
            )}
            <span className="status-viewer-count">
              👁️ {viewerCount} dilihat
            </span>
          </div>
        </div>
      </div>
    );
  };

  // ==================== RENDER CREATE MODAL ====================
  const renderCreateModal = () => {
    if (!showCreateModal) return null;

    return (
      <div 
        className="modal-overlay open" 
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowCreateModal(false);
            setStatusText('');
            setStatusImage(null);
            setStatusImagePreview(null);
          }
        }}
      >
        <div className="modal-box" style={{ maxWidth: '450px' }}>
          <div className="modal-title">
            <span>📸 Buat Status Baru</span>
            <span 
              className="modal-close"
              onClick={() => {
                setShowCreateModal(false);
                setStatusText('');
                setStatusImage(null);
                setStatusImagePreview(null);
              }}
            >
              ✖
            </span>
          </div>
          <div className="modal-body">
            <div className="form-group">
              <label>✏️ Teks Status</label>
              <textarea
                rows="3"
                placeholder="Tuliskan status Anda..."
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                className="form-textarea"
              />
            </div>
            <div className="form-group">
              <label>📷 Tambah Gambar (Opsional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    setStatusImage(file);
                    const reader = new FileReader();
                    reader.onload = (e) => setStatusImagePreview(e.target.result);
                    reader.readAsDataURL(file);
                  }
                }}
                ref={fileInputRef}
                className="form-file-input"
              />
              {statusImagePreview && (
                <div className="image-preview-container">
                  <img src={statusImagePreview} alt="Preview" className="image-preview" />
                  <button 
                    className="btn-remove-image"
                    onClick={() => {
                      setStatusImage(null);
                      setStatusImagePreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    ✖ Hapus Gambar
                  </button>
                </div>
              )}
              <small className="text-muted">Maksimal 5MB, format: JPG, PNG, GIF</small>
            </div>
          </div>
          <div className="modal-actions">
            <button 
              className="btn-cancel"
              onClick={() => {
                setShowCreateModal(false);
                setStatusText('');
                setStatusImage(null);
                setStatusImagePreview(null);
              }}
            >
              Batal
            </button>
            <button 
              className="btn-save"
              onClick={handleCreateStatus}
              disabled={isUploading}
            >
              {isUploading ? '⏳ Mengupload...' : '📤 Posting Status'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ==================== MAIN RENDER ====================
  return (
    <div className="dashboard-content">
      {/* Toast Notification */}
      {toastMessage && (
        <div className={`status-toast status-toast-${toastMessage.type}`}>
          {toastMessage.message}
        </div>
      )}

      {/* Animated Background */}
      <div className="dashboard-bg-animation">
        <div className="bg-orb orb-1"></div>
        <div className="bg-orb orb-2"></div>
        <div className="bg-orb orb-3"></div>
      </div>

      {/* Welcome Section */}
      <div className="dashboard-welcome">
        <div className="welcome-header">
          <div className="welcome-avatar">
            <img 
              src={profilePhoto || getAvatarUrl(user?.nama || 'User')} 
              alt="Profile"
              onError={(e) => {
                e.target.src = getAvatarUrl(user?.nama?.charAt(0) || 'U');
              }}
            />
            <div className="avatar-status online"></div>
          </div>
          <div className="welcome-text">
            <div className="greeting-container">
              <h2 className="greeting">{greeting}</h2>
              <span className="live-dot"></span>
              <span className="live-text">LIVE</span>
            </div>
            <h1 className="welcome-name">{user?.nama || user?.email}</h1>
            <p className="welcome-role" style={{ color: getRoleColor(user?.role) }}>
              {getRoleIcon(user?.role)} {getRoleDisplayName(user?.role)}
              {isSiswa && user?.kelas && ` • 📚 Kelas ${user.kelas}`}
              {isSiswa && user?.jurusan && ` • 🎓 ${user.jurusan}`}
            </p>
            <div className="datetime-container">
              <p className="welcome-date">📅 {currentDate}</p>
              <p className="welcome-time">🕐 {currentTime}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== STATUS BAR ==================== */}
      <div className="status-bar-container">
        <div className="status-bar-header">
          <span className="status-bar-title">📸 Status</span>
          {unviewedCount > 0 && (
            <span className="status-bar-badge">{unviewedCount} baru</span>
          )}
        </div>
        <div className="status-bar">
          {isLoadingStatus ? (
            <div className="status-loading">⏳ Memuat status...</div>
          ) : (
            <div className="status-list">
              {renderStatusItems()}
              {friendsStatuses.length === 0 && myStatuses.length === 0 && (
                <div className="status-empty">
                  <span>📭</span>
                  <p>Belum ada status. Buat status pertama Anda!</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ==================== REMINDER STATUS BANNER ==================== */}
      {hasReminderPermission && (
        <div className="reminder-status-banner" style={{
          background: 'linear-gradient(135deg, rgba(255,152,0,0.12), rgba(255,152,0,0.04))',
          borderRadius: '12px',
          padding: '10px 18px',
          marginBottom: '20px',
          border: '1px solid rgba(255,152,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px' }}>🔔</span>
            <div>
              <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Pengingat Absensi</span>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                ✅ Aktif
              </div>
            </div>
          </div>
          <button
            onClick={() => handleTabChange('attendance')}
            style={{
              padding: '5px 14px',
              background: '#ff9800',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '12px',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#f57c00';
              e.target.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#ff9800';
              e.target.style.transform = 'scale(1)';
            }}
          >
            📋 Lihat Absensi
          </button>
        </div>
      )}

      {/* Attendance Overview */}
      <div className="attendance-overview">
        <div className="overview-header">
          <h3>📊 Kehadiran Hari Ini</h3>
          <div className="overview-status" style={{ borderColor: statusColor }}>
            <span className="status-indicator" style={{ background: statusColor }}></span>
            <span className="status-text" style={{ color: statusColor }}>{statusTextLabel}</span>
            <span className="status-percentage">{attendancePercentage}%</span>
          </div>
        </div>
        <div className="progress-bar-container">
          <div 
            className="progress-bar-fill" 
            style={{ 
              width: `${attendancePercentage}%`,
              background: `linear-gradient(90deg, ${statusColor}88, ${statusColor})`,
              boxShadow: `0 0 20px ${statusColor}44`
            }}
          >
            <span className="progress-bar-text">{attendancePercentage}%</span>
          </div>
        </div>
        <div className="overview-details">
          <div className="detail-item">
            <span className="detail-dot" style={{ background: '#4caf50' }}></span>
            <span>Hadir: <strong>{animatedStats.hadirToday}</strong> siswa</span>
          </div>
          <div className="detail-item">
            <span className="detail-dot" style={{ background: '#f44336' }}></span>
            <span>Tidak Hadir: <strong>{animatedStats.tidakHadir}</strong> siswa</span>
          </div>
          <div className="detail-item">
            <span className="detail-dot" style={{ background: '#ff9800' }}></span>
            <span>Terlambat: <strong>{animatedStats.terlambat}</strong> siswa</span>
          </div>
          <div className="detail-item">
            <span className="detail-dot" style={{ background: '#2196f3' }}></span>
            <span>Total Siswa: <strong>{animatedStats.totalStudents}</strong></span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid" ref={statsRef}>
        <div className="stat-card stat-card-total">
          <div className="stat-icon-wrapper">
            <div className="stat-icon">👥</div>
            <div className="stat-icon-bg"></div>
          </div>
          <div className="stat-info">
            <div className="stat-number">{animatedStats.totalStudents}</div>
            <div className="stat-label">Total Siswa</div>
          </div>
        </div>

        <div className="stat-card stat-card-hadir">
          <div className="stat-icon-wrapper">
            <div className="stat-icon">✅</div>
            <div className="stat-icon-bg"></div>
          </div>
          <div className="stat-info">
            <div className="stat-number">{animatedStats.hadirToday}</div>
            <div className="stat-label">Hadir Hari Ini</div>
          </div>
        </div>

        <div className="stat-card stat-card-tidak">
          <div className="stat-icon-wrapper">
            <div className="stat-icon">❌</div>
            <div className="stat-icon-bg"></div>
          </div>
          <div className="stat-info">
            <div className="stat-number">{animatedStats.tidakHadir}</div>
            <div className="stat-label">Tidak Hadir</div>
          </div>
        </div>

        <div className="stat-card stat-card-terlambat">
          <div className="stat-icon-wrapper">
            <div className="stat-icon">⏰</div>
            <div className="stat-icon-bg"></div>
          </div>
          <div className="stat-info">
            <div className="stat-number">{animatedStats.terlambat}</div>
            <div className="stat-label">Terlambat</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <div className="quick-actions-header">
          <h4>⚡ Quick Actions</h4>
          <span className="quick-actions-sub">Akses cepat ke fitur utama</span>
        </div>
        <div className="quick-actions-grid">
          <div className="quick-action-item" onClick={() => handleTabChange('attendance')}>
            <div className="quick-action-icon">📋</div>
            <div className="quick-action-label">Absensi Siswa</div>
          </div>
          <div className="quick-action-item" onClick={() => handleTabChange('students')}>
            <div className="quick-action-icon">👨‍🎓</div>
            <div className="quick-action-label">Data Siswa</div>
          </div>
          <div className="quick-action-item" onClick={() => handleTabChange('staff')}>
            <div className="quick-action-icon">👔</div>
            <div className="quick-action-label">Data Staff</div>
          </div>
          <div className="quick-action-item" onClick={() => handleTabChange('rekap')}>
            <div className="quick-action-icon">📊</div>
            <div className="quick-action-label">Rekap Absensi</div>
          </div>
          <div className="quick-action-item" onClick={() => handleTabChange('profile')}>
            <div className="quick-action-icon">👤</div>
            <div className="quick-action-label">Profil Saya</div>
          </div>
        </div>
      </div>

      {/* Real-time Indicator */}
      <div className="realtime-indicator">
        <div className="realtime-pulse">
          <span className="pulse-dot"></span>
          <span className="pulse-text">Real-time Monitoring</span>
        </div>
        <div className="realtime-time">
          <span>🔄 Last updated: {currentTime}</span>
        </div>
      </div>

      {/* ==================== FAB CAMERA ==================== */}
      <button 
        className="camera-fab"
        onClick={() => setShowCreateModal(true)}
        title="Buat Status"
      >
        <span className="camera-icon">📷</span>
      </button>

      {/* ==================== MODALS ==================== */}
      {renderViewerModal()}
      {renderCreateModal()}
    </div>
  );
};

export default DashboardContent;