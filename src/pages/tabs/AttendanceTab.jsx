// src/pages/tabs/AttendanceTab.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ref, onValue, set, remove, update, get } from 'firebase/database';
import { db } from '../../firebase/config';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, PointElement, LineElement, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
// ==================== IMPORT LOGGER ====================
import { 
  logActivity,
  logAttendance,
  logSimulateAttendanceIn,
  logSimulateAttendanceOut,
  logDeleteAttendance,
  logExportData,
  logError,
  logSystem
} from '../../utils/logger';
// ⭐ IMPORT MARQUEE TEXT COMPONENT
import MarqueeText from '../../components/MarqueeText';
import './AttendanceTab.css';

// Register ChartJS components
ChartJS.register(
  ArcElement, Tooltip, Legend, CategoryScale, LinearScale,
  BarElement, Title, PointElement, LineElement, Filler
);

const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const AttendanceTab = ({ user }) => {
  // ==================== STATE ====================
  const [attendanceData, setAttendanceData] = useState([]);
  const [students, setStudents] = useState([]);
  const [usersAuth, setUsersAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterDate, setFilterDate] = useState('today');
  const [filterKelas, setFilterKelas] = useState('all');
  const [filterJurusan, setFilterJurusan] = useState('all');
  const [photoCache, setPhotoCache] = useState({});
  const [chartAnimated, setChartAnimated] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [studentInfo, setStudentInfo] = useState({ kelas: '', jurusan: '' });
  const [whatsappStatus, setWhatsappStatus] = useState({ sending: false, lastResult: null });
  
  // State untuk auto reminder
  const [autoReminderSent, setAutoReminderSent] = useState(false);
  const [autoReminderLoading, setAutoReminderLoading] = useState(false);
  const [absentStudentsToday, setAbsentStudentsToday] = useState([]);

  // State untuk simulasi absen
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simulateType, setSimulateType] = useState('in');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [searchStudent, setSearchStudent] = useState('');
  const [simulateStatus, setSimulateStatus] = useState('hadir');
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [kelasOptions, setKelasOptions] = useState(['all']);
  const [jurusanOptions, setJurusanOptions] = useState(['all']);

  // State untuk konfigurasi sekolah
  const [schoolConfig, setSchoolConfig] = useState({
    checkInTime: '07:00',
    checkOutTime: '15:30',
    lateThreshold: 15,
    workDays: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
    holidays: []
  });

  // State untuk nama sekolah
  const [schoolName, setSchoolName] = useState('Sistem Absensi');

  // Refs untuk mencegah unmount issues
  const isMounted = useRef(true);

  // ==================== CEK ROLE & AKSES ====================
  const rawRole = user?.role || 'siswa';
  const role = rawRole.toString().toLowerCase().trim();

  const isSiswa = role === 'siswa';
  const isGuru = role === 'guru';
  const isStaff = role === 'staff_tu';
  const isGuruOrStaff = isGuru || isStaff;
  const isFullAccess = ['developer', 'admin', 'wakil_kepala'].includes(role);
  const isDeveloper = role === 'developer';

  const canSimulate = isFullAccess || isGuruOrStaff;
  const canExport = true;
  const canDelete = isFullAccess;
  
  // ==================== DEFINE showDeleteButton ====================
  const showDeleteButton = canDelete;

  // ==================== HELPER FUNCTIONS ====================
  
  // Get student phone number
  const getStudentPhoneNumber = useCallback((student) => {
    if (!student) return null;
    
    if (student.parentPhone && student.parentPhone !== '-' && student.parentPhone !== '') {
      return student.parentPhone;
    }
    if (student.noHp && student.noHp !== '-' && student.noHp !== '') {
      return student.noHp;
    }
    
    const userAuth = usersAuth.find(u => u.fpId == student.id || u.fpId == student.fpId);
    if (userAuth?.noHp && userAuth.noHp !== '-' && userAuth.noHp !== '') {
      return userAuth.noHp;
    }
    if (userAuth?.phoneNumber && userAuth.phoneNumber !== '-' && userAuth.phoneNumber !== '') {
      return userAuth.phoneNumber;
    }
    if (userAuth?.parentPhone && userAuth.parentPhone !== '-' && userAuth.parentPhone !== '') {
      return userAuth.parentPhone;
    }
    
    return null;
  }, [usersAuth]);

  // Get student photo
  const getStudentPhoto = useCallback((studentId, studentName) => {
    if (photoCache[studentId]) {
      return photoCache[studentId];
    }

    const userAuth = usersAuth.find(u => u.fpId == studentId);

    let photoUrl;
    if (userAuth && userAuth.photoUrl && userAuth.photoUrl !== 'null' && userAuth.photoUrl !== 'undefined') {
      const separator = userAuth.photoUrl.includes('?') ? '&' : '?';
      photoUrl = userAuth.photoUrl + separator + 't=' + Date.now();
    } else {
      const initial = studentName ? studentName.charAt(0).toUpperCase() : 'U';
      photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
    }

    setPhotoCache(prev => ({ ...prev, [studentId]: photoUrl }));
    return photoUrl;
  }, [photoCache, usersAuth]);

  // Get student delay out
  const getStudentDelayOut = useCallback((student) => {
    if (!student) return 60;
    return student.delayOut || 60;
  }, []);

  // Check if student can check out based on delay
  const canCheckOut = useCallback((student, timeIn) => {
    if (!student || !timeIn) return false;
    
    const delayOut = getStudentDelayOut(student);
    const checkOutTime = schoolConfig.checkOutTime || '15:30';
    
    // Parse checkout time
    const [outHours, outMinutes] = checkOutTime.split(':').map(Number);
    const checkoutMinutes = outHours * 60 + outMinutes + delayOut;
    
    // Get current time
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // Parse check-in time
    const [inHours, inMinutes] = timeIn.split(':').map(Number);
    const checkInMinutes = inHours * 60 + inMinutes;
    const minutesSinceCheckIn = currentMinutes - checkInMinutes;
    
    // Allow check out if:
    // 1. Current time >= checkout time + delay, OR
    // 2. Student has been checked in for at least 2 hours (120 minutes)
    if (minutesSinceCheckIn >= 120) return true;
    
    return currentMinutes >= checkoutMinutes;
  }, [schoolConfig.checkOutTime, getStudentDelayOut]);

  // Check if student is late
  const isLate = useCallback((timeIn) => {
    if (!timeIn) return false;
    const checkInTime = schoolConfig.checkInTime || '07:00';
    const lateThreshold = schoolConfig.lateThreshold || 15;
    
    const [inHours, inMinutes] = checkInTime.split(':').map(Number);
    const checkInMinutes = inHours * 60 + inMinutes;
    
    const [attHours, attMinutes] = timeIn.split(':').map(Number);
    const attMinutesTotal = attHours * 60 + attMinutes;
    
    return attMinutesTotal > checkInMinutes + lateThreshold;
  }, [schoolConfig.checkInTime, schoolConfig.lateThreshold]);

  // Calculate delay minutes
  const calculateDelayMinutes = useCallback((timeIn) => {
    if (!timeIn) return 0;
    const checkInTime = schoolConfig.checkInTime || '07:00';
    const [inHours, inMinutes] = checkInTime.split(':').map(Number);
    const checkInMinutes = inHours * 60 + inMinutes;
    
    const [attHours, attMinutes] = timeIn.split(':').map(Number);
    const attMinutesTotal = attHours * 60 + attMinutes;
    
    return Math.max(0, attMinutesTotal - checkInMinutes);
  }, [schoolConfig.checkInTime]);

  // Check if today is holiday
  const isHoliday = useCallback((date) => {
    if (!date) return false;
    
    // Check if date is in holidays list
    const isHolidayDate = schoolConfig.holidays.some(h => h.date === date);
    if (isHolidayDate) return true;
    
    // Check if it's weekend
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayKey = dayNames[dayOfWeek];
    return !schoolConfig.workDays[dayKey];
  }, [schoolConfig.holidays, schoolConfig.workDays]);

  // Check if today is working day
  const isWorkingDay = useCallback((date) => {
    return !isHoliday(date);
  }, [isHoliday]);

  // ==================== SEND WHATSAPP NOTIFICATION ====================
  const sendWhatsAppNotification = useCallback(async (phoneNumber, message, type) => {
    if (!phoneNumber) {
      return { success: false, error: 'No phone number' };
    }

    let formattedNumber = phoneNumber.toString().replace(/[^0-9]/g, '');
    if (formattedNumber.startsWith('0')) {
      formattedNumber = '62' + formattedNumber.substring(1);
    }
    if (!formattedNumber.startsWith('62')) {
      formattedNumber = '62' + formattedNumber;
    }

    setWhatsappStatus({ sending: true, lastResult: null });

    try {
      const response = await fetch(`${API_BASE_URL}/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: formattedNumber, message })
      });

      const data = await response.json();

      if (data.success) {
        setWhatsappStatus({ 
          sending: false, 
          lastResult: { success: true, phoneNumber: formattedNumber, type } 
        });
        return { success: true, data: data.data };
      } else {
        setWhatsappStatus({ 
          sending: false, 
          lastResult: { success: false, error: data.error || 'Unknown error' } 
        });
        return { success: false, error: data.error || 'Unknown error' };
      }
    } catch (error) {
      setWhatsappStatus({ 
        sending: false, 
        lastResult: { success: false, error: error.message } 
      });
      return { success: false, error: error.message };
    }
  }, []);

  // ==================== SEND NOTIFICATIONS ====================
  const sendCheckInNotification = useCallback(async (student, time, isLate) => {
    const phoneNumber = getStudentPhoneNumber(student);
    if (!phoneNumber) {
      return { success: false, error: 'No phone number' };
    }

    const schoolNameText = schoolName || 'Sekolah';
    const dateStr = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const message = `*📋 NOTIFIKASI ABSENSI MASUK - ${schoolNameText}*

👨‍🎓 *Siswa:* ${student.nama}
🆔 *ID:* ${student.id || student.fpId || '-'}
📚 *Kelas:* ${student.kelas || '-'} - ${student.jurusan || '-'}
📅 *Tanggal:* ${dateStr}
🕐 *Jam Masuk:* ${time} WIB
${isLate ? '⚠️ *Status: TERLAMBAT*' : '✅ *Status: TEPAT WAKTU*'}

--- 
📱 *Sistem Absensi IoT*
🔔 Notifikasi ini dikirim secara otomatis.`;

    const result = await sendWhatsAppNotification(phoneNumber, message, 'check_in');

    if (result.success) {
      try {
        await logActivity('send_check_in_notification', 
          `Notifikasi check-in ke ${student.nama} (${phoneNumber}) - ${isLate ? 'TERLAMBAT' : 'TEPAT WAKTU'}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
    }

    return result;
  }, [getStudentPhoneNumber, sendWhatsAppNotification, user, schoolName]);

  const sendCheckOutNotification = useCallback(async (student, timeIn, timeOut) => {
    const phoneNumber = getStudentPhoneNumber(student);
    if (!phoneNumber) {
      return { success: false, error: 'No phone number' };
    }

    const schoolNameText = schoolName || 'Sekolah';
    const dateStr = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const message = `*🏠 NOTIFIKASI ABSENSI PULANG - ${schoolNameText}*

👨‍🎓 *Siswa:* ${student.nama}
🆔 *ID:* ${student.id || student.fpId || '-'}
📚 *Kelas:* ${student.kelas || '-'} - ${student.jurusan || '-'}
📅 *Tanggal:* ${dateStr}
🕐 *Jam Masuk:* ${timeIn || '-'} WIB
🏠 *Jam Pulang:* ${timeOut} WIB

✅ *Siswa sudah pulang dengan selamat.*

--- 
📱 *Sistem Absensi IoT*
🔔 Notifikasi ini dikirim secara otomatis.`;

    const result = await sendWhatsAppNotification(phoneNumber, message, 'check_out');

    if (result.success) {
      try {
        await logActivity('send_check_out_notification', 
          `Notifikasi check-out ke ${student.nama} (${phoneNumber})`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
    }

    return result;
  }, [getStudentPhoneNumber, sendWhatsAppNotification, user, schoolName]);

  const sendReminderNotification = useCallback(async (student) => {
    const phoneNumber = getStudentPhoneNumber(student);
    if (!phoneNumber) {
      return { success: false, error: 'No phone number' };
    }

    const schoolNameText = schoolName || 'Sekolah';
    const dateStr = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    const message = `*🔔 PENGINGAT ABSENSI - ${schoolNameText}*

👨‍🎓 *Siswa:* ${student.nama}
🆔 *ID:* ${student.id || student.fpId || '-'}
📚 *Kelas:* ${student.kelas || '-'} - ${student.jurusan || '-'}
📅 *Tanggal:* ${dateStr}
⏰ *Waktu:* ${timeStr} WIB

⚠️ *Anda belum melakukan absensi masuk hari ini!*
Segera lakukan absensi melalui sistem.

--- 
📱 *Sistem Absensi IoT*
🔔 Ini adalah pengingat otomatis.`;

    const result = await sendWhatsAppNotification(phoneNumber, message, 'reminder');

    if (result.success) {
      try {
        await logActivity('send_reminder', 
          `Pengingat ke ${student.nama} (${phoneNumber})`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
    }

    return result;
  }, [getStudentPhoneNumber, sendWhatsAppNotification, user, schoolName]);

  // ==================== CHECK IN / CHECK OUT FUNCTIONS ====================
  
  const handleCheckIn = useCallback(async (studentId, options = {}) => {
    const { simulate = false, status = 'hadir' } = options;
    
    if (!studentId) {
      return { success: false, error: 'ID siswa tidak valid' };
    }

    const student = students.find(s => s.id == studentId);
    if (!student) {
      return { success: false, error: 'Siswa tidak ditemukan' };
    }

    const today = new Date().toISOString().split('T')[0];
    const dateStr = options.date || today;

    // Check if today is working day
    if (!isWorkingDay(dateStr)) {
      return { success: false, error: 'Hari ini adalah hari libur' };
    }

    // Check if already checked in today
    const existingAttendance = attendanceData.find(a => a.date === dateStr && a.studentId == studentId);
    if (existingAttendance && existingAttendance.timeIn) {
      return { success: false, error: `${student.nama} sudah absen masuk pada ${existingAttendance.timeIn}` };
    }

    // Get current time or use simulated time
    let timeStr;
    let now = new Date();
    
    if (options.simulateTime) {
      timeStr = options.simulateTime;
    } else if (simulate) {
      timeStr = now.toTimeString().slice(0, 5);
    } else {
      timeStr = now.toTimeString().slice(0, 5);
    }

    // Check if late
    const late = isLate(timeStr);
    const delayMinutes = calculateDelayMinutes(timeStr);

    // Determine attendance status
    let attendanceStatus = status;
    if (status === 'hadir' && late) {
      attendanceStatus = 'Hadir (Terlambat)';
    } else if (status === 'hadir') {
      attendanceStatus = 'Hadir';
    }

    try {
      // Save to Firebase
      const attendanceRef = ref(db, `absensi/${dateStr}/${studentId}`);
      
      const attendanceRecord = {
        in: timeStr,
        out: null,
        date: dateStr,
        studentId: studentId,
        nama: student.nama,
        kelas: student.kelas || '',
        jurusan: student.jurusan || '',
        isLate: late,
        delayMinutes: delayMinutes,
        status: attendanceStatus,
        timestamp: Date.now(),
        checkedInBy: user?.nama || 'Sistem',
        isSimulate: simulate || false
      };

      await set(attendanceRef, attendanceRecord);

      // Send notification if not simulate
      if (!simulate && status === 'hadir') {
        await sendCheckInNotification(student, timeStr, late);
      }

      // ==================== ✅ LOG ATTENDANCE CHECK IN ====================
      const logStatus = simulate ? '[SIMULASI] ' : '';
      const lateText = late ? ` terlambat ${delayMinutes} menit` : '';
      await logActivity('student_check_in', 
        `${logStatus}${student.nama} (${student.id}) absen masuk ${timeStr}${lateText}`,
        user
      );
      console.log('📝 Check-in activity logged');

      return { 
        success: true, 
        time: timeStr, 
        isLate: late, 
        delayMinutes,
        student: student
      };

    } catch (error) {
      console.error('❌ Check-in error:', error);
      
      // ==================== ❌ LOG ERROR ====================
      await logError(user, `Check-in failed for ${student.nama}: ${error.message}`, 'AttendanceTab/checkIn');
      
      return { success: false, error: error.message };
    }
  }, [students, attendanceData, isWorkingDay, isLate, calculateDelayMinutes, user, sendCheckInNotification]);

  const handleCheckOut = useCallback(async (studentId, options = {}) => {
    const { simulate = false } = options;
    
    if (!studentId) {
      return { success: false, error: 'ID siswa tidak valid' };
    }

    const student = students.find(s => s.id == studentId);
    if (!student) {
      return { success: false, error: 'Siswa tidak ditemukan' };
    }

    const today = new Date().toISOString().split('T')[0];
    const dateStr = options.date || today;

    // Check if already checked in today
    const existingAttendance = attendanceData.find(a => a.date === dateStr && a.studentId == studentId);
    if (!existingAttendance || !existingAttendance.timeIn) {
      return { success: false, error: `${student.nama} belum absen masuk hari ini` };
    }

    if (existingAttendance.timeOut) {
      return { success: false, error: `${student.nama} sudah absen pulang pada ${existingAttendance.timeOut}` };
    }

    // Check if student can check out based on delay
    const canOut = canCheckOut(student, existingAttendance.timeIn);
    if (!canOut && !simulate) {
      const delayOut = getStudentDelayOut(student);
      const checkOutTime = schoolConfig.checkOutTime || '15:30';
      return { 
        success: false, 
        error: `Belum waktunya pulang. ${student.nama} dapat pulang setelah ${checkOutTime} + ${delayOut} menit` 
      };
    }

    // Get current time or use simulated time
    let timeStr;
    let now = new Date();
    
    if (options.simulateTime) {
      timeStr = options.simulateTime;
    } else {
      timeStr = now.toTimeString().slice(0, 5);
    }

    try {
      // Update Firebase
      const attendanceRef = ref(db, `absensi/${dateStr}/${studentId}`);
      
      await update(attendanceRef, {
        out: timeStr,
        status: 'Pulang',
        checkedOutBy: user?.nama || 'Sistem',
        updatedAt: Date.now(),
        isSimulate: simulate || false
      });

      // Send notification if not simulate
      if (!simulate) {
        await sendCheckOutNotification(student, existingAttendance.timeIn, timeStr);
      }

      // ==================== ✅ LOG ATTENDANCE CHECK OUT ====================
      const logStatus = simulate ? '[SIMULASI] ' : '';
      await logActivity('student_check_out', 
        `${logStatus}${student.nama} (${student.id}) absen pulang ${timeStr}`,
        user
      );
      console.log('📝 Check-out activity logged');

      return { 
        success: true, 
        time: timeStr,
        student: student
      };

    } catch (error) {
      console.error('❌ Check-out error:', error);
      
      // ==================== ❌ LOG ERROR ====================
      await logError(user, `Check-out failed for ${student.nama}: ${error.message}`, 'AttendanceTab/checkOut');
      
      return { success: false, error: error.message };
    }
  }, [students, attendanceData, canCheckOut, getStudentDelayOut, schoolConfig.checkOutTime, user, sendCheckOutNotification]);

  // ==================== GET FILTERED STUDENTS FOR MODAL ====================
  const getFilteredStudentsForModal = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    
    if (simulateType === 'in') {
      // Untuk absen masuk: tampilkan semua siswa yang memenuhi filter
      let result = [...students];
      
      if (isSiswa) {
        const userKelas = studentInfo.kelas || user?.kelas || '';
        const userJurusan = studentInfo.jurusan || user?.jurusan || '';
        if (userKelas) {
          result = result.filter(s => s.kelas === userKelas);
        }
        if (userJurusan) {
          result = result.filter(s => s.jurusan === userJurusan);
        }
      } else {
        if (filterKelas !== 'all') {
          result = result.filter(s => s.kelas === filterKelas);
        }
        if (filterJurusan !== 'all') {
          result = result.filter(s => s.jurusan === filterJurusan);
        }
      }
      
      // Filter berdasarkan pencarian
      if (searchStudent.trim() !== '') {
        const term = searchStudent.toLowerCase();
        result = result.filter(s => 
          s.nama?.toLowerCase().includes(term) ||
          s.id?.toString().includes(term)
        );
      }
      
      return result;
    } else {
      // Untuk absen pulang: tampilkan siswa yang sudah absen masuk dan mencapai delay
      let result = [...students];
      
      // Filter berdasarkan role
      if (isSiswa) {
        const userKelas = studentInfo.kelas || user?.kelas || '';
        const userJurusan = studentInfo.jurusan || user?.jurusan || '';
        if (userKelas) {
          result = result.filter(s => s.kelas === userKelas);
        }
        if (userJurusan) {
          result = result.filter(s => s.jurusan === userJurusan);
        }
      } else {
        if (filterKelas !== 'all') {
          result = result.filter(s => s.kelas === filterKelas);
        }
        if (filterJurusan !== 'all') {
          result = result.filter(s => s.jurusan === filterJurusan);
        }
      }
      
      // Filter berdasarkan pencarian
      if (searchStudent.trim() !== '') {
        const term = searchStudent.toLowerCase();
        result = result.filter(s => 
          s.nama?.toLowerCase().includes(term) ||
          s.id?.toString().includes(term)
        );
      }
      
      // Hanya siswa yang sudah absen masuk hari ini dan belum pulang
      const checkedInIds = new Set();
      attendanceData
        .filter(a => a.date === today && a.timeIn && !a.timeOut)
        .forEach(a => checkedInIds.add(a.studentId));
      
      result = result.filter(s => checkedInIds.has(s.id));
      
      // Hanya siswa yang delay pulangnya sudah tercapai
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const checkOutTime = schoolConfig.checkOutTime || '15:30';
      const [outHours, outMinutes] = checkOutTime.split(':').map(Number);
      const checkoutMinutes = outHours * 60 + outMinutes;
      
      result = result.filter(s => {
        const delayOut = getStudentDelayOut(s);
        const allowedCheckOutMinutes = checkoutMinutes + delayOut;
        
        // Cek apakah sudah mencapai delay
        if (currentMinutes >= allowedCheckOutMinutes) return true;
        
        // Cek apakah sudah check in minimal 2 jam
        const attendance = attendanceData.find(a => a.date === today && a.studentId === s.id);
        if (attendance && attendance.timeIn) {
          const [inHours, inMinutes] = attendance.timeIn.split(':').map(Number);
          const checkInMinutes = inHours * 60 + inMinutes;
          const minutesSinceCheckIn = currentMinutes - checkInMinutes;
          if (minutesSinceCheckIn >= 120) return true;
        }
        
        return false;
      });
      
      return result;
    }
  }, [students, simulateType, isSiswa, studentInfo, user, filterKelas, filterJurusan, searchStudent, attendanceData, schoolConfig.checkOutTime, getStudentDelayOut]);

  // ==================== SIMULASI FUNCTIONS ====================
  
  const openSimulateModal = useCallback((type) => {
    if (!canSimulate) {
      alert('⚠️ Anda tidak memiliki akses untuk simulasi absen!');
      return;
    }
    setSimulateType(type);
    setSelectedStudent(null);
    setSearchStudent('');
    setSimulateStatus('hadir');
    setShowSimulateModal(true);
    
    (async () => {
      try {
        await logActivity('open_simulate_modal', 
          `${type === 'in' ? 'Masuk' : 'Pulang'} - ${user?.nama || 'Unknown'} (${role}) membuka modal simulasi`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
    })();
  }, [canSimulate, user, role]);

  const closeSimulateModal = useCallback(() => {
    setShowSimulateModal(false);
    setSelectedStudent(null);
    setSearchStudent('');
    setSimulateStatus('hadir');
  }, []);

  const handleSimulateAttendance = useCallback(async () => {
    if (!selectedStudent) {
      alert('Pilih siswa terlebih dahulu!');
      return;
    }

    setSimulateLoading(true);

    try {
      let result;
      let logDetails = '';
      
      if (simulateType === 'in') {
        // Simulate check in
        const now = new Date();
        const timeStr = now.toTimeString().slice(0, 5);
        const dateStr = now.toISOString().split('T')[0];
        
        result = await handleCheckIn(selectedStudent.id, {
          simulate: true,
          date: dateStr,
          simulateTime: timeStr,
          status: simulateStatus
        });
        
        if (result.success) {
          const statusMsg = simulateStatus !== 'hadir' ? ` (Status: ${simulateStatus})` : 
                           (result.isLate ? ' (Terlambat)' : '');
          alert(`✅ Simulasi absen masuk berhasil untuk ${selectedStudent.nama} (${result.time})${statusMsg}`);
          
          // ==================== ✅ LOG SIMULATE CHECK IN ====================
          await logSimulateAttendanceIn(user, selectedStudent.nama);
          console.log('📝 Simulate check-in activity logged');
          
        } else {
          alert(`❌ Gagal simulasi absen masuk: ${result.error}`);
        }
      } else {
        // Simulate check out
        const now = new Date();
        const timeStr = now.toTimeString().slice(0, 5);
        const dateStr = now.toISOString().split('T')[0];
        
        // Check if student has checked in today
        const existingAttendance = attendanceData.find(a => a.date === dateStr && a.studentId == selectedStudent.id);
        if (!existingAttendance || !existingAttendance.timeIn) {
          alert(`❌ ${selectedStudent.nama} belum absen masuk hari ini!`);
          setSimulateLoading(false);
          return;
        }
        
        if (existingAttendance.timeOut) {
          alert(`⚠️ ${selectedStudent.nama} sudah absen pulang pada ${existingAttendance.timeOut}`);
          setSimulateLoading(false);
          return;
        }
        
        // Check if student can check out
        const canOut = canCheckOut(selectedStudent, existingAttendance.timeIn);
        if (!canOut) {
          const delayOut = getStudentDelayOut(selectedStudent);
          const checkOutTime = schoolConfig.checkOutTime || '15:30';
          alert(`⏰ Belum waktunya pulang. ${selectedStudent.nama} dapat pulang setelah ${checkOutTime} + ${delayOut} menit`);
          setSimulateLoading(false);
          return;
        }
        
        result = await handleCheckOut(selectedStudent.id, {
          simulate: true,
          date: dateStr,
          simulateTime: timeStr
        });
        
        if (result.success) {
          alert(`✅ Simulasi absen pulang berhasil untuk ${selectedStudent.nama} (${result.time})`);
          
          // ==================== ✅ LOG SIMULATE CHECK OUT ====================
          await logSimulateAttendanceOut(user, selectedStudent.nama);
          console.log('📝 Simulate check-out activity logged');
          
        } else {
          alert(`❌ Gagal simulasi absen pulang: ${result.error}`);
        }
      }

      if (result?.success) {
        closeSimulateModal();
      }
    } catch (error) {
      console.error('Simulate error:', error);
      alert('❌ Gagal melakukan simulasi: ' + error.message);
      
      // ==================== ❌ LOG ERROR ====================
      await logError(user, `Simulate ${simulateType === 'in' ? 'check-in' : 'check-out'} failed for ${selectedStudent?.nama}: ${error.message}`, 'AttendanceTab/simulate');
      
    } finally {
      setSimulateLoading(false);
    }
  }, [selectedStudent, simulateType, simulateStatus, user, role, handleCheckIn, handleCheckOut, attendanceData, canCheckOut, getStudentDelayOut, schoolConfig.checkOutTime, closeSimulateModal]);

  // ==================== AUTO REMINDER ====================
  const sendBulkReminder = useCallback(async (studentList) => {
    const studentsToNotify = studentList || absentStudentsToday;
    
    if (studentsToNotify.length === 0) {
      return { success: true, message: 'Semua siswa sudah absen', count: 0 };
    }

    setWhatsappStatus({ sending: true, lastResult: null });
    let successCount = 0;
    let failCount = 0;
    const failedStudents = [];

    for (const student of studentsToNotify) {
      const result = await sendReminderNotification(student);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        failedStudents.push(student.nama);
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    setWhatsappStatus({ 
      sending: false, 
      lastResult: { 
        success: true, 
        message: `✅ Terkirim: ${successCount}, Gagal: ${failCount}`,
        failedStudents: failedStudents
      } 
    });

    // ==================== ✅ LOG BULK REMINDER ====================
    try {
      await logActivity('send_bulk_reminder', 
        `Mengirim pengingat ke ${successCount} siswa (${failCount} gagal)`,
        user
      );
    } catch (e) {
      console.warn('⚠️ Logging failed:', e);
    }

    return { success: true, successCount, failCount, failedStudents };
  }, [absentStudentsToday, sendReminderNotification, user]);

  const runAutoReminder = useCallback(async () => {
    if (autoReminderSent || autoReminderLoading) {
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    
    const checkedInIds = new Set();
    attendanceData
      .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang' || a.status === 'Hadir (Terlambat)'))
      .forEach(a => checkedInIds.add(a.studentId));

    let allStudents = [...students];
    
    if (isSiswa) {
      const targetKelas = studentInfo.kelas || user?.kelas || '';
      const targetJurusan = studentInfo.jurusan || user?.jurusan || '';
      if (targetKelas) {
        allStudents = allStudents.filter(s => s.kelas === targetKelas);
      }
      if (targetJurusan) {
        allStudents = allStudents.filter(s => s.jurusan === targetJurusan);
      }
    } else {
      if (filterKelas !== 'all') {
        allStudents = allStudents.filter(s => s.kelas === filterKelas);
      }
      if (filterJurusan !== 'all') {
        allStudents = allStudents.filter(s => s.jurusan === filterJurusan);
      }
    }
    
    const absent = allStudents.filter(s => !checkedInIds.has(s.id));
    setAbsentStudentsToday(absent);

    if (absent.length > 0) {
      setAutoReminderLoading(true);
      try {
        const result = await sendBulkReminder(absent);
        setAutoReminderSent(true);
        
        // ==================== ✅ LOG AUTO REMINDER ====================
        try {
          await logActivity('auto_reminder', 
            `Pengingat otomatis dikirim ke ${result.successCount} siswa (${result.failCount} gagal)`,
            user
          );
        } catch (e) {
          console.warn('⚠️ Logging failed:', e);
        }
        
      } catch (error) {
        console.error('❌ Auto reminder error:', error);
        
        // ==================== ❌ LOG ERROR ====================
        try {
          await logError(user, `Auto reminder failed: ${error.message}`, 'AttendanceTab/autoReminder');
        } catch (e) {
          console.warn('⚠️ Logging failed:', e);
        }
        
      } finally {
        setAutoReminderLoading(false);
      }
    } else {
      setAutoReminderSent(true);
      
      // ==================== ✅ LOG AUTO REMINDER (NO ABSENT) ====================
      try {
        await logActivity('auto_reminder', 
          'Semua siswa sudah absen hari ini - tidak perlu pengingat',
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
    }
  }, [autoReminderSent, autoReminderLoading, attendanceData, students, isSiswa, studentInfo, user, filterKelas, filterJurusan, sendBulkReminder]);

  // ==================== AMBIL DATA DARI FIREBASE ====================
  useEffect(() => {
    isMounted.current = true;

    // Ambil data siswa
    const usersRef = ref(db, 'users');
    const unsubscribeUsers = onValue(usersRef, (snapshot) => {
      if (!isMounted.current) return;
      const data = snapshot.val();
      const usersList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const student = data[key];
          if (student && student.nama && student.nama !== 'Tidak Diketahui' && student.nama.trim() !== '') {
            usersList.push({ id: key, ...student });
          }
        });
      }
      setStudents(usersList);

      const kelasSet = new Set();
      const jurusanSet = new Set();
      usersList.forEach(s => {
        if (s.kelas && s.kelas !== '') kelasSet.add(s.kelas);
        if (s.jurusan && s.jurusan !== '') jurusanSet.add(s.jurusan);
      });

      setKelasOptions(['all', ...Array.from(kelasSet).sort()]);
      setJurusanOptions(['all', ...Array.from(jurusanSet).sort()]);
    });

    // Ambil data users_auth
    const usersAuthRef = ref(db, 'users_auth');
    const unsubscribeUsersAuth = onValue(usersAuthRef, (snapshot) => {
      if (!isMounted.current) return;
      const data = snapshot.val();
      const authList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          authList.push({ uid: key, ...data[key] });
        });
      }
      setUsersAuth(authList);
      setPhotoCache({});
    });

    // Ambil konfigurasi sekolah
    const configRef = ref(db, 'school_config');
    const unsubscribeConfig = onValue(configRef, (snapshot) => {
      if (!isMounted.current) return;
      const data = snapshot.val();
      if (data) {
        setSchoolConfig({
          checkInTime: data.checkInTime || '07:00',
          checkOutTime: data.checkOutTime || '15:30',
          lateThreshold: data.lateThreshold || 15,
          workDays: data.workDays || { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
          holidays: data.holidays ? Object.values(data.holidays) : []
        });
      }
    });

    // Ambil nama sekolah dari school_config
    const schoolInfoRef = ref(db, 'school_info');
    const unsubscribeSchoolInfo = onValue(schoolInfoRef, (snapshot) => {
      if (!isMounted.current) return;
      const data = snapshot.val();
      if (data && data.name) {
        setSchoolName(data.name);
      } else {
        // Fallback ke school_config jika ada
        const configData = schoolConfig;
        if (configData && configData.schoolName) {
          setSchoolName(configData.schoolName);
        }
      }
    });

    // Ambil data absensi
    const attendanceRef = ref(db, 'absensi');
    const unsubscribeAttendance = onValue(attendanceRef, (snapshot) => {
      if (!isMounted.current) return;
      const data = snapshot.val();
      const attendanceList = [];
      if (data) {
        Object.keys(data).forEach(date => {
          const dailyRecords = data[date];
          if (dailyRecords) {
            Object.keys(dailyRecords).forEach(id => {
              const record = dailyRecords[id];
              if (record) {
                attendanceList.push({
                  id: date + "-" + id,
                  studentId: id,
                  date: date,
                  timeIn: record.in,
                  timeOut: record.out,
                  nama: record.nama,
                  kelas: record.kelas,
                  jurusan: record.jurusan,
                  status: record.out ? "Pulang" : (record.in ? (record.isLate ? "Hadir (Terlambat)" : "Hadir") : "Tidak Hadir"),
                  isLate: record.isLate || false,
                  delayMinutes: record.delayMinutes || 0,
                  timestamp: record.timestamp || Date.now(),
                  isSimulate: record.isSimulate || false
                });
              }
            });
          }
        });
      }
      attendanceList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setAttendanceData(attendanceList);
      setLoading(false);
      setError(null);
      setTimeout(() => setChartAnimated(true), 300);
    }, (error) => {
      console.error('Firebase attendance error:', error);
      setError('Gagal memuat data absensi siswa dari server');
      setLoading(false);
      
      // ==================== ❌ LOG ERROR ====================
      logError(user, `Failed to load attendance data: ${error.message}`, 'AttendanceTab/load');
    });

    return () => {
      isMounted.current = false;
      unsubscribeUsers();
      unsubscribeUsersAuth();
      unsubscribeConfig();
      unsubscribeSchoolInfo();
      unsubscribeAttendance();
    };
  }, []);

  // ==================== EFEK UNTUK AUTO REMINDER ====================
  useEffect(() => {
    if (!loading && students.length > 0 && attendanceData.length >= 0) {
      const timer = setTimeout(() => {
        if (!autoReminderSent && !autoReminderLoading) {
          runAutoReminder();
        }
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [loading, students, attendanceData, autoReminderSent, autoReminderLoading, runAutoReminder]);

  // ==================== FILTER DATA ====================
  const filteredData = useMemo(() => {
    let data = [...attendanceData];

    if (isSiswa) {
      const targetKelas = filterKelas !== 'all' ? filterKelas : (studentInfo.kelas || user?.kelas || '');
      const targetJurusan = filterJurusan !== 'all' ? filterJurusan : (studentInfo.jurusan || user?.jurusan || '');

      if (targetKelas) {
        data = data.filter(a => a.kelas === targetKelas);
      }
      if (targetJurusan) {
        data = data.filter(a => a.jurusan === targetJurusan);
      }
    } else {
      if (filterKelas !== 'all') {
        data = data.filter(a => a.kelas === filterKelas);
      }
      if (filterJurusan !== 'all') {
        data = data.filter(a => a.jurusan === filterJurusan);
      }
    }

    const today = new Date().toISOString().split('T')[0];
    if (filterDate === 'today') {
      data = data.filter(a => a.date === today);
    } else if (filterDate !== 'all') {
      data = data.filter(a => a.date === filterDate);
    }

    return data;
  }, [attendanceData, filterDate, filterKelas, filterJurusan, isSiswa, studentInfo, user]);

  const filteredStudents = useMemo(() => {
    let result = [...students];

    if (isSiswa) {
      const targetKelas = filterKelas !== 'all' ? filterKelas : (studentInfo.kelas || user?.kelas || '');
      const targetJurusan = filterJurusan !== 'all' ? filterJurusan : (studentInfo.jurusan || user?.jurusan || '');

      if (targetKelas) {
        result = result.filter(s => s.kelas === targetKelas);
      }
      if (targetJurusan) {
        result = result.filter(s => s.jurusan === targetJurusan);
      }
    } else {
      if (filterKelas !== 'all') {
        result = result.filter(s => s.kelas === filterKelas);
      }
      if (filterJurusan !== 'all') {
        result = result.filter(s => s.jurusan === filterJurusan);
      }
    }

    return result;
  }, [students, filterKelas, filterJurusan, isSiswa, studentInfo, user]);

  // ==================== STATISTICS ====================
  const stats = useMemo(() => {
    const totalSiswa = filteredStudents.length;
    const hadirSet = new Set();
    const pulangSet = new Set();

    filteredData.forEach(item => {
      if (item.status === 'Hadir' || item.status === 'Pulang' || item.status === 'Hadir (Terlambat)') {
        hadirSet.add(item.studentId);
      }
      if (item.status === 'Pulang') {
        pulangSet.add(item.studentId);
      }
    });

    const hadir = hadirSet.size;
    const pulang = pulangSet.size;
    const totalTransaksi = filteredData.length;
    const persentase = totalSiswa > 0 ? Math.round((hadir / totalSiswa) * 100) : 0;

    return { hadir, pulang, totalTransaksi, totalSiswa, persentase };
  }, [filteredData, filteredStudents]);

  // ==================== HITUNG SISWA BELUM ABSEN HARI INI ====================
  const today = new Date().toISOString().split('T')[0];
  const todayCheckedIn = useMemo(() => {
    const checkedIn = new Set();
    attendanceData
      .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang' || a.status === 'Hadir (Terlambat)'))
      .forEach(a => checkedIn.add(a.studentId));
    return checkedIn;
  }, [attendanceData, today]);

  const absentToday = useMemo(() => {
    return filteredStudents.filter(s => !todayCheckedIn.has(s.id));
  }, [filteredStudents, todayCheckedIn]);

  // ==================== CHART DATA ====================
  const donutData = useMemo(() => ({
    labels: ['Hadir', 'Tidak Hadir'],
    datasets: [{
      data: [stats.hadir, stats.totalSiswa - stats.hadir],
      backgroundColor: ['#4caf50', '#f44336'],
      borderWidth: 0,
      hoverOffset: 10
    }]
  }), [stats.hadir, stats.totalSiswa]);

  const donutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    cutout: '70%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: 'rgba(255,255,255,0.7)',
          font: { size: 12 },
          padding: 15,
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = total > 0 ? Math.round((context.parsed / total) * 100) : 0;
            return `${context.label}: ${context.parsed} siswa (${percentage}%)`;
          }
        }
      }
    },
    animation: {
      animateRotate: true,
      duration: 1500,
      easing: 'easeInOutQuart'
    }
  }), []);

  const kelasChartData = useMemo(() => {
    const kelasMap = new Map();

    filteredStudents.forEach(s => {
      const kelas = s.kelas || 'Tanpa Kelas';
      if (!kelasMap.has(kelas)) {
        kelasMap.set(kelas, { total: 0, hadir: 0 });
      }
      kelasMap.get(kelas).total++;
    });

    const hadirSet = new Set();
    filteredData.forEach(item => {
      if (item.status === 'Hadir' || item.status === 'Pulang' || item.status === 'Hadir (Terlambat)') {
        hadirSet.add(item.studentId);
      }
    });

    filteredStudents.forEach(s => {
      const kelas = s.kelas || 'Tanpa Kelas';
      if (hadirSet.has(s.id)) {
        kelasMap.get(kelas).hadir++;
      }
    });

    const labels = Array.from(kelasMap.keys());
    const hadirData = labels.map(k => kelasMap.get(k).hadir);
    const totalData = labels.map(k => kelasMap.get(k).total);
    const persentaseData = labels.map((k, i) => {
      return totalData[i] > 0 ? Math.round((hadirData[i] / totalData[i]) * 100) : 0;
    });

    return { labels, hadirData, totalData, persentaseData };
  }, [filteredStudents, filteredData]);

  const barData = useMemo(() => ({
    labels: kelasChartData.labels,
    datasets: [
      {
        label: 'Hadir',
        data: kelasChartData.hadirData,
        backgroundColor: 'rgba(76, 175, 80, 0.7)',
        borderColor: '#4caf50',
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.6,
        categoryPercentage: 0.7
      },
      {
        label: 'Total Siswa',
        data: kelasChartData.totalData,
        backgroundColor: 'rgba(33, 150, 243, 0.5)',
        borderColor: '#2196f3',
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.6,
        categoryPercentage: 0.7
      }
    ]
  }), [kelasChartData]);

  const barOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: 'rgba(255,255,255,0.7)',
          font: { size: 11 },
          padding: 10,
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.dataset.label || '';
            const value = context.parsed.y;
            return `${label}: ${value} siswa`;
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: 'rgba(255,255,255,0.5)', stepSize: 1 }
      },
      x: {
        grid: { display: false },
        ticks: { color: 'rgba(255,255,255,0.5)' }
      }
    },
    animation: {
      duration: 1200,
      easing: 'easeInOutQuart'
    }
  }), []);

  const lineData = useMemo(() => {
    const today = new Date();
    const last7Days = [];
    const attendanceCount = [];
    const percentageData = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayLabel = date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
      last7Days.push(dayLabel);

      const dayAttendance = filteredData.filter(a => a.date === dateStr);
      const hadirSet = new Set();
      dayAttendance.forEach(item => {
        if (item.status === 'Hadir' || item.status === 'Pulang' || item.status === 'Hadir (Terlambat)') {
          hadirSet.add(item.studentId);
        }
      });

      const hadir = hadirSet.size;
      attendanceCount.push(hadir);

      const totalSiswa = filteredStudents.length;
      const persen = totalSiswa > 0 ? Math.round((hadir / totalSiswa) * 100) : 0;
      percentageData.push(persen);
    }

    return { labels: last7Days, attendanceCount, percentageData };
  }, [filteredData, filteredStudents]);

  const lineChartData = useMemo(() => ({
    labels: lineData.labels,
    datasets: [
      {
        label: 'Jumlah Hadir',
        data: lineData.attendanceCount,
        borderColor: '#00bcd4',
        backgroundColor: 'rgba(0, 188, 212, 0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#00bcd4',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      },
      {
        label: 'Persentase Kehadiran (%)',
        data: lineData.percentageData,
        borderColor: '#ff9800',
        backgroundColor: 'rgba(255, 152, 0, 0.05)',
        fill: true,
        tension: 0.4,
        borderDash: [5, 5],
        pointBackgroundColor: '#ff9800',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        yAxisID: 'y1'
      }
    ]
  }), [lineData]);

  const lineOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: 'rgba(255,255,255,0.7)',
          font: { size: 11 },
          padding: 10,
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.dataset.label || '';
            const value = context.parsed.y;
            if (context.dataset.label.includes('Persentase')) {
              return `${label}: ${value}%`;
            }
            return `${label}: ${value} siswa`;
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: 'rgba(255,255,255,0.5)', stepSize: 1 },
        position: 'left'
      },
      y1: {
        beginAtZero: true,
        max: 100,
        grid: { display: false },
        ticks: { color: 'rgba(255,255,255,0.5)', callback: function(value) { return value + '%'; } },
        position: 'right'
      },
      x: {
        grid: { display: false },
        ticks: { color: 'rgba(255,255,255,0.5)' }
      }
    },
    animation: {
      duration: 1500,
      easing: 'easeInOutQuart'
    }
  }), []);

  // ==================== DELETE FUNCTIONS ====================
  const deleteAttendance = useCallback(async (id) => {
    if (!canDelete) {
      alert('⚠️ Hanya Admin/Developer/Wakil Kepala yang dapat menghapus data!');
      
      // ==================== ❌ LOG DELETE DENIED ====================
      try {
        await logActivity('delete_attendance_denied', 
          `User ${user?.nama} (${role}) mencoba hapus absensi - DITOLAK`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
      return;
    }

    const attendanceToDelete = attendanceData.find(a => a.id === id);
    if (!attendanceToDelete) {
      alert('❌ Data absensi tidak ditemukan!');
      return;
    }

    const studentName = attendanceToDelete.nama || 'Siswa';
    const date = attendanceToDelete.date;
    const studentId = attendanceToDelete.studentId;

    if (!window.confirm(`⚠️ Yakin ingin menghapus data absensi siswa "${studentName}"?\n\nTanggal: ${date}\nID: ${studentId}\n\nData akan dihapus PERMANEN dari database!`)) {
      return;
    }

    try {
      await remove(ref(db, `absensi/${date}/${studentId}`));

      setAttendanceData(prev => prev.filter(item => item.id !== id));

      alert(`✅ Data absensi siswa "${studentName}" berhasil dihapus!`);

      // ==================== ✅ LOG DELETE ATTENDANCE ====================
      try {
        await logDeleteAttendance(user, studentName, date);
        console.log('📝 Delete attendance activity logged');
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }

    } catch (error) {
      console.error('Delete error:', error);
      alert('❌ Gagal menghapus data: ' + error.message);
      
      // ==================== ❌ LOG ERROR ====================
      try {
        await logError(user, `Delete attendance failed for ${studentName}: ${error.message}`, 'AttendanceTab/delete');
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
    }
  }, [canDelete, attendanceData, user, role]);

  const deleteAllAttendance = useCallback(async () => {
    if (!isDeveloper) {
      alert('❌ Akses ditolak! Hanya role Developer yang dapat menghapus semua data.');
      
      // ==================== ❌ LOG DELETE ALL DENIED ====================
      try {
        await logActivity('delete_all_attendance_denied', 
          `User ${user?.nama} (${role}) mencoba hapus semua data - DITOLAK`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
      return;
    }

    const totalData = filteredData.length;
    if (totalData === 0) {
      alert('📭 Tidak ada data absensi siswa yang dapat dihapus.');
      return;
    }

    let filterDesc = '';
    if (filterKelas !== 'all' && filterJurusan !== 'all') {
      filterDesc = `Kelas ${filterKelas} & Jurusan ${filterJurusan}`;
    } else if (filterKelas !== 'all') {
      filterDesc = `Kelas ${filterKelas}`;
    } else if (filterJurusan !== 'all') {
      filterDesc = `Jurusan ${filterJurusan}`;
    } else if (filterDate !== 'all') {
      filterDesc = `Tanggal ${filterDate}`;
    } else {
      filterDesc = 'SEMUA DATA';
    }

    const confirmMessage = `⚠️ PERINGATAN!\n\nAnda akan menghapus SEMUA data absensi siswa (${totalData} data) dari database.\n\n📌 Filter: ${filterDesc}\n\nTindakan ini TIDAK DAPAT DIURUNGKAN!\n\nKetik "HAPUS SEMUA" untuk melanjutkan:`;
    
    const userInput = prompt(confirmMessage);
    if (userInput !== 'HAPUS SEMUA') {
      alert('❌ Penghapusan dibatalkan.');
      
      // ==================== ❌ LOG DELETE ALL CANCELLED ====================
      try {
        await logActivity('delete_all_attendance_cancelled', 
          `Penghapusan semua data dibatalkan - ${filterDesc}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
      return;
    }

    if (!window.confirm(`⚠️ KONFIRMASI FINAL!\n\nApakah Anda YAKIN ingin menghapus ${totalData} data absensi siswa secara permanen?`)) {
      alert('❌ Penghapusan dibatalkan.');
      return;
    }

    setDeleteAllLoading(true);

    try {
      const dates = new Set();
      filteredData.forEach(item => {
        dates.add(item.date);
      });

      let deletedCount = 0;
      const dateArray = Array.from(dates);

      for (const date of dateArray) {
        const dateRef = ref(db, `absensi/${date}`);
        await remove(dateRef);
        deletedCount += filteredData.filter(item => item.date === date).length;
      }

      setAttendanceData(prev => prev.filter(item => !dates.has(item.date)));

      alert(`✅ Berhasil menghapus ${deletedCount} data absensi siswa dari ${dateArray.length} tanggal!\n\n📌 Filter: ${filterDesc}`);

      // ==================== ✅ LOG DELETE ALL ATTENDANCE ====================
      try {
        await logActivity('delete_all_attendance', 
          `Menghapus semua absensi siswa - ${deletedCount} data dari ${dateArray.length} tanggal (Filter: ${filterDesc})`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }

    } catch (error) {
      console.error('Delete all error:', error);
      alert('❌ Gagal menghapus semua data: ' + error.message);
      
      // ==================== ❌ LOG ERROR ====================
      try {
        await logError(user, `Delete all attendance failed: ${error.message}`, 'AttendanceTab/deleteAll');
      } catch (e) {
        console.warn('⚠️ Logging failed:', e);
      }
      
    } finally {
      setDeleteAllLoading(false);
    }
  }, [isDeveloper, filteredData, filterKelas, filterJurusan, filterDate, user, role]);

  // ==================== EXPORT FUNCTIONS ====================
  const exportToExcel = useCallback(() => {
    setExportLoading(true);

    try {
      const schoolNameText = schoolName || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      const periodText = filterDate === 'all' ? 'Semua Data' : (filterDate === 'today' ? 'Hari Ini' : filterDate);

      let csv = '\uFEFF';
      csv += `"LAPORAN ABSENSI SISWA"\n`;
      csv += `"${schoolNameText}"\n`;
      csv += `"Periode: ${periodText}"\n`;
      csv += `"Filter Kelas: ${filterKelas === 'all' ? 'Semua' : filterKelas}"\n`;
      csv += `"Filter Jurusan: ${filterJurusan === 'all' ? 'Semua' : filterJurusan}"\n`;
      csv += `"Tanggal Cetak: ${dateNow} ${timeNow}"\n\n`;
      csv += `"No","Tanggal","Waktu Masuk","Waktu Pulang","ID","Nama","Kelas","Jurusan","Status","Delay (menit)","WA Orang Tua","Simulasi"\n`;

      filteredData.forEach((item, index) => {
        const student = students.find(s => s.id == item.studentId);
        const parentPhone = getStudentPhoneNumber(student) || '-';
        const status = item.status === 'Pulang' ? 'Pulang' : (item.isLate ? 'Terlambat' : 'Hadir');
        csv += `"${index + 1}","${item.date}","${item.timeIn || '-'}","${item.timeOut || '-'}","${item.studentId}","${item.nama}","${item.kelas || '-'}","${item.jurusan || '-'}","${status}","${item.delayMinutes || 0}","${parentPhone}","${item.isSimulate ? 'Ya' : 'Tidak'}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `absensi_siswa_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);

      // ==================== ✅ LOG EXPORT EXCEL ====================
      (async () => {
        try {
          await logExportData(user, 'Attendance Excel', filteredData.length);
          console.log('📝 Export Excel activity logged');
        } catch (e) {
          console.warn('⚠️ Logging failed:', e);
        }
      })();

    } catch (error) {
      console.error('Export Excel error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
      
      // ==================== ❌ LOG ERROR ====================
      (async () => {
        try {
          await logError(user, `Export Excel failed: ${error.message}`, 'AttendanceTab/exportExcel');
        } catch (e) {
          console.warn('⚠️ Logging failed:', e);
        }
      })();
      
    } finally {
      setExportLoading(false);
    }
  }, [filterDate, filterKelas, filterJurusan, filteredData, students, getStudentPhoneNumber, user, schoolName]);

  const exportToPDF = useCallback(() => {
    setExportLoading(true);

    try {
      const schoolNameText = schoolName || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      const periodText = filterDate === 'all' ? 'Semua Data' : (filterDate === 'today' ? 'Hari Ini' : filterDate);
      const roleName = user?.nama || user?.email || 'Pengguna';

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Gagal membuka window print. Mohon izinkan popup.');
        setExportLoading(false);
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Laporan Absensi Siswa - ${schoolNameText}</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; background: white; }
            .header { text-align: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #00bcd4; }
            .header h1 { color: #00bcd4; font-size: 24px; }
            .header p { color: #666; font-size: 13px; margin-top: 4px; }
            .info { margin-bottom: 20px; padding: 12px 16px; background: #f5f5f5; border-radius: 8px; font-size: 13px; display: flex; flex-wrap: wrap; gap: 20px; }
            .info .label { color: #888; }
            .info .value { font-weight: 600; color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: center; }
            th { background: #00bcd4; color: white; font-weight: 600; }
            tr:nth-child(even) { background: #f9f9f9; }
            .status-hadir { color: #4caf50; font-weight: 600; }
            .status-pulang { color: #ff9800; font-weight: 600; }
            .status-terlambat { color: #f44336; font-weight: 600; }
            .footer { text-align: center; margin-top: 20px; padding-top: 10px; font-size: 10px; color: #888; border-top: 1px solid #ddd; }
            .footer .signature { margin-top: 20px; display: flex; justify-content: flex-end; gap: 60px; }
            .footer .signature div { text-align: center; font-size: 12px; }
            .footer .signature .line { width: 150px; border-top: 1px solid #333; margin-top: 30px; }
            .wa-column { color: #25d366; }
            @media print { .no-print { display: none; } body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>📋 LAPORAN ABSENSI SISWA</h1>
            <p>${schoolNameText}</p>
          </div>
          <div class="info">
            <span><span class="label">📅 Periode:</span> <span class="value">${periodText}</span></span>
            <span><span class="label">📚 Kelas:</span> <span class="value">${filterKelas === 'all' ? 'Semua' : filterKelas}</span></span>
            <span><span class="label">🎓 Jurusan:</span> <span class="value">${filterJurusan === 'all' ? 'Semua' : filterJurusan}</span></span>
            <span><span class="label">👥 Total Data:</span> <span class="value">${filteredData.length}</span></span>
            <span><span class="label">👤 Dicetak oleh:</span> <span class="value">${roleName}</span></span>
            <span><span class="label">📅 Tanggal Cetak:</span> <span class="value">${dateNow} ${timeNow}</span></span>
          </div>
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Tanggal</th>
                <th>Waktu Masuk</th>
                <th>Waktu Pulang</th>
                <th>ID</th>
                <th>Nama Siswa</th>
                <th>Kelas</th>
                <th>Jurusan</th>
                <th>Status</th>
                <th>Delay</th>
                <th class="wa-column">📱 WA</th>
                <th>Simulasi</th>
              </tr>
            </thead>
            <tbody>
      `);

      filteredData.forEach((item, index) => {
        const student = students.find(s => s.id == item.studentId);
        const parentPhone = getStudentPhoneNumber(student) || '-';
        const isLate = item.isLate && item.status !== 'Pulang';
        let statusClass = 'status-hadir';
        let statusText = 'Hadir';
        if (item.status === 'Pulang') {
          statusClass = 'status-pulang';
          statusText = 'Pulang';
        } else if (isLate) {
          statusClass = 'status-terlambat';
          statusText = 'Terlambat';
        }

        printWindow.document.write(`
          <tr>
            <td>${index + 1}</td>
            <td>${item.date}</td>
            <td>${item.timeIn || '-'}</td>
            <td>${item.timeOut || '-'}</td>
            <td>${item.studentId}</td>
            <td>${item.nama}</td>
            <td>${item.kelas || '-'}</td>
            <td>${item.jurusan || '-'}</td>
            <td class="${statusClass}">${statusText}</td>
            <td>${item.delayMinutes || 0} min</td>
            <td class="wa-column">${parentPhone}</td>
            <td>${item.isSimulate ? '✅ Ya' : '-'}</td>
          </tr>
        `);
      });

      printWindow.document.write(`
            </tbody>
          </table>
          <div class="footer">
            <p>Sistem Absensi IoT - Fingerprint & Real-time</p>
            <p>* Laporan ini dihasilkan secara otomatis oleh sistem</p>
            <div class="signature">
              <div>
                <div class="line"></div>
                <p>Kepala Sekolah</p>
              </div>
              <div>
                <div class="line"></div>
                <p>Wakil Kepala Sekolah</p>
              </div>
              <div>
                <div class="line"></div>
                <p>Guru BK</p>
              </div>
            </div>
          </div>
          <div class="no-print" style="text-align:center; margin-top:20px;">
            <button onclick="window.print()" style="padding:10px 24px; background:#00bcd4; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; margin-right:10px;">🖨️ Cetak / Simpan PDF</button>
            <button onclick="window.close()" style="padding:10px 24px; background:#666; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px;">✖ Tutup</button>
          </div>
        </body>
        </html>
      `);
      printWindow.document.close();

      // ==================== ✅ LOG EXPORT PDF ====================
      (async () => {
        try {
          await logExportData(user, 'Attendance PDF', filteredData.length);
          console.log('📝 Export PDF activity logged');
        } catch (e) {
          console.warn('⚠️ Logging failed:', e);
        }
      })();

    } catch (error) {
      console.error('Export PDF error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
      
      // ==================== ❌ LOG ERROR ====================
      (async () => {
        try {
          await logError(user, `Export PDF failed: ${error.message}`, 'AttendanceTab/exportPDF');
        } catch (e) {
          console.warn('⚠️ Logging failed:', e);
        }
      })();
      
    } finally {
      setExportLoading(false);
    }
  }, [filterDate, filterKelas, filterJurusan, filteredData, students, getStudentPhoneNumber, user, schoolName]);

  // ==================== RENDER ====================
  const dateOptions = [];
  dateOptions.push({ value: 'all', label: '📅 Semua Data' });
  dateOptions.push({ value: 'today', label: '📅 Hari Ini' });
  for (let i = 1; i <= 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const label = date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
    dateOptions.push({ value: dateStr, label });
  }

  let filterButtonLabel = 'Semua Data';
  if (filterKelas !== 'all' && filterJurusan !== 'all') {
    filterButtonLabel = `Kelas ${filterKelas} & Jurusan ${filterJurusan}`;
  } else if (filterKelas !== 'all') {
    filterButtonLabel = `Kelas ${filterKelas}`;
  } else if (filterJurusan !== 'all') {
    filterButtonLabel = `Jurusan ${filterJurusan}`;
  } else if (filterDate !== 'all') {
    filterButtonLabel = `Tanggal ${filterDate}`;
  }

  const totalDataToDelete = filteredData.length;

  const getRoleLabel = useCallback(() => {
    if (isSiswa) return '👤 Siswa';
    if (isGuru) return '👨‍🏫 Guru';
    if (isStaff) return '👨‍💼 Staff TU';
    if (isDeveloper) return '💻 Developer';
    if (isFullAccess) return '🔐 Admin';
    return '👤 User';
  }, [isSiswa, isGuru, isStaff, isDeveloper, isFullAccess]);

  const hideFilters = isSiswa;

  if (loading) {
    return (
      <div className="attendance-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Memuat data absensi siswa...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="attendance-container">
        <div className="error-state">
          <div className="error-icon">❌</div>
          <h3>Gagal Memuat Data</h3>
          <p>{error}</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>🔄 Coba Lagi</button>
        </div>
      </div>
    );
  }

  // ==================== GET FILTERED STUDENTS FOR MODAL RENDER ====================
  const filteredStudentsForModal = getFilteredStudentsForModal();

  return (
    <div className="attendance-container-mobile">
      {/* ===== HEADER ===== */}
      <div className="attendance-header-mobile">
        <div className="header-left">
          {/* ⭐ MENGGUNAKAN MARQUEE TEXT UNTUK NAMA SEKOLAH ⭐ */}
          <div className="attendance-school-name-wrapper">
            <MarqueeText 
              text={schoolName || 'Sistem Absensi'} 
              speed={30}
              className="attendance-school-name-marquee"
            />
            <div className="attendance-school-name-underline"></div>
          </div>
          <h1>📋 Absensi Siswa</h1>
          <p className="header-subtitle">
            Pantau kehadiran siswa
            <span style={{ fontSize: '11px', marginLeft: '8px', color: 'var(--text-muted)' }}>
              ({getRoleLabel()})
            </span>
          </p>
        </div>
        <div className="header-actions-mobile">
          <div className="export-buttons">
            <button className="btn-export-excel" onClick={exportToExcel} disabled={exportLoading}>
              📊 Excel
            </button>
            <button className="btn-export-pdf" onClick={exportToPDF} disabled={exportLoading}>
              📄 PDF
            </button>
          </div>
          {canSimulate && (
            <div className="simulate-buttons-mobile" style={{ display: 'flex', gap: '6px' }}>
              <button 
                className="btn-simulate-in-mobile" 
                onClick={() => openSimulateModal('in')}
                style={{
                  padding: '6px 12px',
                  background: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                ✅ Masuk
              </button>
              <button 
                className="btn-simulate-out-mobile" 
                onClick={() => openSimulateModal('out')}
                style={{
                  padding: '6px 12px',
                  background: '#ff9800',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                🏠 Pulang
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== WHATSAPP STATUS BANNER ===== */}
      {whatsappStatus.lastResult && (
        <div className="whatsapp-status-banner" style={{
          padding: '8px 16px',
          borderRadius: '8px',
          marginBottom: '12px',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: whatsappStatus.lastResult.success ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.15)',
          border: `1px solid ${whatsappStatus.lastResult.success ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)'}`,
          color: whatsappStatus.lastResult.success ? '#4caf50' : '#f44336'
        }}>
          <span>{whatsappStatus.lastResult.success ? '✅' : '❌'}</span>
          <span>
            {whatsappStatus.lastResult.success 
              ? `WhatsApp terkirim ke ${whatsappStatus.lastResult.phoneNumber || 'nomor'}`
              : `WhatsApp gagal: ${whatsappStatus.lastResult.error || 'Unknown error'}`
            }
          </span>
          {whatsappStatus.sending && <span className="loading-dots">⏳ Mengirim...</span>}
          <button 
            onClick={() => setWhatsappStatus({ sending: false, lastResult: null })}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            ✖
          </button>
        </div>
      )}

      {/* ===== AUTO REMINDER STATUS ===== */}
      {autoReminderSent && (
        <div className="auto-reminder-status" style={{
          padding: '8px 16px',
          borderRadius: '8px',
          marginBottom: '12px',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(0,188,212,0.10)',
          border: '1px solid rgba(0,188,212,0.2)',
          color: '#00bcd4'
        }}>
          <span>🤖</span>
          <span>
            {autoReminderLoading ? '⏳ Mengirim pengingat otomatis...' : 
             absentToday.length === 0 ? '✅ Semua siswa sudah absen hari ini' :
             `✅ Pengingat otomatis telah dikirim ke ${absentToday.length} siswa yang belum absen`}
          </span>
          {autoReminderLoading && <span className="loading-dots">⏳</span>}
          <button 
            onClick={runAutoReminder}
            style={{
              marginLeft: 'auto',
              background: 'rgba(0,188,212,0.15)',
              border: '1px solid rgba(0,188,212,0.3)',
              borderRadius: '6px',
              padding: '4px 12px',
              color: '#00bcd4',
              cursor: 'pointer',
              fontSize: '11px'
            }}
            disabled={autoReminderLoading}
          >
            🔄 Kirim Ulang
          </button>
        </div>
      )}

      {/* ===== REMINDER BANNER ===== */}
      {(isGuruOrStaff || isFullAccess) && (
        <div className="reminder-banner" style={{
          background: 'linear-gradient(135deg, rgba(255,152,0,0.12), rgba(255,152,0,0.04))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(255,152,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🔔</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              <strong style={{ color: '#ff9800' }}>{absentToday.length}</strong> siswa belum absen hari ini
            </span>
            {autoReminderSent && (
              <span style={{ fontSize: '11px', color: '#4caf50' }}>
                ✅ Otomatis terkirim
              </span>
            )}
          </div>
          <button
            onClick={() => sendBulkReminder(absentToday)}
            disabled={whatsappStatus.sending || absentToday.length === 0}
            style={{
              padding: '8px 16px',
              background: absentToday.length > 0 ? '#ff9800' : '#666',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: absentToday.length > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {whatsappStatus.sending ? '⏳ Mengirim...' : `📱 Kirim Pengingat (${absentToday.length})`}
          </button>
        </div>
      )}

      {/* ===== DEVELOPER BANNER ===== */}
      {isDeveloper && (
        <div className="developer-banner-attendance" style={{
          background: 'linear-gradient(135deg, rgba(244,67,54,0.12), rgba(244,67,54,0.04))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(244,67,54,0.2)',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <span style={{ fontSize: '22px' }}>💻</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-muted)' }}>
              Status: <span style={{ color: '#f44336' }}>Developer Mode</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              👁️ Melihat semua data
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#4caf50', fontWeight: 'bold' }}>
              ✨ Bisa simulasi
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#f44336', fontWeight: 'bold' }}>
              🗑️ Bisa hapus semua
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#00bcd4', fontWeight: 'bold' }}>
              🤖 Auto reminder
            </span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
            {filteredData.length} data
          </span>
        </div>
      )}

      {/* ===== DELETE ALL BANNER ===== */}
      {isDeveloper && totalDataToDelete > 0 && (
        <div className="delete-all-banner" style={{
          background: 'rgba(244,67,54,0.08)',
          borderRadius: '12px',
          padding: '10px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(244,67,54,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              <strong style={{ color: '#f44336' }}>{totalDataToDelete}</strong> data akan dihapus
              <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '8px' }}>
                ({filterButtonLabel})
              </span>
            </span>
          </div>
          <button
            className="btn-delete-banner"
            onClick={deleteAllAttendance}
            disabled={deleteAllLoading}
            style={{
              padding: '6px 16px',
              background: deleteAllLoading ? '#666' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: deleteAllLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {deleteAllLoading ? '⏳ Menghapus...' : `🗑️ Hapus ${totalDataToDelete} Data`}
          </button>
        </div>
      )}

      {/* ===== STUDENT/GURU/STAFF BANNER ===== */}
      {isSiswa && (
        <div className="student-info-banner" style={{
          background: 'linear-gradient(135deg, rgba(0,188,212,0.15), rgba(0,188,212,0.05))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(0,188,212,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '22px' }}>👨‍🎓</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Kelas:</span>
            <span style={{ color: '#00bcd4', fontWeight: 'bold', fontSize: '14px' }}>
              {studentInfo.kelas || user?.kelas || 'Belum ditentukan'}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Jurusan:</span>
            <span style={{ color: '#00bcd4', fontWeight: 'bold', fontSize: '14px' }}>
              {studentInfo.jurusan || user?.jurusan || 'Belum ditentukan'}
            </span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
            📊 Menampilkan data kelas Anda
          </span>
        </div>
      )}

      {isGuru && (
        <div className="student-info-banner" style={{
          background: 'linear-gradient(135deg, rgba(33,150,243,0.12), rgba(33,150,243,0.04))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(33,150,243,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '22px' }}>👨‍🏫</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-muted)' }}>
              Status: <span style={{ color: '#2196f3' }}>Guru</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              👁️ Melihat semua data
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#4caf50', fontWeight: 'bold' }}>
              ✨ Bisa simulasi
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#ff9800', fontWeight: 'bold' }}>
              🔔 Bisa kirim pengingat
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#00bcd4', fontWeight: 'bold' }}>
              🤖 Auto reminder
            </span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
            {canSimulate ? '✅ Aktif' : '❌ Tidak aktif'}
          </span>
        </div>
      )}

      {isStaff && (
        <div className="student-info-banner" style={{
          background: 'linear-gradient(135deg, rgba(156,39,176,0.12), rgba(156,39,176,0.04))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(156,39,176,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '22px' }}>👨‍💼</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-muted)' }}>
              Status: <span style={{ color: '#9c27b0' }}>Staff TU</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              👁️ Melihat semua data
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#4caf50', fontWeight: 'bold' }}>
              ✨ Bisa simulasi
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#ff9800', fontWeight: 'bold' }}>
              🔔 Bisa kirim pengingat
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#00bcd4', fontWeight: 'bold' }}>
              🤖 Auto reminder
            </span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
            {canSimulate ? '✅ Aktif' : '❌ Tidak aktif'}
          </span>
        </div>
      )}

      {/* ===== STATS CARDS ===== */}
      <div className="stats-cards-mobile">
        <div className="stat-card-mobile">
          <span className="stat-number-mobile">{stats.totalSiswa}</span>
          <span className="stat-label-mobile">👥 Siswa</span>
        </div>
        <div className="stat-card-mobile stat-hadir-mobile">
          <span className="stat-number-mobile">{stats.hadir}</span>
          <span className="stat-label-mobile">✅ Hadir</span>
        </div>
        <div className="stat-card-mobile stat-pulang-mobile">
          <span className="stat-number-mobile">{stats.pulang}</span>
          <span className="stat-label-mobile">🏠 Pulang</span>
        </div>
        <div className="stat-card-mobile stat-persen-mobile">
          <span className="stat-number-mobile">{stats.persentase}%</span>
          <span className="stat-label-mobile">📊 Kehadiran</span>
        </div>
      </div>

      {/* ===== PROGRESS BAR ===== */}
      <div className="progress-container-mobile">
        <div className="progress-label-mobile">
          <span>Kehadiran Siswa {filterDate === 'all' ? '(Semua Data)' : filterDate === 'today' ? 'Hari Ini' : ''}</span>
          <span className="progress-percentage-mobile">{stats.persentase}%</span>
        </div>
        <div className="progress-bar-mobile">
          <div className="progress-fill-mobile" style={{ width: `${stats.persentase}%` }}></div>
        </div>
      </div>

      {/* ===== CHARTS ===== */}
      <div className="charts-grid-mobile">
        <div className="chart-card-mobile" key="chart-donut">
          <h4 className="chart-title">📊 Persentase Kehadiran</h4>
          <div className="chart-container-mobile">
            {!loading && (
              <Doughnut key="donut-chart" data={donutData} options={donutOptions} />
            )}
          </div>
          <div className="chart-info-mobile">
            <span>Total Siswa: {stats.totalSiswa}</span>
            <span>Hadir: {stats.hadir} ({stats.persentase}%)</span>
          </div>
        </div>

        {kelasChartData.labels.length > 0 && (
          <div className="chart-card-mobile chart-card-full" key="chart-bar">
            <h4 className="chart-title">📚 Kehadiran per Kelas</h4>
            <div className="chart-container-mobile chart-container-bar">
              {!loading && (
                <Bar key="bar-chart" data={barData} options={barOptions} />
              )}
            </div>
            <div className="chart-info-mobile chart-info-scroll">
              {kelasChartData.labels.map((label, i) => (
                <span key={`kelas-${label}-${i}`} className="chart-info-tag">
                  {label}: {kelasChartData.hadirData[i]}/{kelasChartData.totalData[i]} ({kelasChartData.persentaseData[i]}%)
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="chart-card-mobile chart-card-full" key="chart-line">
          <h4 className="chart-title">📈 Tren Kehadiran 7 Hari Terakhir</h4>
          <div className="chart-container-mobile chart-container-line">
            {!loading && (
              <Line key="line-chart" data={lineChartData} options={lineOptions} />
            )}
          </div>
        </div>
      </div>

      {/* ===== FILTERS ===== */}
      {!hideFilters && (
        <div className="filter-container-mobile">
          <div className="filter-group-mobile">
            <label>📅</label>
            <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)}>
              {dateOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="filter-group-mobile">
            <label>📚</label>
            <select value={filterKelas} onChange={(e) => setFilterKelas(e.target.value)}>
              {kelasOptions.map(k => (
                <option key={k} value={k}>{k === 'all' ? '📚 Semua Kelas' : k}</option>
              ))}
            </select>
          </div>
          <div className="filter-group-mobile">
            <label>🎓</label>
            <select value={filterJurusan} onChange={(e) => setFilterJurusan(e.target.value)}>
              {jurusanOptions.map(j => (
                <option key={j} value={j}>{j === 'all' ? '🎓 Semua Jurusan' : j}</option>
              ))}
            </select>
          </div>

          <div className="filter-count-mobile">
            <span>📊 {filteredData.length} data</span>
          </div>
        </div>
      )}

      {/* ===== FILTER INFO ===== */}
      {isSiswa && (
        <div className="filter-info-mobile" style={{
          padding: '8px 12px',
          background: 'rgba(0,188,212,0.08)',
          borderRadius: '8px',
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          <span>📚 Kelas: <strong style={{ color: '#00bcd4' }}>{studentInfo.kelas || user?.kelas || '-'}</strong></span>
          <span>🎓 Jurusan: <strong style={{ color: '#00bcd4' }}>{studentInfo.jurusan || user?.jurusan || '-'}</strong></span>
          <span>📊 {filteredData.length} data</span>
        </div>
      )}

      {isGuru && (
        <div className="filter-info-mobile" style={{
          padding: '8px 12px',
          background: 'rgba(33,150,243,0.08)',
          borderRadius: '8px',
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          <span>👁️ Menampilkan <strong style={{ color: '#2196f3' }}>semua data</strong></span>
          <span>📊 Total: <strong style={{ color: '#2196f3' }}>{filteredData.length}</strong> data</span>
          {filterKelas !== 'all' && <span>📚 Filter: <strong style={{ color: '#2196f3' }}>{filterKelas}</strong></span>}
          {filterJurusan !== 'all' && <span>🎓 Filter: <strong style={{ color: '#2196f3' }}>{filterJurusan}</strong></span>}
          <span style={{ color: '#4caf50', fontWeight: 'bold' }}>✨ Bisa simulasi</span>
          <span style={{ color: '#ff9800', fontWeight: 'bold' }}>🔔 Bisa kirim pengingat</span>
          <span style={{ color: '#00bcd4', fontWeight: 'bold' }}>🤖 Auto reminder</span>
        </div>
      )}

      {isStaff && (
        <div className="filter-info-mobile" style={{
          padding: '8px 12px',
          background: 'rgba(156,39,176,0.08)',
          borderRadius: '8px',
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          <span>👁️ Menampilkan <strong style={{ color: '#9c27b0' }}>semua data</strong></span>
          <span>📊 Total: <strong style={{ color: '#9c27b0' }}>{filteredData.length}</strong> data</span>
          {filterKelas !== 'all' && <span>📚 Filter: <strong style={{ color: '#9c27b0' }}>{filterKelas}</strong></span>}
          {filterJurusan !== 'all' && <span>🎓 Filter: <strong style={{ color: '#9c27b0' }}>{filterJurusan}</strong></span>}
          <span style={{ color: '#4caf50', fontWeight: 'bold' }}>✨ Bisa simulasi</span>
          <span style={{ color: '#ff9800', fontWeight: 'bold' }}>🔔 Bisa kirim pengingat</span>
          <span style={{ color: '#00bcd4', fontWeight: 'bold' }}>🤖 Auto reminder</span>
        </div>
      )}

      {isDeveloper && (
        <div className="filter-info-mobile" style={{
          padding: '8px 12px',
          background: 'rgba(244,67,54,0.08)',
          borderRadius: '8px',
          marginBottom: '12px',
          border: '1px solid rgba(244,67,54,0.2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          <span>💻 Mode <strong style={{ color: '#f44336' }}>Developer</strong></span>
          <span>📊 Total: <strong style={{ color: '#f44336' }}>{filteredData.length}</strong> data</span>
          <span style={{ color: '#f44336', fontWeight: 'bold' }}>🗑️ Bisa hapus semua</span>
          <span style={{ color: '#ff9800', fontWeight: 'bold' }}>🔔 Bisa kirim pengingat</span>
          <span style={{ color: '#00bcd4', fontWeight: 'bold' }}>🤖 Auto reminder</span>
        </div>
      )}

      {/* ===== TABLE - CARD VIEW ===== */}
      <div className="table-container-mobile">
        {filteredData.length === 0 ? (
          <div className="empty-state-mobile">
            <span className="empty-icon-mobile">📭</span>
            <h3>Belum Ada Data</h3>
            <p>Belum ada siswa yang absen pada periode ini</p>
            {filterDate !== 'all' && !isSiswa && (
              <button
                className="btn-view-all-mobile"
                onClick={() => setFilterDate('all')}
                style={{
                  padding: '8px 16px',
                  background: '#00bcd4',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  marginTop: '12px'
                }}
              >
                📋 Lihat Semua Data
              </button>
            )}
          </div>
        ) : (
          <div className="attendance-cards-mobile">
            {filteredData.map((item) => {
              const isLate = item.isLate && item.status !== 'Pulang';
              const photoUrl = getStudentPhoto(item.studentId, item.nama);
              const hasAccount = usersAuth.some(u => u.fpId == item.studentId);
              const student = students.find(s => s.id == item.studentId);
              const hasWA = getStudentPhoneNumber(student);

              let statusClass = 'status-hadir-mobile';
              let statusLabel = '✅ Hadir';
              if (item.status === 'Pulang') {
                statusClass = 'status-pulang-mobile';
                statusLabel = '🏠 Pulang';
              } else if (isLate) {
                statusClass = 'status-terlambat-mobile';
                statusLabel = '⏰ Terlambat';
              }

              // Calculate can check out status
              const canOut = student ? canCheckOut(student, item.timeIn) : false;

              return (
                <div key={item.id} className="attendance-card-mobile">
                  <div className="card-header-mobile">
                    <div className="card-avatar-mobile">
                      <img
                        src={photoUrl}
                        alt={item.nama}
                        onError={(e) => {
                          const initial = item.nama ? item.nama.charAt(0).toUpperCase() : 'U';
                          e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
                        }}
                      />
                      {hasAccount && <span className="card-badge-mobile" title="Memiliki akun">✅</span>}
                      {hasWA && <span className="card-wa-badge-mobile" title="WA terdaftar">📱</span>}
                      {item.isSimulate && <span className="card-simulate-badge" title="Simulasi">🎯</span>}
                    </div>
                    <div className="card-info-mobile">
                      <div className="card-name-mobile">{item.nama}</div>
                      <div className="card-class-mobile">{item.kelas || '-'} - {item.jurusan || '-'}</div>
                      <div className="card-id-mobile">#{item.studentId}</div>
                    </div>
                    <div className="card-status-mobile">
                      <span className={`status-badge-mobile ${statusClass}`}>{statusLabel}</span>
                      {item.isSimulate && (
                        <span className="simulate-badge" style={{
                          fontSize: '9px',
                          background: '#9c27b0',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          marginLeft: '4px'
                        }}>
                          Simulasi
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="card-body-mobile">
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">⏰ Waktu</span>
                      <span className="card-value-mobile">
                        {item.timeIn || '-'}
                        {item.timeOut && ` → ${item.timeOut}`}
                        {item.timeIn && !item.timeOut && student && (
                          <span style={{ fontSize: '10px', color: canOut ? '#4caf50' : '#ff9800', marginLeft: '8px' }}>
                            {canOut ? '✅ Bisa pulang' : '⏳ Belum waktunya'}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">📅 Tanggal</span>
                      <span className="card-value-mobile">{item.date}</span>
                    </div>
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">⏱️ Delay</span>
                      <span className="card-value-mobile">{item.delayMinutes || 0} menit</span>
                    </div>
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">📱 WA</span>
                      <span className="card-value-mobile" style={{ color: hasWA ? '#25d366' : 'var(--text-muted)' }}>
                        {hasWA || '-'}
                      </span>
                    </div>
                  </div>
                  <div className="card-footer-mobile">
                    {showDeleteButton && (
                      <button
                        className="btn-delete-mobile"
                        onClick={() => deleteAttendance(item.id)}
                        style={{
                          padding: '4px 12px',
                          background: '#f44336',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '11px'
                        }}
                      >
                        🗑️ Hapus
                      </button>
                    )}
                    {(isGuru || isStaff) && !showDeleteButton && (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        👁️ View only ({isGuru ? 'Guru' : 'Staff TU'})
                      </span>
                    )}
                    {item.isSimulate && (
                      <span style={{ fontSize: '10px', color: '#9c27b0', marginLeft: 'auto' }}>
                        🎯 Simulasi
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== FOOTER ===== */}
      <div className="attendance-footer-mobile">
        <p className="footer-info-mobile">
          📌 Data absensi <strong>siswa</strong> dari <code>absensi</code>
          <span className="footer-wa-info-mobile"> • 📱 WA otomatis</span>
          {filterDate === 'all' && <span className="footer-all-data-mobile"> • 📋 Menampilkan semua data</span>}
          <span className="footer-role-mobile"> • {getRoleLabel()}</span>
          {isSiswa && (
            <span className="footer-filter-mobile"> • 📚 {studentInfo.kelas || user?.kelas || '-'} - {studentInfo.jurusan || user?.jurusan || '-'}</span>
          )}
          {(isGuru || isStaff) && (
            <span className="footer-filter-mobile"> • 👁️ Semua data • ✨ Bisa simulasi • 🔔 Bisa kirim pengingat • 🤖 Auto reminder</span>
          )}
          {isDeveloper && (
            <span className="footer-dev-mobile" style={{ color: '#f44336', fontWeight: 'bold' }}>
              • 💻 Mode Developer • 🗑️ Bisa hapus semua • 🔔 Bisa kirim pengingat • 🤖 Auto reminder
            </span>
          )}
        </p>
        <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
          🤖 Auto reminder: {autoReminderSent ? '✅ Aktif' : '⏳ Menunggu...'} 
          {absentToday.length > 0 && ` • ${absentToday.length} siswa belum absen`}
          {filteredData.some(d => d.isSimulate) && ` • 🎯 ${filteredData.filter(d => d.isSimulate).length} simulasi`}
        </p>
      </div>

      {/* ===== MODAL SIMULASI ===== */}
      {showSimulateModal && (
        <div className="modal-overlay-mobile" onClick={closeSimulateModal}>
          <div className="modal-box-mobile" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-mobile">
              <div className="modal-header-left-mobile">
                <span className="modal-icon-mobile">{simulateType === 'in' ? '✅' : '🏠'}</span>
                <h3>
                  {simulateType === 'in' ? 'Simulasi Absen Masuk' : 'Simulasi Absen Pulang'}
                  <span style={{ fontSize: '11px', fontWeight: 'normal', marginLeft: '8px', color: 'var(--text-muted)' }}>
                    ({getRoleLabel()})
                  </span>
                </h3>
              </div>
              <button className="modal-close-mobile" onClick={closeSimulateModal}>✖</button>
            </div>
            <div className="modal-body-mobile">
              <div className="form-group-mobile">
                <label>🔍 Cari Siswa</label>
                <input
                  type="text"
                  placeholder="Nama atau ID siswa..."
                  value={searchStudent}
                  onChange={(e) => setSearchStudent(e.target.value)}
                  className="search-input-mobile"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    background: 'var(--input-bg)',
                    color: 'var(--text-color)',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div className="student-list-mobile" style={{
                maxHeight: '250px',
                overflowY: 'auto',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                marginTop: '8px'
              }}>
                {filteredStudentsForModal.slice(0, 15).map(s => {
                  const photo = getStudentPhoto(s.id, s.nama);
                  const hasAcc = usersAuth.some(u => u.fpId == s.id);
                  const hasWA = getStudentPhoneNumber(s);
                  const today = new Date().toISOString().split('T')[0];
                  const isCheckedIn = attendanceData.some(a => a.date === today && a.studentId === s.id && a.timeIn && !a.timeOut);
                  const delayOut = getStudentDelayOut(s);
                  
                  // Check if student has already checked in and can check out
                  const canOut = simulateType === 'out' ? canCheckOut(s, attendanceData.find(a => a.date === today && a.studentId === s.id)?.timeIn) : true;
                  
                  return (
                    <div
                      key={s.id}
                      className={`student-item-mobile ${selectedStudent?.id === s.id ? 'selected' : ''}`}
                      onClick={() => {
                        if (simulateType === 'out' && !canOut) {
                          const checkOutTime = schoolConfig.checkOutTime || '15:30';
                          alert(`⏰ ${s.nama} belum bisa pulang. Delay pulang: ${delayOut} menit. Waktu pulang: ${checkOutTime} + ${delayOut} menit`);
                          return;
                        }
                        setSelectedStudent(s);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        cursor: simulateType === 'out' && !canOut ? 'not-allowed' : 'pointer',
                        borderBottom: '1px solid var(--border-color)',
                        background: selectedStudent?.id === s.id ? 'rgba(0,188,212,0.1)' : 'transparent',
                        opacity: simulateType === 'out' && (!isCheckedIn || !canOut) ? 0.5 : 1
                      }}
                    >
                      <img
                        src={photo}
                        alt={s.nama}
                        className="student-avatar-small-mobile"
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          objectFit: 'cover'
                        }}
                        onError={(e) => {
                          const initial = s.nama ? s.nama.charAt(0).toUpperCase() : 'U';
                          e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
                        }}
                      />
                      <div className="student-item-info-mobile" style={{ flex: 1 }}>
                        <span className="student-item-name-mobile" style={{ fontWeight: 'bold', fontSize: '13px' }}>
                          {s.nama}
                        </span>
                        <span className="student-item-class-mobile" style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                          {s.kelas || '-'} - {s.jurusan || '-'}
                        </span>
                        <span className="student-item-id-mobile" style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                          ID: {s.id}
                        </span>
                        {simulateType === 'out' && (
                          <span style={{ 
                            fontSize: '10px', 
                            color: isCheckedIn && canOut ? '#4caf50' : '#f44336', 
                            marginLeft: '8px',
                            fontWeight: 'bold'
                          }}>
                            {isCheckedIn ? (canOut ? `✅ Bisa pulang (delay: ${delayOut} menit)` : `⏳ Belum waktunya (delay: ${delayOut} menit)`) : '❌ Belum absen masuk'}
                          </span>
                        )}
                        {simulateType === 'in' && (
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                            Delay pulang: {delayOut} menit
                          </span>
                        )}
                      </div>
                      <div className="student-item-badges-mobile" style={{ display: 'flex', gap: '4px' }}>
                        {hasAcc && <span className="student-item-badge-mobile" title="Memiliki akun">✅</span>}
                        {hasWA && <span className="student-item-wa-mobile" title="WA terdaftar">📱</span>}
                        {simulateType === 'out' && isCheckedIn && canOut && (
                          <span className="student-item-checkout-badge" style={{
                            fontSize: '10px',
                            background: '#4caf50',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            Bisa pulang
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredStudentsForModal.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    {simulateType === 'out' 
                      ? 'Tidak ada siswa yang sudah absen masuk dan mencapai delay pulang' 
                      : 'Tidak ada siswa ditemukan'}
                  </div>
                )}
              </div>

              {selectedStudent && (
                <div className="selected-student-mobile" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  background: 'rgba(0,188,212,0.08)',
                  borderRadius: '8px',
                  marginTop: '12px'
                }}>
                  <img
                    src={getStudentPhoto(selectedStudent.id, selectedStudent.nama)}
                    alt={selectedStudent.nama}
                    className="student-avatar-small-mobile"
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      objectFit: 'cover'
                    }}
                    onError={(e) => {
                      const initial = selectedStudent.nama ? selectedStudent.nama.charAt(0).toUpperCase() : 'U';
                      e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
                    }}
                  />
                  <div className="selected-student-info-mobile" style={{ flex: 1 }}>
                    <div className="selected-name-mobile"><strong>{selectedStudent.nama}</strong></div>
                    <div className="selected-class-mobile">{selectedStudent.kelas || '-'} - {selectedStudent.jurusan || '-'}</div>
                    <div className="selected-id-mobile">🆔 ID: {selectedStudent.id}</div>
                    {simulateType === 'out' && (
                      <div className="selected-delay-mobile" style={{ fontSize: '11px', color: '#ff9800' }}>
                        ⏰ Delay pulang: {getStudentDelayOut(selectedStudent)} menit
                      </div>
                    )}
                  </div>
                  {getStudentPhoneNumber(selectedStudent) ? (
                    <span className="wa-status-mobile" title="WA terdaftar" style={{ color: '#25d366', fontWeight: 'bold' }}>📱</span>
                  ) : (
                    <span className="wa-status-no-mobile" title="WA tidak terdaftar" style={{ color: '#f44336' }}>⚠️</span>
                  )}
                </div>
              )}

              {simulateType === 'in' && (
                <div className="form-group-mobile" style={{ marginTop: '12px' }}>
                  <label>Status</label>
                  <select 
                    value={simulateStatus} 
                    onChange={(e) => setSimulateStatus(e.target.value)} 
                    className="status-select-mobile"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      background: 'var(--input-bg)',
                      color: 'var(--text-color)',
                      fontSize: '14px'
                    }}
                  >
                    <option value="hadir">✅ Hadir</option>
                    <option value="izin">📝 Izin</option>
                    <option value="sakit">🤒 Sakit</option>
                    <option value="alpha">❌ Alpha</option>
                  </select>
                </div>
              )}

              {simulateType === 'out' && selectedStudent && (
                <div className="info-box" style={{
                  padding: '10px 12px',
                  background: 'rgba(255,152,0,0.08)',
                  borderRadius: '8px',
                  marginTop: '12px',
                  fontSize: '12px',
                  color: 'var(--text-muted)'
                }}>
                  <strong>⏰ Delay Pulang:</strong> {getStudentDelayOut(selectedStudent)} menit
                  <br />
                  <strong>📅 Waktu Pulang:</strong> {schoolConfig.checkOutTime || '15:30'} + {getStudentDelayOut(selectedStudent)} menit
                </div>
              )}

              <div style={{
                padding: '8px 12px',
                background: 'rgba(37,211,102,0.08)',
                borderRadius: '8px',
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginTop: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap'
              }}>
                <span>📱</span>
                <span>
                  {selectedStudent 
                    ? getStudentPhoneNumber(selectedStudent) 
                      ? `WA terdaftar: ${getStudentPhoneNumber(selectedStudent)}` 
                      : '⚠️ WA tidak terdaftar'
                    : 'Pilih siswa untuk melihat nomor WA'}
                </span>
                {simulateType === 'in' && simulateStatus === 'hadir' && selectedStudent && (
                  <span style={{ color: '#4caf50', fontWeight: 'bold', marginLeft: 'auto' }}>
                    ✅ Akan kirim notifikasi
                  </span>
                )}
                {simulateType === 'out' && selectedStudent && (
                  <span style={{ color: '#4caf50', fontWeight: 'bold', marginLeft: 'auto' }}>
                    ✅ Akan kirim notifikasi pulang
                  </span>
                )}
                {simulateType === 'in' && simulateStatus !== 'hadir' && selectedStudent && (
                  <span style={{ color: '#ff9800', fontWeight: 'bold', marginLeft: 'auto' }}>
                    ⚠️ Tidak kirim notifikasi (status non-hadir)
                  </span>
                )}
              </div>
            </div>
            <div className="modal-footer-mobile" style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              padding: '16px',
              borderTop: '1px solid var(--border-color)',
              marginTop: '16px'
            }}>
              <button 
                className="btn-cancel-mobile" 
                onClick={closeSimulateModal}
                style={{
                  padding: '8px 20px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-color)',
                  cursor: 'pointer'
                }}
              >
                Batal
              </button>
              <button
                className="btn-save-mobile"
                onClick={handleSimulateAttendance}
                disabled={!selectedStudent || simulateLoading}
                style={{
                  padding: '8px 24px',
                  background: (!selectedStudent || simulateLoading) ? '#666' : '#00bcd4',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: (!selectedStudent || simulateLoading) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}
              >
                {simulateLoading ? '⏳...' : simulateType === 'in' ? '✅ Simpan Masuk' : '🏠 Simpan Pulang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceTab;