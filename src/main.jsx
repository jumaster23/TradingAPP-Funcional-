import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

const enableServiceWorker =
  import.meta.env.PROD &&
  import.meta.env.VITE_ENABLE_SW === 'true' &&
  'serviceWorker' in navigator;

if (enableServiceWorker) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('SW registration failed:', error);
    });
  });
}
