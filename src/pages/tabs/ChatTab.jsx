// src/pages/tabs/ChatTab.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue, off, get, set, update, remove, runTransaction } from 'firebase/database';
import { db } from '../../firebase/config';
import './ChatTab.css';

// API Base URL
const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const ChatTab = ({ user }) => {
  // ==================== STATE ====================
  const [loading, setLoading] = useState(true);
  const [chatList, setChatList] = useState([]);
  const [currentChatWith, setCurrentChatWith] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [chatPartnerData, setChatPartnerData] = useState(null);
  const [friendCheckCache, setFriendCheckCache] = useState({});
  const [userDataCache, setUserDataCache] = useState({});

  // Refs
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const chatMessagesListenerRef = useRef(null);
  const inboxListenerRef = useRef(null);
  const inputRef = useRef(null);

  // ==================== TOKEN MANAGEMENT ====================
  const getAuthToken = useCallback(async () => {
    let token = localStorage.getItem('authToken');
    if (token) return token;
    
    if (auth?.currentUser) {
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

  // ==================== UPLOAD IMAGE TO SUPABASE VIA BACKEND ====================
  const uploadImageToSupabase = useCallback(async (file) => {
    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Token tidak ditemukan. Silakan login kembali.');
      }

      const formData = new FormData();
      formData.append('image', file);
      formData.append('folder', 'chat');

      console.log('📤 Uploading image to Supabase via backend...');

      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload gagal');
      }

      if (result.success && result.data && result.data.url) {
        console.log('✅ Image uploaded to Supabase:', result.data.url);
        return { 
          success: true, 
          url: result.data.url,
          path: result.data.path 
        };
      } else {
        throw new Error(result.error || 'Upload gagal - tidak ada URL');
      }
    } catch (error) {
      console.error('❌ Upload image error:', error);
      return { success: false, error: error.message };
    }
  }, [getAuthToken]);

  // ==================== DELETE IMAGE FROM SUPABASE ====================
  const deleteImageFromSupabase = useCallback(async (imageUrl) => {
    if (!imageUrl || !imageUrl.includes('supabase.co')) {
      return { success: true };
    }

    try {
      const token = await getAuthToken();
      if (!token) {
        console.warn('⚠️ Token tidak ditemukan, skip delete');
        return { success: true };
      }

      console.log('🗑️ Deleting image from Supabase:', imageUrl);

      const response = await fetch(`${API_BASE_URL}/storage/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ fileUrl: imageUrl })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Image deleted from Supabase');
        return { success: true };
      } else {
        console.warn('⚠️ Failed to delete image:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Delete image error:', error);
      return { success: false, error: error.message };
    }
  }, [getAuthToken]);

  // ==================== CHECK IF IMAGE IS FROM SUPABASE ====================
  const isSupabaseImage = useCallback((url) => {
    return url && url.includes('supabase.co');
  }, []);

  // ==================== UTILITY FUNCTIONS ====================
  const getAvatarUrl = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=00bcd4&color=fff&size=100`;
  };

  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
  };

  const formatChatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / 3600000);
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return minutes === 0 ? 'Baru saja' : `${minutes}m`;
    } else if (diff < 86400000) {
      return `${hours} jam`;
    } else if (diff < 604800000) {
      return `${Math.floor(diff / 86400000)}h`;
    } else {
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    }
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

  // ==================== SCROLL TO BOTTOM ====================
  const scrollToBottom = () => {
    setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 100);
  };

  // ==================== GET USER DATA ====================
  const getUserData = useCallback(async (uid) => {
    if (!uid) return null;
    
    if (userDataCache[uid]) {
      return userDataCache[uid];
    }

    try {
      const snapshot = await get(ref(db, `users_auth/${uid}`));
      if (snapshot.exists()) {
        const data = snapshot.val();
        setUserDataCache(prev => ({ ...prev, [uid]: data }));
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error getting user data:', error);
      return null;
    }
  }, [userDataCache]);

  // ==================== CHECK FRIEND ====================
  const checkIsFriend = useCallback(async (friendUid) => {
    if (!user?.uid || !friendUid) return false;
    
    if (friendCheckCache[friendUid] !== undefined) {
      return friendCheckCache[friendUid];
    }

    try {
      const snapshot = await get(ref(db, `friendships/list/${user.uid}/${friendUid}`));
      const isFriend = snapshot.exists();
      setFriendCheckCache(prev => ({ ...prev, [friendUid]: isFriend }));
      return isFriend;
    } catch (error) {
      console.error('Error checking friend:', error);
      return false;
    }
  }, [user?.uid, friendCheckCache]);

  // ==================== LOAD CHAT MESSAGES ====================
  const loadChatMessages = useCallback(async (friendUid) => {
    if (!user?.uid || !friendUid) return;

    if (chatMessagesListenerRef.current) {
      off(ref(db, `chats/${user.uid}/messages/${currentChatWith}`), chatMessagesListenerRef.current);
      chatMessagesListenerRef.current = null;
    }

    const friendData = await getUserData(friendUid);
    if (!friendData) {
      showToast('❌ Pengguna tidak ditemukan', 'error');
      setCurrentChatWith(null);
      setMessages([]);
      setChatPartnerData(null);
      return;
    }

    const isFriend = await checkIsFriend(friendUid);
    if (!isFriend) {
      showToast('Anda tidak bisa chat dengan orang yang bukan teman!', 'error');
      setCurrentChatWith(null);
      setMessages([]);
      setChatPartnerData(null);
      return;
    }

    try {
      await update(ref(db, `chats/${user.uid}/inbox/${friendUid}`), {
        unreadCount: 0
      });
      setUnreadCounts(prev => ({ ...prev, [friendUid]: 0 }));
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }

    try {
      const friendSnapshot = await get(ref(db, `users_auth/${friendUid}`));
      if (friendSnapshot.exists()) {
        const data = friendSnapshot.val();
        setChatPartnerData({ uid: friendUid, ...data });
        setUserDataCache(prev => ({ ...prev, [friendUid]: data }));
      } else {
        setChatPartnerData(null);
      }
    } catch (error) {
      console.error('Error loading friend data:', error);
      setChatPartnerData(null);
    }

    const messagesRef = ref(db, `chats/${user.uid}/messages/${friendUid}`);
    const listener = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      const messagesList = [];
      if (data) {
        Object.entries(data).forEach(([msgId, msg]) => {
          messagesList.push({ id: msgId, ...msg });
        });
        messagesList.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      }
      setMessages(messagesList);
      scrollToBottom();
    });

    chatMessagesListenerRef.current = listener;
    setCurrentChatWith(friendUid);

    return () => {
      if (chatMessagesListenerRef.current) {
        off(messagesRef, chatMessagesListenerRef.current);
        chatMessagesListenerRef.current = null;
      }
    };
  }, [user?.uid, currentChatWith, checkIsFriend, getUserData]);

  // ==================== LOAD CHAT LIST ====================
  const loadChatList = useCallback(async () => {
    if (!user?.uid) {
      setChatList([]);
      setLoading(false);
      return;
    }

    try {
      const inboxSnapshot = await get(ref(db, `chats/${user.uid}/inbox`));
      const inbox = inboxSnapshot.val();

      if (!inbox || Object.keys(inbox).length === 0) {
        setChatList([]);
        setLoading(false);
        return;
      }

      const friendUids = Object.keys(inbox);
      const chatListData = [];
      const missingUids = [];

      for (const friendUid of friendUids) {
        let friendData = userDataCache[friendUid];
        if (!friendData) {
          if (window.dbData?.users_auth) {
            const found = window.dbData.users_auth.find(u => u.uid === friendUid);
            if (found) {
              friendData = found;
              setUserDataCache(prev => ({ ...prev, [friendUid]: found }));
            }
          }
        }

        if (!friendData) {
          missingUids.push(friendUid);
        }

        const chatInfo = inbox[friendUid];
        if (!chatInfo) continue;

        chatListData.push({
          uid: friendUid,
          nama: friendData?.nama || null,
          email: friendData?.email || null,
          photoUrl: friendData?.photoUrl || null,
          lastMessage: chatInfo.lastMessage || '',
          lastMessageType: chatInfo.lastMessageType || 'text',
          lastMessageTime: chatInfo.lastMessageTime || 0,
          unreadCount: chatInfo.unreadCount || 0,
          exists: !!friendData
        });
      }

      if (missingUids.length > 0) {
        const snapshots = await Promise.all(
          missingUids.map(uid => get(ref(db, `users_auth/${uid}`)))
        );
        snapshots.forEach(snap => {
          if (snap.exists()) {
            const data = snap.val();
            setUserDataCache(prev => ({ ...prev, [snap.key]: data }));
            const idx = chatListData.findIndex(c => c.uid === snap.key);
            if (idx !== -1) {
              chatListData[idx].nama = data.nama || null;
              chatListData[idx].email = data.email || null;
              chatListData[idx].photoUrl = data.photoUrl || null;
              chatListData[idx].exists = true;
            }
          } else {
            const idx = chatListData.findIndex(c => c.uid === snap.key);
            if (idx !== -1) {
              chatListData[idx].exists = false;
            }
          }
        });
      }

      const filteredData = chatListData.filter(chat => {
        if (!chat.exists) return false;
        if (!chat.nama || chat.nama === 'Pengguna tidak dikenal' || chat.nama.trim() === '') {
          return false;
        }
        return true;
      });

      filteredData.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
      setChatList(filteredData);
      setLoading(false);

      const invalidUids = chatListData
        .filter(chat => !chat.exists || !chat.nama || chat.nama === 'Pengguna tidak dikenal')
        .map(chat => chat.uid);

      if (invalidUids.length > 0) {
        for (const uid of invalidUids) {
          try {
            await remove(ref(db, `chats/${user.uid}/inbox/${uid}`));
            await remove(ref(db, `chats/${user.uid}/messages/${uid}`));
            console.log(`🧹 Cleaned up invalid chat with ${uid}`);
          } catch (err) {
            console.warn('Cleanup error:', err);
          }
        }
      }

    } catch (error) {
      console.error('Error loading chat list:', error);
      setChatList([]);
      setLoading(false);
    }
  }, [user?.uid, userDataCache]);

  // ==================== SELECT CHAT ====================
  const selectChat = useCallback(async (friendUid) => {
    if (!friendUid) return;

    const friendData = await getUserData(friendUid);
    if (!friendData) {
      showToast('❌ Pengguna tidak ditemukan', 'error');
      try {
        await remove(ref(db, `chats/${user.uid}/inbox/${friendUid}`));
        await remove(ref(db, `chats/${user.uid}/messages/${friendUid}`));
        loadChatList();
      } catch (err) {
        console.warn('Cleanup error:', err);
      }
      return;
    }

    const isFriend = await checkIsFriend(friendUid);
    if (!isFriend) {
      showToast('Anda tidak bisa chat dengan orang yang bukan teman!', 'error');
      return;
    }

    if (chatMessagesListenerRef.current) {
      off(ref(db, `chats/${user.uid}/messages/${currentChatWith}`), chatMessagesListenerRef.current);
      chatMessagesListenerRef.current = null;
    }

    setCurrentChatWith(friendUid);
    await loadChatMessages(friendUid);
  }, [user?.uid, currentChatWith, checkIsFriend, loadChatMessages, getUserData, loadChatList]);

  // ==================== SEND MESSAGE ====================
  const sendMessage = useCallback(async () => {
    const message = messageInput.trim();
    if (!message || !currentChatWith || sending) return;

    const friendData = await getUserData(currentChatWith);
    if (!friendData) {
      showToast('❌ Pengguna tidak ditemukan', 'error');
      setCurrentChatWith(null);
      setMessages([]);
      setChatPartnerData(null);
      loadChatList();
      return;
    }

    const isFriend = await checkIsFriend(currentChatWith);
    if (!isFriend) {
      showToast('Anda tidak bisa chat dengan orang yang bukan teman!', 'error');
      return;
    }

    setSending(true);
    const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const timestamp = Date.now();

    const messageData = {
      id: messageId,
      from: user.uid,
      to: currentChatWith,
      message: message,
      type: 'text',
      timestamp: timestamp,
      read: false
    };

    try {
      await Promise.all([
        set(ref(db, `chats/${user.uid}/messages/${currentChatWith}/${messageId}`), messageData),
        set(ref(db, `chats/${currentChatWith}/messages/${user.uid}/${messageId}`), messageData),
        update(ref(db, `chats/${currentChatWith}/inbox/${user.uid}`), {
          lastMessage: message,
          lastMessageType: 'text',
          lastMessageTime: timestamp,
          unreadCount: (unreadCounts[currentChatWith] || 0) + 1
        }),
        update(ref(db, `chats/${user.uid}/inbox/${currentChatWith}`), {
          lastMessage: message,
          lastMessageType: 'text',
          lastMessageTime: timestamp,
          unreadCount: 0
        })
      ]);

      setMessageInput('');
      if (inputRef.current) inputRef.current.focus();
      scrollToBottom();

    } catch (error) {
      console.error('Send message error:', error);
      showToast('❌ Gagal mengirim pesan', 'error');
    } finally {
      setSending(false);
    }
  }, [messageInput, currentChatWith, user?.uid, sending, unreadCounts, checkIsFriend, getUserData, loadChatList]);

  // ==================== SEND IMAGE - MIGRASI KE SUPABASE ====================
  const sendImage = useCallback(async (file) => {
    if (!file || !currentChatWith) return;

    const friendData = await getUserData(currentChatWith);
    if (!friendData) {
      showToast('❌ Pengguna tidak ditemukan', 'error');
      setCurrentChatWith(null);
      setMessages([]);
      setChatPartnerData(null);
      loadChatList();
      return;
    }

    const isFriend = await checkIsFriend(currentChatWith);
    if (!isFriend) {
      showToast('Anda tidak bisa chat dengan orang yang bukan teman!', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('❌ Ukuran gambar maksimal 5MB!', 'error');
      return;
    }

    setUploadingImage(true);

    try {
      // ⭐ UPLOAD KE SUPABASE VIA BACKEND ⭐
      const result = await uploadImageToSupabase(file);
      if (!result.success) {
        throw new Error(result.error || 'Upload gagal');
      }
      const mediaUrl = result.url;

      const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const timestamp = Date.now();

      const messageData = {
        id: messageId,
        from: user.uid,
        to: currentChatWith,
        message: '📷 Gambar',
        type: 'image',
        mediaUrl: mediaUrl,
        mediaUrlPath: result.path || null,
        timestamp: timestamp,
        read: false,
        deletedBy: [] // Array untuk track siapa yang sudah hapus
      };

      await Promise.all([
        set(ref(db, `chats/${user.uid}/messages/${currentChatWith}/${messageId}`), messageData),
        set(ref(db, `chats/${currentChatWith}/messages/${user.uid}/${messageId}`), messageData),
        update(ref(db, `chats/${currentChatWith}/inbox/${user.uid}`), {
          lastMessage: '📷 Gambar',
          lastMessageType: 'image',
          lastMessageTime: timestamp,
          unreadCount: (unreadCounts[currentChatWith] || 0) + 1
        }),
        update(ref(db, `chats/${user.uid}/inbox/${currentChatWith}`), {
          lastMessage: '📷 Gambar',
          lastMessageType: 'image',
          lastMessageTime: timestamp,
          unreadCount: 0
        })
      ]);

      scrollToBottom();

    } catch (error) {
      console.error('Send image error:', error);
      showToast('❌ Gagal mengirim gambar: ' + error.message, 'error');
    } finally {
      setUploadingImage(false);
    }
  }, [currentChatWith, user?.uid, unreadCounts, checkIsFriend, getUserData, loadChatList, uploadImageToSupabase]);

  // ==================== DELETE IMAGE WITH TWO-WAY CONFIRMATION ====================
  const handleDeleteImageMessage = useCallback(async (friendUid, messageId, messageData) => {
    try {
      const mediaUrl = messageData.mediaUrl;
      const isSupabase = isSupabaseImage(mediaUrl);

      // 1. Update pesan di sisi user saat ini (tandai dihapus)
      await update(ref(db, `chats/${user.uid}/messages/${friendUid}/${messageId}`), {
        deleted: true,
        deletedAt: Date.now(),
        deletedBy: user.uid
      });

      // 2. Cek pesan di sisi teman
      const friendMessageSnapshot = await get(ref(db, `chats/${friendUid}/messages/${user.uid}/${messageId}`));
      const friendMessageData = friendMessageSnapshot.val();

      // 3. Jika teman juga sudah menghapus pesan ini, maka hapus file dari Supabase
      if (friendMessageData && friendMessageData.deleted === true) {
        console.log('🔍 Kedua user sudah menghapus pesan, menghapus gambar dari Supabase...');
        
        if (isSupabase) {
          await deleteImageFromSupabase(mediaUrl);
        }
        
        // Hapus pesan dari kedua sisi
        await Promise.all([
          remove(ref(db, `chats/${user.uid}/messages/${friendUid}/${messageId}`)),
          remove(ref(db, `chats/${friendUid}/messages/${user.uid}/${messageId}`))
        ]);
        
        console.log('✅ Gambar dihapus dari Supabase dan pesan dihapus dari kedua sisi');
      } else {
        console.log('✅ Pesan dihapus dari sisi user, menunggu teman juga menghapus');
      }

      // Refresh chat list dan messages
      if (currentChatWith === friendUid) {
        loadChatMessages(friendUid);
      }
      loadChatList();

    } catch (error) {
      console.error('❌ Delete image message error:', error);
      showToast('❌ Gagal menghapus pesan', 'error');
    }
  }, [user?.uid, currentChatWith, loadChatMessages, loadChatList, deleteImageFromSupabase, isSupabaseImage]);

  // ==================== DELETE MESSAGE ====================
  const deleteMessage = useCallback(async (friendUid, messageId) => {
    if (!showConfirm('Hapus pesan ini? Pesan hanya akan hilang dari sisi Anda.')) return;

    try {
      const msgSnapshot = await get(ref(db, `chats/${user.uid}/messages/${friendUid}/${messageId}`));
      const msgData = msgSnapshot.val();

      if (!msgData) {
        showToast('❌ Pesan tidak ditemukan', 'error');
        return;
      }

      // ⭐ Jika pesan adalah gambar, gunakan handler khusus
      if (msgData.type === 'image') {
        await handleDeleteImageMessage(friendUid, messageId, msgData);
        return;
      }

      // Untuk pesan teks biasa
      const inboxSnapshot = await get(ref(db, `chats/${user.uid}/inbox/${friendUid}`));
      const inboxData = inboxSnapshot.val();
      const wasLastMessage = inboxData?.lastMessageTime === msgData?.timestamp;

      await remove(ref(db, `chats/${user.uid}/messages/${friendUid}/${messageId}`));

      if (wasLastMessage) {
        const remainingSnapshot = await get(ref(db, `chats/${user.uid}/messages/${friendUid}`));
        const remaining = remainingSnapshot.val();
        if (remaining) {
          const messagesList = Object.entries(remaining).map(([id, msg]) => ({ id, ...msg }));
          const lastMsg = messagesList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
          if (lastMsg) {
            await update(ref(db, `chats/${user.uid}/inbox/${friendUid}`), {
              lastMessage: lastMsg.type === 'image' ? '📷 Gambar' : lastMsg.message,
              lastMessageType: lastMsg.type || 'text',
              lastMessageTime: lastMsg.timestamp
            });
          } else {
            await remove(ref(db, `chats/${user.uid}/inbox/${friendUid}`));
            await remove(ref(db, `chats/${user.uid}/messages/${friendUid}`));
          }
        } else {
          await remove(ref(db, `chats/${user.uid}/inbox/${friendUid}`));
          await remove(ref(db, `chats/${user.uid}/messages/${friendUid}`));
        }
      }

      if (currentChatWith === friendUid) {
        loadChatMessages(friendUid);
      }
      loadChatList();

    } catch (error) {
      console.error('Delete message error:', error);
      showToast('❌ Gagal menghapus pesan', 'error');
    }
  }, [user?.uid, currentChatWith, loadChatMessages, loadChatList, handleDeleteImageMessage]);

  // ==================== CLEAR CHAT ====================
  const clearChat = useCallback(async (friendUid) => {
    if (!showConfirm(`Hapus SEMUA pesan dengan teman ini?\n\nPesan hanya akan hilang dari sisi Anda.`)) return;

    try {
      const friendSnapshot = await get(ref(db, `users_auth/${friendUid}`));
      const friendName = friendSnapshot.exists() ? friendSnapshot.val().nama : friendUid;

      // ⭐ Ambil semua pesan gambar untuk dihapus nanti jika diperlukan
      const messagesSnapshot = await get(ref(db, `chats/${user.uid}/messages/${friendUid}`));
      const messagesData = messagesSnapshot.val();
      const imageMessages = [];

      if (messagesData) {
        Object.entries(messagesData).forEach(([id, msg]) => {
          if (msg.type === 'image' && msg.mediaUrl && isSupabaseImage(msg.mediaUrl)) {
            imageMessages.push({ id, ...msg });
          }
        });
      }

      // Hapus chat dari sisi user
      await Promise.all([
        remove(ref(db, `chats/${user.uid}/messages/${friendUid}`)),
        remove(ref(db, `chats/${user.uid}/inbox/${friendUid}`))
      ]);

      // ⭐ Cek apakah teman juga sudah menghapus chat ini
      const friendInboxSnapshot = await get(ref(db, `chats/${friendUid}/inbox/${user.uid}`));
      const friendInbox = friendInboxSnapshot.val();

      // Jika teman juga sudah menghapus, hapus semua gambar dari Supabase
      if (!friendInbox) {
        console.log('🔍 Kedua user sudah menghapus chat, menghapus semua gambar...');
        for (const img of imageMessages) {
          if (img.mediaUrl && isSupabaseImage(img.mediaUrl)) {
            // Cek apakah pesan gambar masih ada di sisi teman
            const friendMsgSnapshot = await get(ref(db, `chats/${friendUid}/messages/${user.uid}/${img.id}`));
            const friendMsg = friendMsgSnapshot.val();
            
            // Jika teman juga sudah menghapus pesan ini, hapus gambar
            if (!friendMsg || friendMsg.deleted === true) {
              await deleteImageFromSupabase(img.mediaUrl);
              console.log('🗑️ Gambar dihapus dari Supabase:', img.mediaUrl);
            }
          }
        }
        
        // Hapus semua pesan di sisi teman juga
        await remove(ref(db, `chats/${friendUid}/messages/${user.uid}`));
      }

      if (currentChatWith === friendUid) {
        setCurrentChatWith(null);
        setMessages([]);
        setChatPartnerData(null);
        const sidebarBadge = document.querySelector('.sidebar-btn[data-tab="chat"] .sidebar-badge');
        if (sidebarBadge) sidebarBadge.style.display = 'none';
      }

      await loadChatList();
      showToast(`✅ Chat dengan ${friendName} telah dibersihkan`, 'success');

    } catch (error) {
      console.error('Clear chat error:', error);
      showToast('❌ Gagal membersihkan chat', 'error');
    }
  }, [user?.uid, currentChatWith, loadChatList, deleteImageFromSupabase, isSupabaseImage]);

  // ==================== VIEW FRIEND PROFILE ====================
  const viewFriendProfile = useCallback(async (friendUid) => {
    try {
      const snapshot = await get(ref(db, `users_auth/${friendUid}`));
      const friendData = snapshot.val();
      if (!friendData) {
        showToast('❌ Data teman tidak ditemukan', 'error');
        return;
      }
      setSelectedFriend({ uid: friendUid, ...friendData });
      setShowProfileModal(true);
    } catch (error) {
      console.error('Load friend profile error:', error);
      showToast('❌ Gagal memuat profil', 'error');
    }
  }, []);

  // ==================== SETUP INBOX LISTENER ====================
  useEffect(() => {
    if (!user?.uid) return;

    const inboxRef = ref(db, `chats/${user.uid}/inbox`);

    const listener = onValue(inboxRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const unread = {};
        let totalUnread = 0;
        for (const [fromUid, chatData] of Object.entries(data)) {
          if (chatData.unreadCount > 0) {
            unread[fromUid] = chatData.unreadCount;
            totalUnread += chatData.unreadCount;
          }
        }
        setUnreadCounts(unread);

        const sidebarBadge = document.querySelector('.sidebar-btn[data-tab="chat"] .sidebar-badge');
        if (sidebarBadge) {
          if (totalUnread > 0) {
            sidebarBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            sidebarBadge.style.display = 'flex';
          } else {
            sidebarBadge.style.display = 'none';
          }
        }

        loadChatList();

        if (currentChatWith) {
          const validChats = data[currentChatWith];
          if (!validChats) {
            setCurrentChatWith(null);
            setMessages([]);
            setChatPartnerData(null);
          } else {
            loadChatMessages(currentChatWith);
          }
        }
      } else {
        setUnreadCounts({});
        const sidebarBadge = document.querySelector('.sidebar-btn[data-tab="chat"] .sidebar-badge');
        if (sidebarBadge) sidebarBadge.style.display = 'none';
        setChatList([]);
      }
    });

    inboxListenerRef.current = listener;

    return () => {
      if (inboxListenerRef.current) {
        off(inboxRef, listener);
      }
    };
  }, [user?.uid, currentChatWith, loadChatList, loadChatMessages]);

  // ==================== LISTEN FOR START CHAT EVENT ====================
  useEffect(() => {
    const handleStartChat = (e) => {
      const { friendUid, friendName, friendEmail } = e.detail;
      console.log('💬 ChatTab received startChat event:', friendName, friendUid);
      
      if (friendUid) {
        setTimeout(() => {
          selectChat(friendUid);
        }, 300);
      }
    };

    window.addEventListener('startChatWithFriend', handleStartChat);

    return () => {
      window.removeEventListener('startChatWithFriend', handleStartChat);
    };
  }, [selectChat]);

  // ==================== INITIAL LOAD ====================
  useEffect(() => {
    if (user?.uid) {
      loadChatList();
    }

    return () => {
      if (chatMessagesListenerRef.current) {
        off(ref(db, `chats/${user?.uid}/messages/${currentChatWith}`), chatMessagesListenerRef.current);
        chatMessagesListenerRef.current = null;
      }
    };
  }, [user?.uid]);

  // ==================== HANDLE KEY PRESS ====================
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ==================== FILTER CHAT LIST ====================
  const filteredChatList = chatList.filter(chat => {
    if (!chat.nama || chat.nama === 'Pengguna tidak dikenal' || chat.nama.trim() === '') {
      return false;
    }
    return chat.nama.toLowerCase().includes(searchQuery.toLowerCase()) ||
           (chat.email && chat.email.toLowerCase().includes(searchQuery.toLowerCase()));
  });

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="chat-tab-container">
        <div className="chat-loading">
          <div className="loading-spinner"></div>
          <p>⏳ Memuat chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-tab-container">
      <div className="chat-wrapper">
        {/* ===== SIDEBAR ===== */}
        <div className="chat-sidebar">
          <div className="chat-search">
            <input
              type="text"
              placeholder="🔍 Cari chat..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="chat-list-container">
            {filteredChatList.length === 0 ? (
              <div className="empty-chat">
                <span className="empty-icon">📭</span>
                <p>Belum ada chat</p>
                <small>Cari teman untuk memulai chat</small>
              </div>
            ) : (
              filteredChatList.map((chat) => (
                <div
                  key={chat.uid}
                  className={`chat-item ${currentChatWith === chat.uid ? 'active' : ''}`}
                  onClick={() => selectChat(chat.uid)}
                >
                  <div className="chat-avatar">
                    <img
                      src={chat.photoUrl || getAvatarUrl(chat.nama)}
                      alt={chat.nama}
                      onError={(e) => {
                        e.target.src = getAvatarUrl(chat.nama);
                      }}
                    />
                    {chat.unreadCount > 0 && (
                      <span className="unread-badge">{chat.unreadCount}</span>
                    )}
                  </div>
                  <div className="chat-info">
                    <div className="chat-name">{chat.nama}</div>
                    <div className="chat-last-message">
                      {chat.lastMessageType === 'image' ? '📷 Gambar' : escapeHtml(chat.lastMessage?.substring(0, 30) || '')}
                    </div>
                  </div>
                  <div className="chat-time">{formatChatTime(chat.lastMessageTime)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ===== MAIN CHAT AREA ===== */}
        <div className="chat-main">
          {!currentChatWith ? (
            <div className="chat-empty-state">
              <span className="empty-icon">💬</span>
              <h3>Pilih chat untuk memulai</h3>
              <p>Pilih teman di sebelah kiri untuk memulai percakapan</p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="chat-header">
                <div className="chat-header-info">
                  <img
                    src={chatPartnerData?.photoUrl || getAvatarUrl(chatPartnerData?.nama || 'User')}
                    alt={chatPartnerData?.nama || 'User'}
                    className="header-avatar"
                    onError={(e) => {
                      e.target.src = getAvatarUrl(chatPartnerData?.nama || 'User');
                    }}
                  />
                  <div>
                    <div className="header-name">{chatPartnerData?.nama || 'Teman'}</div>
                    <div className="header-email">{chatPartnerData?.email || ''}</div>
                  </div>
                </div>
                <div className="chat-header-actions">
                  <button
                    className="btn-header"
                    onClick={() => viewFriendProfile(currentChatWith)}
                    title="Lihat Profil"
                  >
                    👤
                  </button>
                  <button
                    className="btn-header btn-clear"
                    onClick={() => clearChat(currentChatWith)}
                    title="Hapus semua pesan"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="chat-messages" ref={messagesContainerRef}>
                {messages.length === 0 ? (
                  <div className="messages-empty">
                    <span>💬</span>
                    <p>Belum ada pesan. Kirim pesan pertama!</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.from === user.uid;
                    const time = new Date(msg.timestamp).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit'
                    });
                    const date = new Date(msg.timestamp).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short'
                    });

                    return (
                      <div
                        key={msg.id}
                        className={`message-wrapper ${isMe ? 'me' : 'friend'}`}
                      >
                        <div className={`message-bubble ${isMe ? 'me' : 'friend'}`}>
                          {msg.type === 'image' ? (
                            <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                              <img src={msg.mediaUrl} alt="Gambar" className="message-image" />
                            </a>
                          ) : (
                            <div className="message-text">{escapeHtml(msg.message)}</div>
                          )}
                          <div className="message-time">
                            {date} {time}
                          </div>
                          {isMe && (
                            <button
                              className="message-delete"
                              onClick={() => deleteMessage(currentChatWith, msg.id)}
                              title="Hapus pesan"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="chat-input-area">
                <div className="input-tools">
                  <label className="btn-upload-image" title="Kirim Gambar">
                    📷
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files[0]) {
                          sendImage(e.target.files[0]);
                        }
                        e.target.value = '';
                      }}
                      disabled={uploadingImage}
                    />
                  </label>
                  {uploadingImage && <span className="uploading-text">⏳ Mengupload...</span>}
                </div>
                <textarea
                  ref={inputRef}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Tulis pesan... (Enter untuk kirim)"
                  rows="1"
                  className="message-input"
                  disabled={sending || uploadingImage}
                />
                <button
                  className="btn-send"
                  onClick={sendMessage}
                  disabled={!messageInput.trim() || sending || uploadingImage}
                >
                  {sending ? '⏳' : '📤'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== PROFILE MODAL ===== */}
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
                <div className="detail-row">
                  <span className="detail-label">📚 Kelas:</span>
                  <span className="detail-value">{selectedFriend.kelas || '-'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">🎓 Jurusan:</span>
                  <span className="detail-value">{selectedFriend.jurusan || '-'}</span>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowProfileModal(false)}>Tutup</button>
              <button
                className="btn-chat-profile"
                onClick={() => {
                  setShowProfileModal(false);
                  selectChat(selectedFriend.uid);
                }}
              >
                💬 Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== HELPER FUNCTIONS ====================
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

export default ChatTab;