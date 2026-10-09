import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'

// Automatically attach JWT token to all outgoing Axios requests
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('voiceai_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// If token expires or is invalid (401), clear local storage and refresh auth state
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401 && !error.config.url.includes('/api/auth/login')) {
      localStorage.removeItem('voiceai_token');
      localStorage.removeItem('voiceai_user');
      window.dispatchEvent(new Event('auth-logout'));
    }
    return Promise.reject(error);
  }
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
