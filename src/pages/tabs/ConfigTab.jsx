// src/pages/tabs/ConfigTab.jsx
import React, { useState, useEffect, useRef } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { db, auth } from '../../firebase/config';
import './ConfigTab.css';

const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

const ConfigTab = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schoolName, setSchoolName] = useState('Sistem Absensi');
  const [schoolLogo, setSchoolLogo] = useState(null);
  const [oldSchoolLogo, setOldSchoolLogo] = useState(null);
  const [schoolType, setSchoolType] = useState('smp');
  const [classes, setClasses] = useState([]);
  const [majors, setMajors] = useState([]);
  const [newClass, setNewClass] = useState('');
  const [newMajor, setNewMajor] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState({ text: '', type: '' });
  const fileInputRef = useRef(null);

  // ========== STATE UNTUK JAM MASUK/PULANG & HARI LIBUR ==========
  const [checkInTime, setCheckInTime] = useState('07:00');
  const [checkOutTime, setCheckOutTime] = useState('15:30');
  const [lateThreshold, setLateThreshold] = useState(15);
  const [holidays, setHolidays] = useState([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [workDays, setWorkDays] = useState({
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false
  });

  // ========== STATE UNTUK PENGINGAT ABSENSI ==========
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDelay, setReminderDelay] = useState(5);
  const [reminderInterval, setReminderInterval] = useState(1);
  const [reminderSendWhatsApp, setReminderSendWhatsApp] = useState(true);
  const [reminderSendEmail, setReminderSendEmail] = useState(true);
  const [reminderSendInApp, setReminderSendInApp] = useState(true);
  const [reminderMaxAttempts, setReminderMaxAttempts] = useState(3);
  const [reminderCooldown, setReminderCooldown] = useState(30);

  // Cek role - hanya Admin, Developer, Wakil Kepala
  const canEdit = ['admin', 'developer', 'wakil_kepala'].includes(user?.role);

  // ==================== TOKEN MANAGEMENT ====================
  const getAuthToken = async () => {
    let token = localStorage.getItem('authToken');
    if (token) return token;
    
    if (auth.currentUser) {
      try {
        token = await auth.currentUser.getIdToken();
        localStorage.setItem('authToken', token);
        return token;
      } catch (error) {
        console.error('❌ Failed to get Firebase token:', error);
        return null;
      }
    }
    return null;
  };

  // ==================== AMBIL DATA ====================
  useEffect(() => {
    if (!canEdit) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    // Ambil nama sekolah
    const schoolNameRef = ref(db, 'system_config/schoolName');
    const unsubscribeName = onValue(schoolNameRef, (snapshot) => {
      if (!isMounted) return;
      const name = snapshot.val();
      if (name) setSchoolName(name);
    });

    // Ambil logo sekolah
    const schoolLogoRef = ref(db, 'system_config/schoolLogo');
    const unsubscribeLogo = onValue(schoolLogoRef, (snapshot) => {
      if (!isMounted) return;
      const logo = snapshot.val();
      if (logo && logo !== 'null' && logo !== 'undefined') {
        setSchoolLogo(logo);
        setOldSchoolLogo(logo);
      } else {
        setSchoolLogo(null);
        setOldSchoolLogo(null);
      }
    });

    // Ambil konfigurasi sekolah
    const configRef = ref(db, 'school_config');
    const unsubscribeConfig = onValue(configRef, (snapshot) => {
      if (!isMounted) return;
      const data = snapshot.val();
      if (data) {
        setSchoolType(data.type || 'smp');
        setClasses(data.classes || []);
        setMajors(data.majors || []);
        
        // Ambil jam masuk/pulang
        if (data.checkInTime) setCheckInTime(data.checkInTime);
        if (data.checkOutTime) setCheckOutTime(data.checkOutTime);
        if (data.lateThreshold !== undefined) setLateThreshold(data.lateThreshold);
        
        // Ambil hari libur
        if (data.holidays) {
          const holidayArray = Object.keys(data.holidays).map(key => ({
            id: key,
            date: data.holidays[key].date,
            name: data.holidays[key].name || 'Hari Libur'
          }));
          setHolidays(holidayArray);
        }
        
        // Ambil hari kerja
        if (data.workDays) {
          setWorkDays({
            monday: data.workDays.monday !== false,
            tuesday: data.workDays.tuesday !== false,
            wednesday: data.workDays.wednesday !== false,
            thursday: data.workDays.thursday !== false,
            friday: data.workDays.friday !== false,
            saturday: data.workDays.saturday === true,
            sunday: data.workDays.sunday === true
          });
        }

        // ========== AMBIL KONFIGURASI PENGINGAT ==========
        if (data.reminderConfig) {
          const rc = data.reminderConfig;
          if (rc.enabled !== undefined) setReminderEnabled(rc.enabled);
          if (rc.delay) setReminderDelay(rc.delay);
          if (rc.interval) setReminderInterval(rc.interval);
          if (rc.sendWhatsApp !== undefined) setReminderSendWhatsApp(rc.sendWhatsApp);
          if (rc.sendEmail !== undefined) setReminderSendEmail(rc.sendEmail);
          if (rc.sendInApp !== undefined) setReminderSendInApp(rc.sendInApp);
          if (rc.maxAttempts) setReminderMaxAttempts(rc.maxAttempts);
          if (rc.cooldown) setReminderCooldown(rc.cooldown);
        }
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribeName();
      unsubscribeLogo();
      unsubscribeConfig();
    };
  }, [canEdit]);

  // ==================== DELETE FROM SUPABASE ====================
  const deleteFromSupabase = async (fileUrl) => {
    if (!fileUrl || !fileUrl.includes('supabase.co')) return true;
    
    try {
      const token = await getAuthToken();
      if (!token) return false;

      const response = await fetch(`${API_BASE_URL}/storage/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fileUrl }),
      });

      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('❌ Error deleting from Supabase:', error);
      return false;
    }
  };

  // ==================== SAVE SCHOOL NAME ====================
  const saveSchoolName = async () => {
    if (!schoolName.trim()) {
      setMessage({ text: 'Nama sekolah tidak boleh kosong!', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      await set(ref(db, 'system_config/schoolName'), schoolName.trim());
      setMessage({ text: '✅ Nama sekolah berhasil diperbarui!', type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('save_school_name', `Mengubah nama sekolah menjadi "${schoolName.trim()}"`);
      }
    } catch (error) {
      console.error('Save school name error:', error);
      setMessage({ text: '❌ Gagal menyimpan nama sekolah: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== UPLOAD SCHOOL LOGO ====================
  const uploadSchoolLogo = async (file) => {
    if (!file) return;
    
    if (!file.type.match('image.*')) {
      setMessage({ text: '❌ Hanya file gambar yang diperbolehkan!', type: 'error' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ text: '❌ Ukuran gambar maksimal 2MB!', type: 'error' });
      return;
    }

    setUploadingLogo(true);
    setUploadProgress(0);
    setMessage({ text: '📤 Mengunggah logo sekolah...', type: 'info' });

    try {
      const oldLogoUrl = schoolLogo;
      setOldSchoolLogo(oldLogoUrl);

      setUploadProgress(20);

      const token = await getAuthToken();
      if (!token) {
        throw new Error('Tidak dapat memperoleh token autentikasi');
      }

      setUploadProgress(40);

      const formData = new FormData();
      formData.append('image', file);
      formData.append('folder', 'school');

      console.log('📤 Uploading school logo to:', `${API_BASE_URL}/upload`);
      
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      setUploadProgress(70);

      if (!response.ok) {
        let errorMessage = `Upload gagal (${response.status})`;
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
        throw new Error(result.error || 'Upload gagal');
      }

      const newLogoUrl = result.data.url;
      console.log('✅ New logo URL:', newLogoUrl.substring(0, 50) + '...');

      setUploadProgress(85);

      await set(ref(db, 'system_config/schoolLogo'), newLogoUrl);
      setSchoolLogo(newLogoUrl);

      if (oldLogoUrl && oldLogoUrl.includes('supabase.co')) {
        await deleteFromSupabase(oldLogoUrl);
      }

      setUploadProgress(100);
      setMessage({ text: '✅ Logo sekolah berhasil diperbarui!', type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('upload_school_logo', 'Mengupload logo sekolah baru');
      }
    } catch (error) {
      console.error('Upload logo error:', error);
      setMessage({ text: '❌ Gagal upload logo: ' + error.message, type: 'error' });
    } finally {
      setUploadingLogo(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== REMOVE SCHOOL LOGO ====================
  const removeSchoolLogo = async () => {
    if (!schoolLogo) return;
    if (!window.confirm('⚠️ Yakin ingin menghapus logo sekolah?')) return;

    setUploadingLogo(true);
    try {
      if (schoolLogo.includes('supabase.co')) {
        const deleted = await deleteFromSupabase(schoolLogo);
        if (!deleted) {
          console.warn('⚠️ Failed to delete logo from Supabase, but continuing...');
        }
      }

      await remove(ref(db, 'system_config/schoolLogo'));
      setSchoolLogo(null);
      setOldSchoolLogo(null);

      setMessage({ text: '✅ Logo sekolah berhasil dihapus!', type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('remove_school_logo', 'Menghapus logo sekolah');
      }
    } catch (error) {
      console.error('Remove logo error:', error);
      setMessage({ text: '❌ Gagal menghapus logo: ' + error.message, type: 'error' });
    } finally {
      setUploadingLogo(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== SAVE SCHOOL TYPE ====================
  const saveSchoolType = async () => {
    setSaving(true);
    try {
      let newClasses = [];
      if (schoolType === 'smp') {
        newClasses = ['VII', 'VIII', 'IX'];
      } else if (schoolType === 'smk') {
        newClasses = ['X', 'XI', 'XII'];
      } else if (schoolType === 'both') {
        newClasses = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
      }

      await update(ref(db, 'school_config'), {
        type: schoolType,
        classes: newClasses
      });

      setClasses(newClasses);
      setMessage({ text: `✅ Tipe sekolah berhasil diubah menjadi ${schoolType.toUpperCase()}!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('update_school_type', `Mengubah tipe sekolah menjadi ${schoolType}`);
      }
    } catch (error) {
      console.error('Save school type error:', error);
      setMessage({ text: '❌ Gagal menyimpan tipe sekolah: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== SAVE TIME SETTINGS ====================
  const saveTimeSettings = async () => {
    if (!checkInTime || !checkOutTime) {
      setMessage({ text: '⚠️ Jam masuk dan jam pulang harus diisi!', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      await update(ref(db, 'school_config'), {
        checkInTime: checkInTime,
        checkOutTime: checkOutTime,
        lateThreshold: parseInt(lateThreshold) || 15
      });
      
      setMessage({ text: '✅ Jam masuk/pulang berhasil diperbarui!', type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('save_time_settings', `Mengubah jam masuk ${checkInTime}, jam pulang ${checkOutTime}, toleransi ${lateThreshold} menit`);
      }
    } catch (error) {
      console.error('Save time settings error:', error);
      setMessage({ text: '❌ Gagal menyimpan jam masuk/pulang: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== SAVE WORK DAYS ====================
  const saveWorkDays = async () => {
    setSaving(true);
    try {
      await update(ref(db, 'school_config'), { workDays });
      setMessage({ text: '✅ Hari kerja berhasil diperbarui!', type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        const workDaysList = Object.keys(workDays).filter(day => workDays[day]).join(', ');
        window.logActivity('save_work_days', `Mengubah hari kerja: ${workDaysList}`);
      }
    } catch (error) {
      console.error('Save work days error:', error);
      setMessage({ text: '❌ Gagal menyimpan hari kerja: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== ADD HOLIDAY ====================
  const addHoliday = async () => {
    if (!holidayDate || !holidayName.trim()) {
      setMessage({ text: '⚠️ Tanggal dan nama libur harus diisi!', type: 'error' });
      return;
    }

    if (holidays.some(h => h.date === holidayDate)) {
      setMessage({ text: '❌ Tanggal ini sudah terdaftar sebagai hari libur!', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const holidayId = `holiday_${Date.now()}`;
      const holidayData = {
        date: holidayDate,
        name: holidayName.trim()
      };

      await set(ref(db, `school_config/holidays/${holidayId}`), holidayData);
      
      setHolidays([...holidays, { id: holidayId, ...holidayData }]);
      setHolidayDate('');
      setHolidayName('');
      setShowHolidayForm(false);
      
      setMessage({ text: `✅ Hari libur "${holidayName.trim()}" berhasil ditambahkan!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('add_holiday', `Menambahkan hari libur "${holidayName.trim()}" pada ${holidayDate}`);
      }
    } catch (error) {
      console.error('Add holiday error:', error);
      setMessage({ text: '❌ Gagal menambahkan hari libur: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== REMOVE HOLIDAY ====================
  const removeHoliday = async (holidayId, holidayName) => {
    if (!window.confirm(`⚠️ Hapus hari libur "${holidayName}"?`)) return;

    setSaving(true);
    try {
      await remove(ref(db, `school_config/holidays/${holidayId}`));
      
      setHolidays(holidays.filter(h => h.id !== holidayId));
      setMessage({ text: `🗑️ Hari libur "${holidayName}" berhasil dihapus!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('remove_holiday', `Menghapus hari libur "${holidayName}"`);
      }
    } catch (error) {
      console.error('Remove holiday error:', error);
      setMessage({ text: '❌ Gagal menghapus hari libur: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== SAVE REMINDER SETTINGS ====================
  const saveReminderSettings = async () => {
    setSaving(true);
    try {
      const reminderConfig = {
        enabled: reminderEnabled,
        delay: parseInt(reminderDelay) || 5,
        interval: parseInt(reminderInterval) || 1,
        sendWhatsApp: reminderSendWhatsApp,
        sendEmail: reminderSendEmail,
        sendInApp: reminderSendInApp,
        maxAttempts: parseInt(reminderMaxAttempts) || 3,
        cooldown: parseInt(reminderCooldown) || 30,
        updatedAt: Date.now()
      };

      await update(ref(db, 'school_config'), {
        reminderConfig: reminderConfig
      });

      setMessage({ text: '✅ Pengaturan pengingat berhasil disimpan!', type: 'success' });
      
      // Restart reminder system jika ada perubahan
      if (typeof window.attendanceReminder !== 'undefined' && window.attendanceReminder) {
        if (reminderEnabled) {
          window.attendanceReminder.stop();
          window.attendanceReminder.start();
          console.log('⏰ Reminder system restarted with new config');
        } else {
          window.attendanceReminder.stop();
          console.log('⏰ Reminder system stopped');
        }
      }
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('save_reminder_settings', `Mengubah pengaturan pengingat: enabled=${reminderEnabled}, delay=${reminderDelay}min`);
      }
    } catch (error) {
      console.error('Save reminder settings error:', error);
      setMessage({ text: '❌ Gagal menyimpan pengaturan pengingat: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== ADD CLASS ====================
  const addClass = async () => {
    if (!newClass.trim()) {
      setMessage({ text: '⚠️ Masukkan nama kelas!', type: 'error' });
      return;
    }

    const className = newClass.trim().toUpperCase();
    if (classes.includes(className)) {
      setMessage({ text: '❌ Kelas sudah ada!', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const updatedClasses = [...classes, className];
      await update(ref(db, 'school_config'), { classes: updatedClasses });
      setClasses(updatedClasses);
      setNewClass('');
      setMessage({ text: `✅ Kelas "${className}" berhasil ditambahkan!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('add_class', `Menambahkan kelas "${className}"`);
      }
    } catch (error) {
      console.error('Add class error:', error);
      setMessage({ text: '❌ Gagal menambahkan kelas: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== REMOVE CLASS ====================
  const removeClass = async (className) => {
    if (!window.confirm(`⚠️ Hapus kelas "${className}"?`)) return;

    setSaving(true);
    try {
      const updatedClasses = classes.filter(c => c !== className);
      await update(ref(db, 'school_config'), { classes: updatedClasses });
      setClasses(updatedClasses);
      setMessage({ text: `🗑️ Kelas "${className}" berhasil dihapus!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('remove_class', `Menghapus kelas "${className}"`);
      }
    } catch (error) {
      console.error('Remove class error:', error);
      setMessage({ text: '❌ Gagal menghapus kelas: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== ADD MAJOR ====================
  const addMajor = async () => {
    if (!newMajor.trim()) {
      setMessage({ text: '⚠️ Masukkan nama jurusan!', type: 'error' });
      return;
    }

    const majorName = newMajor.trim().toUpperCase();
    if (majors.includes(majorName)) {
      setMessage({ text: '❌ Jurusan sudah ada!', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const updatedMajors = [...majors, majorName];
      await update(ref(db, 'school_config'), { majors: updatedMajors });
      setMajors(updatedMajors);
      setNewMajor('');
      setMessage({ text: `✅ Jurusan "${majorName}" berhasil ditambahkan!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('add_major', `Menambahkan jurusan "${majorName}"`);
      }
    } catch (error) {
      console.error('Add major error:', error);
      setMessage({ text: '❌ Gagal menambahkan jurusan: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== REMOVE MAJOR ====================
  const removeMajor = async (majorName) => {
    if (!window.confirm(`⚠️ Hapus jurusan "${majorName}"?`)) return;

    setSaving(true);
    try {
      const updatedMajors = majors.filter(m => m !== majorName);
      await update(ref(db, 'school_config'), { majors: updatedMajors });
      setMajors(updatedMajors);
      setMessage({ text: `🗑️ Jurusan "${majorName}" berhasil dihapus!`, type: 'success' });
      
      if (typeof window.logActivity === 'function') {
        window.logActivity('remove_major', `Menghapus jurusan "${majorName}"`);
      }
    } catch (error) {
      console.error('Remove major error:', error);
      setMessage({ text: '❌ Gagal menghapus jurusan: ' + error.message, type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // ==================== FORMAT DATE ====================
  const formatDateDisplay = (dateString) => {
    if (!dateString) return '';
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
      return `${parts[2]} ${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
    }
    return dateString;
  };

  // ==================== DAY LABELS ====================
  const dayLabels = {
    monday: 'Senin',
    tuesday: 'Selasa',
    wednesday: 'Rabu',
    thursday: 'Kamis',
    friday: 'Jumat',
    saturday: 'Sabtu',
    sunday: 'Minggu'
  };

  // ==================== ACCESS DENIED ====================
  if (!canEdit) {
    return (
      <div className="config-container">
        <div className="access-denied-config">
          <div className="access-denied-icon">🔒</div>
          <h3>Akses Terbatas</h3>
          <p>Hanya Admin, Wakil Kepala, dan Developer yang dapat mengakses pengaturan.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="config-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Memuat pengaturan...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="config-container">
      <div className="config-header">
        <h1>⚙️ Pengaturan</h1>
        <p className="config-subtitle">Kelola konfigurasi sistem sekolah</p>
      </div>

      {message.text && (
        <div className={`config-message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="config-grid">
        {/* ==================== SEKOLAH ==================== */}
        <div className="config-card">
          <h2>🏫 Informasi Sekolah</h2>
          
          <div className="form-group-config">
            <label>Nama Sekolah</label>
            <div className="input-group-config">
              <input
                type="text"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Masukkan nama sekolah"
              />
              <button className="btn-save-config" onClick={saveSchoolName} disabled={saving}>
                {saving ? '⏳...' : '💾 Simpan'}
              </button>
            </div>
          </div>

          <div className="form-group-config">
            <label>Logo Sekolah</label>
            <div className="logo-section">
              <div className="logo-preview">
                {schoolLogo ? (
                  <img src={schoolLogo} alt="Logo Sekolah" />
                ) : (
                  <div className="logo-placeholder">📱</div>
                )}
                {uploadingLogo && (
                  <div className="logo-upload-progress">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                    <span className="progress-text">{uploadProgress}%</span>
                  </div>
                )}
              </div>
              <div className="logo-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files[0]) {
                      uploadSchoolLogo(e.target.files[0]);
                    }
                  }}
                  id="logoFileInput"
                  style={{ display: 'none' }}
                />
                <label htmlFor="logoFileInput" className="btn-upload-logo" disabled={uploadingLogo}>
                  {uploadingLogo ? '⏳ Uploading...' : '📤 Upload Logo'}
                </label>
                {schoolLogo && (
                  <button className="btn-remove-logo" onClick={removeSchoolLogo} disabled={uploadingLogo}>
                    🗑️ Hapus
                  </button>
                )}
              </div>
            </div>
            <small className="form-hint">Format: JPG, PNG, GIF, WEBP | Max: 2MB</small>
          </div>

          <div className="form-group-config">
            <label>Tipe Sekolah</label>
            <div className="type-selector">
              <button
                className={`type-btn ${schoolType === 'smp' ? 'active' : ''}`}
                onClick={() => setSchoolType('smp')}
              >
                🏫 SMP
              </button>
              <button
                className={`type-btn ${schoolType === 'smk' ? 'active' : ''}`}
                onClick={() => setSchoolType('smk')}
              >
                🔧 SMK
              </button>
              <button
                className={`type-btn ${schoolType === 'both' ? 'active' : ''}`}
                onClick={() => setSchoolType('both')}
              >
                📚 SMP &amp; SMK
              </button>
            </div>
            <button className="btn-save-config" onClick={saveSchoolType} disabled={saving} style={{ marginTop: '10px' }}>
              {saving ? '⏳...' : '💾 Simpan Tipe'}
            </button>
          </div>
        </div>

        {/* ==================== JAM MASUK/PULANG ==================== */}
        <div className="config-card">
          <h2>⏰ Jam Operasional</h2>
          
          <div className="form-group-config">
            <label>Jam Masuk (Check-in)</label>
            <input
              type="time"
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
              className="time-input"
            />
          </div>

          <div className="form-group-config">
            <label>Jam Pulang (Check-out)</label>
            <input
              type="time"
              value={checkOutTime}
              onChange={(e) => setCheckOutTime(e.target.value)}
              className="time-input"
            />
          </div>

          <div className="form-group-config">
            <label>Batas Toleransi Keterlambatan (menit)</label>
            <div className="input-group-config">
              <input
                type="number"
                value={lateThreshold}
                onChange={(e) => setLateThreshold(Math.max(0, parseInt(e.target.value) || 0))}
                min="0"
                max="120"
                className="time-input"
                style={{ maxWidth: '120px' }}
              />
              <span className="input-suffix">menit</span>
            </div>
            <small className="form-hint">Jika siswa absen melewati jam masuk + toleransi, akan dicatat sebagai terlambat</small>
          </div>

          <button className="btn-save-config" onClick={saveTimeSettings} disabled={saving}>
            {saving ? '⏳...' : '💾 Simpan Jam Operasional'}
          </button>
        </div>

        {/* ==================== HARI KERJA ==================== */}
        <div className="config-card">
          <h2>📅 Hari Kerja</h2>
          <p className="config-subtitle-small">Pilih hari yang merupakan hari belajar aktif</p>
          
          <div className="work-days-grid">
            {Object.keys(workDays).map((day) => (
              <label key={day} className="work-day-checkbox">
                <input
                  type="checkbox"
                  checked={workDays[day]}
                  onChange={() => setWorkDays({ ...workDays, [day]: !workDays[day] })}
                />
                <span className={`day-label ${workDays[day] ? 'active' : 'inactive'}`}>
                  {dayLabels[day]}
                </span>
              </label>
            ))}
          </div>

          <button className="btn-save-config" onClick={saveWorkDays} disabled={saving} style={{ marginTop: '10px' }}>
            {saving ? '⏳...' : '💾 Simpan Hari Kerja'}
          </button>
          
          <div className="work-days-info">
            <small>ℹ️ Hari yang tidak dicentang akan dianggap sebagai hari libur mingguan</small>
          </div>
        </div>

        {/* ==================== HARI LIBUR ==================== */}
        <div className="config-card">
          <h2>🎉 Hari Libur Khusus</h2>
          <p className="config-subtitle-small">Tambahkan hari libur nasional atau cuti bersama</p>
          
          {!showHolidayForm ? (
            <button 
              className="btn-add-config" 
              onClick={() => setShowHolidayForm(true)}
              style={{ marginBottom: '15px', width: '100%' }}
            >
              ➕ Tambah Hari Libur
            </button>
          ) : (
            <div className="holiday-form">
              <div className="form-group-config">
                <label>Tanggal</label>
                <input
                  type="date"
                  value={holidayDate}
                  onChange={(e) => setHolidayDate(e.target.value)}
                  className="time-input"
                />
              </div>
              <div className="form-group-config">
                <label>Nama Libur</label>
                <input
                  type="text"
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                  placeholder="Contoh: Tahun Baru, Idul Fitri, dll"
                  className="time-input"
                />
              </div>
              <div className="holiday-form-actions">
                <button className="btn-save-config" onClick={addHoliday} disabled={saving}>
                  {saving ? '⏳...' : '✅ Simpan'}
                </button>
                <button className="btn-cancel-config" onClick={() => {
                  setShowHolidayForm(false);
                  setHolidayDate('');
                  setHolidayName('');
                }}>
                  ❌ Batal
                </button>
              </div>
            </div>
          )}

          <div className="holidays-list">
            {holidays.length === 0 ? (
              <p className="empty-list">Belum ada hari libur khusus</p>
            ) : (
              holidays.map((holiday) => (
                <div key={holiday.id} className="item-chip holiday-chip">
                  <span>📅 {formatDateDisplay(holiday.date)} - {holiday.name}</span>
                  <button className="btn-remove-chip" onClick={() => removeHoliday(holiday.id, holiday.name)}>
                    ✖
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ==================== PENGINGAT ABSENSI ==================== */}
        <div className="config-card config-card-full">
          <h2>🔔 Pengingat Absensi</h2>
          <p className="config-subtitle-small">Atur pengingat otomatis untuk siswa yang belum absen</p>
          
          <div className="form-group-config">
            <label>Aktifkan Pengingat</label>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                id="reminderToggle"
              />
              <label htmlFor="reminderToggle" className="toggle-label">
                {reminderEnabled ? '✅ Aktif' : '❌ Nonaktif'}
              </label>
            </div>
          </div>

          <div className="form-row-config">
            <div className="form-group-config half">
              <label>Batas Waktu (menit setelah jam masuk)</label>
              <input
                type="number"
                value={reminderDelay}
                onChange={(e) => setReminderDelay(Math.max(1, parseInt(e.target.value) || 5))}
                min="1"
                max="60"
                className="time-input"
                disabled={!reminderEnabled}
              />
              <small className="form-hint">Pengingat akan dikirim setelah X menit dari jam masuk</small>
            </div>

            <div className="form-group-config half">
              <label>Interval Pengecekan (menit)</label>
              <input
                type="number"
                value={reminderInterval}
                onChange={(e) => setReminderInterval(Math.max(1, parseInt(e.target.value) || 1))}
                min="1"
                max="10"
                className="time-input"
                disabled={!reminderEnabled}
              />
              <small className="form-hint">Sistem mengecek setiap X menit</small>
            </div>
          </div>

          <div className="form-group-config">
            <label>Metode Notifikasi</label>
            <div className="notification-methods">
              <label className="method-checkbox">
                <input
                  type="checkbox"
                  checked={reminderSendWhatsApp}
                  onChange={(e) => setReminderSendWhatsApp(e.target.checked)}
                  disabled={!reminderEnabled}
                />
                <span>📱 WhatsApp</span>
              </label>
              <label className="method-checkbox">
                <input
                  type="checkbox"
                  checked={reminderSendEmail}
                  onChange={(e) => setReminderSendEmail(e.target.checked)}
                  disabled={!reminderEnabled}
                />
                <span>📧 Email</span>
              </label>
              <label className="method-checkbox">
                <input
                  type="checkbox"
                  checked={reminderSendInApp}
                  onChange={(e) => setReminderSendInApp(e.target.checked)}
                  disabled={!reminderEnabled}
                />
                <span>🔔 In-App</span>
              </label>
            </div>
          </div>

          <div className="form-row-config">
            <div className="form-group-config half">
              <label>Maksimal Percobaan</label>
              <input
                type="number"
                value={reminderMaxAttempts}
                onChange={(e) => setReminderMaxAttempts(Math.max(1, parseInt(e.target.value) || 3))}
                min="1"
                max="10"
                className="time-input"
                disabled={!reminderEnabled}
              />
              <small className="form-hint">Jumlah maksimal pengiriman per siswa</small>
            </div>

            <div className="form-group-config half">
              <label>Cooldown (menit)</label>
              <input
                type="number"
                value={reminderCooldown}
                onChange={(e) => setReminderCooldown(Math.max(5, parseInt(e.target.value) || 30))}
                min="5"
                max="120"
                className="time-input"
                disabled={!reminderEnabled}
              />
              <small className="form-hint">Jeda antar percobaan</small>
            </div>
          </div>

          <button className="btn-save-config" onClick={saveReminderSettings} disabled={saving}>
            {saving ? '⏳...' : '💾 Simpan Pengaturan Pengingat'}
          </button>
          
          <div className="reminder-info-config">
            <small>
              ℹ️ Pengingat akan dikirim ke siswa yang belum absen dan tidak sedang izin.
              {reminderEnabled ? ' ✅ Sistem aktif' : ' ❌ Sistem nonaktif'}
            </small>
          </div>
        </div>

        {/* ==================== KELAS ==================== */}
        <div className="config-card">
          <h2>📚 Manajemen Kelas</h2>
          
          <div className="form-group-config">
            <div className="input-group-config">
              <input
                type="text"
                value={newClass}
                onChange={(e) => setNewClass(e.target.value)}
                placeholder="Nama kelas (contoh: X IPA)"
                onKeyPress={(e) => e.key === 'Enter' && addClass()}
              />
              <button className="btn-add-config" onClick={addClass} disabled={saving}>
                ➕ Tambah
              </button>
            </div>
          </div>

          <div className="items-list">
            {classes.length === 0 ? (
              <p className="empty-list">Belum ada kelas</p>
            ) : (
              classes.map((cls) => (
                <div key={cls} className="item-chip">
                  <span>📚 {cls}</span>
                  <button className="btn-remove-chip" onClick={() => removeClass(cls)}>
                    ✖
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ==================== JURUSAN ==================== */}
        <div className="config-card">
          <h2>🎓 Manajemen Jurusan</h2>
          
          <div className="form-group-config">
            <div className="input-group-config">
              <input
                type="text"
                value={newMajor}
                onChange={(e) => setNewMajor(e.target.value)}
                placeholder="Nama jurusan (contoh: RPL)"
                onKeyPress={(e) => e.key === 'Enter' && addMajor()}
              />
              <button className="btn-add-config" onClick={addMajor} disabled={saving}>
                ➕ Tambah
              </button>
            </div>
          </div>

          <div className="items-list">
            {majors.length === 0 ? (
              <p className="empty-list">Belum ada jurusan</p>
            ) : (
              majors.map((major) => (
                <div key={major} className="item-chip">
                  <span>🎓 {major}</span>
                  <button className="btn-remove-chip" onClick={() => removeMajor(major)}>
                    ✖
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="config-footer">
        <p>💡 Perubahan akan langsung diterapkan ke seluruh sistem</p>
        <p className="config-role">Role: {user?.role} • {['admin', 'developer', 'wakil_kepala'].includes(user?.role) ? '✅ Akses penuh' : '🔒 Hanya baca'}</p>
        <p className="config-storage">🗄️ Storage: Supabase • {schoolLogo?.includes('supabase.co') ? '✅ Tersimpan' : '❌ Belum ada logo'}</p>
        <p className="config-reminder-status">
          🔔 Pengingat: {reminderEnabled ? '✅ Aktif' : '❌ Nonaktif'}
        </p>
      </div>
    </div>
  );
};

export default ConfigTab;