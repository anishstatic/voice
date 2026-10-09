// In production on Vercel, API_BASE is empty string so requests hit /api/* on the same Vercel deployment.
// In local development, it defaults to http://localhost:5001.
const isLocal = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const API_BASE = import.meta.env.VITE_API_URL !== undefined 
  ? import.meta.env.VITE_API_URL 
  : (isLocal ? 'http://localhost:5001' : '');

export const WS_BASE = import.meta.env.VITE_API_URL || (isLocal ? 'http://localhost:5001' : '');
