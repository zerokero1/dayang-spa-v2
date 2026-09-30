import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function UnpaidReminder({ count, overdue, onOpen }) {
  const ref = useRef(null);
  const [minimized, setMinimized] = useState(false);

  // Banner ini position:fixed, jadi tingginya harus ikut dihitung supaya konten
  // di bawahnya (mis. tabel dashboard) tidak tertutup. Kita publishes tinggi
  // banner sebagai CSS variable --unpaid-banner-h yang dipakai .has-banner.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;

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
      root.style.removeProperty('--unpaid-banner-h');
      root.style.removeProperty('--unpaid-banner-visible');
    };
  }, [overdue, minimized]);

  if (overdue === 0) return null;

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
      </div>
    </div>
  );
}