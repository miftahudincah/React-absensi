// src/pages/tabs/StatusTab.jsx
import React, { useState, useEffect, useCallback } from 'react';
import StatusManager from '../../components/Status/StatusManager';
import './StatusTab.css';

const StatusTab = ({ user, onStatusUpdate }) => {
  const [statusUnviewedCount, setStatusUnviewedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [viewingOwnStatus, setViewingOwnStatus] = useState(true);

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

  // ==================== HANDLE VIEW CHANGE ====================
  const handleViewChange = useCallback((isOwnStatus) => {
    setViewingOwnStatus(isOwnStatus);
  }, []);

  // ==================== CHECK IF STATUS SYSTEM IS READY ====================
  useEffect(() => {
    // Dispatch event to initialize status system
    const initStatus = () => {
      if (user?.uid) {
        window.dispatchEvent(new CustomEvent('uiReady', {
          detail: { currentUser: user }
        }));
        setIsLoading(false);
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
  }, [user]);

  // ==================== LISTEN FOR STATUS UPDATES ====================
  useEffect(() => {
    const handleStatusBadgeUpdate = (e) => {
      if (e.detail && typeof e.detail.count === 'number') {
        setStatusUnviewedCount(e.detail.count);
      }
    };
    
    const handleStatusViewChange = (e) => {
      if (e.detail && typeof e.detail.isOwnStatus === 'boolean') {
        setViewingOwnStatus(e.detail.isOwnStatus);
      }
    };
    
    window.addEventListener('statusBadgeUpdate', handleStatusBadgeUpdate);
    window.addEventListener('statusViewChange', handleStatusViewChange);
    
    return () => {
      window.removeEventListener('statusBadgeUpdate', handleStatusBadgeUpdate);
      window.removeEventListener('statusViewChange', handleStatusViewChange);
    };
  }, []);

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
      {/* Header */}
      <div className="status-tab-header">
        <div className="status-tab-title">
          <span className="status-tab-icon">📸</span>
          <h2>Status</h2>
          {statusUnviewedCount > 0 && (
            <span className="status-tab-badge">{statusUnviewedCount} baru</span>
          )}
        </div>
        <div className="status-tab-subtitle">
          <p>{viewingOwnStatus ? 'Lihat dan bagikan status dengan teman-teman Anda' : 'Lihat status teman Anda'}</p>
        </div>
      </div>

      {/* Status Manager - with privacy props */}
      <div className="status-tab-content">
        <StatusManager 
          user={user}
          onStatusUpdate={handleStatusUpdate}
          onViewChange={handleViewChange}
          activeTab="status"
          showViewers={viewingOwnStatus} // Hanya tampilkan viewer jika melihat status sendiri
        />
      </div>

      {/* Info Footer */}
      <div className="status-tab-footer">
        <div className="status-tab-info">
          <span>💡</span>
          <span>Status akan otomatis hilang setelah 24 jam</span>
        </div>
        <div className="status-tab-info">
          <span>👥</span>
          <span>Hanya teman yang dapat melihat status Anda</span>
        </div>
        <div className="status-tab-info">
          <span>🔒</span>
          <span>Status Anda aman dan hanya terlihat oleh teman</span>
        </div>
      </div>
    </div>
  );
};

export default StatusTab;