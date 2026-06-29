// src/pages/tabs/UsersTab.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ref, onValue, set, remove, update, get } from 'firebase/database';
import { db } from '../../firebase/config';
import { auth } from '../../firebase/config';  // ✅ TAMBAHKAN
import { sendPasswordResetEmail } from 'firebase/auth';  // ✅ TAMBAHKAN
import './UserTab.css';

const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const UsersTab = ({ user }) => {
  // ==================== STATE ====================
  const [users, setUsers] = useState([]);
  const [usersAuth, setUsersAuth] = useState([]);
  const [staffData, setStaffData] = useState([]);
  const [siswaData, setSiswaData] = useState([]);
  const [allCodes, setAllCodes] = useState([]);
  const [attendanceData, setAttendanceData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('siswa');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedStudentData, setSelectedStudentData] = useState(null);
  const [selectedStaffData, setSelectedStaffData] = useState(null);
  const [searchUser, setSearchUser] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [showAllCodes, setShowAllCodes] = useState(true);
  const [copySuccess, setCopySuccess] = useState('');
  const [generatedCodesHistory, setGeneratedCodesHistory] = useState([]);
  const [availableStudents, setAvailableStudents] = useState([]);
  const [availableStaff, setAvailableStaff] = useState([]);
  const [filterCodeType, setFilterCodeType] = useState('all');
  const [filterCodeStatus, setFilterCodeStatus] = useState('all');
  const [isResetting, setIsResetting] = useState(false);
  
  // State untuk reset password
  const [resetLoading, setResetLoading] = useState({});
  const [resetResult, setResetResult] = useState({});

  // State untuk toast notification
  const [toast, setToast] = useState({ show: false, message: '', type: '' });

  // ==================== TOAST NOTIFICATION ====================
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: '' });
    }, 4000);
  };

  // ==================== ROLE PERMISSIONS ====================
  const canGenerateStudentCode = useMemo(() => {
    return user?.role && user?.role !== 'siswa';
  }, [user]);

  const canGenerateStaffCode = useMemo(() => {
    return ['developer', 'admin', 'wakil_kepala'].includes(user?.role);
  }, [user]);

  const canDeleteUser = useMemo(() => {
    return ['developer', 'admin'].includes(user?.role);
  }, [user]);

  const canViewAll = useMemo(() => {
    return ['developer', 'admin', 'wakil_kepala', 'staff_tu', 'guru'].includes(user?.role);
  }, [user]);

  const canDeleteCode = useMemo(() => {
    return ['developer', 'admin', 'wakil_kepala'].includes(user?.role);
  }, [user]);

  const canResetAll = useMemo(() => {
    return user?.role === 'developer';
  }, [user]);

  const canResetPassword = useMemo(() => {
    return ['developer', 'admin', 'wakil_kepala'].includes(user?.role);
  }, [user]);

  // ========== FUNGSI UNTUK MENENTUKAN ROLE YANG DAPAT DIUBAH ==========
  const getAvailableRolesForUser = useCallback((currentUserRole, targetUserRole) => {
    if (!currentUserRole) return [];

    if (currentUserRole === 'developer') {
      return ['siswa', 'guru', 'staff_tu', 'wakil_kepala', 'admin'];
    }

    if (currentUserRole === 'admin') {
      return ['siswa', 'guru', 'staff_tu', 'wakil_kepala'];
    }

    if (currentUserRole === 'wakil_kepala') {
      return ['siswa', 'guru'];
    }

    return [];
  }, []);

  // ========== FUNGSI UNTUK MENGUBAH ROLE USER ==========
  const handleRoleChange = async (uid, newRole) => {
    if (!user) {
      showToast('Anda harus login!', 'error');
      return;
    }

    const targetUser = usersAuth.find(u => u.uid === uid);
    if (!targetUser) {
      showToast('User tidak ditemukan!', 'error');
      return;
    }

    const isDeveloper = user.role === 'developer';
    const isAdmin = user.role === 'admin';
    const isWakil = user.role === 'wakil_kepala';

    if (isDeveloper && targetUser.role === 'developer') {
      showToast('⛔ Anda tidak dapat mengubah role Developer lain!', 'error');
      return;
    }

    if (isAdmin && (targetUser.role === 'admin' || targetUser.role === 'developer')) {
      showToast('⛔ Anda tidak dapat mengubah role Admin atau Developer!', 'error');
      return;
    }

    if (isWakil && !['siswa', 'guru'].includes(targetUser.role)) {
      showToast('⛔ Wakil Kepala hanya dapat mengubah role Siswa atau Guru!', 'error');
      return;
    }

    const availableRoles = getAvailableRolesForUser(user.role, targetUser.role);
    if (!availableRoles.includes(newRole)) {
      showToast(`⛔ Anda tidak memiliki izin untuk mengubah role menjadi ${newRole}!`, 'error');
      return;
    }

    const roleNames = {
      siswa: 'Siswa',
      guru: 'Guru',
      staff_tu: 'Staff TU',
      wakil_kepala: 'Wakil Kepala Sekolah',
      admin: 'Kepala Sekolah',
      developer: 'Developer'
    };

    if (!window.confirm(`⚠️ Yakin ingin mengubah role ${targetUser.name || targetUser.nama} dari ${roleNames[targetUser.role] || targetUser.role} menjadi ${roleNames[newRole] || newRole}?`)) {
      return;
    }

    try {
      await update(ref(db, `users_auth/${uid}`), {
        role: newRole,
        updatedAt: Date.now()
      });

      showToast(`✅ Role berhasil diubah menjadi ${roleNames[newRole] || newRole}`, 'success');

      if (typeof window.logActivity === 'function') {
        window.logActivity('update_user_role', `Mengubah role ${targetUser.name || targetUser.nama} dari ${targetUser.role} menjadi ${newRole}`);
      }

      setUsersAuth(prev =>
        prev.map(u => u.uid === uid ? { ...u, role: newRole } : u)
      );

    } catch (err) {
      console.error('Error updating role:', err);
      showToast('❌ Gagal mengubah role: ' + err.message, 'error');
    }
  };

  // ==================== AMBIL DATA DARI FIREBASE ====================
  useEffect(() => {
    let isMounted = true;
    const unsubscribeList = [];

    console.log('📡 UsersTab: Starting Firebase listeners...');

    // ========== 1. AMBIL DATA SISWA (node 'siswa') ==========
    const siswaRef = ref(db, 'siswa');
    const unsubSiswa = onValue(siswaRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object') {
            list.push({
              id: String(key),
              ...item,
              name: item.nama || item.name || `Siswa-${key}`,
              kelas: item.kelas || '-',
              jurusan: item.jurusan || '-',
              _source: 'siswa'
            });
          }
        });
      }
      console.log(`📊 Siswa data: ${list.length} siswa ditemukan`);
      setSiswaData(list);
    }, (error) => {
      console.error('❌ Error fetching siswa:', error);
    });
    unsubscribeList.push(unsubSiswa);

    // ========== 2. AMBIL DATA USERS ==========
    const usersRef = ref(db, 'users');
    const unsubUsers = onValue(usersRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object') {
            // ⭐ EXCLUDE DEVELOPER DARI DATA USERS ⭐
            if (item.jabatan && item.jabatan === 'developer') return;
            
            list.push({
              id: String(key),
              ...item,
              name: item.nama || item.name || `User-${key}`,
              kelas: item.kelas || '-',
              jurusan: item.jurusan || '-',
              _source: 'users'
            });
          }
        });
      }
      console.log(`📊 Users data: ${list.length} user ditemukan`);
      setUsers(list);
    }, (error) => {
      console.error('❌ Error fetching users:', error);
    });
    unsubscribeList.push(unsubUsers);

    // ========== 3. AMBIL DATA STAFF ==========
    const staffRef = ref(db, 'staff');
    const unsubStaff = onValue(staffRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object') {
            // ⭐ EXCLUDE DEVELOPER DARI DATA STAFF ⭐
            if (item.jabatan && item.jabatan === 'developer') return;
            
            list.push({
              id: String(key),
              ...item,
              name: item.nama || item.name || `Staff-${key}`,
              jabatan: item.jabatan || 'guru',
              departemen: item.departemen || '-',
              email: item.email || '',
              noHp: item.noHp || '',
              _source: 'staff'
            });
          }
        });
      }
      console.log(`📊 Staff data: ${list.length} staff ditemukan`);
      setStaffData(list);
    }, (error) => {
      console.error('❌ Error fetching staff:', error);
    });
    unsubscribeList.push(unsubStaff);

    // ========== 4. AMBIL DATA USERS_AUTH ==========
    const usersAuthRef = ref(db, 'users_auth');
    const unsubAuth = onValue(usersAuthRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object') {
            // ⭐ EXCLUDE DEVELOPER DARI USERS_AUTH ⭐
            if (item.role && item.role === 'developer') return;
            
            list.push({
              uid: String(key),
              ...item,
              name: item.nama || item.name || 'User',
              email: item.email || '-',
              phoneNumber: item.noHp || item.phoneNumber || '-',
              _source: 'users_auth'
            });
          }
        });
      }
      console.log(`📊 Users Auth: ${list.length} user terdaftar`);
      setUsersAuth(list);
      setLoading(false);
    }, (error) => {
      console.error('❌ Error fetching users_auth:', error);
      setLoading(false);
    });
    unsubscribeList.push(unsubAuth);

    // ========== 5. AMBIL DATA CODES ==========
    const codesRef = ref(db, 'codes');
    const unsubCodes = onValue(codesRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      const list = [];
      if (data) {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && typeof item === 'object') {
            // ⭐ EXCLUDE CODE UNTUK DEVELOPER ⭐
            if (item.targetRole && item.targetRole === 'developer') return;
            
            list.push({
              code: key,
              ...item,
              linkedId: item.linkedId ? String(item.linkedId) : null,
              linkedEmail: item.linkedEmail || '',
              createdAt: item.createdAt || Date.now()
            });
          }
        });
      }
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      console.log(`📊 Codes data: ${list.length} kode ditemukan`);
      setAllCodes(list);
    }, (error) => {
      console.error('❌ Error fetching codes:', error);
    });
    unsubscribeList.push(unsubCodes);

    // ========== 6. AMBIL DATA ABSENSI SISWA ==========
    const attendanceRef = ref(db, 'absensi');
    const unsubAttendance = onValue(attendanceRef, (snapshot) => {
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
      console.log(`📊 Attendance data loaded: ${list.length} records`);
    }, (error) => {
      console.error('❌ Error fetching attendance:', error);
    });
    unsubscribeList.push(unsubAttendance);

    return () => {
      isMounted = false;
      unsubscribeList.forEach(unsub => {
        try { unsub(); } catch (e) {}
      });
    };
  }, []);

  // ==================== UPDATE AVAILABLE STUDENTS & STAFF ====================
  useEffect(() => {
    console.log('🔄 Calculating available students and staff...');
    console.log('📊 Input data:', {
      siswaData: siswaData.length,
      users: users.length,
      staffData: staffData.length,
      usersAuth: usersAuth.length,
      allCodes: allCodes.length
    });

    // ===== AVAILABLE STUDENTS =====
    const allStudents = [...siswaData];
    
    const existingStudentIds = new Set(siswaData.map(s => s.id?.toString()));
    
    users.forEach(u => {
      const idStr = u.id?.toString() || '';
      if (!existingStudentIds.has(idStr) && 
          u.name && 
          u.name !== 'Tidak Diketahui' &&
          u.name.trim() !== '' &&
          (u.kelas || u.jurusan)) {
        allStudents.push(u);
        console.log(`➕ Menambahkan user ke allStudents:`, { id: idStr, name: u.name, kelas: u.kelas });
      }
    });
    
    const uniqueStudents = [];
    const seenIds = new Set();
    allStudents.forEach(s => {
      const id = s.id?.toString() || '';
      if (id && !seenIds.has(id) && s.name) {
        seenIds.add(id);
        uniqueStudents.push(s);
      }
    });

    console.log(`📋 Unique students: ${uniqueStudents.length} siswa`);

    const registeredIds = new Set();
    usersAuth.forEach(a => {
      if (a.fpId) registeredIds.add(a.fpId.toString());
      if (a.userId) registeredIds.add(a.userId.toString());
      if (a.uid) registeredIds.add(a.uid.toString());
    });

    console.log(`📋 Registered IDs:`, Array.from(registeredIds));

    const studentsWithCode = new Set();
    allCodes.forEach(c => {
      if (!c.used && c.type === 'siswa' && c.linkedId) {
        studentsWithCode.add(c.linkedId.toString());
      }
    });

    console.log(`📋 Students with code:`, Array.from(studentsWithCode));

    const available = uniqueStudents.filter(s => {
      const idStr = s.id?.toString() || '';
      
      const isStaff = s.jabatan && s.jabatan !== '' && s.jabatan !== 'siswa';
      if (isStaff) {
        console.log(`⛔ Skipping staff: ${s.name} (${s.jabatan})`);
        return false;
      }
      
      const hasAccount = registeredIds.has(idStr);
      if (hasAccount) {
        console.log(`⛔ Skipping ${s.name}: already has account`);
        return false;
      }
      
      const hasActiveCode = studentsWithCode.has(idStr);
      if (hasActiveCode) {
        console.log(`⛔ Skipping ${s.name}: already has active code`);
        return false;
      }
      
      const validRoles = ['siswa', '', null, undefined];
      if (s.jabatan && !validRoles.includes(s.jabatan.toLowerCase())) {
        console.log(`⛔ Skipping ${s.name}: invalid role (${s.jabatan})`);
        return false;
      }
      
      console.log(`✅ Available student: ${s.name} (${s.id})`);
      return true;
    });

    console.log(`🎓 Available students: ${available.length} dari ${uniqueStudents.length} total siswa`);
    console.log('🎓 Available students details:', available.map(s => ({ id: s.id, name: s.name, kelas: s.kelas })));
    setAvailableStudents(available);

    // ===== AVAILABLE STAFF =====
    const registeredEmails = new Set();
    const registeredIdsStaff = new Set();
    usersAuth.forEach(a => {
      if (a.email) registeredEmails.add(a.email.toLowerCase());
      if (a.fpId) registeredIdsStaff.add(a.fpId.toString());
      if (a.userId) registeredIdsStaff.add(a.userId.toString());
    });

    const staffWithCode = new Set();
    allCodes.forEach(c => {
      if (!c.used && (c.type === 'guru' || c.type === 'staff' || c.type === 'staff_tu' || c.type === 'wakil_kepala') && c.linkedId) {
        staffWithCode.add(c.linkedId.toString());
      }
    });

    const availableStaffList = staffData.filter(s => {
      const idStr = s.id?.toString() || '';
      const email = s.email?.toLowerCase() || '';
      
      if (!email || email === '') {
        return false;
      }
      
      const hasAccount = registeredEmails.has(email) || 
                         registeredIdsStaff.has(idStr) ||
                         registeredIdsStaff.has(s.userId?.toString() || '');
      
      const hasActiveCode = staffWithCode.has(idStr);
      
      return !hasAccount && !hasActiveCode && s.name;
    });

    console.log(`👔 Available staff: ${availableStaffList.length} dari ${staffData.length} total staff`);
    setAvailableStaff(availableStaffList);

  }, [users, siswaData, staffData, usersAuth, allCodes]);

  // ==================== FILTERED CODES ====================
  const filteredCodes = useMemo(() => {
    let result = [...allCodes];
    
    if (filterCodeType !== 'all') {
      result = result.filter(c => c.type === filterCodeType);
    }
    
    if (filterCodeStatus === 'active') {
      result = result.filter(c => !c.used);
    } else if (filterCodeStatus === 'used') {
      result = result.filter(c => c.used);
    }
    
    return result;
  }, [allCodes, filterCodeType, filterCodeStatus]);

  // ==================== HANDLE STUDENT SELECT ====================
  const handleStudentSelect = (studentId) => {
    setSelectedStudentId(studentId);
    if (studentId) {
      let student = siswaData.find(s => s.id?.toString() === studentId.toString());
      if (!student) {
        student = users.find(s => s.id?.toString() === studentId.toString());
      }
      setSelectedStudentData(student || null);
      console.log('📋 Selected student:', student);
    } else {
      setSelectedStudentData(null);
    }
  };

  // ==================== HANDLE STAFF SELECT ====================
  const handleStaffSelect = (staffId) => {
    setSelectedStaffId(staffId);
    if (staffId) {
      const staff = staffData.find(s => s.id?.toString() === staffId.toString());
      setSelectedStaffData(staff || null);
      console.log('📋 Selected staff:', staff);
    } else {
      setSelectedStaffData(null);
    }
  };

  // ==================== GENERATE KODE ====================
  const generateCode = async () => {
    if (selectedTarget === 'siswa' && !canGenerateStudentCode) {
      showToast('⛔ Hanya Admin, Guru, Wakil Kepala, Staff TU, dan Developer yang dapat generate kode siswa!', 'error');
      return;
    }
    if (selectedTarget === 'staff' && !canGenerateStaffCode) {
      showToast('⛔ Hanya Kepala Sekolah, Wakil Kepala, dan Developer yang dapat generate kode staff!', 'error');
      return;
    }

    if (selectedTarget === 'siswa') {
      if (!selectedStudentId) {
        showToast('⚠️ HARAP PILIH SISWA TERLEBIH DAHULU!', 'error');
        return;
      }
      
      const student = selectedStudentData;
      
      if (!student) {
        showToast(`❌ Data siswa tidak ditemukan! ID: ${selectedStudentId}`, 'error');
        return;
      }

      const hasAccount = usersAuth.some(a => 
        a.fpId?.toString() === selectedStudentId.toString() || 
        a.userId?.toString() === selectedStudentId.toString() ||
        a.uid?.toString() === selectedStudentId.toString()
      );
      if (hasAccount) {
        showToast(`❌ Siswa ${student.name} sudah memiliki akun!`, 'error');
        return;
      }

      const hasActiveCode = allCodes.some(c => 
        !c.used && c.type === 'siswa' && c.linkedId?.toString() === selectedStudentId.toString()
      );
      if (hasActiveCode) {
        showToast(`❌ Siswa ${student.name} masih memiliki kode aktif! Hapus kode lama terlebih dahulu.`, 'error');
        return;
      }

      await generateStudentCode(student);
    } else if (selectedTarget === 'staff') {
      if (!selectedStaffId) {
        showToast('⚠️ HARAP PILIH STAFF TERLEBIH DAHULU!', 'error');
        return;
      }
      
      const staff = selectedStaffData;
      if (!staff) {
        showToast('❌ Data staff tidak ditemukan!', 'error');
        return;
      }

      if (!staff.email || staff.email === '') {
        showToast(`❌ Staff ${staff.name} tidak memiliki email! Silakan edit data staff dan isi email terlebih dahulu.`, 'error');
        return;
      }

      const hasAccount = usersAuth.some(a => 
        (a.email && a.email.toLowerCase() === staff.email?.toLowerCase()) ||
        a.fpId?.toString() === selectedStaffId.toString() ||
        a.userId?.toString() === selectedStaffId.toString() ||
        a.uid?.toString() === selectedStaffId.toString()
      );
      
      if (hasAccount) {
        showToast(`❌ Staff ${staff.name} sudah memiliki akun dengan email ${staff.email}!`, 'error');
        return;
      }

      const hasActiveCode = allCodes.some(c => 
        !c.used && (c.type === 'guru' || c.type === 'staff' || c.type === 'staff_tu' || c.type === 'wakil_kepala') && c.linkedId?.toString() === selectedStaffId.toString()
      );
      if (hasActiveCode) {
        showToast(`❌ Staff ${staff.name} masih memiliki kode aktif! Hapus kode lama terlebih dahulu.`, 'error');
        return;
      }

      await generateStaffCode(staff);
    }
  };

  const generateStudentCode = async (student) => {
    setGenerating(true);
    try {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      const code = `REG-${timestamp.slice(-3)}${random}`;
      
      const codeData = {
        used: false,
        createdAt: Date.now(),
        type: 'siswa',
        createdBy: user?.name || user?.email || 'System',
        createdRole: user?.role || 'system',
        linkedId: student.id?.toString() || '',
        requireId: true,
        nama: student.name,
        kelas: student.kelas || '-',
        jurusan: student.jurusan || '-',
        noHp: student.noHp || student.parentPhone || ''
      };

      await set(ref(db, `codes/${code}`), codeData);

      setGeneratedCode(code);
      setGeneratedCodesHistory(prev => [code, ...prev].slice(0, 10));
      setShowCodeModal(true);
      
      showToast(`✅ Kode untuk ${student.name} berhasil dibuat!`, 'success');

      const codesSnapshot = await get(ref(db, 'codes'));
      const codesData = codesSnapshot.val();
      const codeList = [];
      if (codesData) {
        Object.keys(codesData).forEach(key => {
          const item = codesData[key];
          if (item && typeof item === 'object' && item.targetRole !== 'developer') {
            codeList.push({
              code: key,
              ...item,
              linkedId: item.linkedId ? String(item.linkedId) : null,
              linkedEmail: item.linkedEmail || '',
              createdAt: item.createdAt || Date.now()
            });
          }
        });
        codeList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setAllCodes(codeList);
      }

    } catch (err) {
      console.error('Generate code error:', err);
      showToast('❌ Gagal membuat kode: ' + err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const generateStaffCode = async (staff) => {
    setGenerating(true);
    try {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      const code = `REG-${timestamp.slice(-3)}${random}`;
      
      let targetRole = 'guru';
      let typeDisplay = 'GURU';
      if (staff.jabatan === 'kepala_sekolah') {
        targetRole = 'admin';
        typeDisplay = 'KEPALA SEKOLAH';
      } else if (staff.jabatan === 'wakil_kepala') {
        targetRole = 'wakil_kepala';
        typeDisplay = 'WAKIL KEPALA';
      } else if (staff.jabatan === 'staff_tu') {
        targetRole = 'staff_tu';
        typeDisplay = 'STAFF TU';
      }

      const codeData = {
        used: false,
        createdAt: Date.now(),
        type: 'staff',
        createdBy: user?.name || user?.email || 'System',
        createdRole: user?.role || 'system',
        linkedId: staff.id?.toString() || '',
        linkedEmail: staff.email || '',
        linkedName: staff.name,
        targetRole: targetRole,
        requireId: true,
        staffJabatan: staff.jabatan,
        nama: staff.name,
        email: staff.email || '',
        roleLabel: typeDisplay,
        noHp: staff.noHp || ''
      };

      await set(ref(db, `codes/${code}`), codeData);

      setGeneratedCode(code);
      setGeneratedCodesHistory(prev => [code, ...prev].slice(0, 10));
      setShowCodeModal(true);
      
      showToast(`✅ Kode untuk ${staff.name} (${typeDisplay}) berhasil dibuat!`, 'success');

      const codesSnapshot = await get(ref(db, 'codes'));
      const codesData = codesSnapshot.val();
      const codeList = [];
      if (codesData) {
        Object.keys(codesData).forEach(key => {
          const item = codesData[key];
          if (item && typeof item === 'object' && item.targetRole !== 'developer') {
            codeList.push({
              code: key,
              ...item,
              linkedId: item.linkedId ? String(item.linkedId) : null,
              linkedEmail: item.linkedEmail || '',
              createdAt: item.createdAt || Date.now()
            });
          }
        });
        codeList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setAllCodes(codeList);
      }

    } catch (err) {
      console.error('Generate code error:', err);
      showToast('❌ Gagal membuat kode: ' + err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  // ==================== DELETE CODE ====================
  const deleteCode = async (code) => {
    if (!canDeleteCode) {
      showToast('⛔ Hanya Developer, Kepala Sekolah, dan Wakil Kepala yang dapat menghapus kode!', 'error');
      return;
    }

    const codeData = allCodes.find(c => c.code === code);
    const typeDisplay = codeData?.type === 'siswa' ? 'SISWA' : 'STAFF';
    const linkedInfo = codeData?.linkedName ? ` - ${codeData.linkedName}` : '';
    const statusText = codeData?.used ? '🔴 Terpakai' : '✅ Tersedia';
    
    if (!window.confirm(`⚠️ Yakin ingin menghapus kode: ${typeDisplay}${linkedInfo}\nKode: ${code}\nStatus: ${statusText}\n\nKode yang dihapus tidak dapat digunakan lagi!`)) return;
    
    try {
      await remove(ref(db, `codes/${code}`));
      showToast(`✅ Kode ${code} berhasil dihapus`, 'success');
      setAllCodes(prev => prev.filter(c => c.code !== code));
    } catch (err) {
      console.error('Delete code error:', err);
      showToast('❌ Gagal menghapus kode: ' + err.message, 'error');
    }
  };

  // ==================== DELETE USER ====================
  const deleteUser = async (uid, name) => {
    if (!canDeleteUser) {
      showToast('⛔ Hanya Kepala Sekolah dan Developer yang dapat menghapus user!', 'error');
      return;
    }
    
    if (user?.uid === uid) {
      showToast('❌ Anda tidak dapat menghapus akun sendiri!', 'error');
      return;
    }

    const targetUser = usersAuth.find(u => u.uid === uid);
    if (targetUser?.role === 'developer') {
      showToast('⛔ Akun Developer tidak dapat dihapus!', 'error');
      return;
    }

    if (!window.confirm(`⚠️ Yakin ingin menghapus user: ${name}?\n\nTINDAKAN INI TIDAK DAPAT DIBATALKAN!`)) return;

    try {
      await remove(ref(db, `users_auth/${uid}`));
      showToast(`✅ User "${name}" berhasil dihapus.`, 'success');
      
      setUsersAuth(prev => prev.filter(u => u.uid !== uid));
      
      const usersSnapshot = await get(ref(db, 'users'));
      const usersData = usersSnapshot.val();
      const userList = [];
      if (usersData) {
        Object.keys(usersData).forEach(key => {
          const item = usersData[key];
          if (item && typeof item === 'object' && item.jabatan !== 'developer') {
            userList.push({
              id: String(key),
              ...item,
              name: item.nama || item.name || `User-${key}`,
              kelas: item.kelas || '-',
              jurusan: item.jurusan || '-',
              _source: 'users'
            });
          }
        });
        setUsers(userList);
      }

    } catch (err) {
      console.error('Delete user error:', err);
      showToast('❌ Gagal menghapus user: ' + err.message, 'error');
    }
  };

  // ==================== SEND RESET PASSWORD (EMAIL + WHATSAPP) ====================
  // ✅ SUDAH DIPERBAIKI - Menggunakan import dari atas
  const sendResetPassword = async (uid, name, email, phoneNumber) => {
    if (!email || email === '-') {
      showToast('❌ Email tidak ditemukan!', 'error');
      return;
    }

    if (!canResetPassword) {
      showToast('⛔ Hanya Developer, Kepala Sekolah, dan Wakil Kepala yang dapat mereset password!', 'error');
      return;
    }

    setResetLoading(prev => ({ ...prev, [uid]: true }));
    setResetResult(prev => ({ ...prev, [uid]: '' }));

    try {
      const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
      
      // ✅ LANGSUNG PAKAI sendPasswordResetEmail YANG SUDAH DI IMPORT
      const actionCodeSettings = {
        url: window.location.origin + '/login',
        handleCodeInApp: false
      };
      
      await sendPasswordResetEmail(auth, email, actionCodeSettings);

      let phoneToUse = phoneNumber || '';
      
      if (!phoneToUse || phoneToUse === '-') {
        const staff = staffData.find(s => s.email === email);
        if (staff && staff.noHp && staff.noHp !== '') {
          phoneToUse = staff.noHp;
        }
      }
      
      if (!phoneToUse || phoneToUse === '-') {
        const student = siswaData.find(s => s.email === email);
        if (student && student.parentPhone && student.parentPhone !== '') {
          phoneToUse = student.parentPhone;
        }
      }
      
      if (!phoneToUse || phoneToUse === '-') {
        const userAuth = usersAuth.find(u => u.uid === uid);
        if (userAuth && (userAuth.noHp || userAuth.phoneNumber)) {
          phoneToUse = userAuth.noHp || userAuth.phoneNumber || '';
        }
      }

      let whatsappSent = false;
      
      if (phoneToUse && phoneToUse !== '-' && phoneToUse !== '') {
        const formattedPhone = phoneToUse.replace(/\D/g, '');
        
        if (formattedPhone.length >= 10) {
          const whatsappMessage = 
            `*🔑 RESET PASSWORD - ${schoolName}*\n\n` +
            `Halo *${name || 'User'}*,\n\n` +
            `Kami menerima permintaan untuk mereset password akun Anda.\n\n` +
            `📧 *Email:* ${email}\n\n` +
            `✅ *Link reset password telah dikirim ke email Anda.*\n` +
            `Silakan cek email ${email} untuk link reset password.\n\n` +
            `📌 *Langkah-langkah:*\n` +
            `1️⃣ Buka email dari Firebase Authentication\n` +
            `2️⃣ Klik link reset password\n` +
            `3️⃣ Masukkan password baru\n` +
            `4️⃣ Login dengan password baru\n\n` +
            `Jika Anda tidak meminta reset password, abaikan pesan ini.\n\n` +
            `---\n` +
            `📱 *Sistem Absensi IoT*\n` +
            `🔔 Notifikasi ini dikirim secara otomatis.`;

          try {
            const response = await fetch(`${API_BASE_URL}/whatsapp/send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                phoneNumber: formattedPhone,
                message: whatsappMessage,
                name: name || 'User'
              })
            });

            const result = await response.json();
            if (result.success) {
              whatsappSent = true;
            }
          } catch (waError) {
            console.warn('⚠️ WhatsApp send error:', waError);
          }
        }
      }

      const resultMsg = `✅ Link reset password telah dikirim ke email ${email}` + 
        (whatsappSent ? ` dan WhatsApp (${phoneToUse})` : '') +
        (phoneToUse && phoneToUse !== '-' && !whatsappSent ? ' (WhatsApp gagal dikirim - cek nomor)' : '') +
        (!phoneToUse || phoneToUse === '-' ? ' (Tidak ada nomor WhatsApp untuk dikirim)' : '');
      
      setResetResult(prev => ({ ...prev, [uid]: resultMsg }));
      showToast(resultMsg, 'success');

      if (typeof window.logActivity === 'function') {
        window.logActivity('send_reset_password', `Mengirim link reset password ke ${name || email} (${email}) - WhatsApp: ${whatsappSent ? '✅' : '❌'}`);
      }

    } catch (err) {
      console.error('Reset password error:', err);
      
      let errorMsg = '❌ Gagal mengirim link reset: ';
      if (err.code === 'auth/user-not-found') {
        errorMsg += 'Email tidak terdaftar!';
      } else if (err.code === 'auth/too-many-requests') {
        errorMsg += 'Terlalu banyak permintaan. Coba lagi nanti!';
      } else {
        errorMsg += err.message || 'Unknown error';
      }
      
      setResetResult(prev => ({ ...prev, [uid]: errorMsg }));
      showToast(errorMsg, 'error');
    } finally {
      setResetLoading(prev => ({ ...prev, [uid]: false }));
      
      setTimeout(() => {
        setResetResult(prev => ({ ...prev, [uid]: '' }));
      }, 5000);
    }
  };

  // ==================== RESET ALL (HANYA DEVELOPER) ====================
  const resetAllData = async () => {
    if (!canResetAll) {
      showToast('⛔ Hanya Developer yang dapat melakukan reset all!', 'error');
      return;
    }

    const confirmMessage = 
      '🚨 PERINGATAN BERAT! 🚨\n\n' +
      'Anda akan menghapus SEMUA data berikut:\n' +
      '• Data Siswa (node siswa & users)\n' +
      '• Data Staff (node staff)\n' +
      '• Data User Auth (node users_auth) - SEMUA termasuk staff yang punya akun\n' +
      '• Data Foto Profil User (photoUrl di users_auth)\n' +
      '• Data Absensi Staff (node staff_attendance)\n' +
      '• Data Absensi Siswa (node attendance)\n' +
      '• Kode Registrasi (node codes)\n' +
      '• Logo Sekolah (system_config/schoolLogo)\n' +
      '• Nama Sekolah (system_config/schoolName)\n\n' +
      '⚠️ TINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\n' +
      'Ketik "RESET ALL" untuk konfirmasi:';

    if (!window.confirm(confirmMessage)) return;

    const confirmation = prompt('Ketik "RESET ALL" untuk konfirmasi:');
    if (confirmation !== "RESET ALL") {
      showToast('❌ Reset dibatalkan', 'info');
      return;
    }

    setIsResetting(true);

    try {
      await remove(ref(db, 'siswa'));
      await remove(ref(db, 'users'));
      await remove(ref(db, 'staff'));
      await remove(ref(db, 'staff_attendance'));
      await remove(ref(db, 'absensi'));
      await remove(ref(db, 'attendance'));
      
      const authSnapshot = await get(ref(db, 'users_auth'));
      const authData = authSnapshot.val();
      
      if (authData) {
        const developerEmail = 'zaki5go@gmail.com';
        const developerUid = Object.keys(authData).find(uid => 
          authData[uid].email === developerEmail
        );
        
        for (const uid of Object.keys(authData)) {
          if (uid !== developerUid) {
            await remove(ref(db, `users_auth/${uid}`));
          }
        }
      }

      await remove(ref(db, 'codes'));
      await remove(ref(db, 'system_config/schoolLogo'));
      await set(ref(db, 'system_config/schoolName'), 'Sistem Absensi');
      
      await set(ref(db, 'school_config'), {
        type: 'smp',
        classes: ['VII', 'VIII', 'IX'],
        majors: []
      });

      try { await remove(ref(db, 'staff_izin')); } catch (e) {}
      try { await remove(ref(db, 'izin')); } catch (e) {}
      try { await remove(ref(db, 'fingerprint_users')); } catch (e) {}
      try { await remove(ref(db, 'whatsapp_logs')); } catch (e) {}

      showToast('✅ RESET ALL BERHASIL! Silakan refresh halaman.', 'success');

      setUsersAuth([]);
      setUsers([]);
      setStaffData([]);
      setSiswaData([]);
      setAllCodes([]);
      setAttendanceData([]);
      setAvailableStudents([]);
      setAvailableStaff([]);

      setTimeout(() => {
        window.location.reload();
      }, 3000);

    } catch (err) {
      console.error('Reset all error:', err);
      showToast('❌ Gagal reset all: ' + err.message, 'error');
    } finally {
      setIsResetting(false);
    }
  };

  // ==================== COPY TO CLIPBOARD ====================
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(`✅ "${text}" disalin!`);
      setTimeout(() => setCopySuccess(''), 3000);
    });
  };

  // ==================== GET ROLE INFO ====================
  const getRoleDisplayName = (role) => {
    const names = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala Sekolah',
      staff_tu: 'Staff TU',
      guru: 'Guru',
      siswa: 'Siswa'
    };
    return names[role] || role;
  };

  const getRoleIcon = (role) => {
    const icons = {
      developer: '💻',
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

  // ==================== FILTER USERS ====================
  const filteredUsers = useMemo(() => {
    let result = [...usersAuth];
    
    if (filterRole !== 'all') {
      result = result.filter(u => u.role === filterRole);
    }
    
    if (searchUser) {
      const search = searchUser.toLowerCase();
      result = result.filter(u =>
        (u.name && u.name.toLowerCase().includes(search)) ||
        (u.email && u.email.toLowerCase().includes(search)) ||
        (u.uid && u.uid.toLowerCase().includes(search))
      );
    }
    
    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return result;
  }, [usersAuth, filterRole, searchUser]);

  // ==================== GET STUDENT PHONE ====================
  const getStudentPhone = (student) => {
    if (!student) return null;
    return student.parentPhone || student.noHp || null;
  };

  // ==================== RENDER ====================
  if (!canViewAll) {
    return (
      <div className="users-tab-container">
        <div className="users-tab-header">
          <h2>🔐 Manajemen User</h2>
        </div>
        <div className="users-access-denied">
          <div className="access-denied-icon">⛔</div>
          <h3>Akses Ditolak</h3>
          <p>Anda tidak memiliki izin untuk mengakses halaman ini.</p>
          <p className="access-role">Role: {user?.role || 'Unknown'}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="users-tab-container">
        <div className="users-tab-header">
          <h2>👥 Manajemen User</h2>
        </div>
        <div className="users-loading">
          <div className="loading-spinner"></div>
          <p>⏳ Memuat data user...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="users-tab-container">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`users-toast ${toast.type}`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="users-tab-header">
        <h2>👥 Manajemen User</h2>
        <div className="header-user-info">
          <span className="user-name">{user?.name || user?.email}</span>
          <span className="user-role-badge" style={{ background: getRoleColor(user?.role) }}>
            {getRoleIcon(user?.role)} {getRoleDisplayName(user?.role)}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="users-stats-grid">
        <div className="stat-item">
          <span className="stat-value">{usersAuth.length}</span>
          <span className="stat-label">👥 Total User</span>
        </div>
        <div className="stat-item" style={{ borderLeft: '3px solid #f39c12' }}>
          <span className="stat-value">{availableStudents.length}</span>
          <span className="stat-label">🎓 Siswa Belum Akun</span>
        </div>
        <div className="stat-item" style={{ borderLeft: '3px solid #9b59b6' }}>
          <span className="stat-value">{availableStaff.length}</span>
          <span className="stat-label">👔 Staf Belum Akun</span>
        </div>
        <div className="stat-item" style={{ borderLeft: '3px solid #4caf50' }}>
          <span className="stat-value">{allCodes.filter(c => !c.used).length}</span>
          <span className="stat-label">🔑 Kode Aktif</span>
        </div>
      </div>

      {/* Generate Code Section */}
      {(canGenerateStudentCode || canGenerateStaffCode) && (
        <div className="generate-code-section" style={{
          background: 'linear-gradient(135deg, rgba(76,175,80,0.08), rgba(76,175,80,0.02))',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px',
          border: '1px solid rgba(76,175,80,0.2)'
        }}>
          <div className="section-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              🔑 Hasilkan Kode Registrasi
            </h3>
            <p className="section-desc" style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              Pilih siswa/staff yang belum punya akun, lalu generate kode
            </p>
          </div>

          <div className="generate-code-form" style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'flex-end'
          }}>
            <div className="form-group" style={{ flex: '1', minWidth: '150px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>🎯 Tipe</label>
              <select
                value={selectedTarget}
                onChange={(e) => {
                  setSelectedTarget(e.target.value);
                  setSelectedStudentId('');
                  setSelectedStaffId('');
                  setSelectedStudentData(null);
                  setSelectedStaffData(null);
                }}
                disabled={generating}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: '#2c2c2c',
                  color: 'white',
                  border: '1px solid #444',
                  borderRadius: '6px',
                  fontSize: '13px'
                }}
              >
                <option value="siswa">🎓 Siswa</option>
                {canGenerateStaffCode && (
                  <option value="staff">👨‍🏫 Staff/Guru</option>
                )}
              </select>
            </div>

            {selectedTarget === 'siswa' && (
              <div className="form-group" style={{ flex: '2', minWidth: '200px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  👨‍🎓 Pilih Siswa
                  <span style={{ marginLeft: '8px', fontSize: '11px', color: '#4caf50' }}>
                    ({availableStudents.length} tersedia)
                  </span>
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => handleStudentSelect(e.target.value)}
                  disabled={generating || availableStudents.length === 0}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#2c2c2c',
                    color: 'white',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    fontSize: '13px'
                  }}
                >
                  <option value="">-- Pilih Siswa --</option>
                  {availableStudents.length === 0 ? (
                    <option value="" disabled>✨ Semua siswa sudah punya akun</option>
                  ) : (
                    availableStudents.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} - {s.kelas || '-'} {s.jurusan || ''}
                      </option>
                    ))
                  )}
                </select>
                {selectedStudentData && (
                  <div style={{
                    marginTop: '6px',
                    padding: '6px 10px',
                    background: 'rgba(76,175,80,0.1)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#4caf50',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}>
                    ✅ <strong>{selectedStudentData.name}</strong>
                    <span>📚 {selectedStudentData.kelas || '-'}</span>
                    <span>🎓 {selectedStudentData.jurusan || '-'}</span>
                    <span>🆔 {selectedStudentData.id}</span>
                    {getStudentPhone(selectedStudentData) && (
                      <span>📱 {getStudentPhone(selectedStudentData)}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {selectedTarget === 'staff' && (
              <div className="form-group" style={{ flex: '2', minWidth: '200px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  👔 Pilih Staff/Guru
                  <span style={{ marginLeft: '8px', fontSize: '11px', color: '#4caf50' }}>
                    ({availableStaff.length} tersedia)
                  </span>
                </label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => handleStaffSelect(e.target.value)}
                  disabled={generating || availableStaff.length === 0}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#2c2c2c',
                    color: 'white',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    fontSize: '13px'
                  }}
                >
                  <option value="">-- Pilih Staff --</option>
                  {availableStaff.length === 0 ? (
                    <option value="" disabled>✨ Semua staff sudah punya akun atau tidak memiliki email</option>
                  ) : (
                    availableStaff.map(s => {
                      let roleLabel = 'Guru';
                      if (s.jabatan === 'kepala_sekolah') roleLabel = '👑 Kepala Sekolah';
                      else if (s.jabatan === 'wakil_kepala') roleLabel = '👔 Wakil Kepala';
                      else if (s.jabatan === 'staff_tu') roleLabel = '📋 Staff TU';
                      else roleLabel = '👨‍🏫 Guru';
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} ({roleLabel}) - 📧 {s.email || 'Tidak ada email'} {s.noHp ? `📱 ${s.noHp}` : ''}
                        </option>
                      );
                    })
                  )}
                </select>
                {selectedStaffData && (
                  <div style={{
                    marginTop: '6px',
                    padding: '6px 10px',
                    background: 'rgba(76,175,80,0.1)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#4caf50',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}>
                    ✅ <strong>{selectedStaffData.name}</strong>
                    <span>👔 {selectedStaffData.jabatan || '-'}</span>
                    <span>📧 {selectedStaffData.email || '⚠️ Tidak ada email'}</span>
                    <span>📱 {selectedStaffData.noHp || '⚠️ Tidak ada nomor'}</span>
                    <span>🆔 {selectedStaffData.id}</span>
                  </div>
                )}
              </div>
            )}

            <button
              className="btn-generate"
              onClick={generateCode}
              disabled={
                generating ||
                (selectedTarget === 'siswa' && !selectedStudentId) ||
                (selectedTarget === 'staff' && !selectedStaffId) ||
                (selectedTarget === 'siswa' && !canGenerateStudentCode) ||
                (selectedTarget === 'staff' && !canGenerateStaffCode)
              }
              style={{
                padding: '10px 24px',
                background: '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                opacity: (generating || 
                  (selectedTarget === 'siswa' && !selectedStudentId) ||
                  (selectedTarget === 'staff' && !selectedStaffId)) ? 0.6 : 1,
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
              onMouseEnter={(e) => {
                if (!e.target.disabled) {
                  e.target.style.background = '#388e3c';
                  e.target.style.transform = 'scale(1.02)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#4caf50';
                e.target.style.transform = 'scale(1)';
              }}
            >
              {generating ? '⏳ Generating...' : '🚀 Generate Kode'}
            </button>
          </div>

          {generatedCodesHistory.length > 0 && (
            <div className="codes-history" style={{ marginTop: '12px' }}>
              <strong style={{ fontSize: '13px', color: 'var(--text-muted)' }}>📋 Kode terakhir:</strong>
              <div className="codes-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                {generatedCodesHistory.slice(0, 5).map((code, i) => (
                  <span key={i} style={{
                    background: 'rgba(76,175,80,0.15)',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#4caf50',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontFamily: 'monospace'
                  }}>
                    {code}
                    <button
                      onClick={() => copyToClipboard(code)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                      title="Salin Kode"
                    >
                      📋
                    </button>
                  </span>
                ))}
              </div>
              {copySuccess && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#4caf50' }}>
                  {copySuccess}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Search & Filter Users */}
      <div className="users-filter-section" style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <div className="search-box" style={{ flex: '2', minWidth: '200px' }}>
          <input
            type="text"
            placeholder="🔍 Cari user..."
            value={searchUser}
            onChange={(e) => setSearchUser(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#2c2c2c',
              color: 'white',
              border: '1px solid #444',
              borderRadius: '6px',
              fontSize: '13px'
            }}
          />
        </div>
        <div className="filter-box" style={{ flex: '1', minWidth: '150px' }}>
          <select 
            value={filterRole} 
            onChange={(e) => setFilterRole(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#2c2c2c',
              color: 'white',
              border: '1px solid #444',
              borderRadius: '6px',
              fontSize: '13px'
            }}
          >
            <option value="all">📋 Semua Role</option>
            <option value="siswa">🎓 Siswa</option>
            <option value="guru">👨‍🏫 Guru</option>
            <option value="staff_tu">📋 Staff TU</option>
            <option value="wakil_kepala">👔 Wakil Kepala</option>
            <option value="admin">👑 Kepala Sekolah</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="users-table-wrapper">
        {filteredUsers.length === 0 ? (
          <div className="empty-state" style={{
            textAlign: 'center',
            padding: '40px',
            color: 'var(--text-muted)'
          }}>
            <div className="empty-icon" style={{ fontSize: '48px' }}>📭</div>
            <h3 style={{ margin: '10px 0 5px' }}>Tidak Ada User</h3>
            <p>{searchUser ? `Tidak ada user dengan pencarian "${searchUser}"` : 'Belum ada data user'}</p>
          </div>
        ) : (
          <div className="users-table-scroll" style={{ overflowX: 'auto' }}>
            <table className="users-table" style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px'
            }}>
              <thead>
                <tr style={{ background: '#2c2c2c', borderBottom: '2px solid #444' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Avatar</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Nama</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Email</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>No HP</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Role</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, index) => {
                  const isMe = user?.uid === u.uid;
                  let canManage = false;
                  if (user) {
                    if (user.role === 'developer') canManage = u.role !== 'developer';
                    else if (user.role === 'admin') canManage = !['developer', 'admin'].includes(u.role);
                    else if (user.role === 'wakil_kepala') canManage = ['siswa', 'guru'].includes(u.role);
                    else if (['staff_tu', 'guru'].includes(user.role)) canManage = u.role === 'siswa';
                  }

                  const availableRoles = getAvailableRolesForUser(user?.role, u.role);
                  const canChangeRole = availableRoles.length > 0 && !isMe && u.role !== 'developer';
                  
                  let userPhone = u.phoneNumber || u.noHp || '';
                  if (!userPhone || userPhone === '-') {
                    const staff = staffData.find(s => s.email === u.email);
                    if (staff && staff.noHp) userPhone = staff.noHp;
                  }
                  if (!userPhone || userPhone === '-') {
                    const student = siswaData.find(s => s.email === u.email);
                    if (student && student.parentPhone) userPhone = student.parentPhone;
                  }

                  let roleDisplay = (
                    <span className="role-badge" style={{
                      background: getRoleColor(u.role),
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: 'white',
                      display: 'inline-block'
                    }}>
                      {getRoleIcon(u.role)} {getRoleDisplayName(u.role)}
                    </span>
                  );

                  if (canChangeRole) {
                    roleDisplay = (
                      <select
                        className="role-select"
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                        style={{
                          background: '#2c2c2c',
                          color: 'white',
                          border: '1px solid #444',
                          padding: '5px 10px',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                      >
                        {availableRoles.map(role => (
                          <option key={role} value={role}>
                            {getRoleIcon(role)} {getRoleDisplayName(role)}
                          </option>
                        ))}
                      </select>
                    );
                  }

                  const isLoading = resetLoading[u.uid] || false;
                  const resultMsg = resetResult[u.uid] || '';

                  return (
                    <tr key={u.uid || index} style={{
                      borderBottom: '1px solid #333',
                      background: isMe ? 'rgba(76,175,80,0.08)' : 'transparent'
                    }}>
                      <td style={{ padding: '8px 12px' }}>
                        {u.photoUrl ? (
                          <img src={u.photoUrl} alt={u.name} style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            objectFit: 'cover'
                          }} />
                        ) : (
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: getRoleColor(u.role),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '16px'
                          }}>
                            {(u.name || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: '500' }}>{u.name || '-'}</div>
                        {isMe && (
                          <span style={{
                            fontSize: '10px',
                            background: '#4caf50',
                            color: 'white',
                            padding: '1px 6px',
                            borderRadius: '3px'
                          }}>Anda</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{u.email || '-'}</td>
                      <td style={{ 
                        padding: '8px 12px', 
                        color: userPhone && userPhone !== '-' ? '#25d366' : 'var(--text-muted)' 
                      }}>
                        {userPhone || '-'}
                        {userPhone && userPhone !== '-' && <span style={{ marginLeft: '4px' }}>📱</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>{roleDisplay}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          {canManage && !isMe && u.role !== 'developer' && (
                            <>
                              <button
                                className="btn-action btn-delete"
                                onClick={() => deleteUser(u.uid, u.name)}
                                title="Hapus User"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#dc3545',
                                  cursor: 'pointer',
                                  fontSize: '16px',
                                  padding: '4px 6px',
                                  borderRadius: '4px',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => e.target.style.background = 'rgba(220,53,69,0.15)'}
                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                              >
                                🗑️
                              </button>
                              {canResetPassword && (
                                <button
                                  className="btn-action btn-reset"
                                  onClick={() => sendResetPassword(u.uid, u.name, u.email, userPhone)}
                                  disabled={isLoading}
                                  title="Reset Password (Email + WhatsApp)"
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#ff9800',
                                    cursor: isLoading ? 'not-allowed' : 'pointer',
                                    fontSize: '16px',
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    transition: 'all 0.2s',
                                    opacity: isLoading ? 0.5 : 1
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!e.target.disabled) e.target.style.background = 'rgba(255,152,0,0.15)';
                                  }}
                                  onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                >
                                  {isLoading ? '⏳' : '🔑'}
                                </button>
                              )}
                            </>
                          )}
                          {!canManage && <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>-</span>}
                        </div>
                        {resultMsg && (
                          <div style={{ 
                            fontSize: '11px', 
                            color: resultMsg.includes('✅') ? '#4caf50' : '#f44336',
                            marginTop: '4px'
                          }}>
                            {resultMsg}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== ALL CODES SECTION ==================== */}
      <div className="all-codes-section" style={{
        marginTop: '20px',
        padding: '16px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '12px',
        border: '1px solid #333'
      }}>
        <div className="codes-header" style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '12px'
        }}>
          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            🔑 Semua Kode Registrasi ({allCodes.length})
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              <select 
                value={filterCodeType} 
                onChange={(e) => setFilterCodeType(e.target.value)}
                style={{
                  padding: '4px 8px',
                  background: '#2c2c2c',
                  color: 'white',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
              >
                <option value="all">📋 Semua Tipe</option>
                <option value="siswa">🎓 Siswa</option>
                <option value="guru">👨‍🏫 Guru</option>
                <option value="staff">👔 Staff</option>
              </select>
              <select 
                value={filterCodeStatus} 
                onChange={(e) => setFilterCodeStatus(e.target.value)}
                style={{
                  padding: '4px 8px',
                  background: '#2c2c2c',
                  color: 'white',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
              >
                <option value="all">📋 Semua Status</option>
                <option value="active">✅ Tersedia</option>
                <option value="used">🔴 Terpakai</option>
              </select>
            </div>
            <button 
              onClick={() => setShowAllCodes(!showAllCodes)}
              style={{
                padding: '4px 12px',
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid #444',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              {showAllCodes ? 'Sembunyikan' : 'Tampilkan'}
            </button>
            <button 
              onClick={() => {
                setAllCodes([...allCodes]);
                showToast('✅ Tabel kode di-refresh', 'success');
              }}
              style={{
                padding: '4px 12px',
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid #444',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              🔄
            </button>
          </div>
        </div>

        {showAllCodes && (
          <>
            <div className="codes-stats" style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '12px',
              fontSize: '12px',
              color: 'var(--text-muted)'
            }}>
              <span>📊 Total: <strong style={{ color: 'white' }}>{filteredCodes.length}</strong></span>
              <span>✅ Tersedia: <strong style={{ color: '#4caf50' }}>{filteredCodes.filter(c => !c.used).length}</strong></span>
              <span>🔴 Terpakai: <strong style={{ color: '#f44336' }}>{filteredCodes.filter(c => c.used).length}</strong></span>
              <span>🎓 Siswa: <strong style={{ color: '#e67e22' }}>{filteredCodes.filter(c => c.type === 'siswa').length}</strong></span>
              <span>👨‍🏫 Staff/Guru: <strong style={{ color: '#9b59b6' }}>{filteredCodes.filter(c => c.type === 'guru' || c.type === 'staff').length}</strong></span>
            </div>

            {filteredCodes.length === 0 ? (
              <div className="empty-state" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                <span className="empty-icon" style={{ fontSize: '32px' }}>🔑</span>
                <h3 style={{ margin: '5px 0' }}>Tidak Ada Kode</h3>
                <p>Belum ada kode registrasi yang dibuat</p>
              </div>
            ) : (
              <div className="codes-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '12px'
              }}>
                {filteredCodes.map((item) => {
                  const isAvailable = !item.used;
                  
                  let typeColor = '#4a90e2';
                  let typeLabel = 'Siswa';
                  let typeIcon = '🎓';
                  if (item.type === 'guru') {
                    typeColor = '#f39c12';
                    typeLabel = 'Guru';
                    typeIcon = '👨‍🏫';
                  } else if (item.type === 'staff') {
                    typeColor = '#9b59b6';
                    typeLabel = 'Staff';
                    typeIcon = '👔';
                  }

                  const timeRemaining = getCodeTimeRemaining(item.createdAt);
                  const isExpired = timeRemaining === 'Expired';

                  return (
                    <div key={item.code} style={{
                      background: isAvailable ? 'rgba(76,175,80,0.05)' : 'rgba(244,67,54,0.05)',
                      border: `1px solid ${isAvailable ? (isExpired ? '#f44336' : 'rgba(76,175,80,0.3)') : 'rgba(244,67,54,0.3)'}`,
                      borderRadius: '8px',
                      padding: '12px',
                      transition: 'all 0.3s ease',
                      opacity: isExpired ? 0.6 : 1
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ 
                          fontFamily: 'monospace',
                          fontSize: '16px',
                          fontWeight: 'bold',
                          color: typeColor
                        }}>{item.code}</span>
                        <span style={{ 
                          fontSize: '12px',
                          color: typeColor,
                          fontWeight: 'bold'
                        }}>{typeIcon} {typeLabel}</span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>👤 {item.linkedName || item.nama || '-'}</span>
                        {item.linkedId && <span>🆔 {item.linkedId}</span>}
                        {item.linkedEmail && <span>📧 {item.linkedEmail}</span>}
                        {item.noHp && <span>📱 {item.noHp}</span>}
                        <span>📅 {item.createdAt ? new Date(item.createdAt).toLocaleString('id-ID') : '-'}</span>
                        {timeRemaining && (
                          <span style={{ color: isExpired ? '#f44336' : '#ff9800' }}>
                            ⏰ {timeRemaining}
                          </span>
                        )}
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          👤 Dibuat: {item.createdBy || 'System'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #333' }}>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: 'bold',
                          color: isAvailable ? '#4caf50' : '#f44336'
                        }}>
                          {isAvailable ? '✅ Tersedia' : '🔴 Terpakai'}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {isAvailable && (
                            <button 
                              onClick={() => copyToClipboard(item.code)}
                              style={{
                                padding: '2px 8px',
                                background: 'rgba(76,175,80,0.15)',
                                color: '#4caf50',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                              }}
                              title="Salin Kode"
                            >
                              📋
                            </button>
                          )}
                          {canDeleteCode && (
                            <button 
                              onClick={() => deleteCode(item.code)}
                              style={{
                                padding: '2px 8px',
                                background: 'rgba(220,53,69,0.15)',
                                color: '#dc3545',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                              }}
                              title="Hapus Kode"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ==================== RESET ALL BUTTON (HANYA DEVELOPER) ==================== */}
      {canResetAll && (
        <div className="reset-all-section" style={{ 
          marginTop: '20px', 
          padding: '20px', 
          borderTop: '2px solid #f44336',
          borderBottom: '2px solid #f44336',
          background: 'rgba(244, 67, 54, 0.05)',
          borderRadius: '12px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h4 style={{ color: '#f44336', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                🔥 Zona Berbahaya
              </h4>
              <p style={{ color: '#888', fontSize: '13px', margin: '5px 0 0 0' }}>
                Hapus semua data: siswa, staff, user auth (termasuk staff dengan akun), absensi, izin, fingerprint, kode, logo, dan nama sekolah.
                <br />
                <strong style={{ color: '#f44336' }}>⚠️ TINDAKAN INI TIDAK DAPAT DIBATALKAN!</strong>
              </p>
            </div>
            <button
              id="btnResetAll"
              className="btn-danger"
              onClick={resetAllData}
              disabled={isResetting}
              style={{
                padding: '12px 24px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: isResetting ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                opacity: isResetting ? 0.6 : 1,
                transition: 'all 0.3s'
              }}
              onMouseEnter={(e) => {
                if (!isResetting) {
                  e.target.style.background = '#d32f2f';
                  e.target.style.transform = 'scale(1.02)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#f44336';
                e.target.style.transform = 'scale(1)';
              }}
            >
              {isResetting ? '⏳ Mereset...' : '🔥 Reset All (Hanya Developer)'}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="users-footer" style={{
        marginTop: '20px',
        paddingTop: '12px',
        borderTop: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '12px',
        color: 'var(--text-muted)'
      }}>
        <span>🔄 Data real-time dari Firebase</span>
        <span>📱 {new Date().toLocaleString('id-ID')}</span>
        {user?.role === 'developer' && (
          <span style={{ color: '#f44336', fontWeight: 'bold' }}>💻 Developer Mode</span>
        )}
      </div>

      {/* Modal - Code Generated */}
      {showCodeModal && generatedCode && (
        <div className="modal-overlay" onClick={() => setShowCodeModal(false)} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{
            background: '#1e1e1e',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '90vh',
            overflowY: 'auto',
            border: '1px solid #333'
          }}>
            <div className="modal-header" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
              paddingBottom: '12px',
              borderBottom: '1px solid #333'
            }}>
              <h3 style={{ margin: 0, color: '#4caf50' }}>✅ Kode Berhasil Dibuat</h3>
              <button className="modal-close" onClick={() => setShowCodeModal(false)} style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '20px',
                cursor: 'pointer'
              }}>✖</button>
            </div>
            <div className="modal-body">
              <div className="modal-code-display" style={{
                textAlign: 'center',
                padding: '16px',
                background: 'rgba(76,175,80,0.1)',
                borderRadius: '8px',
                marginBottom: '16px'
              }}>
                <span className="modal-code" style={{
                  fontFamily: 'monospace',
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#4caf50',
                  letterSpacing: '2px'
                }}>{generatedCode}</span>
              </div>
              <div className="modal-info" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                <p style={{ fontWeight: 'bold', color: 'white', marginBottom: '8px' }}>📋 Detail:</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  <li style={{ padding: '4px 0' }}>🎯 Tipe: {selectedTarget === 'siswa' ? 'Siswa' : 'Staff/Guru'}</li>
                  {selectedTarget === 'siswa' && selectedStudentData && (
                    <>
                      <li style={{ padding: '4px 0' }}>👤 Untuk: <strong style={{ color: 'white' }}>{selectedStudentData.name}</strong></li>
                      <li style={{ padding: '4px 0' }}>📚 Kelas: {selectedStudentData.kelas || '-'} - 🎓 {selectedStudentData.jurusan || '-'}</li>
                      <li style={{ padding: '4px 0' }}>🆔 ID: {selectedStudentData.id}</li>
                      {selectedStudentData.parentPhone && (
                        <li style={{ padding: '4px 0', color: '#25d366' }}>📱 WA: {selectedStudentData.parentPhone}</li>
                      )}
                    </>
                  )}
                  {selectedTarget === 'staff' && selectedStaffData && (
                    <>
                      <li style={{ padding: '4px 0' }}>👤 Untuk: <strong style={{ color: 'white' }}>{selectedStaffData.name}</strong></li>
                      <li style={{ padding: '4px 0' }}>👔 Jabatan: {selectedStaffData.jabatan || '-'}</li>
                      <li style={{ padding: '4px 0' }}>📧 Email: <strong style={{ color: '#4a90e2' }}>{selectedStaffData.email || '⚠️ Tidak ada email'}</strong></li>
                      <li style={{ padding: '4px 0', color: '#25d366' }}>📱 No HP: {selectedStaffData.noHp || '⚠️ Tidak ada nomor'}</li>
                      <li style={{ padding: '4px 0' }}>🆔 ID: {selectedStaffData.id}</li>
                    </>
                  )}
                  <li style={{ padding: '4px 0' }}>📅 Dibuat: {new Date().toLocaleString('id-ID')}</li>
                  <li style={{ padding: '4px 0' }}>⏰ Expired: 5 jam</li>
                </ul>
                <div className="modal-note" style={{
                  marginTop: '12px',
                  padding: '10px',
                  background: 'rgba(255,152,0,0.1)',
                  borderRadius: '6px',
                  borderLeft: '3px solid #ff9800',
                  fontSize: '12px',
                  color: '#ff9800'
                }}>
                  ⚠️ <strong>Penting:</strong> 
                  {selectedTarget === 'siswa' 
                    ? ' Siswa wajib memasukkan <strong>ID</strong> dan <strong>Kode</strong> yang sama saat pendaftaran!'
                    : ' Staff wajib memasukkan <strong>Email</strong>, <strong>ID</strong>, dan <strong>Kode</strong> yang sama saat pendaftaran!'
                  }
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end',
              marginTop: '16px',
              paddingTop: '12px',
              borderTop: '1px solid #333'
            }}>
              <button 
                className="btn-copy-modal" 
                onClick={() => copyToClipboard(generatedCode)}
                style={{
                  padding: '8px 16px',
                  background: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                📋 Salin Kode
              </button>
              <button 
                className="btn-close-modal" 
                onClick={() => setShowCodeModal(false)}
                style={{
                  padding: '8px 16px',
                  background: '#444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== HELPER FUNCTION ====================
const getCodeTimeRemaining = (createdAt) => {
  if (!createdAt) return null;
  const now = Date.now();
  const expiredAt = createdAt + (5 * 60 * 60 * 1000);
  const remaining = expiredAt - now;
  if (remaining <= 0) return 'Expired';
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  else if (minutes > 0) return `${minutes} menit`;
  else return '< 1 menit';
};

export default UsersTab;