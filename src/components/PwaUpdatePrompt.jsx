import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Pemberitahuan versi baru PWA.
 *
 * Sebelumnya registerType 'autoUpdate': service worker baru langsung mengambil
 * alih dan halaman bisa dimuat ulang sendiri. Kalau itu terjadi saat kasir
 * sedang mengisi keranjang, isian transaksi hilang tanpa peringatan.
 *
 * Sekarang registerType 'prompt': pembaruan hanya dipasang ketika pengguna
 * menekan "Perbarui", jadi reload selalu keputusan sadar.
 */
const CEK_MS = 30 * 60 * 1000;
const SIAP_OFFLINE_MS = 6000;

export default function PwaUpdatePrompt() {
  const registrasi = useRef(null);
  const [tampilSiap, setTampilSiap] = useState(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrasi.current = registration || null;
    },
    onRegisterError(error) {
      console.warn('[pwa] registrasi service worker gagal:', error);
    }
  });

  // Tablet kasir sering menyala sepanjang hari tanpa ditutup, jadi pembaruan
  // dicek berkala — bukan hanya saat aplikasi pertama dibuka.
  useEffect(() => {
    const timer = setInterval(() => {
      registrasi.current?.update().catch(() => {});
    }, CEK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!offlineReady) return;
    setTampilSiap(true);
    const timer = setTimeout(() => {
      setTampilSiap(false);
      setOfflineReady(false);
    }, SIAP_OFFLINE_MS);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  if (needRefresh) {
    return (
      <div className="pwa-prompt" role="dialog" aria-labelledby="pwa-prompt-judul">
        <div className="pwa-prompt-text">
          <strong id="pwa-prompt-judul">Versi baru tersedia</strong>
          <span>
            Selesaikan transaksi yang sedang dibuka lebih dulu, lalu perbarui
            agar isian tidak hilang.
          </span>
        </div>
        <div className="pwa-prompt-actions">
          <button className="btn btn-primary" onClick={() => updateServiceWorker(true)}>
            Perbarui sekarang
          </button>
          <button className="btn" onClick={() => setNeedRefresh(false)}>
            Nanti
          </button>
        </div>
      </div>
    );
  }

  if (tampilSiap) {
    return (
      <div className="pwa-toast" role="status" aria-live="polite">
        Aplikasi siap dipakai tanpa internet.
      </div>
    );
  }

  return null;
}
