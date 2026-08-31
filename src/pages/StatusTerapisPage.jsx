import { useEffect, useState } from 'react';
import { listenAllTherapists, setTherapistStatusManual } from '../lib/therapistService';
import { THERAPIST_STATUS, OUTLETS, OIL_TYPES, OIL_SIZES, PAYMENT_METHOD_LABEL, treatmentUsesOil } from '../lib/constants';
import { completeBooking, cancelBookingFull, cancelBookingPartial, markBookingPaid, continueTreatment, completeBookingGroup, markGroupPaid, openWhatsAppMessage } from '../lib/bookingService';
import { listenTreatments } from '../lib/treatmentService';
import { getTherapistDailyReport } from '../lib/reportService';
import { getShiftWindowStatus, SHIFT_WINDOW_LABEL } from '../lib/shiftService';
import { SHIFT_LABEL, SHIFT_SHORT_CODE } from '../lib/constants';

const STATUS_LABEL = { free: 'Free', libur: 'Libur', ambil_tamu: 'Ambil Tamu', break: 'Break' };
const OUTLET_NAME = Object.fromEntries(OUTLETS.map((o) => [o.id, o.name]));

function todayId() {
  // Tanggal LOKAL WIB (UTC+7) — bukan UTC, agar konsisten dengan getDailyBookings
  const now = new Date(Date.now() + 7 * 3600000); // geser ke WIB
  return now.toISOString().slice(0, 10);
}

function formatCountdown(endAt) {
  const diffMs = endAt - Date.now();
  if (diffMs <= 0) return 'Selesai';
  const totalMin = Math.ceil(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}j ${m}m lagi` : `${m}m lagi`;
}

function formatClock(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

/** Semua booking id milik satu terapis (mendukung 1 terapis = beberapa treatment). */
function bookingIdsOf(t) {
  if (Array.isArray(t.currentBookingIds) && t.currentBookingIds.length) return t.currentBookingIds;
  return t.currentBookingId ? [t.currentBookingId] : [];
}

/** Susun teks daftar lengkap (mirip format manual: dikelompokkan per outlet
 *  ASAL terapis, menampilkan semua terapis dengan kode shift & komisi hari
 *  ini, ditandai ❌jam kalau sedang ambil tamu, yang libur dicoret di bawah)
 *  lalu buka WhatsApp siap kirim. */
function buildAndSendTherapistList({ therapists, dailyCommissions }) {
  const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let text = `LIST TERAPIS ${today}\n`;

  const offList = therapists.filter((t) => t.status === 'libur');
  const activeList = therapists.filter((t) => t.status !== 'libur');

  OUTLETS.forEach((o) => {
    const list = activeList.filter((t) => t.homeOutletId === o.id);
    if (list.length === 0) return;
    text += `\n${o.name.toUpperCase()}\n`;
    list.forEach((t, i) => {
      const shiftCode = t.shift ? SHIFT_SHORT_CODE[t.shift] : '';
      const commission = dailyCommissions[t.id] ? Math.round(dailyCommissions[t.id] / 1000) : '';
      const busy = (t.status || 'free') === 'ambil_tamu';
      const busyMark = busy ? ` ❌${commission} • ${formatClock(t.endAt)}` : '';
      const tail = busy ? busyMark : (commission !== '' ? ` ${commission}` : '');
      text += `${i + 1}. ${t.name} ${shiftCode}${tail}\n`;
    });
  });

  // Terapis tanpa outlet asal (belum diatur di Kelola Terapis)
  const noHome = activeList.filter((t) => !t.homeOutletId);
  if (noHome.length > 0) {
    text += `\nBELUM ADA OUTLET\n`;
    noHome.forEach((t, i) => { text += `${i + 1}. ${t.name}\n`; });
  }

  if (offList.length > 0) {
    text += `\nOff\n`;
    offList.forEach((t) => { text += `~${t.name}~\n`; });
  }

  openWhatsAppMessage(text);
}

function TherapistCard({ t, dailyTotal, onManualStatus, onSelesai, onBatalPenuh, onBatalSebagian, onTandaiLunas, onContinue }) {
  const status = t.status || 'free';
  const busy = status === 'ambil_tamu';
  const multi = busy && bookingIdsOf(t).length > 1;
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountPrice, setDiscountPrice] = useState('');
  const [partialIdx, setPartialIdx] = useState(0);
  const [showPartial, setShowPartial] = useState(false);

  function submitDiscount() {
    const num = Number(discountPrice);
    if (isNaN(num) || num < 0) return;
    onBatalSebagian(t, num, partialIdx);
    setShowDiscount(false);
    setDiscountPrice('');
    setShowPartial(false);
  }

  const pNames = multi ? (t.currentTreatmentNames || []) : [];
  const pIds = bookingIdsOf(t);

  return (
    <div
      className="oil-card"
      style={{
        marginBottom: 8, textAlign: 'left',
        borderLeft: `4px solid ${busy ? 'var(--primary)' : status === 'free' ? '#9CA88F' : 'var(--busy)'}`
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 14 }}>{t.name}{t.homeOutletId ? ` (${t.homeOutletId})` : ''}</strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
            {t.role || '-'}{dailyTotal ? ` · Hari ini ${rp(dailyTotal)}` : ''}
          </div>
          {t.shift && (() => {
            const win = getShiftWindowStatus(t.shift);
            return (
              <div style={{ fontSize: 11, color: win === 'jeda' ? 'var(--busy)' : 'var(--text-secondary)', fontWeight: win === 'jeda' ? 600 : 400 }}>
                {SHIFT_LABEL[t.shift]} · {SHIFT_WINDOW_LABEL[win]}
              </div>
            );
          })()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
            background: busy ? 'var(--primary)' : status === 'free' ? 'var(--primary-light)' : 'var(--busy-bg)',
            color: busy ? 'white' : status === 'free' ? 'var(--primary-dark)' : 'var(--busy)'
          }}>
            {STATUS_LABEL[status]}
          </span>
          {busy && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
              background: t.currentPaid ? 'var(--primary-light)' : 'var(--busy-bg)',
              color: t.currentPaid ? 'var(--primary-dark)' : 'var(--busy)'
            }}>
              {t.currentPaid ? 'Lunas' : 'Belum Bayar'}
            </span>
          )}
        </div>
      </div>

      {busy && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
          <div>
            {multi && (t.currentTreatmentNames || []).length > 0 ? (
              (t.currentTreatmentNames || []).map((n) => <div key={n}>• {n}</div>)
            ) : (
              <div>{t.currentTreatmentName}</div>
            )}
          </div>
          <div>Mulai {formatClock(t.startAt)} — Selesai {formatClock(t.endAt)}</div>
          <div style={{ fontWeight: 700, color: 'var(--primary)', marginTop: 4 }}>{formatCountdown(t.endAt)}</div>

          {!t.currentPaid && (
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 10,
              background: 'var(--busy-bg)', border: '1px solid var(--busy)'
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--busy)', letterSpacing: 0.5 }}>BELUM BAYAR</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--danger)', margin: '2px 0 8px' }}>
                {rp(t.currentPrice)}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Terima pembayaran:</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ width: 'auto', flex: 1, padding: '10px 8px', fontSize: 13, boxShadow: 'none', background: 'var(--primary-dark)' }} onClick={() => onTandaiLunas(t, 'cash')}>
                  Lunas Cash
                </button>
                <button style={{ width: 'auto', flex: 1, padding: '10px 8px', fontSize: 13, boxShadow: 'none', background: 'var(--primary-dark)' }} onClick={() => onTandaiLunas(t, 'cardless')}>
                  Lunas Cardless
                </button>
              </div>
            </div>
          )}
          {t.currentPaid && t.currentPaymentMethod && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center', marginTop: 8 }}>
              ✓ Dibayar via {PAYMENT_METHOD_LABEL[t.currentPaymentMethod]}
            </span>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            <button style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none' }} onClick={() => onSelesai(t)}>
              Tandai selesai
            </button>
            <button style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none', background: 'var(--primary)' }} onClick={() => onContinue(t)}>
              + Lanjutkan treatment
            </button>
            {multi ? (
              <button style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none', background: 'var(--busy)' }} onClick={() => setShowPartial((v) => !v)}>
                Batal sebagian
              </button>
            ) : (
              <button style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none', background: 'var(--busy)' }} onClick={() => { setShowDiscount((v) => !v); setShowPartial(false); }}>
                Batal + potongan harga
              </button>
            )}
            <button style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none', background: 'var(--danger)' }}
              onClick={() => { if (confirm(`Batalkan ${multi ? `semua ${bookingIdsOf(t).length} treatment` : `booking ${t.name}`} sepenuhnya? Stok minyak akan dikembalikan.`)) onBatalPenuh(t); }}>
              Batalkan penuh
            </button>
          </div>

          {showPartial && multi && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Pilih treatment yang dibatalkan & potong harga:</div>
              {pNames.map((n, i) => (
                <button
                  key={i}
                  className={partialIdx === i ? 'active' : ''}
                  onClick={() => { setPartialIdx(i); setShowDiscount(true); }}
                  style={{ fontSize: 12, marginRight: 6, marginBottom: 6, padding: '6px 10px', width: 'auto', boxShadow: 'none' }}
                >
                  {i + 1}. {n}
                </button>
              ))}
            </div>
          )}

          {showDiscount && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <input type="number" placeholder="Harga baru (Rp)" value={discountPrice}
                onChange={(e) => setDiscountPrice(e.target.value)} style={{ margin: 0, flex: 1 }} />
              <button style={{ width: 'auto', padding: '10px 14px', boxShadow: 'none' }} onClick={submitDiscount}>
                {multi ? `Simpan $${partialIdx + 1}` : 'Simpan'}
              </button>
            </div>
          )}
        </div>
      )}

      {!busy && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
          {Object.values(THERAPIST_STATUS).filter((s) => s !== 'ambil_tamu').map((s) => (
            <button key={s} style={{ fontSize: 12, padding: '6px 12px', width: 'auto', boxShadow: 'none', fontWeight: 500 }}
              className={status === s ? 'active' : ''} onClick={() => onManualStatus(t.id, s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({ members, onCompleteGroup, onPayGroup, cardProps }) {
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = members.reduce((sum, m) => sum + (m.currentPrice || 0), 0);
  const allPaid = members.every((m) => m.currentPaid);
  const earliestEnd = Math.min(...members.map((m) => m.endAt || Infinity));

  async function handlePay(method) {
    setBusy(true);
    try { await onPayGroup(members, method); } finally { setBusy(false); }
  }
  async function handleComplete() {
    setBusy(true);
    try { await onCompleteGroup(members); } finally { setBusy(false); }
  }

  return (
    <div className="oil-card" style={{ marginBottom: 10, textAlign: 'left', borderLeft: '4px solid var(--primary)', background: 'var(--primary-light)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <strong style={{ fontSize: 14 }}>Grup Massage ({members.length} orang)</strong>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Selesai ~{formatClock(earliestEnd)}</span>
      </div>

      {members.map((m) => (
        <div key={m.id} style={{ fontSize: 13, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>{m.name} — {m.currentTreatmentName}</span>
          <span>{rp(m.currentPrice)}</span>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <span>Total Grup</span>
        <span>{rp(total)}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {!allPaid && (
          <>
            <button disabled={busy} style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none', background: 'var(--primary-dark)' }} onClick={() => handlePay('cash')}>
              Lunas Semua (Cash)
            </button>
            <button disabled={busy} style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none', background: 'var(--primary-dark)' }} onClick={() => handlePay('cardless')}>
              Lunas Semua (Cardless)
            </button>
          </>
        )}
        {allPaid && <span style={{ fontSize: 12, color: 'var(--primary-dark)', alignSelf: 'center', fontWeight: 600 }}>✓ Semua sudah lunas</span>}
        <button disabled={busy} style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none' }} onClick={handleComplete}>
          Selesaikan Semua (1 Klik)
        </button>
        <button style={{ width: 'auto', padding: '8px 14px', fontSize: 13, boxShadow: 'none', background: 'var(--text-secondary)' }} onClick={() => setShowDetail((v) => !v)}>
          {showDetail ? 'Sembunyikan detail' : 'Detail per orang'}
        </button>
      </div>

      {showDetail && (
        <div style={{ marginTop: 10 }}>
          {members.map((m) => (
            <TherapistCard key={m.id} t={m} dailyTotal={null} {...cardProps} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StatusTerapisPage({ active }) {
  const [therapists, setTherapists] = useState([]);
  const [dailyTotals, setDailyTotals] = useState({});
  const [dailyCommissions, setDailyCommissions] = useState({});
  const [, setTick] = useState(0);
  const [message, setMessage] = useState('');
  const [outletFilter, setOutletFilter] = useState('semua');

  const [treatments, setTreatments] = useState([]);
  const [continueTarget, setContinueTarget] = useState(null);
  const [cTreatment, setCTreatment] = useState(null);
  const [cOil, setCOil] = useState(null);
  const [cSize, setCSize] = useState(null);
  const [cPaid, setCPaid] = useState(false);
  const [cMethod, setCMethod] = useState('cash');
  const [cSaving, setCSaving] = useState(false);

  useEffect(() => {
    if (!active) return;
    return listenAllTherapists(setTherapists);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    return listenTreatments(setTreatments);
  }, [active]);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Refresh total harga & komisi hari ini — di-DEBOUNCE (jeda 2.5 detik setelah
  // perubahan terakhir) supaya tidak memicu banyak query saat daftar terapis
  // berubah cepat (pemboros kuota). Hanya berjalan saat halaman terlihat (active).
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      getTherapistDailyReport(todayId())
        .then(({ totals, commissions }) => {
          setDailyTotals(totals);
          setDailyCommissions(commissions);
        })
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, [therapists, active]);

  async function handleManualStatus(therapistId, status) {
    await setTherapistStatusManual(therapistId, status);
  }
  async function handleSelesai(t) {
    if (!t.currentOutletId) return;
    for (const bId of bookingIdsOf(t)) {
      await completeBooking(t.currentOutletId, bId, t.id);
    }
  }
  async function handleBatalPenuh(t) {
    if (!t.currentOutletId) return;
    try {
      for (const bId of bookingIdsOf(t)) {
        await cancelBookingFull(t.currentOutletId, bId, t.id);
      }
      setMessage(`Booking ${t.name} dibatalkan, stok minyak dikembalikan.`);
    } catch (e) { setMessage('Gagal membatalkan: ' + e.message); }
  }
  async function handleBatalSebagian(t, newPrice, index = 0) {
    if (!t.currentOutletId) return;
    const ids = bookingIdsOf(t);
    const targetId = ids[index] || ids[0];
    if (!targetId) return;
    try {
      await cancelBookingPartial(t.currentOutletId, targetId, t.id, newPrice);
      setMessage(`Booking ${t.name} ditutup dengan harga baru ${rp(newPrice)}.`);
    } catch (e) { setMessage('Gagal: ' + e.message); }
  }
  async function handleTandaiLunas(t, method) {
    if (!t.currentOutletId) return;
    try {
      for (const bId of bookingIdsOf(t)) {
        await markBookingPaid(t.currentOutletId, bId, t.id, method);
      }
      setMessage(`Booking ${t.name} ditandai lunas (${PAYMENT_METHOD_LABEL[method]}).`);
    } catch (e) { setMessage('Gagal: ' + e.message); }
  }

  function openContinue(t) {
    setContinueTarget(t);
    setCTreatment(null);
    setCOil(null);
    setCSize(null);
    setCPaid(false);
    setCMethod('cash');
  }

  async function handleSubmitContinue() {
    if (!continueTarget || !cTreatment) return;
    setCSaving(true);
    try {
      const usesOilFlag = treatmentUsesOil(cTreatment);
      await continueTreatment({
        therapistId: continueTarget.id,
        treatmentId: cTreatment.id,
        treatmentName: cTreatment.name,
        treatmentPrice: cTreatment.price,
        commissionPercent: cTreatment.commissionPercent,
        durationMinutes: cTreatment.durationMinutes,
        oilType: usesOilFlag ? cOil : null,
        oilSize: usesOilFlag ? cSize : null,
        usesOil: usesOilFlag,
        customerName: continueTarget.currentCustomerName || '',
        paid: cPaid,
        paymentMethod: cMethod
      });
      setMessage(`Treatment lanjutan untuk ${continueTarget.name} dicatat.`);
      setContinueTarget(null);
      setCTreatment(null); setCOil(null); setCSize(null);
    } catch (e) {
      setMessage('Gagal mencatat lanjutan: ' + e.message);
    } finally {
      setCSaving(false);
    }
  }

  async function handleCompleteGroup(members) {
    try {
      await completeBookingGroup(members);
      setMessage(`Grup (${members.length} orang) selesai sekaligus.`);
    } catch (e) { setMessage('Gagal: ' + e.message); }
  }
  async function handlePayGroup(members, method) {
    try {
      await markGroupPaid(members, method);
      setMessage(`Grup (${members.length} orang) ditandai lunas (${PAYMENT_METHOD_LABEL[method]}).`);
    } catch (e) { setMessage('Gagal: ' + e.message); }
  }

  // Kirim list lengkap ke WhatsApp: muat ulang komisi hari ini TERLEBIH DAHULU
  // (segar) supaya angka komisi pasti tampil di daftar — tidak bergantung pada
  // state dailyCommissions yang mungkin belum terisi / sudah kedaluwarsa.
  async function handleSendList() {
    try {
      const { commissions } = await getTherapistDailyReport(todayId());
      setDailyCommissions(commissions);
      buildAndSendTherapistList({ therapists, dailyCommissions: commissions });
    } catch (e) {
      setMessage('Gagal memuat komisi: ' + e.message);
    }
  }

  const busy = therapists.filter((t) => (t.status || 'free') === 'ambil_tamu');
  const free = therapists.filter((t) => (t.status || 'free') === 'free');
  const breakList = therapists.filter((t) => t.status === 'break');
  const offList = therapists.filter((t) => t.status === 'libur');
  const others = [...breakList, ...offList];

  // Kelompokkan yang sedang ambil tamu per outlet
  const busyByOutlet = {};
  busy.forEach((t) => {
    const key = t.currentOutletId || 'unknown';
    if (!busyByOutlet[key]) busyByOutlet[key] = [];
    busyByOutlet[key].push(t);
  });

  // Kalau outlet tertentu dipilih, persempit tampilan: hanya outlet itu untuk
  // "Ambil Tamu", dan hanya terapis dengan homeOutletId itu untuk Free/Break/Libur
  const outletsToShow = outletFilter === 'semua' ? OUTLETS : OUTLETS.filter((o) => o.id === outletFilter);
  const filteredFree = outletFilter === 'semua' ? free : free.filter((t) => t.homeOutletId === outletFilter);
  const filteredOthers = outletFilter === 'semua' ? others : others.filter((t) => t.homeOutletId === outletFilter);
  const filteredBusyCount = outletFilter === 'semua' ? busy.length : (busyByOutlet[outletFilter]?.length || 0);

  const cardProps = {
    onManualStatus: handleManualStatus,
    onSelesai: handleSelesai,
    onBatalPenuh: handleBatalPenuh,
    onBatalSebagian: handleBatalSebagian,
    onTandaiLunas: handleTandaiLunas,
    onContinue: openContinue
  };

  // Ringkasan per outlet: jumlah terapis sedang ambil tamu vs total terapis di outlet itu
  const outletSummary = OUTLETS.map((o) => {
    const inOutlet = therapists.filter((t) => t.homeOutletId === o.id);
    const busyHere = inOutlet.filter((t) => (t.status || 'free') === 'ambil_tamu').length;
    const freeHere = inOutlet.filter((t) => (t.status || 'free') === 'free').length;
    return { outlet: o, total: inOutlet.length, busy: busyHere, free: freeHere };
  });

  return (
    <div className="kasir-page">
      <h2>Payment & List</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Dikelompokkan per outlet — otomatis kembali Free saat waktu treatment habis
      </p>

      <button
        style={{ marginBottom: 16 }}
        onClick={handleSendList}
      >
        Kirim daftar lengkap ke WhatsApp
      </button>

      {message && <p style={{ fontSize: 13 }}>{message}</p>}

      <div className="grid-2" style={{ marginBottom: 12 }}>
        {outletSummary.map(({ outlet, total, busy, free }) => (
          <div key={outlet.id} className="oil-card" style={{ textAlign: 'left', padding: '8px 12px', margin: 0, cursor: 'pointer' }}
            onClick={() => setOutletFilter(outletFilter === outlet.id ? 'semua' : outlet.id)}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{outlet.name} <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>({outlet.id})</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {total} terapis · <span style={{ color: 'var(--primary)' }}>{busy} ambil tamu</span> · {free} free
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <button className={outletFilter === 'semua' ? 'active' : ''} onClick={() => setOutletFilter('semua')}>
          Semua Outlet
        </button>
        {OUTLETS.map((o) => (
          <button key={o.id} className={outletFilter === o.id ? 'active' : ''} onClick={() => setOutletFilter(o.id)}>
            {o.name}
          </button>
        ))}
      </div>

      <section>
        <p>Sedang Ambil Tamu ({filteredBusyCount})</p>
        {filteredBusyCount === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada terapis yang sedang bertugas.</p>
        )}
        {outletsToShow.map((o) => {
          const list = busyByOutlet[o.id];
          if (!list || list.length === 0) return null;

          // Pisahkan yang tergabung dalam grup (groupId sama, masih >1 aktif) dari individu
          const groupMap = {};
          const singles = [];
          list.forEach((t) => {
            if (t.currentGroupId) {
              if (!groupMap[t.currentGroupId]) groupMap[t.currentGroupId] = [];
              groupMap[t.currentGroupId].push(t);
            } else {
              singles.push(t);
            }
          });
          const groups = Object.values(groupMap).filter((g) => g.length > 1);
          // Grup yang sisa 1 orang (lainnya sudah selesai) diperlakukan sebagai individu biasa
          Object.values(groupMap).filter((g) => g.length === 1).forEach((g) => singles.push(g[0]));

          return (
            <div key={o.id} style={{ marginBottom: 14 }}>
              {outletFilter === 'semua' && (
                <p style={{
                  fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)',
                  background: 'var(--primary-light)', display: 'inline-block',
                  padding: '3px 10px', borderRadius: 6, marginBottom: 6
                }}>
                  {o.name} ({list.length})
                </p>
              )}
              {groups.map((members) => (
                <GroupCard
                  key={members[0].currentGroupId}
                  members={members}
                  onCompleteGroup={handleCompleteGroup}
                  onPayGroup={handlePayGroup}
                  cardProps={cardProps}
                />
              ))}
              {singles.map((t) => (
                <TherapistCard key={t.id} t={t} dailyTotal={dailyTotals[t.id]} {...cardProps} />
              ))}
            </div>
          );
        })}
      </section>

      <section>
        <p>Free ({filteredFree.length})</p>
        {filteredFree.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Tidak ada terapis yang free saat ini.</p>
        )}
        {filteredFree.map((t) => (
          <TherapistCard key={t.id} t={t} dailyTotal={dailyTotals[t.id]} {...cardProps} />
        ))}
      </section>

      {filteredOthers.length > 0 && (
        <section>
          <p>Break / Libur ({filteredOthers.length})</p>
          {filteredOthers.map((t) => (
            <TherapistCard key={t.id} t={t} dailyTotal={dailyTotals[t.id]} {...cardProps} />
          ))}
        </section>
      )}

      {continueTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }} onClick={() => setContinueTarget(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)', width: '100%', maxWidth: 560, maxHeight: '90dvh',
              overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: 18, paddingBottom: 24
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 15 }}>Lanjutkan treatment — {continueTarget.name}</strong>
              <button style={{ width: 'auto', padding: '6px 12px', boxShadow: 'none', background: 'var(--danger)' }} onClick={() => setContinueTarget(null)}>✕</button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Pilih treatment lanjutan untuk tamu ini</p>
            <div className="grid-2" style={{ marginBottom: 14 }}>
              {treatments.map((tr) => (
                <button
                  key={tr.id}
                  className={cTreatment?.id === tr.id ? 'active' : ''}
                  onClick={() => { setCTreatment(tr); setCOil(null); setCSize(null); }}
                  style={{ fontSize: 12 }}
                >
                  {tr.name} - {rp(tr.price)}
                </button>
              ))}
            </div>

            {cTreatment && treatmentUsesOil(cTreatment) && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Pilih minyak & ukuran (wajib)</p>
                <div className="grid-2">
                  {OIL_TYPES.map((oil) => (
                    <button key={oil} className={cOil === oil ? 'active' : ''} onClick={() => setCOil(oil)} style={{ fontSize: 12 }}>{oil}</button>
                  ))}
                </div>
                <div className="grid-3" style={{ marginTop: 8 }}>
                  {OIL_SIZES.map((sz) => (
                    <button key={sz} className={cSize === sz ? 'active' : ''} onClick={() => setCSize(sz)} style={{ fontSize: 12 }}>{sz}</button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={cPaid} onChange={(e) => setCPaid(e.target.checked)} />
                Langsung lunas
              </label>
              {cPaid && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {Object.entries(PAYMENT_METHOD_LABEL).map(([val, label]) => (
                    <button
                      key={val}
                      className={cMethod === val ? 'pos-chip active' : 'pos-chip'}
                      onClick={() => setCMethod(val)}
                      style={{ fontSize: 12 }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              disabled={!cTreatment || (treatmentUsesOil(cTreatment) && (!cOil || !cSize)) || cSaving}
              style={{ width: '100%', padding: '12px', fontSize: 15 }}
              onClick={handleSubmitContinue}
            >
              {cSaving ? 'Menyimpan…' : 'Catat lanjutan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
