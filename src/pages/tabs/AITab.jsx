// src/pages/tabs/AITab.jsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import './AITab.css';

// API Base URL
const API_BASE_URL = 'https://backendtest-azure.vercel.app/api';

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

  // Refs
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const messagesContainerRef = useRef(null);

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

  // ==================== DETEKSI MOBILE ====================
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ==================== SUGGESTIONS ====================
  const defaultSuggestions = [
    {
      id: 's1',
      icon: '📝',
      title: 'Buat Soal Latihan',
      description: 'Buatkan soal latihan untuk siswa',
      prompt: 'Buatkan saya 5 soal latihan untuk siswa {kelas} tentang {topik} dengan tingkat kesulitan {tingkat}'
    },
    {
      id: 's2',
      icon: '📊',
      title: 'Analisis Data',
      description: 'Analisis data absensi atau nilai',
      prompt: 'Analisis data absensi siswa {kelas} selama {periode} dan berikan ringkasan'
    },
    {
      id: 's3',
      icon: '📚',
      title: 'Rangkuman Materi',
      description: 'Buat rangkuman materi pelajaran',
      prompt: 'Buatkan rangkuman materi {materi} untuk siswa {kelas} dengan bahasa yang mudah dipahami'
    },
    {
      id: 's4',
      icon: '📋',
      title: 'Buat RPP',
      description: 'Buat Rencana Pelaksanaan Pembelajaran',
      prompt: 'Buatkan RPP untuk mata pelajaran {mapel} kelas {kelas} dengan materi {materi}'
    },
    {
      id: 's5',
      icon: '📢',
      title: 'Pengumuman Sekolah',
      description: 'Buat draft pengumuman sekolah',
      prompt: 'Buatkan draft pengumuman untuk {tujuan} kepada {target} tentang {topik}'
    },
    {
      id: 's6',
      icon: '📈',
      title: 'Laporan Perkembangan',
      description: 'Buat laporan perkembangan siswa',
      prompt: 'Buatkan laporan perkembangan siswa {nama} dalam mata pelajaran {mapel} selama {periode}'
    },
    {
      id: 's7',
      icon: '🎯',
      title: 'Tips Belajar',
      description: 'Tips belajar efektif untuk siswa',
      prompt: 'Berikan tips belajar efektif untuk siswa {kelas} dalam menghadapi {ujian}'
    },
    {
      id: 's8',
      icon: '💡',
      title: 'Ide Kegiatan',
      description: 'Ide kegiatan pembelajaran menarik',
      prompt: 'Berikan ide kegiatan pembelajaran yang menarik untuk siswa {kelas} tentang {topik}'
    }
  ];

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

  // ==================== SYSTEM PROMPT ====================
  const getSystemPrompt = useCallback(() => {
    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sekolah';
    const userRole = user?.role || 'user';
    const userName = user?.nama || 'User';
    const userKelas = user?.kelas || '';
    const userJurusan = user?.jurusan || '';

    return `Anda adalah asisten AI untuk sistem manajemen sekolah bernama "${schoolName}". 
Anda membantu guru, staff, dan admin dalam berbagai tugas sekolah.

Informasi pengguna:
- Nama: ${userName}
- Role: ${userRole}
- Kelas: ${userKelas || 'Tidak ada'}
- Jurusan: ${userJurusan || 'Tidak ada'}

Panduan:
1. Jawab dengan bahasa Indonesia yang sopan, jelas, dan informatif
2. Berikan solusi yang praktis dan aplikatif
3. Jika ditanya tentang data spesifik, sarankan untuk mengecek di sistem
4. Untuk pertanyaan di luar konteks sekolah, berikan jawaban umum yang tetap bermanfaat
5. Gunakan format yang rapi dengan poin-poin jika diperlukan

Anda adalah asisten yang ramah dan profesional. Selalu utamakan membantu pengguna dengan sebaik-baiknya.`;
  }, [user]);

  // ==================== SEND MESSAGE TO AI ====================
  const sendToAI = useCallback(async (message) => {
    if (!message.trim()) return;
    if (!hasAIAccess) {
      setError('⚠️ Anda tidak memiliki akses ke AI Assistant. Hanya Guru, Staff, dan Admin yang dapat mengakses.');
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
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Tidak dapat memperoleh token autentikasi');
      }

      const history = messages.slice(-10).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }));

      const systemPrompt = getSystemPrompt();

      console.log('🤖 Sending to AI via GROQ API...');
      console.log('📝 Message:', message);

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
        console.log('🔄 Trying OpenAI fallback...');
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
  }, [messages, user, hasAIAccess, getAuthToken, scrollToBottom, getSystemPrompt, aiProvider]);

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
          <p>AI Assistant hanya tersedia untuk Guru, Staff TU, dan Admin.</p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Silakan hubungi admin jika Anda memerlukan akses.
          </p>
        </div>
      </div>
    );
  }

  const messageGroups = groupMessagesByDate(messages);

  return (
    <div className="ai-container">
      {/* ===== HEADER ===== */}
      <div className="ai-header">
        <div className="header-left">
          <h1>🤖 AI Assistant</h1>
          <p className="header-subtitle">
            Asisten AI untuk membantu tugas sekolah
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
          background: isDeveloper ? 'rgba(155,89,182,0.15)' : 'rgba(0,188,212,0.1)',
          color: isDeveloper ? '#9b59b6' : '#00bcd4'
        }}>
          {isDeveloper ? '👨‍💻 Developer' : 
           isAdmin ? '👑 Admin' : 
           isWakilKepala ? '👔 Wakil Kepala' :
           isGuru ? '👨‍🏫 Guru' : '📋 Staff TU'}
        </span>
        <span className="ai-provider-badge" style={{
          color: aiProvider === 'groq' ? '#00bcd4' : '#9b59b6'
        }}>
          🧠 {aiProvider === 'groq' ? 'GROQ' : 'OpenAI'}
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
            <p>Pilih salah satu saran di bawah atau tulis pertanyaan Anda</p>
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
            <h4>💡 Coba tanyakan:</h4>
            <div className="suggestions-grid">
              {defaultSuggestions.map((suggestion) => (
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
              placeholder={isMobile ? "Tulis pesan..." : "Tulis pertanyaan Anda... (Enter untuk kirim)"}
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
            <span>💡 Enter untuk kirim</span>
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
        </p>
      </div>
    </div>
  );
};

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

export default AITab;