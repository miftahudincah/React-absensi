// src/utils/logger.js
// logger.js - VERSION 4.1 (FIXED: REACT COMPATIBILITY + MULTI-KEY LOCALSTORAGE)
// Mencatat semua aktivitas user ke Firebase Realtime Database
// PERUBAHAN V4.1:
//   - Mendukung multiple key localStorage untuk React compatibility
//   - Auto-scan semua localStorage untuk mencari user
//   - Debug logging untuk memudahkan troubleshooting
//   - Fallback ke sessionStorage jika localStorage kosong
// ============================================================================

import { ref, push, set, get, update } from 'firebase/database';
import { db } from '../firebase/config';

// Konfigurasi
const LOG_RETENTION_DAYS = 7;
const MAX_LOG_ENTRIES = 10000;
let cleanupIntervalId = null;
let isInitialized = false;

// Cache user untuk mengurangi akses localStorage berulang
let cachedUser = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 detik

/**
 * Mendapatkan user dari localStorage dengan multiple key support
 * @returns {object|null} User object atau null
 */
function getCurrentUser() {
    // Cek cache
    const now = Date.now();
    if (cachedUser && (now - cacheTimestamp) < CACHE_TTL) {
        return cachedUser;
    }
    
    try {
        // ========== STRATEGI 1: Cek key yang umum digunakan ==========
        const commonKeys = [
            'currentUser',
            'user', 
            'authUser', 
            'userData', 
            'userProfile',
            'firebaseUser',
            'authUserData'
        ];
        
        for (const key of commonKeys) {
            const savedUser = localStorage.getItem(key);
            if (savedUser) {
                try {
                    const user = JSON.parse(savedUser);
                    if (user && user.uid) {
                        console.log(`✅ User found in localStorage key: "${key}"`);
                        cachedUser = user;
                        cacheTimestamp = now;
                        return user;
                    }
                } catch (e) {
                    // Skip jika parsing gagal
                }
            }
        }
        
        // ========== STRATEGI 2: Scan semua localStorage ==========
        console.log('🔍 Scanning all localStorage for user...');
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.toLowerCase().includes('user') || key.toLowerCase().includes('auth') || key.toLowerCase().includes('profile'))) {
                try {
                    const value = JSON.parse(localStorage.getItem(key));
                    if (value && value.uid) {
                        console.log(`✅ User found in localStorage key: "${key}"`);
                        cachedUser = value;
                        cacheTimestamp = now;
                        return value;
                    }
                } catch (e) {
                    // Skip jika parsing gagal
                }
            }
        }
        
        // ========== STRATEGI 3: Cek sessionStorage ==========
        try {
            const sessionKeys = ['currentUser', 'user', 'authUser'];
            for (const key of sessionKeys) {
                const savedUser = sessionStorage.getItem(key);
                if (savedUser) {
                    try {
                        const user = JSON.parse(savedUser);
                        if (user && user.uid) {
                            console.log(`✅ User found in sessionStorage key: "${key}"`);
                            cachedUser = user;
                            cacheTimestamp = now;
                            return user;
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
        
        console.warn('⚠️ No user found in localStorage or sessionStorage');
        cachedUser = null;
        cacheTimestamp = now;
        return null;
        
    } catch (e) {
        console.warn('Gagal membaca user dari localStorage:', e);
        return null;
    }
}

/**
 * Mendapatkan alamat IP publik client
 * @returns {Promise<string>}
 */
async function getClientIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip || 'unknown';
    } catch (error) {
        console.warn('Gagal mendapatkan IP:', error);
        return 'unknown';
    }
}

/**
 * Fungsi utama untuk mencatat aktivitas
 * @param {string} action - Nama aksi
 * @param {string|object} details - Detail tambahan
 * @param {object} userData - Data user (opsional)
 * @returns {Promise<void>}
 */
async function logActivity(action, details = '', userData = null) {
    // ========== DEBUG: Log pemanggilan ==========
    console.log(`🔍 [logActivity] Called:`, { 
        action, 
        details: typeof details === 'string' ? details.substring(0, 50) : 'object', 
        hasUserData: !!userData,
        hasUserDataUid: userData?.uid
    });

    // Ambil user dari parameter atau localStorage
    let user = userData;
    
    // Jika userData tidak valid, coba dari localStorage
    if (!user || !user.uid) {
        user = getCurrentUser();
        if (user) {
            console.log(`   👤 User from localStorage: ${user.nama || user.email || 'Unknown'} (${user.uid})`);
        }
    } else {
        console.log(`   👤 User from parameter: ${user.nama || user.email || 'Unknown'} (${user.uid})`);
    }

    // ========== Jika user masih tidak ditemukan ==========
    if (!user || !user.uid) {
        console.warn('⚠️ logActivity: User tidak tersedia, log tidak disimpan');
        console.warn('   - userData parameter:', userData);
        console.warn('   - localStorage keys:', Object.keys(localStorage));
        console.warn('   - sessionStorage keys:', Object.keys(sessionStorage));
        return false;
    }

    // Format details
    let detailsStr = '';
    if (typeof details === 'object') {
        try {
            detailsStr = JSON.stringify(details);
        } catch (e) {
            detailsStr = String(details);
        }
    } else {
        detailsStr = String(details || '');
    }

    // Batasi panjang details
    if (detailsStr.length > 1000) {
        detailsStr = detailsStr.substring(0, 997) + '...';
    }

    // Dapatkan IP
    let ipAddress = 'unknown';
    try {
        ipAddress = await getClientIP();
    } catch (e) {
        ipAddress = localStorage.getItem('userIP') || 'unknown';
    }

    // Buat log entry dengan timestamp
    const timestamp = Date.now();
    const logEntry = {
        action: action,
        userId: user.uid,
        userName: user.nama || user.email || 'Unknown',
        userRole: user.role || 'unknown',
        userEmail: user.email || '',
        details: detailsStr,
        timestamp: timestamp,
        ipAddress: ipAddress,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 200) : 'server',
        createdAt: new Date().toISOString()
    };

    try {
        // Simpan ke Firebase
        const logsRef = ref(db, 'logs');
        const newLogRef = push(logsRef);
        await set(newLogRef, logEntry);
        
        console.log(`📝 [LOG] ${action} - ${detailsStr.substring(0, 50)} - ${user.nama}`);
        
        // Cek dan bersihkan log lama jika terlalu banyak
        cleanupOldLogsIfNeeded();
        
        return true;
    } catch (error) {
        console.error('❌ Gagal menyimpan log aktivitas:', error);
        return false;
    }
}

/**
 * Bersihkan log lama jika jumlah log melebihi batas
 */
async function cleanupOldLogsIfNeeded() {
    try {
        const logsRef = ref(db, 'logs');
        const snapshot = await get(logsRef);
        const data = snapshot.val();
        
        if (!data) return;
        
        const logKeys = Object.keys(data);
        if (logKeys.length <= MAX_LOG_ENTRIES) return;
        
        console.log(`🧹 Cleaning up old logs (${logKeys.length} entries, max ${MAX_LOG_ENTRIES})...`);
        
        // Sort by timestamp
        const sortedLogs = logKeys.sort((a, b) => {
            const timeA = data[a].timestamp || 0;
            const timeB = data[b].timestamp || 0;
            return timeA - timeB;
        });
        
        // Hapus log tertua
        const toDelete = sortedLogs.slice(0, logKeys.length - MAX_LOG_ENTRIES);
        const updates = {};
        toDelete.forEach(key => {
            updates[`logs/${key}`] = null;
        });
        
        await update(ref(db), updates);
        console.log(`🧹 Deleted ${toDelete.length} old log entries`);
        
    } catch (error) {
        console.error('Cleanup logs error:', error);
    }
}

/**
 * Hapus log lama berdasarkan hari
 */
async function cleanupOldLogs(days = LOG_RETENTION_DAYS) {
    try {
        const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
        const logsRef = ref(db, 'logs');
        const snapshot = await get(logsRef);
        const data = snapshot.val();
        
        if (!data) return 0;
        
        const toDelete = [];
        Object.entries(data).forEach(([key, log]) => {
            const logTime = log.timestamp || 0;
            if (logTime < cutoffDate) {
                toDelete.push(key);
            }
        });
        
        if (toDelete.length === 0) return 0;
        
        const updates = {};
        toDelete.forEach(key => {
            updates[`logs/${key}`] = null;
        });
        
        await update(ref(db), updates);
        console.log(`🧹 Deleted ${toDelete.length} old log entries (older than ${days} days)`);
        return toDelete.length;
        
    } catch (error) {
        console.error('Cleanup logs error:', error);
        return 0;
    }
}

// ==================== LOG FUNCTIONS ====================

/**
 * Log aktivitas login
 */
async function logLogin(userData) {
    return await logActivity('login', 'User login', userData);
}

/**
 * Log aktivitas logout
 */
async function logLogout(userData) {
    return await logActivity('logout', 'User logout', userData);
}

/**
 * Log aktivitas membuat status
 */
async function logCreateStatus(userData, statusData) {
    return await logActivity('create_status', `Membuat status: ${statusData?.text || 'tanpa teks'}`, userData);
}

/**
 * Log aktivitas menghapus status
 */
async function logDeleteStatus(userData, statusId) {
    return await logActivity('delete_status', `Menghapus status: ${statusId}`, userData);
}

/**
 * Log aktivitas mengirim pesan chat
 */
async function logSendMessage(userData, toUser, message) {
    return await logActivity('send_message', `Mengirim pesan ke ${toUser}: ${message?.substring(0, 50)}...`, userData);
}

/**
 * Log aktivitas menghapus chat
 */
async function logClearChat(userData, withUser) {
    return await logActivity('clear_chat', `Membersihkan chat dengan ${withUser}`, userData);
}

/**
 * Log aktivitas tambah siswa
 */
async function logAddStudent(userData, studentData) {
    return await logActivity('add_student', `Menambah siswa: ${studentData?.nama || 'unknown'} (${studentData?.kelas || '-'})`, userData);
}

/**
 * Log aktivitas edit siswa
 */
async function logEditStudent(userData, studentId, studentData) {
    return await logActivity('edit_student', `Mengedit siswa: ${studentData?.nama || studentId}`, userData);
}

/**
 * Log aktivitas hapus siswa
 */
async function logDeleteStudent(userData, studentId, studentName) {
    return await logActivity('delete_student', `Menghapus siswa: ${studentName || studentId}`, userData);
}

/**
 * Log aktivitas absensi
 */
async function logAttendance(userData, studentId, status, time) {
    return await logActivity('save_manual_attendance', `Absensi: ${studentId} - ${status} (${time})`, userData);
}

/**
 * Log aktivitas simulasi absen masuk
 */
async function logSimulateAttendanceIn(userData, studentName) {
    return await logActivity('simulate_attendance_in', `Simulasi absen masuk: ${studentName}`, userData);
}

/**
 * Log aktivitas simulasi absen pulang
 */
async function logSimulateAttendanceOut(userData, studentName) {
    return await logActivity('simulate_attendance_out', `Simulasi absen pulang: ${studentName}`, userData);
}

/**
 * Log aktivitas hapus absensi
 */
async function logDeleteAttendance(userData, studentName, date) {
    return await logActivity('delete_attendance', `Menghapus absensi: ${studentName} (${date})`, userData);
}

/**
 * Log aktivitas membuat pengumuman
 */
async function logCreateAnnouncement(userData, title) {
    return await logActivity('create_announcement', `Membuat pengumuman: ${title}`, userData);
}

/**
 * Log aktivitas mengedit pengumuman
 */
async function logUpdateAnnouncement(userData, title) {
    return await logActivity('update_announcement', `Mengedit pengumuman: ${title}`, userData);
}

/**
 * Log aktivitas menghapus pengumuman
 */
async function logDeleteAnnouncement(userData, title) {
    return await logActivity('delete_announcement', `Menghapus pengumuman: ${title}`, userData);
}

/**
 * Log aktivitas mengirim permintaan teman
 */
async function logSendFriendRequest(userData, toUser) {
    return await logActivity('send_friend_request', `Mengirim permintaan teman ke ${toUser}`, userData);
}

/**
 * Log aktivitas menerima permintaan teman
 */
async function logAcceptFriendRequest(userData, fromUser) {
    return await logActivity('accept_friend_request', `Menerima permintaan teman dari ${fromUser}`, userData);
}

/**
 * Log aktivitas menolak permintaan teman
 */
async function logRejectFriendRequest(userData, fromUser) {
    return await logActivity('reject_friend_request', `Menolak permintaan teman dari ${fromUser}`, userData);
}

/**
 * Log aktivitas menghapus teman
 */
async function logRemoveFriend(userData, friendName) {
    return await logActivity('remove_friend', `Menghapus teman: ${friendName}`, userData);
}

/**
 * Log aktivitas mengajukan izin
 */
async function logCreateIzin(userData, reason) {
    return await logActivity('create_izin', `Mengajukan izin: ${reason}`, userData);
}

/**
 * Log aktivitas menyetujui izin
 */
async function logApproveIzin(userData, izinId, studentName) {
    return await logActivity('approve_izin', `Menyetujui izin: ${studentName} (${izinId})`, userData);
}

/**
 * Log aktivitas menolak izin
 */
async function logRejectIzin(userData, izinId, studentName) {
    return await logActivity('reject_izin', `Menolak izin: ${studentName} (${izinId})`, userData);
}

/**
 * Log aktivitas upload foto profil
 */
async function logUploadProfilePhoto(userData) {
    return await logActivity('upload_profile_photo', 'Upload foto profil', userData);
}

/**
 * Log aktivitas export data
 */
async function logExportData(userData, type, count) {
    return await logActivity('export_attendance_excel', `Export ${type}: ${count} data`, userData);
}

/**
 * Log aktivitas error
 */
async function logError(userData, errorMessage, context) {
    return await logActivity('error', `Error: ${errorMessage} (${context || 'unknown'})`, userData);
}

/**
 * Log aktivitas system
 */
async function logSystem(action, details) {
    return await logActivity(action, details, {
        uid: 'system',
        nama: 'System',
        role: 'system'
    });
}

/**
 * Log aktivitas tambah staff
 */
async function logAddStaff(userData, staffData) {
    return await logActivity('add_staff', `Menambah staff: ${staffData?.nama || 'unknown'}`, userData);
}

/**
 * Log aktivitas edit staff
 */
async function logEditStaff(userData, staffId, staffData) {
    return await logActivity('edit_staff', `Mengedit staff: ${staffData?.nama || staffId}`, userData);
}

/**
 * Log aktivitas hapus staff
 */
async function logDeleteStaff(userData, staffId, staffName) {
    return await logActivity('delete_staff', `Menghapus staff: ${staffName || staffId}`, userData);
}

/**
 * Log aktivitas create staff account
 */
async function logCreateStaffAccount(userData, staffName) {
    return await logActivity('create_staff_account', `Membuat akun staff: ${staffName}`, userData);
}

/**
 * Log aktivitas generate code
 */
async function logGenerateCode(userData, codeType) {
    return await logActivity('generate_code', `Generate kode: ${codeType}`, userData);
}

/**
 * Log aktivitas delete code
 */
async function logDeleteCode(userData, code) {
    return await logActivity('delete_code', `Menghapus kode: ${code}`, userData);
}

/**
 * Log aktivitas update user role
 */
async function logUpdateUserRole(userData, targetUser, newRole) {
    return await logActivity('update_user_role', `Mengubah role ${targetUser} menjadi ${newRole}`, userData);
}

/**
 * Log aktivitas delete user
 */
async function logDeleteUser(userData, targetUser) {
    return await logActivity('delete_user', `Menghapus user: ${targetUser}`, userData);
}

/**
 * Log aktivitas reset system
 */
async function logResetSystem(userData) {
    return await logActivity('reset_system', 'Reset sistem', userData);
}

/**
 * Log aktivitas reset user password
 */
async function logResetUserPassword(userData, targetUser) {
    return await logActivity('reset_user_password', `Reset password: ${targetUser}`, userData);
}

/**
 * Log aktivitas export rekap excel
 */
async function logExportRekapExcel(userData, count) {
    return await logActivity('export_rekap_excel', `Ekspor rekap Excel: ${count} data`, userData);
}

/**
 * Log aktivitas export rekap pdf
 */
async function logExportRekapPdf(userData, count) {
    return await logActivity('export_rekap_pdf', `Ekspor rekap PDF: ${count} data`, userData);
}

/**
 * Log aktivitas save school name
 */
async function logSaveSchoolName(userData, schoolName) {
    return await logActivity('save_school_name', `Ubah nama sekolah: ${schoolName}`, userData);
}

/**
 * Log aktivitas upload school logo
 */
async function logUploadSchoolLogo(userData) {
    return await logActivity('upload_school_logo', 'Upload logo sekolah', userData);
}

/**
 * Log aktivitas remove school logo
 */
async function logRemoveSchoolLogo(userData) {
    return await logActivity('remove_school_logo', 'Hapus logo sekolah', userData);
}

/**
 * Log aktivitas save classes
 */
async function logSaveClasses(userData, classes) {
    return await logActivity('save_classes', `Simpan kelas: ${classes?.join(', ') || ''}`, userData);
}

/**
 * Log aktivitas save majors
 */
async function logSaveMajors(userData, majors) {
    return await logActivity('save_majors', `Simpan jurusan: ${majors?.join(', ') || ''}`, userData);
}

/**
 * Log aktivitas update school type
 */
async function logUpdateSchoolType(userData, schoolType) {
    return await logActivity('update_school_type', `Ubah tipe sekolah: ${schoolType}`, userData);
}

/**
 * Log aktivitas update global delay
 */
async function logUpdateGlobalDelay(userData, delay) {
    return await logActivity('update_global_delay', `Ubah delay: ${delay}`, userData);
}

/**
 * Log aktivitas simulate staff attendance in
 */
async function logSimulateStaffAttendanceIn(userData, staffName) {
    return await logActivity('simulate_staff_attendance_in', `Simulasi absen masuk staff: ${staffName}`, userData);
}

/**
 * Log aktivitas simulate staff attendance out
 */
async function logSimulateStaffAttendanceOut(userData, staffName) {
    return await logActivity('simulate_staff_attendance_out', `Simulasi absen pulang staff: ${staffName}`, userData);
}

/**
 * Log aktivitas delete staff attendance
 */
async function logDeleteStaffAttendance(userData, staffName, date) {
    return await logActivity('delete_staff_attendance', `Menghapus absensi staff: ${staffName} (${date})`, userData);
}

/**
 * Log aktivitas export staff attendance excel
 */
async function logExportStaffAttendanceExcel(userData, count) {
    return await logActivity('export_staff_attendance_excel', `Ekspor absensi staff Excel: ${count} data`, userData);
}

/**
 * Log aktivitas delete log (hapus log)
 */
async function logDeleteLog(userData, logId, logDetails) {
    return await logActivity('delete_log', `Menghapus log: ${logDetails}`, userData);
}

/**
 * Log aktivitas delete all logs
 */
async function logDeleteAllLogs(userData, count) {
    return await logActivity('delete_all_logs', `Menghapus semua log (${count} data)`, userData);
}

// ==================== START AUTO CLEANUP ====================

function startAutoCleanup() {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
    }
    
    // Jalankan cleanup pertama kali setelah 10 detik
    setTimeout(() => {
        cleanupOldLogs(LOG_RETENTION_DAYS);
    }, 10000);
    
    // Setup interval berkala (setiap 1 jam)
    cleanupIntervalId = setInterval(() => {
        console.log(`🕐 Auto-cleanup check (every 60 minutes)...`);
        cleanupOldLogs(LOG_RETENTION_DAYS);
    }, 60 * 60 * 1000);
    
    console.log(`✅ Auto-cleanup started: logs older than ${LOG_RETENTION_DAYS} days will be deleted every 60 minutes`);
}

function stopAutoCleanup() {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
        console.log('⏹️ Auto-cleanup stopped');
    }
}

// ==================== INISIALISASI ====================

function initLogger() {
    if (isInitialized) return;
    isInitialized = true;
    
    console.log('✅ logger.js V4.1 initialized - Full activity logging (React + Vanilla compatible)');
    console.log('🔍 Multi-key localStorage support enabled');
    startAutoCleanup();
}

// ==================== EKSPOR ====================
// Ekspor fungsi utama
export {
    logActivity,
    logLogin,
    logLogout,
    logCreateStatus,
    logDeleteStatus,
    logSendMessage,
    logClearChat,
    logAddStudent,
    logEditStudent,
    logDeleteStudent,
    logAttendance,
    logSimulateAttendanceIn,
    logSimulateAttendanceOut,
    logDeleteAttendance,
    logCreateAnnouncement,
    logUpdateAnnouncement,
    logDeleteAnnouncement,
    logSendFriendRequest,
    logAcceptFriendRequest,
    logRejectFriendRequest,
    logRemoveFriend,
    logCreateIzin,
    logApproveIzin,
    logRejectIzin,
    logUploadProfilePhoto,
    logExportData,
    logError,
    logSystem,
    logAddStaff,
    logEditStaff,
    logDeleteStaff,
    logCreateStaffAccount,
    logGenerateCode,
    logDeleteCode,
    logUpdateUserRole,
    logDeleteUser,
    logResetSystem,
    logResetUserPassword,
    logExportRekapExcel,
    logExportRekapPdf,
    logSaveSchoolName,
    logUploadSchoolLogo,
    logRemoveSchoolLogo,
    logSaveClasses,
    logSaveMajors,
    logUpdateSchoolType,
    logUpdateGlobalDelay,
    logSimulateStaffAttendanceIn,
    logSimulateStaffAttendanceOut,
    logDeleteStaffAttendance,
    logExportStaffAttendanceExcel,
    logDeleteLog,
    logDeleteAllLogs,
    cleanupOldLogs,
    startAutoCleanup,
    stopAutoCleanup,
    initLogger,
    getCurrentUser  // Ekspor untuk debugging
};

// ==================== GLOBAL EXPOSURE ====================
// Untuk penggunaan di komponen non-module (vanilla JS)
if (typeof window !== 'undefined') {
    window.logActivity = logActivity;
    window.logLogin = logLogin;
    window.logLogout = logLogout;
    window.logCreateStatus = logCreateStatus;
    window.logDeleteStatus = logDeleteStatus;
    window.logSendMessage = logSendMessage;
    window.logClearChat = logClearChat;
    window.logAddStudent = logAddStudent;
    window.logEditStudent = logEditStudent;
    window.logDeleteStudent = logDeleteStudent;
    window.logAttendance = logAttendance;
    window.logSimulateAttendanceIn = logSimulateAttendanceIn;
    window.logSimulateAttendanceOut = logSimulateAttendanceOut;
    window.logDeleteAttendance = logDeleteAttendance;
    window.logCreateAnnouncement = logCreateAnnouncement;
    window.logUpdateAnnouncement = logUpdateAnnouncement;
    window.logDeleteAnnouncement = logDeleteAnnouncement;
    window.logSendFriendRequest = logSendFriendRequest;
    window.logAcceptFriendRequest = logAcceptFriendRequest;
    window.logRejectFriendRequest = logRejectFriendRequest;
    window.logRemoveFriend = logRemoveFriend;
    window.logCreateIzin = logCreateIzin;
    window.logApproveIzin = logApproveIzin;
    window.logRejectIzin = logRejectIzin;
    window.logUploadProfilePhoto = logUploadProfilePhoto;
    window.logExportData = logExportData;
    window.logError = logError;
    window.logSystem = logSystem;
    window.logAddStaff = logAddStaff;
    window.logEditStaff = logEditStaff;
    window.logDeleteStaff = logDeleteStaff;
    window.logCreateStaffAccount = logCreateStaffAccount;
    window.logGenerateCode = logGenerateCode;
    window.logDeleteCode = logDeleteCode;
    window.logUpdateUserRole = logUpdateUserRole;
    window.logDeleteUser = logDeleteUser;
    window.logResetSystem = logResetSystem;
    window.logResetUserPassword = logResetUserPassword;
    window.logExportRekapExcel = logExportRekapExcel;
    window.logExportRekapPdf = logExportRekapPdf;
    window.logSaveSchoolName = logSaveSchoolName;
    window.logUploadSchoolLogo = logUploadSchoolLogo;
    window.logRemoveSchoolLogo = logRemoveSchoolLogo;
    window.logSaveClasses = logSaveClasses;
    window.logSaveMajors = logSaveMajors;
    window.logUpdateSchoolType = logUpdateSchoolType;
    window.logUpdateGlobalDelay = logUpdateGlobalDelay;
    window.logSimulateStaffAttendanceIn = logSimulateStaffAttendanceIn;
    window.logSimulateStaffAttendanceOut = logSimulateStaffAttendanceOut;
    window.logDeleteStaffAttendance = logDeleteStaffAttendance;
    window.logExportStaffAttendanceExcel = logExportStaffAttendanceExcel;
    window.logDeleteLog = logDeleteLog;
    window.logDeleteAllLogs = logDeleteAllLogs;
    window.cleanupOldLogs = cleanupOldLogs;
    window.startAutoCleanup = startAutoCleanup;
    window.stopAutoCleanup = stopAutoCleanup;
    window.initLogger = initLogger;
    window.getCurrentUser = getCurrentUser;  // Untuk debugging
    
    console.log('✅ logger.js V4.1 loaded - Full activity logging (React + Vanilla compatible)');
    console.log('🔍 Use window.getCurrentUser() to check user status');
    
    // Auto init
    initLogger();
}

// Auto init untuk React
initLogger();