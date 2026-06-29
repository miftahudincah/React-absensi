// src/components/Status/StatusManager.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ref, onValue, off, get, set, update, remove } from 'firebase/database';
import { db } from '../../firebase/config';
import './StatusManager.css';

// ==================== BACKEND API CONFIGURATION ====================
const API_BASE_URL = 'https://backendtest-azure.vercel.app';

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

const deleteFromBackend = async (fileUrl) => {
  try {
    if (!fileUrl || !fileUrl.includes('supabase.co')) {
      console.log('Not a Supabase URL, skipping delete');
      return true;
    }

    const token = localStorage.getItem('authToken');

    const response = await fetch(`${API_BASE_URL}/api/storage/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ fileUrl })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Delete failed');
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error('Delete error:', error);
    return false;
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
const StatusManager = ({ user, onStatusUpdate, activeTab }) => {
  // ==================== STATE ====================
  const [statuses, setStatuses] = useState([]);
  const [myStatuses, setMyStatuses] = useState([]);
  const [friendsStatuses, setFriendsStatuses] = useState([]);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewerModal, setShowViewerModal] = useState(false);
  const [showRepliesModal, setShowRepliesModal] = useState(false);
  const [showViewersModal, setShowViewersModal] = useState(false);
  const [currentStatusList, setCurrentStatusList] = useState([]);
  const [currentStatusIndex, setCurrentStatusIndex] = useState(0);
  const [currentStatusOwnerId, setCurrentStatusOwnerId] = useState(null);
  const [statusText, setStatusText] = useState('');
  const [statusImage, setStatusImage] = useState(null);
  const [statusImagePreview, setStatusImagePreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [viewers, setViewers] = useState([]);
  const [replies, setReplies] = useState([]);
  const [friendsCache, setFriendsCache] = useState(new Map());
  const [friendsCacheTimestamp, setFriendsCacheTimestamp] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [modalKey, setModalKey] = useState(0);

  // ==================== REFS ====================
  const statusesListenerRef = useRef(null);
  const statusViewerIntervalRef = useRef(null);
  const statusExpiryIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const toastTimeoutRef = useRef(null);

  // ==================== CONSTANTS ====================
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const FRIENDS_CACHE_TTL = 60000;

  // ==================== HELPERS ====================
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

  // ==================== TOAST NOTIFICATION ====================
  const showToast = (message, type = 'info') => {
    setToastMessage({ message, type });
    
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // ==================== FRIENDS CACHE ====================
  const isFriend = useCallback(async (userId) => {
    if (!user) return false;
    if (userId === user.uid) return true;

    const now = Date.now();
    if (friendsCache.has(userId) && (now - friendsCacheTimestamp) < FRIENDS_CACHE_TTL) {
      return friendsCache.get(userId);
    }

    try {
      const snapshot = await get(ref(db, `friendships/list/${user.uid}/${userId}`));
      const result = snapshot.exists();
      setFriendsCache(prev => new Map(prev).set(userId, result));
      setFriendsCacheTimestamp(now);
      return result;
    } catch (err) {
      console.error("Error checking friend status:", err);
      return false;
    }
  }, [user, friendsCache, friendsCacheTimestamp]);

  // ==================== GET UNVIEWED STATUS COUNT ====================
  const updateUnviewedStatusCount = useCallback((statusList) => {
    if (!user) return;
    
    let count = 0;
    for (const status of statusList) {
      if (status.userId !== user.uid && !status.viewedBy?.[user.uid]) {
        count++;
      }
    }
    
    setUnviewedCount(count);
    
    if (onStatusUpdate) {
      onStatusUpdate(count);
    }
    
    window.dispatchEvent(new CustomEvent('statusBadgeUpdate', {
      detail: { count }
    }));
  }, [user, onStatusUpdate]);

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
            if (status.mediaUrl && status.mediaUrl.includes('supabase.co')) {
              try {
                await deleteFromBackend(status.mediaUrl);
              } catch (err) {
                console.warn("Failed to delete expired status image:", err);
              }
            }
            await remove(ref(db, `status_replies/${statusId}`)).catch(() => {});
            await remove(ref(db, `statuses/${userId}/${statusId}`)).catch(() => {});
            continue;
          }
          
          if (createdAt && (now - createdAt) < TWENTY_FOUR_HOURS) {
            const isNewForCurrentUser = userId !== user.uid && 
              (!status.viewedBy || !status.viewedBy[user.uid]);
            
            if (!groupedByUser[userId]) groupedByUser[userId] = [];
            groupedByUser[userId].push({
              id: statusId,
              userId: userId,
              isNew: isNewForCurrentUser,
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
    
    const allStatuses = [...myStatusesList, ...friendStatusesList];
    setStatuses(allStatuses);
    updateUnviewedStatusCount(allStatuses);
    setIsLoading(false);
    setHasLoaded(true);
    
  }, [user, isFriend, updateUnviewedStatusCount]);

  // ==================== STATUS LISTENER ====================
  useEffect(() => {
    if (!user?.uid) return;

    const setupStatusListener = () => {
      if (statusesListenerRef.current) {
        off(ref(db, 'statuses'), statusesListenerRef.current);
        statusesListenerRef.current = null;
      }

      const listener = onValue(ref(db, 'statuses'), (snapshot) => {
        const data = snapshot.val();
        processStatusData(data);
      });

      statusesListenerRef.current = listener;
    };

    setupStatusListener();

    const expiryInterval = setInterval(() => {
      get(ref(db, 'statuses')).catch(() => {});
    }, 60 * 60 * 1000);
    statusExpiryIntervalRef.current = expiryInterval;

    const handleRefresh = () => {
      get(ref(db, 'statuses')).catch(() => {});
    };
    window.addEventListener('refreshStatuses', handleRefresh);

    return () => {
      if (statusesListenerRef.current) {
        off(ref(db, 'statuses'), statusesListenerRef.current);
        statusesListenerRef.current = null;
      }
      if (statusExpiryIntervalRef.current) {
        clearInterval(statusExpiryIntervalRef.current);
        statusExpiryIntervalRef.current = null;
      }
      if (statusViewerIntervalRef.current) {
        clearInterval(statusViewerIntervalRef.current);
        statusViewerIntervalRef.current = null;
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
      window.removeEventListener('refreshStatuses', handleRefresh);
    };
  }, [user, processStatusData]);

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
    let mediaPath = null;
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
        mediaPath = result.path;
        type = 'image';
      }

      const statusId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const statusData = {
        text: text || (type === 'image' ? '📸 ' : ''),
        mediaUrl: mediaUrl,
        mediaPath: mediaPath,
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

      setTimeout(() => {
        get(ref(db, 'statuses')).catch(() => {});
      }, 500);

    } catch (err) {
      console.error("Create status error:", err);
      showToast("❌ Gagal posting status: " + err.message, "error");
      
      if (mediaPath) {
        await deleteFromBackend(mediaPath);
      }
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
        
        if (hasNewStatus) {
          get(ref(db, 'statuses'));
        }
      }

      setModalKey(prev => prev + 1);
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
      if (currentStatus.mediaUrl && currentStatus.mediaUrl.includes('supabase.co')) {
        await deleteFromBackend(currentStatus.mediaUrl);
      }

      await remove(ref(db, `status_replies/${currentStatus.id}`));
      await remove(ref(db, `statuses/${user.uid}/${currentStatus.id}`));

      setTimeout(() => {
        get(ref(db, 'statuses')).catch(() => {});
      }, 300);

      showToast("✅ Status dihapus", "success");
    } catch (err) {
      console.error("Delete status error:", err);
      showToast("❌ Gagal menghapus status: " + err.message, "error");
      setShowViewerModal(true);
    }
  }, [currentStatusList, currentStatusIndex, user]);

  // ==================== VIEWERS ====================
  const showViewers = useCallback(async (userId, statusId) => {
    try {
      const snapshot = await get(ref(db, `statuses/${userId}/${statusId}/viewedBy`));
      const viewersData = snapshot.val() || {};
      const viewerUids = Object.keys(viewersData);

      if (viewerUids.length === 0) {
        showToast("Belum ada yang melihat status ini", "info");
        return;
      }

      const userPromises = viewerUids.map(uid => get(ref(db, `users_auth/${uid}`)));
      const userSnapshots = await Promise.all(userPromises);

      const viewersList = [];
      for (const snap of userSnapshots) {
        if (snap.exists()) {
          const viewer = snap.val();
          viewersList.push({
            uid: snap.key,
            nama: viewer.nama,
            photoUrl: viewer.photoUrl,
            role: viewer.role
          });
        }
      }

      setViewers(viewersList);
      setShowViewersModal(true);
    } catch (err) {
      console.error("Error loading viewers:", err);
      showToast("❌ Gagal memuat daftar viewer: " + err.message, "error");
    }
  }, []);

  // ==================== REPLIES ====================
  const sendReply = useCallback(async (statusId) => {
    if (!replyMessage.trim()) {
      showToast("Balasan tidak boleh kosong!", "error");
      return;
    }

    const targetStatus = currentStatusList.find(s => s.id === statusId);
    if (!targetStatus) {
      showToast("Tidak dapat menemukan data status", "error");
      return;
    }

    try {
      const replyId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const statusPreview = targetStatus.type === 'image' ? '📸 [Gambar]' : 
        `“${targetStatus.text?.substring(0, 60) || ''}${targetStatus.text?.length > 60 ? '…' : ''}”`;

      const replyData = {
        fromUid: user.uid,
        fromName: user.nama,
        fromPhoto: user.photoUrl || null,
        message: replyMessage.trim(),
        timestamp: Date.now(),
        statusId: statusId,
        statusPreview: statusPreview,
        statusType: targetStatus.type
      };

      await set(ref(db, `status_replies/${statusId}/${replyId}`), replyData);

      const chatMessageId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const chatMessageText = `📸 Balasan status dari ${targetStatus.userName}: ${statusPreview}\n\n💬 ${replyMessage.trim()}`;
      
      const messageData = {
        id: chatMessageId,
        from: user.uid,
        to: targetStatus.userId,
        message: chatMessageText,
        type: 'text',
        timestamp: Date.now(),
        read: false,
        replyToStatus: {
          statusId: statusId,
          statusPreview: statusPreview,
          replyMessage: replyMessage.trim()
        }
      };

      await Promise.all([
        set(ref(db, `chats/${user.uid}/messages/${targetStatus.userId}/${chatMessageId}`), messageData),
        set(ref(db, `chats/${targetStatus.userId}/messages/${user.uid}/${chatMessageId}`), messageData),
        update(ref(db, `chats/${targetStatus.userId}/inbox/${user.uid}`), {
          lastMessage: chatMessageText,
          lastMessageType: 'text',
          lastMessageTime: Date.now(),
          unreadCount: 0
        }),
        update(ref(db, `chats/${user.uid}/inbox/${targetStatus.userId}`), {
          lastMessage: chatMessageText,
          lastMessageType: 'text',
          lastMessageTime: Date.now(),
          unreadCount: 0
        })
      ]);

      setReplyMessage('');
      setShowRepliesModal(false);
      showToast(`✅ Balasan terkirim ke ${targetStatus.userName}`, "success");

    } catch (err) {
      console.error("Send reply error:", err);
      showToast("❌ Gagal mengirim balasan: " + err.message, "error");
    }
  }, [replyMessage, currentStatusList, user]);

  const showReplies = useCallback(async (statusId) => {
    try {
      const snapshot = await get(ref(db, `status_replies/${statusId}`));
      const repliesData = snapshot.val() || {};
      const repliesList = Object.values(repliesData)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
      setReplies(repliesList);
      setShowRepliesModal(true);
    } catch (err) {
      console.error("Error loading replies:", err);
      showToast("❌ Gagal memuat balasan: " + err.message, "error");
    }
  }, []);

  // ==================== RENDER STATUS ITEMS ====================
  // ==================== PERBAIKAN UTAMA: TOMBOL + SELALU ADA ====================
  const renderStatusItems = useCallback(() => {
    const items = [];

    // ===== STATUS SAYA - SELALU TAMPIL DENGAN TOMBOL + =====
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
              src={user?.photoUrl || getAvatarUrl(user?.nama || user?.email || 'User')} 
              alt={user?.nama || 'User'}
              onError={(e) => {
                e.target.src = getAvatarUrl(user?.nama || 'User');
              }}
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

    // ===== 🔥 TOMBOL TAMBAH STATUS - SELALU TAMPIL (FIX) =====
    items.push(
      <div 
        key="add-status"
        className="status-item add-status-btn"
        onClick={() => setShowCreateModal(true)}
        title="Buat Status Baru"
      >
        <div className="status-avatar-wrapper">
          <div className="status-avatar add-avatar">
            <div className="add-status-circle">
              <span className="add-status-plus">+</span>
            </div>
          </div>
        </div>
        <div className="status-name" style={{ color: '#00bcd4' }}>Tambah</div>
        <div className="status-time" style={{ color: 'var(--text-muted)' }}>Status Baru</div>
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
                onError={(e) => {
                  e.target.src = getAvatarUrl(latest.userName);
                }}
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
  }, [myStatuses, friendsStatuses, user, openStatusViewer]);

  // ==================== RENDER VIEWER MODAL ====================
  const renderViewerModal = useMemo(() => {
    if (!showViewerModal || currentStatusList.length === 0) return null;

    const currentStatus = currentStatusList[currentStatusIndex];
    if (!currentStatus) return null;

    const isOwner = currentStatusOwnerId === user?.uid;
    const isFirst = currentStatusIndex === 0;
    const isLast = currentStatusIndex === currentStatusList.length - 1;

    const viewerCount = currentStatus.viewedBy ? Object.keys(currentStatus.viewedBy).length : 0;

    return (
      <div 
        key={`viewer-modal-${modalKey}`}
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
              onError={(e) => {
                e.target.src = getAvatarUrl(currentStatus.userName);
              }}
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
              <>
                <button 
                  className="status-action-btn danger"
                  onClick={deleteCurrentStatus}
                >
                  🗑️ Hapus
                </button>
                <button 
                  className="status-action-btn"
                  onClick={() => showViewers(currentStatusOwnerId, currentStatus.id)}
                >
                  👁️ {viewerCount > 0 && `(${viewerCount})`} Lihat Viewer
                </button>
                <button 
                  className="status-action-btn"
                  onClick={() => showReplies(currentStatus.id)}
                >
                  💬 Lihat Balasan ({replies.length})
                </button>
              </>
            ) : (
              <>
                <button 
                  className="status-action-btn primary"
                  onClick={() => {
                    setReplyMessage('');
                    setShowRepliesModal(true);
                  }}
                >
                  💬 Balas
                </button>
                <button 
                  className="status-action-btn"
                  onClick={() => showViewers(currentStatusOwnerId, currentStatus.id)}
                >
                  👁️ {viewerCount > 0 && `(${viewerCount})`} Lihat Viewer
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }, [showViewerModal, currentStatusList, currentStatusIndex, currentStatusOwnerId, user, nextStatus, prevStatus, deleteCurrentStatus, showViewers, showReplies, replies.length, modalKey]);

  // ==================== RENDER ====================
  return (
    <div className="status-manager">
      {/* Toast Notification */}
      {toastMessage && (
        <div className={`status-toast status-toast-${toastMessage.type}`}>
          {toastMessage.message}
        </div>
      )}

      {/* Status Bar */}
      <div className="status-bar" id="statusBar">
        {isLoading ? (
          <div className="status-loading">⏳ Memuat status...</div>
        ) : (
          <div className="status-list">
            {renderStatusItems()}
          </div>
        )}
      </div>

      {/* Create Status Modal */}
      {showCreateModal && (
        <div 
          key="create-modal"
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
                      reader.onload = (e) => {
                        setStatusImagePreview(e.target.result);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  ref={fileInputRef}
                  className="form-file-input"
                />
                {statusImagePreview && (
                  <div className="image-preview-container">
                    <img 
                      src={statusImagePreview} 
                      alt="Preview" 
                      className="image-preview"
                    />
                    <button 
                      className="btn-remove-image"
                      onClick={() => {
                        setStatusImage(null);
                        setStatusImagePreview(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
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
      )}

      {/* Status Viewer Modal */}
      {renderViewerModal}

      {/* Viewers Modal */}
      {showViewersModal && (
        <div 
          key="viewers-modal"
          className="modal-overlay open" 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowViewersModal(false);
          }}
        >
          <div className="modal-box" style={{ maxWidth: '400px' }}>
            <div className="modal-title">
              <span>👁️ Dilihat oleh ({viewers.length})</span>
              <span className="modal-close" onClick={() => setShowViewersModal(false)}>✖</span>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {viewers.length === 0 ? (
                <div className="text-center text-muted">Belum ada yang melihat</div>
              ) : (
                viewers.map((v) => (
                  <div key={v.uid} className="viewer-item">
                    <img 
                      src={v.photoUrl || getAvatarUrl(v.nama)} 
                      alt={v.nama}
                      className="viewer-avatar"
                      onError={(e) => {
                        e.target.src = getAvatarUrl(v.nama);
                      }}
                    />
                    <div>
                      <div className="viewer-name">{v.nama}</div>
                      <div className="viewer-role">
                        {v.role === 'siswa' ? '👨‍🎓 Siswa' : 
                         v.role === 'guru' ? '👨‍🏫 Guru' : '👑 Admin'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowViewersModal(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replies Modal */}
      {showRepliesModal && (
        <div 
          key="replies-modal"
          className="modal-overlay open" 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowRepliesModal(false);
              setReplyMessage('');
            }
          }}
        >
          <div className="modal-box" style={{ maxWidth: '500px' }}>
            <div className="modal-title">
              <span>💬 Balasan Status</span>
              <span 
                className="modal-close" 
                onClick={() => {
                  setShowRepliesModal(false);
                  setReplyMessage('');
                }}
              >
                ✖
              </span>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {replies.length === 0 ? (
                <div className="text-center text-muted">📭 Belum ada balasan</div>
              ) : (
                replies.map((reply, index) => (
                  <div key={index} className="reply-item">
                    <img 
                      src={reply.fromPhoto || getAvatarUrl(reply.fromName)} 
                      alt={reply.fromName}
                      className="reply-avatar"
                      onError={(e) => {
                        e.target.src = getAvatarUrl(reply.fromName);
                      }}
                    />
                    <div className="reply-content">
                      <div className="reply-name">{reply.fromName}</div>
                      <div className="reply-message">{reply.message}</div>
                      <div className="reply-time">{formatTimeAgo(reply.timestamp)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: '10px' }}>
              <div style={{ width: '100%', display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="Tulis balasan..."
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  className="form-input"
                  style={{ flex: 1 }}
                />
                <button 
                  className="btn-save"
                  onClick={() => {
                    const statusId = currentStatusList[currentStatusIndex]?.id;
                    if (statusId) sendReply(statusId);
                  }}
                >
                  Kirim
                </button>
              </div>
              <button 
                className="btn-cancel" 
                onClick={() => {
                  setShowRepliesModal(false);
                  setReplyMessage('');
                }}
                style={{ width: '100%' }}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusManager;