import { useLayoutEffect, useRef, useState } from 'react';

const DISMISS_KEY = 'dayang_unpaid_banner_dismissed';

export default function UnpaidReminder({ count, overdue, onOpen }) {
  const ref = useRef(null);
  const [minimized, setMinimized] = useState(false);
  // Disimpan per perangkat, bukan per sesi, supaya kasir yang sedang mengisi
  // form panjang (Absensi, Koreksi Booking) tidak perlu dismissal ulang tiap
  // reload. Kuncinya berisi jumlah tagihan, jadi kalau muncul tagihan baru
  // banner muncul lagi dengan sendirinya.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === String(overdue);
    } catch {
      return false;
    }
  });

  // Banner ini position:fixed, jadi tingginya harus ikut dihitung supaya konten
  // di bawahnya (tombol Simpan di halaman Absensi) tidak tertutup. Kita publish
  // tinggi banner sebagai CSS variable --unpaid-banner-h yang dipakai
  // .has-banner.
  //
  // UnpaidReminder di-render di dua tempat (layout kasir & layout biasa), jadi
  // keduanya menulis variable yang sama. Kalau salah satu di-unmount,
  // menghapus variable akan membuat banner yang masih tampil kehilangan ruang
  // kosongnya sehingga konten langsung tertutup. Karena itu tinggi tidak
  // dihapus saat unmount, hanya ditulis ulang 0px.
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return undefined;

    const publish = () => {
      const h = el.offsetHeight || 0;
      root.style.setProperty('--unpaid-banner-h', `${h}px`);
      root.style.setProperty('--unpaid-banner-visible', h > 0 ? '1' : '0');
    };

    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener('resize', publish);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', publish);
      root.style.setProperty('--unpaid-banner-h', '0px');
      root.style.setProperty('--unpaid-banner-visible', '0');
    };
  }, [overdue, minimized, dismissed]);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(overdue));
    } catch {
      /* localStorage penuh atau dinonaktifkan — dismissal tetap berlaku sesi ini */
    }
  }

  // Saat banner disembunyikan, komponen tidak dirender sama sekali. Effect
  // di atas sudah menaruh --unpaid-banner-h = 0px, jadi .has-banner langsung
  // melepas ruang kosong yang sebelumnya dipesan untuk banner.
  if (overdue === 0 || dismissed) return null;

  const label =
    overdue === 1
      ? '1 transaksi sudah lewat jam selesai tapi belum dibayar'
      : `${overdue} transaksi sudah lewat jam selesai tapi belum dibayar`;

  if (minimized) {
    return (
      <div className="unpaid-banner is-min" ref={ref}>
        <button className="unpaid-banner-text" onClick={() => setMinimized(false)} title="Lihat detail">
          <strong>⚠️ {overdue} belum dibayar</strong>
        </button>
        <div className="unpaid-banner-min-actions">
          <button className="unpaid-banner-btn" onClick={onOpen}>Buka</button>
          <button className="unpaid-banner-min-toggle" onClick={() => setMinimized(false)} aria-label="Perluas">▲</button>
        </div>
      </div>
    );
  }

  return (
    <div className="unpaid-banner" ref={ref}>
      <div className="unpaid-banner-text">
        <strong>⚠️ Tagihan belum dibayar</strong>
        <span>{label}{count > overdue ? ` (total belum bayar ${count})` : ''}</span>
      </div>
      <div className="unpaid-banner-min-actions">
        <button className="unpaid-banner-btn" onClick={onOpen}>
          Buka Payment & List
        </button>
        <button
          className="unpaid-banner-min-toggle"
          onClick={() => setMinimized(true)}
          aria-label="Perkecil banner"
          title="Perkecil banner"
        >
          ▼
        </button>
        <button
          className="unpaid-banner-min-toggle"
          onClick={dismiss}
          aria-label="Sembunyikan banner"
          title="Sembunyikan banner sampai muncul tagihan baru"
        >
          ✕
        </button>
      </div>
    </div>
  );
}