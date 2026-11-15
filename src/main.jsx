import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';

window.addEventListener('vite:preloadError', (event) => {
  const failedModule = event.payload?.message || String(event.payload || 'unknown');
  const reloadKey = `vite:preload-reload:${failedModule}`;

  try {
    if (sessionStorage.getItem(reloadKey)) return;
    sessionStorage.setItem(reloadKey, '1');
    event.preventDefault();
    window.location.reload();
  } catch (error) {
    console.error('Tidak dapat memuat modul terbaru; silakan muat ulang aplikasi.', error);
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary title="Aplikasi gagal dibuka">
      <App />
    </ErrorBoundary>
    <PwaUpdatePrompt />
  </React.StrictMode>
);
