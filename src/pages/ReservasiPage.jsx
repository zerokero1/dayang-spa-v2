import { useEffect, useState } from 'react';
import { OIL_SIZES, TREATMENT_CATEGORIES, treatmentUsesOil, oilChoicesFor, isSingleSizeProduct, SIZE_NONE } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { listenTreatments } from '../lib/treatmentService';
import { createReservation, listenReservations, checkInReservation, cancelReservation } from '../lib/reservationService';
import { openWhatsAppMessage, openWhatsAppToNumber, normalizeWaNumber } from '../lib/bookingService';

const OUTLET_NAME = {
  D1: 'Dayang 1', D2: 'Dayang 2', DP: 'Dayang Putri', DR: 'Dream', RR: 'Rere', Y: 'Yulis'
};

function tanggalPanjang(ms) {
  return new Date(ms).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Jam harus "12:00" dengan titik dua. Sebagian versi ICU menulis "12.00"
// untuk locale id-ID, dan PESAN WA jadi terlihat tidak rapi.
function jamSingkat(ms) {
  return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
}

/**
 * Isi pesan pengingat. Kalau nomor pelanggan ada, pesan dibuka langsung ke
 * nomor itu (kasir tidak perlu cari kontak); kalau tidak ada, WhatsApp dibuka
 * dan kasir memilih sendiri kontaknya.
 *
 * @param {object} r baris reservasi
 * @param {string} [t treatments] treatment yang sudah dipilih, untuk konfirmasi
 *        setelah reservasi diisi - sebelum itu yang tampil baru kategori
 * @returns {boolean} true kalau langsung ke nomor, false kalau kasir pilih kontak
 */
function kirimPengingatWa(r, treatment) {
  const jam = jamSingkat(r.scheduledAt);
  const lines = [
    `Halo ${r.customerName || ''}`.trim(),
    '',
    `Ini pengingat reservasi di Dayang Spa ${OUTLET_NAME[r.outletId] || r.outletId}.`,
    '',
    `Tanggal : ${tanggalPanjang(r.scheduledAt)}`,
    `Jam     : ${jam} WIB`,
    `Terapis : ${r.therapistName || '-'}`
  ];
  if (treatment) {
    lines.push(`Treatment: ${treatment.name} - Rp${Number(treatment.price || 0).toLocaleString('id-ID')}`);
  } else if (r.category || r.treatmentName) {
    lines.push(`Treatment: ${r.treatmentName || r.category}`);
  }
  lines.push(
    '',
    'Mohon datang 10 menit lebih awal. Mohon konfirmasi ya, terima kasih 🙏'
  );
  const message = lines.join('\n');
  return openWhatsAppToNumber(r.customerPhone, message) || (openWhatsAppMessage(message), false);
}

function formatSchedule(ms) {
  const d = new Date(ms);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tanggal = isToday ? 'Hari ini' : d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  return `${tanggal}, ${jam}`;
}

function countdownText(ms) {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Waktunya booking';
  const totalMin = Math.ceil(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}j ${m}m lagi` : `${m}m lagi`;
}

export default function ReservasiPage({ outletId, active }) {
  const [therapists, setTherapists] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [category, setCategory] = useState(TREATMENT_CATEGORIES[0]);
  const [selTherapist, setSelTherapist] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [therapistSearch, setTherapistSearch] = useState('');
  const [saved, setSaved] = useState(null);

  const [processTarget, setProcessTarget] = useState(null); // reservasi yang sedang diisi
  const [pCategory, setPCategory] = useState(TREATMENT_CATEGORIES[0]);
  const [pTreatment, setPTreatment] = useState(null);
  const [pOil, setPOil] = useState(null);
  const [pSize, setPSize] = useState(null);
  const [pSaving, setPSaving] = useState(false);

  useEffect(() => {
    if (!active) return;
    const unsub1 = listenAllTherapists(setTherapists);
    const unsub2 = listenTreatments(setTreatments);
    const unsub3 = listenReservations(outletId, setReservations);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [active, outletId]);

  const filteredTherapists = therapists.filter((t) => t.name.toLowerCase().includes(therapistSearch.toLowerCase()));
  const upcoming = reservations
    .filter((r) => r.status === 'terjadwal')
    .sort((a, b) => a.scheduledAt - b.scheduledAt);

  const canSave = category && scheduleDate && selTherapist;
  const nomorValid = normalizeWaNumber(customerPhone) !== '';

  async function handleSave(kirimWa) {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const tersimpan = await createReservation({
        outletId,
        therapistId: selTherapist.id,
        therapistName: selTherapist.name,
        category,
        customerName,
        customerPhone,
        scheduledAt: new Date(scheduleDate).toISOString()
      });
      setMessage(`Reservasi ${formatSchedule(tersimpan.scheduledAt)} tersimpan. Saat jamnya mendekat, isi treatment via "Isi Treatment".`);
      // Disimpan supaya halaman bisa menampilkan tombol kirim WA untuk reservasi
      // yang barusan dibuat, tanpa menunggu daftar ter-refresh.
      setSaved(tersimpan);
      if (kirimWa) {
        const langsung = kirimPengingatWa(tersimpan);
        if (!langsung && !nomorValid) {
          setMessage((m) => m + ' Nomor HP belum diisi, jadi pilih kontaknya manual.');
        }
      }
      setSelTherapist(null); setCustomerName(''); setCustomerPhone(''); setScheduleDate('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openProcess(r) {
    setProcessTarget(r);
    setPCategory(r.category || TREATMENT_CATEGORIES[0]);
    setPTreatment(null); setPOil(null); setPSize(null);
  }

  const pNeedsOil = treatmentUsesOil(pTreatment);
  const pCanSubmit = pTreatment && (!pNeedsOil || (pOil && pSize));

  async function handleProcessSave() {
    if (!pCanSubmit) return;
    setPSaving(true);
    setError('');
    try {
      await checkInReservation({
        outletId,
        reservation: processTarget,
        treatment: pTreatment,
        oilType: pOil,
        oilSize: pSize,
        usesOil: pNeedsOil
      });
      setMessage(`Booking ${processTarget.customerName || 'tamu'} dibuat — ${pTreatment.name}.`);
      // Simpan supaya kasir bisa mengirim konfirmasi akhir yang menyebut
      // treatment dan harganya, bukan cuma kategori.
      setSaved({ ...processTarget, treatmentName: pTreatment.name });
      setProcessTarget(null);
    } catch (e) {
      setError('Gagal membuat booking: ' + e.message);
    } finally {
      setPSaving(false);
    }
  }

  async function handleCancel(r) {
    if (!confirm(`Batalkan reservasi ${r.customerName || 'tamu ini'}?`)) return;
    try {
      await cancelReservation(outletId, r.id);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="kasir-page">
      <h2>Reservasi - {outletId}</h2>

      {upcoming.length > 0 && (
        <section>
          <p>Booking Mendatang ({upcoming.length})</p>
          {upcoming.map((r) => {
            const mins = Math.ceil((r.scheduledAt - Date.now()) / 60000);
            const close = r.scheduledAt > Date.now() && mins <= 15;
            return (
              <div key={r.id} className="oil-card" style={{ marginBottom: 8, textAlign: 'left', borderLeft: close ? '4px solid var(--busy)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }}>{formatSchedule(r.scheduledAt)}</strong>
                  {close && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--busy)' }}>{mins} menit lagi!</span>}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {r.therapistName} — <strong>{r.category || r.treatmentName || 'Kategori belum dipilih'}</strong>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {r.customerName || 'Tanpa nama'}{r.customerPhone ? ` · ${r.customerPhone}` : ''} · {countdownText(r.scheduledAt)}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--primary-dark)', color: '#fff' }} onClick={() => openProcess(r)}>
                    Isi Treatment
                  </button>
                  <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={() => kirimPengingatWa(r)}>
                    {normalizeWaNumber(r.customerPhone) ? '📱 Kirim WA' : '📱 Pilih kontak manual'}
                  </button>
                  <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--danger)', color: '#fff' }} onClick={() => handleCancel(r)}>
                    Batal
                  </button>
                </div>
                {!normalizeWaNumber(r.customerPhone) && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
                    Nomor HP belum ada, jadi WhatsApp akan terbuka tanpa penerima.
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section>
        <p>1. Pilih kategori treatment yang ingin dibook</p>
        <div className="grid-2">
          {TREATMENT_CATEGORIES.map((c) => (
            <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p>2. Pilih jam yang diinginkan tamu</p>
        <input type="datetime-local" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
      </section>

      <section>
        <p>3. Pilih terapis</p>
        <input placeholder="Cari nama terapis..." value={therapistSearch} onChange={(e) => setTherapistSearch(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="grid-2">
          {filteredTherapists.map((t) => (
            <button key={t.id} className={selTherapist?.id === t.id ? 'active' : ''} onClick={() => setSelTherapist(t)}>
              {t.name}
              {(t.status || 'free') === 'ambil_tamu' && <span style={{ fontSize: 11, color: 'var(--busy)' }}> 🔴</span>}
            </button>
          ))}
        </div>
      </section>

      <input placeholder="Nama pelanggan" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      <input
        placeholder="No. HP pelanggan (WA)"
        value={customerPhone}
        onChange={(e) => setCustomerPhone(e.target.value)}
        inputMode="tel"
      />
      {customerPhone.trim() && (
        <div style={{ fontSize: 11, color: nomorValid ? 'var(--success)' : 'var(--warning)', marginTop: -6 }}>
          {nomorValid
            ? `Akan dikirim ke wa.me/${normalizeWaNumber(customerPhone)}`
            : 'Nomor belum lengkap / tidak dikenali sebagai nomor Indonesia.'}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {message && <p style={{ fontSize: 13 }}>{message}</p>}

      {saved && (
        <div className="oil-card" style={{ marginTop: 10, textAlign: 'left', borderLeft: '4px solid var(--success)' }}>
          <strong style={{ fontSize: 13 }}>
            Tersimpan: {formatSchedule(saved.scheduledAt)} — {saved.customerName || 'tamu'}
          </strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {saved.therapistName} · {OUTLET_NAME[saved.outletId] || saved.outletId}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none' }} onClick={() => kirimPengingatWa(saved)}>
              📱 Kirim pengingat WA
            </button>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)', color: '#fff' }} onClick={() => setSaved(null)}>
              Tutup
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={!canSave || saving} onClick={() => handleSave(true)} style={{ flex: 2 }}>
          {saving ? 'Menyimpan...' : 'Simpan & kirim pengingat WA'}
        </button>
        <button disabled={!canSave || saving} onClick={() => handleSave(false)} style={{ flex: 1 }}>
          Simpan saja
        </button>
      </div>

      {processTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div className="oil-card" style={{ maxWidth: 420, width: '100%', maxHeight: '88vh', overflowY: 'auto', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong style={{ fontSize: 14 }}>Isi Treatment — {processTarget.customerName || 'Tamu'}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {processTarget.therapistName} · {formatSchedule(processTarget.scheduledAt)}
                </div>
              </div>
              <button style={{ width: 'auto', padding: '4px 10px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)', color: '#fff' }} onClick={() => setProcessTarget(null)}>✕</button>
            </div>

            <p style={{ marginBottom: 6 }}>Kategori</p>
            <div className="grid-2">
              {TREATMENT_CATEGORIES.map((c) => (
                <button key={c} className={pCategory === c ? 'active' : ''} onClick={() => { setPCategory(c); setPTreatment(null); }}>
                  {c}
                </button>
              ))}
            </div>

            {pCategory && (
              <>
                <p style={{ marginBottom: 6 }}>Treatment</p>
                <div className="grid-2">
                  {treatments.filter((t) => t.category === pCategory).length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada treatment untuk kategori ini.</p>
                  ) : (
                    treatments.filter((t) => t.category === pCategory).map((t) => (
                      <button key={t.id} className={pTreatment?.id === t.id ? 'active' : ''} onClick={() => { setPTreatment(t); setPOil(null); setPSize(null); }}>
                        {t.name} - Rp{t.price?.toLocaleString('id-ID')}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {pNeedsOil && (
              <>
                <p style={{ marginBottom: 6 }}>Pilih minyak & ukuran</p>
                <div className="grid-2">
                  {oilChoicesFor(pTreatment).map((oil) => (
                    <div key={oil} className="oil-card" style={{ margin: 0 }}>
                      <div>{oil}</div>
                      {isSingleSizeProduct(oil) ? (
                        <button
                          className={pOil === oil ? 'active' : ''}
                          onClick={() => { setPOil(oil); setPSize(SIZE_NONE); }}
                          style={{ width: '100%' }}
                        >
                          Pakai
                        </button>
                      ) : (
                        <div className="row">
                          {OIL_SIZES.map((size) => (
                            <button key={size} className={pOil === oil && pSize === size ? 'active' : ''} onClick={() => { setPOil(oil); setPSize(size); }}>
                              {size}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button disabled={!pCanSubmit || pSaving} onClick={handleProcessSave} style={{ flex: 1 }}>
                {pSaving ? 'Membuat booking...' : 'Buat Booking & Selesai Reservasi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}