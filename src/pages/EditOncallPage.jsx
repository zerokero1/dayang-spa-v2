import { useEffect, useState } from 'react';
import { OUTLETS, PAYMENT_METHOD_LABEL, DEFAULT_ONCALL_COMMISSION_PCT } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { editOncallBooking, getOncallRange } from '../lib/oncallService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

const OUTLET_NAME = Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));

// Maksimal rentang yang boleh dimuat sekaligus. Tanpa batas ini office bisa
// menarik ribuan baris hanya untuk mengoreksi satu transaksi.
const MAX_DAYS = 92;

function todayId() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function daysAgoId(n) {
  return new Date(Date.now() + 7 * 3600000 - n * 24 * 3600000).toISOString().slice(0, 10);
}

/** Tanggal + jam WIB dari kolom timestamptz. */
function fmtWib(iso) {
  if (!iso) return '-';
  const d = new Date(new Date(iso).getTime() + 7 * 3600000);
  const tgl = d.toISOString().slice(0, 10);
  const jam = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${tgl} ${jam}`;
}

// Mirip RPC edit_oncall_booking:
//   commission_amount = round(pct/100 * (price - hotel_commission))
// Penting ikut ditampilkan supaya office tahu efeknya ke laporan komisi
// sebelum menekan Simpan.
function hitungKomisi(pct, price, hotelComm) {
  const p = Number(pct) || 0;
  const h = Number(hotelComm) || 0;
  const n = Number(price) || 0;
  if (n <= h) return 0;
  return Math.round((p / 100) * (n - h));
}

function EditOncallForm({ booking, therapists, onSaved, onCancel }) {
  const pctAsli = booking.commissionPercent != null && booking.commissionPercent > 0
    ? booking.commissionPercent
    : DEFAULT_ONCALL_COMMISSION_PCT;
  const [therapistId, setTherapistId] = useState(booking.therapistId || '');
  const [packageName, setPackageName] = useState(booking.treatmentName || '');
  const [duration, setDuration] = useState(String(booking.durationMinutes ?? ''));
  const [price, setPrice] = useState(String(booking.treatmentPrice ?? ''));
  const [hotelComm, setHotelComm] = useState(String(booking.hotelCommission ?? ''));
  const [customerName, setCustomerName] = useState(booking.customerName || '');
  const [method, setMethod] = useState(
    Object.keys(PAYMENT_METHOD_LABEL).includes(booking.paymentMethod) ? booking.paymentMethod : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const harga = Number(price) || 0;
  const komisiHotel = Number(hotelComm) || 0;
  const komisiBaru = hitungKomisi(pctAsli, harga, komisiHotel);
  const berubah =
    harga !== (booking.treatmentPrice || 0) || komisiHotel !== (booking.hotelCommission || 0);

  async function handleSave() {
    if (!therapistId) { setError('Terapis wajib dipilih.'); return; }
    if (!packageName.trim()) { setError('Nama paket wajib diisi.'); return; }
    if (!customerName.trim()) { setError('Nama tamu / hotel wajib diisi.'); return; }
    if (!method) { setError('Metode pembayaran wajib dipilih.'); return; }
    if (harga <= 0) { setError('Harga harus lebih dari 0.'); return; }
    if (komisiHotel > harga) {
      setError('Komisi hotel tidak boleh lebih besar dari harga (komisi terapis jadi 0).');
      return;
    }
    const th = therapists.find((t) => t.id === therapistId);
    setSaving(true);
    setError('');
    try {
      await editOncallBooking({
        bookingId: booking.id,
        therapistId,
        therapistName: th ? th.name : booking.therapistName,
        packageName: packageName.trim(),
        durationMinutes: Math.round(Number(duration) || 0),
        price: harga,
        commissionPercent: pctAsli,
        hotelCommission: komisiHotel,
        customerName: customerName.trim(),
        paymentMethod: method
      });
      onSaved();
    } catch (e) {
      setError(e.message || 'Gagal menyimpan perubahan oncall.');
      setSaving(false);
    }
  }

  return (
    <div className="oil-card koreksi-item">
      <div className="koreksi-item-name">Koreksi oncall</div>
      <div className="koreksi-item-meta">
        Dibuat {fmtWib(booking.createdAt)} WIB · {OUTLET_NAME[booking.outletId] || booking.outletId || '-'}
      </div>

      {booking.status === 'batal' && (
        <p className="error" style={{ marginTop: 8 }}>
          Transaksi ini berstatus BATAL. Angka hasil koreksi tidak dihitung di laporan mana pun.
        </p>
      )}

      <p className="koreksi-label">Terapis</p>
      <select value={therapistId} onChange={(e) => setTherapistId(e.target.value)}>
        <option value="">Pilih terapis…</option>
        {therapists.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}{t.homeOutletId ? ` · ${OUTLET_NAME[t.homeOutletId] || t.homeOutletId}` : ''}
          </option>
        ))}
      </select>
      {therapistId === '' && booking.therapistName && (
        <p className="muted" style={{ fontSize: 12 }}>
          Terapis lama &quot;{booking.therapistName}&quot; tidak ada di daftar — pilih terapis lain.
        </p>
      )}

      <p className="koreksi-label">Nama paket</p>
      <input type="text" value={packageName} onChange={(e) => setPackageName(e.target.value)} />

      <p className="koreksi-label">Durasi (menit)</p>
      <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />

      <div className="grid-2" style={{ marginTop: 8 }}>
        <div>
          <p className="koreksi-label">Harga (Rp)</p>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <p className="koreksi-label">Komisi hotel (Rp)</p>
          <input type="number" value={hotelComm} onChange={(e) => setHotelComm(e.target.value)} />
        </div>
      </div>

      <p className="koreksi-label">Nama tamu / hotel</p>
      <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />

      <p className="koreksi-label">Metode pembayaran</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.entries(PAYMENT_METHOD_LABEL).map(([val, label]) => (
          <button
            key={val}
            type="button"
            className={method === val ? 'pos-chip active' : 'pos-chip'}
            onClick={() => setMethod(val)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="koreksi-label" style={{ marginTop: 12 }}>
        Dampak ke laporan
      </p>
      <div className="koreksi-item-meta">
        Komisi terapis {pctAsli}% dari (harga − komisi hotel) = <strong>{rp(komisiBaru)}</strong>
        {berubah && (
          <>
            {' '}(sebelumnya {rp(booking.commissionAmount)})
          </>
        )}
      </div>
      {komisiBaru !== (booking.commissionAmount || 0) && (
        <p className="muted" style={{ fontSize: 12 }}>
          Angka komisi di Laporan Keseluruhan sheet Komisi dan Laporan Keuangan ikut berubah mengikuti ini.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="koreksi-item-actions">
        <button className="koreksi-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
        <button className="btn-secondary" onClick={onCancel} disabled={saving}>
          Batal
        </button>
      </div>
    </div>
  );
}

export default function EditOncallPage({ active, isOffice }) {
  const [startDate, setStartDate] = useState(daysAgoId(30));
  const [endDate, setEndDate] = useState(todayId());
  const [outletId, setOutletId] = useState('semua');
  const [list, setList] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = listenAllTherapists(setTherapists);
    return () => unsub();
  }, []);

  async function load() {
    if (!startDate || !endDate) { setError('Isi tanggal awal dan akhir.'); return; }
    if (endDate < startDate) { setError('Tanggal akhir tidak boleh lebih awal dari tanggal awal.'); return; }
    const span = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
    if (span > MAX_DAYS) {
      setError(`Rentang ${span} hari terlalu luas. Maksimal ${MAX_DAYS} hari per muat — perkecil rangenya.`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setList(await getOncallRange(outletId === 'semua' ? null : outletId, startDate, endDate));
    } catch (e) {
      setError('Gagal memuat data oncall: ' + (e.message || e));
      setList([]);
    } finally {
      setLoading(false);
    }
  }

  // Muat otomatis saat halaman dibuka supaya office tidak harus klik dulu.
  useEffect(() => {
    if (active === false) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!isOffice) {
    return (
      <div className="kasir-page">
        <h2>Koreksi Oncall</h2>
        <p>Halaman ini hanya tersedia untuk akun Office.</p>
      </div>
    );
  }

  const totalHarga = list.reduce((s, b) => s + (b.treatmentPrice || 0), 0);
  const totalKomisi = list.reduce((s, b) => s + (b.commissionAmount || 0), 0);
  const aktif = list.filter((b) => b.status !== 'batal');

  return (
    <div className="kasir-page koreksi-page">
      <h2>Koreksi Oncall</h2>
      <p className="koreksi-intro">
        Koreksi transaksi oncall tanggal berapapun (khusus Office). OncallPage hanya menampilkan
        transaksi hari ini, jadi transaksi yang tercatat salah tanggal bisa diperbaiki di sini.
      </p>

      <section>
        <p>Outlet</p>
        <div className="grid-2">
          <button className={outletId === 'semua' ? 'active' : ''} onClick={() => setOutletId('semua')}>
            Semua outlet
          </button>
          {OUTLETS.map((o) => (
            <button key={o.id} className={outletId === o.id ? 'active' : ''} onClick={() => setOutletId(o.id)}>
              {o.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p>Rentang tanggal</p>
        <div className="grid-2">
          <label style={{ fontSize: 12 }}>
            Dari
            <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label style={{ fontSize: 12 }}>
            Sampai
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={() => { setStartDate(daysAgoId(7)); setEndDate(todayId()); }}>
            7 hari
          </button>
          <button onClick={() => { setStartDate(daysAgoId(30)); setEndDate(todayId()); }}>
            30 hari
          </button>
          <button onClick={() => { setStartDate(daysAgoId(90)); setEndDate(todayId()); }}>
            90 hari
          </button>
        </div>
      </section>

      <button onClick={load} disabled={loading}>
        {loading ? 'Memuat...' : 'Tampilkan oncall'}
      </button>

      {message && <p className="koreksi-message">{message}</p>}
      {error && <p className="error">{error}</p>}

      {!loading && list.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          {list.length} transaksi ({aktif.length} aktif) · total harga {rp(totalHarga)} · total komisi terapis {rp(totalKomisi)}
        </p>
      )}

      {!loading && list.length === 0 && !error && (
        <p className="koreksi-empty">Tidak ada transaksi oncall pada rentang ini.</p>
      )}

      {list.map((b, i) => (
        <div key={b.id}>
          {editingId === b.id ? (
            <EditOncallForm
              booking={b}
              therapists={therapists}
              onCancel={() => setEditingId(null)}
              onSaved={async () => {
                setEditingId(null);
                setMessage(`Oncall ${b.therapistName} (${fmtWib(b.createdAt)}) berhasil dikoreksi.`);
                await load();
                setTimeout(() => setMessage(''), 4000);
              }}
            />
          ) : (
            <div className="oil-card koreksi-item" style={b.status === 'batal' ? { opacity: 0.6 } : undefined}>
              <strong className="koreksi-item-name">
                {i + 1}. {b.treatmentName}
              </strong>
              <span className="koreksi-item-outlet">
                ({OUTLET_NAME[b.outletId] || b.outletId || '-'})
              </span>
              <div className="koreksi-item-meta">
                {fmtWib(b.createdAt)} WIB · {b.therapistName} · {b.customerName || '-'} ·{' '}
                {PAYMENT_METHOD_LABEL[b.paymentMethod] || '-'} · {b.durationMinutes || 0} mnt
              </div>
              <div className="koreksi-item-meta">
                {rp(b.treatmentPrice)} · komisi hotel {rp(b.hotelCommission)} · komisi terapis{' '}
                {b.commissionPercent || 0}% ({rp(b.commissionAmount)})
                {b.status === 'batal' ? ' · BATAL' : ''}
              </div>
              <div className="koreksi-item-actions">
                <button className="koreksi-btn" onClick={() => setEditingId(b.id)}>
                  Koreksi
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}