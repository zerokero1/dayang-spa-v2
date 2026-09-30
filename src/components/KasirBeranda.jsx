import React, { useEffect, useState } from 'react';
import { getTherapistBoardSummary } from '../lib/therapistBoardService';

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

  // Ringkasan Dashboard Terapis untuk lencana di tombolnya.
  const [board, setBoard] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await getTherapistBoardSummary();
      if (alive) setBoard(s);
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const boardSub = board
    ? [
        `${board.busy} ambil tamu`,
        board.break ? `${board.break} break` : null,
        board.overtime ? `${board.overtime} lembur` : null
      ].filter(Boolean).join(' · ')
    : 'Ambil tamu · break · lembur';

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
              {t.sub && <span className="sub">{t.board ? boardSub : t.sub}</span>}
            </span>
            {t.badge && unpaidCount > 0 && (
              <span className={overdueCount > 0 ? 'kasir-pill overdue' : 'kasir-pill'}>{unpaidCount}</span>
            )}
            {t.board && board && board.busy > 0 && (
              <span className="kasir-pill">{board.busy}</span>
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
