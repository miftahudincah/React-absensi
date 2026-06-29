// src/pages/tabs/AnnouncementsTab.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, off, get, set, update, remove, push } from 'firebase/database';
import { db } from '../../firebase/config';
import './AnnouncementsTab.css';

// API Base URL
const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const AnnouncementsTab = ({ user }) => {
  // ==================== STATE ====================
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // State untuk form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'umum',
    priority: 'normal',
    expiryDate: '',
    attachment: null,
    attachmentUrl: ''
  });
  
  // State untuk filter
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // State untuk preview
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  
  // State untuk upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // State untuk pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // State untuk notifikasi
  const [message, setMessage] = useState({ text: '', type: '' });
  
  // Refs
  const fileInputRef = useRef(null);
  const formRef = useRef(null);
  
  // ==================== ROLE PERMISSIONS ====================
  const rawRole = user?.role || 'siswa';
  const role = rawRole.toString().toLowerCase().trim();
  
  const isSiswa = role === 'siswa';
  const isGuru = role === 'guru';
  const isStaff = role === 'staff_tu';
  const isAdmin = role === 'admin';
  const isWakilKepala = role === 'wakil_kepala';
  const isDeveloper = role === 'developer';
  
  // ⭐ PERMISSIONS ⭐
  // Developer & Admin & Wakil Kepala: Full access to all announcements
  const isFullAccess = isDeveloper || isAdmin || isWakilKepala;
  
  // Guru & Staff TU: Can manage their own announcements
  const canManageOwn = isGuru || isStaff;
  
  // Create: Developer, Admin, Wakil Kepala, Guru, Staff TU
  const canCreate = isFullAccess || canManageOwn;
  
  // Edit: Developer, Admin, Wakil Kepala (all), Guru/Staff (own only)
  const canEdit = (announcement) => {
    if (isFullAccess) return true;
    if (canManageOwn && announcement?.createdBy === user?.uid) return true;
    return false;
  };
  
  // Delete: Developer, Admin, Wakil Kepala (all), Guru/Staff (own only)
  const canDelete = (announcement) => {
    if (isFullAccess) return true;
    if (canManageOwn && announcement?.createdBy === user?.uid) return true;
    return false;
  };
  
  // ==================== TOKEN MANAGEMENT ====================
  const getAuthToken = useCallback(async () => {
    let token = localStorage.getItem('authToken');
    if (token) return token;
    
    if (window.auth?.currentUser) {
      try {
        token = await window.auth.currentUser.getIdToken();
        localStorage.setItem('authToken', token);
        return token;
      } catch (error) {
        console.error('❌ Failed to get Firebase token:', error);
        return null;
      }
    }
    return null;
  }, []);

  // ==================== UPLOAD ATTACHMENT TO SUPABASE ====================
  const uploadAttachment = useCallback(async (file) => {
    if (!file) return null;
    
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setMessage({ text: '❌ Format file tidak didukung. Gunakan JPG, PNG, GIF, WEBP, atau PDF.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      return null;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ text: '❌ Ukuran file maksimal 5MB!', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      return null;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Tidak dapat memperoleh token autentikasi. Silakan login kembali.');
      }

      const formData = new FormData();
      formData.append('image', file);
      formData.append('folder', 'announcements');

      console.log('📤 Uploading attachment to Supabase via backend...');
      setUploadProgress(20);

      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      setUploadProgress(70);

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
        throw new Error(result.error || 'Upload gagal - tidak ada URL');
      }

      setUploadProgress(100);
      console.log('✅ Attachment uploaded to Supabase:', result.data.url);
      
      setMessage({ text: '✅ File berhasil diupload!', type: 'success' });
      setTimeout(() => setMessage({ text: '', type: '' }), 2000);
      
      return result.data.url;
      
    } catch (error) {
      console.error('❌ Upload attachment error:', error);
      setMessage({ text: '❌ Gagal upload file: ' + error.message, type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      return null;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [getAuthToken]);

  // ==================== DELETE ATTACHMENT FROM SUPABASE ====================
  const deleteAttachment = useCallback(async (fileUrl) => {
    if (!fileUrl) return true;
    if (!fileUrl.includes('supabase.co')) {
      console.log('Not a Supabase URL, skipping delete');
      return true;
    }

    try {
      const token = await getAuthToken();
      if (!token) {
        console.warn('⚠️ Token tidak ditemukan, skip delete');
        return true;
      }

      console.log('🗑️ Deleting attachment from Supabase:', fileUrl);

      const response = await fetch(`${API_BASE_URL}/storage/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ fileUrl: fileUrl })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Attachment deleted from Supabase');
        return true;
      } else {
        console.warn('⚠️ Failed to delete attachment:', result.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Delete attachment error:', error);
      return false;
    }
  }, [getAuthToken]);

  // ==================== LOAD ANNOUNCEMENTS ====================
  const loadAnnouncements = useCallback(() => {
    const announcementsRef = ref(db, 'announcements');
    
    const unsubscribe = onValue(announcementsRef, (snapshot) => {
      const data = snapshot.val();
      const announcementList = [];
      
      if (data) {
        const now = Date.now();
        
        Object.entries(data).forEach(([key, announcement]) => {
          // Cek apakah pengumuman masih aktif
          let isActive = true;
          if (announcement.expiryDate) {
            const expiryDate = new Date(announcement.expiryDate).getTime();
            if (now > expiryDate) {
              isActive = false;
            }
          }
          
          // ⭐ ALL USERS CAN SEE ALL ANNOUNCEMENTS (no target roles) ⭐
          let isForUser = true;
          if (!isFullAccess && !isActive) {
            isForUser = false;
          }
          
          // Cek apakah sudah dibaca
          const isRead = announcement.readBy && announcement.readBy[user?.uid];
          
          announcementList.push({
            id: key,
            ...announcement,
            isActive,
            isForUser,
            isRead: !!isRead,
            readCount: announcement.readBy ? Object.keys(announcement.readBy).length : 0
          });
        });
      }
      
      // Sort by date (newest first)
      announcementList.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      setAnnouncements(announcementList);
      setLoading(false);
      setError(null);
    }, (error) => {
      console.error('Firebase announcements error:', error);
      setError('Gagal memuat pengumuman: ' + error.message);
      setLoading(false);
    });
    
    return unsubscribe;
  }, [user?.uid, isFullAccess]);

  // ==================== MARK AS READ ====================
  const markAsRead = useCallback(async (announcementId) => {
    if (!user?.uid) return;
    
    try {
      const readByRef = ref(db, `announcements/${announcementId}/readBy/${user.uid}`);
      await set(readByRef, {
        readAt: Date.now(),
        name: user.nama || user.email || 'User'
      });
      
      setAnnouncements(prev => 
        prev.map(a => 
          a.id === announcementId 
            ? { ...a, isRead: true, readCount: (a.readCount || 0) + 1 }
            : a
        )
      );
      
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }, [user?.uid, user?.nama, user?.email]);

  // ==================== MARK ALL AS READ ====================
  const markAllAsRead = useCallback(async () => {
    if (!user?.uid) return;
    
    const unreadAnnouncements = announcements.filter(a => !a.isRead && a.isForUser && a.isActive);
    
    if (unreadAnnouncements.length === 0) {
      setMessage({ text: '📭 Tidak ada pengumuman yang belum dibaca', type: 'info' });
      setTimeout(() => setMessage({ text: '', type: '' }), 2000);
      return;
    }
    
    try {
      for (const announcement of unreadAnnouncements) {
        const readByRef = ref(db, `announcements/${announcement.id}/readBy/${user.uid}`);
        await set(readByRef, {
          readAt: Date.now(),
          name: user.nama || user.email || 'User'
        });
      }
      
      setAnnouncements(prev => 
        prev.map(a => 
          unreadAnnouncements.some(ua => ua.id === a.id)
            ? { ...a, isRead: true, readCount: (a.readCount || 0) + 1 }
            : a
        )
      );
      
      setMessage({ text: `✅ Semua pengumuman telah ditandai sebagai dibaca (${unreadAnnouncements.length})`, type: 'success' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      
    } catch (error) {
      console.error('Error marking all as read:', error);
      setMessage({ text: '❌ Gagal menandai semua sebagai dibaca', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  }, [user?.uid, user?.nama, user?.email, announcements]);

  // ==================== CREATE/UPDATE ANNOUNCEMENT ====================
  const createAnnouncement = useCallback(async () => {
    const { title, content, category, priority, expiryDate, attachmentUrl } = formData;
    
    if (!title.trim() || !content.trim()) {
      setMessage({ text: '⚠️ Judul dan konten harus diisi!', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      return;
    }
    
    if (!canCreate) {
      setMessage({ text: '⚠️ Anda tidak memiliki izin untuk membuat pengumuman!', type: 'error' });
      return;
    }
    
    setUploading(true);
    
    try {
      // ⭐ No targetRoles - all users can see announcements ⭐
      const announcementData = {
        title: title.trim(),
        content: content.trim(),
        category: category || 'umum',
        priority: priority || 'normal',
        expiryDate: expiryDate || '',
        attachmentUrl: attachmentUrl || '',
        createdAt: Date.now(),
        createdBy: user.uid,
        createdByName: user.nama || user.email || 'Unknown',
        createdByRole: user.role || 'unknown',
        updatedAt: Date.now(),
        readBy: {}
      };
      
      let announcementRef;
      if (editingId) {
        // UPDATE: Get old data to delete attachment if needed
        const oldSnapshot = await get(ref(db, `announcements/${editingId}`));
        const oldData = oldSnapshot.val();
        
        // Check if user can edit this announcement
        if (!canEdit(oldData)) {
          setMessage({ text: '⚠️ Anda tidak memiliki izin untuk mengedit pengumuman ini!', type: 'error' });
          setUploading(false);
          return;
        }
        
        announcementRef = ref(db, `announcements/${editingId}`);
        await update(announcementRef, {
          ...announcementData,
          updatedAt: Date.now()
        });
        
        // If attachment changed, delete old attachment
        if (oldData?.attachmentUrl && oldData.attachmentUrl !== attachmentUrl) {
          await deleteAttachment(oldData.attachmentUrl);
        }
        
        setMessage({ text: '✅ Pengumuman berhasil diperbarui!', type: 'success' });
        if (typeof window.logActivity === 'function') {
          window.logActivity('update_announcement', `Memperbarui pengumuman "${title.trim()}"`);
        }
      } else {
        // CREATE
        announcementRef = push(ref(db, 'announcements'));
        await set(announcementRef, announcementData);
        
        setMessage({ text: '✅ Pengumuman berhasil dibuat!', type: 'success' });
        if (typeof window.logActivity === 'function') {
          window.logActivity('create_announcement', `Membuat pengumuman "${title.trim()}"`);
        }
      }
      
      // Reset form
      resetForm();
      setShowForm(false);
      
    } catch (error) {
      console.error('Save announcement error:', error);
      setMessage({ text: '❌ Gagal menyimpan pengumuman: ' + error.message, type: 'error' });
    } finally {
      setUploading(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  }, [formData, editingId, user, canCreate, canEdit, deleteAttachment]);

  // ==================== DELETE ANNOUNCEMENT ====================
  const deleteAnnouncement = useCallback(async (announcementId, title, announcement) => {
    // Check if user can delete this announcement
    if (!canDelete(announcement)) {
      setMessage({ text: '⚠️ Anda tidak memiliki izin untuk menghapus pengumuman ini!', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      return;
    }
    
    if (!window.confirm(`⚠️ Yakin ingin menghapus pengumuman "${title}"?\n\nFile lampiran (jika ada) juga akan dihapus secara permanen!`)) return;
    
    try {
      // Get announcement data to delete attachment
      const snapshot = await get(ref(db, `announcements/${announcementId}`));
      const data = snapshot.val();
      
      // Delete attachment from Supabase if exists
      if (data?.attachmentUrl) {
        const deleted = await deleteAttachment(data.attachmentUrl);
        if (deleted) {
          console.log('✅ Attachment deleted from Supabase');
        } else {
          console.warn('⚠️ Failed to delete attachment, but continuing...');
        }
      }
      
      // Delete from Firebase
      await remove(ref(db, `announcements/${announcementId}`));
      
      // Update local state
      setAnnouncements(prev => prev.filter(a => a.id !== announcementId));
      
      setMessage({ text: `🗑️ Pengumuman "${title}" berhasil dihapus!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('delete_announcement', `Menghapus pengumuman "${title}"`);
      }
    } catch (error) {
      console.error('Delete announcement error:', error);
      setMessage({ text: '❌ Gagal menghapus pengumuman: ' + error.message, type: 'error' });
    } finally {
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  }, [canDelete, deleteAttachment]);

  // ==================== RESET FORM ====================
  const resetForm = useCallback(() => {
    setFormData({
      title: '',
      content: '',
      category: 'umum',
      priority: 'normal',
      expiryDate: '',
      attachment: null,
      attachmentUrl: ''
    });
    setEditingId(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setUploadProgress(0);
    setUploading(false);
  }, []);

  // ==================== EDIT ANNOUNCEMENT ====================
  const editAnnouncement = useCallback((announcement) => {
    if (!canEdit(announcement)) {
      setMessage({ text: '⚠️ Anda tidak memiliki izin untuk mengedit pengumuman ini!', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      return;
    }
    
    setEditingId(announcement.id);
    setFormData({
      title: announcement.title || '',
      content: announcement.content || '',
      category: announcement.category || 'umum',
      priority: announcement.priority || 'normal',
      expiryDate: announcement.expiryDate || '',
      attachment: null,
      attachmentUrl: announcement.attachmentUrl || ''
    });
    setShowForm(true);
    setPreviewMode(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [canEdit]);

  // ==================== VIEW ANNOUNCEMENT ====================
  const viewAnnouncement = useCallback((announcement) => {
    setSelectedAnnouncement(announcement);
    setPreviewMode(true);
    
    if (!announcement.isRead && announcement.isForUser) {
      markAsRead(announcement.id);
    }
  }, [markAsRead]);

  // ==================== CLOSE PREVIEW ====================
  const closePreview = useCallback(() => {
    setSelectedAnnouncement(null);
    setPreviewMode(false);
  }, []);

  // ==================== HANDLE FILE INPUT CHANGE ====================
  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setMessage({ text: '❌ Format file tidak didukung. Gunakan JPG, PNG, GIF, WEBP, atau PDF.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      e.target.value = '';
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ text: '❌ Ukuran file maksimal 5MB!', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
      e.target.value = '';
      return;
    }
    
    const url = await uploadAttachment(file);
    if (url) {
      setFormData(prev => ({ ...prev, attachmentUrl: url }));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [uploadAttachment]);

  // ==================== FILTER ANNOUNCEMENTS ====================
  const filteredAnnouncements = announcements.filter(announcement => {
    if (filterCategory !== 'all' && announcement.category !== filterCategory) {
      return false;
    }
    
    if (filterPriority !== 'all' && announcement.priority !== filterPriority) {
      return false;
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const titleMatch = announcement.title?.toLowerCase().includes(query);
      const contentMatch = announcement.content?.toLowerCase().includes(query);
      if (!titleMatch && !contentMatch) {
        return false;
      }
    }
    
    return announcement.isForUser;
  });

  // ==================== PAGINATION ====================
  const totalPages = Math.ceil(filteredAnnouncements.length / itemsPerPage);
  const paginatedAnnouncements = filteredAnnouncements.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // ==================== GET PRIORITY COLOR ====================
  const getPriorityColor = (priority) => {
    const colors = {
      urgent: '#f44336',
      high: '#ff9800',
      normal: '#2196f3',
      low: '#4caf50'
    };
    return colors[priority] || '#2196f3';
  };

  const getPriorityLabel = (priority) => {
    const labels = {
      urgent: '🚨 Darurat',
      high: '🔴 Tinggi',
      normal: '🔵 Normal',
      low: '🟢 Rendah'
    };
    return labels[priority] || priority;
  };

  // ==================== GET CATEGORY ICON ====================
  const getCategoryIcon = (category) => {
    const icons = {
      akademik: '📚',
      administrasi: '📋',
      umum: '📢',
      kegiatan: '🎯',
      pengumuman: '📢'
    };
    return icons[category] || '📢';
  };

  // ==================== FORMAT DATE ====================
  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
      return 'Baru saja';
    } else if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes} menit yang lalu`;
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} jam yang lalu`;
    } else if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days} hari yang lalu`;
    } else {
      return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }
  };

  // ==================== GET ROLE LABEL ====================
  const getRoleLabel = (role) => {
    const labels = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala',
      staff_tu: 'Staff TU',
      guru: 'Guru',
      siswa: 'Siswa'
    };
    return labels[role] || role;
  };

  // ==================== GET ROLE ICON ====================
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

  // ==================== GET FILE NAME FROM URL ====================
  const getFileNameFromUrl = (url) => {
    if (!url) return 'File';
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const parts = pathname.split('/');
      const fileName = parts[parts.length - 1];
      return fileName || 'File';
    } catch {
      return 'File';
    }
  };

  // ==================== IS IMAGE FILE ====================
  const isImageFile = (url) => {
    if (!url) return false;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    return imageExtensions.some(ext => url.toLowerCase().includes(ext));
  };

  // ==================== CAN USER EDIT ANNOUNCEMENT ====================
  const userCanEdit = (announcement) => {
    if (isFullAccess) return true;
    if (canManageOwn && announcement?.createdBy === user?.uid) return true;
    return false;
  };

  // ==================== CAN USER DELETE ANNOUNCEMENT ====================
  const userCanDelete = (announcement) => {
    if (isFullAccess) return true;
    if (canManageOwn && announcement?.createdBy === user?.uid) return true;
    return false;
  };

  // ==================== INITIALIZE ====================
  useEffect(() => {
    const unsubscribe = loadAnnouncements();
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [loadAnnouncements]);

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="announcements-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>⏳ Memuat pengumuman...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="announcements-container">
        <div className="error-state">
          <div className="error-icon">❌</div>
          <h3>Gagal Memuat Data</h3>
          <p>{error}</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>🔄 Coba Lagi</button>
        </div>
      </div>
    );
  }

  // ==================== GET PERMISSION LABEL ====================
  const getPermissionLabel = () => {
    if (isDeveloper) return '👨‍💻 Developer - Full Access';
    if (isAdmin) return '👑 Kepala Sekolah - Full Access';
    if (isWakilKepala) return '👔 Wakil Kepala - Full Access';
    if (isGuru) return '👨‍🏫 Guru - Dapat mengelola sendiri';
    if (isStaff) return '📋 Staff TU - Dapat mengelola sendiri';
    return '👤 Siswa - Hanya baca';
  };

  return (
    <div className="announcements-container">
      {/* ===== HEADER ===== */}
      <div className="announcements-header">
        <div className="header-left">
          <h1>📢 Pengumuman</h1>
          <p className="header-subtitle">
            Informasi dan pengumuman penting
            <span className="role-badge" style={{
              background: isFullAccess ? 'rgba(155,89,182,0.15)' : 'rgba(0,188,212,0.1)',
              color: isFullAccess ? '#9b59b6' : '#00bcd4'
            }}>
              {getPermissionLabel()}
            </span>
          </p>
        </div>
        <div className="header-actions">
          {canCreate && (
            <button 
              className="btn-create-announcement"
              onClick={() => {
                resetForm();
                setShowForm(!showForm);
                setPreviewMode(false);
              }}
            >
              {showForm ? '✖ Tutup Form' : '📝 Buat Pengumuman'}
            </button>
          )}
          <button 
            className="btn-mark-all-read"
            onClick={markAllAsRead}
            title="Tandai semua sebagai dibaca"
          >
            ✅ Tandai Dibaca
          </button>
        </div>
      </div>

      {/* ===== MESSAGE ===== */}
      {message.text && (
        <div className={`announcement-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* ===== FORM ===== */}
      {showForm && canCreate && (
        <div className="announcement-form-container" ref={formRef}>
          <div className="form-header">
            <h3>
              {editingId ? '✏️ Edit Pengumuman' : '📝 Buat Pengumuman Baru'}
              <span style={{ 
                fontSize: '12px', 
                fontWeight: 'normal', 
                marginLeft: '12px',
                color: isFullAccess ? '#9b59b6' : '#00bcd4',
                background: isFullAccess ? 'rgba(155,89,182,0.1)' : 'rgba(0,188,212,0.1)',
                padding: '2px 10px',
                borderRadius: '12px'
              }}>
                {isDeveloper ? '👨‍💻 Developer' : 
                 isAdmin ? '👑 Kepala Sekolah' : 
                 isWakilKepala ? '👔 Wakil Kepala' :
                 isGuru ? '👨‍🏫 Guru' : '📋 Staff TU'}
              </span>
            </h3>
            <button className="form-close" onClick={() => {
              setShowForm(false);
              resetForm();
            }}>
              ✖
            </button>
          </div>
          
          <div className="form-body">
            <div className="form-group">
              <label>Judul <span className="required">*</span></label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Masukkan judul pengumuman..."
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Konten <span className="required">*</span></label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Tulis konten pengumuman..."
                className="form-textarea"
                rows="6"
              />
            </div>
            
            <div className="form-row">
              <div className="form-group half">
                <label>Kategori</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="form-select"
                >
                  <option value="umum">📢 Umum</option>
                  <option value="akademik">📚 Akademik</option>
                  <option value="administrasi">📋 Administrasi</option>
                  <option value="kegiatan">🎯 Kegiatan</option>
                </select>
              </div>
              
              <div className="form-group half">
                <label>Prioritas</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="form-select"
                >
                  <option value="low">🟢 Rendah</option>
                  <option value="normal">🔵 Normal</option>
                  <option value="high">🔴 Tinggi</option>
                  <option value="urgent">🚨 Darurat</option>
                </select>
              </div>
            </div>
            
            {/* ⭐ TARGET ROLE REMOVED - All users can see announcements ⭐ */}
            
            <div className="form-group">
              <label>Tanggal Kadaluarsa</label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                className="form-input"
              />
              <small className="form-hint">Kosongkan jika tidak ada batas waktu</small>
            </div>
            
            <div className="form-group">
              <label>Lampiran</label>
              <div className="attachment-upload">
                <div className="upload-area">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileChange}
                    className="file-input"
                    id="announcement-file-input"
                    disabled={uploading}
                  />
                  <label 
                    htmlFor="announcement-file-input" 
                    className={`file-upload-label ${uploading ? 'uploading' : ''}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 20px',
                      background: uploading ? 'rgba(255,255,255,0.05)' : 'rgba(0,188,212,0.1)',
                      border: uploading ? '1px solid rgba(255,255,255,0.1)' : '1px dashed rgba(0,188,212,0.3)',
                      borderRadius: '8px',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                      color: uploading ? 'var(--text-muted)' : '#00bcd4',
                      fontSize: '14px',
                      fontWeight: '500',
                      transition: 'all 0.3s ease',
                      opacity: uploading ? 0.6 : 1
                    }}
                    onMouseEnter={(e) => {
                      if (!uploading) {
                        e.target.style.background = 'rgba(0,188,212,0.2)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!uploading) {
                        e.target.style.background = 'rgba(0,188,212,0.1)';
                      }
                    }}
                  >
                    {uploading ? '⏳ Mengupload...' : '📎 Pilih File'}
                  </label>
                </div>
                
                {uploading && (
                  <div className="upload-progress">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                    <span className="progress-text">{uploadProgress}%</span>
                  </div>
                )}
                
                {formData.attachmentUrl && !uploading && (
                  <div className="attached-file">
                    <span>📎 {getFileNameFromUrl(formData.attachmentUrl)}</span>
                    <button 
                      className="remove-attachment"
                      onClick={() => {
                        setFormData({ ...formData, attachmentUrl: '' });
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      title="Hapus lampiran"
                    >
                      ✖
                    </button>
                  </div>
                )}
              </div>
              <small className="form-hint">
                {uploading ? '⏳ Sedang mengupload...' : '📎 Maksimal 5MB | Format: JPG, PNG, GIF, WEBP, PDF'}
              </small>
            </div>
            
            {/* ⭐ Info: Pengumuman Terlihat Semua User ⭐ */}
            <div style={{
              padding: '12px 16px',
              background: 'rgba(0,188,212,0.06)',
              border: '1px solid rgba(0,188,212,0.12)',
              borderRadius: '8px',
              marginTop: '8px',
              fontSize: '13px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap'
            }}>
              <span style={{ fontSize: '18px' }}>🌍</span>
              <span>
                Pengumuman ini akan terlihat oleh <strong style={{ color: '#00bcd4' }}>SEMUA</strong> user yang login
              </span>
              {isFullAccess && (
                <span style={{ 
                  marginLeft: 'auto', 
                  fontSize: '11px', 
                  background: 'rgba(155,89,182,0.1)',
                  padding: '2px 10px',
                  borderRadius: '12px',
                  color: '#9b59b6'
                }}>
                  🔓 Full Access
                </span>
              )}
              {canManageOwn && (
                <span style={{ 
                  marginLeft: 'auto', 
                  fontSize: '11px', 
                  background: 'rgba(0,188,212,0.1)',
                  padding: '2px 10px',
                  borderRadius: '12px',
                  color: '#00bcd4'
                }}>
                  ✏️ Dapat mengelola sendiri
                </span>
              )}
            </div>
          </div>
          
          <div className="form-footer">
            <button 
              className="btn-cancel"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              disabled={uploading}
            >
              ❌ Batal
            </button>
            <button 
              className="btn-save"
              onClick={createAnnouncement}
              disabled={uploading}
            >
              {uploading ? '⏳ Menyimpan...' : editingId ? '💾 Perbarui' : '📤 Simpan'}
            </button>
          </div>
        </div>
      )}

      {/* ===== FILTERS ===== */}
      <div className="announcements-filters">
        <div className="filter-group">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="filter-select"
          >
            <option value="all">📢 Semua Kategori</option>
            <option value="umum">📢 Umum</option>
            <option value="akademik">📚 Akademik</option>
            <option value="administrasi">📋 Administrasi</option>
            <option value="kegiatan">🎯 Kegiatan</option>
          </select>
          
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="filter-select"
          >
            <option value="all">📊 Semua Prioritas</option>
            <option value="urgent">🚨 Darurat</option>
            <option value="high">🔴 Tinggi</option>
            <option value="normal">🔵 Normal</option>
            <option value="low">🟢 Rendah</option>
          </select>
          
          <div className="search-wrapper">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Cari pengumuman..."
              className="search-input"
            />
          </div>
        </div>
        
        <div className="filter-info">
          <span>
            📊 {filteredAnnouncements.length} pengumuman
            {!showForm && canCreate && (
              <span className="create-hint"> • Klik "Buat Pengumuman" untuk menambah</span>
            )}
            {isFullAccess && (
              <span className="full-access-hint" style={{ marginLeft: '8px', color: '#9b59b6' }}>
                🔓 Full Access
              </span>
            )}
            {canManageOwn && (
              <span className="manage-own-hint" style={{ marginLeft: '8px', color: '#00bcd4' }}>
                ✏️ Dapat mengelola sendiri
              </span>
            )}
            {isSiswa && (
              <span className="read-only-hint" style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>
                👁️ Hanya baca
              </span>
            )}
          </span>
        </div>
      </div>

      {/* ===== ANNOUNCEMENTS LIST ===== */}
      <div className="announcements-list">
        {paginatedAnnouncements.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <h3>Tidak Ada Pengumuman</h3>
            <p>Belum ada pengumuman yang tersedia untuk Anda</p>
            {canCreate && (
              <button 
                className="btn-create-first"
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
              >
                📝 Buat Pengumuman Pertama
              </button>
            )}
          </div>
        ) : (
          paginatedAnnouncements.map((announcement) => {
            const canEditThis = userCanEdit(announcement);
            const canDeleteThis = userCanDelete(announcement);
            const isOwn = announcement.createdBy === user?.uid;
            
            return (
              <div 
                key={announcement.id}
                className={`announcement-card ${!announcement.isRead && announcement.isForUser ? 'unread' : ''} ${announcement.priority === 'urgent' ? 'urgent' : ''}`}
                onClick={() => viewAnnouncement(announcement)}
              >
                <div className="announcement-status">
                  {!announcement.isRead && announcement.isForUser && (
                    <span className="unread-dot" title="Belum dibaca">●</span>
                  )}
                  {!announcement.isActive && (
                    <span className="expired-badge" title="Kadaluarsa">⏰ Kadaluarsa</span>
                  )}
                  {isFullAccess && (
                    <span className="full-access-badge" style={{ fontSize: '10px', color: '#9b59b6' }}>🔓</span>
                  )}
                  {isOwn && canManageOwn && (
                    <span className="own-badge" style={{ fontSize: '10px', color: '#00bcd4' }}>✏️</span>
                  )}
                </div>
                
                <div className="announcement-content">
                  <div className="announcement-header">
                    <div className="announcement-title-wrapper">
                      <span className="category-icon">{getCategoryIcon(announcement.category)}</span>
                      <h3 className="announcement-title">{announcement.title}</h3>
                      <span 
                        className="priority-badge"
                        style={{ backgroundColor: getPriorityColor(announcement.priority) }}
                      >
                        {getPriorityLabel(announcement.priority)}
                      </span>
                      {isOwn && canManageOwn && (
                        <span className="own-tag" style={{ 
                          fontSize: '9px', 
                          padding: '1px 8px', 
                          borderRadius: '10px',
                          background: 'rgba(0,188,212,0.1)',
                          color: '#00bcd4'
                        }}>
                          Milik Saya
                        </span>
                      )}
                    </div>
                    <div className="announcement-meta">
                      <span className="meta-date">{formatDate(announcement.createdAt)}</span>
                      <span className="meta-author">
                        {getRoleIcon(announcement.createdByRole)} {announcement.createdByName || 'Unknown'}
                      </span>
                      <span className="meta-reads">👁️ {announcement.readCount || 0}</span>
                    </div>
                  </div>
                  
                  <div className="announcement-preview">
                    {announcement.content && (
                      <p className="preview-text">
                        {announcement.content.length > 150 
                          ? announcement.content.substring(0, 150) + '...' 
                          : announcement.content}
                      </p>
                    )}
                    {announcement.attachmentUrl && (
                      <span className="attachment-indicator">
                        {isImageFile(announcement.attachmentUrl) ? '🖼️' : '📎'} Ada lampiran
                      </span>
                    )}
                  </div>
                  
                  <div className="announcement-footer">
                    <span className="category-tag">{getCategoryIcon(announcement.category)} {announcement.category}</span>
                    {announcement.expiryDate && (
                      <span className="expiry-tag">📅 Kadaluarsa: {new Date(announcement.expiryDate).toLocaleDateString('id-ID')}</span>
                    )}
                    <span className="author-tag">
                      {getRoleIcon(announcement.createdByRole)} {getRoleLabel(announcement.createdByRole)}
                    </span>
                  </div>
                </div>
                
                {(canEditThis || canDeleteThis) && (
                  <div className="announcement-actions" onClick={(e) => e.stopPropagation()}>
                    {canEditThis && (
                      <button 
                        className="btn-edit"
                        onClick={() => editAnnouncement(announcement)}
                        title="Edit pengumuman"
                      >
                        ✏️
                      </button>
                    )}
                    {canDeleteThis && (
                      <button 
                        className="btn-delete"
                        onClick={() => deleteAnnouncement(announcement.id, announcement.title, announcement)}
                        title="Hapus pengumuman"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ===== PAGINATION ===== */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
          >
            ◀
          </button>
          <span className="pagination-info">
            Halaman {currentPage} dari {totalPages}
          </span>
          <button
            className="pagination-btn"
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
          >
            ▶
          </button>
        </div>
      )}

      {/* ===== PREVIEW MODAL ===== */}
      {previewMode && selectedAnnouncement && (
        <div className="modal-overlay" onClick={closePreview}>
          <div className="modal-box announcement-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrapper">
                <span className="category-icon">{getCategoryIcon(selectedAnnouncement.category)}</span>
                <h2>{selectedAnnouncement.title}</h2>
                <span 
                  className="priority-badge"
                  style={{ backgroundColor: getPriorityColor(selectedAnnouncement.priority) }}
                >
                  {getPriorityLabel(selectedAnnouncement.priority)}
                </span>
              </div>
              <button className="modal-close" onClick={closePreview}>✖</button>
            </div>
            
            <div className="modal-body">
              <div className="preview-meta">
                <span>📅 {formatDate(selectedAnnouncement.createdAt)}</span>
                <span>👤 {getRoleIcon(selectedAnnouncement.createdByRole)} {selectedAnnouncement.createdByName || 'Unknown'}</span>
                <span>📂 {getCategoryIcon(selectedAnnouncement.category)} {selectedAnnouncement.category}</span>
                <span>👁️ Dibaca {selectedAnnouncement.readCount || 0} kali</span>
                {selectedAnnouncement.createdBy === user?.uid && canManageOwn && (
                  <span style={{ color: '#00bcd4' }}>✏️ Milik Saya</span>
                )}
              </div>
              
              <div className="preview-content">
                {selectedAnnouncement.content.split('\n').map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
              
              {selectedAnnouncement.attachmentUrl && (
                <div className="preview-attachment">
                  <h4>📎 Lampiran</h4>
                  {isImageFile(selectedAnnouncement.attachmentUrl) ? (
                    <div className="attachment-image-wrapper">
                      <img 
                        src={selectedAnnouncement.attachmentUrl} 
                        alt="Lampiran" 
                        className="attachment-image"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.innerHTML = `
                            <a href="${selectedAnnouncement.attachmentUrl}" target="_blank" rel="noopener noreferrer" class="attachment-link">
                              📄 Buka Lampiran (${getFileNameFromUrl(selectedAnnouncement.attachmentUrl)})
                            </a>
                          `;
                        }}
                      />
                      <a 
                        href={selectedAnnouncement.attachmentUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="attachment-link"
                        style={{ display: 'block', marginTop: '8px', textAlign: 'center' }}
                      >
                        🔍 Buka di tab baru
                      </a>
                    </div>
                  ) : (
                    <a 
                      href={selectedAnnouncement.attachmentUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="attachment-link"
                    >
                      📄 Buka Lampiran ({getFileNameFromUrl(selectedAnnouncement.attachmentUrl)})
                    </a>
                  )}
                </div>
              )}
              
              {selectedAnnouncement.expiryDate && (
                <div className="preview-expiry">
                  <span>⏰ Kadaluarsa: {new Date(selectedAnnouncement.expiryDate).toLocaleDateString('id-ID', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}</span>
                </div>
              )}
              
              {isFullAccess && (
                <div className="preview-full-access-info" style={{
                  marginTop: '12px',
                  padding: '8px 12px',
                  background: 'rgba(155,89,182,0.1)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#9b59b6',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span>🔓</span>
                  <span>Full Access — Anda dapat mengedit dan menghapus pengumuman ini</span>
                </div>
              )}
              
              {canManageOwn && selectedAnnouncement.createdBy === user?.uid && (
                <div className="preview-own-info" style={{
                  marginTop: '12px',
                  padding: '8px 12px',
                  background: 'rgba(0,188,212,0.1)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#00bcd4',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span>✏️</span>
                  <span>Milik Saya — Anda dapat mengedit dan menghapus pengumuman ini</span>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              {!selectedAnnouncement.isRead && selectedAnnouncement.isForUser && (
                <button 
                  className="btn-mark-read"
                  onClick={() => {
                    markAsRead(selectedAnnouncement.id);
                    setSelectedAnnouncement({ ...selectedAnnouncement, isRead: true });
                  }}
                >
                  ✅ Tandai Dibaca
                </button>
              )}
              <button className="btn-close-preview" onClick={closePreview}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== FOOTER ===== */}
      <div className="announcements-footer">
        <p>
          📌 Pengumuman disimpan di <code>announcements</code>
          <span className="footer-role"> • Role: {getRoleLabel(role)}</span>
          {isFullAccess && (
            <span className="footer-full-access" style={{ color: '#9b59b6' }}> • 🔓 Full Access</span>
          )}
          {canManageOwn && (
            <span className="footer-manage-own" style={{ color: '#00bcd4' }}> • ✏️ Dapat mengelola sendiri</span>
          )}
          {isSiswa && (
            <span className="footer-read-only" style={{ color: 'var(--text-muted)' }}> • 👁️ Hanya baca</span>
          )}
          {formData.attachmentUrl && (
            <span className="footer-attachment"> • 📎 Ada lampiran</span>
          )}
        </p>
      </div>
    </div>
  );
};

export default AnnouncementsTab;