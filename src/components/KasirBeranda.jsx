import React from 'react';

/** Layar beranda khusus akun kasir: tombol besar, bahasa sehari-hari.
 *  Daftar tombol diambil dari App.jsx (KASIR_HOME_TILES) supaya tetap sinkron
 *  dengan PAGES. */
export default function KasirBeranda({
  userName,
  outletName,
  tiles,
  unpaidCount,
  overdueCount,
  onOpen
}) {
  const hour = new Date().getHours();
  const sapaan =
    hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
  return (
    <div className="kasir-home">
      <p className="kasir-greet">
        {sapaan}, {String(userName).split(' ')[0]} 👋
        <small>Mau ngapain hari ini? Pilih tombol besar di bawah.</small>
      </p>

      <div className="kasir-tiles">
        {tiles.map((t) => (
          <button
            key={t.key}
            className={`kasir-tile${t.primary ? ' primary' : ''}`}
            onClick={() => onOpen(t.key)}
          >
            <span className="ic">{t.icon}</span>
            <span className="txt">
              <b>{t.title}</b>
              {t.sub && <span className="sub">{t.sub}</span>}
            </span>
            {t.badge && unpaidCount > 0 && (
              <span className={overdueCount > 0 ? 'kasir-pill overdue' : 'kasir-pill'}>{unpaidCount}</span>
            )}
          </button>
        ))}
      </div>

      {unpaidCount > 0 && (
        <button className="kasir-alert" onClick={() => onOpen('status')}>
          ⚠ Ada {unpaidCount} tagihan belum bayar
          {overdueCount > 0 ? ` (${overdueCount} lewat jam)` : ''} — ketuk untuk melunasi
        </button>
      )}

      <p className="kasir-home-note">
        Outlet {outletName}. Menu teknis (Koreksi Booking, Log Aktivitas, Kelola Terapis) tidak muncul di
        akun kasir. Butuh menu lain? Tekan “Lainnya” di bawah.
      </p>
    </div>
  );
}
