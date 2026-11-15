import { useEffect, useState } from 'react';
import { notificationEventName } from '../lib/notifications';

export default function ToastNotifications() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let timer;
    function showToast(event) {
      clearTimeout(timer);
      setToast({ ...event.detail, id: Date.now() });
      timer = setTimeout(() => setToast(null), 4000);
    }

    window.addEventListener(notificationEventName(), showToast);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(notificationEventName(), showToast);
    };
  }, []);

  if (!toast) return null;
  return (
    <div
      className={`toast-notification ${toast.type === 'error' ? 'toast-error' : 'toast-success'}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      key={toast.id}
    >
      <span aria-hidden="true">{toast.type === 'error' ? '⚠' : '✓'}</span>
      <span>{toast.message}</span>
      <button type="button" aria-label="Tutup notifikasi" onClick={() => setToast(null)}>×</button>
    </div>
  );
}
