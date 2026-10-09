import React, { useState } from 'react';
import axios from 'axios';
import { Activity, Mail, Lock, User, Eye, EyeOff, ArrowRight, ShieldCheck, AlertCircle, Database } from 'lucide-react';
import { API_BASE } from '../config';

const Login = ({ onLoginSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Client-side validations
    if (isRegister) {
      if (!formData.name.trim()) {
        setError('Please enter your full name');
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    if (!formData.email.trim() || !formData.password) {
      setError('Please fill in all required fields');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isRegister
        ? `${API_BASE}/api/auth/register`
        : `${API_BASE}/api/auth/login`;

      const payload = isRegister
        ? { name: formData.name.trim(), email: formData.email.trim(), password: formData.password }
        : { email: formData.email.trim(), password: formData.password };

      const response = await axios.post(endpoint, payload);

      if (response.data && response.data.token) {
        onLoginSuccess(response.data.user, response.data.token);
      } else {
        setError('Unexpected response from server');
      }
    } catch (err) {
      console.error('Auth error:', err);
      if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.code === 'ERR_NETWORK') {
        setError('Cannot connect to backend server at http://localhost:5000. Please ensure the backend is running.');
      } else {
        setError('Authentication failed. Please check your credentials and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{ background: 'var(--surface)' }}>
      {/* Decorative ambient background glows */}
      <div 
        className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none opacity-20 blur-[100px]"
        style={{ background: 'var(--primary)' }}
      />
      <div 
        className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 rounded-full pointer-events-none opacity-20 blur-[100px]"
        style={{ background: 'var(--accent)' }}
      />

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-xl" style={{
            background: 'var(--gradient-primary)',
            boxShadow: '0 0 35px rgba(99, 102, 241, 0.4)'
          }}>
            <Activity size={28} className="text-white animate-pulse" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Voice<span style={{
              background: 'var(--gradient-primary)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>AI</span> Studio
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Real-time multimodal voice intelligence platform
          </p>
        </div>

        {/* Main Card */}
        <div className="glass-card p-8 border border-white/10 rounded-2xl backdrop-blur-xl shadow-2xl" style={{ background: 'rgba(24, 27, 40, 0.85)' }}>
          {/* Tab Selector */}
          <div className="flex rounded-xl p-1 mb-6" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => { setIsRegister(false); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer ${
                !isRegister 
                  ? 'text-white shadow-md' 
                  : 'text-gray-400 hover:text-white'
              }`}
              style={{
                background: !isRegister ? 'var(--primary)' : 'transparent'
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setIsRegister(true); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer ${
                isRegister 
                  ? 'text-white shadow-md' 
                  : 'text-gray-400 hover:text-white'
              }`}
              style={{
                background: isRegister ? 'var(--primary)' : 'transparent'
              }}
            >
              Create Account
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl flex items-start gap-3 border text-sm animate-fade-in" style={{
              background: 'rgba(239, 68, 68, 0.1)',
              borderColor: 'rgba(239, 68, 68, 0.25)',
              color: '#fca5a5'
            }}>
              <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Full Name
                </label>
                <div className="relative">
                  <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    name="name"
                    required={isRegister}
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="John Doe"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm transition-all focus:outline-none"
                    style={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--text-secondary)' }}>
                Email Address
              </label>
              <div className="relative">
                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm transition-all focus:outline-none"
                  style={{
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)'
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Password
                </label>
                {isRegister && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>min 6 chars</span>
                )}
              </div>
              <div className="relative">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-11 py-2.5 rounded-xl text-sm transition-all focus:outline-none"
                  style={{
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {isRegister && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    required={isRegister}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm transition-all focus:outline-none"
                    style={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl font-medium text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              style={{
                background: 'var(--gradient-primary)',
                boxShadow: '0 4px 20px rgba(99, 102, 241, 0.35)'
              }}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{isRegister ? 'Creating Account in MongoDB...' : 'Authenticating...'}</span>
                </>
              ) : (
                <>
                  <span>{isRegister ? 'Create Account & Access Dashboard' : 'Sign In to Dashboard'}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Database & Security indicator */}
          <div className="mt-6 pt-5 border-t border-white/5 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="flex items-center gap-1.5">
              <Database size={13} className="text-emerald-400" />
              <span>MongoDB Atlas Connected</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-indigo-400" />
              <span>JWT Authentication</span>
            </div>
          </div>
        </div>

        {/* Footnote */}
        <p className="mt-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Session data and metrics are securely synced to your MongoDB cloud database.
        </p>
      </div>
    </div>
  );
};

export default Login;
