import { useEffect, useState } from 'react';

/**
 * Peringatan koneksi terputus.
 *
 * Pesan sebelumnya berbunyi "Data tersimpan di perangkat", padahal aplikasi
 * ini tidak punya antrean offline: setiap simpan langsung memanggil Supabase.
 * Kalau wifi mati, transaksi GAGAL, jadi pesannya harus jujur supaya kasir
 * tidak mengira transaksi sudah tercatat.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );

  useEffect(() => {
    const putus = () => setOffline(true);
    const pulih = () => setOffline(false);
    window.addEventListener('offline', putus);
    window.addEventListener('online', pulih);
    return () => {
      window.removeEventListener('offline', putus);
      window.removeEventListener('online', pulih);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span aria-hidden="true">📶</span>
      <span>
        Koneksi internet terputus — transaksi dan pembaruan data belum bisa
        disimpan. Sambungkan internet, lalu ulangi.
      </span>
    </div>
  );
}
