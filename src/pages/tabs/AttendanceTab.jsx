// src/pages/tabs/AttendanceTab.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ref, onValue, set, remove, update, get } from 'firebase/database';
import { db } from '../../firebase/config';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, PointElement, LineElement, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
// ✅ IMPORT LOGGER LANGSUNG
import { logActivity } from '../../utils/logger';
import './AttendanceTab.css';

// Register ChartJS components
ChartJS.register(
  ArcElement, Tooltip, Legend, CategoryScale, LinearScale,
  BarElement, Title, PointElement, LineElement, Filler
);

const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const AttendanceTab = ({ user }) => {
  const [attendanceData, setAttendanceData] = useState([]);
  const [students, setStudents] = useState([]);
  const [usersAuth, setUsersAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterDate, setFilterDate] = useState('all');
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

  // Refs untuk mencegah unmount issues
  const isMounted = useRef(true);
  const chartRefs = useRef({});

  // ==================== CEK ROLE & AKSES (CASE-INSENSITIVE) ====================
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

  // ==================== FILTER & STATS ====================
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

  const stats = useMemo(() => {
    const totalSiswa = filteredStudents.length;
    const hadirSet = new Set();
    const pulangSet = new Set();

    filteredData.forEach(item => {
      if (item.status === 'Hadir' || item.status === 'Pulang') {
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

  // ==================== GET STUDENT PHONE NUMBER ====================
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
    
    return null;
  }, [usersAuth]);

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

  // ==================== SEND REMINDER NOTIFICATION ====================
  const sendReminderNotification = useCallback(async (student) => {
    const phoneNumber = getStudentPhoneNumber(student);
    if (!phoneNumber) {
      return { success: false, error: 'No phone number' };
    }

    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sekolah';
    const dateStr = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    const message = `*🔔 PENGINGAT ABSENSI - ${schoolName}*

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

    // ✅ LOGGING LANGSUNG dengan try-catch
    if (result.success) {
      try {
        await logActivity('send_reminder', 
          `Pengingat ke ${student.nama} (${phoneNumber})`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for send_reminder:', e);
      }
    }

    return result;
  }, [getStudentPhoneNumber, sendWhatsAppNotification, user]);

  // ==================== SEND BULK REMINDER ====================
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

    // ✅ LOGGING LANGSUNG dengan try-catch
    try {
      await logActivity('send_bulk_reminder', 
        `Mengirim pengingat ke ${successCount} siswa (${failCount} gagal)${failedStudents.length > 0 ? ' - Gagal: ' + failedStudents.join(', ') : ''}`,
        user
      );
    } catch (e) {
      console.warn('⚠️ Logging failed for send_bulk_reminder:', e);
    }

    return { success: true, successCount, failCount, failedStudents };
  }, [absentStudentsToday, sendReminderNotification, user]);

  // ==================== AUTO REMINDER ====================
  const runAutoReminder = useCallback(async () => {
    if (autoReminderSent || autoReminderLoading) {
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    
    const checkedInIds = new Set();
    attendanceData
      .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
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
    }
    
    const absent = allStudents.filter(s => !checkedInIds.has(s.id));
    setAbsentStudentsToday(absent);

    if (absent.length > 0) {
      setAutoReminderLoading(true);
      try {
        const result = await sendBulkReminder(absent);
        setAutoReminderSent(true);
        // ✅ LOGGING LANGSUNG dengan try-catch
        try {
          await logActivity('auto_reminder', 
            `Pengingat otomatis dikirim ke ${result.successCount} siswa (${result.failCount} gagal)`,
            user
          );
        } catch (e) {
          console.warn('⚠️ Logging failed for auto_reminder:', e);
        }
      } catch (error) {
        console.error('❌ Auto reminder error:', error);
        // ✅ LOGGING ERROR
        try {
          await logActivity('auto_reminder_error', 
            `Gagal mengirim auto reminder: ${error.message}`,
            user
          );
        } catch (e) {
          console.warn('⚠️ Logging failed for auto_reminder_error:', e);
        }
      } finally {
        setAutoReminderLoading(false);
      }
    } else {
      setAutoReminderSent(true);
      // ✅ LOGGING TIDAK ADA SISWA YANG PERLU DIINGATKAN
      try {
        await logActivity('auto_reminder', 
          'Semua siswa sudah absen hari ini - tidak perlu pengingat',
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for auto_reminder (no absent):', e);
      }
    }
  }, [autoReminderSent, autoReminderLoading, attendanceData, students, isSiswa, studentInfo, user, sendBulkReminder]);

  // ==================== AMBIL DATA SISWA DARI USERS NODE ====================
  useEffect(() => {
    if (isSiswa) {
      let studentRef = null;
      if (user?.fpId) {
        studentRef = ref(db, `users/${user.fpId}`);
      } else if (user?.id) {
        studentRef = ref(db, `users/${user.id}`);
      } else {
        const usersRef = ref(db, 'users');
        const unsubscribe = onValue(usersRef, (snapshot) => {
          if (!isMounted.current) return;
          const data = snapshot.val();
          if (data) {
            for (const [id, student] of Object.entries(data)) {
              if (student.nama === user?.nama || student.email === user?.email) {
                setStudentInfo({
                  kelas: student.kelas || '',
                  jurusan: student.jurusan || ''
                });
                if (student.kelas) setFilterKelas(student.kelas);
                if (student.jurusan) setFilterJurusan(student.jurusan);
                break;
              }
            }
          }
        });
        return () => unsubscribe();
      }

      if (studentRef) {
        const unsubscribe = onValue(studentRef, (snapshot) => {
          if (!isMounted.current) return;
          const data = snapshot.val();
          if (data) {
            const kelas = data.kelas || '';
            const jurusan = data.jurusan || '';
            setStudentInfo({ kelas, jurusan });
            if (kelas) setFilterKelas(kelas);
            if (jurusan) setFilterJurusan(jurusan);
          }
        });
        return () => unsubscribe();
      }
    }
  }, [isSiswa, user]);

  // ==================== GET STUDENT PHOTO ====================
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

  // ==================== SEND CHECK-IN NOTIFICATION ====================
  const sendCheckInNotification = useCallback(async (student, time, isLate) => {
    const phoneNumber = getStudentPhoneNumber(student);
    if (!phoneNumber) {
      return { success: false, error: 'No phone number' };
    }

    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sekolah';
    const dateStr = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const message = `*📋 NOTIFIKASI ABSENSI MASUK - ${schoolName}*

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

    // ✅ LOGGING LANGSUNG dengan try-catch
    if (result.success) {
      try {
        await logActivity('send_check_in_notification', 
          `Notifikasi check-in ke ${student.nama} (${phoneNumber}) - ${isLate ? 'TERLAMBAT' : 'TEPAT WAKTU'}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for send_check_in_notification:', e);
      }
    }

    return result;
  }, [getStudentPhoneNumber, sendWhatsAppNotification, user]);

  // ==================== SEND CHECK-OUT NOTIFICATION ====================
  const sendCheckOutNotification = useCallback(async (student, timeIn, timeOut) => {
    const phoneNumber = getStudentPhoneNumber(student);
    if (!phoneNumber) {
      return { success: false, error: 'No phone number' };
    }

    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sekolah';
    const dateStr = new Date().toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const message = `*🏠 NOTIFIKASI ABSENSI PULANG - ${schoolName}*

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

    // ✅ LOGGING LANGSUNG dengan try-catch
    if (result.success) {
      try {
        await logActivity('send_check_out_notification', 
          `Notifikasi check-out ke ${student.nama} (${phoneNumber})`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for send_check_out_notification:', e);
      }
    }

    return result;
  }, [getStudentPhoneNumber, sendWhatsAppNotification, user]);

  // ==================== EXPORT FUNCTIONS ====================
  const exportToExcel = useCallback(() => {
    setExportLoading(true);

    try {
      const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      const periodText = filterDate === 'all' ? 'Semua Data' : (filterDate === 'today' ? 'Hari Ini' : filterDate);

      let csv = '\uFEFF';
      csv += `"LAPORAN ABSENSI SISWA"\n`;
      csv += `"${schoolName}"\n`;
      csv += `"Periode: ${periodText}"\n`;
      csv += `"Filter Kelas: ${filterKelas === 'all' ? 'Semua' : filterKelas}"\n`;
      csv += `"Filter Jurusan: ${filterJurusan === 'all' ? 'Semua' : filterJurusan}"\n`;
      csv += `"Tanggal Cetak: ${dateNow} ${timeNow}"\n\n`;
      csv += `"No","Tanggal","Waktu Masuk","Waktu Pulang","ID","Nama","Kelas","Jurusan","Status","WA Orang Tua"\n`;

      filteredData.forEach((item, index) => {
        const student = students.find(s => s.id == item.studentId);
        const parentPhone = getStudentPhoneNumber(student) || '-';
        const status = item.status === 'Pulang' ? 'Pulang' : (item.timeIn > '07:30' ? 'Terlambat' : 'Hadir');
        csv += `"${index + 1}","${item.date}","${item.timeIn || '-'}","${item.timeOut || '-'}","${item.studentId}","${item.nama}","${item.kelas || '-'}","${item.jurusan || '-'}","${status}","${parentPhone}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `absensi_siswa_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);

      // ✅ LOGGING LANGSUNG dengan try-catch (async IIFE)
      (async () => {
        try {
          await logActivity('export_attendance_excel', `Ekspor absensi siswa ke Excel - ${filteredData.length} data`, user);
        } catch (e) {
          console.warn('⚠️ Logging failed for export_attendance_excel:', e);
        }
      })();

    } catch (error) {
      console.error('Export Excel error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
      // ✅ LOGGING ERROR
      (async () => {
        try {
          await logActivity('export_attendance_excel_error', `Gagal ekspor Excel: ${error.message}`, user);
        } catch (e) {
          console.warn('⚠️ Logging failed for export_attendance_excel_error:', e);
        }
      })();
    } finally {
      setExportLoading(false);
    }
  }, [filterDate, filterKelas, filterJurusan, filteredData, students, getStudentPhoneNumber, user]);

  const exportToPDF = useCallback(() => {
    setExportLoading(true);

    try {
      const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      const periodText = filterDate === 'all' ? 'Semua Data' : (filterDate === 'today' ? 'Hari Ini' : filterDate);
      const roleName = user?.nama || user?.email || 'Pengguna';

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Gagal membuka window print. Mohon izinkan popup.');
        // ✅ LOGGING ERROR
        (async () => {
          try {
            await logActivity('export_attendance_pdf_error', 'Gagal buka window print (popup diblokir)', user);
          } catch (e) {
            console.warn('⚠️ Logging failed:', e);
          }
        })();
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Laporan Absensi Siswa - ${schoolName}</title>
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
            <p>${schoolName}</p>
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
                <th class="wa-column">📱 WA</th>
              </tr>
            </thead>
            <tbody>
      `);

      filteredData.forEach((item, index) => {
        const student = students.find(s => s.id == item.studentId);
        const parentPhone = getStudentPhoneNumber(student) || '-';
        const isLate = item.timeIn && item.timeIn > '07:30' && item.status === 'Hadir';
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
            <td class="wa-column">${parentPhone}</td>
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

      // ✅ LOGGING LANGSUNG dengan try-catch (async IIFE)
      (async () => {
        try {
          await logActivity('export_attendance_pdf', `Ekspor absensi siswa ke PDF - ${filteredData.length} data`, user);
        } catch (e) {
          console.warn('⚠️ Logging failed for export_attendance_pdf:', e);
        }
      })();

    } catch (error) {
      console.error('Export PDF error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
      // ✅ LOGGING ERROR
      (async () => {
        try {
          await logActivity('export_attendance_pdf_error', `Gagal ekspor PDF: ${error.message}`, user);
        } catch (e) {
          console.warn('⚠️ Logging failed for export_attendance_pdf_error:', e);
        }
      })();
    } finally {
      setExportLoading(false);
    }
  }, [filterDate, filterKelas, filterJurusan, filteredData, students, getStudentPhoneNumber, user]);

  // ==================== DELETE ALL STUDENT ATTENDANCE ====================
  const deleteAllAttendance = useCallback(async () => {
    if (!isDeveloper) {
      alert('❌ Akses ditolak! Hanya role Developer yang dapat menghapus semua data.');
      // ✅ LOGGING DENIED
      try {
        await logActivity('delete_all_attendance_denied', 
          `User ${user?.nama} (${role}) mencoba hapus semua data - DITOLAK`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_all_attendance_denied:', e);
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
      // ✅ LOGGING CANCELLED
      try {
        await logActivity('delete_all_attendance_cancelled', 
          `Penghapusan semua data dibatalkan - ${filterDesc}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_all_attendance_cancelled:', e);
      }
      return;
    }

    if (!window.confirm(`⚠️ KONFIRMASI FINAL!\n\nApakah Anda YAKIN ingin menghapus ${totalData} data absensi siswa secara permanen?`)) {
      alert('❌ Penghapusan dibatalkan.');
      // ✅ LOGGING CANCELLED FINAL
      try {
        await logActivity('delete_all_attendance_cancelled', 
          `Penghapusan semua data dibatalkan (final) - ${filterDesc}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_all_attendance_cancelled:', e);
      }
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

      for (const date of dateArray) {
        try {
          const statusRef = ref(db, `attendance_status/${date}`);
          await remove(statusRef);
        } catch (e) { /* skip */ }
        
        try {
          const statusNodeRef = ref(db, `status/${date}`);
          await remove(statusNodeRef);
        } catch (e) { /* skip */ }
      }

      setAttendanceData(prev => prev.filter(item => !dates.has(item.date)));

      alert(`✅ Berhasil menghapus ${deletedCount} data absensi siswa dari ${dateArray.length} tanggal!\n\n📌 Filter: ${filterDesc}`);

      // ✅ LOGGING SUCCESS
      try {
        await logActivity('delete_all_attendance', 
          `Menghapus semua absensi siswa - ${deletedCount} data dari ${dateArray.length} tanggal (Filter: ${filterDesc})`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_all_attendance:', e);
      }

    } catch (error) {
      console.error('Delete all error:', error);
      alert('❌ Gagal menghapus semua data: ' + error.message);
      // ✅ LOGGING ERROR
      try {
        await logActivity('delete_all_attendance_error', 
          `Gagal hapus semua data: ${error.message}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_all_attendance_error:', e);
      }
    } finally {
      setDeleteAllLoading(false);
    }
  }, [isDeveloper, filteredData, filterKelas, filterJurusan, filterDate, user, role]);

  // ==================== AMBIL DATA DARI FIREBASE ====================
  useEffect(() => {
    isMounted.current = true;

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
                  status: record.out ? "Pulang" : "Hadir",
                  timestamp: record.timestamp || Date.now()
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
    });

    return () => {
      isMounted.current = false;
      unsubscribeUsers();
      unsubscribeUsersAuth();
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

  // ==================== HITUNG SISWA BELUM ABSEN HARI INI ====================
  const today = new Date().toISOString().split('T')[0];
  const todayCheckedIn = useMemo(() => {
    const checkedIn = new Set();
    attendanceData
      .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
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
      if (item.status === 'Hadir' || item.status === 'Pulang') {
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
        if (item.status === 'Hadir' || item.status === 'Pulang') {
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

  // ==================== DELETE ATTENDANCE ====================
  const deleteAttendance = useCallback(async (id) => {
    if (!canDelete) {
      alert('⚠️ Hanya Admin/Developer/Wakil Kepala yang dapat menghapus data!');
      // ✅ LOGGING DENIED
      try {
        await logActivity('delete_attendance_denied', 
          `User ${user?.nama} (${role}) mencoba hapus absensi - DITOLAK`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_attendance_denied:', e);
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
      // ✅ LOGGING CANCELLED
      try {
        await logActivity('delete_attendance_cancelled', 
          `Penghapusan absensi ${studentName} dibatalkan`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_attendance_cancelled:', e);
      }
      return;
    }

    try {
      await remove(ref(db, `absensi/${date}/${studentId}`));

      const statusRef = ref(db, `attendance_status/${date}/${studentId}`);
      const statusSnapshot = await get(statusRef);
      if (statusSnapshot.exists()) {
        await remove(statusRef);
      }

      const statusNodeRef = ref(db, `status/${date}/${studentId}`);
      const statusNodeSnapshot = await get(statusNodeRef);
      if (statusNodeSnapshot.exists()) {
        await remove(statusNodeRef);
      }

      setAttendanceData(prev => prev.filter(item => item.id !== id));

      alert(`✅ Data absensi siswa "${studentName}" berhasil dihapus dari database!`);

      // ✅ LOGGING SUCCESS
      try {
        await logActivity('delete_attendance', 
          `Menghapus absensi siswa ${studentName} (ID: ${studentId}) pada tanggal ${date}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_attendance:', e);
      }

    } catch (error) {
      console.error('Delete error:', error);
      alert('❌ Gagal menghapus data: ' + error.message);
      // ✅ LOGGING ERROR
      try {
        await logActivity('delete_attendance_error', 
          `Gagal hapus absensi ${studentName}: ${error.message}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for delete_attendance_error:', e);
      }
    }
  }, [canDelete, attendanceData, user, role]);

  // ==================== SIMULASI ABSEN ====================
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
    
    // ✅ LOGGING OPEN MODAL dengan try-catch (async IIFE)
    (async () => {
      try {
        await logActivity('open_simulate_modal', 
          `${type === 'in' ? 'Masuk' : 'Pulang'} - ${user?.nama || 'Unknown'} (${role}) membuka modal simulasi`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for open_simulate_modal:', e);
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

    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toISOString().split('T')[0];

    try {
      if (simulateType === 'in') {
        const existingSnapshot = await get(ref(db, `absensi/${dateStr}/${selectedStudent.id}`));
        if (existingSnapshot.exists()) {
          alert(`⚠️ Siswa ${selectedStudent.nama} sudah absen masuk hari ini!`);
          setSimulateLoading(false);
          return;
        }

        const isLate = timeStr > '07:30';
        const attendanceData = {
          id: parseInt(selectedStudent.id),
          nama: selectedStudent.nama,
          kelas: selectedStudent.kelas,
          jurusan: selectedStudent.jurusan,
          in: timeStr,
          out: null,
          timestamp: Date.now(),
          status: simulateStatus === 'hadir' ? (isLate ? 'Hadir' : 'Hadir') : simulateStatus
        };

        await set(ref(db, `absensi/${dateStr}/${selectedStudent.id}`), attendanceData);

        let whatsappResult = null;
        if (simulateStatus === 'hadir') {
          const studentData = students.find(s => s.id == selectedStudent.id);
          if (studentData) {
            whatsappResult = await sendCheckInNotification(studentData, timeStr, isLate);
          }
        }

        const roleName = user?.nama || user?.email || 'Unknown';
        // ✅ LOGGING SIMULATE IN
        try {
          await logActivity('simulate_check_in', 
            `${roleName} (${role}) mensimulasikan absen masuk untuk ${selectedStudent.nama} (${timeStr}) - Status: ${simulateStatus}`,
            user
          );
        } catch (e) {
          console.warn('⚠️ Logging failed for simulate_check_in:', e);
        }

        let alertMessage = `✅ Absen masuk berhasil untuk siswa ${selectedStudent.nama} (${timeStr})${isLate ? ' ⚠️ Terlambat!' : ''}`;
        if (whatsappResult?.success) {
          alertMessage += '\n📱 WhatsApp terkirim!';
        } else if (whatsappResult?.error) {
          alertMessage += `\n⚠️ WhatsApp gagal: ${whatsappResult.error}`;
        }
        alert(alertMessage);
      } else {
        const snapshot = await get(ref(db, `absensi/${dateStr}/${selectedStudent.id}`));
        if (!snapshot.exists()) {
          alert('❌ Siswa belum absen masuk hari ini!');
          setSimulateLoading(false);
          return;
        }

        const existingData = snapshot.val();

        await update(ref(db, `absensi/${dateStr}/${selectedStudent.id}`), {
          out: timeStr,
          status: 'Pulang'
        });

        const studentData = students.find(s => s.id == selectedStudent.id);
        let whatsappResult = null;
        if (studentData) {
          whatsappResult = await sendCheckOutNotification(studentData, existingData.in || '-', timeStr);
        }

        const roleName = user?.nama || user?.email || 'Unknown';
        // ✅ LOGGING SIMULATE OUT
        try {
          await logActivity('simulate_check_out', 
            `${roleName} (${role}) mensimulasikan absen pulang untuk ${selectedStudent.nama} (${timeStr})`,
            user
          );
        } catch (e) {
          console.warn('⚠️ Logging failed for simulate_check_out:', e);
        }

        let alertMessage = `✅ Absen pulang berhasil untuk siswa ${selectedStudent.nama} (${timeStr})`;
        if (whatsappResult?.success) {
          alertMessage += '\n📱 WhatsApp terkirim!';
        } else if (whatsappResult?.error) {
          alertMessage += `\n⚠️ WhatsApp gagal: ${whatsappResult.error}`;
        }
        alert(alertMessage);
      }

      closeSimulateModal();
    } catch (error) {
      console.error('Simulate error:', error);
      alert('❌ Gagal melakukan simulasi: ' + error.message);
      // ✅ LOGGING ERROR
      try {
        await logActivity('simulate_attendance_error', 
          `Gagal simulasi ${simulateType === 'in' ? 'masuk' : 'pulang'} untuk ${selectedStudent?.nama}: ${error.message}`,
          user
        );
      } catch (e) {
        console.warn('⚠️ Logging failed for simulate_attendance_error:', e);
      }
    } finally {
      setSimulateLoading(false);
    }
  }, [selectedStudent, simulateType, simulateStatus, students, user, role, sendCheckInNotification, sendCheckOutNotification, closeSimulateModal]);

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
    if (isFullAccess) return '🔐 Admin';
    return '👤 User';
  }, [isSiswa, isGuru, isStaff, isFullAccess]);

  const hideFilters = isSiswa;
  const showDeleteButton = canDelete;

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

  return (
    <div className="attendance-container-mobile">
      {/* ===== HEADER ===== */}
      <div className="attendance-header-mobile">
        <div className="header-left">
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
        <div className="developer-banner-attendance">
          <span className="dev-icon">💻</span>
          <div className="dev-info">
            <span className="dev-status">
              Status: <span>Developer Mode</span>
            </span>
            <span className="dev-badge">|</span>
            <span className="dev-badge">👁️ Melihat semua data absensi</span>
            <span className="dev-badge">|</span>
            <span className="dev-badge highlight-green">✨ Bisa simulasi absen</span>
            <span className="dev-badge">|</span>
            <span className="dev-badge highlight-red">🗑️ Bisa hapus semua data</span>
            <span className="dev-badge">|</span>
            <span className="dev-badge highlight-blue">🤖 Auto reminder aktif</span>
          </div>
          <span className="dev-count">{filteredData.length} data</span>
        </div>
      )}

      {/* ===== DELETE ALL BANNER ===== */}
      {isDeveloper && totalDataToDelete > 0 && (
        <div className="delete-all-banner">
          <div className="banner-left">
            <span className="banner-icon">⚠️</span>
            <span className="banner-title">Mode Developer - Hapus Data</span>
            <span className="banner-info">
              <strong>{totalDataToDelete}</strong> data akan dihapus
              <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '8px' }}>
                ({filterButtonLabel})
              </span>
            </span>
          </div>
          <button
            className="btn-delete-banner"
            onClick={deleteAllAttendance}
            disabled={deleteAllLoading}
          >
            {deleteAllLoading ? '⏳ Menghapus...' : `🗑️ Hapus ${totalDataToDelete} Data`}
          </button>
        </div>
      )}

      {/* ===== STUDENT/GURU/STAFF BANNER ===== */}
      {/* (Kode banner untuk student, guru, staff sudah sama, tidak diubah) */}
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
              👁️ Melihat semua data absensi
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#4caf50', fontWeight: 'bold' }}>
              ✨ Bisa simulasi absen
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#ff9800', fontWeight: 'bold' }}>
              🔔 Bisa kirim pengingat
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#00bcd4', fontWeight: 'bold' }}>
              🤖 Auto reminder aktif
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
              👁️ Melihat semua data absensi
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#4caf50', fontWeight: 'bold' }}>
              ✨ Bisa simulasi absen
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#ff9800', fontWeight: 'bold' }}>
              🔔 Bisa kirim pengingat
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#00bcd4', fontWeight: 'bold' }}>
              🤖 Auto reminder aktif
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
          <span>👁️ Menampilkan <strong style={{ color: '#2196f3' }}>semua data</strong> absensi</span>
          <span>📊 Total: <strong style={{ color: '#2196f3' }}>{filteredData.length}</strong> data</span>
          {filterKelas !== 'all' && <span>📚 Filter: <strong style={{ color: '#2196f3' }}>{filterKelas}</strong></span>}
          {filterJurusan !== 'all' && <span>🎓 Filter: <strong style={{ color: '#2196f3' }}>{filterJurusan}</strong></span>}
          <span style={{ color: '#4caf50', fontWeight: 'bold' }}>✨ Bisa simulasi</span>
          <span style={{ color: '#ff9800', fontWeight: 'bold' }}>🔔 Bisa kirim pengingat</span>
          <span style={{ color: '#00bcd4', fontWeight: 'bold' }}>🤖 Auto reminder aktif</span>
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
          <span>👁️ Menampilkan <strong style={{ color: '#9c27b0' }}>semua data</strong> absensi</span>
          <span>📊 Total: <strong style={{ color: '#9c27b0' }}>{filteredData.length}</strong> data</span>
          {filterKelas !== 'all' && <span>📚 Filter: <strong style={{ color: '#9c27b0' }}>{filterKelas}</strong></span>}
          {filterJurusan !== 'all' && <span>🎓 Filter: <strong style={{ color: '#9c27b0' }}>{filterJurusan}</strong></span>}
          <span style={{ color: '#4caf50', fontWeight: 'bold' }}>✨ Bisa simulasi</span>
          <span style={{ color: '#ff9800', fontWeight: 'bold' }}>🔔 Bisa kirim pengingat</span>
          <span style={{ color: '#00bcd4', fontWeight: 'bold' }}>🤖 Auto reminder aktif</span>
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
          <span style={{ color: '#00bcd4', fontWeight: 'bold' }}>🤖 Auto reminder aktif</span>
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
              >
                📋 Lihat Semua Data
              </button>
            )}
          </div>
        ) : (
          <div className="attendance-cards-mobile">
            {filteredData.map((item) => {
              const isLate = item.timeIn && item.timeIn > '07:30' && item.status === 'Hadir';
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
                    </div>
                    <div className="card-info-mobile">
                      <div className="card-name-mobile">{item.nama}</div>
                      <div className="card-class-mobile">{item.kelas || '-'} - {item.jurusan || '-'}</div>
                      <div className="card-id-mobile">#{item.studentId}</div>
                    </div>
                    <div className="card-status-mobile">
                      <span className={`status-badge-mobile ${statusClass}`}>{statusLabel}</span>
                    </div>
                  </div>
                  <div className="card-body-mobile">
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">⏰ Waktu</span>
                      <span className="card-value-mobile">
                        {item.timeIn || '-'}
                        {item.timeOut && ` → ${item.timeOut}`}
                      </span>
                    </div>
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">📅 Tanggal</span>
                      <span className="card-value-mobile">{item.date}</span>
                    </div>
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">📱 WA</span>
                      <span className="card-value-mobile" style={{ color: hasWA ? '#25d366' : 'var(--text-muted)' }}>
                        {hasWA || '-'}
                      </span>
                    </div>
                  </div>
                  {showDeleteButton && (
                    <div className="card-footer-mobile">
                      <button
                        className="btn-delete-mobile"
                        onClick={() => deleteAttendance(item.id)}
                      >
                        🗑️ Hapus
                      </button>
                    </div>
                  )}
                  {(isGuru || isStaff) && !showDeleteButton && (
                    <div className="card-footer-mobile" style={{ justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        👁️ View only ({isGuru ? 'Guru' : 'Staff TU'})
                      </span>
                    </div>
                  )}
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
                  {simulateType === 'in' ? 'Absen Masuk Siswa' : 'Absen Pulang Siswa'}
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
                />
              </div>

              <div className="student-list-mobile">
                {students
                  .filter(s => {
                    if (isSiswa) {
                      const userKelas = studentInfo.kelas || user?.kelas || '';
                      const userJurusan = studentInfo.jurusan || user?.jurusan || '';
                      const matchKelas = !userKelas || s.kelas === userKelas;
                      const matchJurusan = !userJurusan || s.jurusan === userJurusan;
                      return matchKelas && matchJurusan && 
                        (s.nama?.toLowerCase().includes(searchStudent.toLowerCase()) ||
                         s.id?.toString().includes(searchStudent));
                    }
                    return s.nama?.toLowerCase().includes(searchStudent.toLowerCase()) ||
                           s.id?.toString().includes(searchStudent);
                  })
                  .slice(0, 10)
                  .map(s => {
                    const photo = getStudentPhoto(s.id, s.nama);
                    const hasAcc = usersAuth.some(u => u.fpId == s.id);
                    const hasWA = getStudentPhoneNumber(s);
                    return (
                      <div
                        key={s.id}
                        className={`student-item-mobile ${selectedStudent?.id === s.id ? 'selected' : ''}`}
                        onClick={() => setSelectedStudent(s)}
                      >
                        <img
                          src={photo}
                          alt={s.nama}
                          className="student-avatar-small-mobile"
                          onError={(e) => {
                            const initial = s.nama ? s.nama.charAt(0).toUpperCase() : 'U';
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
                          }}
                        />
                        <div className="student-item-info-mobile">
                          <span className="student-item-name-mobile">{s.nama}</span>
                          <span className="student-item-class-mobile">{s.kelas || '-'} - {s.jurusan || '-'}</span>
                          <span className="student-item-id-mobile">ID: {s.id}</span>
                        </div>
                        <div className="student-item-badges-mobile">
                          {hasAcc && <span className="student-item-badge-mobile" title="Memiliki akun">✅</span>}
                          {hasWA && <span className="student-item-wa-mobile" title="WA terdaftar">📱</span>}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {selectedStudent && (
                <div className="selected-student-mobile">
                  <img
                    src={getStudentPhoto(selectedStudent.id, selectedStudent.nama)}
                    alt={selectedStudent.nama}
                    className="student-avatar-small-mobile"
                    onError={(e) => {
                      const initial = selectedStudent.nama ? selectedStudent.nama.charAt(0).toUpperCase() : 'U';
                      e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
                    }}
                  />
                  <div className="selected-student-info-mobile">
                    <div className="selected-name-mobile"><strong>{selectedStudent.nama}</strong></div>
                    <div className="selected-class-mobile">{selectedStudent.kelas || '-'} - {selectedStudent.jurusan || '-'}</div>
                    <div className="selected-id-mobile">🆔 ID: {selectedStudent.id}</div>
                  </div>
                  {getStudentPhoneNumber(selectedStudent) ? (
                    <span className="wa-status-mobile" title="WA terdaftar">📱</span>
                  ) : (
                    <span className="wa-status-no-mobile" title="WA tidak terdaftar">⚠️</span>
                  )}
                </div>
              )}

              {simulateType === 'in' && (
                <div className="form-group-mobile">
                  <label>Status</label>
                  <select value={simulateStatus} onChange={(e) => setSimulateStatus(e.target.value)} className="status-select-mobile">
                    <option value="hadir">✅ Hadir</option>
                    <option value="izin">📝 Izin</option>
                    <option value="sakit">🤒 Sakit</option>
                    <option value="alpha">❌ Alpha</option>
                  </select>
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
                gap: '6px'
              }}>
                <span>📱</span>
                <span>
                  {selectedStudent 
                    ? getStudentPhoneNumber(selectedStudent) 
                      ? `WA terdaftar: ${getStudentPhoneNumber(selectedStudent)}` 
                      : '⚠️ WA tidak terdaftar'
                    : 'Pilih siswa untuk melihat nomor WA'}
                </span>
                {simulateType === 'in' && simulateStatus === 'hadir' && (
                  <span style={{ color: '#4caf50', fontWeight: 'bold', marginLeft: 'auto' }}>
                    ✅ Akan kirim notifikasi
                  </span>
                )}
                {simulateType === 'out' && (
                  <span style={{ color: '#4caf50', fontWeight: 'bold', marginLeft: 'auto' }}>
                    ✅ Akan kirim notifikasi pulang
                  </span>
                )}
              </div>
            </div>
            <div className="modal-footer-mobile">
              <button className="btn-cancel-mobile" onClick={closeSimulateModal}>Batal</button>
              <button
                className="btn-save-mobile"
                onClick={handleSimulateAttendance}
                disabled={!selectedStudent || simulateLoading}
              >
                {simulateLoading ? '⏳...' : simulateType === 'in' ? '✅ Simpan' : '🏠 Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceTab;