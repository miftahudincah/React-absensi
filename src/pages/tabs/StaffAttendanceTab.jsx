// src/pages/tabs/StaffAttendanceTab.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ref, onValue, set, remove, update, get } from 'firebase/database';
import { db } from '../../firebase/config';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, PointElement, LineElement, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import './StaffAttendanceTab.css';

// Register ChartJS components
ChartJS.register(
  ArcElement, Tooltip, Legend, CategoryScale, LinearScale,
  BarElement, Title, PointElement, LineElement, Filler
);

const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const StaffAttendanceTab = ({ user }) => {
  const [attendanceData, setAttendanceData] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [usersAuth, setUsersAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterDate, setFilterDate] = useState('all');
  const [filterJabatan, setFilterJabatan] = useState('all');
  const [filterDepartemen, setFilterDepartemen] = useState('all');
  const [photoCache, setPhotoCache] = useState({});
  const [chartAnimated, setChartAnimated] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState({ sending: false, lastResult: null });
  
  // State untuk simulasi absen staff
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simulateType, setSimulateType] = useState('in');
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [searchStaff, setSearchStaff] = useState('');
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [jabatanOptions, setJabatanOptions] = useState(['all']);
  const [departemenOptions, setDepartemenOptions] = useState(['all']);

  // Cek role
  const rawRole = user?.role || 'siswa';
  const role = rawRole.toString().toLowerCase().trim();
  
  const isFullAccess = ['developer', 'admin', 'wakil_kepala'].includes(role);
  const isStaff = ['guru', 'staff_tu'].includes(role);
  const canSimulate = isFullAccess;
  const canView = isFullAccess || isStaff;
  const canExport = !isStaff;
  const isDeveloper = role === 'developer';

  // ==================== GET STAFF PHOTO ====================
  const getStaffPhoto = (staffId, staffName) => {
    if (photoCache[staffId]) {
      return photoCache[staffId];
    }
    
    const userAuth = usersAuth.find(u => u.staffId == staffId || u.uid == staffId);
    
    let photoUrl;
    if (userAuth && userAuth.photoUrl && userAuth.photoUrl !== 'null' && userAuth.photoUrl !== 'undefined') {
      const separator = userAuth.photoUrl.includes('?') ? '&' : '?';
      photoUrl = userAuth.photoUrl + separator + 't=' + Date.now();
    } else {
      const initial = staffName ? staffName.charAt(0).toUpperCase() : 'S';
      photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=ff9800&color=fff&size=64&bold=true`;
    }
    
    setPhotoCache(prev => ({ ...prev, [staffId]: photoUrl }));
    return photoUrl;
  };

  // ==================== GET STAFF PHONE NUMBER ====================
  const getStaffPhoneNumber = (staff) => {
    if (!staff) return null;
    
    if (staff.noHp && staff.noHp !== '-' && staff.noHp !== '') {
      return staff.noHp;
    }
    
    const userAuth = usersAuth.find(u => u.staffId == staff.id || u.uid == staff.id);
    if (userAuth?.noHp && userAuth.noHp !== '-' && userAuth.noHp !== '') {
      return userAuth.noHp;
    }
    if (userAuth?.phoneNumber && userAuth.phoneNumber !== '-' && userAuth.phoneNumber !== '') {
      return userAuth.phoneNumber;
    }
    
    return null;
  };

  // ==================== SEND WHATSAPP NOTIFICATION ====================
  const sendWhatsAppNotification = async (phoneNumber, message, type) => {
    if (!phoneNumber || phoneNumber === '-' || phoneNumber === '') {
      setWhatsappStatus({ sending: false, lastResult: { success: false, error: 'No phone number' } });
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
  };

  // ==================== SEND STAFF CHECK-IN NOTIFICATION ====================
  const sendStaffCheckInNotification = async (staff, time, isLate) => {
    const phoneNumber = getStaffPhoneNumber(staff);
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
    
    const message = `*📋 NOTIFIKASI ABSENSI STAFF - ${schoolName}*

👤 *Staff:* ${staff.nama}
🆔 *ID:* ${staff.id}
📋 *Jabatan:* ${staff.jabatan || '-'}
🏢 *Departemen:* ${staff.departemen || '-'}
📅 *Tanggal:* ${dateStr}
🕐 *Jam Masuk:* ${time} WIB
${isLate ? '⚠️ *Status: TERLAMBAT*' : '✅ *Status: TEPAT WAKTU*'}

--- 
📱 *Sistem Absensi IoT*
🔔 Notifikasi ini dikirim secara otomatis.`;

    return await sendWhatsAppNotification(phoneNumber, message, 'staff_check_in');
  };

  // ==================== SEND STAFF CHECK-OUT NOTIFICATION ====================
  const sendStaffCheckOutNotification = async (staff, timeIn, timeOut) => {
    const phoneNumber = getStaffPhoneNumber(staff);
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
    
    const message = `*🏠 NOTIFIKASI ABSENSI PULANG STAFF - ${schoolName}*

👤 *Staff:* ${staff.nama}
🆔 *ID:* ${staff.id}
📋 *Jabatan:* ${staff.jabatan || '-'}
🏢 *Departemen:* ${staff.departemen || '-'}
📅 *Tanggal:* ${dateStr}
🕐 *Jam Masuk:* ${timeIn} WIB
🏠 *Jam Pulang:* ${timeOut} WIB

✅ *Staff sudah pulang.*

--- 
📱 *Sistem Absensi IoT*
🔔 Notifikasi ini dikirim secara otomatis.`;

    return await sendWhatsAppNotification(phoneNumber, message, 'staff_check_out');
  };

  // ==================== SEND STAFF REMINDER NOTIFICATION ====================
  const sendStaffReminderNotification = async (staff) => {
    const phoneNumber = getStaffPhoneNumber(staff);
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
    
    const message = `*🔔 PENGINGAT ABSENSI STAFF - ${schoolName}*

👤 *Staff:* ${staff.nama}
🆔 *ID:* ${staff.id}
📋 *Jabatan:* ${staff.jabatan || '-'}
🏢 *Departemen:* ${staff.departemen || '-'}
📅 *Tanggal:* ${dateStr}
⏰ *Waktu:* ${timeStr} WIB

⚠️ *Anda belum melakukan absensi masuk hari ini!*
Segera lakukan absensi melalui sistem.

--- 
📱 *Sistem Absensi IoT*
🔔 Ini adalah pengingat otomatis.`;

    return await sendWhatsAppNotification(phoneNumber, message, 'staff_reminder');
  };

  // ==================== SEND BULK REMINDER STAFF ====================
  const sendBulkReminderStaff = async () => {
    if (!canSimulate) {
      alert('⚠️ Anda tidak memiliki akses untuk mengirim pengingat!');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    
    const checkedInIds = new Set();
    attendanceData
      .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
      .forEach(a => checkedInIds.add(a.staffId));

    const absentStaff = filteredStaff.filter(s => !checkedInIds.has(s.id));

    if (absentStaff.length === 0) {
      alert('✅ Semua staff sudah absen hari ini!');
      return;
    }

    if (!window.confirm(`⚠️ Kirim pengingat WhatsApp ke ${absentStaff.length} staff yang belum absen hari ini?`)) {
      return;
    }

    setWhatsappStatus({ sending: true, lastResult: null });
    let successCount = 0;
    let failCount = 0;

    for (const staff of absentStaff) {
      const result = await sendStaffReminderNotification(staff);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setWhatsappStatus({ 
      sending: false, 
      lastResult: { 
        success: true, 
        message: `✅ Terkirim: ${successCount}, Gagal: ${failCount}` 
      } 
    });

    alert(`✅ Pengingat terkirim!\n\n📨 Berhasil: ${successCount}\n❌ Gagal: ${failCount}`);

    if (typeof window.logActivity === 'function') {
      window.logActivity('send_bulk_reminder_staff', `Mengirim pengingat WhatsApp ke ${successCount} staff`);
    }
  };

  // ==================== EXPORT FUNCTIONS ====================
  const exportToExcel = () => {
    if (!canExport) {
      alert('Anda tidak memiliki akses untuk mengekspor data!');
      return;
    }
    
    setExportLoading(true);
    
    try {
      const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      const periodText = getPeriodText();
      
      let csv = '\uFEFF';
      csv += `"LAPORAN ABSENSI STAFF"\n`;
      csv += `"${schoolName}"\n`;
      csv += `"Periode: ${periodText}"\n`;
      csv += `"Filter Jabatan: ${filterJabatan === 'all' ? 'Semua' : filterJabatan}"\n`;
      csv += `"Filter Departemen: ${filterDepartemen === 'all' ? 'Semua' : filterDepartemen}"\n`;
      csv += `"Tanggal Cetak: ${dateNow} ${timeNow}"\n\n`;
      csv += `"No","Tanggal","Waktu Masuk","Waktu Pulang","ID","Nama","Jabatan","Departemen","Status","No HP"\n`;
      
      filteredData.forEach((item, index) => {
        const staff = staffList.find(s => s.id == item.staffId);
        const noHp = getStaffPhoneNumber(staff) || item.noHp || '-';
        const status = item.status === 'Pulang' ? 'Pulang' : (item.timeIn > '07:30' ? 'Terlambat' : 'Hadir');
        csv += `"${index + 1}","${item.date}","${item.timeIn || '-'}","${item.timeOut || '-'}","${item.staffId}","${item.nama}","${item.jabatan || '-'}","${item.departemen || '-'}","${status}","${noHp}"\n`;
      });
      
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `absensi_staff_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      
      alert('✅ Data berhasil diekspor ke Excel!');
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('export_staff_attendance_excel', `Ekspor absensi staff ke Excel - ${filteredData.length} data`);
      }
    } catch (error) {
      console.error('Export Excel error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
    } finally {
      setExportLoading(false);
    }
  };

  const getPeriodText = () => {
    if (filterDate === 'all') return 'Semua Data';
    if (filterDate === 'today') return 'Hari Ini';
    if (filterDate === 'this_week') return 'Minggu Ini';
    if (filterDate === 'this_month') return 'Bulan Ini';
    return filterDate;
  };

  const exportToPDF = () => {
    if (!canExport) {
      alert('Anda tidak memiliki akses untuk mengekspor data!');
      return;
    }
    
    setExportLoading(true);
    
    try {
      const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
      const dateNow = new Date().toLocaleDateString('id-ID');
      const timeNow = new Date().toLocaleTimeString('id-ID');
      const periodText = getPeriodText();
      const roleName = user?.nama || user?.email || 'Admin';
      
      const totalStaff = filteredStaff.length;
      const hadirSet = new Set();
      const pulangSet = new Set();
      filteredData.forEach(item => {
        if (item.status === 'Hadir' || item.status === 'Pulang') {
          hadirSet.add(item.staffId);
        }
        if (item.status === 'Pulang') {
          pulangSet.add(item.staffId);
        }
      });
      const hadir = hadirSet.size;
      const pulang = pulangSet.size;
      const persentase = totalStaff > 0 ? Math.round((hadir / totalStaff) * 100) : 0;
      
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Laporan Absensi Staff - ${schoolName}</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; background: white; }
            .header { text-align: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #ff9800; }
            .header h1 { color: #ff9800; font-size: 24px; }
            .header p { color: #666; font-size: 13px; margin-top: 4px; }
            .info { margin-bottom: 20px; padding: 12px 16px; background: #f5f5f5; border-radius: 8px; font-size: 13px; display: flex; flex-wrap: wrap; gap: 20px; }
            .info .label { color: #888; }
            .info .value { font-weight: 600; color: #333; }
            .stats-summary { display: flex; gap: 20px; margin-bottom: 15px; flex-wrap: wrap; }
            .stats-summary .stat-box { background: #fff3e0; padding: 10px 20px; border-radius: 8px; border-left: 4px solid #ff9800; flex: 1; min-width: 100px; }
            .stats-summary .stat-box .num { font-size: 20px; font-weight: 700; color: #ff9800; }
            .stats-summary .stat-box .lbl { font-size: 11px; color: #888; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: center; }
            th { background: #ff9800; color: white; font-weight: 600; }
            tr:nth-child(even) { background: #f9f9f9; }
            .status-hadir { color: #4caf50; font-weight: 600; }
            .status-pulang { color: #ff9800; font-weight: 600; }
            .status-terlambat { color: #f44336; font-weight: 600; }
            .wa-column { color: #25d366; }
            .footer { text-align: center; margin-top: 20px; padding-top: 10px; font-size: 10px; color: #888; border-top: 1px solid #ddd; }
            .footer .signature { margin-top: 20px; display: flex; justify-content: flex-end; gap: 60px; }
            .footer .signature div { text-align: center; font-size: 12px; }
            .footer .signature .line { width: 150px; border-top: 1px solid #333; margin-top: 30px; }
            @media print { .no-print { display: none; } body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>👔 LAPORAN ABSENSI STAFF</h1>
            <p>${schoolName}</p>
          </div>
          <div class="info">
            <span><span class="label">📅 Periode:</span> <span class="value">${periodText}</span></span>
            <span><span class="label">📋 Jabatan:</span> <span class="value">${filterJabatan === 'all' ? 'Semua' : filterJabatan}</span></span>
            <span><span class="label">🏢 Departemen:</span> <span class="value">${filterDepartemen === 'all' ? 'Semua' : filterDepartemen}</span></span>
            <span><span class="label">👥 Total Data:</span> <span class="value">${filteredData.length}</span></span>
            <span><span class="label">👤 Dicetak oleh:</span> <span class="value">${roleName}</span></span>
            <span><span class="label">📅 Tanggal Cetak:</span> <span class="value">${dateNow} ${timeNow}</span></span>
          </div>
          <div class="stats-summary">
            <div class="stat-box">
              <div class="num">${totalStaff}</div>
              <div class="lbl">👥 Total Staff</div>
            </div>
            <div class="stat-box">
              <div class="num">${hadir}</div>
              <div class="lbl">✅ Hadir</div>
            </div>
            <div class="stat-box">
              <div class="num">${pulang}</div>
              <div class="lbl">🏠 Pulang</div>
            </div>
            <div class="stat-box">
              <div class="num">${persentase}%</div>
              <div class="lbl">📊 Kehadiran</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Tanggal</th>
                <th>Waktu Masuk</th>
                <th>Waktu Pulang</th>
                <th>ID</th>
                <th>Nama Staff</th>
                <th>Jabatan</th>
                <th>Departemen</th>
                <th>Status</th>
                <th class="wa-column">📱 No HP</th>
              </tr>
            </thead>
            <tbody>
      `);
      
      filteredData.forEach((item, index) => {
        const staff = staffList.find(s => s.id == item.staffId);
        const noHp = getStaffPhoneNumber(staff) || item.noHp || '-';
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
            <td>${item.staffId}</td>
            <td>${item.nama}</td>
            <td>${item.jabatan || '-'}</td>
            <td>${item.departemen || '-'}</td>
            <td class="${statusClass}">${statusText}</td>
            <td class="wa-column">${noHp}</td>
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
                <p>Kepala TU</p>
              </div>
            </div>
          </div>
          <div class="no-print" style="text-align:center; margin-top:20px;">
            <button onclick="window.print()" style="padding:10px 24px; background:#ff9800; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; margin-right:10px;">🖨️ Cetak / Simpan PDF</button>
            <button onclick="window.close()" style="padding:10px 24px; background:#666; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px;">✖ Tutup</button>
          </div>
        </body>
        </html>
      `);
      printWindow.document.close();
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('export_staff_attendance_pdf', `Ekspor absensi staff ke PDF - ${filteredData.length} data`);
      }
    } catch (error) {
      console.error('Export PDF error:', error);
      alert('❌ Gagal mengekspor data: ' + error.message);
    } finally {
      setExportLoading(false);
    }
  };

  // ==================== DELETE ALL STAFF ATTENDANCE ====================
  const deleteAllStaffAttendance = async () => {
    if (!isDeveloper) {
      alert('❌ Akses ditolak! Hanya role Developer yang dapat menghapus semua data.');
      return;
    }

    const totalData = filteredData.length;
    if (totalData === 0) {
      alert('📭 Tidak ada data absensi staff yang dapat dihapus.');
      return;
    }

    let filterDesc = '';
    if (filterJabatan !== 'all' && filterDepartemen !== 'all') {
      filterDesc = `Jabatan ${filterJabatan} & Departemen ${filterDepartemen}`;
    } else if (filterJabatan !== 'all') {
      filterDesc = `Jabatan ${filterJabatan}`;
    } else if (filterDepartemen !== 'all') {
      filterDesc = `Departemen ${filterDepartemen}`;
    } else if (filterDate !== 'all') {
      filterDesc = `Tanggal ${filterDate}`;
    } else {
      filterDesc = 'SEMUA DATA';
    }

    const confirmMessage = `⚠️ PERINGATAN!\n\nAnda akan menghapus SEMUA data absensi staff (${totalData} data) dari database.\n\n📌 Filter: ${filterDesc}\n\nTindakan ini TIDAK DAPAT DIURUNGKAN!\n\nKetik "HAPUS SEMUA" untuk melanjutkan:`;
    
    const userInput = prompt(confirmMessage);
    if (userInput !== 'HAPUS SEMUA') {
      alert('❌ Penghapusan dibatalkan.');
      return;
    }

    if (!window.confirm(`⚠️ KONFIRMASI FINAL!\n\nApakah Anda YAKIN ingin menghapus ${totalData} data absensi staff secara permanen?`)) {
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
        const dateRef = ref(db, `staff_attendance/${date}`);
        await remove(dateRef);
        deletedCount += filteredData.filter(item => item.date === date).length;
      }

      setAttendanceData(prev => prev.filter(item => !dates.has(item.date)));

      alert(`✅ Berhasil menghapus ${deletedCount} data absensi staff dari ${dateArray.length} tanggal!\n\n📌 Filter: ${filterDesc}`);

      if (typeof window.logActivity === 'function') {
        window.logActivity('delete_all_staff_attendance', `Menghapus semua absensi staff - ${deletedCount} data dari ${dateArray.length} tanggal (Filter: ${filterDesc})`);
      }

    } catch (error) {
      console.error('Delete all error:', error);
      alert('❌ Gagal menghapus semua data: ' + error.message);
    } finally {
      setDeleteAllLoading(false);
    }
  };

  // ==================== AMBIL DATA DARI FIREBASE ====================
  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const staffRef = ref(db, 'staff');
    const unsubscribeStaff = onValue(staffRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const staffListData = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const staff = data[key];
          // ⭐ EXCLUDE DEVELOPER FROM STAFF LIST ⭐
          if (staff && staff.nama && staff.nama.trim() !== '' && staff.jabatan !== 'developer') {
            staffListData.push({ id: key, ...staff });
          }
        });
      }
      setStaffList(staffListData);
      
      const jabatanSet = new Set();
      const departemenSet = new Set();
      staffListData.forEach(s => {
        if (s.jabatan && s.jabatan !== '' && s.jabatan !== 'developer') jabatanSet.add(s.jabatan);
        if (s.departemen && s.departemen !== '' && s.departemen !== '-') departemenSet.add(s.departemen);
      });
      
      setJabatanOptions(['all', ...Array.from(jabatanSet).sort()]);
      setDepartemenOptions(['all', ...Array.from(departemenSet).sort()]);
    });

    const usersAuthRef = ref(db, 'users_auth');
    const unsubscribeUsersAuth = onValue(usersAuthRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const authList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const auth = data[key];
          // ⭐ EXCLUDE DEVELOPER FROM USERS_AUTH ⭐
          if (auth && auth.role !== 'developer') {
            authList.push({ uid: key, ...auth });
          }
        });
      }
      setUsersAuth(authList);
      setPhotoCache({});
    });

    const attendanceRef = ref(db, 'staff_attendance');
    const unsubscribeAttendance = onValue(attendanceRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const attendanceList = [];
      if (data) {
        Object.keys(data).forEach(date => {
          const dailyRecords = data[date];
          if (dailyRecords) {
            Object.keys(dailyRecords).forEach(id => {
              const record = dailyRecords[id];
              if (record) {
                // ⭐ EXCLUDE DEVELOPER ATTENDANCE ⭐
                if (record.jabatan && record.jabatan === 'developer') return;
                
                attendanceList.push({
                  id: date + "-" + id,
                  staffId: id,
                  date: date,
                  timeIn: record.timeIn,
                  timeOut: record.timeOut,
                  nama: record.nama,
                  jabatan: record.jabatan,
                  departemen: record.departemen || '-',
                  status: record.timeOut ? "Pulang" : "Hadir",
                  timestamp: record.timestamp || Date.now(),
                  noHp: record.noHp || null
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
      console.error('Firebase staff attendance error:', error);
      setError('Gagal memuat data absensi staff dari server');
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribeStaff();
      unsubscribeUsersAuth();
      unsubscribeAttendance();
    };
  }, [canView]);

  // ==================== FILTER & STATS ====================
  const filteredData = useMemo(() => {
    let data = [...attendanceData];
    
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    if (filterDate === 'today') {
      data = data.filter(a => a.date === today);
    } else if (filterDate === 'this_week') {
      const startStr = startOfWeek.toISOString().split('T')[0];
      const endStr = endOfWeek.toISOString().split('T')[0];
      data = data.filter(a => a.date >= startStr && a.date <= endStr);
    } else if (filterDate === 'this_month') {
      const startStr = startOfMonth.toISOString().split('T')[0];
      const endStr = endOfMonth.toISOString().split('T')[0];
      data = data.filter(a => a.date >= startStr && a.date <= endStr);
    } else if (filterDate !== 'all') {
      data = data.filter(a => a.date === filterDate);
    }
    
    if (filterJabatan !== 'all') {
      data = data.filter(a => a.jabatan === filterJabatan);
    }
    
    if (filterDepartemen !== 'all') {
      data = data.filter(a => a.departemen === filterDepartemen);
    }
    
    return data;
  }, [attendanceData, filterDate, filterJabatan, filterDepartemen]);

  const filteredStaff = useMemo(() => {
    let result = [...staffList];
    
    if (filterJabatan !== 'all') {
      result = result.filter(s => s.jabatan === filterJabatan);
    }
    
    if (filterDepartemen !== 'all') {
      result = result.filter(s => s.departemen === filterDepartemen);
    }
    
    return result;
  }, [staffList, filterJabatan, filterDepartemen]);

  const stats = useMemo(() => {
    const totalStaff = filteredStaff.length;
    const hadirSet = new Set();
    const pulangSet = new Set();
    
    filteredData.forEach(item => {
      if (item.status === 'Hadir' || item.status === 'Pulang') {
        hadirSet.add(item.staffId);
      }
      if (item.status === 'Pulang') {
        pulangSet.add(item.staffId);
      }
    });
    
    const hadir = hadirSet.size;
    const pulang = pulangSet.size;
    const totalTransaksi = filteredData.length;
    const persentase = totalStaff > 0 ? Math.round((hadir / totalStaff) * 100) : 0;
    
    return { hadir, pulang, totalTransaksi, totalStaff, persentase };
  }, [filteredData, filteredStaff]);

  // ==================== CHART DATA ====================
  const donutData = {
    labels: ['Hadir', 'Tidak Hadir'],
    datasets: [{
      data: [stats.hadir, stats.totalStaff - stats.hadir],
      backgroundColor: ['#ff9800', '#f44336'],
      borderWidth: 0,
      hoverOffset: 10
    }]
  };

  const donutOptions = {
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
            return `${context.label}: ${context.parsed} staff (${percentage}%)`;
          }
        }
      }
    },
    animation: {
      animateRotate: true,
      duration: 1500,
      easing: 'easeInOutQuart'
    }
  };

  const jabatanChartData = useMemo(() => {
    const jabatanMap = new Map();
    
    filteredStaff.forEach(s => {
      const jabatan = s.jabatan || 'Tanpa Jabatan';
      if (!jabatanMap.has(jabatan)) {
        jabatanMap.set(jabatan, { total: 0, hadir: 0 });
      }
      jabatanMap.get(jabatan).total++;
    });
    
    const hadirSet = new Set();
    filteredData.forEach(item => {
      if (item.status === 'Hadir' || item.status === 'Pulang') {
        hadirSet.add(item.staffId);
      }
    });
    
    filteredStaff.forEach(s => {
      const jabatan = s.jabatan || 'Tanpa Jabatan';
      if (hadirSet.has(s.id)) {
        jabatanMap.get(jabatan).hadir++;
      }
    });
    
    const labels = Array.from(jabatanMap.keys());
    const hadirData = labels.map(k => jabatanMap.get(k).hadir);
    const totalData = labels.map(k => jabatanMap.get(k).total);
    const persentaseData = labels.map((k, i) => {
      return totalData[i] > 0 ? Math.round((hadirData[i] / totalData[i]) * 100) : 0;
    });
    
    return { labels, hadirData, totalData, persentaseData };
  }, [filteredStaff, filteredData]);

  const barData = {
    labels: jabatanChartData.labels,
    datasets: [
      {
        label: 'Hadir',
        data: jabatanChartData.hadirData,
        backgroundColor: 'rgba(255, 152, 0, 0.7)',
        borderColor: '#ff9800',
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.6,
        categoryPercentage: 0.7
      },
      {
        label: 'Total Staff',
        data: jabatanChartData.totalData,
        backgroundColor: 'rgba(33, 150, 243, 0.5)',
        borderColor: '#2196f3',
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.6,
        categoryPercentage: 0.7
      }
    ]
  };

  const barOptions = {
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
            return `${label}: ${value} staff`;
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
  };

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
          hadirSet.add(item.staffId);
        }
      });
      
      const hadir = hadirSet.size;
      attendanceCount.push(hadir);
      
      const totalStaff = filteredStaff.length;
      const persen = totalStaff > 0 ? Math.round((hadir / totalStaff) * 100) : 0;
      percentageData.push(persen);
    }
    
    return { labels: last7Days, attendanceCount, percentageData };
  }, [filteredData, filteredStaff]);

  const lineChartData = {
    labels: lineData.labels,
    datasets: [
      {
        label: 'Jumlah Hadir',
        data: lineData.attendanceCount,
        borderColor: '#ff9800',
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#ff9800',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      },
      {
        label: 'Persentase Kehadiran (%)',
        data: lineData.percentageData,
        borderColor: '#2196f3',
        backgroundColor: 'rgba(33, 150, 243, 0.05)',
        fill: true,
        tension: 0.4,
        borderDash: [5, 5],
        pointBackgroundColor: '#2196f3',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        yAxisID: 'y1'
      }
    ]
  };

  const lineOptions = {
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
            return `${label}: ${value} staff`;
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
  };

  // ==================== DELETE STAFF ATTENDANCE ====================
  const deleteStaffAttendance = async (id) => {
    if (!canSimulate) {
      alert('Anda tidak memiliki akses untuk menghapus data!');
      return;
    }
    
    const attendanceToDelete = attendanceData.find(a => a.id === id);
    if (!attendanceToDelete) {
      alert('❌ Data absensi staff tidak ditemukan!');
      return;
    }
    
    const staffName = attendanceToDelete.nama || 'Staff';
    const date = attendanceToDelete.date;
    const staffId = attendanceToDelete.staffId;
    
    if (!window.confirm(`⚠️ Yakin ingin menghapus data absensi staff "${staffName}"?\n\nTanggal: ${date}\nID: ${staffId}\n\nData akan dihapus PERMANEN dari database!`)) return;
    
    try {
      await remove(ref(db, `staff_attendance/${date}/${staffId}`));
      setAttendanceData(prev => prev.filter(item => item.id !== id));
      alert(`✅ Data absensi staff "${staffName}" berhasil dihapus dari database!`);
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('delete_staff_attendance', `Menghapus absensi staff ${staffName} (ID: ${staffId}) pada tanggal ${date}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('❌ Gagal menghapus data: ' + error.message);
    }
  };

  // ==================== SIMULASI ABSEN STAFF ====================
  const openSimulateModal = (type) => {
    if (!canSimulate) {
      alert('Anda tidak memiliki akses untuk melakukan simulasi!');
      return;
    }
    setSimulateType(type);
    setSelectedStaff(null);
    setSearchStaff('');
    setShowSimulateModal(true);
  };

  const closeSimulateModal = () => {
    setShowSimulateModal(false);
    setSelectedStaff(null);
    setSearchStaff('');
  };

  const handleSimulateAttendance = async () => {
    if (!selectedStaff) {
      alert('Pilih staff terlebih dahulu!');
      return;
    }
    
    setSimulateLoading(true);
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toISOString().split('T')[0];
    
    try {
      if (simulateType === 'in') {
        const existingSnapshot = await get(ref(db, `staff_attendance/${dateStr}/${selectedStaff.id}`));
        if (existingSnapshot.exists()) {
          alert(`⚠️ Staff ${selectedStaff.nama} sudah absen masuk hari ini!`);
          setSimulateLoading(false);
          return;
        }

        const isLate = timeStr > '07:30';
        const attendanceData = {
          staffId: selectedStaff.id,
          nama: selectedStaff.nama,
          jabatan: selectedStaff.jabatan || 'guru',
          departemen: selectedStaff.departemen || '-',
          timeIn: timeStr,
          timeOut: null,
          timestamp: Date.now(),
          status: 'Hadir',
          noHp: selectedStaff.noHp || null
        };
        
        await set(ref(db, `staff_attendance/${dateStr}/${selectedStaff.id}`), attendanceData);
        
        const staffData = staffList.find(s => s.id == selectedStaff.id);
        let whatsappResult = null;
        if (staffData) {
          whatsappResult = await sendStaffCheckInNotification(staffData, timeStr, isLate);
        }
        
        let alertMessage = `✅ Absen masuk berhasil untuk staff ${selectedStaff.nama} (${timeStr})${isLate ? ' ⚠️ Terlambat!' : ''}`;
        if (whatsappResult?.success) {
          alertMessage += '\n📱 WhatsApp terkirim!';
        } else if (whatsappResult?.error) {
          alertMessage += `\n⚠️ WhatsApp gagal: ${whatsappResult.error}`;
        }
        alert(alertMessage);
      } else {
        const snapshot = await get(ref(db, `staff_attendance/${dateStr}/${selectedStaff.id}`));
        if (!snapshot.exists()) {
          alert('❌ Staff belum absen masuk hari ini!');
          setSimulateLoading(false);
          return;
        }
        
        const existingData = snapshot.val();
        
        await update(ref(db, `staff_attendance/${dateStr}/${selectedStaff.id}`), {
          timeOut: timeStr,
          status: 'Pulang'
        });
        
        const staffData = staffList.find(s => s.id == selectedStaff.id);
        let whatsappResult = null;
        if (staffData) {
          whatsappResult = await sendStaffCheckOutNotification(staffData, existingData.timeIn || '-', timeStr);
        }
        
        let alertMessage = `✅ Absen pulang berhasil untuk staff ${selectedStaff.nama} (${timeStr})`;
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
    } finally {
      setSimulateLoading(false);
    }
  };

  // ==================== RENDER ====================
  const today = new Date().toISOString().split('T')[0];

  const dateOptions = [
    { value: 'all', label: '📅 Semua Data' },
    { value: 'today', label: '📅 Hari Ini' },
    { value: 'this_week', label: '📅 Minggu Ini' },
    { value: 'this_month', label: '📅 Bulan Ini' }
  ];
  
  for (let i = 1; i <= 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const label = date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
    dateOptions.push({ value: dateStr, label });
  }

  let filterButtonLabel = 'Semua Data';
  if (filterJabatan !== 'all' && filterDepartemen !== 'all') {
    filterButtonLabel = `Jabatan ${filterJabatan} & Departemen ${filterDepartemen}`;
  } else if (filterJabatan !== 'all') {
    filterButtonLabel = `Jabatan ${filterJabatan}`;
  } else if (filterDepartemen !== 'all') {
    filterButtonLabel = `Departemen ${filterDepartemen}`;
  } else if (filterDate !== 'all') {
    filterButtonLabel = `Tanggal ${filterDate}`;
  }

  const totalDataToDelete = filteredData.length;

  const todayCheckedIn = new Set();
  attendanceData
    .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
    .forEach(a => todayCheckedIn.add(a.staffId));
  const absentToday = filteredStaff.filter(s => !todayCheckedIn.has(s.id));

  if (!canView) {
    return (
      <div className="tab-content">
        <div className="access-denied">
          <div className="access-denied-icon">🔒</div>
          <h3>Akses Terbatas</h3>
          <p>Anda tidak memiliki akses ke halaman absensi staff.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tab-content">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Memuat data absensi staff...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tab-content">
        <div className="error-state">
          <div className="error-icon">❌</div>
          <h3>Gagal Memuat Data</h3>
          <p>{error}</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>🔄 Coba Lagi</button>
        </div>
      </div>
    );
  }

  const getRoleLabel = () => {
    if (role === 'siswa') return '👤 Siswa';
    if (role === 'guru') return '👨‍🏫 Guru';
    if (role === 'staff_tu') return '👨‍💼 Staff TU';
    if (isFullAccess) return '🔐 Admin';
    return '👤 User';
  };

  return (
    <div className="staff-attendance-container">
      {/* ==================== HEADER - STICKY ==================== */}
      <header className="attendance-header-mobile" id="staff-header">
        <div className="header-left">
          <h1>👔 Absensi Staff</h1>
          <p className="header-subtitle">
            Pantau kehadiran guru & karyawan
            <span style={{ fontSize: '11px', marginLeft: '8px', color: 'var(--text-muted)' }}>
              ({getRoleLabel()})
            </span>
          </p>
        </div>
        <div className="header-actions-mobile">
          {/* Export Buttons */}
          {canExport && (
            <div className="export-buttons">
              <button 
                className="btn-export-excel" 
                onClick={exportToExcel} 
                disabled={exportLoading}
              >
                {exportLoading ? '⏳' : '📊'} Excel
              </button>
              <button 
                className="btn-export-pdf" 
                onClick={exportToPDF} 
                disabled={exportLoading}
              >
                {exportLoading ? '⏳' : '📄'} PDF
              </button>
            </div>
          )}

          {/* SIMULATE BUTTONS - DENGAN WRAPPER */}
          {canSimulate && (
            <div className="simulate-buttons-mobile">
              <button 
                className="btn-simulate-in-mobile" 
                onClick={() => openSimulateModal('in')}
              >
                ✅ Masuk
              </button>
              <button 
                className="btn-simulate-out-mobile" 
                onClick={() => openSimulateModal('out')}
              >
                🏠 Pulang
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ==================== WHATSAPP STATUS BANNER ==================== */}
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
              ? `WhatsApp terkirim ke ${whatsappStatus.lastResult.phoneNumber || 'nomor staff'}`
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

      {/* ==================== REMINDER BUTTON ==================== */}
      {(canSimulate) && (
        <div className="reminder-banner-staff" style={{
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
              <strong style={{ color: '#ff9800' }}>{absentToday.length}</strong> staff belum absen hari ini
            </span>
          </div>
          <button
            onClick={sendBulkReminderStaff}
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

      {/* ==================== BANNER DEVELOPER (TETAP TAMPIL UNTUK DEVELOPER) ==================== */}
      {isDeveloper && (
        <div className="developer-banner-staff" style={{
          background: 'linear-gradient(135deg, rgba(244,67,54,0.12), rgba(244,67,54,0.04))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(244,67,54,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>💻</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#f44336' }}>Developer Mode</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>|</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>👁️ Melihat semua data</span>
              <span style={{ fontSize: '11px', color: '#4caf50', fontWeight: 'bold' }}>✨ Simulasi</span>
              <span style={{ fontSize: '11px', color: '#f44336', fontWeight: 'bold' }}>🗑️ Hapus semua</span>
              <span style={{ fontSize: '11px', color: '#ff9800', fontWeight: 'bold' }}>🔔 Kirim pengingat</span>
            </div>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {filteredData.length} data
          </span>
        </div>
      )}

      {/* ==================== BANNER HAPUS SEMUA ==================== */}
      {isDeveloper && totalDataToDelete > 0 && (
        <div className="delete-all-banner-staff" style={{
          background: 'linear-gradient(135deg, rgba(244,67,54,0.15), rgba(244,67,54,0.05))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(244,67,54,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#f44336' }}>Hapus Data</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              <strong>{totalDataToDelete}</strong> data akan dihapus
              <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '8px' }}>
                ({filterButtonLabel})
              </span>
            </span>
          </div>
          <button
            className="btn-delete-banner-staff"
            onClick={deleteAllStaffAttendance}
            disabled={deleteAllLoading}
            style={{
              padding: '8px 20px',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {deleteAllLoading ? '⏳ Menghapus...' : `🗑️ Hapus ${totalDataToDelete} Data`}
          </button>
        </div>
      )}

      {/* ==================== STATS CARDS ==================== */}
      <div className="stats-cards-mobile">
        <div className="stat-card-mobile">
          <span className="stat-number-mobile">{stats.totalStaff}</span>
          <span className="stat-label-mobile">👥 Staff</span>
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

      {/* ==================== PROGRESS BAR ==================== */}
      <div className="progress-container-mobile">
        <div className="progress-label-mobile">
          <span>Kehadiran Staff {filterDate === 'all' ? '(Semua Data)' : filterDate === 'today' ? 'Hari Ini' : filterDate === 'this_week' ? 'Minggu Ini' : filterDate === 'this_month' ? 'Bulan Ini' : ''}</span>
          <span className="progress-percentage-mobile">{stats.persentase}%</span>
        </div>
        <div className="progress-bar-mobile">
          <div className="progress-fill-mobile" style={{ width: `${stats.persentase}%` }}></div>
        </div>
      </div>

      {/* ==================== CHARTS ==================== */}
      <div className="charts-grid-mobile">
        <div className="chart-card-mobile">
          <h4 className="chart-title">📊 Persentase Kehadiran</h4>
          <div className="chart-container-mobile">
            <Doughnut data={donutData} options={donutOptions} />
          </div>
          <div className="chart-info-mobile">
            <span>Total Staff: {stats.totalStaff}</span>
            <span>Hadir: {stats.hadir} ({stats.persentase}%)</span>
          </div>
        </div>

        {jabatanChartData.labels.length > 0 && (
          <div className="chart-card-mobile chart-card-full">
            <h4 className="chart-title">📋 Kehadiran per Jabatan</h4>
            <div className="chart-container-mobile chart-container-bar">
              <Bar data={barData} options={barOptions} />
            </div>
            <div className="chart-info-mobile chart-info-scroll">
              {jabatanChartData.labels.map((label, i) => (
                <span key={label} className="chart-info-tag">
                  {label}: {jabatanChartData.hadirData[i]}/{jabatanChartData.totalData[i]} ({jabatanChartData.persentaseData[i]}%)
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="chart-card-mobile chart-card-full">
          <h4 className="chart-title">📈 Tren Kehadiran 7 Hari Terakhir</h4>
          <div className="chart-container-mobile chart-container-line">
            <Line data={lineChartData} options={lineOptions} />
          </div>
        </div>
      </div>

      {/* ==================== FILTERS ==================== */}
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
          <label>📋</label>
          <select value={filterJabatan} onChange={(e) => setFilterJabatan(e.target.value)}>
            {jabatanOptions.map(j => (
              <option key={j} value={j}>{j === 'all' ? '📋 Semua Jabatan' : j}</option>
            ))}
          </select>
        </div>
        
        <div className="filter-group-mobile">
          <label>🏢</label>
          <select value={filterDepartemen} onChange={(e) => setFilterDepartemen(e.target.value)}>
            {departemenOptions.map(d => (
              <option key={d} value={d}>{d === 'all' ? '🏢 Semua Departemen' : d}</option>
            ))}
          </select>
        </div>

        <div className="filter-count-mobile">
          <span>📊 {filteredData.length} data</span>
        </div>
      </div>

      {/* ==================== INFO DEVELOPER ==================== */}
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
        </div>
      )}

      {/* ==================== TABLE - CARD VIEW ==================== */}
      <div className="table-container-mobile">
        {filteredData.length === 0 ? (
          <div className="empty-state-mobile">
            <span className="empty-icon-mobile">📭</span>
            <h3>Belum Ada Data</h3>
            <p>Belum ada staff yang absen pada periode ini</p>
            {filterDate !== 'all' && (
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
              const photoUrl = getStaffPhoto(item.staffId, item.nama);
              const hasAccount = usersAuth.some(u => u.staffId == item.staffId || u.uid == item.staffId);
              const staff = staffList.find(s => s.id == item.staffId);
              const hasWA = getStaffPhoneNumber(staff);
              
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
                          const initial = item.nama ? item.nama.charAt(0).toUpperCase() : 'S';
                          e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=ff9800&color=fff&size=64&bold=true`;
                        }}
                      />
                      {hasAccount && <span className="card-badge-mobile" title="Memiliki akun">✅</span>}
                      {hasWA && <span className="card-wa-badge-mobile" title="WA terdaftar">📱</span>}
                    </div>
                    <div className="card-info-mobile">
                      <div className="card-name-mobile">{item.nama}</div>
                      <div className="card-id-mobile">#{item.staffId}</div>
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
                      <span className="card-label-mobile">📋 Jabatan</span>
                      <span className="card-value-mobile">{item.jabatan || '-'}</span>
                    </div>
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">🏢 Departemen</span>
                      <span className="card-value-mobile">{item.departemen || '-'}</span>
                    </div>
                    <div className="card-row-mobile">
                      <span className="card-label-mobile">📱 No HP</span>
                      <span className="card-value-mobile" style={{ color: hasWA ? '#25d366' : 'var(--text-muted)' }}>
                        {hasWA || '-'}
                      </span>
                    </div>
                  </div>
                  {canSimulate && (
                    <div className="card-footer-mobile">
                      <button 
                        className="btn-delete-mobile" 
                        onClick={() => deleteStaffAttendance(item.id)}
                      >
                        🗑️ Hapus
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ==================== FOOTER ==================== */}
      <div className="attendance-footer-mobile">
        <p className="footer-info-mobile">
          📌 Data absensi <strong>staff</strong> dari <code>staff_attendance</code>
          <span className="footer-wa-info-mobile"> • 📱 WA otomatis</span>
          {filterDate === 'all' && <span className="footer-all-data-mobile"> • 📋 Menampilkan semua data</span>}
          {filterDate === 'this_week' && <span className="footer-period-mobile"> • 📅 Minggu Ini</span>}
          {filterDate === 'this_month' && <span className="footer-period-mobile"> • 📅 Bulan Ini</span>}
          <span className="footer-role-mobile"> • {getRoleLabel()}</span>
          {isDeveloper && (
            <span className="footer-dev-mobile" style={{ color: '#f44336', fontWeight: 'bold' }}>
              • 💻 Developer • 🗑️ Hapus semua • 🔔 Kirim pengingat
            </span>
          )}
          {canSimulate && !isDeveloper && (
            <span className="footer-simulate-mobile" style={{ color: '#4caf50', fontWeight: 'bold' }}>
              • ✨ Bisa simulasi • 🔔 Kirim pengingat
            </span>
          )}
        </p>
        {isDeveloper && (
          <p className="footer-dev-info-mobile" style={{ color: '#f44336', fontWeight: 'bold' }}>
            💻 Mode Developer Aktif - Total Data: {filteredData.length} • 🗑️ Bisa hapus semua
          </p>
        )}
      </div>

      {/* ==================== MODAL SIMULASI ==================== */}
      {showSimulateModal && (
        <div className="modal-overlay-mobile" onClick={closeSimulateModal}>
          <div className="modal-box-mobile" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-mobile">
              <div className="modal-header-left-mobile">
                <span className="modal-icon-mobile">{simulateType === 'in' ? '✅' : '🏠'}</span>
                <h3>{simulateType === 'in' ? 'Absen Masuk Staff' : 'Absen Pulang Staff'}</h3>
              </div>
              <button className="modal-close-mobile" onClick={closeSimulateModal}>✖</button>
            </div>
            <div className="modal-body-mobile">
              <div className="form-group-mobile">
                <label>🔍 Cari Staff</label>
                <input
                  type="text"
                  placeholder="Nama atau ID staff..."
                  value={searchStaff}
                  onChange={(e) => setSearchStaff(e.target.value)}
                  className="search-input-mobile"
                />
              </div>
              
              <div className="student-list-mobile">
                {staffList
                  .filter(s => 
                    s.nama?.toLowerCase().includes(searchStaff.toLowerCase()) ||
                    s.id?.toString().includes(searchStaff)
                  )
                  .slice(0, 10)
                  .map(s => {
                    const photo = getStaffPhoto(s.id, s.nama);
                    const hasAcc = usersAuth.some(u => u.staffId == s.id || u.uid == s.id);
                    const hasWA = getStaffPhoneNumber(s);
                    return (
                      <div 
                        key={s.id}
                        className={`student-item-mobile ${selectedStaff?.id === s.id ? 'selected' : ''}`}
                        onClick={() => setSelectedStaff(s)}
                      >
                        <img 
                          src={photo} 
                          alt={s.nama}
                          className="student-avatar-small-mobile"
                          onError={(e) => {
                            const initial = s.nama ? s.nama.charAt(0).toUpperCase() : 'S';
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=ff9800&color=fff&size=64&bold=true`;
                          }}
                        />
                        <div className="student-item-info-mobile">
                          <span className="student-item-name-mobile">{s.nama}</span>
                          <span className="student-item-class-mobile">{s.jabatan || '-'}</span>
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
              
              {selectedStaff && (
                <div className="selected-student-mobile">
                  <img 
                    src={getStaffPhoto(selectedStaff.id, selectedStaff.nama)} 
                    alt={selectedStaff.nama}
                    className="student-avatar-small-mobile"
                    onError={(e) => {
                      const initial = selectedStaff.nama ? selectedStaff.nama.charAt(0).toUpperCase() : 'S';
                      e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=ff9800&color=fff&size=64&bold=true`;
                    }}
                  />
                  <div className="selected-student-info-mobile">
                    <div className="selected-name-mobile"><strong>{selectedStaff.nama}</strong></div>
                    <div className="selected-class-mobile">{selectedStaff.jabatan || '-'}</div>
                    <div className="selected-id-mobile">🆔 ID: {selectedStaff.id}</div>
                  </div>
                  {getStaffPhoneNumber(selectedStaff) ? (
                    <span className="wa-status-mobile" title="WA terdaftar">📱</span>
                  ) : (
                    <span className="wa-status-no-mobile" title="WA tidak terdaftar">⚠️</span>
                  )}
                </div>
              )}

              {/* WhatsApp info */}
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
                  {selectedStaff 
                    ? getStaffPhoneNumber(selectedStaff) 
                      ? `WA terdaftar: ${getStaffPhoneNumber(selectedStaff)}` 
                      : '⚠️ WA tidak terdaftar'
                    : 'Pilih staff untuk melihat nomor WA'}
                </span>
                {simulateType === 'in' && (
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
                disabled={!selectedStaff || simulateLoading}
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

export default StaffAttendanceTab;