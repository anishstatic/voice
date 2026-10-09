import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import VoiceAgent from './components/VoiceAgent';
import Login from './components/Login';
import { Activity, BarChart3, LogOut, User as UserIcon } from 'lucide-react';
import axios from 'axios';
import { API_BASE } from './config';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('voiceai_token') || null);
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('voiceai_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Validate session on load
  useEffect(() => {
    const verifySession = async () => {
      const savedToken = localStorage.getItem('voiceai_token');
      if (!savedToken) {
        setCheckingAuth(false);
        return;
      }

      try {
        const response = await axios.get(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` }
        });
        if (response.data?.user) {
          setUser(response.data.user);
          localStorage.setItem('voiceai_user', JSON.stringify(response.data.user));
        }
      } catch (err) {
        console.warn('Session verification failed, logging out:', err?.message);
        // If token is invalid or expired, log out
        if (err.response?.status === 401) {
          handleLogout();
        }
      } finally {
        setCheckingAuth(false);
      }
    };

    verifySession();

    const handleAuthLogoutEvent = () => {
      setUser(null);
      setToken(null);
    };

    window.addEventListener('auth-logout', handleAuthLogoutEvent);
    return () => window.removeEventListener('auth-logout', handleAuthLogoutEvent);
  }, []);

  const handleLoginSuccess = (userData, jwtToken) => {
    setUser(userData);
    setToken(jwtToken);
    localStorage.setItem('voiceai_token', jwtToken);
    localStorage.setItem('voiceai_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('voiceai_token');
    localStorage.removeItem('voiceai_user');
  };

  // Loading state while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-xs tracking-wider uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
            Authenticating session...
          </p>
        </div>
      </div>
    );
  }

  // If not logged in, show Login / Register page
  if (!token || !user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Once authenticated, show Dashboard and Voice Agent
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50" style={{
        background: 'rgba(15, 17, 23, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div className="max-w-[1440px] mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg" style={{
                background: 'var(--gradient-primary)',
                boxShadow: '0 0 20px rgba(99, 102, 241, 0.3)'
              }}>
                <Activity size={18} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  Voice<span style={{
                    background: 'var(--gradient-primary)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                  }}>AI</span>
                </h1>
              </div>
            </div>

            {/* Nav Right: Status, User Profile & Logout */}
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="status-badge status-active hidden sm:flex">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                System Online
              </div>

              {/* User Chip */}
              <div 
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border text-sm"
                style={{
                  background: 'var(--surface-raised)',
                  borderColor: 'var(--border-subtle)'
                }}
              >
                <div 
                  className="w-7 h-7 rounded-lg flex items-center justify-center font-semibold text-xs text-white uppercase shadow-sm"
                  style={{ background: 'var(--gradient-primary)' }}
                >
                  {user.name ? user.name.charAt(0) : <UserIcon size={14} />}
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-xs font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
                    {user.name || 'User'}
                  </p>
                  <p className="text-[10px] leading-tight truncate max-w-[120px]" style={{ color: 'var(--text-muted)' }}>
                    {user.email}
                  </p>
                </div>
              </div>

              {/* Logout Button */}
              <button
                onClick={handleLogout}
                title="Log out"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 cursor-pointer border text-gray-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10"
                style={{
                  borderColor: 'var(--border-subtle)'
                }}
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Page Header */}
      <div className="max-w-[1440px] mx-auto px-6 lg:px-8 pt-8 pb-2">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              <span style={{
                background: 'var(--gradient-primary)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Dashboard
              </span>
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
              Welcome back, <strong className="font-semibold text-slate-200">{user.name}</strong> • Real-time voice agent monitoring & MongoDB telemetry
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <BarChart3 size={14} />
            <span>Live Analytics</span>
          </div>
        </div>
      </div>

      {/* Main Content: Dashboard + Voice Agent */}
      <div className="max-w-[1440px] mx-auto px-6 lg:px-8 pb-12">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6 animate-fade-in">
            <Dashboard />
          </div>
          <div className="xl:col-span-1 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <VoiceAgent />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
