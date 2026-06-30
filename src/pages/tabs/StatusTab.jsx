// src/pages/tabs/StatusTab.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../../firebase/config';
import StatusManager from '../../components/Status/StatusManager';
// ==================== IMPORT LOGGER ====================
import { 
  logActivity,
  logCreateStatus,
  logDeleteStatus,
  logError,
  logSystem
} from '../../utils/logger';
// ⭐ IMPORT MARQUEE TEXT COMPONENT
import MarqueeText from '../../components/MarqueeText';
import './StatusTab.css';

const StatusTab = ({ user, onStatusUpdate }) => {
  const [statusUnviewedCount, setStatusUnviewedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  
  // State untuk nama sekolah
  const [schoolName, setSchoolName] = useState('Sistem Absensi');

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
        console.log('✅ [StatusTab] School name from system_config:', name);
        setSchoolName(name);
      } else {
        // Jika tidak ada di system_config, coba dari school_info
        const schoolInfoRef = ref(db, 'school_info');
        onValue(schoolInfoRef, (infoSnapshot) => {
          if (!isMounted) return;
          const infoData = infoSnapshot.val();
          if (infoData && infoData.name && infoData.name.trim() !== '') {
            console.log('✅ [StatusTab] School name from school_info:', infoData.name);
            setSchoolName(infoData.name);
          } else {
            // Fallback ke school_config
            const configRef = ref(db, 'school_config');
            onValue(configRef, (configSnapshot) => {
              if (!isMounted) return;
              const configData = configSnapshot.val();
              if (configData && configData.schoolName && configData.schoolName.trim() !== '') {
                console.log('✅ [StatusTab] School name from school_config:', configData.schoolName);
                setSchoolName(configData.schoolName);
              } else {
                console.warn('⚠️ [StatusTab] No school name found in database, using default');
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

  // ==================== HANDLE STATUS UPDATE ====================
  const handleStatusUpdate = useCallback((count) => {
    setStatusUnviewedCount(count);
    
    // Update parent component
    if (onStatusUpdate) {
      onStatusUpdate(count);
    }
    
    // Update sidebar badge via event
    window.dispatchEvent(new CustomEvent('statusBadgeUpdate', {
      detail: { count }
    }));
  }, [onStatusUpdate]);

  // ==================== LOG STATUS VIEW ====================
  const logStatusView = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      await logActivity('view_status_tab', 
        `User ${user?.nama || user?.email} membuka halaman Status`,
        user
      );
      console.log('📝 View status tab activity logged');
    } catch (error) {
      console.warn('⚠️ Failed to log status view:', error);
    }
  }, [user]);

  // ==================== CHECK IF STATUS SYSTEM IS READY ====================
  useEffect(() => {
    // Dispatch event to initialize status system
    const initStatus = async () => {
      if (user?.uid) {
        try {
          window.dispatchEvent(new CustomEvent('uiReady', {
            detail: { currentUser: user }
          }));
          setIsLoading(false);
          setInitialized(true);
          
          // ==================== ✅ LOG STATUS TAB OPEN ====================
          await logStatusView();
          
        } catch (error) {
          console.error('❌ Error initializing status:', error);
          setIsLoading(false);
          
          // ==================== ❌ LOG ERROR ====================
          await logError(user, `Failed to initialize status: ${error.message}`, 'StatusTab/init');
        }
      }
    };

    // Check if user is available
    if (user?.uid) {
      initStatus();
    } else {
      // Wait for user
      const checkUser = setInterval(() => {
        if (user?.uid) {
          initStatus();
          clearInterval(checkUser);
        }
      }, 500);
      
      return () => clearInterval(checkUser);
    }
  }, [user, logStatusView]);

  // ==================== LISTEN FOR STATUS UPDATES ====================
  useEffect(() => {
    const handleStatusBadgeUpdate = (e) => {
      if (e.detail && typeof e.detail.count === 'number') {
        setStatusUnviewedCount(e.detail.count);
      }
    };
    
    window.addEventListener('statusBadgeUpdate', handleStatusBadgeUpdate);
    
    // ==================== LISTEN FOR STATUS CREATE/DELETE EVENTS ====================
    const handleStatusCreated = async (e) => {
      if (e.detail && e.detail.statusData && user?.uid) {
        try {
          await logCreateStatus(user, e.detail.statusData);
          console.log('📝 Status created activity logged from StatusTab');
        } catch (error) {
          console.warn('⚠️ Failed to log status create:', error);
        }
      }
    };
    
    const handleStatusDeleted = async (e) => {
      if (e.detail && e.detail.statusId && user?.uid) {
        try {
          await logDeleteStatus(user, e.detail.statusId);
          console.log('📝 Status deleted activity logged from StatusTab');
        } catch (error) {
          console.warn('⚠️ Failed to log status delete:', error);
        }
      }
    };
    
    window.addEventListener('statusCreated', handleStatusCreated);
    window.addEventListener('statusDeleted', handleStatusDeleted);
    
    return () => {
      window.removeEventListener('statusBadgeUpdate', handleStatusBadgeUpdate);
      window.removeEventListener('statusCreated', handleStatusCreated);
      window.removeEventListener('statusDeleted', handleStatusDeleted);
    };
  }, [user]);

  // ==================== LOG STATUS VIEW ON MOUNT ====================
  useEffect(() => {
    if (user?.uid && !isLoading) {
      logStatusView();
    }
  }, [user, isLoading, logStatusView]);

  // ==================== RENDER ====================
  if (!user) {
    return (
      <div className="status-tab-container">
        <div className="status-tab-empty">
          <span className="status-tab-empty-icon">🔒</span>
          <h3>Silakan Login</h3>
          <p>Anda perlu login untuk melihat status</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="status-tab-container">
        <div className="status-tab-loading">
          <div className="status-tab-spinner"></div>
          <p>⏳ Memuat status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="status-tab-container">
      {/* ===== HEADER ===== */}
      <div className="status-tab-header">
        <div className="status-tab-header-left">
          {/* ⭐ MENGGUNAKAN MARQUEE TEXT UNTUK NAMA SEKOLAH ⭐ */}
          <div className="status-school-name-wrapper">
            <MarqueeText 
              text={schoolName || 'Sistem Absensi'} 
              speed={30}
              className="status-school-name-marquee"
            />
            <div className="status-school-name-underline"></div>
          </div>
          <div className="status-tab-title">
            <span className="status-tab-icon">📸</span>
            <h2>Status</h2>
            {statusUnviewedCount > 0 && (
              <span className="status-tab-badge">{statusUnviewedCount} baru</span>
            )}
          </div>
          <p className="status-tab-subtitle">
            Lihat dan bagikan status dengan teman-teman Anda
          </p>
        </div>
        <div className="status-tab-header-right">
          <button 
            className="status-tab-refresh-btn"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('refreshStatuses'));
              console.log('🔄 Status refreshed manually');
            }}
            title="Refresh status"
          >
            🔄
          </button>
        </div>
      </div>

      {/* ===== STATUS MANAGER ===== */}
      <div className="status-tab-content">
        <StatusManager 
          user={user}
          onStatusUpdate={handleStatusUpdate}
          activeTab="status"
        />
      </div>

      {/* ===== INFO FOOTER ===== */}
      <div className="status-tab-footer">
        <div className="status-tab-footer-grid">
          <div className="status-tab-info">
            <span className="status-tab-info-icon">💡</span>
            <span className="status-tab-info-text">Status akan otomatis hilang setelah 24 jam</span>
          </div>
          <div className="status-tab-info">
            <span className="status-tab-info-icon">👥</span>
            <span className="status-tab-info-text">Hanya teman yang dapat melihat status Anda</span>
          </div>
          <div className="status-tab-info">
            <span className="status-tab-info-icon">🔒</span>
            <span className="status-tab-info-text">Status Anda aman dan hanya terlihat oleh teman</span>
          </div>
          {initialized && (
            <div className="status-tab-info status-tab-info-success">
              <span className="status-tab-info-icon">✅</span>
              <span className="status-tab-info-text">Sistem status siap digunakan</span>
            </div>
          )}
        </div>
        
        {/* Status Stats */}
        <div className="status-tab-stats">
          <span className="status-tab-stat">
            <span className="stat-dot active"></span>
            {statusUnviewedCount > 0 ? (
              <span>{statusUnviewedCount} status baru</span>
            ) : (
              <span>Semua status telah dilihat</span>
            )}
          </span>
          <span className="status-tab-stat">
            <span className="stat-school">🏫</span>
            <span>{schoolName || 'Sistem Absensi'}</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default StatusTab;