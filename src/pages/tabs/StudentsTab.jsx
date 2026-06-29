// src/pages/tabs/StudentsTab.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ref, onValue, set, update, remove, get } from 'firebase/database';
import { db } from '../../firebase/config';
import './StudentsTab.css';

const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const StudentsTab = ({ user }) => {
  const [students, setStudents] = useState([]);
  const [usersAuth, setUsersAuth] = useState([]);
  const [attendanceData, setAttendanceData] = useState([]);
  const [schoolConfig, setSchoolConfig] = useState({ classes: [], majors: [] });
  const [loading, setLoading] = useState(true);
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterKelas, setFilterKelas] = useState('all');
  const [filterJurusan, setFilterJurusan] = useState('all');
  const [photoCache, setPhotoCache] = useState({});
  const [photoLoading, setPhotoLoading] = useState({});
  const [studentInfo, setStudentInfo] = useState({ kelas: '', jurusan: '' });
  const [whatsappStatus, setWhatsappStatus] = useState({ sending: false, lastResult: null });
  
  // State untuk tambah siswa
  const [showAddModal, setShowAddModal] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addForm, setAddForm] = useState({
    id: '',
    nama: '',
    kelas: '',
    jurusan: '',
    delayOut: 60,
    parentPhone: ''
  });
  
  // State untuk edit siswa
  const [editingStudent, setEditingStudent] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    nama: '',
    kelas: '',
    jurusan: '',
    delayOut: 60,
    parentPhone: ''
  });
  const [editLoading, setEditLoading] = useState(false);
  
  // State untuk hapus semua
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  
  const [kelasOptions, setKelasOptions] = useState(['all']);
  const [jurusanOptions, setJurusanOptions] = useState(['all']);

  // State untuk notifikasi
  const [toast, setToast] = useState({ show: false, message: '', type: '' });

  // Cek role
  const isSiswa = user?.role === 'siswa';
  const isDeveloper = user?.role === 'developer';
  const isFullAccess = ['developer', 'admin', 'wakil_kepala'].includes(user?.role);
  const isStaff = ['guru', 'staff_tu'].includes(user?.role);
  
  // Permission
  const canAddStudent = !isSiswa;
  const canEditAll = isFullAccess;
  const canEditKelasOnly = isStaff;
  const canDelete = isFullAccess;
  const canDeleteAll = isDeveloper;
  const canSendReminder = isFullAccess || isStaff;

  // ==================== TOAST NOTIFICATION ====================
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: '' });
    }, 3000);
  };

  // ==================== GET STUDENT PHOTO - IMPROVED ====================
  const getStudentPhoto = useCallback((studentId, studentName, studentEmail) => {
    // Cek cache
    if (photoCache[studentId]) {
      return photoCache[studentId];
    }

    // Cari user auth yang cocok
    const userAuth = usersAuth.find(u => {
      // Cek berbagai kemungkinan ID
      const fpMatch = u.fpId && String(u.fpId) === String(studentId);
      const userIdMatch = u.userId && String(u.userId) === String(studentId);
      const uidMatch = u.uid && String(u.uid) === String(studentId);
      
      // Cek nama (case insensitive)
      const nameMatch = u.nama && studentName && 
        u.nama.toLowerCase().trim() === studentName.toLowerCase().trim();
      
      // Cek email (case insensitive)
      const emailMatch = u.email && studentEmail && 
        u.email.toLowerCase().trim() === studentEmail.toLowerCase().trim();
      
      // Cek jika studentId ada di field lain
      const otherMatch = u.studentId && String(u.studentId) === String(studentId);
      
      return fpMatch || userIdMatch || uidMatch || nameMatch || emailMatch || otherMatch;
    });

    let photoUrl;

    if (userAuth) {
      // Cek photoUrl dengan berbagai format
      const rawPhotoUrl = userAuth.photoUrl || userAuth.photoURL || userAuth.foto || '';
      
      if (rawPhotoUrl && rawPhotoUrl !== 'null' && rawPhotoUrl !== 'undefined' && rawPhotoUrl.trim() !== '') {
        // Tambahkan timestamp untuk menghindari cache
        const separator = rawPhotoUrl.includes('?') ? '&' : '?';
        photoUrl = rawPhotoUrl + separator + 't=' + Date.now();
        console.log(`📸 Photo found for ${studentName}: ${photoUrl}`);
      } else {
        // Fallback ke avatar
        const initial = studentName ? studentName.charAt(0).toUpperCase() : 'U';
        photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
        console.log(`🎨 Avatar fallback for ${studentName}`);
      }
    } else {
      // Tidak ada user auth, gunakan avatar
      const initial = studentName ? studentName.charAt(0).toUpperCase() : 'U';
      photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
      console.log(`🎨 Avatar fallback (no auth) for ${studentName}`);
    }

    // Simpan ke cache
    setPhotoCache(prev => {
      // Hapus cache lama jika ada
      const newCache = { ...prev };
      if (newCache[studentId]) {
        delete newCache[studentId];
      }
      return { ...newCache, [studentId]: photoUrl };
    });

    return photoUrl;
  }, [usersAuth, photoCache]);

  // ==================== REFRESH PHOTO CACHE ====================
  const refreshPhotoCache = useCallback((studentId) => {
    setPhotoCache(prev => {
      const newCache = { ...prev };
      if (newCache[studentId]) {
        delete newCache[studentId];
      }
      return newCache;
    });
  }, []);

  // ==================== REFRESH ALL PHOTO CACHE ====================
  const refreshAllPhotoCache = useCallback(() => {
    setPhotoCache({});
  }, []);

  // ==================== GET STUDENT PHONE NUMBER ====================
  const getStudentPhoneNumber = (student) => {
    if (!student) return null;
    
    // Priority: parentPhone > noHp > users_auth phone
    if (student.parentPhone && student.parentPhone !== '-' && student.parentPhone !== '') {
      return student.parentPhone;
    }
    if (student.noHp && student.noHp !== '-' && student.noHp !== '') {
      return student.noHp;
    }
    
    // Cek dari users_auth
    const userAuth = usersAuth.find(u => 
      String(u.fpId) === String(student.id) || 
      String(u.userId) === String(student.id) ||
      String(u.uid) === String(student.id) ||
      (u.email && student.email && u.email.toLowerCase() === student.email.toLowerCase())
    );
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
  };

  // ==================== GET USER AUTH FOR STUDENT ====================
  const getUserAuthForStudent = useCallback((studentId, studentName, studentEmail) => {
    return usersAuth.find(u => {
      const fpMatch = u.fpId && String(u.fpId) === String(studentId);
      const userIdMatch = u.userId && String(u.userId) === String(studentId);
      const uidMatch = u.uid && String(u.uid) === String(studentId);
      const nameMatch = u.nama && studentName && 
        u.nama.toLowerCase().trim() === studentName.toLowerCase().trim();
      const emailMatch = u.email && studentEmail && 
        u.email.toLowerCase().trim() === studentEmail.toLowerCase().trim();
      const otherMatch = u.studentId && String(u.studentId) === String(studentId);
      return fpMatch || userIdMatch || uidMatch || nameMatch || emailMatch || otherMatch;
    });
  }, [usersAuth]);

  // ==================== SEND WHATSAPP NOTIFICATION ====================
  const sendWhatsAppNotification = async (phoneNumber, message, type) => {
    if (!phoneNumber || phoneNumber === '-' || phoneNumber === '') {
      console.log('⚠️ No phone number provided, skipping notification');
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: formattedNumber,
          message: message
        })
      });

      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ WhatsApp ${type} notification sent to ${formattedNumber}`);
        setWhatsappStatus({ 
          sending: false, 
          lastResult: { success: true, phoneNumber: formattedNumber, type } 
        });
        return { success: true, data: data.data };
      } else {
        console.error(`❌ Failed to send WhatsApp ${type}:`, data.error);
        setWhatsappStatus({ 
          sending: false, 
          lastResult: { success: false, error: data.error || 'Unknown error' } 
        });
        return { success: false, error: data.error || 'Unknown error' };
      }
    } catch (error) {
      console.error(`❌ WhatsApp send error:`, error);
      setWhatsappStatus({ 
        sending: false, 
        lastResult: { success: false, error: error.message } 
      });
      return { success: false, error: error.message };
    }
  };

  // ==================== SEND STUDENT REMINDER NOTIFICATION ====================
  const sendStudentReminderNotification = async (student) => {
    const phoneNumber = getStudentPhoneNumber(student);
    if (!phoneNumber) {
      console.log(`⚠️ No phone for student ${student.nama}`);
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
    
    const message = `*🔔 PENGINGAT ABSENSI SISWA - ${schoolName}*

👨‍🎓 *Siswa:* ${student.nama}
🆔 *ID:* ${student.id}
📚 *Kelas:* ${student.kelas || '-'} - ${student.jurusan || '-'}
📅 *Tanggal:* ${dateStr}
⏰ *Waktu:* ${timeStr} WIB

⚠️ *Anda belum melakukan absensi masuk hari ini!*
Segera lakukan absensi melalui sistem.

--- 
📱 *Sistem Absensi IoT*
🔔 Ini adalah pengingat otomatis.`;

    return await sendWhatsAppNotification(phoneNumber, message, 'student_reminder');
  };

  // ==================== SEND BULK REMINDER SISWA ====================
  const sendBulkReminderSiswa = async () => {
    if (!canSendReminder) {
      showToast('⚠️ Anda tidak memiliki akses untuk mengirim pengingat!', 'error');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    
    const checkedInIds = new Set();
    attendanceData
      .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
      .forEach(a => checkedInIds.add(a.studentId));

    const absentStudents = filteredStudents.filter(s => !checkedInIds.has(s.id));

    if (absentStudents.length === 0) {
      showToast('✅ Semua siswa sudah absen hari ini!', 'success');
      return;
    }

    if (!window.confirm(`⚠️ Kirim pengingat WhatsApp ke ${absentStudents.length} siswa yang belum absen hari ini?`)) {
      return;
    }

    setWhatsappStatus({ sending: true, lastResult: null });
    let successCount = 0;
    let failCount = 0;

    for (const student of absentStudents) {
      const result = await sendStudentReminderNotification(student);
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

    showToast(`✅ Pengingat terkirim!\n📨 Berhasil: ${successCount}\n❌ Gagal: ${failCount}`, 'success');

    if (typeof window.logActivity === 'function') {
      window.logActivity('send_bulk_reminder_siswa', `Mengirim pengingat WhatsApp ke ${successCount} siswa dari halaman Students`);
    }
  };

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
          const data = snapshot.val();
          if (data) {
            for (const [id, student] of Object.entries(data)) {
              if (student.nama === user?.nama || student.email === user?.email) {
                console.log('📚 Student found by name/email:', student);
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
          const data = snapshot.val();
          if (data) {
            console.log('📚 Student data loaded for filter:', data);
            const kelas = data.kelas || '';
            const jurusan = data.jurusan || '';
            setStudentInfo({ kelas, jurusan });
            if (kelas) setFilterKelas(kelas);
            if (jurusan) setFilterJurusan(jurusan);
          } else {
            const usersRef = ref(db, 'users');
            const unsubscribe2 = onValue(usersRef, (snapshot) => {
              const data = snapshot.val();
              if (data) {
                for (const [id, student] of Object.entries(data)) {
                  if (student.nama === user?.nama) {
                    console.log('📚 Student found by name:', student);
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
            return () => unsubscribe2();
          }
        });
        return () => unsubscribe();
      }
    }
  }, [isSiswa, user]);

  // ==================== AMBIL DATA DARI FIREBASE ====================
  useEffect(() => {
    let isMounted = true;

    // ===== AMBIL DATA SISWA DARI NODE 'USERS' =====
    const usersRef = ref(db, 'users');
    const unsubscribeUsers = onValue(usersRef, (snapshot) => {
      if (!isMounted) return;
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
      
      console.log('📊 [StudentsTab] Total students loaded:', usersList.length);
    }, (error) => {
      console.error('❌ Error fetching users:', error);
      setError('Gagal memuat data siswa');
    });

    // ===== AMBIL DATA USER AUTH =====
    const usersAuthRef = ref(db, 'users_auth');
    const unsubscribeUsersAuth = onValue(usersAuthRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const authList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && item.role === 'siswa') {
            authList.push({ uid: key, ...item });
          }
        });
      }
      setUsersAuth(authList);
      // Refresh photo cache when users_auth changes
      setPhotoCache({});
      console.log(`📊 [StudentsTab] Users Auth (siswa): ${authList.length} siswa terdaftar`);
    }, (error) => {
      console.error('❌ Error fetching users_auth:', error);
    });

    // ===== AMBIL KONFIGURASI SEKOLAH =====
    const schoolConfigRef = ref(db, 'school_config');
    const unsubscribeSchoolConfig = onValue(schoolConfigRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      if (data) {
        setSchoolConfig({
          classes: data.classes || [],
          majors: data.majors || []
        });
      }
    }, (error) => {
      console.error('❌ Error fetching school_config:', error);
    });

    // ===== AMBIL DATA ABSENSI SISWA =====
    const attendanceRef = ref(db, 'absensi');
    const unsubscribeAttendance = onValue(attendanceRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(date => {
          const dailyRecords = data[date];
          if (dailyRecords) {
            Object.keys(dailyRecords).forEach(id => {
              const record = dailyRecords[id];
              if (record) {
                list.push({
                  id: date + "-" + id,
                  studentId: id,
                  date: date,
                  timeIn: record.in,
                  timeOut: record.out,
                  status: record.out ? "Pulang" : "Hadir",
                  timestamp: record.timestamp || Date.now()
                });
              }
            });
          }
        });
      }
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setAttendanceData(list);
      setLoadingAttendance(false);
      console.log(`📊 [StudentsTab] Attendance data loaded: ${list.length} records`);
    }, (error) => {
      console.error('❌ Error fetching attendance:', error);
      setLoadingAttendance(false);
    });

    setLoading(false);

    return () => {
      isMounted = false;
      unsubscribeUsers();
      unsubscribeUsersAuth();
      unsubscribeSchoolConfig();
      unsubscribeAttendance();
    };
  }, []);

  // ==================== FILTER DATA ====================
  const filteredStudents = useMemo(() => {
    let data = [...students];
    
    if (isSiswa) {
      const targetKelas = filterKelas !== 'all' ? filterKelas : (studentInfo.kelas || user?.kelas || '');
      const targetJurusan = filterJurusan !== 'all' ? filterJurusan : (studentInfo.jurusan || user?.jurusan || '');
      
      if (targetKelas) {
        data = data.filter(s => s.kelas === targetKelas);
      }
      if (targetJurusan) {
        data = data.filter(s => s.jurusan === targetJurusan);
      }
    } else {
      if (filterKelas !== 'all') {
        data = data.filter(s => s.kelas === filterKelas);
      }
      if (filterJurusan !== 'all') {
        data = data.filter(s => s.jurusan === filterJurusan);
      }
    }
    
    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      data = data.filter(s => 
        s.nama?.toLowerCase().includes(term) ||
        s.id?.toString().includes(term)
      );
    }
    
    return data;
  }, [students, searchTerm, filterKelas, filterJurusan, isSiswa, studentInfo, user]);

  // ==================== STATISTICS ====================
  const stats = useMemo(() => {
    const total = filteredStudents.length;
    
    const withAccount = filteredStudents.filter(s => {
      const studentId = String(s.id);
      return usersAuth.some(u => {
        const fpMatch = u.fpId && String(u.fpId) === studentId;
        const userIdMatch = u.userId && String(u.userId) === studentId;
        const uidMatch = u.uid && String(u.uid) === studentId;
        const nameMatch = u.nama && u.nama.toLowerCase() === s.nama?.toLowerCase();
        const emailMatch = u.email && s.email && u.email.toLowerCase() === s.email.toLowerCase();
        return fpMatch || userIdMatch || uidMatch || nameMatch || emailMatch;
      });
    }).length;
    
    const withoutAccount = total - withAccount;
    const withWA = filteredStudents.filter(s => getStudentPhoneNumber(s)).length;
    const withoutWA = total - withWA;
    
    return { total, withAccount, withoutAccount, withWA, withoutWA };
  }, [students, usersAuth, filteredStudents]);

  // ==================== CEK APAKAH SISWA SUDAH PUNYA AKUN ====================
  const hasAccount = (studentId, studentName, studentEmail) => {
    const idStr = String(studentId);
    return usersAuth.some(u => {
      const fpMatch = u.fpId && String(u.fpId) === idStr;
      const userIdMatch = u.userId && String(u.userId) === idStr;
      const uidMatch = u.uid && String(u.uid) === idStr;
      const nameMatch = u.nama && studentName && u.nama.toLowerCase() === studentName.toLowerCase();
      const emailMatch = u.email && studentEmail && u.email.toLowerCase() === studentEmail.toLowerCase();
      return fpMatch || userIdMatch || uidMatch || nameMatch || emailMatch;
    });
  };

  // ==================== TAMBAH SISWA ====================
  const openAddModal = () => {
    setAddForm({
      id: '',
      nama: '',
      kelas: '',
      jurusan: '',
      delayOut: 60,
      parentPhone: ''
    });
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddForm({
      id: '',
      nama: '',
      kelas: '',
      jurusan: '',
      delayOut: 60,
      parentPhone: ''
    });
  };

  const handleAddChange = (e) => {
    const { name, value } = e.target;
    setAddForm(prev => ({ ...prev, [name]: value }));
  };

  const handleAddStudent = async () => {
    const { id, nama, kelas, jurusan, delayOut, parentPhone } = addForm;
    
    if (!id.trim()) {
      alert('⚠️ ID siswa wajib diisi!');
      return;
    }
    if (!nama.trim()) {
      alert('⚠️ Nama siswa wajib diisi!');
      return;
    }
    if (!kelas) {
      alert('⚠️ Pilih kelas!');
      return;
    }
    if (!parentPhone.trim()) {
      alert('⚠️ Nomor WhatsApp orang tua wajib diisi!');
      return;
    }
    
    if (students.some(s => String(s.id) === String(id))) {
      alert(`❌ ID ${id} sudah digunakan!`);
      return;
    }
    
    setAddLoading(true);
    
    try {
      const studentData = {
        id: String(id),
        nama: nama.trim(),
        kelas: kelas,
        jurusan: jurusan || '',
        delayOut: parseInt(delayOut) || 60,
        parentPhone: parentPhone.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      await set(ref(db, `users/${id}`), studentData);
      
      showToast(`✅ Siswa "${nama.trim()}" berhasil ditambahkan!`, 'success');
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('add_student', `Menambahkan siswa ${nama.trim()} (ID: ${id})`);
      }
      
      closeAddModal();
    } catch (error) {
      console.error('Add student error:', error);
      showToast('❌ Gagal menambahkan siswa: ' + error.message, 'error');
    } finally {
      setAddLoading(false);
    }
  };

  // ==================== EDIT SISWA ====================
  const openEditModal = (student) => {
    setEditingStudent(student);
    setEditForm({
      nama: student.nama || '',
      kelas: student.kelas || '',
      jurusan: student.jurusan || '',
      delayOut: student.delayOut || 60,
      parentPhone: student.parentPhone || ''
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingStudent(null);
    setEditForm({
      nama: '',
      kelas: '',
      jurusan: '',
      delayOut: 60,
      parentPhone: ''
    });
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm(prev => ({ ...prev, [name]: value }));
  };

  const handleUpdateStudent = async () => {
    if (!editingStudent) return;
    
    const { nama, kelas, jurusan, delayOut, parentPhone } = editForm;
    
    if (!nama.trim()) {
      alert('⚠️ Nama siswa wajib diisi!');
      return;
    }
    
    if (!kelas) {
      alert('⚠️ Pilih kelas!');
      return;
    }
    
    if (isStaff && !isFullAccess) {
      try {
        const updateData = {
          kelas: kelas,
          parentPhone: parentPhone || '',
          updatedAt: Date.now()
        };
        await update(ref(db, `users/${editingStudent.id}`), updateData);
        
        // Update users_auth if exists
        const userAuth = getUserAuthForStudent(editingStudent.id, editingStudent.nama, editingStudent.email);
        if (userAuth) {
          await update(ref(db, `users_auth/${userAuth.uid}`), {
            kelas: kelas,
            parentPhone: parentPhone || ''
          });
        }
        
        showToast(`✅ Data siswa ${editingStudent.nama} berhasil diupdate!`, 'success');
        closeEditModal();
      } catch (error) {
        console.error('Update error:', error);
        showToast('❌ Gagal mengupdate data: ' + error.message, 'error');
      }
      return;
    }
    
    if (!nama.trim() || !kelas || !jurusan) {
      alert('⚠️ Semua field wajib diisi!');
      return;
    }
    
    setEditLoading(true);
    
    try {
      const updateData = {
        nama: nama.trim(),
        kelas: kelas,
        jurusan: jurusan,
        delayOut: parseInt(delayOut) || 60,
        parentPhone: parentPhone || '',
        updatedAt: Date.now()
      };
      
      await update(ref(db, `users/${editingStudent.id}`), updateData);
      
      const userAuth = getUserAuthForStudent(editingStudent.id, editingStudent.nama, editingStudent.email);
      if (userAuth) {
        await update(ref(db, `users_auth/${userAuth.uid}`), {
          nama: nama.trim(),
          kelas: kelas,
          jurusan: jurusan,
          parentPhone: parentPhone || ''
        });
        // Refresh photo cache after update
        refreshPhotoCache(editingStudent.id);
      }
      
      showToast(`✅ Data siswa ${editingStudent.nama} berhasil diupdate!`, 'success');
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('edit_student', `Mengupdate data siswa ${editingStudent.nama} (ID: ${editingStudent.id})`);
      }
      
      closeEditModal();
    } catch (error) {
      console.error('Update error:', error);
      showToast('❌ Gagal mengupdate data: ' + error.message, 'error');
    } finally {
      setEditLoading(false);
    }
  };

  // ==================== DELETE STUDENT ====================
  const deleteStudent = async (student) => {
    if (!canDelete) {
      alert('Anda tidak memiliki akses untuk menghapus data!');
      return;
    }
    
    const hasAcc = hasAccount(student.id, student.nama, student.email);
    const warningMsg = hasAcc 
      ? `⚠️⚠️ PERINGATAN! ⚠️⚠️\n\nSiswa "${student.nama}" SUDAH memiliki akun!\n\nID: ${student.id}\nKelas: ${student.kelas}\n\nMenghapus siswa akan menghapus:\n✅ Data di node users\n✅ Akun di users_auth\n✅ Data absensi\n\nTINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\nYakin ingin melanjutkan?`
      : `⚠️ Yakin ingin menghapus siswa "${student.nama}"?\n\nID: ${student.id}\nKelas: ${student.kelas}\n\nData akan dihapus PERMANEN dari database!`;
    
    if (!window.confirm(warningMsg)) return;
    
    try {
      await remove(ref(db, `users/${student.id}`));
      
      const userAuth = getUserAuthForStudent(student.id, student.nama, student.email);
      if (userAuth) {
        await remove(ref(db, `users_auth/${userAuth.uid}`));
      }
      
      // Remove from photo cache
      refreshPhotoCache(student.id);
      
      showToast(`✅ Data siswa "${student.nama}" berhasil dihapus!${hasAcc ? ' (Akun juga dihapus)' : ''}`, 'success');
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('delete_student', `Menghapus siswa ${student.nama} (ID: ${student.id})${hasAcc ? ' + akun' : ''}`);
      }
      
    } catch (error) {
      console.error('Delete error:', error);
      showToast('❌ Gagal menghapus data: ' + error.message, 'error');
    }
  };

  // ==================== DELETE ALL STUDENTS WITH FILTER (DEV ONLY) ====================
  const openDeleteAllModal = () => {
    setDeleteAllConfirmText('');
    setShowDeleteAllModal(true);
  };

  const closeDeleteAllModal = () => {
    setShowDeleteAllModal(false);
    setDeleteAllConfirmText('');
    setDeleteAllLoading(false);
  };

  const getStudentsToDelete = () => {
    let data = [...students];
    
    if (filterKelas !== 'all') {
      data = data.filter(s => s.kelas === filterKelas);
    }
    
    if (filterJurusan !== 'all') {
      data = data.filter(s => s.jurusan === filterJurusan);
    }
    
    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      data = data.filter(s => 
        s.nama?.toLowerCase().includes(term) ||
        s.id?.toString().includes(term)
      );
    }
    
    return data;
  };

  const handleDeleteAllStudents = async () => {
    if (!canDeleteAll) {
      alert('❌ Akses ditolak! Hanya Developer yang dapat menghapus semua data.');
      return;
    }

    if (deleteAllConfirmText !== 'HAPUS SEMUA') {
      alert('⚠️ Ketik "HAPUS SEMUA" untuk konfirmasi penghapusan semua data siswa!');
      return;
    }

    const studentsToDelete = getStudentsToDelete();
    
    if (studentsToDelete.length === 0) {
      alert('⚠️ Tidak ada siswa yang sesuai dengan filter untuk dihapus!');
      return;
    }

    const withAccountCount = studentsToDelete.filter(s => hasAccount(s.id, s.nama, s.email)).length;

    let filterDesc = '';
    if (filterKelas !== 'all' && filterJurusan !== 'all') {
      filterDesc = `Kelas ${filterKelas} & Jurusan ${filterJurusan}`;
    } else if (filterKelas !== 'all') {
      filterDesc = `Kelas ${filterKelas}`;
    } else if (filterJurusan !== 'all') {
      filterDesc = `Jurusan ${filterJurusan}`;
    } else if (searchTerm.trim() !== '') {
      filterDesc = `Pencarian "${searchTerm}"`;
    } else {
      filterDesc = 'SEMUA DATA';
    }

    const confirmMsg = 
      `⚠️⚠️ PERINGATAN AKHIR! ⚠️⚠️\n\n` +
      `Anda akan menghapus data siswa dengan filter:\n` +
      `📌 ${filterDesc}\n\n` +
      `📊 Jumlah: ${studentsToDelete.length} siswa\n` +
      `👥 Dengan akun: ${withAccountCount} siswa (akan dihapus juga)\n\n` +
      `TINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\n` +
      `Yakin ingin melanjutkan?`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    setDeleteAllLoading(true);

    try {
      let deletedCount = 0;
      let deletedAuthCount = 0;
      let failedCount = 0;

      for (const student of studentsToDelete) {
        try {
          await remove(ref(db, `users/${student.id}`));
          deletedCount++;
          
          const userAuth = getUserAuthForStudent(student.id, student.nama, student.email);
          if (userAuth) {
            await remove(ref(db, `users_auth/${userAuth.uid}`));
            deletedAuthCount++;
          }
          
          refreshPhotoCache(student.id);
        } catch (err) {
          console.error(`Gagal hapus siswa ${student.id}:`, err);
          failedCount++;
        }
      }

      const resultMsg = 
        `✅ BERHASIL MENGHAPUS DATA!\n\n` +
        `📌 Filter: ${filterDesc}\n` +
        `✅ ${deletedCount} siswa dihapus\n` +
        `✅ ${deletedAuthCount} akun dihapus\n` +
        `${failedCount > 0 ? `⚠️ ${failedCount} siswa gagal dihapus` : ''}`;
      
      alert(resultMsg);
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('delete_all_students_filtered', 
          `Menghapus ${deletedCount} siswa dengan filter: ${filterDesc} (${deletedAuthCount} akun)`
        );
      }

      closeDeleteAllModal();
    } catch (error) {
      console.error('Delete all error:', error);
      alert('❌ Gagal menghapus data: ' + error.message);
    } finally {
      setDeleteAllLoading(false);
    }
  };

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="students-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Memuat data siswa...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="students-container">
        <div className="error-state">
          <div className="error-icon">❌</div>
          <h3>Gagal Memuat Data</h3>
          <p>{error}</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>🔄 Coba Lagi</button>
        </div>
      </div>
    );
  }

  const studentsToDeleteCount = getStudentsToDelete().length;
  const withAccountCount = getStudentsToDelete().filter(s => hasAccount(s.id, s.nama, s.email)).length;
  
  let filterButtonLabel = 'Semua Data';
  if (filterKelas !== 'all' && filterJurusan !== 'all') {
    filterButtonLabel = `Kelas ${filterKelas} & Jurusan ${filterJurusan}`;
  } else if (filterKelas !== 'all') {
    filterButtonLabel = `Kelas ${filterKelas}`;
  } else if (filterJurusan !== 'all') {
    filterButtonLabel = `Jurusan ${filterJurusan}`;
  } else if (searchTerm.trim() !== '') {
    filterButtonLabel = `"${searchTerm}"`;
  }

  const hideFilters = isSiswa;

  // Hitung siswa yang belum absen hari ini
  const today = new Date().toISOString().split('T')[0];
  const checkedInIds = new Set();
  attendanceData
    .filter(a => a.date === today && (a.status === 'Hadir' || a.status === 'Pulang'))
    .forEach(a => checkedInIds.add(a.studentId));
  const absentToday = filteredStudents.filter(s => !checkedInIds.has(s.id));

  return (
    <div className="students-container">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`students-toast ${toast.type}`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="students-header">
        <div className="header-left">
          <h1>👨‍🎓 Data Siswa</h1>
          <p className="header-subtitle">Kelola data siswa</p>
        </div>
        <div className="header-actions">
          {canAddStudent && (
            <button className="btn-add-student" onClick={openAddModal}>
              ➕ Tambah Siswa
            </button>
          )}
          {canDeleteAll && students.length > 0 && (
            <button 
              className="btn-delete-all" 
              onClick={openDeleteAllModal}
              style={{
                background: '#dc3545',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#c82333';
                e.target.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#dc3545';
                e.target.style.transform = 'scale(1)';
              }}
            >
              🗑️ Hapus {studentsToDeleteCount > 0 ? `(${studentsToDeleteCount})` : ''}
              {studentsToDeleteCount > 0 && studentsToDeleteCount < students.length && (
                <span style={{ fontSize: '10px', opacity: 0.8 }}>
                  ({filterButtonLabel})
                </span>
              )}
            </button>
          )}
          <div className="header-stats">
            <span className="stat-badge">👥 {stats.total} Siswa</span>
            <span className="stat-badge success">✅ {stats.withAccount} Berakun</span>
            <span className="stat-badge warning">❌ {stats.withoutAccount} Belum</span>
            <span className="stat-badge wa" style={{ background: '#25d366' }}>
              📱 {stats.withWA} WA
            </span>
          </div>
        </div>
      </div>

      {/* WhatsApp Status Banner */}
      {whatsappStatus.lastResult && (
        <div className="whatsapp-status-banner-students" style={{
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
              ? `WhatsApp terkirim ke ${whatsappStatus.lastResult.phoneNumber || 'nomor siswa'}`
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

      {/* Reminder Banner */}
      {canSendReminder && (
        <div className="reminder-banner-students" style={{
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
          </div>
          <button
            onClick={sendBulkReminderSiswa}
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

      {isDeveloper && (
        <div className="developer-banner" style={{
          background: 'linear-gradient(135deg, rgba(244,67,54,0.12), rgba(244,67,54,0.04))',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          border: '1px solid rgba(244,67,54,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '22px' }}>💻</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-muted)' }}>
              Status: <span style={{ color: '#f44336' }}>Developer Mode</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              👁️ Melihat semua data siswa
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#f44336', fontWeight: 'bold' }}>
              🗑️ Bisa hapus semua data
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ fontSize: '13px', color: '#ff9800', fontWeight: 'bold' }}>
              🔔 Bisa kirim pengingat
            </span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
            Total: {filteredStudents.length} siswa
          </span>
        </div>
      )}

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
            📊 Menampilkan data siswa sekelas Anda
          </span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="filter-container-students">
        <div className="search-group">
          <input
            type="text"
            placeholder="🔍 Cari nama atau ID siswa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input-students"
          />
        </div>
        
        {!hideFilters && (
          <>
            <div className="filter-group-students">
              <label>📚 Kelas</label>
              <select value={filterKelas} onChange={(e) => setFilterKelas(e.target.value)}>
                {kelasOptions.map(k => (
                  <option key={k} value={k}>{k === 'all' ? 'Semua Kelas' : k}</option>
                ))}
              </select>
            </div>
            <div className="filter-group-students">
              <label>🎓 Jurusan</label>
              <select value={filterJurusan} onChange={(e) => setFilterJurusan(e.target.value)}>
                {jurusanOptions.map(j => (
                  <option key={j} value={j}>{j === 'all' ? 'Semua Jurusan' : j}</option>
                ))}
              </select>
            </div>
          </>
        )}
        
        {isSiswa && (
          <div className="filter-info-students" style={{
            padding: '6px 12px',
            background: 'rgba(0,188,212,0.08)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            fontSize: '12px',
            color: 'var(--text-muted)'
          }}>
            <span>📚 Kelas: <strong style={{ color: '#00bcd4' }}>{studentInfo.kelas || user?.kelas || '-'}</strong></span>
            <span>🎓 Jurusan: <strong style={{ color: '#00bcd4' }}>{studentInfo.jurusan || user?.jurusan || '-'}</strong></span>
            <span>👥 {filteredStudents.length} siswa</span>
          </div>
        )}
      </div>

      {/* Table - Card View with Improved Photos */}
      <div className="table-container-students">
        {filteredStudents.length === 0 ? (
          <div className="empty-state-students">
            <span className="empty-icon">📭</span>
            <h3>Belum Ada Data Siswa</h3>
            <p>Belum ada data siswa yang ditemukan</p>
          </div>
        ) : (
          <div className="students-cards">
            {filteredStudents.map((student) => {
              // Get photo with improved function
              const photoUrl = getStudentPhoto(student.id, student.nama, student.email);
              const hasAcc = hasAccount(student.id, student.nama, student.email);
              const hasWA = getStudentPhoneNumber(student);
              
              // Get user auth for this student
              const userAuth = getUserAuthForStudent(student.id, student.nama, student.email);
              
              return (
                <div key={student.id} className="student-card">
                  <div className="card-header">
                    <div className="card-avatar">
                      <img 
                        src={photoUrl} 
                        alt={student.nama || 'Siswa'}
                        onError={(e) => {
                          const initial = student.nama ? student.nama.charAt(0).toUpperCase() : 'U';
                          e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=00bcd4&color=fff&size=64&bold=true`;
                        }}
                        style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: hasAcc ? '2px solid #4caf50' : '2px solid #ff9800'
                        }}
                      />
                      {hasAcc && <span className="card-badge" title="Memiliki akun">✅</span>}
                      {hasWA && <span className="card-badge-wa" title="WA terdaftar">📱</span>}
                    </div>
                    <div className="card-info">
                      <div className="card-name">{student.nama}</div>
                      <div className="card-id">ID: #{student.id}</div>
                      {userAuth && userAuth.photoUrl && userAuth.photoUrl !== 'null' && (
                        <div className="card-photo-status" style={{ fontSize: '11px', color: '#4caf50' }}>
                          📸 Foto tersedia
                        </div>
                      )}
                    </div>
                    <div className="card-status">
                      <span className={`status-badge ${hasAcc ? 'status-active' : 'status-inactive'}`}>
                        {hasAcc ? '✅ Berakun' : '❌ Belum'}
                      </span>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="card-row">
                      <span className="card-label">📚 Kelas</span>
                      <span className="card-value">{student.kelas || '-'}</span>
                    </div>
                    <div className="card-row">
                      <span className="card-label">🎓 Jurusan</span>
                      <span className="card-value">{student.jurusan || '-'}</span>
                    </div>
                    <div className="card-row">
                      <span className="card-label">⏰ Delay Pulang</span>
                      <span className="card-value">{student.delayOut || 60} menit</span>
                    </div>
                    <div className="card-row">
                      <span className="card-label">📱 WA Orang Tua</span>
                      <span className="card-value" style={{ color: hasWA ? '#25d366' : 'var(--text-muted)' }}>
                        {hasWA ? `${student.parentPhone || student.noHp || 'Terdaftar'} ✅` : '-'}
                      </span>
                    </div>
                    {userAuth && (
                      <div className="card-row">
                        <span className="card-label">📧 Email</span>
                        <span className="card-value" style={{ fontSize: '12px', color: '#4a90e2' }}>
                          {userAuth.email || '-'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="card-footer">
                    {!isSiswa && (
                      <>
                        {canEditAll && (
                          <button className="btn-edit-full" onClick={() => openEditModal(student)}>
                            ✏️ Edit
                          </button>
                        )}
                        {canEditKelasOnly && !canEditAll && (
                          <button className="btn-edit-kelas" onClick={() => openEditModal(student)}>
                            ✏️ Edit
                          </button>
                        )}
                        {canDelete && (
                          <button className="btn-delete" onClick={() => deleteStudent(student)}>
                            🗑️ Hapus
                          </button>
                        )}
                        {userAuth && userAuth.photoUrl && (
                          <button 
                            className="btn-refresh-photo"
                            onClick={() => refreshPhotoCache(student.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#4a90e2',
                              cursor: 'pointer',
                              fontSize: '12px',
                              padding: '4px 8px',
                              borderRadius: '4px'
                            }}
                            title="Refresh foto"
                          >
                            🔄 Refresh
                          </button>
                        )}
                      </>
                    )}
                    {isSiswa && (
                      <span className="view-only">🔍 Lihat Detail</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="students-footer">
        <span>🔄 Data real-time dari Firebase</span>
        <span>📱 {new Date().toLocaleString('id-ID')}</span>
        {isDeveloper && (
          <span style={{ color: '#f44336', fontWeight: 'bold' }}>
            💻 Developer Mode
          </span>
        )}
        {canSendReminder && !isDeveloper && (
          <span style={{ color: '#ff9800', fontWeight: 'bold' }}>
            🔔 Bisa kirim pengingat
          </span>
        )}
      </div>

      {/* Modal Tambah Siswa */}
      {showAddModal && (
        <div className="modal-overlay-students" onClick={closeAddModal}>
          <div className="modal-box-students" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-students">
              <div className="modal-header-left">
                <span className="modal-icon">➕</span>
                <h3>Tambah Siswa Baru</h3>
              </div>
              <button className="modal-close-students" onClick={closeAddModal}>✖</button>
            </div>
            <div className="modal-body-students">
              <div className="form-group-students">
                <label>🆔 ID Siswa *</label>
                <input
                  type="number"
                  name="id"
                  value={addForm.id}
                  onChange={handleAddChange}
                  placeholder="Masukkan ID siswa"
                  required
                />
                <small className="form-hint">ID harus unik dan berupa angka</small>
              </div>
              
              <div className="form-group-students">
                <label>👤 Nama Lengkap *</label>
                <input
                  type="text"
                  name="nama"
                  value={addForm.nama}
                  onChange={handleAddChange}
                  placeholder="Masukkan nama siswa"
                  required
                />
              </div>
              
              <div className="form-group-students">
                <label>📚 Kelas *</label>
                <select
                  name="kelas"
                  value={addForm.kelas}
                  onChange={handleAddChange}
                  required
                >
                  <option value="">Pilih Kelas</option>
                  {schoolConfig.classes.length > 0 ? (
                    schoolConfig.classes.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))
                  ) : (
                    [...new Set(students.map(s => s.kelas).filter(Boolean))].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))
                  )}
                </select>
              </div>
              
              <div className="form-group-students">
                <label>🎓 Jurusan</label>
                <select
                  name="jurusan"
                  value={addForm.jurusan}
                  onChange={handleAddChange}
                >
                  <option value="">Pilih Jurusan</option>
                  {schoolConfig.majors.length > 0 ? (
                    schoolConfig.majors.map(j => (
                      <option key={j} value={j}>{j}</option>
                    ))
                  ) : (
                    [...new Set(students.map(s => s.jurusan).filter(Boolean))].map(j => (
                      <option key={j} value={j}>{j}</option>
                    ))
                  )}
                </select>
              </div>
              
              <div className="form-group-students">
                <label>⏰ Delay Pulang (menit)</label>
                <input
                  type="number"
                  name="delayOut"
                  value={addForm.delayOut}
                  onChange={handleAddChange}
                  min="1"
                  max="300"
                />
              </div>
              
              <div className="form-group-students">
                <label>📱 WhatsApp Orang Tua *</label>
                <input
                  type="tel"
                  name="parentPhone"
                  value={addForm.parentPhone}
                  onChange={handleAddChange}
                  placeholder="Contoh: 08123456789"
                  required
                />
                <small className="form-hint">
                  Nomor WhatsApp orang tua/wali untuk notifikasi absensi (wajib diisi)
                </small>
              </div>
            </div>
            <div className="modal-footer-students">
              <button className="btn-cancel-students" onClick={closeAddModal}>Batal</button>
              <button 
                className="btn-save-students" 
                onClick={handleAddStudent}
                disabled={addLoading}
              >
                {addLoading ? '⏳ Menyimpan...' : '💾 Simpan Siswa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Siswa */}
      {showEditModal && (
        <div className="modal-overlay-students" onClick={closeEditModal}>
          <div className="modal-box-students" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-students">
              <div className="modal-header-left">
                <span className="modal-icon">✏️</span>
                <h3>{isStaff && !isFullAccess ? 'Edit Data Siswa' : 'Edit Data Siswa'}</h3>
              </div>
              <button className="modal-close-students" onClick={closeEditModal}>✖</button>
            </div>
            <div className="modal-body-students">
              <div className="form-group-students">
                <label>👤 Nama Lengkap</label>
                <input
                  type="text"
                  name="nama"
                  value={editForm.nama}
                  onChange={handleEditChange}
                  disabled={isStaff && !isFullAccess}
                  className={isStaff && !isFullAccess ? 'disabled' : ''}
                />
                {isStaff && !isFullAccess && (
                  <small className="form-hint">Hanya Admin/Wakil/Developer yang dapat mengubah nama</small>
                )}
              </div>
              
              <div className="form-group-students">
                <label>📚 Kelas</label>
                <select
                  name="kelas"
                  value={editForm.kelas}
                  onChange={handleEditChange}
                >
                  <option value="">Pilih Kelas</option>
                  {schoolConfig.classes.length > 0 ? (
                    schoolConfig.classes.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))
                  ) : (
                    [...new Set(students.map(s => s.kelas).filter(Boolean))].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))
                  )}
                </select>
              </div>
              
              {canEditAll && (
                <>
                  <div className="form-group-students">
                    <label>🎓 Jurusan</label>
                    <select
                      name="jurusan"
                      value={editForm.jurusan}
                      onChange={handleEditChange}
                    >
                      <option value="">Pilih Jurusan</option>
                      {schoolConfig.majors.length > 0 ? (
                        schoolConfig.majors.map(j => (
                          <option key={j} value={j}>{j}</option>
                        ))
                      ) : (
                        [...new Set(students.map(s => s.jurusan).filter(Boolean))].map(j => (
                          <option key={j} value={j}>{j}</option>
                        ))
                      )}
                    </select>
                  </div>
                  
                  <div className="form-group-students">
                    <label>⏰ Delay Pulang (menit)</label>
                    <input
                      type="number"
                      name="delayOut"
                      value={editForm.delayOut}
                      onChange={handleEditChange}
                      min="1"
                      max="300"
                    />
                  </div>
                </>
              )}

              {!isSiswa && (
                <div className="form-group-students">
                  <label>📱 WhatsApp Orang Tua *</label>
                  <input
                    type="tel"
                    name="parentPhone"
                    value={editForm.parentPhone || ''}
                    onChange={handleEditChange}
                    placeholder="Contoh: 08123456789"
                    required={!editForm.parentPhone}
                  />
                  <small className="form-hint">
                    Nomor WhatsApp orang tua/wali untuk notifikasi absensi
                    {isStaff && !isFullAccess && ' (dapat diedit oleh semua staff)'}
                  </small>
                </div>
              )}
            </div>
            <div className="modal-footer-students">
              <button className="btn-cancel-students" onClick={closeEditModal}>Batal</button>
              <button 
                className="btn-save-students" 
                onClick={handleUpdateStudent}
                disabled={editLoading}
              >
                {editLoading ? '⏳ Menyimpan...' : '💾 Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HAPUS SEMUA */}
      {showDeleteAllModal && canDeleteAll && (
        <div className="modal-overlay-students" onClick={closeDeleteAllModal}>
          <div className="modal-box-students" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header-students" style={{ borderBottom: '2px solid #dc3545' }}>
              <div className="modal-header-left">
                <span className="modal-icon" style={{ fontSize: '28px' }}>⚠️</span>
                <h3 style={{ color: '#dc3545' }}>
                  Hapus Siswa {studentsToDeleteCount === students.length ? 'Semua' : 'Dengan Filter'}
                </h3>
              </div>
              <button className="modal-close-students" onClick={closeDeleteAllModal}>✖</button>
            </div>
            <div className="modal-body-students">
              <div style={{ 
                background: '#fff3cd', 
                border: '1px solid #ffc107',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px'
              }}>
                <p style={{ margin: 0, color: '#856404', fontWeight: 'bold' }}>
                  ⚠️ PERINGATAN!
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#856404' }}>
                  Anda akan menghapus data siswa dengan filter berikut:
                </p>
                <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#856404', fontWeight: 'bold' }}>
                  📌 {filterButtonLabel}
                </p>
              </div>

              <div style={{ 
                background: '#f8d7da', 
                border: '1px solid #f5c6cb',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px'
              }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#721c24' }}>
                  📊 <strong>Jumlah siswa:</strong> {studentsToDeleteCount} siswa
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#721c24' }}>
                  👥 <strong>Dengan akun:</strong> {withAccountCount} siswa (akan dihapus juga)
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#721c24' }}>
                  📱 <strong>Dengan WA:</strong> {studentsToDeleteCount > 0 ? studentsToDeleteCount : 0} siswa
                </p>
                {studentsToDeleteCount < students.length && (
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#721c24', fontStyle: 'italic' }}>
                    💡 Total siswa di database: {students.length} siswa
                  </p>
                )}
              </div>

              <div className="form-group-students">
                <label style={{ fontWeight: 'bold', color: '#dc3545' }}>
                  🔑 Ketik <strong>"HAPUS SEMUA"</strong> untuk konfirmasi:
                </label>
                <input
                  type="text"
                  value={deleteAllConfirmText}
                  onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                  placeholder='Ketik "HAPUS SEMUA"'
                  style={{
                    borderColor: deleteAllConfirmText === 'HAPUS SEMUA' ? '#28a745' : '#dc3545',
                    background: deleteAllConfirmText === 'HAPUS SEMUA' ? '#d4edda' : '#fff'
                  }}
                />
                {deleteAllConfirmText === 'HAPUS SEMUA' && (
                  <small style={{ color: '#28a745', fontWeight: 'bold' }}>
                    ✅ Konfirmasi benar
                  </small>
                )}
                {deleteAllConfirmText !== 'HAPUS SEMUA' && deleteAllConfirmText !== '' && (
                  <small style={{ color: '#dc3545' }}>
                    ❌ Harus "HAPUS SEMUA"
                  </small>
                )}
              </div>

              <div style={{ 
                background: '#f8d7da', 
                border: '1px solid #f5c6cb',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                color: '#721c24'
              }}>
                <p style={{ margin: 0 }}>
                  💡 Tindakan ini akan menghapus:
                </p>
                <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                  <li>Data siswa di node <strong>users</strong> yang sesuai filter</li>
                  <li>Data akun siswa di node <strong>users_auth</strong> yang sesuai filter</li>
                  <li>Semua riwayat absensi yang terkait</li>
                  <li>Nomor WhatsApp orang tua juga akan dihapus</li>
                </ul>
                <p style={{ margin: '8px 0 0 0', fontWeight: 'bold', color: '#dc3545' }}>
                  ⛔ TIDAK DAPAT DIBATALKAN!
                </p>
              </div>
            </div>
            <div className="modal-footer-students" style={{ borderTop: '1px solid #dee2e6', paddingTop: '16px' }}>
              <button 
                className="btn-cancel-students" 
                onClick={closeDeleteAllModal}
                disabled={deleteAllLoading}
              >
                ❌ Batal
              </button>
              <button 
                className="btn-save-students" 
                onClick={handleDeleteAllStudents}
                disabled={deleteAllLoading || deleteAllConfirmText !== 'HAPUS SEMUA' || studentsToDeleteCount === 0}
                style={{
                  background: deleteAllConfirmText === 'HAPUS SEMUA' && studentsToDeleteCount > 0 ? '#dc3545' : '#6c757d',
                  cursor: deleteAllConfirmText === 'HAPUS SEMUA' && studentsToDeleteCount > 0 ? 'pointer' : 'not-allowed',
                  opacity: deleteAllConfirmText === 'HAPUS SEMUA' && studentsToDeleteCount > 0 ? 1 : 0.6
                }}
              >
                {deleteAllLoading ? '⏳ Menghapus...' : `🗑️ Hapus ${studentsToDeleteCount} Siswa`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentsTab;