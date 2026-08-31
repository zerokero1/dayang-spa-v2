import { useEffect, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getDailyBookings } from '../lib/reportService';
import { ReceiptLines } from '../components/Receipt';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayId() {
  // Tanggal LOKAL WIB (UTC+7) — konsisten dengan reportService
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

export default function StrukPage({ outletId, active }) {
  const [date, setDate] = useState(todayId());
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [printingBooking, setPrintingBooking] = useState(null);

  async function loadBookings() {
    setLoading(true);
    try {
      const data = await getDailyBookings(outletId, date);
      setBookings(data.filter((b) => b.status !== 'batal').sort((a, b) => (b.startAt || 0) - (a.startAt || 0)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    loadBookings();
  }, [active, outletId, date]);

  function handlePrint(booking) {
    setPrintingBooking(booking);
    setTimeout(() => {
      window.print();
      setPrintingBooking(null);
    }, 100);
  }

  const outletName = OUTLETS.find((o) => o.id === outletId)?.name || outletId;

  return (
    <div className="kasir-page">
      <h2>Struk - {outletName}</h2>

      <section>
        <p>Tanggal</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </section>

      {loading && <p style={{ fontSize: 13 }}>Memuat...</p>}
      {!loading && bookings.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada transaksi di tanggal ini.</p>
      )}

      {bookings.map((b) => (
        <div key={b.id} className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: 13 }}>{b.treatmentName}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {b.therapistName} · {b.customerName || 'Tanpa nama'} · {rp(b.treatmentPrice)}
              </div>
            </div>
            <button
              style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }}
              onClick={() => handlePrint(b)}
            >
              Cetak
            </button>
          </div>
        </div>
      ))}

      {printingBooking && <ReceiptLines lines={[printingBooking]} outletName={outletName} />}
    </div>
  );
}
