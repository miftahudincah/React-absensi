// src/pages/tabs/IzinTab.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, push, update, remove, serverTimestamp } from 'firebase/database';
import { db } from '../../firebase/config';
import './IzinTab.css';

// API Base URL
const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

// Helper function untuk format tanggal Indonesia
const formatIndonesianDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${parts[2]} ${bulan[parseInt(parts[1]) - 1]} ${parts[0]}`;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleDateString('id-ID', { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

const escapeHtml = (str) => {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => 
    m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;'
  );
};

// ==================== UPLOAD TO SUPABASE VIA BACKEND ====================
const uploadToSupabase = async (file, folder = 'izin') => {
  try {
    const token = localStorage.getItem('authToken');
    if (!token) {
      throw new Error('Token tidak ditemukan. Silakan login kembali.');
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('folder', folder);

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
      return { 
        success: true, 
        url: result.data.url,
        path: result.data.path 
      };
    } else {
      throw new Error(result.error || 'Upload gagal - tidak ada URL');
    }
  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: error.message };
  }
};

// ==================== DELETE FILE FROM SUPABASE ====================
const deleteFileFromSupabase = async (fileUrl) => {
  if (!fileUrl) return { success: true };
  
  try {
    const token = localStorage.getItem('authToken');
    if (!token) {
      console.warn('⚠️ Token tidak ditemukan, skip delete');
      return { success: true };
    }

    const response = await fetch(`${API_BASE_URL}/storage/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ fileUrl })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ File deleted from Supabase');
      return { success: true };
    } else {
      console.warn('⚠️ Failed to delete file:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('Delete file error:', error);
    return { success: false, error: error.message };
  }
};

// ==================== CEK JENIS FILE ====================
const isImageFile = (url) => {
  if (!url) return false;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const lowerUrl = url.toLowerCase();
  return imageExtensions.some(ext => lowerUrl.includes(ext)) || 
         lowerUrl.includes('image') ||
         lowerUrl.includes('data:image');
};

const isPDFFile = (url) => {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('.pdf') || lowerUrl.includes('application/pdf');
};

// ==================== CEK ROLE IZIN ====================
const isFullAccess = (role) => {
  return ['developer', 'admin'].includes(role);
};

const isStaff = (role) => {
  return ['guru', 'staff_tu', 'wakil_kepala'].includes(role);
};

const isSiswaRole = (role) => {
  return role === 'siswa';
};

const IzinTab = ({ user }) => {
  // ==================== STATE ====================
  const [izinList, setIzinList] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: '' });
  
  // State untuk form izin
  const [formData, setFormData] = useState({
    type: 'sakit',
    startDate: '',
    endDate: '',
    reason: '',
    attachment: null,
    attachmentPreview: null,
    attachmentName: ''
  });

  // Refs
  const fileInputRef = useRef(null);

  // ==================== TOAST ====================
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: '' });
    }, 3500);
  };

  // ==================== PERMISSIONS ====================
  const userRole = user?.role || 'siswa';
  const isFullAccessUser = isFullAccess(userRole);
  const isStaffUser = isStaff(userRole);
  const isSiswaUser = isSiswaRole(userRole);
  
  // ⭐ PERMISSION LOGIC YANG DIPERBAIKI ⭐
  
  // 1. Bisa approve/reject:
  //    - Full Access (Admin/Developer): SEMUA izin
  //    - Staff (Guru/Staff TU/Wakil): HANYA izin dari SISWA
  const canApprove = (izin) => {
    if (!izin) return false;
    const isStudentIzin = isSiswaRole(izin.submittedByRole) || izin.studentId === izin.submittedBy;
    
    if (isFullAccessUser) return true;
    if (isStaffUser) return isStudentIzin;
    return false;
  };
  
  // 2. Bisa hapus:
  //    - Full Access (Admin/Developer): SEMUA izin
  //    - Staff (Guru/Staff TU/Wakil): HANYA izin dari SISWA
  //    - Siswa: HANYA izin sendiri yang status pending
  const canDelete = (izin) => {
    if (!izin) return false;
    const isStudentIzin = isSiswaRole(izin.submittedByRole) || izin.studentId === izin.submittedBy;
    const isOwner = izin.studentId == user?.fpId || izin.studentId == user?.uid || izin.submittedBy === user?.uid;
    const isPending = izin.status === 'pending';
    
    if (isFullAccessUser) return true;
    if (isStaffUser) return isStudentIzin;
    if (isSiswaUser) return isOwner && isPending;
    return false;
  };
  
  // 3. Bisa melihat semua izin:
  //    - Full Access & Staff: SEMUA izin
  //    - Siswa: HANYA izin sendiri
  const canViewAll = () => {
    return isFullAccessUser || isStaffUser;
  };

  // ==================== LOAD DATA ====================
  useEffect(() => {
    if (!user) return;

    const izinRef = ref(db, 'izin');
    
    const unsubscribe = onValue(izinRef, (snapshot) => {
      const data = snapshot.val();
      const list = [];
      
      if (data) {
        Object.entries(data).forEach(([id, izin]) => {
          list.push({ id, ...izin });
        });
      }
      
      // Filter berdasarkan role
      let filteredList = [...list];
      
      if (isSiswaUser) {
        // Siswa hanya lihat izin sendiri
        filteredList = list.filter(izin => 
          izin.studentId == user.fpId || izin.studentId == user.uid || izin.submittedBy === user.uid
        );
      }
      // Staff dan Full Access bisa lihat semua izin
      
      // Filter status
      if (filterStatus !== 'all') {
        filteredList = filteredList.filter(izin => izin.status === filterStatus);
      }
      
      // Urutkan dari terbaru
      filteredList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      setIzinList(filteredList);
      setLoading(false);
      setError(null);
    }, (error) => {
      console.error('Error loading izin:', error);
      setError('Gagal memuat data izin: ' + error.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, filterStatus, isSiswaUser]);

  // ==================== SET DEFAULT DATES ====================
  useEffect(() => {
    if (showModal) {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      setFormData(prev => ({
        ...prev,
        startDate: todayStr,
        endDate: tomorrowStr
      }));
    }
  }, [showModal]);

  // ==================== HANDLE FORM CHANGE ====================
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showToast('Ukuran file maksimal 2MB!', 'error');
        e.target.value = '';
        return;
      }
      setFormData(prev => ({
        ...prev,
        attachment: file,
        attachmentName: file.name,
        attachmentPreview: URL.createObjectURL(file)
      }));
    }
  };

  const clearAttachment = () => {
    setFormData(prev => ({
      ...prev,
      attachment: null,
      attachmentName: '',
      attachmentPreview: null
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ==================== SUBMIT IZIN ====================
  const handleSubmitIzin = async (e) => {
    e.preventDefault();
    
    if (!user) {
      showToast('Anda harus login!', 'error');
      return;
    }

    const { type, startDate, endDate, reason, attachment } = formData;

    if (!startDate || !endDate || !reason) {
      showToast('Semua field wajib diisi!', 'error');
      return;
    }

    if (startDate > endDate) {
      showToast('Tanggal selesai harus lebih besar dari tanggal mulai!', 'error');
      return;
    }

    setSubmitting(true);

    try {
      let attachmentUrl = null;

      if (attachment) {
        const result = await uploadToSupabase(attachment, 'izin');
        if (result.success) {
          attachmentUrl = result.url;
          console.log('✅ File uploaded to Supabase:', attachmentUrl);
        } else {
          showToast('Gagal upload lampiran: ' + (result.error || 'Unknown error'), 'error');
          setSubmitting(false);
          return;
        }
      }

      let studentId = user.fpId || user.uid || user.id;
      let studentName = user.nama || user.name || user.email || 'User';
      let kelas = user.kelas || '-';
      let jurusan = user.jurusan || '-';

      const izinData = {
        studentId: studentId,
        studentName: studentName,
        kelas: kelas,
        jurusan: jurusan,
        type: type,
        startDate: startDate,
        endDate: endDate,
        reason: reason,
        attachmentUrl: attachmentUrl,
        status: 'pending',
        submittedBy: user.nama || user.email || 'System',
        submittedByRole: user.role || 'siswa',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await push(ref(db, 'izin'), izinData);

      showToast('✅ Izin berhasil diajukan! Menunggu persetujuan.', 'success');

      setFormData({
        type: 'sakit',
        startDate: '',
        endDate: '',
        reason: '',
        attachment: null,
        attachmentPreview: null,
        attachmentName: ''
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setShowModal(false);

      if (typeof window.logActivity === 'function') {
        window.logActivity('submit_izin', `Ajukan izin ${type}: ${studentName} (${startDate} - ${endDate})`);
      }

    } catch (error) {
      console.error('Submit izin error:', error);
      showToast('❌ Gagal mengajukan izin: ' + error.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ==================== APPROVE IZIN ====================
  const handleApproveIzin = async (izinId, studentName) => {
    const izin = izinList.find(i => i.id === izinId);
    
    // ⭐ CEK PERMISSION APPROVE ⭐
    if (!canApprove(izin)) {
      if (isSiswaUser) {
        showToast('⛔ Hanya Guru/Staff TU/Admin/Developer yang dapat menyetujui izin!', 'error');
      } else {
        showToast('⛔ Anda tidak memiliki akses untuk menyetujui izin staff! Hanya Admin/Developer yang dapat menyetujui izin staff.', 'error');
      }
      return;
    }

    if (!window.confirm(`Setujui izin untuk ${studentName}?`)) return;

    try {
      await update(ref(db, `izin/${izinId}`), {
        status: 'approved',
        approvedBy: user.nama || user.email || 'System',
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showToast(`✅ Izin ${studentName} disetujui!`, 'success');

      if (typeof window.logActivity === 'function') {
        window.logActivity('approve_izin', `Menyetujui izin ${studentName}`);
      }

    } catch (error) {
      console.error('Approve izin error:', error);
      showToast('❌ Gagal menyetujui izin: ' + error.message, 'error');
    }
  };

  // ==================== REJECT IZIN ====================
  const handleRejectIzin = async (izinId, studentName) => {
    const izin = izinList.find(i => i.id === izinId);
    
    // ⭐ CEK PERMISSION REJECT ⭐
    if (!canApprove(izin)) {
      if (isSiswaUser) {
        showToast('⛔ Hanya Guru/Staff TU/Admin/Developer yang dapat menolak izin!', 'error');
      } else {
        showToast('⛔ Anda tidak memiliki akses untuk menolak izin staff! Hanya Admin/Developer yang dapat menolak izin staff.', 'error');
      }
      return;
    }

    const reason = prompt(`Masukkan alasan penolakan izin untuk ${studentName}:`);
    if (reason === null) return;
    if (!reason.trim()) {
      showToast('Alasan penolakan wajib diisi!', 'error');
      return;
    }

    try {
      await update(ref(db, `izin/${izinId}`), {
        status: 'rejected',
        rejectReason: reason.trim(),
        rejectedBy: user.nama || user.email || 'System',
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showToast(`❌ Izin ${studentName} ditolak.`, 'warning');

      if (typeof window.logActivity === 'function') {
        window.logActivity('reject_izin', `Menolak izin ${studentName}: ${reason}`);
      }

    } catch (error) {
      console.error('Reject izin error:', error);
      showToast('❌ Gagal menolak izin: ' + error.message, 'error');
    }
  };

  // ==================== DELETE IZIN ====================
  const handleDeleteIzin = async (izinId, studentName) => {
    const izin = izinList.find(i => i.id === izinId);
    
    // ⭐ CEK PERMISSION DELETE ⭐
    if (!canDelete(izin)) {
      if (isSiswaUser) {
        showToast('⛔ Anda hanya dapat menghapus izin sendiri yang masih menunggu persetujuan!', 'error');
      } else if (isStaffUser) {
        showToast('⛔ Staff hanya dapat menghapus izin yang diajukan oleh SISWA! Izin ini diajukan oleh staff.', 'error');
      } else {
        showToast('⛔ Anda tidak memiliki akses untuk menghapus izin ini!', 'error');
      }
      return;
    }

    let confirmMessage = `Hapus pengajuan izin untuk ${studentName}?`;
    if (izin && izin.status !== 'pending') {
      confirmMessage = `Hapus pengajuan izin ${studentName} yang sudah ${izin.status === 'approved' ? 'DISETUJUI' : 'DITOLAK'}?\n\nData ini akan dihapus permanen!`;
    }
    
    if (!window.confirm(confirmMessage)) return;

    try {
      // ⭐ 1. HAPUS FILE DI SUPABASE ⭐
      if (izin && izin.attachmentUrl && izin.attachmentUrl !== 'null') {
        const deleteResult = await deleteFileFromSupabase(izin.attachmentUrl);
        if (deleteResult.success) {
          console.log('✅ File di Supabase berhasil dihapus');
        } else {
          console.warn('⚠️ Gagal hapus file di Supabase:', deleteResult.error);
        }
      }

      // ⭐ 2. HAPUS DATA IZIN DI FIREBASE ⭐
      await remove(ref(db, `izin/${izinId}`));

      showToast(`🗑️ Izin ${studentName} berhasil dihapus!`, 'success');

      if (typeof window.logActivity === 'function') {
        window.logActivity('delete_izin', `Menghapus izin ${studentName} (${izin?.status || 'unknown'})`);
      }

    } catch (error) {
      console.error('Delete izin error:', error);
      showToast('❌ Gagal menghapus izin: ' + error.message, 'error');
    }
  };

  // ==================== RENDER ATTACHMENT ====================
  const renderAttachment = (attachmentUrl) => {
    if (!attachmentUrl || attachmentUrl === 'null' || attachmentUrl === 'undefined') {
      return null;
    }

    const isImage = isImageFile(attachmentUrl);
    const isPDF = isPDFFile(attachmentUrl);

    if (isImage) {
      return (
        <div className="izin-attachment-image">
          <div className="attachment-image-wrapper">
            <img 
              src={attachmentUrl} 
              alt="Lampiran Izin"
              className="attachment-thumbnail"
              onClick={() => window.open(attachmentUrl, '_blank')}
              onError={(e) => {
                e.target.style.display = 'none';
                const parent = e.target.parentElement;
                const fallback = document.createElement('div');
                fallback.className = 'attachment-fallback';
                fallback.innerHTML = `
                  <span class="fallback-icon">🖼️</span>
                  <a href="${attachmentUrl}" target="_blank" rel="noopener noreferrer" class="attachment-link-fallback">
                    📎 Lihat Lampiran (Gagal memuat gambar)
                  </a>
                `;
                parent.appendChild(fallback);
              }}
            />
            <div className="attachment-overlay">
              <button 
                className="attachment-view-btn"
                onClick={() => window.open(attachmentUrl, '_blank')}
              >
                🔍 Lihat
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (isPDF) {
      return (
        <div className="izin-attachment-pdf">
          <div className="pdf-icon">📄</div>
          <a 
            href={attachmentUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="attachment-link"
          >
            📎 Lihat Lampiran (PDF)
          </a>
        </div>
      );
    }

    // Default: link biasa
    return (
      <div className="izin-attachment-default">
        <a 
          href={attachmentUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="attachment-link"
        >
          📎 Lihat Lampiran (Surat/Dokumen)
        </a>
      </div>
    );
  };

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="izin-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>⏳ Memuat data izin...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="izin-container">
        <div className="error-state">
          <div className="error-icon">❌</div>
          <h3>Gagal Memuat Data</h3>
          <p>{error}</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>
            🔄 Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  const pendingCount = izinList.filter(i => i.status === 'pending').length;

  return (
    <div className="izin-container">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`izin-toast ${toast.type}`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="izin-header">
        <div className="header-left">
          <h3>📝 Izin Online</h3>
          <p className="header-subtitle">Ajukan izin sakit/keperluan keluarga secara online</p>
        </div>
        {pendingCount > 0 && (
          <div className="header-badge">
            <span className="badge-pending">{pendingCount} Menunggu</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="izin-actions">
        <button 
          className="btn-primary" 
          onClick={() => setShowModal(true)}
        >
          ➕ Ajukan Izin Baru
        </button>
        <div className="izin-filter">
          <button 
            className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            Semua
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'pending' ? 'active' : ''}`}
            onClick={() => setFilterStatus('pending')}
          >
            ⏳ Menunggu
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'approved' ? 'active' : ''}`}
            onClick={() => setFilterStatus('approved')}
          >
            ✅ Disetujui
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'rejected' ? 'active' : ''}`}
            onClick={() => setFilterStatus('rejected')}
          >
            ❌ Ditolak
          </button>
        </div>
      </div>

      {/* Izin List */}
      <div className="izin-list">
        {izinList.length === 0 ? (
          <div className="izin-empty">
            <div className="empty-icon">📭</div>
            <h4>Belum Ada Pengajuan Izin</h4>
            <p className="empty-subtitle">Klik tombol "Ajukan Izin Baru" untuk mengajukan izin.</p>
          </div>
        ) : (
          <div className="izin-grid">
            {izinList.map((izin) => {
              const isPending = izin.status === 'pending';
              const isApproved = izin.status === 'approved';
              const isRejected = izin.status === 'rejected';
              
              let statusClass = 'status-pending';
              let statusText = '⏳ Menunggu Persetujuan';
              let statusColor = '#b85c00';
              
              if (isApproved) {
                statusClass = 'status-approved';
                statusText = '✅ Disetujui';
                statusColor = '#0f5c2e';
              } else if (isRejected) {
                statusClass = 'status-rejected';
                statusText = '❌ Ditolak';
                statusColor = '#a01a2c';
              }

              const isOwner = isSiswaUser && 
                (izin.studentId == user.fpId || izin.studentId == user.uid || izin.submittedBy === user.uid);
              
              const isStudentIzin = isSiswaRole(izin.submittedByRole) || izin.studentId === izin.submittedBy;
              
              // ⭐ Tentukan tombol aksi berdasarkan permission ⭐
              let actionButtons = null;
              
              // Cek permission approve/reject
              const canApproveThis = canApprove(izin);
              const canDeleteThis = canDelete(izin);
              
              if (canApproveThis && isPending) {
                actionButtons = (
                  <div className="action-buttons">
                    <button 
                      className="btn-approve"
                      onClick={() => handleApproveIzin(izin.id, izin.studentName)}
                      title="Setujui izin ini"
                    >
                      ✅ Setujui
                    </button>
                    <button 
                      className="btn-reject"
                      onClick={() => handleRejectIzin(izin.id, izin.studentName)}
                      title="Tolak izin ini"
                    >
                      ❌ Tolak
                    </button>
                    {canDeleteThis && (
                      <button 
                        className="btn-delete"
                        onClick={() => handleDeleteIzin(izin.id, izin.studentName)}
                        title="Hapus izin ini"
                      >
                        🗑️ Hapus
                      </button>
                    )}
                  </div>
                );
              } else if (canDeleteThis && !isPending) {
                actionButtons = (
                  <div className="action-buttons">
                    <button 
                      className="btn-delete"
                      onClick={() => handleDeleteIzin(izin.id, izin.studentName)}
                      title="Hapus izin ini"
                    >
                      🗑️ Hapus
                    </button>
                  </div>
                );
              } else if (isOwner && isPending && isSiswaUser) {
                actionButtons = (
                  <div className="action-buttons">
                    <button 
                      className="btn-delete"
                      onClick={() => handleDeleteIzin(izin.id, izin.studentName)}
                      title="Hapus izin Anda sendiri"
                    >
                      🗑️ Hapus
                    </button>
                  </div>
                );
              }

              return (
                <div 
                  key={izin.id} 
                  className="izin-card"
                  style={{ borderLeftColor: statusColor }}
                >
                  <div className="izin-card-header">
                    <div className="izin-type">
                      {izin.type === 'sakit' ? '🤒 Izin Sakit' : '📝 Izin Keperluan'}
                    </div>
                    <div className={`izin-status ${statusClass}`}>
                      {statusText}
                    </div>
                  </div>

                  <div className="izin-card-body">
                    <div className="izin-student">
                      <strong className="student-name">👤 {escapeHtml(izin.studentName)}</strong>
                      <div className="student-class">
                        Kelas: {izin.kelas || '-'} | Jurusan: {izin.jurusan || '-'}
                      </div>
                      {/* ⭐ Tampilkan role pengaju */}
                      <div className="student-role" style={{ 
                        fontSize: '11px', 
                        color: 'var(--text-muted)',
                        marginTop: '2px'
                      }}>
                        🎯 Role: {
                          izin.submittedByRole === 'siswa' ? 'Siswa' :
                          izin.submittedByRole === 'guru' ? '👨‍🏫 Guru' :
                          izin.submittedByRole === 'staff_tu' ? '📋 Staff TU' :
                          izin.submittedByRole === 'wakil_kepala' ? '👔 Wakil Kepala' :
                          izin.submittedByRole === 'admin' ? '👑 Kepala Sekolah' :
                          izin.submittedByRole === 'developer' ? '💻 Developer' :
                          izin.submittedByRole || 'Siswa'
                        }
                      </div>
                    </div>

                    <div className="izin-date">
                      📅 {formatIndonesianDate(izin.startDate)} - {formatIndonesianDate(izin.endDate)}
                    </div>

                    <div className="izin-reason">
                      <strong>Alasan:</strong><br />
                      {escapeHtml(izin.reason)}
                    </div>

                    {/* ⭐ RENDER ATTACHMENT - FOTO LANGSUNG DITAMPILKAN ⭐ */}
                    {izin.attachmentUrl && izin.attachmentUrl !== 'null' && (
                      <div className="izin-attachment-wrapper">
                        {renderAttachment(izin.attachmentUrl)}
                      </div>
                    )}

                    {isRejected && (izin.rejectReason || izin.reason) && (
                      <div className="izin-reject-reason">
                        <strong>Alasan Ditolak:</strong> {escapeHtml(izin.rejectReason || izin.reason)}
                      </div>
                    )}
                  </div>

                  <div className="izin-card-footer">
                    <div className="footer-info">
                      Diajukan: {formatDate(izin.createdAt)}
                      {izin.submittedByRole && (
                        <span style={{ marginLeft: '8px', fontSize: '10px', opacity: 0.6 }}>
                          oleh {izin.submittedByRole === 'siswa' ? 'Siswa' :
                                izin.submittedByRole === 'guru' ? 'Guru' :
                                izin.submittedByRole === 'staff_tu' ? 'Staff TU' :
                                izin.submittedByRole === 'wakil_kepala' ? 'Wakil Kepala' :
                                izin.submittedByRole === 'admin' ? 'Kepala Sekolah' :
                                izin.submittedByRole === 'developer' ? 'Developer' :
                                izin.submittedByRole || 'Siswa'}
                        </span>
                      )}
                    </div>
                    {actionButtons}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Ajukan Izin */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <span>📝 Ajukan Izin</span>
                <button 
                  className="modal-close-btn" 
                  onClick={() => setShowModal(false)}
                >
                  ✖
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitIzin} className="modal-form">
              <div className="modal-body">
                <div className="form-group">
                  <label>📋 Jenis Izin</label>
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleFormChange}
                    required
                  >
                    <option value="sakit">🤒 Sakit</option>
                    <option value="keperluan">📝 Keperluan Keluarga</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>📅 Tanggal Mulai</label>
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleFormChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>📅 Tanggal Selesai</label>
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleFormChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>📝 Alasan / Keterangan</label>
                  <textarea
                    name="reason"
                    value={formData.reason}
                    onChange={handleFormChange}
                    rows="4"
                    placeholder="Jelaskan alasan izin..."
                    required
                  />
                </div>

                <div className="form-group">
                  <label>📎 Lampiran (Opsional)</label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileChange}
                  />
                  <small className="form-hint">
                    Format: PDF, JPG, PNG. Maksimal 2MB
                  </small>
                  {formData.attachmentName && (
                    <div className="attachment-preview">
                      <span>📎 {formData.attachmentName}</span>
                      <button 
                        type="button" 
                        className="btn-remove-attachment"
                        onClick={clearAttachment}
                      >
                        ✖
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-cancel"
                  onClick={() => setShowModal(false)}
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="btn-submit"
                  disabled={submitting}
                >
                  {submitting ? '⏳ Mengirim...' : '📤 Ajukan Izin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default IzinTab;