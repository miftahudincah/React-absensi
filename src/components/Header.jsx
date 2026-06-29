// src/components/Header.jsx
import React, { useState } from 'react';
import './Header.css';

const Header = ({ 
  user, 
  schoolName, 
  schoolLogo, 
  profilePhoto, 
  onToggleSidebar,
  onProfilePhotoChange,
  uploading = false,
  uploadProgress = 0
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const getRoleDisplayName = (role) => {
    const names = {
      developer: 'Developer',
      admin: 'Kepala Sekolah',
      wakil_kepala: 'Wakil Kepala Sekolah',
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

  const getRoleClass = (role) => {
    const classes = {
      developer: 'role-developer',
      admin: 'role-admin',
      wakil_kepala: 'role-wakil',
      staff_tu: 'role-staff-tu',
      guru: 'role-guru',
      siswa: 'role-siswa'
    };
    return classes[role] || 'role-default';
  };

  const handleAvatarClick = () => {
    if (!uploading) {
      document.getElementById('profilePhotoInput')?.click();
    }
  };

  // Format waktu sekarang
  const getCurrentTime = () => {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const [currentTime, setCurrentTime] = useState(getCurrentTime());

  // Update waktu setiap detik
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(getCurrentTime());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="main-header">
      <button className="hamburger" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <span className="hamburger-icon">☰</span>
      </button>
      
      <div className="header-center">
        {schoolLogo ? (
          <img 
            src={schoolLogo} 
            alt="Logo Sekolah" 
            className="header-logo"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'inline-block';
            }}
          />
        ) : null}
        <span className="header-logo-placeholder" style={{ display: schoolLogo ? 'none' : 'inline-block' }}>
          📱
        </span>
        <span className="header-school-name">{schoolName}</span>
        <span className="header-time">{currentTime}</span>
      </div>
      
      <div className="header-user">
        <div className="header-user-info">
          <span className="header-user-name">
            {user?.nama || user?.displayName || user?.email?.split('@')[0] || 'User'}
          </span>
          <span className={`header-user-role ${getRoleClass(user?.role)}`}>
            {getRoleIcon(user?.role)} {getRoleDisplayName(user?.role)}
          </span>
        </div>
        <div 
          className="header-avatar-wrapper"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {/* Avatar */}
          {profilePhoto ? (
            <img 
              className={`header-avatar ${uploading ? 'uploading' : ''}`}
              src={profilePhoto} 
              alt="Foto Profil"
              onClick={handleAvatarClick}
              style={{ cursor: uploading ? 'default' : 'pointer' }}
            />
          ) : (
            <div 
              className={`header-avatar placeholder ${uploading ? 'uploading' : ''}`}
              onClick={handleAvatarClick}
              style={{ cursor: uploading ? 'default' : 'pointer' }}
            >
              {user?.nama?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || 'U'}
            </div>
          )}
          
          {/* Upload Progress Ring */}
          {uploading && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="avatar-progress-ring">
              <svg viewBox="0 0 36 36" className="progress-ring">
                <circle
                  className="progress-ring-bg"
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="3"
                />
                <circle
                  className="progress-ring-fill"
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke="#00bcd4"
                  strokeWidth="3"
                  strokeDasharray={`${uploadProgress * 100.53 / 100} 100.53`}
                  strokeLinecap="round"
                  transform="rotate(-90 18 18)"
                />
              </svg>
              <span className="progress-text">{uploadProgress}%</span>
            </div>
          )}
          
          {/* Upload Spinner (fallback) */}
          {uploading && uploadProgress === 0 && (
            <div className="avatar-upload-spinner">
              <div className="spinner"></div>
            </div>
          )}
          
          {/* Upload Icon Overlay */}
          {!uploading && (
            <div className="avatar-upload-overlay">
              <span className="avatar-upload-icon">📷</span>
            </div>
          )}
          
          {/* Tooltip */}
          {showTooltip && !uploading && (
            <div className="avatar-tooltip">
              Klik untuk ganti foto
            </div>
          )}
          
          {/* Status Indicator */}
          <div className={`avatar-status ${user?.role === 'developer' ? 'status-developer' : ''}`}></div>
          
          {/* Hidden File Input */}
          <input
            id="profilePhotoInput"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onProfilePhotoChange}
            disabled={uploading}
          />
        </div>
      </div>
    </header>
  );
};

export default Header;