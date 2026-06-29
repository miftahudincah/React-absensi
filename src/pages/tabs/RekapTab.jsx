// src/pages/tabs/RekapTab.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../firebase/config';
import './RekapTab.css';

const RekapTab = ({ user }) => {
  const [attendanceData, setAttendanceData] = useState([]);
  const [students, setStudents] = useState([]);
  const [usersAuth, setUsersAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterKelas, setFilterKelas] = useState('all');
  const [filterJurusan, setFilterJurusan] = useState('all');
  const [kelasOptions, setKelasOptions] = useState(['all']);
  const [jurusanOptions, setJurusanOptions] = useState(['all']);
  
  // State untuk periode
  const [periodType, setPeriodType] = useState('minggu');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [periodLabel, setPeriodLabel] = useState('Minggu Ini');
  
  // State untuk rekap
  const [rekapData, setRekapData] = useState([]);
  const [stats, setStats] = useState({
    totalSiswa: 0,
    hadir: 0,
    sakit: 0,
    izin: 0,
    alpha: 0,
    persentase: 0,
    totalHari: 0
  });
  
  const [exportLoading, setExportLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortBy, setSortBy] = useState('nama');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [photoCache, setPhotoCache] = useState({});

  // Cek role
  const rawRole = user?.role || 'siswa';
  const role = rawRole.toString().toLowerCase().trim();
  const isSiswa = role === 'siswa';
  const isDeveloper = role === 'developer';
  const isFullAccess = ['developer', 'admin', 'wakil_kepala'].includes(role);
  const isStaff = ['guru', 'staff_tu'].includes(role);
  const canExport = isFullAccess || isStaff || isDeveloper;

  // ==================== FUNGSI FOTO PROFIL ====================
  const getStudentPhoto = useCallback((studentId, studentName) => {
    if (!studentId) {
      const initial = studentName ? studentName.charAt(0).toUpperCase() : 'U';
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=4caf50&color=fff&size=64&bold=true`;
    }
    
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
      photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=4caf50&color=fff&size=64&bold=true`;
    }
    
    setPhotoCache(prev => ({ ...prev, [studentId]: photoUrl }));
    return photoUrl;
  }, [usersAuth, photoCache]);

  // ==================== FUNGSI PERIODE ====================
  const getDateRange = useCallback((period, customStartDate = null, customEndDate = null) => {
    const now = new Date();
    let start = new Date();
    let end = new Date();
    let label = '';
    
    switch(period) {
      case 'hari':
        start = new Date();
        start.setHours(0, 0, 0, 0);
        end = new Date();
        end.setHours(23, 59, 59, 999);
        label = `Hari Ini (${formatDateIndonesian(start)})`;
        break;
        
      case 'minggu':
        const day = now.getDay();
        const diffToMonday = (day === 0 ? 6 : day - 1);
        start.setDate(now.getDate() - diffToMonday);
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        label = `Minggu Ini (${formatDateIndonesian(start)} - ${formatDateIndonesian(end)})`;
        break;
        
      case 'bulan':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        label = `Bulan Ini (${formatMonthYear(start)})`;
        break;
        
      case 'semester':
        const semester = now.getMonth() < 6 ? 1 : 2;
        if (semester === 1) {
          start = new Date(now.getFullYear(), 0, 1);
          end = new Date(now.getFullYear(), 5, 30);
          label = `Semester Ganjil ${now.getFullYear()}`;
        } else {
          start = new Date(now.getFullYear(), 6, 1);
          end = new Date(now.getFullYear(), 11, 31);
          label = `Semester Genap ${now.getFullYear()}`;
        }
        end.setHours(23, 59, 59, 999);
        break;
        
      case 'tahun':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
        end.setHours(23, 59, 59, 999);
        label = `Tahun ${now.getFullYear()}`;
        break;
        
      case 'pertama':
        label = 'Pertama Kali Absensi';
        return { start: null, end: now, label: label, isFirstTime: true };
        
      case 'custom':
        if (customStartDate && customEndDate) {
          start = new Date(customStartDate);
          end = new Date(customEndDate);
          end.setHours(23, 59, 59, 999);
          label = `Custom (${formatDateIndonesian(start)} - ${formatDateIndonesian(end)})`;
        }
        break;
        
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
        label = 'Periode Default';
    }
    
    return { start, end, label };
  }, []);

  const formatDateIndonesian = (date) => {
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  const formatMonthYear = (date) => {
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  const formatDateShort = (dateStr) => {
    if (!dateStr) return dateStr;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${parts[2]} ${bulan[parseInt(parts[1]) - 1]} ${parts[0]}`;
  };

  const formatDayName = (dateStr) => {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const date = new Date(dateStr);
    return days[date.getDay()];
  };

  const isHoliday = (dateStr) => {
    const date = new Date(dateStr);
    if (date.getDay() === 0) return true;
    return false;
  };

  // ==================== AMBIL DATA DARI FIREBASE ====================
  useEffect(() => {
    let isMounted = true;

    // Ambil data siswa dari 'users'
    const usersRef = ref(db, 'users');
    const unsubscribeUsers = onValue(usersRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const usersList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const student = data[key];
          if (student && student.nama && student.nama !== 'Tidak Diketahui' && student.nama.trim() !== '') {
            usersList.push({ 
              id: key, 
              ...student,
              kelas: student.kelas || '-',
              jurusan: student.jurusan || '-'
            });
          }
        });
      }
      setStudents(usersList);
      
      const kelasSet = new Set();
      const jurusanSet = new Set();
      usersList.forEach(s => {
        if (s.kelas && s.kelas !== '' && s.kelas !== '-') kelasSet.add(s.kelas);
        if (s.jurusan && s.jurusan !== '' && s.jurusan !== '-') jurusanSet.add(s.jurusan);
      });
      
      setKelasOptions(['all', ...Array.from(kelasSet).sort()]);
      setJurusanOptions(['all', ...Array.from(jurusanSet).sort()]);
    });

    // Ambil data users_auth untuk foto profil
    const usersAuthRef = ref(db, 'users_auth');
    const unsubscribeUsersAuth = onValue(usersAuthRef, (snapshot) => {
      if (!isMounted) return;
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

    // Ambil data absensi dari 'absensi'
    const attendanceRef = ref(db, 'absensi');
    const unsubscribeAttendance = onValue(attendanceRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const attendanceList = [];
      
      if (data) {
        Object.keys(data).forEach(date => {
          const dailyRecords = data[date];
          if (dailyRecords && typeof dailyRecords === 'object') {
            Object.keys(dailyRecords).forEach(id => {
              const record = dailyRecords[id];
              if (record && typeof record === 'object') {
                const timeIn = record.in || record.timeIn || record.masuk || record.time_in || null;
                const timeOut = record.out || record.timeOut || record.pulang || record.time_out || null;
                const nama = record.nama || record.name || record.nama_siswa || 'Unknown';
                const kelas = record.kelas || record.class || record.kelas_siswa || '-';
                const jurusan = record.jurusan || record.major || record.jurusan_siswa || '-';
                const status = (timeOut) ? "Pulang" : "Hadir";
                
                if (nama && nama !== 'Tidak Diketahui' && nama.trim() !== '') {
                  attendanceList.push({
                    id: `${date}-${id}`,
                    studentId: id,
                    date: date,
                    timeIn: timeIn,
                    timeOut: timeOut,
                    nama: nama,
                    kelas: kelas,
                    jurusan: jurusan,
                    status: status,
                    timestamp: record.timestamp || Date.now()
                  });
                }
              }
            });
          }
        });
      }
      
      attendanceList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setAttendanceData(attendanceList);
      setLoading(false);
      setError(null);
    }, (error) => {
      console.error('❌ Firebase attendance error:', error);
      setError('Gagal memuat data absensi dari server');
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribeUsers();
      unsubscribeUsersAuth();
      unsubscribeAttendance();
    };
  }, []);

  // ==================== HITUNG REKAP ====================
  const calculateRekap = useCallback(() => {
    if (attendanceData.length === 0 || students.length === 0) {
      return;
    }

    const range = getDateRange(periodType, customStart, customEnd);
    const startDate = range.start;
    const endDate = range.end;
    setPeriodLabel(range.label);

    // Filter students
    let filteredStudents = [...students];
    if (isSiswa && user) {
      filteredStudents = filteredStudents.filter(s => 
        s.kelas === user.kelas && s.jurusan === user.jurusan
      );
    }
    if (filterKelas !== 'all') {
      filteredStudents = filteredStudents.filter(s => s.kelas === filterKelas);
    }
    if (filterJurusan !== 'all') {
      filteredStudents = filteredStudents.filter(s => s.jurusan === filterJurusan);
    }

    // Jika belum pernah absen (pertama kali)
    if (periodType === 'pertama') {
      const rekapList = filteredStudents.map(s => {
        const absenSiswa = attendanceData.filter(a => a.studentId == s.id);
        const firstAttendance = absenSiswa.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        
        if (firstAttendance) {
          return {
            ...s,
            firstDate: firstAttendance.date,
            totalHadir: absenSiswa.filter(a => a.status === 'Hadir' || a.status === 'Pulang').length,
            totalAbsen: absenSiswa.length,
            totalHari: absenSiswa.length,
            hadirCount: absenSiswa.filter(a => a.status === 'Hadir' || a.status === 'Pulang').length,
            sakitCount: 0,
            izinCount: 0,
            alphaCount: 0,
            persentaseKehadiran: absenSiswa.length > 0 ? Math.round((absenSiswa.filter(a => a.status === 'Hadir' || a.status === 'Pulang').length / absenSiswa.length) * 100) : 0,
            details: absenSiswa.map(a => ({
              date: a.date,
              dayName: formatDayName(a.date),
              status: a.status === 'Hadir' || a.status === 'Pulang' ? 'hadir' : 'alpha',
              statusText: a.status,
              statusIcon: a.status === 'Hadir' || a.status === 'Pulang' ? '✅' : '❌',
              timeIn: a.timeIn || '-',
              timeOut: a.timeOut || '-'
            }))
          };
        }
        return { ...s, totalHari: 0, hadirCount: 0, sakitCount: 0, izinCount: 0, alphaCount: 0, persentaseKehadiran: 0, details: [] };
      });
      
      setRekapData(rekapList);
      calculateStats(rekapList);
      return;
    }

    // Untuk periode normal
    if (!startDate || !endDate) {
      setRekapData([]);
      return;
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Generate semua tanggal dalam periode (hari sekolah)
    const allDates = [];
    let currentDate = new Date(startDate);
    const end = new Date(endDate);
    
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0];
      if (!isHoliday(dateStr)) {
        allDates.push(dateStr);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const totalHariSekolah = allDates.length;

    const rekapList = filteredStudents.map(s => {
      const absenSiswa = attendanceData.filter(a => 
        a.studentId == s.id && 
        a.date >= startStr && 
        a.date <= endStr
      );

      const hadirCount = absenSiswa.filter(a => a.status === 'Hadir' || a.status === 'Pulang').length;
      const alphaCount = totalHariSekolah - hadirCount;
      const persentase = totalHariSekolah > 0 ? Math.round((hadirCount / totalHariSekolah) * 100) : 0;

      // Buat daftar detail absensi dengan semua tanggal
      const details = allDates.map(date => {
        const absen = absenSiswa.find(a => a.date === date);
        if (absen) {
          return {
            date: date,
            dayName: formatDayName(date),
            status: absen.status === 'Hadir' || absen.status === 'Pulang' ? 'hadir' : 'alpha',
            statusText: absen.status,
            statusIcon: absen.status === 'Hadir' || absen.status === 'Pulang' ? '✅' : '❌',
            timeIn: absen.timeIn || '-',
            timeOut: absen.timeOut || '-'
          };
        }
        return {
          date: date,
          dayName: formatDayName(date),
          status: 'alpha',
          statusText: 'Tidak Hadir',
          statusIcon: '❌',
          timeIn: '-',
          timeOut: '-'
        };
      });

      return {
        ...s,
        totalHari: totalHariSekolah,
        hadirCount: hadirCount,
        sakitCount: 0,
        izinCount: 0,
        alphaCount: alphaCount > 0 ? alphaCount : 0,
        persentaseKehadiran: persentase,
        photoUrl: getStudentPhoto(s.id, s.nama),
        details: details
      };
    });

    setRekapData(rekapList);
    calculateStats(rekapList);

  }, [attendanceData, students, isSiswa, user, filterKelas, filterJurusan, periodType, customStart, customEnd, getDateRange, getStudentPhoto]);

  const calculateStats = (data) => {
    const totalSiswa = data.length;
    let totalHadir = 0, totalSakit = 0, totalIzin = 0, totalAlpha = 0;
    let totalHariCount = 0;

    data.forEach(s => {
      totalHadir += s.hadirCount || 0;
      totalSakit += s.sakitCount || 0;
      totalIzin += s.izinCount || 0;
      totalAlpha += s.alphaCount || 0;
      totalHariCount += s.totalHari || 0;
    });

    const persentase = totalHariCount > 0 ? Math.round((totalHadir / totalHariCount) * 100) : 0;

    setStats({
      totalSiswa,
      hadir: totalHadir,
      sakit: totalSakit,
      izin: totalIzin,
      alpha: totalAlpha,
      persentase,
      totalHari: totalHariCount
    });
  };

  // ==================== EFFECT UNTUK MENGHITUNG ULANG ====================
  useEffect(() => {
    calculateRekap();
  }, [attendanceData, students, filterKelas, filterJurusan, periodType, customStart, customEnd, calculateRekap]);

  // ==================== SORT & SEARCH ====================
  const sortedRekap = useMemo(() => {
    let result = [...rekapData];
    
    if (searchKeyword.trim() !== '') {
      const keyword = searchKeyword.toLowerCase().trim();
      result = result.filter(s => 
        (s.nama && s.nama.toLowerCase().includes(keyword)) ||
        (s.id && s.id.toString().includes(keyword)) ||
        (s.kelas && s.kelas.toLowerCase().includes(keyword))
      );
    }
    
    result.sort((a, b) => {
      let valA = a[sortBy] ?? '';
      let valB = b[sortBy] ?? '';
      
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    
    return result;
  }, [rekapData, searchKeyword, sortBy, sortOrder]);

  // ==================== EXPORT FUNCTIONS ====================
  const exportToExcel = () => {
    if (!canExport) {
      alert('Anda tidak memiliki akses untuk mengekspor data!');
      return;
    }
    
    if (sortedRekap.length === 0) {
      alert('Tidak ada data untuk diekspor!');
      return;
    }
    
    setExportLoading(true);
    
    try {
      const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      
      let csv = '\uFEFF';
      csv += `"REKAPITULASI ABSENSI SISWA"\n`;
      csv += `"${schoolName}"\n`;
      csv += `"Periode: ${periodLabel}"\n`;
      csv += `"Filter Kelas: ${filterKelas === 'all' ? 'Semua' : filterKelas}"\n`;
      csv += `"Filter Jurusan: ${filterJurusan === 'all' ? 'Semua' : filterJurusan}"\n`;
      csv += `"Tanggal Cetak: ${dateNow} ${timeNow}"\n\n`;
      csv += `"No","Nama Siswa","ID","Kelas","Jurusan","Total Hari","Hadir","Sakit","Izin","Alpha","Persentase Kehadiran"\n`;
      
      sortedRekap.forEach((item, index) => {
        csv += `"${index + 1}","${item.nama || '-'}","${item.id || '-'}","${item.kelas || '-'}","${item.jurusan || '-'}","${item.totalHari || 0}","${item.hadirCount || 0}","${item.sakitCount || 0}","${item.izinCount || 0}","${item.alphaCount || 0}","${item.persentaseKehadiran || 0}%"\n`;
      });
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `rekap_absensi_siswa_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      
      alert('✅ Data berhasil diekspor ke Excel!');
    } catch (error) {
      console.error('Export Excel error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
    } finally {
      setExportLoading(false);
    }
  };

  const exportToPDF = () => {
    if (!canExport) {
      alert('Anda tidak memiliki akses untuk mengekspor data!');
      return;
    }
    
    if (sortedRekap.length === 0) {
      alert('Tidak ada data untuk diekspor!');
      return;
    }
    
    setExportLoading(true);
    
    try {
      const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      const roleName = user?.nama || user?.email || 'Admin';
      
      const printWindow = window.open('', '_blank', 'width=1200,height=900');
      if (!printWindow) {
        alert('Mohon izinkan popup untuk mengekspor PDF!');
        setExportLoading(false);
        return;
      }
      
      // Generate HTML untuk PDF
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Rekap Absensi Siswa - ${schoolName}</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; background: white; }
            .header { text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 3px solid #4caf50; }
            .header h1 { color: #4caf50; font-size: 28px; }
            .header p { color: #666; font-size: 14px; margin-top: 5px; }
            .info { margin-bottom: 20px; padding: 15px 20px; background: #f5f5f5; border-radius: 8px; font-size: 13px; display: flex; flex-wrap: wrap; gap: 20px; }
            .info .label { color: #888; }
            .info .value { font-weight: 600; color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: center; }
            th { background: #4caf50; color: white; font-weight: 600; }
            tr:nth-child(even) { background: #f9f9f9; }
            .text-success { color: #4caf50; font-weight: 600; }
            .text-warning { color: #ff9800; font-weight: 600; }
            .text-danger { color: #f44336; font-weight: 600; }
            .footer { text-align: center; margin-top: 20px; padding-top: 10px; font-size: 10px; color: #888; border-top: 1px solid #ddd; }
            .footer .signature { margin-top: 30px; display: flex; justify-content: flex-end; gap: 60px; }
            .footer .signature div { text-align: center; font-size: 12px; }
            .footer .signature .line { width: 180px; border-top: 1px solid #333; margin-top: 30px; }
            .photo-cell img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
            @media print { .no-print { display: none; } body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>📊 REKAPITULASI ABSENSI SISWA</h1>
            <p>${schoolName}</p>
          </div>
          <div class="info">
            <span><span class="label">📅 Periode:</span> <span class="value">${periodLabel}</span></span>
            <span><span class="label">📚 Kelas:</span> <span class="value">${filterKelas === 'all' ? 'Semua' : filterKelas}</span></span>
            <span><span class="label">🎓 Jurusan:</span> <span class="value">${filterJurusan === 'all' ? 'Semua' : filterJurusan}</span></span>
            <span><span class="label">👥 Total Siswa:</span> <span class="value">${stats.totalSiswa}</span></span>
            <span><span class="label">📊 Rata-rata Kehadiran:</span> <span class="value">${stats.persentase}%</span></span>
            <span><span class="label">👤 Dicetak oleh:</span> <span class="value">${roleName}</span></span>
            <span><span class="label">📅 Tanggal Cetak:</span> <span class="value">${dateNow} ${timeNow}</span></span>
          </div>
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Foto</th>
                <th>Nama</th>
                <th>ID</th>
                <th>Kelas</th>
                <th>Total Hari</th>
                <th>✅ Hadir</th>
                <th>🤒 Sakit</th>
                <th>📝 Izin</th>
                <th>❌ Alpha</th>
                <th>% Kehadiran</th>
              </tr>
            </thead>
            <tbody>
      `;

      sortedRekap.forEach((item, index) => {
        let persentaseColor = 'text-danger';
        if (item.persentaseKehadiran >= 80) persentaseColor = 'text-success';
        else if (item.persentaseKehadiran >= 50) persentaseColor = 'text-warning';
        
        const photoUrl = item.photoUrl || getStudentPhoto(item.id, item.nama);
        
        html += `
          <tr>
            <td>${index + 1}</td>
            <td class="photo-cell"><img src="${photoUrl}" alt="${item.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama ? item.nama.charAt(0).toUpperCase() : 'U')}&background=4caf50&color=fff&size=64&bold=true'" /></td>
            <td>${item.nama || '-'}</td>
            <td>${item.id || '-'}</td>
            <td>${item.kelas || '-'}</td>
            <td>${item.totalHari || 0}</td>
            <td>${item.hadirCount || 0}</td>
            <td>${item.sakitCount || 0}</td>
            <td>${item.izinCount || 0}</td>
            <td>${item.alphaCount || 0}</td>
            <td class="${persentaseColor}">${item.persentaseKehadiran || 0}%</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
          <div class="footer">
            <p>* Laporan ini dihasilkan secara otomatis oleh Sistem Absensi IoT</p>
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
            <button onclick="window.print()" style="padding:12px 28px; background:#4caf50; color:white; border:none; border-radius:8px; cursor:pointer; font-size:16px; margin-right:12px;">🖨️ Cetak / Simpan PDF</button>
            <button onclick="window.close()" style="padding:12px 28px; background:#666; color:white; border:none; border-radius:8px; cursor:pointer; font-size:16px;">✖ Tutup</button>
          </div>
        </body>
        </html>
      `;
      
      printWindow.document.write(html);
      printWindow.document.close();
      
      setTimeout(() => {
        if (printWindow) {
          printWindow.focus();
        }
      }, 500);
      
    } catch (error) {
      console.error('Export PDF error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
    } finally {
      setExportLoading(false);
    }
  };

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // ==================== RENDER DETAIL MODAL ====================
  const openDetailModal = (student) => {
    setSelectedStudent(student);
    setShowDetailModal(true);
  };

  const closeDetailModal = () => {
    setSelectedStudent(null);
    setShowDetailModal(false);
  };

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="rekap-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Memuat data rekap siswa...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rekap-container">
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
    <div className="rekap-container-mobile">
      {/* Header */}
      <div className="rekap-header-mobile">
        <div className="header-left">
          <h1>📊 Rekap Absensi Siswa</h1>
          <p className="header-subtitle">Rekapitulasi kehadiran siswa per periode</p>
        </div>
        {canExport && (
          <div className="header-actions-mobile">
            <button className="btn-export-excel" onClick={exportToExcel} disabled={exportLoading}>
              {exportLoading ? '⏳...' : '📊 Excel'}
            </button>
            <button className="btn-export-pdf" onClick={exportToPDF} disabled={exportLoading}>
              {exportLoading ? '⏳...' : '📄 PDF'}
            </button>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="stats-cards-mobile">
        <div className="stat-card-mobile">
          <span className="stat-number-mobile">{stats.totalSiswa}</span>
          <span className="stat-label-mobile">👥 Siswa</span>
        </div>
        <div className="stat-card-mobile stat-hadir-mobile">
          <span className="stat-number-mobile">{stats.hadir}</span>
          <span className="stat-label-mobile">✅ Hadir</span>
        </div>
        <div className="stat-card-mobile stat-sakit-mobile">
          <span className="stat-number-mobile">{stats.sakit}</span>
          <span className="stat-label-mobile">🤒 Sakit</span>
        </div>
        <div className="stat-card-mobile stat-izin-mobile">
          <span className="stat-number-mobile">{stats.izin}</span>
          <span className="stat-label-mobile">📝 Izin</span>
        </div>
        <div className="stat-card-mobile stat-alpha-mobile">
          <span className="stat-number-mobile">{stats.alpha}</span>
          <span className="stat-label-mobile">❌ Alpha</span>
        </div>
        <div className="stat-card-mobile stat-persen-mobile">
          <span className="stat-number-mobile">{stats.persentase}%</span>
          <span className="stat-label-mobile">📊 Kehadiran</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="progress-container-mobile">
        <div className="progress-label-mobile">
          <span>Rekap Kehadiran Siswa - {periodLabel}</span>
          <span className="progress-percentage-mobile">{stats.persentase}%</span>
        </div>
        <div className="progress-bar-mobile">
          <div className="progress-fill-mobile" style={{ width: `${stats.persentase}%` }}></div>
        </div>
      </div>

      {/* Period & Filters */}
      <div className="filter-container-mobile">
        <div className="filter-group-mobile">
          <label>📅</label>
          <select value={periodType} onChange={(e) => {
            setPeriodType(e.target.value);
            if (e.target.value !== 'custom') {
              setCustomStart('');
              setCustomEnd('');
            }
          }}>
            <option value="hari">Hari Ini</option>
            <option value="minggu">Minggu Ini</option>
            <option value="bulan">Bulan Ini</option>
            <option value="semester">Semester Ini</option>
            <option value="tahun">Tahun Ini</option>
            <option value="pertama">Pertama Kali</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {periodType === 'custom' && (
          <div className="filter-group-mobile custom-range">
            <input 
              type="date" 
              value={customStart} 
              onChange={(e) => setCustomStart(e.target.value)}
              className="date-input-mobile"
            />
            <span>sd</span>
            <input 
              type="date" 
              value={customEnd} 
              onChange={(e) => setCustomEnd(e.target.value)}
              className="date-input-mobile"
            />
          </div>
        )}

        <div className="filter-group-mobile">
          <label>📚</label>
          <select value={filterKelas} onChange={(e) => setFilterKelas(e.target.value)}>
            {kelasOptions.map(k => (
              <option key={k} value={k}>{k === 'all' ? 'Semua Kelas' : k}</option>
            ))}
          </select>
        </div>
        
        <div className="filter-group-mobile">
          <label>🎓</label>
          <select value={filterJurusan} onChange={(e) => setFilterJurusan(e.target.value)}>
            {jurusanOptions.map(j => (
              <option key={j} value={j}>{j === 'all' ? 'Semua Jurusan' : j}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Search & Sort */}
      <div className="rekap-controls-mobile">
        <div className="search-box-mobile">
          <input
            type="text"
            placeholder="🔍 Cari nama, ID, atau kelas..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="search-input-mobile"
          />
          {searchKeyword && (
            <button className="search-clear-mobile" onClick={() => setSearchKeyword('')}>✖</button>
          )}
        </div>
        <div className="sort-controls-mobile">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-select-mobile">
            <option value="nama">Nama</option>
            <option value="kelas">Kelas</option>
            <option value="hadirCount">Hadir</option>
            <option value="persentaseKehadiran">Persentase</option>
            <option value="totalHari">Total Hari</option>
          </select>
          <button 
            className="sort-order-mobile" 
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            title={sortOrder === 'asc' ? 'Urutkan naik' : 'Urutkan turun'}
          >
            {sortOrder === 'asc' ? '⬆' : '⬇'}
          </button>
        </div>
      </div>

      {/* Rekap Table dengan Foto Profil */}
      <div className="rekap-table-container-mobile">
        <div className="rekap-info-mobile">
          <span>📊 Menampilkan {sortedRekap.length} dari {rekapData.length} siswa</span>
          <span className="period-label-mobile">📅 {periodLabel}</span>
        </div>

        {sortedRekap.length === 0 ? (
          <div className="empty-state-mobile">
            <span className="empty-icon-mobile">📭</span>
            <h3>Tidak Ada Data</h3>
            <p>
              {searchKeyword 
                ? `Tidak ada siswa yang cocok dengan pencarian "${searchKeyword}"` 
                : 'Tidak ada siswa yang ditemukan dengan filter ini'}
            </p>
          </div>
        ) : (
          <div className="rekap-table-wrapper-mobile">
            <table className="rekap-table-mobile">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Foto</th>
                  <th className="sortable" onClick={() => toggleSort('nama')}>
                    Nama {sortBy === 'nama' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>ID</th>
                  <th className="sortable" onClick={() => toggleSort('kelas')}>
                    Kelas {sortBy === 'kelas' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="sortable" onClick={() => toggleSort('totalHari')}>
                    Total {sortBy === 'totalHari' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="sortable" onClick={() => toggleSort('hadirCount')}>
                    ✅ {sortBy === 'hadirCount' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>🤒</th>
                  <th>📝</th>
                  <th>❌</th>
                  <th className="sortable" onClick={() => toggleSort('persentaseKehadiran')}>
                    % {sortBy === 'persentaseKehadiran' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {sortedRekap.map((item, index) => {
                  let persentaseColor = 'text-danger';
                  if (item.persentaseKehadiran >= 80) persentaseColor = 'text-success';
                  else if (item.persentaseKehadiran >= 50) persentaseColor = 'text-warning';
                  
                  const photoUrl = item.photoUrl || getStudentPhoto(item.id, item.nama);
                  
                  return (
                    <tr key={item.id || index}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="student-avatar-cell">
                          <img 
                            src={photoUrl} 
                            alt={item.nama}
                            className="student-avatar-img"
                            onError={(e) => {
                              const initial = item.nama ? item.nama.charAt(0).toUpperCase() : 'U';
                              e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=4caf50&color=fff&size=64&bold=true`;
                            }}
                          />
                        </div>
                      </td>
                      <td className="student-name-cell">{item.nama || '-'}</td>
                      <td>#{item.id || '-'}</td>
                      <td>{item.kelas || '-'}</td>
                      <td>{item.totalHari || 0}</td>
                      <td>{item.hadirCount || 0}</td>
                      <td>{item.sakitCount || 0}</td>
                      <td>{item.izinCount || 0}</td>
                      <td>{item.alphaCount || 0}</td>
                      <td className={persentaseColor}>{item.persentaseKehadiran || 0}%</td>
                      <td>
                        <button 
                          className="btn-detail-mobile"
                          onClick={() => openDetailModal(item)}
                          title="Lihat detail"
                        >
                          📋
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="rekap-footer-mobile">
        <p className="footer-info-mobile">
          📌 Rekapitulasi absensi <strong>siswa</strong> dari database <code>absensi</code>
          <span className="footer-period-mobile"> • 📅 {periodLabel}</span>
          <span className="footer-total-mobile"> • 👥 {stats.totalSiswa} siswa</span>
          <span className="footer-hadir-mobile"> • ✅ {stats.hadir} hadir</span>
        </p>
      </div>

      {/* Detail Modal dengan Foto dan Daftar Tanggal */}
      {showDetailModal && selectedStudent && (
        <div className="modal-overlay-mobile" onClick={closeDetailModal}>
          <div className="modal-box-mobile" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-mobile">
              <div className="modal-header-left">
                <span className="modal-icon">📋</span>
                <h3>Detail Rekap {selectedStudent.nama}</h3>
              </div>
              <button className="modal-close-mobile" onClick={closeDetailModal}>✖</button>
            </div>
            <div className="modal-body-mobile">
              <div className="modal-student-info-mobile">
                <div className="modal-avatar-mobile">
                  <img 
                    src={selectedStudent.photoUrl || getStudentPhoto(selectedStudent.id, selectedStudent.nama)}
                    alt={selectedStudent.nama}
                    onError={(e) => {
                      const initial = selectedStudent.nama ? selectedStudent.nama.charAt(0).toUpperCase() : 'U';
                      e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=4caf50&color=fff&size=100&bold=true`;
                    }}
                  />
                </div>
                <div className="modal-student-text">
                  <div className="modal-name-mobile">{selectedStudent.nama}</div>
                  <div className="modal-id-mobile">🆔 ID: {selectedStudent.id}</div>
                  <div className="modal-class-mobile">📚 {selectedStudent.kelas || '-'} | 🎓 {selectedStudent.jurusan || '-'}</div>
                  <div className="modal-period-mobile">📅 {periodLabel}</div>
                </div>
              </div>

              <div className="modal-stats-mobile">
                <div className="modal-stat-item">
                  <span className="modal-stat-number">{selectedStudent.totalHari || 0}</span>
                  <span className="modal-stat-label">Total Hari</span>
                </div>
                <div className="modal-stat-item stat-hadir">
                  <span className="modal-stat-number">{selectedStudent.hadirCount || 0}</span>
                  <span className="modal-stat-label">✅ Hadir</span>
                </div>
                <div className="modal-stat-item stat-sakit">
                  <span className="modal-stat-number">{selectedStudent.sakitCount || 0}</span>
                  <span className="modal-stat-label">🤒 Sakit</span>
                </div>
                <div className="modal-stat-item stat-izin">
                  <span className="modal-stat-number">{selectedStudent.izinCount || 0}</span>
                  <span className="modal-stat-label">📝 Izin</span>
                </div>
                <div className="modal-stat-item stat-alpha">
                  <span className="modal-stat-number">{selectedStudent.alphaCount || 0}</span>
                  <span className="modal-stat-label">❌ Alpha</span>
                </div>
                <div className="modal-stat-item stat-persen">
                  <span className="modal-stat-number">{selectedStudent.persentaseKehadiran || 0}%</span>
                  <span className="modal-stat-label">📊 Kehadiran</span>
                </div>
              </div>

              <div className="modal-summary-mobile">
                <div className="summary-item">
                  <span className="summary-label">Total Kehadiran:</span>
                  <span className="summary-value">{selectedStudent.hadirCount} / {selectedStudent.totalHari} hari</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Persentase:</span>
                  <span className="summary-value" style={{ 
                    color: selectedStudent.persentaseKehadiran >= 80 ? '#4caf50' : 
                           selectedStudent.persentaseKehadiran >= 50 ? '#ff9800' : '#f44336' 
                  }}>
                    {selectedStudent.persentaseKehadiran}%
                  </span>
                </div>
              </div>

              {selectedStudent.details && selectedStudent.details.length > 0 && (
                <div className="modal-details-mobile">
                  <h4>📅 Detail Harian (Periode {periodLabel})</h4>
                  <div className="modal-details-scroll">
                    {selectedStudent.details.map((d, i) => (
                      <div key={i} className={`modal-detail-item ${d.status === 'hadir' ? 'hadir' : 'alpha'}`}>
                        <span className="modal-detail-date">{formatDateShort(d.date)}</span>
                        <span className="modal-detail-day">{d.dayName}</span>
                        <span className="modal-detail-status" style={{ color: d.status === 'hadir' ? '#4caf50' : '#f44336' }}>
                          {d.statusIcon} {d.statusText}
                        </span>
                        <span className="modal-detail-time">⏰ {d.timeIn} {d.timeOut && `→ ${d.timeOut}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer-mobile">
              <button className="btn-close-modal-mobile" onClick={closeDetailModal}>Tutup</button>
              {canExport && (
                <button 
                  className="btn-print-detail-mobile" 
                  onClick={() => {
                    const printWindow = window.open('', '_blank');
                    if (!printWindow) {
                      alert('Mohon izinkan popup untuk mencetak!');
                      return;
                    }
                    
                    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
                    let detailHtml = `
                      <!DOCTYPE html>
                      <html>
                      <head><title>Detail Rekap ${selectedStudent.nama}</title>
                      <style>
                        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; }
                        .header { text-align: center; border-bottom: 2px solid #4caf50; padding-bottom: 15px; }
                        .header h1 { color: #4caf50; }
                        .info { margin: 15px 0; padding: 15px; background: #f5f5f5; border-radius: 8px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: center; }
                        th { background: #4caf50; color: white; }
                        .hadir { color: #4caf50; font-weight: bold; }
                        .alpha { color: #f44336; font-weight: bold; }
                        .footer { margin-top: 20px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
                      </style>
                      </head>
                      <body>
                        <div class="header">
                          <h1>📋 Detail Rekap Absensi</h1>
                          <p>${schoolName}</p>
                        </div>
                        <div class="info">
                          <p><strong>Nama:</strong> ${selectedStudent.nama}</p>
                          <p><strong>ID:</strong> ${selectedStudent.id}</p>
                          <p><strong>Kelas:</strong> ${selectedStudent.kelas || '-'} | <strong>Jurusan:</strong> ${selectedStudent.jurusan || '-'}</p>
                          <p><strong>Periode:</strong> ${periodLabel}</p>
                          <p><strong>Total Hari:</strong> ${selectedStudent.totalHari || 0}</p>
                          <p><strong>Hadir:</strong> ${selectedStudent.hadirCount || 0} | <strong>Persentase:</strong> ${selectedStudent.persentaseKehadiran || 0}%</p>
                        </div>
                        <table>
                          <thead>
                            <tr><th>No</th><th>Tanggal</th><th>Hari</th><th>Status</th><th>Jam Masuk</th><th>Jam Pulang</th></tr>
                          </thead>
                          <tbody>
                    `;
                    
                    selectedStudent.details.forEach((d, idx) => {
                      detailHtml += `
                        <tr>
                          <td>${idx + 1}</td>
                          <td>${formatDateShort(d.date)}</td>
                          <td>${d.dayName}</td>
                          <td class="${d.status === 'hadir' ? 'hadir' : 'alpha'}">${d.statusIcon} ${d.statusText}</td>
                          <td>${d.timeIn}</td>
                          <td>${d.timeOut || '-'}</td>
                        </tr>
                      `;
                    });
                    
                    detailHtml += `
                          </tbody>
                        </table>
                        <div class="footer">
                          <p>Dicetak pada: ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}</p>
                          <p>Sistem Absensi IoT</p>
                        </div>
                        <div style="text-align:center; margin-top:20px;">
                          <button onclick="window.print()" style="padding:10px 24px; background:#4caf50; color:white; border:none; border-radius:6px; cursor:pointer;">🖨️ Cetak</button>
                          <button onclick="window.close()" style="padding:10px 24px; background:#666; color:white; border:none; border-radius:6px; cursor:pointer; margin-left:10px;">✖ Tutup</button>
                        </div>
                      </body>
                      </html>
                    `;
                    printWindow.document.write(detailHtml);
                    printWindow.document.close();
                  }}
                >
                  🖨️ Cetak Detail
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RekapTab;