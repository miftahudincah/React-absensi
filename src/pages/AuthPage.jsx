// src/pages/AuthPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from '../firebase/config';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  signOut // ✅ GABUNGKAN signOut DI SINI
} from 'firebase/auth';
import { ref, set, update, get } from 'firebase/database';
import './AuthPage.css';

// Konfigurasi
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCKOUT_DURATION = 60;
const STORAGE_KEY = 'login_attempts_data';
const REGISTER_COOLDOWN = 30000;
const API_BASE_URL = 'https://backendtest-azure.vercel.app';

const AuthPage = ({ onLoginSuccess }) => {
  // State untuk mode
  const [mode, setMode] = useState('login');
  
  // State form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regCode, setRegCode] = useState('');
  const [regType, setRegType] = useState('siswa');
  const [fpId, setFpId] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [staffId, setStaffId] = useState('');
  const [staffNama, setStaffNama] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  
  // State loading & error
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // State lockout
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [loginAttempts, setLoginAttempts] = useState({});
  const lockoutIntervalRef = useRef(null);
  
  // State QR Scanner
  const [isScanning, setIsScanning] = useState(false);
  const html5QrCodeRef = useRef(null);
  const scannerContainerRef = useRef(null);

  // ==================== LOCKOUT FUNCTIONS ====================
  
  const loadLoginAttempts = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        const now = Math.floor(Date.now() / 1000);
        let hasChanges = false;
        for (const [key, value] of Object.entries(data)) {
          if (value.lockUntil && value.lockUntil <= now) {
            delete data[key];
            hasChanges = true;
          }
        }
        setLoginAttempts(data);
        if (hasChanges) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
      }
    } catch (e) {
      console.warn('Failed to load login attempts:', e);
    }
  };

  const saveLoginAttempts = (data) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save login attempts:', e);
    }
  };

  const getLoginIdentifier = (email) => email.toLowerCase().trim();

  const getLoginLockStatus = (email) => {
    const identifier = getLoginIdentifier(email);
    const data = loginAttempts[identifier];
    const now = Math.floor(Date.now() / 1000);
    
    if (!data) {
      return { isLocked: false, remainingTime: 0, attempts: 0 };
    }
    
    if (data.lockUntil && data.lockUntil > now) {
      const remaining = data.lockUntil - now;
      return { 
        isLocked: true, 
        remainingTime: remaining,
        attempts: data.attempts || 0
      };
    }
    
    if (data.lockUntil && data.lockUntil <= now) {
      const newData = { ...loginAttempts };
      delete newData[identifier];
      setLoginAttempts(newData);
      saveLoginAttempts(newData);
      return { isLocked: false, remainingTime: 0, attempts: 0 };
    }
    
    return { 
      isLocked: false, 
      remainingTime: 0,
      attempts: data.attempts || 0
    };
  };

  const handleLoginFailure = (email) => {
    const identifier = getLoginIdentifier(email);
    const now = Math.floor(Date.now() / 1000);
    
    const newData = { ...loginAttempts };
    if (!newData[identifier]) {
      newData[identifier] = {
        attempts: 0,
        firstAttempt: now,
        lastAttempt: now
      };
    }
    
    newData[identifier].attempts = (newData[identifier].attempts || 0) + 1;
    newData[identifier].lastAttempt = now;
    
    if (newData[identifier].attempts >= MAX_LOGIN_ATTEMPTS) {
      newData[identifier].lockUntil = now + LOGIN_LOCKOUT_DURATION;
      setIsLocked(true);
      setLockoutRemaining(LOGIN_LOCKOUT_DURATION);
      startLockoutCountdown(LOGIN_LOCKOUT_DURATION);
    }
    
    setLoginAttempts(newData);
    saveLoginAttempts(newData);
    return newData[identifier];
  };

  const resetLoginAttempts = (email) => {
    const identifier = getLoginIdentifier(email);
    const newData = { ...loginAttempts };
    delete newData[identifier];
    setLoginAttempts(newData);
    saveLoginAttempts(newData);
    setIsLocked(false);
    setLockoutRemaining(0);
    if (lockoutIntervalRef.current) {
      clearInterval(lockoutIntervalRef.current);
      lockoutIntervalRef.current = null;
    }
  };

  const startLockoutCountdown = (seconds) => {
    if (lockoutIntervalRef.current) {
      clearInterval(lockoutIntervalRef.current);
    }
    
    lockoutIntervalRef.current = setInterval(() => {
      setLockoutRemaining((prev) => {
        const newVal = prev - 1;
        if (newVal <= 0) {
          clearInterval(lockoutIntervalRef.current);
          lockoutIntervalRef.current = null;
          setIsLocked(false);
          return 0;
        }
        return newVal;
      });
    }, 1000);
  };

  const getRemainingTimeText = (seconds) => {
    if (seconds <= 0) return 'sekarang';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins} menit ${secs} detik`;
    }
    return `${secs} detik`;
  };

  // ==================== TOKEN MANAGEMENT ====================
  
  /**
   * Get JWT token from backend after login
   */
  const getBackendToken = async (email, password) => {
    try {
      console.log('🔑 Getting backend token for:', email);
      
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const result = await response.json();
      console.log('🔑 Backend login response:', result.success ? 'Success' : 'Failed');
      
      if (result.success && result.token) {
        localStorage.setItem('authToken', result.token);
        console.log('✅ JWT token saved from backend (length: ' + result.token.length + ')');
        return result.token;
      } else {
        console.warn('⚠️ Backend login failed:', result.error || 'Unknown error');
        return null;
      }
    } catch (error) {
      console.warn('⚠️ Error getting backend token:', error.message);
      return null;
    }
  };

  /**
   * Get Firebase ID token as fallback
   */
  const getFirebaseToken = async (user) => {
    try {
      console.log('🔑 Getting Firebase ID token...');
      const token = await user.getIdToken();
      localStorage.setItem('authToken', token);
      console.log('✅ Firebase ID token saved as fallback (length: ' + token.length + ')');
      return token;
    } catch (error) {
      console.error('❌ Failed to get Firebase token:', error);
      return null;
    }
  };

  /**
   * Verify token is saved
   */
  const verifyTokenSaved = () => {
    const token = localStorage.getItem('authToken');
    if (token) {
      console.log('✅ Token verified in localStorage (length: ' + token.length + ')');
      return true;
    } else {
      console.warn('⚠️ No token found in localStorage');
      return false;
    }
  };

  // ==================== QR SCANNER ====================
  
  const openQrScanner = () => {
    if (typeof window.Html5Qrcode === 'undefined') {
      setError('Library QR scanner belum dimuat. Muat ulang halaman.');
      return;
    }
    
    const existingContainer = document.getElementById('qr-scanner-container');
    if (existingContainer && existingContainer.parentNode) {
      try {
        existingContainer.parentNode.removeChild(existingContainer);
      } catch (e) {
        if (existingContainer.remove) existingContainer.remove();
      }
    }
    
    setIsScanning(true);
    
    const scannerContainer = document.createElement('div');
    scannerContainer.id = 'qr-scanner-container';
    scannerContainerRef.current = scannerContainer;
    scannerContainer.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.92);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;
    
    scannerContainer.innerHTML = `
      <div style="color: white; margin-bottom: 20px; font-size: 18px; display: flex; align-items: center; gap: 20px;">
        <span>📷 Arahkan kamera ke QR Code</span>
        <button id="close-scanner-btn" 
                style="padding: 8px 20px; border-radius: 30px; border: none; background: #f44336; color: white; cursor: pointer; font-size: 14px;">
          ✖ Tutup
        </button>
      </div>
      <div id="qr-reader" style="width: 100%; max-width: 400px; min-height: 300px; background: #000; border-radius: 12px; overflow: hidden;"></div>
      <div id="qr-reader-results" style="color: #ff9800; margin-top: 15px; padding: 8px; text-align: center; min-height: 30px;"></div>
    `;
    
    document.body.appendChild(scannerContainer);
    
    const closeBtn = document.getElementById('close-scanner-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeQrScanner();
      });
    }
    
    const qrReader = document.getElementById('qr-reader');
    const resultsDiv = document.getElementById('qr-reader-results');
    
    if (!qrReader) {
      setError('Elemen scanner tidak ditemukan!');
      setIsScanning(false);
      return;
    }
    
    try {
      const html5QrCode = new window.Html5Qrcode("qr-reader");
      html5QrCodeRef.current = html5QrCode;
      
      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        disableFlip: false
      };
      
      html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          console.log("✅ QR Code terbaca:", decodedText);
          if (resultsDiv) {
            resultsDiv.innerHTML = '<span style="color: #4caf50; font-weight: bold;">✅ QR terbaca! Memproses...</span>';
          }
          handleQrScan(decodedText);
          closeQrScanner();
        },
        () => {
          if (resultsDiv && !resultsDiv.innerHTML.includes('✅')) {
            resultsDiv.innerHTML = '<small style="color: #aaa;">🔍 Arahkan kamera ke QR Code...</small>';
          }
        }
      ).then(() => {
        setIsScanning(true);
        if (resultsDiv) {
          resultsDiv.innerHTML = '<small style="color: #4caf50; font-weight: bold;">📷 Kamera aktif. Arahkan ke QR Code.</small>';
        }
      }).catch((err) => {
        console.error("Gagal memulai scanner:", err);
        let errorMsg = "❌ Gagal mengakses kamera. ";
        if (err.message && err.message.includes('NotAllowedError')) {
          errorMsg += "Izin kamera ditolak. Periksa pengaturan browser.";
        } else if (err.message && err.message.includes('NotFoundError')) {
          errorMsg += "Tidak ada kamera yang terdeteksi.";
        } else if (err.message && err.message.includes('NotReadableError')) {
          errorMsg += "Kamera sedang digunakan oleh aplikasi lain.";
        } else {
          errorMsg += "Pastikan menggunakan HTTPS dan izinkan akses kamera.";
        }
        if (resultsDiv) {
          resultsDiv.innerHTML = `<span style="color: red;">${errorMsg}</span>`;
        }
        setError(errorMsg);
        setTimeout(() => closeQrScanner(), 3000);
      });
    } catch (err) {
      console.error("QR Scanner error:", err);
      setError('Gagal memulai scanner: ' + err.message);
      setIsScanning(false);
      closeQrScanner();
    }
  };

  const closeQrScanner = () => {
    if (html5QrCodeRef.current) {
      try {
        html5QrCodeRef.current.stop().then(() => {
          if (html5QrCodeRef.current) {
            html5QrCodeRef.current.clear();
            html5QrCodeRef.current = null;
          }
          setIsScanning(false);
        }).catch((e) => {
          console.warn("Error stopping scanner:", e);
          html5QrCodeRef.current = null;
          setIsScanning(false);
        });
      } catch (e) {
        console.warn("Error closing scanner:", e);
        html5QrCodeRef.current = null;
        setIsScanning(false);
      }
    }
    
    const container = document.getElementById('qr-scanner-container');
    if (container) {
      try {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        } else if (container.remove) {
          container.remove();
        }
      } catch (e) {
        console.warn('Error removing container:', e);
        try {
          if (container.remove) container.remove();
        } catch (e2) {
          console.warn('Fallback remove failed:', e2);
        }
      }
    }
    
    scannerContainerRef.current = null;
    setIsScanning(false);
  };

  const handleQrScan = (data) => {
    console.log("Data QR mentah:", data);
    try {
      const parsed = JSON.parse(data);
      if (parsed.code) {
        setRegCode(parsed.code);
        if (parsed.studentId) {
          setFpId(parsed.studentId);
          setRegType('siswa');
          setSuccessMessage('✅ Data QR siswa terisi! Silakan lengkapi email & password.');
        } else if (parsed.staffId && parsed.email) {
          setRegType('staff');
          setStaffId(parsed.staffId);
          setStaffEmail(parsed.email);
          if (parsed.staffName) {
            setStaffNama(parsed.staffName);
          }
          setSuccessMessage('✅ Data QR staff terisi! Pastikan ID Staff sudah terisi dengan benar.');
        } else if (parsed.requireId && parsed.staffId) {
          setRegType('staff');
          setStaffId(parsed.staffId);
          if (parsed.email) setStaffEmail(parsed.email);
          setSuccessMessage('✅ Kode Staff terdeteksi! ID Staff sudah terisi otomatis.');
        } else {
          setRegType('staff');
          setSuccessMessage('✅ Kode registrasi terisi. Silakan lengkapi data staff.');
        }
      } else {
        const maybeCode = data.trim();
        if (maybeCode.length > 5) {
          setRegCode(maybeCode);
          setSuccessMessage('✅ Kode registrasi terisi. Pilih role yang sesuai.');
        } else {
          setError('❌ Format QR tidak dikenali.');
        }
      }
    } catch (e) {
      const maybeCode = data.trim();
      if (maybeCode.length > 5) {
        setRegCode(maybeCode);
        setSuccessMessage('✅ Kode registrasi terisi. Pilih role yang sesuai.');
      } else {
        setError('❌ Format QR tidak dikenali.');
      }
    }
  };

  // ==================== AUTH FUNCTIONS ====================
  
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    
    if (!email || !password) {
      setError('Email dan password wajib diisi!');
      return;
    }
    
    const lockStatus = getLoginLockStatus(email);
    if (lockStatus.isLocked) {
      setIsLocked(true);
      setLockoutRemaining(lockStatus.remainingTime);
      startLockoutCountdown(lockStatus.remainingTime);
      setError(`🔒 Akun terkunci. Coba lagi dalam ${getRemainingTimeText(lockStatus.remainingTime)}.`);
      return;
    }
    
    setIsLoading(true);
    
    try {
      console.log('🔐 Attempting login for:', email);
      
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      console.log('✅ Firebase Auth success:', user.uid);
      
      resetLoginAttempts(email);
      
      const snapshot = await get(ref(db, `users_auth/${user.uid}`));
      const userData = snapshot.val();
      
      if (userData) {
        if (user.email === 'zaki5go@gmail.com') {
          userData.role = 'developer';
          await update(ref(db, `users_auth/${user.uid}`), { role: 'developer' });
        }
        
        const validRoles = ['developer', 'admin', 'wakil_kepala', 'staff_tu', 'guru', 'siswa'];
        if (!userData.role || !validRoles.includes(userData.role)) {
          userData.role = 'siswa';
          await update(ref(db, `users_auth/${user.uid}`), { role: 'siswa' });
        }
        
        const currentUser = { uid: user.uid, email: user.email, ...userData };
        
        localStorage.setItem('currentUser', JSON.stringify({
          uid: currentUser.uid,
          email: currentUser.email,
          nama: currentUser.nama,
          role: currentUser.role,
          kelas: currentUser.kelas || '',
          jurusan: currentUser.jurusan || '',
          fpId: currentUser.fpId || null,
          photoUrl: currentUser.photoUrl || ''
        }));
        console.log('✅ User data saved to localStorage');
        
        console.log('🔑 Getting JWT token from backend...');
        let token = await getBackendToken(email, password);
        
        if (!token) {
          console.log('⚠️ Backend token failed, using Firebase token fallback...');
          token = await getFirebaseToken(user);
        }
        
        if (token) {
          console.log('✅ Token obtained successfully');
          verifyTokenSaved();
        } else {
          console.warn('⚠️ No token available, but login continues');
        }
        
        window.dispatchEvent(new CustomEvent('userLoggedIn', { detail: { user: currentUser } }));
        
        if (onLoginSuccess) {
          onLoginSuccess(currentUser);
        }
      } else {
        setError('Data user tidak ditemukan di Database!');
        await signOut(auth);
      }
    } catch (error) {
      console.error('❌ Login error:', error);
      
      handleLoginFailure(email);
      
      let msg = error.message;
      if (error.code === 'auth/user-not-found') {
        msg = 'Email tidak terdaftar!';
      } else if (error.code === 'auth/wrong-password') {
        msg = 'Password salah!';
        const newStatus = getLoginLockStatus(email);
        if (newStatus.isLocked) {
          msg = `🔒 Terlalu banyak percobaan gagal. Coba lagi dalam ${getRemainingTimeText(newStatus.remainingTime)}.`;
        }
      } else if (error.code === 'auth/invalid-email') {
        msg = 'Format email tidak valid!';
      } else if (error.code === 'auth/too-many-requests') {
        msg = '🔒 Terlalu banyak percobaan. Coba lagi nanti.';
        const newStatus = handleLoginFailure(email);
        if (newStatus.lockUntil) {
          const remaining = newStatus.lockUntil - Math.floor(Date.now() / 1000);
          setIsLocked(true);
          setLockoutRemaining(remaining);
          startLockoutCountdown(remaining);
        }
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    
    const now = Date.now();
    const lastAttempt = parseInt(localStorage.getItem('lastRegisterAttempt') || '0');
    if (now - lastAttempt < REGISTER_COOLDOWN) {
      const wait = Math.ceil((REGISTER_COOLDOWN - (now - lastAttempt)) / 1000);
      setError(`Tunggu ${wait} detik sebelum mencoba lagi`);
      return;
    }
    localStorage.setItem('lastRegisterAttempt', now.toString());
    
    if (!regType || !regCode || !email || !password) {
      setError('Semua bidang wajib diisi!');
      return;
    }
    
    if (regType !== 'siswa' && regType !== 'staff') {
      setError('Pilih tipe pendaftaran yang valid (Siswa atau Staff)!');
      return;
    }
    
    if (!/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email)) {
      setError('Format email tidak valid!');
      return;
    }
    
    if (password.length < 6) {
      setError('Password minimal 6 karakter!');
      return;
    }
    
    if (email === 'zaki5go@gmail.com') {
      setError('Email ini tidak dapat didaftarkan melalui kode registrasi.');
      return;
    }
    
    let extraData = {};
    
    if (regType === 'siswa') {
      if (!fpId) {
        setError('Masukkan ID Siswa! ID wajib diisi.');
        return;
      }
      extraData = { fpId, parentPhone };
      
      if (parentPhone && !/^[0-9]{10,15}$/.test(parentPhone.replace(/[^0-9]/g, ''))) {
        setError('Format nomor WhatsApp tidak valid! Gunakan angka saja (10-15 digit).');
        return;
      }
    }
    
    if (regType === 'staff') {
      if (!staffId) {
        setError('ID Staff WAJIB diisi! Silakan masukkan ID Staff yang tertera pada QR Code atau dari admin.');
        return;
      }
      extraData = { staffId, staffNama, staffEmail, staffPhone };
      
      if (staffPhone && !/^[0-9]{10,15}$/.test(staffPhone.replace(/[^0-9]/g, ''))) {
        setError('Format nomor WhatsApp tidak valid! Gunakan angka saja (10-15 digit).');
        return;
      }
    }
    
    setIsLoading(true);
    
    try {
      const codeSnapshot = await get(ref(db, `codes/${regCode}`));
      const codeData = codeSnapshot.val();
      
      if (!codeData || codeData.used === true) {
        throw new Error('Kode tidak valid atau sudah digunakan');
      }
      
      if (regType === 'staff') {
        const allowedStaffTypes = ['guru', 'staff', 'staff_tu', 'wakil_kepala'];
        if (!allowedStaffTypes.includes(codeData.type)) {
          throw new Error(`Kode ini untuk ${codeData.type.toUpperCase()}, bukan untuk STAFF.`);
        }
      } else if (regType === 'siswa' && codeData.type !== 'siswa') {
        throw new Error(`Kode ini untuk ${codeData.type.toUpperCase()}, bukan SISWA.`);
      }
      
      const methods = await fetchSignInMethodsForEmail(auth, email);
      if (methods.length > 0) {
        throw new Error('Email sudah terdaftar');
      }
      
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      let userRole = 'siswa';
      let userData = {
        uid: user.uid,
        email,
        registeredAt: Date.now()
      };
      
      if (regType === 'siswa') {
        const studentSnap = await get(ref(db, `users/${fpId}`));
        if (!studentSnap.exists()) {
          await user.delete();
          throw new Error(`ID Fingerprint ${fpId} tidak ditemukan di data siswa`);
        }
        const student = studentSnap.val();
        userRole = 'siswa';
        userData.nama = student.nama;
        userData.kelas = student.kelas;
        userData.jurusan = student.jurusan;
        userData.fpId = fpId;
        userData.parentPhone = parentPhone || student.parentPhone || student.noHp || '';
        userData.noHp = parentPhone || student.parentPhone || student.noHp || '';
        
        if (parentPhone && !student.parentPhone) {
          await update(ref(db, `users/${fpId}`), { parentPhone, noHp: parentPhone });
        }
      } else if (regType === 'staff') {
        const inputStaffId = extraData.staffId;
        
        if (codeData.linkedId) {
          if (inputStaffId !== codeData.linkedId) {
            await user.delete();
            throw new Error(`ID Staff tidak sesuai! Kode ini terikat dengan ID Staff: ${codeData.linkedId}`);
          }
          
          if (codeData.linkedEmail && codeData.linkedEmail.toLowerCase() !== email.toLowerCase()) {
            await user.delete();
            throw new Error(`Email tidak sesuai! Staff ini harus menggunakan email: ${codeData.linkedEmail}`);
          }
          
          const staffSnap = await get(ref(db, `staff/${codeData.linkedId}`));
          const staffData = staffSnap.val();
          
          if (staffData) {
            userRole = codeData.targetRole || 'guru';
            userData.nama = staffData.nama;
            userData.jabatan = staffData.jabatan;
            userData.departemen = staffData.departemen || '';
            userData.staffId = codeData.linkedId;
            userData.noHp = staffPhone || staffData.noHp || '';
            
            if (staffPhone && !staffData.noHp) {
              await update(ref(db, `staff/${codeData.linkedId}`), { noHp: staffPhone });
            }
          } else {
            userRole = codeData.targetRole || 'guru';
            userData.nama = codeData.linkedName || staffNama || email.split('@')[0];
            userData.staffId = codeData.linkedId;
            userData.noHp = staffPhone || '';
          }
        } else {
          const staffName = staffNama;
          if (!staffName) {
            await user.delete();
            throw new Error('Nama staff wajib diisi!');
          }
          
          const staffSnapshot = await get(ref(db, 'staff'));
          const staffData = staffSnapshot.val();
          let matchedStaff = null;
          let matchedStaffId = null;
          
          if (staffData) {
            for (const [id, staff] of Object.entries(staffData)) {
              if (staff.nama && staff.nama.toLowerCase() === staffName.toLowerCase()) {
                matchedStaff = staff;
                matchedStaffId = id;
                break;
              }
            }
          }
          
          if (!matchedStaff) {
            await user.delete();
            throw new Error(`Staff dengan nama "${staffName}" tidak ditemukan.`);
          }
          
          if (matchedStaff.email && matchedStaff.email.toLowerCase() !== email.toLowerCase()) {
            await user.delete();
            throw new Error(`Email tidak sesuai! Staff ${staffName} harus menggunakan email: ${matchedStaff.email}`);
          }
          
          if (inputStaffId && inputStaffId !== matchedStaffId) {
            await user.delete();
            throw new Error(`ID Staff tidak sesuai! Staff "${staffName}" memiliki ID: ${matchedStaffId}`);
          }
          
          if (matchedStaff.jabatan === 'kepala_sekolah') userRole = 'admin';
          else if (matchedStaff.jabatan === 'wakil_kepala') userRole = 'wakil_kepala';
          else if (matchedStaff.jabatan === 'staff_tu') userRole = 'staff_tu';
          else userRole = 'guru';
          
          userData.nama = matchedStaff.nama;
          userData.jabatan = matchedStaff.jabatan;
          userData.departemen = matchedStaff.departemen || '';
          userData.staffId = matchedStaffId;
          userData.noHp = staffPhone || matchedStaff.noHp || '';
          
          if (staffPhone && !matchedStaff.noHp) {
            await update(ref(db, `staff/${matchedStaffId}`), { noHp: staffPhone });
          }
        }
      }
      
      userData.role = userRole;
      await set(ref(db, `users_auth/${user.uid}`), userData);
      
      const updateData = {
        used: true,
        userId: user.uid,
        usedAt: Date.now()
      };
      
      if (regType === 'staff') {
        updateData.createdAccountEmail = email;
        updateData.createdAccountRole = userRole;
        updateData.registeredStaffId = extraData.staffId;
      }
      
      await update(ref(db, `codes/${regCode}`), updateData);
      
      if (regType === 'staff' && userData.staffId) {
        await update(ref(db, `staff/${userData.staffId}`), { userId: user.uid });
      }
      
      setSuccessMessage('✅ Pendaftaran Berhasil! Silakan Login.');
      setMode('login');
      resetForm();
      
    } catch (error) {
      console.error('Register error:', error);
      let msg = error.message;
      if (msg.includes('Kode tidak valid')) msg = 'Kode pendaftaran tidak valid atau sudah kadaluarsa.';
      else if (msg.includes('Email sudah terdaftar')) msg = 'Email sudah digunakan.';
      else if (msg.includes('ID Fingerprint')) msg = error.message;
      else if (msg.includes('Staff dengan nama')) msg = error.message;
      else if (msg.includes('Email tidak sesuai')) msg = error.message;
      else if (msg.includes('ID Staff tidak sesuai')) msg = error.message;
      else if (msg.includes('ID Staff WAJIB')) msg = error.message;
      else if (msg.includes('untuk STAFF')) msg = error.message;
      else if (msg.includes('bukan SISWA')) msg = error.message;
      else msg = 'Registrasi gagal: ' + msg;
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    
    if (!forgotEmail) {
      setError('Masukkan email terlebih dahulu!');
      return;
    }
    
    setIsLoading(true);
    
    try {
      await sendPasswordResetEmail(auth, forgotEmail);
      setSuccessMessage(`✅ Link reset password telah dikirim ke ${forgotEmail}`);
      setTimeout(() => {
        setMode('login');
        setForgotEmail('');
      }, 3000);
    } catch (error) {
      console.error('Forgot password error:', error);
      if (error.code === 'auth/user-not-found') {
        setError('Email belum terdaftar!');
      } else if (error.code === 'auth/invalid-email') {
        setError('Format email tidak valid!');
      } else {
        setError('Gagal mengirim: ' + error.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setRegCode('');
    setFpId('');
    setParentPhone('');
    setStaffId('');
    setStaffNama('');
    setStaffEmail('');
    setStaffPhone('');
    setError('');
    setSuccessMessage('');
  };

  // ==================== CLEANUP ====================
  useEffect(() => {
    loadLoginAttempts();
    
    const token = localStorage.getItem('authToken');
    if (token) {
      console.log('🔑 Token found on mount (length: ' + token.length + ')');
    } else {
      console.log('🔑 No token found on mount');
    }
    
    return () => {
      if (lockoutIntervalRef.current) {
        clearInterval(lockoutIntervalRef.current);
        lockoutIntervalRef.current = null;
      }
      
      if (html5QrCodeRef.current) {
        try {
          html5QrCodeRef.current.stop();
          html5QrCodeRef.current.clear();
        } catch (e) {
          console.warn('QR cleanup error:', e);
        }
        html5QrCodeRef.current = null;
      }
      
      const container = document.getElementById('qr-scanner-container');
      if (container) {
        try {
          if (container.parentNode) {
            container.parentNode.removeChild(container);
          } else if (container.remove) {
            container.remove();
          }
        } catch (e) {
          console.warn('Container cleanup error:', e);
        }
      }
      
      scannerContainerRef.current = null;
      setIsScanning(false);
    };
  }, []);

  // ==================== RENDER ====================
  
  const renderLoginForm = () => (
    <form onSubmit={handleLogin} className="auth-form">
      <h2>🔐 Login</h2>
      
      {(error || successMessage) && (
        <div className={error ? 'auth-error' : 'auth-success'}>
          {error || successMessage}
        </div>
      )}
      
      <div className="form-group">
        <label>📧 Email</label>
        <input
          type="email"
          placeholder="Masukkan email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading || isLocked}
          required
        />
      </div>
      
      <div className="form-group">
        <label>🔒 Password</label>
        <input
          type="password"
          placeholder="Masukkan password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading || isLocked}
          required
        />
      </div>
      
      <button type="submit" className="btn-login" disabled={isLoading || isLocked}>
        {isLoading ? '⏳ Memproses...' : isLocked ? `⏳ Tunggu ${getRemainingTimeText(lockoutRemaining)}...` : 'MASUK'}
      </button>
      
      <div className="auth-links">
        <button type="button" onClick={() => setMode('forgot')} className="link-btn">
          Lupa Password?
        </button>
        <button type="button" onClick={() => { setMode('register'); resetForm(); }} className="link-btn">
          Belum punya akun? Daftar
        </button>
      </div>
    </form>
  );

  const renderRegisterForm = () => (
    <form onSubmit={handleRegister} className="auth-form">
      <h2>📝 Daftar Akun</h2>
      
      {(error || successMessage) && (
        <div className={error ? 'auth-error' : 'auth-success'}>
          {error || successMessage}
        </div>
      )}
      
      <div className="form-group">
        <label>📋 Tipe Pendaftaran</label>
        <div className="role-select">
          <label className={`role-option ${regType === 'siswa' ? 'active' : ''}`}>
            <input
              type="radio"
              name="regRoleType"
              value="siswa"
              checked={regType === 'siswa'}
              onChange={() => setRegType('siswa')}
            />
            👨‍🎓 Siswa
          </label>
          <label className={`role-option ${regType === 'staff' ? 'active' : ''}`}>
            <input
              type="radio"
              name="regRoleType"
              value="staff"
              checked={regType === 'staff'}
              onChange={() => setRegType('staff')}
            />
            👨‍🏫 Guru/Staff
          </label>
        </div>
      </div>
      
      <div className="form-group">
        <label>🔑 Kode Registrasi</label>
        <div className="qr-input-group">
          <input
            type="text"
            placeholder="Masukkan kode atau scan QR"
            value={regCode}
            onChange={(e) => setRegCode(e.target.value.toUpperCase())}
            required
          />
          <button type="button" className="btn-qr" onClick={openQrScanner} disabled={isScanning}>
            📷 Scan QR
          </button>
        </div>
      </div>
      
      <div className="form-group">
        <label>📧 Email</label>
        <input
          type="email"
          placeholder="Masukkan email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      
      <div className="form-group">
        <label>🔒 Password (min 6 karakter)</label>
        <input
          type="password"
          placeholder="Masukkan password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      
      {regType === 'siswa' && (
        <>
          <div className="form-group">
            <label>🆔 ID Fingerprint Siswa</label>
            <input
              type="text"
              placeholder="Masukkan ID Fingerprint"
              value={fpId}
              onChange={(e) => setFpId(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>📱 WhatsApp Orang Tua (Opsional)</label>
            <input
              type="tel"
              placeholder="Contoh: 08123456789"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
            />
            <small>Untuk notifikasi absensi siswa</small>
          </div>
        </>
      )}
      
      {regType === 'staff' && (
        <>
          <div className="form-group">
            <label>🆔 ID Staff (WAJIB)</label>
            <input
              type="text"
              placeholder="Masukkan ID Staff dari QR"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>📱 WhatsApp Staff (Opsional)</label>
            <input
              type="tel"
              placeholder="Contoh: 08123456789"
              value={staffPhone}
              onChange={(e) => setStaffPhone(e.target.value)}
            />
            <small>Untuk notifikasi absensi staff</small>
          </div>
        </>
      )}
      
      <button type="submit" className="btn-register" disabled={isLoading}>
        {isLoading ? '⏳ Mendaftar...' : '📤 Daftar'}
      </button>
      
      <div className="auth-links">
        <button type="button" onClick={() => { setMode('login'); resetForm(); }} className="link-btn">
          Sudah punya akun? Login
        </button>
      </div>
    </form>
  );

  const renderForgotForm = () => (
    <form onSubmit={handleForgotPassword} className="auth-form">
      <h2>🔑 Lupa Password</h2>
      
      {(error || successMessage) && (
        <div className={error ? 'auth-error' : 'auth-success'}>
          {error || successMessage}
        </div>
      )}
      
      <p className="forgot-desc">Masukkan email Anda untuk menerima link reset password.</p>
      
      <div className="form-group">
        <label>📧 Email</label>
        <input
          type="email"
          placeholder="Masukkan email terdaftar"
          value={forgotEmail}
          onChange={(e) => setForgotEmail(e.target.value)}
          required
        />
      </div>
      
      <button type="submit" className="btn-forgot" disabled={isLoading}>
        {isLoading ? '📧 Mengirim...' : 'Kirim Link Reset'}
      </button>
      
      <div className="auth-links">
        <button type="button" onClick={() => { setMode('login'); resetForm(); }} className="link-btn">
          Kembali ke Login
        </button>
      </div>
    </form>
  );

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="logo-icon">📱</span>
          </div>
          <h1>Sistem Absensi IoT</h1>
          <p>Fingerprint &amp; Real-time</p>
        </div>
        
        <div className="auth-card">
          {mode === 'login' && renderLoginForm()}
          {mode === 'register' && renderRegisterForm()}
          {mode === 'forgot' && renderForgotForm()}
        </div>
        
        <div className="auth-footer">
          <p>© 2024 Sistem Absensi IoT</p>
          <p className="version">Versi 6.2</p>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;