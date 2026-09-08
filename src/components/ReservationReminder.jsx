import { useEffect, useRef, useState } from 'react';
import { listenReservations } from '../lib/reservationService';

const WINDOW_MS = 15 * 60000;

function minutesText(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  return `Booking akan datang dalam ${mins} menit lagi`;
}

function fmtJam(ms) {
  const d = new Date(ms);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tgl = isToday ? 'Hari ini' : d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${tgl}, ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ReservationReminder({ outletId, onOpen }) {
  const [reservations, setReservations] = useState([]);
  const [alert, setAlert] = useState(null);
  const notified = useRef(new Set());

  useEffect(() => {
    let alive = true;
    const unsub = listenReservations(outletId, (rows) => {
      if (alive) setReservations(rows);
    });

    function check() {
      const now = Date.now();
      const soon = reservations
        .filter((r) => r.status === 'terjadwal' && r.scheduledAt > now && r.scheduledAt - now <= WINDOW_MS && !notified.current.has(r.id))
        .sort((a, b) => a.scheduledAt - b.scheduledAt);
      if (soon.length === 0) return;
      const next = soon[0];
      if (alert && alert.id === next.id) return;
      notified.current.add(next.id);
      setAlert(next);
    }

    check();
    const timer = setInterval(check, 30000);
    return () => { alive = false; unsub(); clearInterval(timer); };
  }, [outletId, reservations, alert]);

  if (!alert) return null;

  const mins = Math.max(1, Math.ceil((alert.scheduledAt - Date.now()) / 60000));

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, maxWidth: 360, width: '100%', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--busy)', letterSpacing: 1, marginBottom: 4 }}>⏰ REMINDER BOOKING</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>{mins} menit lagi</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 14 }}>
          Pelanggan: <strong>{alert.customerName || '-'}</strong><br />
          Terapis: <strong>{alert.therapistName}</strong><br />
          Kategori: <strong>{alert.category || alert.treatmentName || '-'}</strong><br />
          Jam: <strong>{fmtJam(alert.scheduledAt)}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ flex: 1, background: 'var(--primary-dark)', color: '#fff', boxShadow: 'none' }} onClick={() => { setAlert(null); onOpen(); }}>
            Buka Reservasi
          </button>
          <button style={{ width: 'auto', background: 'var(--text-secondary)', color: '#fff', boxShadow: 'none' }} onClick={() => setAlert(null)}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}