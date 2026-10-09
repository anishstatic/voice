import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Area, AreaChart
} from 'recharts';
import { Activity, CheckCircle, DollarSign, Zap, RefreshCw, TrendingUp, Clock } from 'lucide-react';
import { API_BASE, WS_BASE } from '../config';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'rgba(22, 25, 35, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-medium)',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
      }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
          {payload[0]?.payload?.date || label}
        </p>
        {payload.map((p, i) => (
          <p key={i} className="text-sm font-semibold" style={{ color: p.color }}>
            {p.name === 'cost' ? `$${p.value.toFixed(6)}` : p.value.toLocaleString()} {p.name}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const Dashboard = () => {
  const [stats, setStats] = useState({
    activeSessions: 0,
    completedSessions: 0,
    totalTokens: 0,
    totalCost: 0,
    recentSessions: []
  });

  const [trends, setTrends] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const socketRef = useRef(null);

  const fetchTrends = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/trends`);
      setTrends(response.data);
    } catch (error) {
      console.error('Failed to fetch trends', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/stats`);
      setStats(response.data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch stats', error);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchTrends();

    const socket = io(WS_BASE);
    socketRef.current = socket;

    socket.on('dashboardUpdate', (newStats) => {
      setStats(newStats);
      setLastUpdated(new Date());
      fetchTrends();
    });

    const trendsInterval = setInterval(fetchTrends, 30000);

    return () => {
      socket.disconnect();
      clearInterval(trendsInterval);
    };
  }, []);

  const metrics = [
    {
      title: 'Active Sessions',
      value: stats.activeSessions,
      icon: <Activity size={20} />,
      gradient: 'linear-gradient(135deg, #10b981, #06b6d4)',
      shadowColor: 'rgba(16, 185, 129, 0.3)',
      pulse: stats.activeSessions > 0
    },
    {
      title: 'Completed',
      value: stats.completedSessions,
      icon: <CheckCircle size={20} />,
      gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      shadowColor: 'rgba(99, 102, 241, 0.3)',
    },
    {
      title: 'Total Tokens',
      value: stats.totalTokens.toLocaleString(),
      icon: <Zap size={20} />,
      gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
      shadowColor: 'rgba(245, 158, 11, 0.3)',
    },
    {
      title: 'Est. Cost',
      value: `$${stats.totalCost.toFixed(6)}`,
      icon: <DollarSign size={20} />,
      gradient: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
      shadowColor: 'rgba(236, 72, 153, 0.3)',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Last Updated */}
      {lastUpdated && (
        <div className="flex items-center justify-end gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <RefreshCw size={11} />
          Updated {lastUpdated.toLocaleTimeString()}
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((metric, idx) => (
          <div key={idx} className="metric-card" style={{ animationDelay: `${idx * 0.05}s` }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{
                background: metric.gradient,
                boxShadow: `0 4px 16px ${metric.shadowColor}`
              }}>
                {metric.icon}
              </div>
              {metric.pulse && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <p className="text-xs font-medium uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              {metric.title}
            </p>
            <h4 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {metric.value}
            </h4>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Trends */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.2)'
              }}>
                <DollarSign size={16} style={{ color: '#818cf8' }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Cost Trends</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Last 7 days</p>
              </div>
            </div>
            <TrendingUp size={14} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div style={{ height: '220px' }}>
            {trends.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends} barCategoryGap="30%">
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="cost" fill="url(#costGradient)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Start a voice session to see cost trends" />
            )}
          </div>
        </div>
        
        {/* Token Usage */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.2)'
              }}>
                <Zap size={16} style={{ color: '#34d399' }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Token Usage</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Last 7 days</p>
              </div>
            </div>
            <TrendingUp size={14} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div style={{ height: '220px' }}>
            {trends.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends}>
                  <defs>
                    <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="tokens" stroke="#10b981" strokeWidth={2.5} fill="url(#tokenGradient)" dot={{ fill: '#10b981', strokeWidth: 0, r: 4 }} activeDot={{ r: 6, strokeWidth: 2, stroke: '#0f1117' }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Start a voice session to see token usage" />
            )}
          </div>
        </div>
      </div>
      
      {/* Recent Sessions Table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Clock size={16} style={{ color: 'var(--text-muted)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Sessions</h3>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {stats.recentSessions?.length || 0} sessions
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr style={{ background: 'rgba(15, 17, 23, 0.5)' }}>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Session</th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Status</th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Duration</th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Tokens</th>
                <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSessions?.map((session, idx) => (
                <tr key={idx} className="transition-colors" style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs px-2 py-1 rounded-md" style={{
                      background: 'var(--surface)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)'
                    }}>
                      ...{session.id.slice(-6)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`status-badge ${session.status === 'active' ? 'status-active' : 'status-completed'}`}>
                      {session.status === 'active' && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                      )}
                      {session.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{session.duration}s</td>
                  <td className="px-5 py-3.5 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{session.tokens.toLocaleString()}</td>
                  <td className="px-5 py-3.5 text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>${session.cost.toFixed(6)}</td>
                </tr>
              ))}
              {(!stats.recentSessions || stats.recentSessions.length === 0) && (
                <tr>
                  <td colSpan="5" className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Activity size={24} style={{ color: 'var(--text-muted)' }} />
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sessions yet</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Start a voice session to see data here</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const EmptyChart = ({ message }) => (
  <div className="h-full flex flex-col items-center justify-center gap-2">
    <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{
      background: 'var(--surface-hover)',
      border: '1px solid var(--border-subtle)'
    }}>
      <TrendingUp size={20} style={{ color: 'var(--text-muted)' }} />
    </div>
    <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>{message}</p>
  </div>
);

export default Dashboard;
