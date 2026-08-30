import { useEffect, useState } from 'react';
import { OIL_TYPES, OIL_SIZES, TREATMENT_CATEGORIES, treatmentUsesOil } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { listenTreatments } from '../lib/treatmentService';
import { createReservation, listenReservations, checkInReservation, cancelReservation } from '../lib/reservationService';
import { openWhatsAppMessage } from '../lib/bookingService';

function toWhatsAppReminder(r) {
  const d = new Date(r.scheduledAt);
  const tanggal = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const message =
    `Reservasi baru\n` +
    `Pelanggan: ${r.customerName || '-'}\n` +
    `Terapis: ${r.therapistName}\n` +
    `Treatment: ${r.treatmentName}\n` +
    `Jadwal: ${tanggal}, ${jam}`;
  openWhatsAppMessage(message);
}

function formatSchedule(ms) {
  const d = new Date(ms);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tanggal = isToday ? 'Hari ini' : d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${tanggal}, ${jam}`;
}

export default function ReservasiPage({ outletId, active }) {
  const [therapists, setTherapists] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [category, setCategory] = useState(TREATMENT_CATEGORIES[0]);
  const [selTherapist, setSelTherapist] = useState(null);
  const [selTreatment, setSelTreatment] = useState(null);
  const [selOil, setSelOil] = useState(null);
  const [selSize, setSelSize] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [therapistSearch, setTherapistSearch] = useState('');
  const [treatmentSearch, setTreatmentSearch] = useState('');

  useEffect(() => {
    if (!active) return;
    const unsub1 = listenAllTherapists(setTherapists);
    const unsub2 = listenTreatments(setTreatments);
    const unsub3 = listenReservations(outletId, setReservations);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [active, outletId]);

  const usesOil = (t) => treatmentUsesOil(t);
  const lineNeedsOil = usesOil(selTreatment);
  const canSave = selTherapist && selTreatment && (!lineNeedsOil || (selOil && selSize)) && scheduleDate;
  const treatmentsInCategory = treatments
    .filter((t) => t.category === category)
    .filter((t) => t.name.toLowerCase().includes(treatmentSearch.toLowerCase()));
  const filteredTherapists = therapists.filter((t) => t.name.toLowerCase().includes(therapistSearch.toLowerCase()));
  const upcoming = reservations.filter((r) => r.status === 'terjadwal');

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await createReservation({
        outletId,
        therapistId: selTherapist.id,
        therapistName: selTherapist.name,
        treatmentId: selTreatment.id,
        treatmentName: selTreatment.name,
        treatmentPrice: selTreatment.price,
        commissionPercent: selTreatment.commissionPercent,
        durationMinutes: selTreatment.durationMinutes,
        usesOil: lineNeedsOil,
        oilType: lineNeedsOil ? selOil : null,
        oilSize: lineNeedsOil ? selSize : null,
        customerName,
        customerPhone,
        scheduledAt: new Date(scheduleDate).getTime()
      });
      setMessage('Reservasi tersimpan.');
      setSelTherapist(null); setSelTreatment(null); setSelOil(null); setSelSize(null);
      setCustomerName(''); setCustomerPhone(''); setScheduleDate('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCheckIn(r) {
    try {
      await checkInReservation(outletId, r);
      setMessage(`${r.customerName || 'Tamu'} check-in, treatment dimulai.`);
    } catch (e) {
      setMessage('Gagal check-in: ' + e.message);
    }
  }

  async function handleCancel(r) {
    if (!confirm(`Batalkan reservasi ${r.customerName || 'tamu ini'}?`)) return;
    await cancelReservation(outletId, r.id);
  }

  return (
    <div className="kasir-page">
      <h2>Reservasi - {outletId}</h2>

      {upcoming.length > 0 && (
        <section>
          <p>Jadwal Mendatang ({upcoming.length})</p>
          {upcoming.map((r) => (
            <div key={r.id} className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 13 }}>{formatSchedule(r.scheduledAt)}</strong>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {r.therapistName} — {r.treatmentName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {r.customerName || 'Tanpa nama'}{r.customerPhone ? ` · ${r.customerPhone}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={() => handleCheckIn(r)}>
                  Check-in
                </button>
                <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={() => toWhatsAppReminder(r)}>
                  Kirim pengingat WA
                </button>
                <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--danger)' }} onClick={() => handleCancel(r)}>
                  Batal
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <p>Buat reservasi baru</p>
        <input
          type="datetime-local"
          value={scheduleDate}
          onChange={(e) => setScheduleDate(e.target.value)}
        />
      </section>

      <section>
        <p>Pilih terapis</p>
        <input placeholder="Cari nama terapis..." value={therapistSearch} onChange={(e) => setTherapistSearch(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="grid-2">
          {filteredTherapists.map((t) => (
            <button
              key={t.id}
              className={selTherapist?.id === t.id ? 'active' : ''}
              onClick={() => setSelTherapist(t)}
            >
              {t.name}{t.homeOutletId ? ` (${t.homeOutletId})` : ''}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p>Pilih kategori treatment</p>
        <div className="grid-2">
          {TREATMENT_CATEGORIES.map((c) => (
            <button
              key={c}
              className={category === c ? 'active' : ''}
              onClick={() => { setCategory(c); setSelTreatment(null); }}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p>Pilih treatment</p>
        <input placeholder="Cari treatment..." value={treatmentSearch} onChange={(e) => setTreatmentSearch(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="grid-2">
          {treatmentsInCategory.map((t) => (
            <button
              key={t.id}
              className={selTreatment?.id === t.id ? 'active' : ''}
              onClick={() => setSelTreatment(t)}
            >
              {t.name} - Rp{t.price?.toLocaleString('id-ID')}
            </button>
          ))}
        </div>
      </section>

      {lineNeedsOil && (
      <section>
        <p>Pilih minyak & ukuran</p>
        <div className="grid-2">
          {OIL_TYPES.map((oil) => (
            <div key={oil} className="oil-card">
              <div>{oil}</div>
              <div className="row">
                {OIL_SIZES.map((size) => (
                  <button
                    key={size}
                    className={selOil === oil && selSize === size ? 'active' : ''}
                    onClick={() => { setSelOil(oil); setSelSize(size); }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      <input
        placeholder="Nama pelanggan"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
      />
      <input
        placeholder="No. HP pelanggan (opsional)"
        value={customerPhone}
        onChange={(e) => setCustomerPhone(e.target.value)}
      />

      {error && <p className="error">{error}</p>}
      {message && <p style={{ fontSize: 13 }}>{message}</p>}

      <button disabled={!canSave || saving} onClick={handleSave}>
        {saving ? 'Menyimpan...' : 'Simpan reservasi'}
      </button>
    </div>
  );
}
