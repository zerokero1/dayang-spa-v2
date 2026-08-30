import { useEffect, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { getDailyBookings } from '../lib/reportService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayId() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ReceiptContent({ booking, outletName }) {
  return (
    <div className="receipt-print">
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>DAYANG SPA</strong>
        <div style={{ fontSize: 10 }}>{outletName}</div>
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
      <div style={{ fontSize: 10 }}>
        <div>Tanggal: {formatDateTime(booking.startAt)}</div>
        <div>Pelanggan: {booking.customerName || '-'}</div>
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
      <div style={{ fontSize: 10 }}>
        <div>{booking.treatmentName}</div>
        <div>Terapis: {booking.therapistName}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span>Harga</span>
          <span>{rp(booking.treatmentPrice)}</span>
        </div>
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 12 }}>
        <span>TOTAL</span>
        <span>{rp(booking.treatmentPrice)}</span>
      </div>
      <div style={{ fontSize: 10, marginTop: 4 }}>
        <div>Metode: {booking.paymentMethod === 'cardless' ? 'Cardless' : 'Cash'}</div>
        <div>Status: {booking.paid ? 'LUNAS' : 'BELUM BAYAR'}</div>
      </div>
      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
      <div style={{ textAlign: 'center', fontSize: 10, marginTop: 8 }}>
        Terima kasih atas kunjungan Anda
      </div>
    </div>
  );
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

      {printingBooking && <ReceiptContent booking={printingBooking} outletName={outletName} />}
    </div>
  );
}
