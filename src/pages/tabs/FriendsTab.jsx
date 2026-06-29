// src/pages/tabs/FriendsTab.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, off, get, set, update, remove } from 'firebase/database';
import { db } from '../../firebase/config';
import './FriendsTab.css';

const FriendsTab = ({ user, onStartChat }) => {
  // ==================== STATE ====================
  const [loading, setLoading] = useState(true);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendsList, setFriendsList] = useState([]);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [friendRequestCount, setFriendRequestCount] = useState(0);
  const [friendsCount, setFriendsCount] = useState(0);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  
  // Refs untuk listeners
  const requestsListenerRef = useRef(null);
  const friendsListenerRef = useRef(null);
  const userDataCache = useRef({});

  // ==================== ROLE HELPER ====================
  const getRoleDisplayName = (role) => {
    const names = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala',
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

  // ==================== UTILITY FUNCTIONS ====================
  const getAvatarUrl = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=00bcd4&color=fff&size=100`;
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days} hari yang lalu`;
    if (hours > 0) return `${hours} jam yang lalu`;
    if (minutes > 0) return `${minutes} menit yang lalu`;
    return 'baru saja';
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // ==================== SHOW TOAST / ALERT ====================
  const showToast = (message, type = 'info') => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else {
      window.alert(message);
    }
  };

  const showConfirm = (message) => {
    return window.confirm(message);
  };

  // ==================== GET USER FULL DATA (TERMASUK KELAS & JURUSAN) ====================
  const getUserFullData = useCallback(async (uid) => {
    try {
      console.log('🔍 [FriendsTab] Getting full data for uid:', uid);
      
      // 1. Ambil dari users_auth
      const authSnapshot = await get(ref(db, `users_auth/${uid}`));
      const authData = authSnapshot.val();
      
      if (!authData) {
        console.warn('⚠️ [FriendsTab] User not found in users_auth:', uid);
        return null;
      }

      let userData = { ...authData, uid };
      console.log('📋 [FriendsTab] Auth data:', authData);

      // 2. Jika siswa, ambil dari node users
      if (authData.role === 'siswa') {
        let fpId = authData.fpId || authData.userId;
        console.log('🔍 [FriendsTab] Looking for student with fpId:', fpId);
        
        // Cari fpId berdasarkan email atau nama
        if (!fpId && authData.email) {
          const usersSnapshot = await get(ref(db, 'users'));
          const users = usersSnapshot.val();
          if (users) {
            for (const [id, user] of Object.entries(users)) {
              if (user.email === authData.email || user.nama === authData.nama) {
                fpId = id;
                console.log('🔍 [FriendsTab] Found fpId by email/name:', fpId);
                break;
              }
            }
          }
        }

        if (fpId) {
          const userSnapshot = await get(ref(db, `users/${fpId}`));
          const user = userSnapshot.val();
          if (user) {
            console.log('📋 [FriendsTab] Student data from users:', user);
            userData = {
              ...userData,
              kelas: user.kelas || '-',
              jurusan: user.jurusan || '-',
              noHp: user.noHp || user.parentPhone || '-',
              fpId: fpId,
              delayOut: user.delayOut || 60
            };
            // Update nama jika ada di users
            if (user.nama) userData.nama = user.nama;
          } else {
            console.warn('⚠️ [FriendsTab] Student not found in users with fpId:', fpId);
          }
        } else {
          console.warn('⚠️ [FriendsTab] No fpId found for student:', authData.nama);
        }
      }

      // 3. Jika staff, ambil dari node staff
      if (authData.role !== 'siswa' && authData.role !== 'developer') {
        let staffId = authData.staffId || authData.userId;
        console.log('🔍 [FriendsTab] Looking for staff with staffId:', staffId);
        
        if (staffId) {
          const staffSnapshot = await get(ref(db, `staff/${staffId}`));
          const staff = staffSnapshot.val();
          if (staff) {
            console.log('📋 [FriendsTab] Staff data:', staff);
            userData = {
              ...userData,
              jabatan: staff.jabatan || '-',
              departemen: staff.departemen || '-',
              noHp: staff.noHp || '-',
              staffId: staffId
            };
            if (staff.nama) userData.nama = staff.nama;
          } else {
            console.warn('⚠️ [FriendsTab] Staff not found with staffId:', staffId);
          }
        } else {
          console.warn('⚠️ [FriendsTab] No staffId found for staff:', authData.nama);
        }
      }

      console.log('✅ [FriendsTab] Final user data:', userData);
      return userData;
    } catch (error) {
      console.error('❌ [FriendsTab] Error getting user full data:', error);
      return null;
    }
  }, []);

  // ==================== FRIEND REQUESTS LISTENER ====================
  const setupFriendRequestsListener = useCallback(() => {
    if (!user?.uid) return;

    if (requestsListenerRef.current) {
      off(ref(db, 'friendships/requests'), requestsListenerRef.current);
    }

    const requestsRef = ref(db, 'friendships/requests');
    const listener = onValue(requestsRef, (snapshot) => {
      const data = snapshot.val();
      const pending = [];
      
      if (data) {
        Object.keys(data).forEach(key => {
          if (data[key].to === user.uid && data[key].status === 'pending') {
            pending.push({ id: key, ...data[key] });
          }
        });
      }
      
      setFriendRequests(pending);
      setFriendRequestCount(pending.length);
    });

    requestsListenerRef.current = listener;
  }, [user?.uid]);

  // ==================== FRIENDS LIST LISTENER ====================
  const enrichFriendsWithLatestData = useCallback(async (friends) => {
    if (!friends || friends.length === 0) return [];

    const friendUids = friends.map(f => f.friendUid).filter(Boolean);
    if (friendUids.length === 0) return friends;

    const missingUids = [];
    const enrichedList = [];

    for (const friend of friends) {
      const uid = friend.friendUid;
      if (userDataCache.current[uid]) {
        // Ambil data lengkap dari cache (termasuk kelas & jurusan)
        const cached = userDataCache.current[uid];
        enrichedList.push({
          ...friend,
          friendName: cached.nama || friend.friendName,
          friendEmail: cached.email || friend.friendEmail,
          friendPhoto: cached.photoUrl || null,
          friendRole: cached.role || 'siswa',
          friendKelas: cached.kelas || null,
          friendJurusan: cached.jurusan || null,
          friendNoHp: cached.noHp || null,
          friendFpId: cached.fpId || null
        });
      } else {
        missingUids.push(uid);
        enrichedList.push(friend);
      }
    }

    if (missingUids.length === 0) {
      return enrichedList;
    }

    try {
      // Ambil data lengkap untuk user yang missing
      const fullDataPromises = missingUids.map(uid => getUserFullData(uid));
      const fullDataResults = await Promise.all(fullDataPromises);

      fullDataResults.forEach((fullData, index) => {
        const uid = missingUids[index];
        if (fullData) {
          userDataCache.current[uid] = fullData;
        }
      });

      return friends.map(friend => {
        const latest = userDataCache.current[friend.friendUid];
        if (latest) {
          return {
            ...friend,
            friendName: latest.nama || friend.friendName,
            friendEmail: latest.email || friend.friendEmail,
            friendPhoto: latest.photoUrl || null,
            friendRole: latest.role || 'siswa',
            friendKelas: latest.kelas || null,
            friendJurusan: latest.jurusan || null,
            friendNoHp: latest.noHp || null,
            friendFpId: latest.fpId || null
          };
        }
        return friend;
      });
    } catch (error) {
      console.error('Error enriching friends data:', error);
      return friends;
    }
  }, [getUserFullData]);

  const setupFriendsListListener = useCallback(() => {
    if (!user?.uid) return;

    if (friendsListenerRef.current) {
      off(ref(db, `friendships/list/${user.uid}`), friendsListenerRef.current);
    }

    const listRef = ref(db, `friendships/list/${user.uid}`);
    const listener = onValue(listRef, async (snapshot) => {
      const data = snapshot.val();
      const friendsList = data ? Object.values(data) : [];
      
      setFriendsCount(friendsList.length);

      if (friendsList.length === 0) {
        setFriendsList([]);
        setLoading(false);
        return;
      }

      const enriched = await enrichFriendsWithLatestData(friendsList);
      setFriendsList(enriched);
      setLoading(false);
    });

    friendsListenerRef.current = listener;
  }, [user?.uid, enrichFriendsWithLatestData]);

  // ==================== SEARCH USER (DIPERBAIKI - TANPA ONCLICK HTML) ====================
  const searchUserByEmail = useCallback(async () => {
    if (!searchEmail.trim()) {
      showToast('Masukkan email yang ingin dicari!', 'error');
      return;
    }

    if (searchEmail.toLowerCase() === user?.email?.toLowerCase()) {
      showToast('❌ Anda tidak bisa berteman dengan diri sendiri!', 'error');
      return;
    }

    setSearching(true);
    setSearchResult(null);

    try {
      const snapshot = await get(ref(db, 'users_auth'));
      const users = snapshot.val();
      let foundUser = null;
      let foundUid = null;

      if (users) {
        for (const [uid, userData] of Object.entries(users)) {
          if (userData.email && userData.email.toLowerCase() === searchEmail.toLowerCase()) {
            foundUser = userData;
            foundUid = uid;
            break;
          }
        }
      }

      if (foundUser && foundUid) {
        // Ambil data lengkap user (termasuk kelas & jurusan)
        const fullData = await getUserFullData(foundUid);
        const userWithDetails = fullData || foundUser;

        const friendCheck = await get(ref(db, `friendships/list/${user.uid}/${foundUid}`));
        const isFriend = friendCheck.exists();

        const requestsSnapshot = await get(ref(db, 'friendships/requests'));
        const requests = requestsSnapshot.val();
        let hasPendingRequest = false;
        let hasIncomingRequest = false;
        let incomingRequestId = null;

        if (requests) {
          hasPendingRequest = Object.values(requests).some(req => 
            req.from === user.uid && req.to === foundUid && req.status === 'pending'
          );
          
          // Cek apakah ada request masuk dari user yang dicari
          const incomingReq = Object.entries(requests).find(([id, req]) => 
            req.from === foundUid && req.to === user.uid && req.status === 'pending'
          );
          if (incomingReq) {
            hasIncomingRequest = true;
            incomingRequestId = incomingReq[0];
          }
        }

        let statusMessage = '';
        if (isFriend) {
          statusMessage = '✅ Anda sudah berteman';
        } else if (hasPendingRequest) {
          statusMessage = '⏳ Permintaan sudah dikirim, menunggu konfirmasi';
        } else if (hasIncomingRequest) {
          statusMessage = '📨 Pengguna ini mengirimkan permintaan pertemanan';
        } else {
          statusMessage = '👤 Pengguna tersedia untuk ditambahkan';
        }

        let roleDisplay = '';
        if (userWithDetails.role === 'admin') {
          roleDisplay = '👑 Kepala Sekolah';
        } else if (userWithDetails.role === 'guru') {
          roleDisplay = '👨‍🏫 Guru';
        } else if (userWithDetails.role === 'developer') {
          roleDisplay = '👨‍💻 Developer';
        } else if (userWithDetails.role === 'siswa') {
          roleDisplay = `👨‍🎓 Siswa`;
          if (userWithDetails.kelas && userWithDetails.kelas !== '-') {
            roleDisplay += ` 📚 ${userWithDetails.kelas}`;
          }
          if (userWithDetails.jurusan && userWithDetails.jurusan !== '-') {
            roleDisplay += ` 🎓 ${userWithDetails.jurusan}`;
          }
        } else {
          roleDisplay = '👤 User';
        }

        setSearchResult({
          user: userWithDetails,
          uid: foundUid,
          isFriend,
          hasPendingRequest,
          hasIncomingRequest,
          incomingRequestId,
          statusMessage,
          roleDisplay
        });
      } else {
        setSearchResult({ error: true, email: searchEmail });
      }
    } catch (error) {
      console.error('Search error:', error);
      showToast('❌ Gagal mencari pengguna', 'error');
    } finally {
      setSearching(false);
    }
  }, [searchEmail, user, getUserFullData]);

  // ==================== SEND FRIEND REQUEST ====================
  const sendFriendRequest = useCallback(async (toUid, toName, toEmail) => {
    if (!user) {
      showToast('Anda harus login!', 'error');
      return;
    }
    if (toUid === user.uid) {
      showToast('❌ Anda tidak bisa mengirim request ke diri sendiri!', 'error');
      return;
    }

    try {
      const friendCheck = await get(ref(db, `friendships/list/${user.uid}/${toUid}`));
      if (friendCheck.exists()) {
        showToast('👥 Anda sudah berteman dengan pengguna ini!', 'info');
        return;
      }

      const requestsSnapshot = await get(ref(db, 'friendships/requests'));
      const requests = requestsSnapshot.val();
      
      if (requests) {
        const hasPending = Object.values(requests).some(req => 
          req.from === user.uid && req.to === toUid && req.status === 'pending'
        );
        if (hasPending) {
          showToast('⏳ Permintaan pertemanan sudah dikirim sebelumnya!', 'info');
          return;
        }

        const hasIncoming = Object.values(requests).some(req => 
          req.from === toUid && req.to === user.uid && req.status === 'pending'
        );
        if (hasIncoming) {
          const incomingReq = Object.entries(requests).find(([id, req]) => 
            req.from === toUid && req.to === user.uid && req.status === 'pending'
          );
          if (incomingReq) {
            await acceptFriendRequest(incomingReq[0], toUid);
            return;
          }
        }
      }

      const requestId = `${user.uid}_${toUid}_${Date.now()}`;
      const requestData = {
        from: user.uid,
        to: toUid,
        fromName: user.nama,
        toName: toName,
        fromEmail: user.email,
        toEmail: toEmail,
        fromPhoto: user.photoUrl || null,
        toPhoto: null,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await set(ref(db, `friendships/requests/${requestId}`), requestData);
      showToast(`✅ Permintaan pertemanan dikirim ke ${toName}`, 'success');

      setSearchEmail('');
      setSearchResult(null);

    } catch (error) {
      console.error('Send friend request error:', error);
      showToast('❌ Gagal mengirim permintaan', 'error');
    }
  }, [user]);

  // ==================== ACCEPT FRIEND REQUEST ====================
  const acceptFriendRequest = useCallback(async (requestId, fromUid) => {
    if (!user) {
      showToast('Anda harus login!', 'error');
      return;
    }

    try {
      const existingFriend = await get(ref(db, `friendships/list/${user.uid}/${fromUid}`));
      if (existingFriend.exists()) {
        showToast('👥 Anda sudah berteman dengan pengguna ini.', 'info');
        await remove(ref(db, `friendships/requests/${requestId}`));
        return;
      }

      const senderFullData = await getUserFullData(fromUid);
      const senderData = senderFullData || {};
      const senderName = senderData.nama || fromUid;

      await update(ref(db, `friendships/requests/${requestId}`), {
        status: 'accepted',
        updatedAt: Date.now()
      });

      const now = Date.now();

      const friendDataForCurrent = {
        friendUid: fromUid,
        friendName: senderData.nama || fromUid,
        friendEmail: senderData.email || '',
        friendPhoto: senderData.photoUrl || null,
        createdAt: now
      };

      const friendDataForTarget = {
        friendUid: user.uid,
        friendName: user.nama,
        friendEmail: user.email,
        friendPhoto: user.photoUrl || null,
        createdAt: now
      };

      await Promise.all([
        set(ref(db, `friendships/list/${user.uid}/${fromUid}`), friendDataForCurrent),
        set(ref(db, `friendships/list/${fromUid}/${user.uid}`), friendDataForTarget)
      ]);

      await remove(ref(db, `friendships/requests/${requestId}`));

      showToast(`✅ Anda sekarang berteman dengan ${senderName}!`, 'success');

      setFriendRequests(prev => prev.filter(req => req.id !== requestId));
      setFriendRequestCount(prev => prev - 1);

      // Update cache
      if (senderFullData) {
        userDataCache.current[fromUid] = senderFullData;
      }

    } catch (error) {
      console.error('Accept friend request error:', error);
      showToast('❌ Gagal menerima permintaan', 'error');
    }
  }, [user, getUserFullData]);

  // ==================== REJECT FRIEND REQUEST ====================
  const rejectFriendRequest = useCallback(async (requestId, fromUid) => {
    if (!user) return;

    if (!showConfirm('❌ Tolak permintaan pertemanan ini?')) return;

    try {
      const senderFullData = await getUserFullData(fromUid);
      const senderName = senderFullData?.nama || fromUid;

      await remove(ref(db, `friendships/requests/${requestId}`));
      showToast(`✅ Permintaan pertemanan dari ${senderName} ditolak`, 'info');

      setFriendRequests(prev => prev.filter(req => req.id !== requestId));
      setFriendRequestCount(prev => prev - 1);

    } catch (error) {
      console.error('Reject friend request error:', error);
      showToast('❌ Gagal menolak permintaan', 'error');
    }
  }, [user, getUserFullData]);

  // ==================== REMOVE FRIEND ====================
  const removeFriend = useCallback(async (friendUid, friendName) => {
    if (!user) {
      showToast('Anda harus login!', 'error');
      return;
    }

    if (!showConfirm(`⚠️ Hapus ${friendName} dari daftar teman?\n\nAnda tidak akan bisa melihat profil dan chat dengannya.`)) return;

    try {
      await Promise.all([
        remove(ref(db, `friendships/list/${user.uid}/${friendUid}`)),
        remove(ref(db, `friendships/list/${friendUid}/${user.uid}`))
      ]);

      showToast(`✅ ${friendName} telah dihapus dari daftar teman`, 'success');
      setFriendsList(prev => prev.filter(f => f.friendUid !== friendUid));
      setFriendsCount(prev => prev - 1);

      // Hapus dari cache
      delete userDataCache.current[friendUid];

    } catch (error) {
      console.error('Remove friend error:', error);
      showToast('❌ Gagal menghapus teman', 'error');
    }
  }, [user]);

  // ==================== START CHAT ====================
  const startChatWithFriend = useCallback(async (friendUid, friendName, friendEmail) => {
    // Check if friend
    const friendCheck = await get(ref(db, `friendships/list/${user.uid}/${friendUid}`));
    if (!friendCheck.exists()) {
      showToast('Anda tidak bisa chat dengan orang yang bukan teman!', 'error');
      return;
    }

    // Gunakan prop onStartChat jika tersedia
    if (onStartChat && typeof onStartChat === 'function') {
      onStartChat(friendUid, friendName, friendEmail);
      return;
    }

    // Fallback: gunakan event dan window functions
    // 1. Switch ke tab chat
    if (typeof window.switchTab === 'function') {
      window.switchTab('chat');
    }

    // 2. Dispatch event untuk memulai chat
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('startChatWithFriend', {
        detail: {
          friendUid,
          friendName,
          friendEmail
        }
      }));
    }, 300);

    showToast(`💬 Memulai chat dengan ${friendName}...`, 'info');
  }, [user, onStartChat]);

  // ==================== VIEW FRIEND PROFILE (DENGAN KELAS & JURUSAN) ====================
  const viewFriendProfile = useCallback(async (friendUid) => {
    try {
      console.log('👤 [FriendsTab] Viewing profile for friend:', friendUid);
      
      // Gunakan fungsi getUserFullData untuk ambil data lengkap
      const friendData = await getUserFullData(friendUid);
      
      if (!friendData) {
        showToast('❌ Data teman tidak ditemukan', 'error');
        return;
      }
      
      console.log('✅ [FriendsTab] Friend full data:', friendData);
      setSelectedFriend(friendData);
      setShowProfileModal(true);
    } catch (error) {
      console.error('❌ [FriendsTab] Load friend profile error:', error);
      showToast('❌ Gagal memuat profil', 'error');
    }
  }, [getUserFullData]);

  // ==================== INITIALIZE LISTENERS ====================
  useEffect(() => {
    if (user?.uid) {
      setupFriendRequestsListener();
      setupFriendsListListener();
    }

    return () => {
      if (requestsListenerRef.current) {
        off(ref(db, 'friendships/requests'), requestsListenerRef.current);
      }
      if (friendsListenerRef.current) {
        off(ref(db, `friendships/list/${user?.uid}`), friendsListenerRef.current);
      }
    };
  }, [user?.uid, setupFriendRequestsListener, setupFriendsListListener]);

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="friends-tab-container">
        <div className="friends-loading">
          <div className="loading-spinner"></div>
          <p>⏳ Memuat data teman...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="friends-tab-container">
      <div className="friends-header">
        <h2>👥 Teman</h2>
        <div className="friends-stats">
          <span className="stat-badge">
            <span className="stat-icon">👥</span>
            <span className="stat-value">{friendsCount}</span>
            <span className="stat-label">Teman</span>
          </span>
          <span className="stat-badge">
            <span className="stat-icon">📨</span>
            <span className="stat-value">{friendRequestCount}</span>
            <span className="stat-label">Permintaan</span>
          </span>
        </div>
      </div>

      {/* ===== SEARCH SECTION ===== */}
      <div className="friends-search-section">
        <h4>🔍 Cari Teman</h4>
        <div className="search-box">
          <input
            type="email"
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            placeholder="Cari berdasarkan email..."
            className="search-input"
            onKeyPress={(e) => e.key === 'Enter' && searchUserByEmail()}
          />
          <button 
            className="btn-search" 
            onClick={searchUserByEmail}
            disabled={searching}
          >
            {searching ? '⏳' : '🔍 Cari'}
          </button>
        </div>

        {/* ===== SEARCH RESULT (DIPERBAIKI - TANPA ONCLICK HTML) ===== */}
        {searchResult && (
          <div className={`search-result ${searchResult.error ? 'error' : ''}`}>
            {searchResult.error ? (
              <div className="result-error">
                ❌ Pengguna dengan email "{searchResult.email}" tidak ditemukan
              </div>
            ) : (
              <div className="result-item">
                <div className="result-avatar">
                  <img 
                    src={searchResult.user.photoUrl || getAvatarUrl(searchResult.user.nama)} 
                    alt={searchResult.user.nama}
                    onError={(e) => {
                      e.target.src = getAvatarUrl(searchResult.user.nama);
                    }}
                  />
                </div>
                <div className="result-info">
                  <div className="result-name">{searchResult.user.nama}</div>
                  <div className="result-email">{searchResult.user.email}</div>
                  <div className="result-role">{searchResult.roleDisplay}</div>
                  <div className="result-status" style={{ marginTop: '4px' }}>
                    <small style={{ 
                      color: searchResult.isFriend ? '#4caf50' : 
                             searchResult.hasPendingRequest ? '#ff9800' : 
                             searchResult.hasIncomingRequest ? '#2196f3' : '#888'
                    }}>
                      {searchResult.statusMessage}
                    </small>
                  </div>
                </div>
                <div className="result-actions">
                  {searchResult.isFriend ? (
                    <button className="btn-action" disabled style={{ 
                      background: '#4caf50', 
                      color: 'white', 
                      padding: '8px 16px', 
                      borderRadius: '30px', 
                      border: 'none',
                      opacity: 0.7,
                      cursor: 'default'
                    }}>
                      ✓ Sudah Teman
                    </button>
                  ) : searchResult.hasPendingRequest ? (
                    <button className="btn-action" disabled style={{ 
                      background: '#ff9800', 
                      color: 'white', 
                      padding: '8px 16px', 
                      borderRadius: '30px', 
                      border: 'none',
                      opacity: 0.7,
                      cursor: 'default'
                    }}>
                      ⏳ Menunggu
                    </button>
                  ) : searchResult.hasIncomingRequest ? (
                    <button 
                      className="btn-action btn-success" 
                      onClick={() => {
                        if (searchResult.incomingRequestId) {
                          acceptFriendRequest(searchResult.incomingRequestId, searchResult.uid);
                        }
                      }}
                      style={{ 
                        background: '#4caf50', 
                        color: 'white', 
                        padding: '8px 16px', 
                        borderRadius: '30px', 
                        border: 'none', 
                        cursor: 'pointer',
                        fontWeight: 'bold'
                      }}
                      onMouseEnter={(e) => { e.target.style.background = '#388e3c'; }}
                      onMouseLeave={(e) => { e.target.style.background = '#4caf50'; }}
                    >
                      ✅ Terima
                    </button>
                  ) : (
                    <button 
                      className="btn-action btn-primary" 
                      onClick={() => sendFriendRequest(searchResult.uid, searchResult.user.nama, searchResult.user.email)}
                      style={{ 
                        background: '#00bcd4', 
                        color: 'white', 
                        padding: '8px 16px', 
                        borderRadius: '30px', 
                        border: 'none', 
                        cursor: 'pointer',
                        fontWeight: 'bold'
                      }}
                      onMouseEnter={(e) => { e.target.style.background = '#0097a7'; }}
                      onMouseLeave={(e) => { e.target.style.background = '#00bcd4'; }}
                    >
                      ➕ Kirim
                    </button>
                  )}
                </div>
              </div>
            )}
            <button className="btn-close-result" onClick={() => setSearchResult(null)}>✖</button>
          </div>
        )}
      </div>

      {/* ===== FRIEND REQUESTS ===== */}
      <div className="friends-requests-section">
        <h4>
          📨 Permintaan Pertemanan
          {friendRequestCount > 0 && (
            <span className="request-badge">{friendRequestCount}</span>
          )}
        </h4>
        {friendRequests.length === 0 ? (
          <p className="empty-message">📭 Tidak ada permintaan pertemanan</p>
        ) : (
          <div className="requests-list">
            {friendRequests.map((req) => (
              <div key={req.id} className="request-item">
                <div className="request-avatar">
                  <img 
                    src={req.fromPhoto || getAvatarUrl(req.fromName)} 
                    alt={req.fromName}
                  />
                </div>
                <div className="request-info">
                  <div className="request-name">{req.fromName}</div>
                  <div className="request-email">{req.fromEmail}</div>
                  <div className="request-time">{formatTimeAgo(req.createdAt)}</div>
                </div>
                <div className="request-actions">
                  <button 
                    className="btn-accept" 
                    onClick={() => acceptFriendRequest(req.id, req.from)}
                    title="Terima"
                  >
                    ✅
                  </button>
                  <button 
                    className="btn-reject" 
                    onClick={() => rejectFriendRequest(req.id, req.from)}
                    title="Tolak"
                  >
                    ❌
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== FRIENDS LIST ===== */}
      <div className="friends-list-section">
        <h4>
          👥 Daftar Teman
          <span className="count-badge">{friendsCount}</span>
        </h4>
        {friendsList.length === 0 ? (
          <p className="empty-message">👥 Belum ada teman. Cari dan tambahkan teman!</p>
        ) : (
          <div className="friends-grid">
            {friendsList.map((friend) => {
              const roleDisplay = getRoleDisplayName(friend.friendRole || 'siswa');
              const roleIcon = getRoleIcon(friend.friendRole || 'siswa');
              const isSiswa = friend.friendRole === 'siswa';
              
              return (
                <div key={friend.friendUid} className="friend-card">
                  <div className="friend-avatar">
                    <img 
                      src={friend.friendPhoto || getAvatarUrl(friend.friendName)} 
                      alt={friend.friendName}
                      onError={(e) => {
                        e.target.src = getAvatarUrl(friend.friendName);
                      }}
                    />
                    <div className="friend-status online"></div>
                  </div>
                  <div className="friend-info">
                    <div className="friend-name">{friend.friendName}</div>
                    <div className="friend-email">{friend.friendEmail}</div>
                    {/* ⭐ HANYA TAMPILKAN KELAS & JURUSAN UNTUK SISWA */}
                    {isSiswa && (
                      <div className="friend-details" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                        {friend.friendKelas && friend.friendKelas !== '-' && (
                          <span>📚 {friend.friendKelas}</span>
                        )}
                        {friend.friendJurusan && friend.friendJurusan !== '-' && (
                          <span> {friend.friendJurusan}</span>
                        )}
                      </div>
                    )}
                    <div className="friend-role" style={{ color: getRoleColor(friend.friendRole) }}>
                      {roleIcon} {roleDisplay}
                    </div>
                    <div className="friend-since">Teman sejak {formatDate(friend.createdAt)}</div>
                  </div>
                  <div className="friend-actions">
                    <button 
                      className="btn-chat" 
                      onClick={() => startChatWithFriend(friend.friendUid, friend.friendName, friend.friendEmail)}
                      title="Chat"
                    >
                      💬
                    </button>
                    <button 
                      className="btn-profile" 
                      onClick={() => viewFriendProfile(friend.friendUid)}
                      title="Lihat Profil"
                    >
                      👤
                    </button>
                    <button 
                      className="btn-remove" 
                      onClick={() => removeFriend(friend.friendUid, friend.friendName)}
                      title="Hapus Teman"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== PROFILE MODAL (HANYA TAMPILKAN KELAS & JURUSAN UNTUK SISWA) ===== */}
      {showProfileModal && selectedFriend && (
        <div className="modal-overlay open" onClick={() => setShowProfileModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <span>👤 Profil {selectedFriend.nama}</span>
              <span className="modal-close" onClick={() => setShowProfileModal(false)}>✖</span>
            </div>
            <div className="modal-body">
              <div className="profile-avatar">
                <img 
                  src={selectedFriend.photoUrl || getAvatarUrl(selectedFriend.nama)} 
                  alt={selectedFriend.nama}
                  onError={(e) => {
                    e.target.src = getAvatarUrl(selectedFriend.nama);
                  }}
                />
              </div>
              <h3>{selectedFriend.nama}</h3>
              <p className="profile-email">{selectedFriend.email}</p>
              <div className="profile-role" style={{ 
                background: getRoleColor(selectedFriend.role),
                color: 'white',
                padding: '4px 16px',
                borderRadius: '20px',
                display: 'inline-block'
              }}>
                {getRoleIcon(selectedFriend.role)} {getRoleDisplayName(selectedFriend.role)}
              </div>
              <div className="profile-details">
                {/* ⭐ HANYA TAMPILKAN KELAS & JURUSAN UNTUK SISWA */}
                {selectedFriend.role === 'siswa' && (
                  <>
                    <div className="detail-row">
                      <span className="detail-label">📚 Kelas:</span>
                      <span className="detail-value" style={{ color: '#00bcd4', fontWeight: 'bold' }}>
                        {selectedFriend.kelas || '-'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">🎓 Jurusan:</span>
                      <span className="detail-value" style={{ color: '#00bcd4', fontWeight: 'bold' }}>
                        {selectedFriend.jurusan || '-'}
                      </span>
                    </div>
                    {selectedFriend.noHp && selectedFriend.noHp !== '-' && (
                      <div className="detail-row">
                        <span className="detail-label">📱 WhatsApp:</span>
                        <span className="detail-value" style={{ color: '#25D366' }}>
                          {selectedFriend.noHp}
                        </span>
                      </div>
                    )}
                    {selectedFriend.fpId && (
                      <div className="detail-row">
                        <span className="detail-label">🆔 ID:</span>
                        <span className="detail-value" style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                          {selectedFriend.fpId}
                        </span>
                      </div>
                    )}
                  </>
                )}
                
                {/* ⭐ TAMPILKAN JABATAN UNTUK STAFF (bukan siswa) */}
                {selectedFriend.role !== 'siswa' && selectedFriend.role !== 'developer' && (
                  <>
                    <div className="detail-row">
                      <span className="detail-label">📋 Jabatan:</span>
                      <span className="detail-value" style={{ fontWeight: 'bold' }}>
                        {selectedFriend.jabatan || '-'}
                      </span>
                    </div>
                    {selectedFriend.departemen && selectedFriend.departemen !== '-' && (
                      <div className="detail-row">
                        <span className="detail-label">🏢 Departemen:</span>
                        <span className="detail-value">{selectedFriend.departemen}</span>
                      </div>
                    )}
                    {selectedFriend.noHp && selectedFriend.noHp !== '-' && (
                      <div className="detail-row">
                        <span className="detail-label">📱 WhatsApp:</span>
                        <span className="detail-value" style={{ color: '#25D366' }}>
                          {selectedFriend.noHp}
                        </span>
                      </div>
                    )}
                  </>
                )}
                
                {/* ⭐ TAMPILKAN INFO DEVELOPER */}
                {selectedFriend.role === 'developer' && (
                  <div className="detail-row">
                    <span className="detail-label">💻 Role:</span>
                    <span className="detail-value" style={{ color: '#9b59b6', fontWeight: 'bold' }}>
                      👨‍💻 Developer
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowProfileModal(false)}>Tutup</button>
              <button 
                className="btn-chat-profile" 
                onClick={() => {
                  setShowProfileModal(false);
                  startChatWithFriend(selectedFriend.uid, selectedFriend.nama, selectedFriend.email);
                }}
              >
                💬 Chat
              </button>
              <button 
                className="btn-remove-profile" 
                onClick={() => {
                  setShowProfileModal(false);
                  removeFriend(selectedFriend.uid, selectedFriend.nama);
                }}
              >
                🗑️ Hapus Teman
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FriendsTab;