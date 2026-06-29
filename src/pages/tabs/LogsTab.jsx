// src/pages/tabs/LogsTab.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, off, get, remove, query, orderByChild, limitToLast, update } from 'firebase/database';
import { db } from '../../firebase/config';
import { logActivity } from '../../utils/logger';
import './LogsTab.css';

const LogsTab = ({ user }) => {
  // ==================== STATE ====================
  const [logs, setLogs] = useState([]);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAutoDeleting, setIsAutoDeleting] = useState(false);
  
  // Filter states
  const [filterAction, setFilterAction] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showDeveloperLogs, setShowDeveloperLogs] = useState(false);
  
  // Refs
  const logsListenerRef = useRef(null);
  const logsPerPage = 20;
  const AUTO_DELETE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 1 minggu dalam milidetik

  // ==================== ROLE PERMISSIONS ====================
  const rawRole = user?.role || 'siswa';
  const role = rawRole.toString().toLowerCase().trim();
  
  const isDeveloper = role === 'developer';
  const isAdmin = role === 'admin';
  const isWakilKepala = role === 'wakil_kepala';
  const isGuru = role === 'guru';
  const isStaff = role === 'staff_tu';
  const isSiswa = role === 'siswa';
  
  const hasAccess = isDeveloper || isAdmin || isWakilKepala || isGuru || isStaff;
  const canDelete = isDeveloper || isAdmin;
  const canSeeDeveloperLogs = isDeveloper || isAdmin;

  // ==================== GET ROLE HELPERS ====================
  const getRoleDisplayName = useCallback((role) => {
    const names = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala Sekolah',
      staff_tu: 'Staff TU',
      guru: 'Guru',
      siswa: 'Siswa'
    };
    return names[role] || role.toUpperCase();
  }, []);

  const getRoleIcon = useCallback((role) => {
    const icons = {
      developer: '👨‍💻',
      admin: '👑',
      wakil_kepala: '👔',
      staff_tu: '📋',
      guru: '👨‍🏫',
      siswa: '👨‍🎓'
    };
    return icons[role] || '👤';
  }, []);

  // ==================== FILTER SENSITIVE ACTIONS (DEFINED EARLY) ====================
  const filterSensitiveActions = useCallback((logsData) => {
    if (role === 'staff_tu') {
      const sensitiveActions = ['delete_user', 'reset_system', 'update_user_role', 'delete_announcement', 'delete_log', 'delete_all_logs', 'auto_delete_old_logs'];
      return logsData.filter(log => !sensitiveActions.includes(log.action));
    }
    return logsData;
  }, [role]);

  // ==================== ACTION HELPERS ====================
  const getActionIcon = useCallback((action) => {
    const icons = {
      'login': '🔓', 'logout': '🚪', 'register': '📝', 'forgot_password': '🔐',
      'create_announcement': '📢', 'update_announcement': '✏️', 'delete_announcement': '🗑️',
      'delete_attendance': '🗑️', 'simulate_attendance_in': '✅', 'simulate_attendance_out': '🏠',
      'save_manual_attendance': '📝', 'export_attendance_excel': '📊',
      'add_student': '➕', 'edit_student': '✏️', 'delete_student': '🗑️',
      'import_students': '📥', 'export_students': '📤',
      'update_user_role': '🔄', 'delete_user': '🗑️', 'reset_system': '⚠️', 'reset_user_password': '🔑',
      'create_status': '📸', 'delete_status': '🗑️',
      'send_friend_request': '➕', 'accept_friend_request': '✅', 'reject_friend_request': '❌', 'remove_friend': '🗑️',
      'delete_chat_message': '💬🗑️', 'clear_chat': '🧹',
      'upload_profile_photo': '📸', 'save_school_name': '🏫', 'upload_school_logo': '🖼️',
      'remove_school_logo': '🗑️', 'update_global_delay': '⏰', 'save_classes': '📚',
      'save_majors': '🎓', 'update_school_type': '🏫',
      'export_rekap_excel': '📊', 'export_rekap_pdf': '📄',
      'add_staff': '➕', 'edit_staff': '✏️', 'delete_staff': '🗑️', 'create_staff_account': '👤',
      'simulate_staff_attendance_in': '✅', 'simulate_staff_attendance_out': '🏠', 'delete_staff_attendance': '🗑️',
      'export_staff_attendance_excel': '📊',
      'create_izin': '📝', 'update_izin': '✏️', 'delete_izin': '🗑️', 'approve_izin': '✅', 'reject_izin': '❌',
      'generate_code': '🔑', 'delete_code': '🗑️',
      'delete_log': '🗑️', 'delete_all_logs': '🔥', 'auto_delete_old_logs': '🧹',
      'send_message': '💬', 'view_profile': '👁️', 'update_profile': '✏️',
      'add_comment': '💬', 'like_post': '❤️', 'share_post': '📤',
      'download_file': '📥', 'upload_file': '📤',
      'create_class': '📚', 'update_class': '✏️', 'delete_class': '🗑️',
      'add_schedule': '📅', 'update_schedule': '✏️', 'delete_schedule': '🗑️',
      'submit_assignment': '📝', 'grade_assignment': '⭐',
      'create_exam': '📝', 'update_exam': '✏️', 'delete_exam': '🗑️',
      'submit_exam': '📝', 'grade_exam': '⭐',
      'create_group': '👥', 'update_group': '✏️', 'delete_group': '🗑️',
      'join_group': '➕', 'leave_group': '➖',
      'create_event': '📅', 'update_event': '✏️', 'delete_event': '🗑️',
      'rsvp_event': '✅', 'cancel_rsvp': '❌',
      'create_survey': '📊', 'vote_survey': '🗳️',
      'create_ticket': '🎫', 'update_ticket': '✏️', 'delete_ticket': '🗑️',
      'create_feedback': '💬', 'update_feedback': '✏️', 'delete_feedback': '🗑️',
      'create_report': '📊', 'update_report': '✏️', 'delete_report': '🗑️',
      'generate_report': '📊', 'export_report': '📥',
      'create_backup': '💾', 'restore_backup': '🔄',
      'system_maintenance': '🔧', 'system_update': '📦',
      'security_alert': '⚠️', 'security_log': '🔒'
    };
    return icons[action] || '📌';
  }, []);

  const formatActionName = useCallback((action) => {
    const names = {
      'login': 'Login', 'logout': 'Logout', 'register': 'Registrasi', 'forgot_password': 'Lupa Password',
      'create_announcement': 'Buat Pengumuman', 'update_announcement': 'Edit Pengumuman', 'delete_announcement': 'Hapus Pengumuman',
      'delete_attendance': 'Hapus Absensi', 'simulate_attendance_in': 'Simulasi Absen Masuk',
      'simulate_attendance_out': 'Simulasi Absen Pulang', 'save_manual_attendance': 'Atur Ketidakhadiran',
      'export_attendance_excel': 'Ekspor Absensi Excel',
      'add_student': 'Tambah Siswa', 'edit_student': 'Edit Siswa', 'delete_student': 'Hapus Siswa',
      'import_students': 'Import Siswa', 'export_students': 'Export Siswa',
      'update_user_role': 'Ubah Role', 'delete_user': 'Hapus User', 'reset_system': 'Reset Sistem',
      'reset_user_password': 'Reset Password',
      'create_status': 'Buat Status', 'delete_status': 'Hapus Status',
      'send_friend_request': 'Kirim Teman', 'accept_friend_request': 'Terima Teman',
      'reject_friend_request': 'Tolak Teman', 'remove_friend': 'Hapus Teman',
      'delete_chat_message': 'Hapus Pesan', 'clear_chat': 'Bersihkan Chat',
      'upload_profile_photo': 'Upload Foto', 'save_school_name': 'Ubah Nama Sekolah',
      'upload_school_logo': 'Upload Logo', 'remove_school_logo': 'Hapus Logo',
      'update_global_delay': 'Ubah Delay', 'save_classes': 'Simpan Kelas',
      'save_majors': 'Simpan Jurusan', 'update_school_type': 'Ubah Tipe Sekolah',
      'export_rekap_excel': 'Ekspor Rekap Excel', 'export_rekap_pdf': 'Ekspor Rekap PDF',
      'add_staff': 'Tambah Staff', 'edit_staff': 'Edit Staff', 'delete_staff': 'Hapus Staff',
      'create_staff_account': 'Buat Akun Staff',
      'simulate_staff_attendance_in': 'Absen Masuk Staff', 'simulate_staff_attendance_out': 'Absen Pulang Staff',
      'delete_staff_attendance': 'Hapus Absensi Staff', 'export_staff_attendance_excel': 'Ekspor Absensi Staff Excel',
      'create_izin': 'Ajukan Izin', 'update_izin': 'Edit Izin', 'delete_izin': 'Hapus Izin',
      'approve_izin': 'Setujui Izin', 'reject_izin': 'Tolak Izin',
      'generate_code': 'Generate Kode', 'delete_code': 'Hapus Kode',
      'delete_log': 'Hapus Log', 'delete_all_logs': 'Hapus Semua Log', 'auto_delete_old_logs': 'Hapus Otomatis Log Lama',
      'send_message': 'Kirim Pesan', 'view_profile': 'Lihat Profil', 'update_profile': 'Update Profil',
      'add_comment': 'Tambah Komentar', 'like_post': 'Suka Postingan', 'share_post': 'Bagikan Postingan',
      'download_file': 'Download File', 'upload_file': 'Upload File',
      'create_class': 'Buat Kelas', 'update_class': 'Edit Kelas', 'delete_class': 'Hapus Kelas',
      'add_schedule': 'Tambah Jadwal', 'update_schedule': 'Edit Jadwal', 'delete_schedule': 'Hapus Jadwal',
      'submit_assignment': 'Kirim Tugas', 'grade_assignment': 'Nilai Tugas',
      'create_exam': 'Buat Ujian', 'update_exam': 'Edit Ujian', 'delete_exam': 'Hapus Ujian',
      'submit_exam': 'Kirim Ujian', 'grade_exam': 'Nilai Ujian',
      'create_group': 'Buat Grup', 'update_group': 'Edit Grup', 'delete_group': 'Hapus Grup',
      'join_group': 'Bergabung Grup', 'leave_group': 'Keluar Grup',
      'create_event': 'Buat Event', 'update_event': 'Edit Event', 'delete_event': 'Hapus Event',
      'rsvp_event': 'Konfirmasi Event', 'cancel_rsvp': 'Batal Konfirmasi',
      'create_survey': 'Buat Survei', 'vote_survey': 'Vote Survei',
      'create_ticket': 'Buat Tiket', 'update_ticket': 'Edit Tiket', 'delete_ticket': 'Hapus Tiket',
      'create_feedback': 'Buat Feedback', 'update_feedback': 'Edit Feedback', 'delete_feedback': 'Hapus Feedback',
      'create_report': 'Buat Laporan', 'update_report': 'Edit Laporan', 'delete_report': 'Hapus Laporan',
      'generate_report': 'Generate Laporan', 'export_report': 'Ekspor Laporan',
      'create_backup': 'Buat Backup', 'restore_backup': 'Restore Backup',
      'system_maintenance': 'Maintenance Sistem', 'system_update': 'Update Sistem',
      'security_alert': 'Alert Keamanan', 'security_log': 'Log Keamanan'
    };
    return names[action] || action.replace(/_/g, ' ').toUpperCase();
  }, []);

  // ==================== GET ALLOWED ACTIONS ====================
  const getAllowedActions = useCallback(() => {
    const allActions = [
      'login', 'logout', 'register', 'forgot_password',
      'create_announcement', 'update_announcement', 'delete_announcement',
      'delete_attendance', 'simulate_attendance_in', 'simulate_attendance_out', 'save_manual_attendance', 'export_attendance_excel',
      'add_student', 'edit_student', 'delete_student', 'import_students', 'export_students',
      'update_user_role', 'delete_user', 'reset_system', 'reset_user_password',
      'create_status', 'delete_status',
      'send_friend_request', 'accept_friend_request', 'reject_friend_request', 'remove_friend',
      'delete_chat_message', 'clear_chat', 'send_message',
      'upload_profile_photo', 'save_school_name', 'upload_school_logo', 'remove_school_logo',
      'update_global_delay', 'save_classes', 'save_majors', 'update_school_type',
      'export_rekap_excel', 'export_rekap_pdf',
      'add_staff', 'edit_staff', 'delete_staff', 'create_staff_account',
      'simulate_staff_attendance_in', 'simulate_staff_attendance_out', 'delete_staff_attendance', 'export_staff_attendance_excel',
      'create_izin', 'update_izin', 'delete_izin', 'approve_izin', 'reject_izin',
      'generate_code', 'delete_code',
      'delete_log', 'delete_all_logs', 'auto_delete_old_logs',
      'view_profile', 'update_profile', 'add_comment', 'like_post', 'share_post',
      'download_file', 'upload_file',
      'create_class', 'update_class', 'delete_class',
      'add_schedule', 'update_schedule', 'delete_schedule',
      'submit_assignment', 'grade_assignment',
      'create_exam', 'update_exam', 'delete_exam', 'submit_exam', 'grade_exam',
      'create_group', 'update_group', 'delete_group', 'join_group', 'leave_group',
      'create_event', 'update_event', 'delete_event', 'rsvp_event', 'cancel_rsvp',
      'create_survey', 'vote_survey',
      'create_ticket', 'update_ticket', 'delete_ticket',
      'create_feedback', 'update_feedback', 'delete_feedback',
      'create_report', 'update_report', 'delete_report', 'generate_report', 'export_report',
      'create_backup', 'restore_backup',
      'system_maintenance', 'system_update', 'security_alert', 'security_log'
    ];
    
    if (role === 'staff_tu') {
      const sensitiveActions = ['delete_user', 'reset_system', 'update_user_role', 'delete_announcement', 'delete_log', 'delete_all_logs', 'auto_delete_old_logs'];
      return allActions.filter(a => !sensitiveActions.includes(a));
    }
    
    if (role === 'siswa') {
      return ['login', 'logout', 'create_status', 'delete_status', 'send_friend_request', 'accept_friend_request', 'reject_friend_request', 'remove_friend', 'delete_chat_message', 'clear_chat', 'send_message', 'view_profile', 'update_profile', 'add_comment', 'like_post', 'share_post', 'download_file', 'upload_file'];
    }
    
    return allActions;
  }, [role]);

  // ==================== AUTO DELETE OLD LOGS ====================
  const autoDeleteOldLogs = useCallback(async () => {
    if (!canDelete) return;
    
    try {
      console.log('🧹 Memulai auto-delete logs lama...');
      setIsAutoDeleting(true);
      
      const logsRef = ref(db, 'logs');
      const snapshot = await get(logsRef);
      
      if (!snapshot.exists()) {
        console.log('📭 Tidak ada log untuk dihapus');
        return;
      }
      
      const data = snapshot.val();
      const now = Date.now();
      let deletedCount = 0;
      const deletePromises = [];
      
      Object.entries(data).forEach(([id, log]) => {
        // Hitung usia log
        const logTimestamp = log.timestamp || log.createdAt || 0;
        const age = now - logTimestamp;
        
        // Hapus jika lebih dari 1 minggu
        if (age >= AUTO_DELETE_INTERVAL) {
          deletePromises.push(remove(ref(db, `logs/${id}`)));
          deletedCount++;
        }
      });
      
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
        console.log(`✅ Berhasil menghapus ${deletedCount} log lama (usia > 1 minggu)`);
        
        // Log aktivitas auto-delete
        try {
          await logActivity('auto_delete_old_logs', 
            `Auto-delete: Menghapus ${deletedCount} log yang berusia lebih dari 1 minggu - ${getRoleDisplayName(role)}`,
            user
          );
        } catch (logErr) {
          console.warn('⚠️ Gagal mencatat auto-delete log:', logErr);
        }
      } else {
        console.log('📭 Tidak ada log yang perlu dihapus (semua masih baru)');
      }
    } catch (error) {
      console.error('❌ Gagal auto-delete logs:', error);
    } finally {
      setIsAutoDeleting(false);
    }
  }, [canDelete, role, getRoleDisplayName, user]);

  // ==================== LOAD LOGS ====================
  useEffect(() => {
    if (!hasAccess) {
      setLoading(false);
      return;
    }

    console.log('📋 Loading logs from Firebase...');
    setLoading(true);

    const logsRef = ref(db, 'logs');
    
    const listener = onValue(logsRef, (snapshot) => {
      const data = snapshot.val();
      const logsList = [];
      
      console.log('📋 Logs data received:', data ? Object.keys(data).length : 0, 'logs');
      
      if (data) {
        Object.entries(data).forEach(([id, log]) => {
          logsList.push({
            id,
            ...log,
            timestamp: log.timestamp || log.createdAt || Date.now(),
            date: log.timestamp ? new Date(log.timestamp).toISOString().split('T')[0] : '',
            time: log.timestamp ? new Date(log.timestamp).toLocaleTimeString('id-ID', { 
              hour: '2-digit', 
              minute: '2-digit',
              second: '2-digit'
            }) : '-'
          });
        });
      }
      
      // Sort by timestamp (newest first)
      logsList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      // Filter berdasarkan role
      let filtered = [...logsList];
      
      if (role === 'siswa') {
        filtered = filtered.filter(log => log.userId === user.uid);
      } else if (role === 'staff_tu') {
        filtered = filterSensitiveActions(filtered);
      }
      
      // Jika bukan developer atau admin, sembunyikan log developer
      if (!canSeeDeveloperLogs) {
        filtered = filtered.filter(log => log.userRole !== 'developer');
      }
      
      // Jika showDeveloperLogs false, sembunyikan log developer
      if (!showDeveloperLogs && canSeeDeveloperLogs) {
        filtered = filtered.filter(log => log.userRole !== 'developer');
      }
      
      setLogs(logsList);
      setFilteredLogs(filtered);
      setLoading(false);
      
      // Set default dates if not set
      if (!filterStartDate && !filterEndDate) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        setFilterStartDate(startDate.toISOString().split('T')[0]);
        setFilterEndDate(endDate.toISOString().split('T')[0]);
      }
      
      // Calculate total pages
      const total = Math.ceil(filtered.length / logsPerPage);
      setTotalPages(total > 0 ? total : 1);
      
    }, (error) => {
      console.error('❌ Error loading logs:', error);
      setError('Gagal memuat log aktivitas: ' + error.message);
      setLoading(false);
    });

    logsListenerRef.current = listener;

    return () => {
      if (logsListenerRef.current) {
        off(logsRef);
        logsListenerRef.current = null;
      }
    };
  }, [hasAccess, user?.uid, role, canSeeDeveloperLogs, showDeveloperLogs, filterSensitiveActions]);

  // ==================== AUTO DELETE SCHEDULE ====================
  useEffect(() => {
    if (!canDelete) return;
    
    // Jalankan auto-delete saat pertama kali komponen dimuat
    autoDeleteOldLogs();
    
    // Jalankan auto-delete setiap 1 jam untuk memastikan log terhapus tepat waktu
    const intervalId = setInterval(() => {
      autoDeleteOldLogs();
    }, 60 * 60 * 1000); // 1 jam
    
    return () => {
      clearInterval(intervalId);
    };
  }, [canDelete, autoDeleteOldLogs]);

  // ==================== APPLY FILTERS ====================
  useEffect(() => {
    let filtered = [...logs];
    
    // Filter by action
    if (filterAction !== 'all') {
      filtered = filtered.filter(log => log.action === filterAction);
    }
    
    // Filter by role (siswa hanya melihat log sendiri)
    if (role === 'siswa') {
      filtered = filtered.filter(log => log.userId === user.uid);
    } else if (role === 'staff_tu') {
      filtered = filterSensitiveActions(filtered);
    }
    
    // Sembunyikan log developer kecuali jika diizinkan
    if (!canSeeDeveloperLogs) {
      filtered = filtered.filter(log => log.userRole !== 'developer');
    }
    
    // Toggle show developer logs
    if (!showDeveloperLogs && canSeeDeveloperLogs) {
      filtered = filtered.filter(log => log.userRole !== 'developer');
    }
    
    // Filter by date range
    if (filterStartDate && filterEndDate) {
      const start = new Date(filterStartDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filterEndDate);
      end.setHours(23, 59, 59, 999);
      
      filtered = filtered.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= start && logDate <= end;
      });
    }
    
    setFilteredLogs(filtered);
    
    // Calculate total pages
    const total = Math.ceil(filtered.length / logsPerPage);
    setTotalPages(total > 0 ? total : 1);
    setCurrentPage(1);
  }, [logs, filterAction, filterStartDate, filterEndDate, role, user?.uid, filterSensitiveActions, canSeeDeveloperLogs, showDeveloperLogs]);

  // ==================== GET PAGINATED LOGS ====================
  const getPaginatedLogs = useCallback(() => {
    const startIdx = (currentPage - 1) * logsPerPage;
    const endIdx = startIdx + logsPerPage;
    return filteredLogs.slice(startIdx, endIdx);
  }, [filteredLogs, currentPage]);

  // ==================== DELETE SINGLE LOG ====================
  const deleteSingleLog = useCallback(async (logId) => {
    if (!canDelete) {
      alert('⛔ Hanya Developer dan Kepala Sekolah yang dapat menghapus log!');
      return;
    }
    
    const logToDelete = logs.find(log => log.id === logId);
    if (!logToDelete) {
      alert('❌ Log tidak ditemukan!');
      return;
    }
    
    const logTime = logToDelete.timestamp ? new Date(logToDelete.timestamp).toLocaleString('id-ID') : 'Waktu tidak diketahui';
    const logAction = formatActionName(logToDelete.action);
    const logUser = logToDelete.userName || logToDelete.userId || 'Unknown';
    
    if (!window.confirm(
      `⚠️ HAPUS LOG\n\n` +
      `Apakah Anda yakin ingin menghapus log ini?\n\n` +
      `📅 Waktu: ${logTime}\n` +
      `👤 Pengguna: ${logUser}\n` +
      `📌 Aksi: ${logAction}\n` +
      `📝 Detail: ${(logToDelete.details || '-').substring(0, 100)}\n\n` +
      `Log akan dihapus PERMANEN dari database dan tidak dapat dikembalikan!\n\n` +
      `TINDAKAN INI TIDAK DAPAT DIBATALKAN!`
    )) {
      return;
    }
    
    setIsDeleting(true);
    
    try {
      await remove(ref(db, `logs/${logId}`));
      
      // ✅ LOGGING LANGSUNG dengan try-catch
      try {
        const roleDisplay = getRoleDisplayName(role);
        await logActivity('delete_log', 
          `Menghapus log oleh ${logUser} (Aksi: ${logToDelete.action}) - ${roleDisplay}`,
          user
        );
      } catch (logErr) {
        console.warn('⚠️ Logging failed for delete_log:', logErr);
      }
      
      // Remove from local state
      setLogs(prev => prev.filter(log => log.id !== logId));
      setFilteredLogs(prev => prev.filter(log => log.id !== logId));
      
      alert('✅ Log berhasil dihapus!');
      
    } catch (error) {
      console.error('Delete log error:', error);
      alert('❌ Gagal menghapus log: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  }, [canDelete, logs, role, formatActionName, getRoleDisplayName, user]);

  // ==================== DELETE ALL LOGS ====================
  const deleteAllLogs = useCallback(async () => {
    if (!canDelete) {
      alert('⛔ Hanya Developer dan Kepala Sekolah yang dapat menghapus log!');
      return;
    }
    
    const totalLogs = filteredLogs.length;
    if (totalLogs === 0) {
      alert('📭 Tidak ada log yang dapat dihapus!');
      return;
    }
    
    if (!window.confirm(
      `⚠️ HAPUS SEMUA LOG\n\n` +
      `Apakah Anda yakin ingin menghapus SEMUA ${totalLogs} log aktivitas?\n\n` +
      `⚠️ TINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\n` +
      `Semua log akan dihapus permanen dari database.`
    )) {
      return;
    }
    
    const roleDisplay = getRoleDisplayName(role);
    const confirmation = prompt(`Ketik "HAPUS SEMUA" untuk mengkonfirmasi penghapusan ${totalLogs} log:`);
    
    if (confirmation !== "HAPUS SEMUA") {
      alert('❌ Penghapusan dibatalkan');
      return;
    }
    
    setIsDeleting(true);
    
    try {
      // Delete all filtered logs
      for (const log of filteredLogs) {
        await remove(ref(db, `logs/${log.id}`));
      }
      
      // ✅ LOGGING LANGSUNG dengan try-catch
      try {
        await logActivity('delete_all_logs', 
          `Menghapus semua log (${totalLogs} log) - ${roleDisplay}`,
          user
        );
      } catch (logErr) {
        console.warn('⚠️ Logging failed for delete_all_logs:', logErr);
      }
      
      setLogs(prev => prev.filter(log => !filteredLogs.some(f => f.id === log.id)));
      setFilteredLogs([]);
      
      alert(`✅ ${totalLogs} log berhasil dihapus!`);
      
    } catch (error) {
      console.error('Delete all logs error:', error);
      alert('❌ Gagal menghapus log: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  }, [canDelete, filteredLogs, role, getRoleDisplayName, user]);

  // ==================== MANUAL AUTO DELETE ====================
  const handleManualAutoDelete = useCallback(async () => {
    if (!canDelete) {
      alert('⛔ Hanya Developer dan Kepala Sekolah yang dapat menghapus log!');
      return;
    }
    
    if (!window.confirm(
      `🧹 HAPUS OTOMATIS LOG LAMA\n\n` +
      `Apakah Anda ingin menghapus semua log yang berusia lebih dari 1 minggu?\n\n` +
      `📅 Log yang akan dihapus: Semua log dengan usia > 7 hari\n` +
      `⚠️ TINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\n` +
      `Proses ini akan membersihkan database dari log-log lama.`
    )) {
      return;
    }
    
    await autoDeleteOldLogs();
    alert('✅ Proses auto-delete selesai! Log lama telah dihapus.');
  }, [canDelete, autoDeleteOldLogs]);

  // ==================== RENDER ====================
  if (!hasAccess) {
    return (
      <div className="logs-container">
        <div className="logs-access-denied">
          <div className="access-denied-icon">🔒</div>
          <h3>Akses Terbatas</h3>
          <p>Log Aktivitas hanya tersedia untuk Developer, Kepala Sekolah, Wakil Kepala, Guru, dan Staff TU.</p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Silakan hubungi administrator jika Anda memerlukan akses.
          </p>
        </div>
      </div>
    );
  }

  const paginatedLogs = getPaginatedLogs();

  return (
    <div className="logs-container">
      {/* ===== HEADER ===== */}
      <div className="logs-header">
        <div className="header-left">
          <h1>📋 Log Aktivitas</h1>
          <p className="header-subtitle">
            Riwayat aktivitas sistem sekolah
            <span className="role-badge" style={{
              background: isDeveloper ? 'rgba(155,89,182,0.15)' : 
                         isAdmin ? 'rgba(231,76,60,0.15)' :
                         isWakilKepala ? 'rgba(52,152,219,0.15)' :
                         isGuru ? 'rgba(243,156,18,0.15)' :
                         'rgba(96,125,139,0.15)',
              color: isDeveloper ? '#9b59b6' : 
                     isAdmin ? '#e74c3c' :
                     isWakilKepala ? '#3498db' :
                     isGuru ? '#f39c12' :
                     '#607d8b'
            }}>
              {getRoleIcon(role)} {getRoleDisplayName(role)}
            </span>
          </p>
        </div>
        <div className="header-actions">
          {canDelete && (
            <>
              <button 
                className="btn-auto-delete"
                onClick={handleManualAutoDelete}
                disabled={isAutoDeleting}
                title="Hapus otomatis log yang berusia lebih dari 1 minggu"
              >
                {isAutoDeleting ? '⏳...' : '🧹 Bersihkan Log Lama'}
              </button>
              {filteredLogs.length > 0 && (
                <button 
                  className="btn-delete-all"
                  onClick={deleteAllLogs}
                  disabled={isDeleting}
                >
                  {isDeleting ? '⏳...' : '🗑️ Hapus Semua'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ===== FILTERS ===== */}
      <div className="logs-filters">
        <div className="filter-group">
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="filter-select"
          >
            <option value="all">📌 Semua Aksi</option>
            {getAllowedActions().map(action => (
              <option key={action} value={action}>
                {getActionIcon(action)} {formatActionName(action)}
              </option>
            ))}
          </select>
          
          <div className="date-range">
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="date-input"
              title="Dari tanggal"
            />
            <span className="date-separator">—</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="date-input"
              title="Sampai tanggal"
            />
          </div>

          {/* Toggle Show Developer Logs */}
          {canSeeDeveloperLogs && (
            <label className="toggle-dev-logs">
              <input
                type="checkbox"
                checked={showDeveloperLogs}
                onChange={(e) => setShowDeveloperLogs(e.target.checked)}
              />
              <span className="toggle-label">👨‍💻 Tampilkan Log Developer</span>
            </label>
          )}
        </div>
        
        <div className="filter-info">
          <span>
            📊 Menampilkan <strong>{filteredLogs.length}</strong> log
            {filterAction !== 'all' && ` • Aksi: ${formatActionName(filterAction)}`}
            {(filterStartDate || filterEndDate) && (
              <span> • Tanggal: {filterStartDate || '...'} — {filterEndDate || '...'}</span>
            )}
            {!showDeveloperLogs && canSeeDeveloperLogs && (
              <span> • 🔒 Log Developer disembunyikan</span>
            )}
            {isAutoDeleting && (
              <span className="auto-delete-status"> • 🧹 Menghapus log lama...</span>
            )}
          </span>
        </div>
      </div>

      {/* ===== LOGS TABLE ===== */}
      <div className="logs-table-container">
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>⏳ Memuat log...</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <span className="error-icon">❌</span>
            <h3>Gagal Memuat Log</h3>
            <p>{error}</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <h3>Tidak Ada Log</h3>
            <p>Belum ada aktivitas yang tercatat atau filter terlalu ketat</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Tanggal & Waktu</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Aksi</th>
                  <th>Deskripsi</th>
                  <th>IP Address</th>
                  {canDelete && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.map((log) => {
                  const isDeveloperLog = log.userRole === 'developer';
                  const rowClass = log.action === 'delete_user' || log.action === 'reset_system' ? 'log-critical' :
                                   log.action === 'login' || log.action === 'logout' ? 'log-auth' :
                                   log.action === 'auto_delete_old_logs' ? 'log-auto-delete' :
                                   log.action.includes('delete') ? 'log-delete' : '';
                  
                  return (
                    <tr key={log.id} className={`${rowClass} ${isDeveloperLog ? 'log-developer' : ''}`}>
                      <td>
                        <div className="log-date-time">
                          <span className="log-date">{new Date(log.timestamp).toLocaleDateString('id-ID')}</span>
                          <span className="log-time">{log.time}</span>
                        </div>
                      </td>
                      <td>
                        <div className="log-user">
                          <span className="user-avatar" style={{
                            background: isDeveloperLog ? '#9b59b6' : '#3498db'
                          }}>
                            {log.userName?.charAt(0) || 'U'}
                          </span>
                          <span className="user-name">{log.userName || log.userId || 'System'}</span>
                          {isDeveloperLog && <span className="dev-badge">👨‍💻</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`role-badge role-${log.userRole || 'siswa'}`}>
                          {getRoleIcon(log.userRole)} {getRoleDisplayName(log.userRole)}
                        </span>
                      </td>
                      <td>
                        <span className="action-text">
                          {getActionIcon(log.action)} {formatActionName(log.action)}
                        </span>
                      </td>
                      <td>
                        <span className="description-text">{log.details || '-'}</span>
                      </td>
                      <td>
                        <span className="ip-text">{log.ipAddress || '-'}</span>
                      </td>
                      {canDelete && (
                        <td>
                          <button 
                            className="btn-delete-log"
                            onClick={() => deleteSingleLog(log.id)}
                            disabled={isDeleting}
                            title="Hapus log ini"
                          >
                            🗑️
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      {/* ===== FOOTER ===== */}
      <div className="logs-footer">
        <p>
          📌 Log disimpan di <code>logs</code>
          <span className="footer-role"> • Role: {getRoleDisplayName(role)}</span>
          <span className="footer-status"> • {loading ? '⏳ Memuat...' : '✅ Siap'}</span>
          {canDelete && (
            <span className="footer-delete" style={{ color: '#f44336' }}>
              • 🗑️ Dapat menghapus log
            </span>
          )}
          {canSeeDeveloperLogs && (
            <span className="footer-dev-toggle">
              • {showDeveloperLogs ? '👨‍💻 Log Developer terlihat' : '🔒 Log Developer tersembunyi'}
            </span>
          )}
          <span className="footer-auto-delete" style={{ color: '#4CAF50' }}>
            • 🧹 Auto-delete: 1 minggu
          </span>
        </p>
      </div>
    </div>
  );
};

export default LogsTab;