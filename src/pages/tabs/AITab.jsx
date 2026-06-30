// src/pages/tabs/AITab.jsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ref, onValue, set, remove, update, get } from 'firebase/database';
import { db } from '../../firebase/config';
// ⭐ IMPORT MARQUEE TEXT COMPONENT
import MarqueeText from '../../components/MarqueeText';
import './AITab.css';

// API Base URL
const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

// ==================== HELPER FUNCTIONS ====================
const getRoleDisplayName = (role) => {
  const names = {
    developer: 'Developer',
    admin: 'Kepala Sekolah',
    wakil_kepala: 'Wakil Kepala',
    staff_tu: 'Staff TU',
    guru: 'Guru',
    siswa: 'Siswa'
  };
  return names[role] || role.toUpperCase();
};

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

// ==================== FUZZY SEARCH FUNCTION ====================
// Normalisasi string untuk fuzzy matching
const normalizeString = (str) => {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[aeiou]/g, 'a') // Normalisasi vokal
    .replace(/[bcdfghjklmnpqrstvwxyz]/g, (match) => {
      const map = {
        'b': 'b', 'c': 'c', 'd': 'd', 'f': 'f', 'g': 'g',
        'h': 'h', 'j': 'j', 'k': 'k', 'l': 'l', 'm': 'm',
        'n': 'n', 'p': 'p', 'q': 'q', 'r': 'r', 's': 's',
        't': 't', 'v': 'v', 'w': 'w', 'x': 'x', 'y': 'y', 'z': 'z'
      };
      return map[match] || match;
    })
    .replace(/\s+/g, '');
};

// Levenshtein distance untuk mengukur kemiripan
const levenshteinDistance = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i-1] === a[j-1]) {
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i-1][j-1] + 1,
          matrix[i][j-1] + 1,
          matrix[i-1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

// Get similarity score (0-1)
const getSimilarity = (str1, str2) => {
  const a = str1.toLowerCase();
  const b = str2.toLowerCase();
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - (distance / maxLen);
};

// Fuzzy search student
const fuzzyFindStudent = (query, students) => {
  if (!query || students.length === 0) return null;
  
  const q = query.toLowerCase().trim();
  const normalizedQ = normalizeString(q);
  
  // 1. Exact match
  let result = students.find(s => 
    s.nama?.toLowerCase() === q || 
    s.id?.toString() === q
  );
  if (result) return { student: result, score: 1 };
  
  // 2. Contains match
  result = students.find(s => 
    s.nama?.toLowerCase().includes(q) || 
    s.id?.toString().includes(q)
  );
  if (result) return { student: result, score: 0.95 };
  
  // 3. Fuzzy score matching
  let bestMatch = null;
  let bestScore = 0;
  
  for (const student of students) {
    const name = student.nama || '';
    const id = student.id?.toString() || '';
    
    // Score berdasarkan nama
    const nameSimilarity = getSimilarity(q, name);
    const normalizedNameSimilarity = getSimilarity(normalizedQ, normalizeString(name));
    
    // Score berdasarkan ID
    const idSimilarity = q === id ? 1 : (id.includes(q) ? 0.9 : 0);
    
    // Score terbaik
    const score = Math.max(nameSimilarity, normalizedNameSimilarity, idSimilarity);
    
    if (score > bestScore && score > 0.3) { // Threshold 0.3
      bestScore = score;
      bestMatch = student;
    }
  }
  
  if (bestMatch && bestScore > 0.4) {
    return { student: bestMatch, score: bestScore };
  }
  
  return null;
};

const fuzzyFindStaff = (query, staffs) => {
  if (!query || staffs.length === 0) return null;
  
  const q = query.toLowerCase().trim();
  const normalizedQ = normalizeString(q);
  
  // 1. Exact match
  let result = staffs.find(s => 
    s.nama?.toLowerCase() === q || 
    s.id?.toString() === q ||
    s.email?.toLowerCase() === q
  );
  if (result) return { staff: result, score: 1 };
  
  // 2. Contains match
  result = staffs.find(s => 
    s.nama?.toLowerCase().includes(q) || 
    s.id?.toString().includes(q) ||
    s.email?.toLowerCase().includes(q)
  );
  if (result) return { staff: result, score: 0.95 };
  
  // 3. Fuzzy score matching
  let bestMatch = null;
  let bestScore = 0;
  
  for (const staff of staffs) {
    const name = staff.nama || '';
    const id = staff.id?.toString() || '';
    const email = staff.email || '';
    
    const nameSimilarity = getSimilarity(q, name);
    const normalizedNameSimilarity = getSimilarity(normalizedQ, normalizeString(name));
    const emailSimilarity = getSimilarity(q, email);
    const idSimilarity = q === id ? 1 : (id.includes(q) ? 0.9 : 0);
    
    const score = Math.max(nameSimilarity, normalizedNameSimilarity, emailSimilarity, idSimilarity);
    
    if (score > bestScore && score > 0.3) {
      bestScore = score;
      bestMatch = staff;
    }
  }
  
  if (bestMatch && bestScore > 0.4) {
    return { staff: bestMatch, score: bestScore };
  }
  
  return null;
};

const AITab = ({ user }) => {
  // ==================== STATE ====================
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [aiProvider, setAiProvider] = useState('groq');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isTyping, setIsTyping] = useState(false);

  // State untuk nama sekolah
  const [schoolName, setSchoolName] = useState('Sistem Absensi');

  // Data cache untuk action
  const [studentsCache, setStudentsCache] = useState([]);
  const [staffCache, setStaffCache] = useState([]);
  const [usersAuthCache, setUsersAuthCache] = useState([]);

  // Refs
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isMountedRef = useRef(true);

  // ==================== ROLE PERMISSIONS ====================
  const rawRole = user?.role || 'siswa';
  const role = rawRole.toString().toLowerCase().trim();
  
  const isSiswa = role === 'siswa';
  const isGuru = role === 'guru';
  const isStaff = role === 'staff_tu';
  const isAdmin = role === 'admin';
  const isWakilKepala = role === 'wakil_kepala';
  const isDeveloper = role === 'developer';
  
  const hasAIAccess = isDeveloper || isAdmin || isWakilKepala || isGuru || isStaff;
  const isFullAccess = isDeveloper || isAdmin || isWakilKepala;
  const canDeleteData = isDeveloper || isAdmin;
  const canManageAttendance = isFullAccess || isGuru || isStaff;

  // ==================== AMBIL NAMA SEKOLAH ====================
  useEffect(() => {
    if (!db) return;

    let isMounted = true;

    // Coba ambil dari system_config/schoolName terlebih dahulu
    const schoolNameRef = ref(db, 'system_config/schoolName');
    const unsubscribeName = onValue(schoolNameRef, (snapshot) => {
      if (!isMounted) return;
      const name = snapshot.val();
      if (name && name !== 'null' && name !== 'undefined' && name.trim() !== '') {
        console.log('✅ [AITab] School name from system_config:', name);
        setSchoolName(name);
      } else {
        // Jika tidak ada di system_config, coba dari school_info
        const schoolInfoRef = ref(db, 'school_info');
        onValue(schoolInfoRef, (infoSnapshot) => {
          if (!isMounted) return;
          const infoData = infoSnapshot.val();
          if (infoData && infoData.name && infoData.name.trim() !== '') {
            console.log('✅ [AITab] School name from school_info:', infoData.name);
            setSchoolName(infoData.name);
          } else {
            // Fallback ke school_config
            const configRef = ref(db, 'school_config');
            onValue(configRef, (configSnapshot) => {
              if (!isMounted) return;
              const configData = configSnapshot.val();
              if (configData && configData.schoolName && configData.schoolName.trim() !== '') {
                console.log('✅ [AITab] School name from school_config:', configData.schoolName);
                setSchoolName(configData.schoolName);
              } else {
                console.warn('⚠️ [AITab] No school name found in database, using default');
                setSchoolName('Sistem Absensi');
              }
            }, { onlyOnce: true });
          }
        }, { onlyOnce: true });
      }
    });

    return () => {
      isMounted = false;
      unsubscribeName();
    };
  }, []);

  // ==================== DETEKSI MOBILE ====================
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ==================== GET AUTH TOKEN ====================
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

  // ==================== SCROLL TO BOTTOM ====================
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 100);
  }, []);

  // ==================== SYSTEM PROMPT ====================
  const getSystemPrompt = useCallback(() => {
    const schoolNameText = schoolName || 'Sekolah';
    const userRole = user?.role || 'user';
    const userName = user?.nama || 'User';
    const userKelas = user?.kelas || '';
    const userJurusan = user?.jurusan || '';

    return `Anda adalah asisten AI untuk sistem manajemen sekolah bernama "${schoolNameText}". 
Anda membantu guru, staff, dan admin dalam berbagai tugas sekolah.

Informasi pengguna:
- Nama: ${userName}
- Role: ${userRole}
- Kelas: ${userKelas || 'Tidak ada'}
- Jurusan: ${userJurusan || 'Tidak ada'}

KEMAMPUAN KHUSUS (hanya untuk user dengan akses yang sesuai):
1. Absensi siswa: "absenkan [nama/id]" atau "pulangkan [nama/id]"
2. Lihat data siswa: "lihat siswa [nama/id]"
3. Lihat data staff: "lihat staff [nama/id/email]"
4. Daftar siswa/staff: "daftar siswa" atau "daftar staff"
5. Tambah siswa: "tambah siswa [nama] kelas [kelas] wa [nomor]"
6. Tambah staff: "tambah staff [nama] jabatan [jabatan] email [email]"
7. Hapus siswa: "hapus siswa [nama/id]"
8. Hapus staff: "hapus staff [nama/id/email]"
9. Cek absensi: "cek absen [nama/id]"
10. Statistik: "statistik"
11. Jadwal pelajaran: "jadwal" atau "jadwal [kelas]"
12. Pengumuman: "pengumuman" atau "buat pengumuman [teks]"
13. Info guru: "info guru [nama]"

Panduan:
1. Jawab dengan bahasa Indonesia yang sopan, jelas, dan informatif
2. Berikan solusi yang praktis dan aplikatif
3. Gunakan fitur fuzzy search untuk menemukan data meskipun ada typo
4. Untuk pertanyaan di luar konteks sekolah, berikan jawaban umum yang tetap bermanfaat
5. Gunakan format yang rapi dengan poin-poin jika diperlukan

Anda adalah asisten yang ramah dan profesional. Selalu utamakan membantu pengguna dengan sebaik-baiknya.`;
  }, [user, schoolName]);

  // ==================== LOAD DATA FOR ACTIONS ====================
  useEffect(() => {
    if (!hasAIAccess) return;

    // Load students data
    const studentsRef = ref(db, 'users');
    const unsubStudents = onValue(studentsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = [];
        Object.keys(data).forEach(key => {
          const student = data[key];
          if (student && student.nama && student.nama !== 'Tidak Diketahui') {
            list.push({ id: key, ...student });
          }
        });
        setStudentsCache(list);
      }
    });

    // Load staff data
    const staffRef = ref(db, 'staff');
    const unsubStaff = onValue(staffRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = [];
        Object.keys(data).forEach(key => {
          const staff = data[key];
          if (staff && staff.nama) {
            list.push({ id: key, ...staff });
          }
        });
        setStaffCache(list);
      }
    });

    // Load users auth
    const authRef = ref(db, 'users_auth');
    const unsubAuth = onValue(authRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = [];
        Object.keys(data).forEach(key => {
          list.push({ uid: key, ...data[key] });
        });
        setUsersAuthCache(list);
      }
    });

    return () => {
      unsubStudents();
      unsubStaff();
      unsubAuth();
    };
  }, [hasAIAccess]);

  // ==================== FIND DATA FUNCTIONS WITH FUZZY SEARCH ====================
  const findStudent = useCallback((query) => {
    if (!query || studentsCache.length === 0) return null;
    
    const result = fuzzyFindStudent(query, studentsCache);
    if (result) {
      console.log(`🔍 Found student "${result.student.nama}" with score ${result.score}`);
      return result.student;
    }
    return null;
  }, [studentsCache]);

  const findStaff = useCallback((query) => {
    if (!query || staffCache.length === 0) return null;
    
    const result = fuzzyFindStaff(query, staffCache);
    if (result) {
      console.log(`🔍 Found staff "${result.staff.nama}" with score ${result.score}`);
      return result.staff;
    }
    return null;
  }, [staffCache]);

  const findUser = useCallback((query) => {
    const q = query.toLowerCase().trim();
    return usersAuthCache.find(u => 
      u.nama?.toLowerCase().includes(q) || 
      u.email?.toLowerCase().includes(q) ||
      u.uid?.toLowerCase().includes(q) ||
      u.fpId?.toString().includes(q)
    );
  }, [usersAuthCache]);

  // ==================== ACTION FUNCTIONS ====================
  
  // === ABSENSI SISWA ===
  const handleAbsenSiswa = useCallback(async (studentQuery, type = 'in') => {
    const student = findStudent(studentQuery);
    if (!student) {
      // Suggest similar names
      const suggestions = studentsCache
        .map(s => ({ name: s.nama, score: getSimilarity(studentQuery, s.nama) }))
        .filter(s => s.score > 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(s => s.name);
      
      const suggestionText = suggestions.length > 0 
        ? `\n\n💡 Maksud Anda: ${suggestions.join(', ')}?` 
        : '';
      
      return { 
        success: false, 
        error: `Siswa "${studentQuery}" tidak ditemukan${suggestionText}` 
      };
    }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);

    try {
      const attendanceRef = ref(db, `absensi/${today}/${student.id}`);
      const snapshot = await get(attendanceRef);
      const existing = snapshot.val();

      if (type === 'in') {
        if (existing && existing.in) {
          return { 
            success: false, 
            error: `${student.nama} sudah absen masuk pada ${existing.in}` 
          };
        }
        await set(attendanceRef, {
          in: timeStr,
          out: null,
          date: today,
          studentId: student.id,
          nama: student.nama,
          kelas: student.kelas || '',
          jurusan: student.jurusan || '',
          isLate: false,
          delayMinutes: 0,
          status: 'Hadir',
          timestamp: Date.now(),
          checkedInBy: user?.nama || 'AI Assistant',
          isSimulate: false
        });
        return { 
          success: true, 
          message: `✅ ${student.nama} berhasil absen masuk pada ${timeStr}` 
        };
      } else {
        if (!existing || !existing.in) {
          return { 
            success: false, 
            error: `${student.nama} belum absen masuk hari ini` 
          };
        }
        if (existing.out) {
          return { 
            success: false, 
            error: `${student.nama} sudah absen pulang pada ${existing.out}` 
          };
        }
        await update(attendanceRef, {
          out: timeStr,
          status: 'Pulang',
          checkedOutBy: user?.nama || 'AI Assistant',
          updatedAt: Date.now()
        });
        return { 
          success: true, 
          message: `✅ ${student.nama} berhasil absen pulang pada ${timeStr}` 
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [findStudent, studentsCache, user]);

  // === HAPUS SISWA ===
  const handleDeleteSiswa = useCallback(async (studentQuery) => {
    if (!canDeleteData) {
      return { success: false, error: '⛔ Hanya Admin dan Developer yang dapat menghapus data!' };
    }

    const student = findStudent(studentQuery);
    if (!student) {
      return { success: false, error: `Siswa "${studentQuery}" tidak ditemukan` };
    }

    try {
      await remove(ref(db, `users/${student.id}`));
      
      const userAuth = usersAuthCache.find(u => u.fpId == student.id || u.userId == student.id);
      if (userAuth) {
        await remove(ref(db, `users_auth/${userAuth.uid}`));
      }
      
      return { success: true, message: `✅ Siswa "${student.nama}" (ID: ${student.id}) berhasil dihapus!` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [findStudent, canDeleteData, usersAuthCache]);

  // === HAPUS STAFF ===
  const handleDeleteStaff = useCallback(async (staffQuery) => {
    if (!canDeleteData) {
      return { success: false, error: '⛔ Hanya Admin dan Developer yang dapat menghapus data!' };
    }

    const staff = findStaff(staffQuery);
    if (!staff) {
      return { success: false, error: `Staff "${staffQuery}" tidak ditemukan` };
    }

    try {
      await remove(ref(db, `staff/${staff.id}`));
      
      const userAuth = usersAuthCache.find(u => u.staffId == staff.id || u.userId == staff.id);
      if (userAuth) {
        await remove(ref(db, `users_auth/${userAuth.uid}`));
      }
      
      return { success: true, message: `✅ Staff "${staff.nama}" (ID: ${staff.id}) berhasil dihapus!` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [findStaff, canDeleteData, usersAuthCache]);

  // === TAMBAH SISWA ===
  const handleAddSiswa = useCallback(async (nama, kelas, jurusan, parentPhone) => {
    if (!isFullAccess && !isGuru) {
      return { success: false, error: '⛔ Hanya Guru, Admin, Wakil Kepala, dan Developer yang dapat menambah siswa!' };
    }

    if (!nama || !kelas || !parentPhone) {
      return { success: false, error: '⚠️ Nama, Kelas, dan WhatsApp orang tua wajib diisi!' };
    }

    const id = Date.now().toString();
    try {
      await set(ref(db, `users/${id}`), {
        id: id,
        nama: nama.trim(),
        kelas: kelas,
        jurusan: jurusan || '',
        parentPhone: parentPhone.trim(),
        delayOut: 60,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      return { success: true, message: `✅ Siswa "${nama.trim()}" berhasil ditambahkan! (ID: ${id})` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [isFullAccess, isGuru]);

  // === TAMBAH STAFF ===
  const handleAddStaff = useCallback(async (nama, jabatan, email, noHp, departemen = '-') => {
    if (!isFullAccess) {
      return { success: false, error: '⛔ Hanya Admin, Wakil Kepala, dan Developer yang dapat menambah staff!' };
    }

    if (!nama || !jabatan || !email || !noHp) {
      return { success: false, error: '⚠️ Nama, Jabatan, Email, dan No HP wajib diisi!' };
    }

    const id = `STF-${Date.now().toString().slice(-6)}`;
    try {
      await set(ref(db, `staff/${id}`), {
        id: id,
        nama: nama.trim(),
        jabatan: jabatan,
        departemen: departemen,
        email: email.trim(),
        noHp: noHp.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      return { success: true, message: `✅ Staff "${nama.trim()}" berhasil ditambahkan! (ID: ${id})` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [isFullAccess]);

  // === DAPATKAN DATA SISWA ===
  const handleGetSiswa = useCallback(async (studentQuery) => {
    const student = findStudent(studentQuery);
    if (!student) {
      return { success: false, error: `Siswa "${studentQuery}" tidak ditemukan` };
    }
    const userAuth = usersAuthCache.find(u => u.fpId == student.id || u.userId == student.id);
    return {
      success: true,
      data: {
        ...student,
        hasAccount: !!userAuth,
        email: userAuth?.email || '-',
        noHp: userAuth?.noHp || student.parentPhone || '-',
        photoUrl: userAuth?.photoUrl || '-'
      }
    };
  }, [findStudent, usersAuthCache]);

  // === DAPATKAN DATA STAFF ===
  const handleGetStaff = useCallback(async (staffQuery) => {
    const staff = findStaff(staffQuery);
    if (!staff) {
      return { success: false, error: `Staff "${staffQuery}" tidak ditemukan` };
    }
    const userAuth = usersAuthCache.find(u => u.staffId == staff.id || u.userId == staff.id);
    return {
      success: true,
      data: {
        ...staff,
        hasAccount: !!userAuth,
        email: userAuth?.email || staff.email || '-',
        photoUrl: userAuth?.photoUrl || '-'
      }
    };
  }, [findStaff, usersAuthCache]);

  // === LIHAT SEMUA SISWA ===
  const handleListSiswa = useCallback(async (filter = {}) => {
    let list = [...studentsCache];
    
    if (filter.kelas) {
      list = list.filter(s => s.kelas === filter.kelas);
    }
    if (filter.jurusan) {
      list = list.filter(s => s.jurusan === filter.jurusan);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(s => 
        s.nama?.toLowerCase().includes(q) || 
        s.id?.toString().includes(q)
      );
    }
    
    return {
      success: true,
      data: {
        total: list.length,
        students: list.map(s => ({
          id: s.id,
          nama: s.nama,
          kelas: s.kelas || '-',
          jurusan: s.jurusan || '-',
          parentPhone: s.parentPhone || '-'
        }))
      }
    };
  }, [studentsCache]);

  // === LIHAT SEMUA STAFF ===
  const handleListStaff = useCallback(async (filter = {}) => {
    let list = [...staffCache];
    
    if (filter.jabatan) {
      list = list.filter(s => s.jabatan === filter.jabatan);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(s => 
        s.nama?.toLowerCase().includes(q) || 
        s.id?.toString().includes(q) ||
        s.email?.toLowerCase().includes(q)
      );
    }
    
    return {
      success: true,
      data: {
        total: list.length,
        staffs: list.map(s => ({
          id: s.id,
          nama: s.nama,
          jabatan: s.jabatan || '-',
          departemen: s.departemen || '-',
          email: s.email || '-',
          noHp: s.noHp || '-'
        }))
      }
    };
  }, [staffCache]);

  // === CEK STATUS ABSENSI HARI INI ===
  const handleCheckAttendance = useCallback(async (studentQuery) => {
    const student = findStudent(studentQuery);
    if (!student) {
      return { success: false, error: `Siswa "${studentQuery}" tidak ditemukan` };
    }

    const today = new Date().toISOString().split('T')[0];
    try {
      const snapshot = await get(ref(db, `absensi/${today}/${student.id}`));
      const data = snapshot.val();
      
      if (!data) {
        return { success: true, message: `📭 ${student.nama} belum absen hari ini` };
      }
      
      let status = 'Hadir';
      if (data.out) status = 'Pulang';
      else if (data.isLate) status = 'Terlambat';
      
      return {
        success: true,
        data: {
          nama: student.nama,
          status: status,
          timeIn: data.in || '-',
          timeOut: data.out || '-',
          kelas: student.kelas || '-',
          jurusan: student.jurusan || '-'
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [findStudent]);

  // ==================== PROCESS AI COMMAND ====================
  const processCommand = useCallback(async (message) => {
    const msg = message.toLowerCase().trim();
    
    // 1. ABSENSI MASUK: "absenkan [nama/id]" atau "absen masuk [nama/id]"
    const absenInMatch = msg.match(/^(?:absen(?:kan)?|absen masuk)\s+(.+)/);
    if (absenInMatch && canManageAttendance) {
      const query = absenInMatch[1].trim();
      const result = await handleAbsenSiswa(query, 'in');
      return result;
    }
    
    // 2. ABSENSI PULANG: "pulangkan [nama/id]" atau "absen pulang [nama/id]"
    const absenOutMatch = msg.match(/^(?:pulangkan|absen pulang)\s+(.+)/);
    if (absenOutMatch && canManageAttendance) {
      const query = absenOutMatch[1].trim();
      const result = await handleAbsenSiswa(query, 'out');
      return result;
    }
    
    // 3. HAPUS SISWA: "hapus siswa [nama/id]" atau "delete siswa [nama/id]"
    const deleteStudentMatch = msg.match(/^(?:hapus|delete)\s+(?:siswa|student)\s+(.+)/);
    if (deleteStudentMatch) {
      const query = deleteStudentMatch[1].trim();
      const result = await handleDeleteSiswa(query);
      return result;
    }
    
    // 4. HAPUS STAFF: "hapus staff [nama/id/email]"
    const deleteStaffMatch = msg.match(/^(?:hapus|delete)\s+(?:staff|guru)\s+(.+)/);
    if (deleteStaffMatch) {
      const query = deleteStaffMatch[1].trim();
      const result = await handleDeleteStaff(query);
      return result;
    }
    
    // 5. TAMBAH SISWA: "tambah siswa [nama] kelas [kelas] wa [nomor]"
    const addStudentMatch = msg.match(/tambah\s+siswa\s+([^\s]+(?:\s+[^\s]+)*?)\s+kelas\s+([^\s]+)(?:\s+jurusan\s+([^\s]+))?(?:\s+wa\s+([^\s]+))?/i);
    if (addStudentMatch) {
      const nama = addStudentMatch[1].trim();
      const kelas = addStudentMatch[2].trim();
      const jurusan = addStudentMatch[3]?.trim() || '';
      const parentPhone = addStudentMatch[4]?.trim() || '08123456789';
      const result = await handleAddSiswa(nama, kelas, jurusan, parentPhone);
      return result;
    }
    
    // 6. TAMBAH STAFF: "tambah staff [nama] jabatan [jabatan] email [email]"
    const addStaffMatch = msg.match(/tambah\s+staff\s+([^\s]+(?:\s+[^\s]+)*?)\s+jabatan\s+([^\s]+(?:\s+[^\s]+)*?)\s+email\s+([^\s]+@[^\s]+)(?:\s+wa\s+([^\s]+))?/i);
    if (addStaffMatch) {
      const nama = addStaffMatch[1].trim();
      const jabatan = addStaffMatch[2].trim();
      const email = addStaffMatch[3].trim();
      const noHp = addStaffMatch[4]?.trim() || '08123456789';
      const result = await handleAddStaff(nama, jabatan, email, noHp);
      return result;
    }
    
    // 7. LIHAT DATA SISWA: "lihat siswa [nama/id]" atau "data siswa [nama/id]"
    const getStudentMatch = msg.match(/^(?:lihat|data)\s+siswa\s+(.+)/);
    if (getStudentMatch) {
      const query = getStudentMatch[1].trim();
      const result = await handleGetSiswa(query);
      if (result.success) {
        const d = result.data;
        return {
          success: true,
          message: `📋 **Data Siswa**\n\n👤 Nama: ${d.nama}\n🆔 ID: ${d.id}\n📚 Kelas: ${d.kelas}\n🎓 Jurusan: ${d.jurusan}\n📱 WA: ${d.parentPhone || '-'}\n📧 Email: ${d.email}\n🔐 Akun: ${d.hasAccount ? '✅ Ada' : '❌ Belum'}`
        };
      }
      return result;
    }
    
    // 8. LIHAT DATA STAFF: "lihat staff [nama/id/email]"
    const getStaffMatch = msg.match(/^(?:lihat|data)\s+staff\s+(.+)/);
    if (getStaffMatch) {
      const query = getStaffMatch[1].trim();
      const result = await handleGetStaff(query);
      if (result.success) {
        const d = result.data;
        return {
          success: true,
          message: `📋 **Data Staff**\n\n👤 Nama: ${d.nama}\n🆔 ID: ${d.id}\n👔 Jabatan: ${d.jabatan}\n🏢 Departemen: ${d.departemen || '-'}\n📧 Email: ${d.email}\n📱 No HP: ${d.noHp || '-'}\n🔐 Akun: ${d.hasAccount ? '✅ Ada' : '❌ Belum'}`
        };
      }
      return result;
    }
    
    // 9. LIST SISWA: "daftar siswa" atau "list siswa"
    if (msg.match(/^(?:daftar|list)\s+siswa/)) {
      const filter = {};
      const kelasMatch = msg.match(/kelas\s+([^\s]+)/);
      if (kelasMatch) filter.kelas = kelasMatch[1].trim();
      const result = await handleListSiswa(filter);
      if (result.success) {
        const d = result.data;
        if (d.students.length === 0) {
          return { success: true, message: '📭 Tidak ada siswa ditemukan' };
        }
        let list = d.students.slice(0, 10).map((s, i) => 
          `${i+1}. ${s.nama} (${s.kelas}) - ID: ${s.id}`
        ).join('\n');
        if (d.students.length > 10) {
          list += `\n... dan ${d.students.length - 10} siswa lainnya`;
        }
        return {
          success: true,
          message: `📋 **Daftar Siswa** (${d.total})\n\n${list}`
        };
      }
      return result;
    }
    
    // 10. LIST STAFF: "daftar staff" atau "list staff"
    if (msg.match(/^(?:daftar|list)\s+staff/)) {
      const filter = {};
      const jabatanMatch = msg.match(/jabatan\s+([^\s]+)/);
      if (jabatanMatch) filter.jabatan = jabatanMatch[1].trim();
      const result = await handleListStaff(filter);
      if (result.success) {
        const d = result.data;
        if (d.staffs.length === 0) {
          return { success: true, message: '📭 Tidak ada staff ditemukan' };
        }
        let list = d.staffs.slice(0, 10).map((s, i) => 
          `${i+1}. ${s.nama} (${s.jabatan}) - ID: ${s.id}`
        ).join('\n');
        if (d.staffs.length > 10) {
          list += `\n... dan ${d.staffs.length - 10} staff lainnya`;
        }
        return {
          success: true,
          message: `📋 **Daftar Staff** (${d.total})\n\n${list}`
        };
      }
      return result;
    }
    
    // 11. CEK ABSENSI: "cek absen [nama/id]" atau "status absen [nama/id]"
    const checkAbsenMatch = msg.match(/^(?:cek|status)\s+absen\s+(.+)/);
    if (checkAbsenMatch) {
      const query = checkAbsenMatch[1].trim();
      const result = await handleCheckAttendance(query);
      if (result.success) {
        const d = result.data;
        return {
          success: true,
          message: `📊 **Status Absensi**\n\n👤 Nama: ${d.nama}\n📚 Kelas: ${d.kelas} - ${d.jurusan}\n📅 Hari ini: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}\n✅ Status: ${d.status}\n⏰ Masuk: ${d.timeIn}\n🏠 Pulang: ${d.timeOut}`
        };
      }
      return result;
    }
    
    // 12. STATISTIK: "statistik" atau "ringkasan"
    if (msg.match(/^(?:statistik|ringkasan|dashboard)/)) {
      const totalSiswa = studentsCache.length;
      const totalStaff = staffCache.length;
      const totalUser = usersAuthCache.length;
      
      const today = new Date().toISOString().split('T')[0];
      let hadirToday = 0;
      let pulangToday = 0;
      try {
        const snapshot = await get(ref(db, `absensi/${today}`));
        const data = snapshot.val();
        if (data) {
          Object.values(data).forEach(record => {
            if (record.in) hadirToday++;
            if (record.out) pulangToday++;
          });
        }
      } catch (e) {}
      
      return {
        success: true,
        message: `📊 **Statistik Sekolah**\n\n👥 Total Siswa: ${totalSiswa}\n👔 Total Staff: ${totalStaff}\n🔐 Total User: ${totalUser}\n\n📅 Hari Ini:\n✅ Hadir: ${hadirToday}\n🏠 Pulang: ${pulangToday}\n\n📱 AI Assistant siap membantu!`
      };
    }

    // 13. CARI SISWA (tanpa perintah spesifik): "cari [nama]" atau "[nama] siapa"
    const searchMatch = msg.match(/^(?:cari|siapa)\s+(.+)/);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      const student = findStudent(query);
      if (student) {
        const userAuth = usersAuthCache.find(u => u.fpId == student.id || u.userId == student.id);
        return {
          success: true,
          message: `📋 **Data Siswa**\n\n👤 Nama: ${student.nama}\n🆔 ID: ${student.id}\n📚 Kelas: ${student.kelas || '-'}\n🎓 Jurusan: ${student.jurusan || '-'}\n📱 WA: ${student.parentPhone || '-'}\n📧 Email: ${userAuth?.email || '-'}\n🔐 Akun: ${userAuth ? '✅ Ada' : '❌ Belum'}`
        };
      }
      
      const staff = findStaff(query);
      if (staff) {
        const userAuth = usersAuthCache.find(u => u.staffId == staff.id || u.userId == staff.id);
        return {
          success: true,
          message: `📋 **Data Staff**\n\n👤 Nama: ${staff.nama}\n🆔 ID: ${staff.id}\n👔 Jabatan: ${staff.jabatan || '-'}\n🏢 Departemen: ${staff.departemen || '-'}\n📧 Email: ${staff.email || '-'}\n📱 No HP: ${staff.noHp || '-'}\n🔐 Akun: ${userAuth ? '✅ Ada' : '❌ Belum'}`
        };
      }
      
      return { 
        success: false, 
        error: `Tidak ditemukan data untuk "${query}"` 
      };
    }
    
    // 14. HELP / BANTUAN
    if (msg.match(/^(?:help|bantuan|tolong|\?)/)) {
      let helpMessage = `🤖 **Perintah yang tersedia:**

📌 **Absensi:**
• "absenkan [nama/id]" - Absen masuk
• "pulangkan [nama/id]" - Absen pulang
• "cek absen [nama/id]" - Cek status absensi

📌 **Data:**
• "lihat siswa [nama/id]" - Lihat data siswa
• "lihat staff [nama/id/email]" - Lihat data staff
• "daftar siswa" - List semua siswa
• "daftar staff" - List semua staff
• "cari [nama]" - Cari siswa/staff

📌 **Manajemen (Admin/Developer):**
• "tambah siswa [nama] kelas [kelas] wa [nomor]"
• "tambah staff [nama] jabatan [jabatan] email [email]"
• "hapus siswa [nama/id]"
• "hapus staff [nama/id/email]"

📌 **Lainnya:**
• "statistik" - Lihat ringkasan data
• "help" - Tampilkan bantuan ini

💡 **Tips:** AI dapat mengenali nama meskipun ada typo!`;
      
      if (!isFullAccess) {
        helpMessage += `\n\n🔒 **Akses Anda:** ${isGuru ? 'Guru' : isStaff ? 'Staff TU' : 'User'} - Beberapa fitur terbatas.`;
      }
      
      return { success: true, message: helpMessage };
    }
    
    // Tidak dikenali sebagai command, kirim ke AI biasa
    return null;
  }, [
    canManageAttendance, canDeleteData, isFullAccess, isGuru, isStaff,
    handleAbsenSiswa, handleDeleteSiswa, handleDeleteStaff,
    handleAddSiswa, handleAddStaff, handleGetSiswa, handleGetStaff,
    handleListSiswa, handleListStaff, handleCheckAttendance,
    studentsCache, staffCache, usersAuthCache, findStudent, findStaff
  ]);

  // ==================== SUGGESTIONS ====================
  const getSuggestions = useCallback(() => {
    const suggestions = [
      {
        id: 's1',
        icon: '✅',
        title: 'Absen Masuk Siswa',
        description: 'Absenkan siswa dengan nama atau ID',
        prompt: 'absenkan '
      },
      {
        id: 's2',
        icon: '🏠',
        title: 'Absen Pulang Siswa',
        description: 'Absen pulang siswa dengan nama atau ID',
        prompt: 'pulangkan '
      },
      {
        id: 's3',
        icon: '📋',
        title: 'Lihat Data Siswa',
        description: 'Lihat detail data siswa',
        prompt: 'lihat siswa '
      },
      {
        id: 's4',
        icon: '👔',
        title: 'Lihat Data Staff',
        description: 'Lihat detail data staff',
        prompt: 'lihat staff '
      },
      {
        id: 's5',
        icon: '📊',
        title: 'Cek Absensi Hari Ini',
        description: 'Cek status absensi siswa',
        prompt: 'cek absen '
      },
      {
        id: 's6',
        icon: '📚',
        title: 'Daftar Siswa',
        description: 'Lihat semua siswa',
        prompt: 'daftar siswa'
      },
      {
        id: 's7',
        icon: '👥',
        title: 'Daftar Staff',
        description: 'Lihat semua staff',
        prompt: 'daftar staff'
      },
      {
        id: 's8',
        icon: '📊',
        title: 'Statistik Sekolah',
        description: 'Lihat ringkasan data',
        prompt: 'statistik'
      }
    ];

    if (isFullAccess || isDeveloper) {
      suggestions.push(
        {
          id: 's9',
          icon: '🗑️',
          title: 'Hapus Siswa',
          description: 'Hapus data siswa (Admin/Developer)',
          prompt: 'hapus siswa '
        },
        {
          id: 's10',
          icon: '➕',
          title: 'Tambah Siswa',
          description: 'Tambah siswa baru',
          prompt: 'tambah siswa '
        }
      );
    }

    if (isFullAccess) {
      suggestions.push(
        {
          id: 's11',
          icon: '👤',
          title: 'Tambah Staff',
          description: 'Tambah staff baru (Admin/Developer)',
          prompt: 'tambah staff '
        },
        {
          id: 's12',
          icon: '🗑️',
          title: 'Hapus Staff',
          description: 'Hapus data staff (Admin/Developer)',
          prompt: 'hapus staff '
        }
      );
    }

    return suggestions;
  }, [isFullAccess, isDeveloper]);

  // ==================== SEND MESSAGE TO AI ====================
  const sendToAI = useCallback(async (message) => {
    if (!message.trim()) return;
    if (!hasAIAccess) {
      setError('⚠️ Anda tidak memiliki akses ke AI Assistant.');
      return;
    }

    // Add user message
    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);
    setShowSuggestions(false);
    setIsTyping(true);

    try {
      // Cek apakah ini command
      const commandResult = await processCommand(message);
      
      if (commandResult) {
        const aiMessage = {
          id: Date.now() + 1,
          role: 'assistant',
          content: commandResult.success ? commandResult.message : `❌ ${commandResult.error}`,
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, aiMessage]);
        setLoading(false);
        setIsTyping(false);
        scrollToBottom();
        return;
      }

      // Jika bukan command, kirim ke AI biasa
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Tidak dapat memperoleh token autentikasi');
      }

      const history = messages.slice(-10).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }));

      const systemPrompt = getSystemPrompt();

      const response = await fetch(`${API_BASE_URL}/ai/groq`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: message,
          systemPrompt: systemPrompt,
          history: history
        })
      });

      if (!response.ok) {
        let errorMessage = `AI request failed (${response.status})`;
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
        throw new Error(result.error || 'AI request failed');
      }

      const aiMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: result.response || result.data?.response || 'Maaf, saya tidak dapat memproses permintaan Anda.',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessage]);

      if (typeof window.logActivity === 'function') {
        window.logActivity('ai_chat', `AI Chat: ${message.substring(0, 50)}...`);
      }

    } catch (error) {
      console.error('❌ AI Error:', error);
      
      // Fallback ke OpenAI
      if (aiProvider === 'groq') {
        try {
          const token = await getAuthToken();
          if (!token) throw new Error('No token');
          
          const systemPrompt = getSystemPrompt();
          const history = messages.slice(-10).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          }));

          const response = await fetch(`${API_BASE_URL}/ai/openai`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              message: message,
              systemPrompt: systemPrompt,
              history: history
            })
          });

          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              const aiMessage = {
                id: Date.now() + 1,
                role: 'assistant',
                content: result.response || 'Maaf, saya tidak dapat memproses permintaan Anda.',
                timestamp: new Date().toISOString()
              };
              setMessages(prev => [...prev, aiMessage]);
              setLoading(false);
              setIsTyping(false);
              scrollToBottom();
              return;
            }
          }
        } catch (fallbackError) {
          console.error('❌ OpenAI fallback also failed:', fallbackError);
        }
      }

      setError('❌ Gagal mendapatkan respon dari AI: ' + error.message);
      
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `⚠️ Maaf, terjadi kesalahan: ${error.message}. Silakan coba lagi.`,
        timestamp: new Date().toISOString(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setIsTyping(false);
      scrollToBottom();
    }
  }, [messages, hasAIAccess, getAuthToken, scrollToBottom, getSystemPrompt, aiProvider, processCommand]);

  // ==================== HANDLE SUGGESTION CLICK ====================
  const handleSuggestionClick = useCallback((suggestion) => {
    setSelectedPrompt(suggestion);
    const promptText = suggestion.prompt
      .replace(/{kelas}/g, user?.kelas || 'kelas')
      .replace(/{jurusan}/g, user?.jurusan || 'jurusan')
      .replace(/{topik}/g, 'topik')
      .replace(/{tingkat}/g, 'sedang')
      .replace(/{periode}/g, '1 bulan terakhir')
      .replace(/{materi}/g, 'materi')
      .replace(/{mapel}/g, 'mata pelajaran')
      .replace(/{tujuan}/g, 'tujuan')
      .replace(/{target}/g, 'target')
      .replace(/{nama}/g, 'nama siswa')
      .replace(/{ujian}/g, 'ujian');

    setInput(promptText);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, [user]);

  // ==================== HANDLE KEY PRESS ====================
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading && input.trim()) {
        sendToAI(input);
      }
    }
  }, [input, loading, sendToAI]);

  // ==================== CLEAR CHAT ====================
  const clearChat = useCallback(() => {
    if (messages.length === 0) return;
    if (window.confirm('Yakin ingin menghapus semua percakapan?')) {
      setMessages([]);
      setShowSuggestions(true);
      if (typeof window.logActivity === 'function') {
        window.logActivity('ai_clear_chat', 'Membersihkan chat AI');
      }
    }
  }, [messages]);

  // ==================== RESET SUGGESTIONS ====================
  const resetSuggestions = useCallback(() => {
    setShowSuggestions(true);
    setSelectedPrompt(null);
  }, []);

  // ==================== SWITCH AI PROVIDER ====================
  const toggleAIProvider = useCallback(() => {
    setAiProvider(prev => prev === 'groq' ? 'openai' : 'groq');
    if (typeof window.showToast === 'function') {
      window.showToast(`🔄 Beralih ke ${aiProvider === 'groq' ? 'OpenAI' : 'GROQ'}`, 'info');
    }
  }, [aiProvider]);

  // ==================== FORMAT TIME ====================
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', { 
      hour: '2-digit', 
      minute: '2-digit'
    });
  };

  // ==================== FORMAT DATE ====================
  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return 'Hari ini';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Kemarin';
    } else {
      return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }
  };

  // ==================== GROUP MESSAGES BY DATE ====================
  const groupMessagesByDate = (messages) => {
    const groups = [];
    let currentDate = '';
    
    messages.forEach((msg) => {
      const date = formatDate(msg.timestamp);
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });
    
    return groups;
  };

  // ==================== RENDER ====================
  if (!hasAIAccess) {
    return (
      <div className="ai-container">
        <div className="ai-access-denied">
          <div className="access-denied-icon">🔒</div>
          <h3>Akses Terbatas</h3>
          <p>AI Assistant hanya tersedia untuk Guru, Staff TU, Admin, Wakil Kepala, dan Developer.</p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Silakan hubungi admin jika Anda memerlukan akses.
          </p>
        </div>
      </div>
    );
  }

  const messageGroups = groupMessagesByDate(messages);
  const suggestions = getSuggestions();

  return (
    <div className="ai-container">
      {/* ===== HEADER ===== */}
      <div className="ai-header">
        <div className="header-left">
          {/* ⭐ MENGGUNAKAN MARQUEE TEXT UNTUK NAMA SEKOLAH ⭐ */}
          <div className="ai-school-name-wrapper">
            <MarqueeText 
              text={schoolName || 'Sistem Absensi'} 
              speed={30}
              className="ai-school-name-marquee"
            />
            <div className="ai-school-name-underline"></div>
          </div>
          <h1>🤖 AI Assistant</h1>
          <p className="header-subtitle">
            Asisten AI dengan kemampuan manajemen data & fuzzy search
          </p>
        </div>
        <div className="header-actions">
          <button 
            className="btn-switch-provider"
            onClick={toggleAIProvider}
          >
            {aiProvider === 'groq' ? '🧠 GROQ' : '🤖 OpenAI'}
          </button>
          {messages.length > 0 && (
            <button className="btn-clear-chat" onClick={clearChat}>
              🗑️
            </button>
          )}
        </div>
      </div>

      {/* ===== ROLE BADGE ===== */}
      <div className="ai-role-badge">
        <span className="role-badge" style={{
          background: isDeveloper ? 'rgba(155,89,182,0.15)' : 
                     isAdmin ? 'rgba(231,76,60,0.15)' :
                     isWakilKepala ? 'rgba(52,152,219,0.15)' :
                     isGuru ? 'rgba(243,156,18,0.15)' :
                     'rgba(0,188,212,0.1)',
          color: isDeveloper ? '#9b59b6' : 
                 isAdmin ? '#e74c3c' :
                 isWakilKepala ? '#3498db' :
                 isGuru ? '#f39c12' :
                 '#00bcd4'
        }}>
          {isDeveloper ? '👨‍💻 Developer' : 
           isAdmin ? '👑 Admin' : 
           isWakilKepala ? '👔 Wakil Kepala' :
           isGuru ? '👨‍🏫 Guru' : '📋 Staff TU'}
          {isFullAccess && ' 🔓 Full Access'}
          {canDeleteData && ' 🗑️ Can Delete'}
        </span>
        <span className="ai-provider-badge" style={{
          color: aiProvider === 'groq' ? '#00bcd4' : '#9b59b6'
        }}>
          🧠 {aiProvider === 'groq' ? 'GROQ' : 'OpenAI'}
        </span>
        <span className="ai-school-badge">
          🏫 {schoolName || 'Sistem Absensi'}
        </span>
      </div>

      {/* ===== ERROR ===== */}
      {error && (
        <div className="ai-error">
          <span>❌</span>
          <span>{error}</span>
          <button className="btn-close-error" onClick={() => setError(null)}>✖</button>
        </div>
      )}

      {/* ===== CHAT MESSAGES ===== */}
      <div className="ai-chat-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="ai-empty-state">
            <div className="empty-icon">🤖</div>
            <h3>Ada yang bisa saya bantu?</h3>
            <p>Ketik perintah seperti "absenkan [nama]" atau "lihat siswa [nama]"</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {isFullAccess ? '🔓 Anda memiliki akses penuh ke semua fitur' : 
               canManageAttendance ? '✅ Anda dapat mengelola absensi' : '👁️ Anda dapat melihat data'}
              <span style={{ display: 'block', fontSize: '11px', color: '#4caf50', marginTop: '2px' }}>
                🧠 AI dapat mengenali nama meskipun typo!
              </span>
            </p>
          </div>
        ) : (
          <div className="ai-messages">
            {messageGroups.map((group, groupIndex) => (
              <div key={groupIndex} className="message-group">
                <div className="message-date-divider">
                  <span>{group.date}</span>
                </div>
                {group.messages.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={`ai-message ${msg.role === 'user' ? 'user' : 'assistant'} ${msg.isError ? 'error' : ''}`}
                  >
                    <div className="message-avatar">
                      {msg.role === 'user' ? (
                        <img 
                          src={user?.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.nama || 'User')}&background=00bcd4&color=fff&size=40&bold=true`} 
                          alt={user?.nama}
                          onError={(e) => {
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.nama?.charAt(0) || 'U')}&background=00bcd4&color=fff&size=40&bold=true`;
                          }}
                        />
                      ) : (
                        <span className="ai-avatar">🤖</span>
                      )}
                    </div>
                    <div className="message-content">
                      <div className="message-header">
                        <span className="message-sender">
                          {msg.role === 'user' ? user?.nama || 'User' : 'AI Assistant'}
                          {msg.role === 'assistant' && !msg.isError && (
                            <span className="ai-badge" style={{
                              background: aiProvider === 'groq' ? 'linear-gradient(135deg, #00bcd4, #0097a7)' : 'linear-gradient(135deg, #9b59b6, #7b1fa2)'
                            }}>
                              {aiProvider === 'groq' ? 'GROQ' : 'OpenAI'}
                            </span>
                          )}
                        </span>
                        <span className="message-time">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div className="message-text">
                        {msg.content.split('\n').map((line, idx) => (
                          <p key={idx}>{line || ' '}</p>
                        ))}
                      </div>
                      {msg.role === 'assistant' && !msg.isError && (
                        <div className="message-actions">
                          <button 
                            className="btn-copy"
                            onClick={() => {
                              navigator.clipboard.writeText(msg.content);
                              if (typeof window.showToast === 'function') {
                                window.showToast('✅ Teks disalin', 'success');
                              }
                            }}
                          >
                            📋 Salin
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {isTyping && (
              <div className="ai-message assistant loading">
                <div className="message-avatar">
                  <span className="ai-avatar">🤖</span>
                </div>
                <div className="message-content">
                  <div className="message-header">
                    <span className="message-sender">
                      AI Assistant 
                      <span className="ai-badge" style={{
                        background: aiProvider === 'groq' ? 'linear-gradient(135deg, #00bcd4, #0097a7)' : 'linear-gradient(135deg, #9b59b6, #7b1fa2)'
                      }}>
                        {aiProvider === 'groq' ? 'GROQ' : 'OpenAI'}
                      </span>
                    </span>
                  </div>
                  <div className="message-text loading-text">
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                    <span className="dot">.</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* ===== SUGGESTIONS ===== */}
        {showSuggestions && messages.length === 0 && (
          <div className="ai-suggestions">
            <h4>💡 Coba perintah:</h4>
            <div className="suggestions-grid">
              {suggestions.map((suggestion) => (
                <div 
                  key={suggestion.id}
                  className="suggestion-card"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  <div className="suggestion-icon">{suggestion.icon}</div>
                  <div className="suggestion-info">
                    <div className="suggestion-title">{suggestion.title}</div>
                    <div className="suggestion-description">{suggestion.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== INPUT AREA ===== */}
        <div className="ai-input-area">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isMobile ? "Tulis pesan..." : "Ketik perintah... (Enter untuk kirim)"}
              rows={isMobile ? 2 : 1}
              className="ai-input"
              disabled={loading}
            />
            <button
              className="btn-send-ai"
              onClick={() => sendToAI(input)}
              disabled={!input.trim() || loading}
            >
              {loading ? '⏳' : '📤'}
            </button>
          </div>
          <div className="input-info">
            <span>💡 Enter untuk kirim • 🧠 Toleran typo</span>
            <span className="input-role">
              {getRoleIcon(user?.role)} {getRoleDisplayName(user?.role)}
            </span>
          </div>
        </div>
      </div>

      {/* ===== FOOTER ===== */}
      <div className="ai-footer">
        <p>
          🤖 AI Assistant
          <span className="footer-status"> • {loading ? '⏳ Memproses...' : '✅ Siap'}</span>
          {isFullAccess && <span className="footer-full-access"> • 🔓 Full Access</span>}
          {canDeleteData && <span className="footer-delete"> • 🗑️ Dapat menghapus data</span>}
          <span className="footer-fuzzy"> • 🧠 Fuzzy Search Aktif</span>
          <span className="footer-school"> • 🏫 {schoolName || 'Sistem Absensi'}</span>
        </p>
      </div>
    </div>
  );
};

export default AITab;