// src/utils/AttendanceReminder.js
import { ref, onValue, get, update, set, push, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '../firebase/config';

/**
 * Attendance Reminder System
 * Mengirim pengingat otomatis untuk siswa yang belum absen
 * Ketika ada user yang membuka web, sistem akan mengecek dan mengirim pengingat
 */

class AttendanceReminder {
  constructor() {
    this.reminderInterval = null;
    this.isRunning = false;
    this.lastCheckTime = null;
    this.processedToday = new Set();
    this.reminderCheckInterval = 60000; // Cek setiap 1 menit
    this.lateThreshold = 5; // 5 menit setelah jam masuk
    this.lastCheckDate = null;
    this.isInitialized = false;
  }

  /**
   * Initialize and start the reminder system
   * Called when ANY user opens the web
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('⏰ Reminder system already initialized');
      return;
    }

    console.log('⏰ Initializing attendance reminder system...');
    this.isInitialized = true;

    // Check immediately when initialized
    await this.checkAndSendReminders();

    // Start periodic checks
    this.start();
  }

  /**
   * Start reminder system
   */
  start() {
    if (this.isRunning) {
      console.log('⏰ Reminder system already running');
      return;
    }

    console.log('⏰ Attendance Reminder System started');

    // Cek setiap 1 menit
    this.reminderInterval = setInterval(() => {
      this.checkAndSendReminders();
    }, this.reminderCheckInterval);

    this.isRunning = true;
  }

  /**
   * Stop reminder system
   */
  stop() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
      this.isRunning = false;
      console.log('⏰ Attendance Reminder System stopped');
    }
  }

  /**
   * Reset processed tracking untuk hari baru
   */
  resetDailyTracking() {
    const today = new Date().toDateString();
    if (this.lastCheckDate !== today) {
      this.processedToday.clear();
      this.lastCheckDate = today;
      console.log('📅 Daily reminder tracking reset for', today);
    }
  }

  /**
   * Main check function - Called whenever someone opens the web
   */
  async checkAndSendReminders() {
    try {
      console.log('🔍 Checking attendance reminders...');
      
      // Reset tracking harian
      this.resetDailyTracking();

      // 1. Get school configuration
      const configSnapshot = await get(ref(db, 'school_config'));
      const config = configSnapshot.val();
      
      if (!config) {
        console.log('⏰ School config not found');
        return;
      }

      // 2. Get current time
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const currentDay = now.getDay();

      // 3. Cek apakah hari ini hari kerja
      const dayMap = {
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday',
        0: 'sunday'
      };
      
      const dayKey = dayMap[currentDay];
      const isWorkDay = config.workDays && config.workDays[dayKey] === true;

      if (!isWorkDay) {
        console.log('⏰ Today is not a work day, skipping reminder');
        return;
      }

      // 4. Cek apakah ada hari libur khusus hari ini
      const todayStr = now.toISOString().split('T')[0];
      if (config.holidays) {
        const holidayKeys = Object.keys(config.holidays);
        const isHoliday = holidayKeys.some(key => config.holidays[key].date === todayStr);
        if (isHoliday) {
          console.log('⏰ Today is a holiday, skipping reminder');
          return;
        }
      }

      // 5. Get check-in time
      const checkInTime = config.checkInTime || '07:00';
      const [checkInHour, checkInMinute] = checkInTime.split(':').map(Number);
      const checkInMinutes = checkInHour * 60 + checkInMinute;

      // 6. Cek apakah sudah melewati jam masuk + 5 menit
      const timeDiff = currentTime - checkInMinutes;
      
      if (timeDiff < this.lateThreshold) {
        console.log(`⏰ Still within grace period (${timeDiff} min), waiting...`);
        return;
      }

      console.log(`⏰ ${timeDiff} minutes past check-in time, checking for absent students...`);

      // 7. Get all students (users with role siswa)
      const usersSnapshot = await get(ref(db, 'users'));
      const users = usersSnapshot.val();
      
      if (!users) {
        console.log('⏰ No users found');
        return;
      }

      // 8. Get today's attendance
      const todayStrFull = now.toISOString().split('T')[0];
      const attendanceRef = ref(db, `attendance/${todayStrFull}`);
      const attendanceSnapshot = await get(attendanceRef);
      const attendanceData = attendanceSnapshot.val() || {};

      // 9. Get students with izin today
      const izinRef = ref(db, 'izin');
      const izinSnapshot = await get(izinRef);
      const izinData = izinSnapshot.val() || {};
      
      // Get approved izin for today
      const approvedIzin = {};
      for (const [key, izin] of Object.entries(izinData)) {
        if (izin.status === 'disetujui' && izin.tanggal === todayStrFull) {
          approvedIzin[izin.userId] = izin;
        }
      }

      // 10. Process each student
      let reminderCount = 0;
      const studentsToRemind = [];

      for (const [userId, student] of Object.entries(users)) {
        // Skip jika bukan siswa
        if (student.role && student.role !== 'siswa') continue;
        
        // Skip jika sudah absen check-in hari ini
        if (attendanceData[userId] && attendanceData[userId].checkIn) {
          continue;
        }

        // Skip jika sudah dapat notifikasi hari ini
        const reminderKey = `${userId}_${todayStrFull}`;
        if (this.processedToday.has(reminderKey)) {
          continue;
        }

        // Skip jika siswa sedang izin (sakit/izin/alpha)
        if (approvedIzin[userId]) {
          console.log(`⏰ Student ${student.nama} is on leave (${approvedIzin[userId].jenis}), skipping...`);
          continue;
        }

        // Skip jika siswa tidak memiliki kelas (belum diassign)
        if (!student.kelas) {
          continue;
        }

        // Tambahkan ke daftar yang perlu reminder
        studentsToRemind.push({
          userId,
          nama: student.nama,
          kelas: student.kelas,
          jurusan: student.jurusan || '',
          parentPhone: student.parentPhone || '',
          studentData: student
        });
      }

      console.log(`⏰ Found ${studentsToRemind.length} students who need reminder`);

      // 11. Send reminders
      for (const student of studentsToRemind) {
        await this.sendReminder(student);
        reminderCount++;
        
        // Mark as processed
        const reminderKey = `${student.userId}_${todayStrFull}`;
        this.processedToday.add(reminderKey);
      }

      if (reminderCount > 0) {
        console.log(`✅ Sent ${reminderCount} attendance reminders`);
        
        // Log activity
        if (typeof window.logActivity === 'function') {
          window.logActivity('attendance_reminder', `Mengirim ${reminderCount} pengingat absensi otomatis`);
        }
        
        // Show toast notification
        if (typeof window.showToast === 'function') {
          window.showToast(`🔔 ${reminderCount} pengingat absensi telah dikirim`, 'info');
        }
      } else {
        console.log('✅ No reminders needed at this time');
      }

      // Save last check time
      this.lastCheckTime = Date.now();

    } catch (error) {
      console.error('❌ Error in attendance reminder:', error);
    }
  }

  /**
   * Send reminder to student
   */
  async sendReminder(student) {
    try {
      const { userId, nama, kelas, jurusan, parentPhone, studentData } = student;

      // 1. Save reminder log to database
      const reminderRef = ref(db, `attendance_reminders/${userId}`);
      const newReminderRef = push(reminderRef);
      await set(newReminderRef, {
        date: new Date().toISOString().split('T')[0],
        time: new Date().toISOString(),
        name: nama,
        kelas: kelas,
        jurusan: jurusan,
        status: 'pending',
        sent: false
      });

      // 2. Send notification via WhatsApp (if parent phone available)
      if (parentPhone) {
        await this.sendWhatsAppReminder(student);
      }

      // 3. Send in-app notification
      await this.sendInAppNotification(student);

      // 4. Send email notification (if email available)
      if (studentData.email) {
        await this.sendEmailReminder(student);
      }

      // Update status
      await update(ref(db, `attendance_reminders/${userId}/${newReminderRef.key}`), {
        sent: true,
        sentAt: new Date().toISOString()
      });

      console.log(`📱 Reminder sent to ${nama} (${userId})`);

    } catch (error) {
      console.error(`❌ Failed to send reminder to ${student.nama}:`, error);
    }
  }

  /**
   * Send WhatsApp reminder
   */
  async sendWhatsAppReminder(student) {
    try {
      const { userId, nama, kelas, parentPhone } = student;
      
      // Format phone number
      const phone = parentPhone.replace(/\D/g, '');
      
      if (!phone || phone.length < 10) {
        console.log(`⚠️ Invalid phone number for ${nama}`);
        return;
      }
      
      // Buat pesan
      const message = `🔔 *PENGINGAT ABSENSI*\n\n` +
        `Halo, ini adalah pengingat untuk *${nama}*\n` +
        `📚 Kelas: ${kelas}\n` +
        `⏰ Waktu: ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}\n\n` +
        `⚠️ Anda belum melakukan absensi masuk hari ini.\n` +
        `Segera lakukan absensi melalui sistem.\n\n` +
        `Terima kasih. 🙏`;

      // Send via backend API
      try {
        const response = await fetch('https://backendtest-azure.vercel.app/api/whatsapp/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone: phone,
            message: message,
            name: nama
          })
        });

        const result = await response.json();
        
        if (result.success) {
          console.log(`✅ WhatsApp reminder sent to ${nama}`);
        } else {
          console.warn(`⚠️ Failed to send WhatsApp to ${nama}:`, result.error);
        }
      } catch (error) {
        console.warn(`⚠️ WhatsApp API error for ${nama}:`, error.message);
      }

    } catch (error) {
      console.error('❌ Error sending WhatsApp reminder:', error);
    }
  }

  /**
   * Send in-app notification
   */
  async sendInAppNotification(student) {
    try {
      const { userId, nama, kelas } = student;

      const notificationData = {
        id: `reminder_${Date.now()}_${userId}`,
        userId: userId,
        type: 'attendance_reminder',
        title: '🔔 Pengingat Absensi',
        message: `Halo ${nama}! Anda belum melakukan absensi masuk hari ini. Segera lakukan absensi melalui sistem.`,
        category: 'reminder',
        timestamp: Date.now(),
        read: false,
        action: 'open_attendance',
        data: {
          userId: userId,
          date: new Date().toISOString().split('T')[0]
        }
      };

      // Simpan ke notifications node
      await set(ref(db, `notifications/${userId}/${notificationData.id}`), notificationData);

      console.log(`📱 In-app notification sent to ${nama}`);

    } catch (error) {
      console.error('❌ Error sending in-app notification:', error);
    }
  }

  /**
   * Send email reminder
   */
  async sendEmailReminder(student) {
    try {
      const { userId, nama, kelas, studentData } = student;
      const email = studentData.email;

      if (!email) return;

      // Send via backend API
      try {
        const response = await fetch('https://backendtest-azure.vercel.app/api/email/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: email,
            subject: '🔔 Pengingat Absensi',
            html: `
              <h2>Pengingat Absensi</h2>
              <p>Halo <strong>${nama}</strong>,</p>
              <p>Anda belum melakukan absensi masuk hari ini.</p>
              <p><strong>📚 Kelas:</strong> ${kelas}</p>
              <p><strong>⏰ Waktu:</strong> ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</p>
              <p>Segera lakukan absensi melalui sistem.</p>
              <br>
              <p>Terima kasih. 🙏</p>
            `
          })
        });

        const result = await response.json();
        
        if (result.success) {
          console.log(`📧 Email reminder sent to ${nama}`);
        }
      } catch (error) {
        console.warn(`⚠️ Email API error for ${nama}:`, error.message);
      }

    } catch (error) {
      console.error('❌ Error sending email reminder:', error);
    }
  }

  /**
   * Manual trigger for testing
   */
  async triggerReminderManually() {
    console.log('🔔 Manually triggering attendance reminder...');
    await this.checkAndSendReminders();
  }
}

// Export singleton instance
const attendanceReminder = new AttendanceReminder();

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
  // Initialize after a short delay to ensure Firebase is ready
  setTimeout(() => {
    if (db) {
      console.log('📸 Auto-initializing attendance reminder...');
      attendanceReminder.initialize();
    }
  }, 2000);
}

export default attendanceReminder;