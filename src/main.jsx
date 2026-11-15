import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary title="Aplikasi gagal dibuka">
      <App />
    </ErrorBoundary>
    <PwaUpdatePrompt />
  </React.StrictMode>
);
