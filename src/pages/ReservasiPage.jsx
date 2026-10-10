import { useEffect, useState } from 'react';
import { OIL_SIZES, TREATMENT_CATEGORIES, treatmentUsesOil, oilChoicesFor, isSingleSizeProduct, SIZE_NONE } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { listenTreatments } from '../lib/treatmentService';
import { createReservation, listenReservations, checkInReservationMulti, cancelReservation } from '../lib/reservationService';
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

// Tanggal lokal WIB sebagai "YYYY-MM-DD", dipakai untuk mencocokkan reservasi
// dengan pilihan tanggal di "kirim list".
function tanggalPendek(ms) {
  return new Date(new Date(ms).getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

function hariIniId() {
  return tanggalPendek(Date.now());
}

// Satu orang yang akan datang, dengan terapis yang akan menanganinya.
function tamuBaru(nama, terapisId) {
  return {
    uid: Math.random().toString(36).slice(2, 8),
    customerName: nama || '',
    customerPhone: '',
    therapistId: terapisId || null
  };
}

/**
 * Pesan pengingat untuk GRUP WhatsApp internal (grup staff), format-nya
 * mengikuti pesan "kirim list" yang sudah dipakai di halaman Status Terapis:
 * judul besar, lalu satu blok info per reservasi.
 *
 * Berbeda dengan pesan ke pelanggan, pesan ini tidak menyapa orang dan tidak
 * mengemis konfirmasi - tujuannya memberitahu tim apa yang harus disiapkan.
 *
 * @param {object} r baris reservasi
 * @param {string} [treatment] treatment yang sudah dipilih, kalau reservasi
 *        sudah diisi
 */
function kirimReservasiKeGrup(r, treatment) {
  const lines = [
    'RESERVASI BARU',
    `Outlet  : ${OUTLET_NAME[r.outletId] || r.outletId}`,
    `Jadwal  : ${tanggalPanjang(r.scheduledAt)}, ${jamSingkat(r.scheduledAt)} WIB`
  ];
  // Kalau satu reservasi berisi beberapa orang, sebutkan semuanya supaya tim
  // tahu berapa orang yang harus disiapkan.
  const daftar = Array.isArray(r.daftarOrang) ? r.daftarOrang.filter(Boolean) : [];
  if (daftar.length > 1) {
    lines.push(`Jumlah   : ${daftar.length} orang`);
    lines.push('Tamu     : ' + daftar.join(', '));
    if (r.customerPhone) lines.push(`No HP    : ${r.customerPhone}`);
  } else {
    lines.push(`Tamu     : ${r.customerName || '(tanpa nama)'}`);
    if (r.customerPhone) lines.push(`No HP    : ${r.customerPhone}`);
  }
  lines.push(`Terapis : ${r.therapistName || '-'}`);
  if (treatment) {
    lines.push(`Treatment: ${treatment.name} - Rp${Number(treatment.price || 0).toLocaleString('id-ID')}`);
  } else if (r.treatmentName || r.category) {
    lines.push(`Treatment: ${r.treatmentName || r.category}${r.treatmentPrice ? ' - Rp' + Number(r.treatmentPrice).toLocaleString('id-ID') : ''}`);
  }
  lines.push('Mohon siapkan room dan minyak sesuai daftar.');
  openWhatsAppMessage(lines.join('\n'));
}

/**
 * Kirim satu pesan ke grup untuk beberapa orang yang booking jam sama.
 * Dipakai setelah menyimpan lebih dari satu baris, supaya kasir memilih grupnya
 * sekali saja.
 */
function kirimGrupBanyak(rows, scheduledAt) {
  const lines = [
    'RESERVASI BARU',
    `Outlet  : ${OUTLET_NAME[rows[0].outletId] || rows[0].outletId}`,
    `Jadwal  : ${tanggalPanjang(scheduledAt)}, ${jamSingkat(scheduledAt)} WIB`,
    `Jumlah  : ${rows.length} orang`,
    ''
  ];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.namaTampil}${r.customerPhone ? ` · ${r.customerPhone}` : ''}`);
    lines.push(`   ${r.therapistName || '-'}${r.category ? ` · ${r.category}` : ''}`);
  });
  lines.push('', 'Mohon siapkan room dan minyak sesuai daftar.');
  openWhatsAppMessage(lines.join('\n'));
}

/**
 * Kirim daftar reservasi satu tanggal ke grup sekaligus - ini yang biasa
 * dipakai kasir sebagai "kirim list".
 *
 * @param {Array} list baris reservasi
 * @param {string} tanggal label tanggal yang ditampilkan
 */
function kirimListReservasiKeGrup(list, tanggal) {
  if (!list.length) return;
  const text = [`RESERVASI ${tanggal} (${list.length} booking)`, ''];
  list.forEach((r, i) => {
    text.push(`${i + 1}. ${jamSingkat(r.scheduledAt)} — ${r.customerName || '(tanpa nama)'}`);
    if (r.customerPhone) text.push(`   ${r.customerPhone}`);
    text.push(`   ${r.therapistName || '-'} · ${r.treatmentName || r.category || '-'}`);
    text.push('');
  });
  openWhatsAppMessage(text.join('\n'));
}
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
  );  const message = lines.join('\n');
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
  // Satu baris = satu orang yang akan datang, lengkap dengan terapisnya.
  // Kalau dua orang booking jam yang sama, kasir cukup tambah satu baris -
  // tidak perlu mengulang tanggal dan jam dua kali. Tabel reservations
  // menyimpan satu orang dan satu terapis per baris, jadi setiap baris di
  // sini disimpan sebagai satu reservasi dengan jam yang sama.
  const [guests, setGuests] = useState([tamuBaru()]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [therapistSearch, setTherapistSearch] = useState('');
  const [saved, setSaved] = useState([]);
  const [listDate, setListDate] = useState(hariIniId());

  const [processTarget, setProcessTarget] = useState(null); // reservasi yang sedang diisi
  // Satu baris = satu treatment yang akan dibuatkan bookingnya. Pelanggan
  // boleh punya beberapa treatment di jam yang sama, jadi daftar ini bisa
  // lebih dari satu.
  const [pItems, setPItems] = useState([]);
  const [pSaving, setPSaving] = useState(false);

  function barisBaru(categori, terapisId, customerName) {
    return {
      uid: Math.random().toString(36).slice(2, 8),
      category: kategori || TREATMENT_CATEGORIES[0],
      treatment: null, oil: null, size: null,
      therapistId: terapisId || null,
      // Nama orang untuk baris ini. Kosong = ikut memakai nama pelanggan di
      // reservasi, jadi satu orang bisa punya beberapa treatment tanpa
      // mengulang namanya.
      customerName: customerName || ''
    };
  }

  useEffect(() => {
    if (!active) return;
    const unsub1 = listenAllTherapists(setTherapists);
    const unsub2 = listenTreatments(setTreatments);
    const unsub3 = listenReservations(outletId, setReservations);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [active, outletId]);

  // Nama terapis yang cocok dengan pencarian, dipakai di setiap baris orang.
  const cariTerapis = (q) => therapists.filter((t) => t.name.toLowerCase().includes(String(q || '').toLowerCase()));
  const upcoming = reservations
    .filter((r) => r.status === 'terjadwal')
    .sort((a, b) => a.scheduledAt - b.scheduledAt);

  // Semua baris wajib punya terapis. Nama boleh kosong - untuk tamu yang cuma
  // booking tanpa menyebut nama.
  const canSave = !!category && !!scheduleDate && guests.length > 0 &&
    guests.every((g) => g.therapistId);
  const nomorValid = guests.some((g) => normalizeWaNumber(g.customerPhone) !== '');

  // "Kirim list": seluruh reservasi aktif pada satu tanggal dikirim ke grup
  // WhatsApp sekaligus, supaya kasir cukup memilih grupnya sekali saja.
  const listHariIni = reservations.filter((r) => {
    if (r.status !== 'terjadwal') return false;
    return tanggalPendek(r.scheduledAt) === listDate;
  });

  function ubahTamu(uid, patch) {
    setGuests((list) => list.map((g) => (g.uid === uid ? { ...g, ...patch } : g)));
  }

  function tambahTamu() {
    setGuests((list) => [...list, tamuBaru()]);
  }

  function hapusTamu(uid) {
    setGuests((list) => (list.length > 1 ? list.filter((g) => g.uid !== uid) : list));
  }

  /** Nama orang yang tampil di pesan: baris tanpa nama memakai nama baris pertama. */
  function namaTamuOf(g) {
    const nama = (g.customerName || '').trim();
    if (nama) return nama;
    const pertama = (guests[0]?.customerName || '').trim();
    return pertama || '(tanpa nama)';
  }

  async function handleSave(kirimWa) {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const scheduledAt = new Date(scheduleDate).toISOString();
      // Satu baris = satu reservasi. Dua orang di jam yang sama jadi dua
      // reservasi dengan scheduled_at yang sama, jadi tidak perlu mengulang
      // tanggal dan jam di form.
      const tersimpan = [];
      for (const g of guests) {
        const t = therapists.find((x) => x.id === g.therapistId);
        const row = await createReservation({
          outletId,
          therapistId: g.therapistId,
          therapistName: t ? t.name : '',
          category,
          customerName: (g.customerName || '').trim(),
          customerPhone: (g.customerPhone || '').trim(),
          scheduledAt
        });
        tersimpan.push({ ...row, namaTampil: namaTamuOf(g), nomorAsli: g.customerPhone });
      }

      setMessage(
        tersimpan.length > 1
          ? `${tersimpan.length} reservasi ${formatSchedule(scheduledAt)} tersimpan untuk ${tersimpan.length} orang.`
          : `Reservasi ${formatSchedule(scheduledAt)} tersimpan. Saat jamnya mendekat, isi treatment via "Isi Treatment".`
      );
      setSaved(tersimpan);
      if (kirimWa) {
        // Kirim ke grup sekali untuk semua orang; ke pelanggan hanya untuk yang
        // nomornya diisi.
        if (tersimpan.length > 1) {
          kirimGrupBanyak(tersimpan, scheduledAt);
        } else {
          const langsung = kirimPengingatWa(tersimpan[0]);
          if (!langsung) setMessage((m) => m + ' Nomor HP belum diisi, jadi pilih kontaknya manual.');
        }
      }
      setGuests([tamuBaru()]);
      setScheduleDate('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openProcess(r) {
    setProcessTarget(r);
    // Baris pertama memakai terapis & kategori dari reservasi, tapi tetap bisa
    // diganti - kadang tamu datang barengan dengan pasangan.
    setPItems([barisBaru(r.category || TREATMENT_CATEGORIES[0], r.therapistId, r.customerName)]);
  }

  function ubahBaris(uid, patch) {
    setPItems((list) => list.map((b) => (b.uid === uid ? { ...b, ...patch } : b)));
  }

  function hapusBaris(uid) {
    setPItems((list) => (list.length > 1 ? list.filter((b) => b.uid !== uid) : list));
  }

  // Jumlah orang berbeda di dalam satu grup. Baris yang kolom "Nama orang"-nya
  // kosong ikut memakai nama pelanggan di reservasi, jadi baris seperti itu
  // menghitung sebagai orang yang sama - bukan orang tambahan.
  function hitungOrang(list, namaReservasi) {
    const set = new Set();
    list.forEach((b) => {
      const n = (b.customerName || '').trim() || namaReservasi || '(tanpa nama)';
      set.add(n);
    });
    return set.size;
  }

  // Oil hanya diminta kalau treatment-nya memang pakai minyak.
  function perluMinyak(baris) {
    return treatmentUsesOil(baris.treatment);
  }

  const pSiap = pItems.length > 0 && pItems.every((b) => b.treatment && b.therapistId &&
    (!treatmentUsesOil(b.treatment) || (b.oil && b.size)));

  async function handleProcessSave() {
    if (!pSiap) return;
    setPSaving(true);
    setError('');
    try {
      const total = pItems.reduce(
        (s, b) => s + Number(b.treatment?.price || 0), 0
      );
      const bookingIds = await checkInReservationMulti({
        reservation: processTarget,
        items: pItems.map((b) => ({
          therapistId: b.therapistId,
          therapistName: therapists.find((t) => t.id === b.therapistId)?.name || processTarget.therapistName,
          customerName: b.customerName,
          treatment: b.treatment,
          oilType: b.oil,
          oilSize: b.size,
          usesOil: !perluMinyak(b)
        }))
      });
      const namaTamu = processTarget.customerName || 'tamu';
      const jumlahOrang = hitungOrang(pItems, processTarget.customerName);
      setMessage(
        bookingIds.length > 1
          ? `Booking ${namaTamu} dibuat: ${bookingIds.length} treatment untuk ${jumlahOrang} orang, total Rp${total.toLocaleString('id-ID')}.`
          : `Booking ${namaTamu} dibuat — ${pItems[0].treatment.name}.`
      );
      // Ringkasan per treatment supaya bisa dikirim ke grup dalam satu pesan.
      setSaved({
        ...processTarget,
        treatmentName: pItems.map((b) => b.treatment.name).join(' + '),
        treatmentPrice: total,
        customerName: pItems[0].customerName || processTarget.customerName,
        therapistName: pItems.map((b) =>
          therapists.find((t) => t.id === b.therapistId)?.name || processTarget.therapistName
        ).filter((v, i, a) => a.indexOf(v) === i).join(', '),
        // Daftar orang dalam grup, untuk pesan ke tim.
        daftarOrang: [...new Set(pItems
          .map((b) => (b.customerName || '').trim() || processTarget.customerName)
          .filter(Boolean))]
      });
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

      <section style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>Kirim list ke grup</strong>
        <input
          type="date"
          value={listDate}
          onChange={(e) => setListDate(e.target.value)}
          style={{ width: 'auto' }}
        />
        <button
          style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--primary)', color: '#fff' }}
          disabled={listHariIni.length === 0}
          onClick={() => kirimListReservasiKeGrup(listHariIni, tanggalPanjang(new Date(listDate + 'T00:00:00+07:00').getTime()))}
        >
          📋 Kirim list ({listHariIni.length})
        </button>
        {listHariIni.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tidak ada reservasi aktif pada tanggal ini.</span>
        )}
      </section>

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
                  <button
                    style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--primary)', color: '#fff' }}
                    onClick={() => kirimReservasiKeGrup(r)}
                  >
                    📢 Kirim ke grup
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
        <p>3. Daftar orang yang akan datang</p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '-4px 0 8px' }}>
          Satu baris = satu orang + satu terapis. Kalau beberapa orang booking
          jam yang sama, tambah baris sebanyaknya - tanggal dan jam cukup diisi sekali.
        </p>

        <input
          placeholder="Cari nama terapis..."
          value={therapistSearch}
          onChange={(e) => setTherapistSearch(e.target.value)}
          style={{ marginBottom: 10 }}
        />

        {guests.map((g, i) => {
          const cari = cariTerapis(therapistSearch);
          return (
            <div key={g.uid} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 12 }}>Orang {i + 1}</strong>
                {guests.length > 1 && (
                  <button
                    style={{ width: 'auto', padding: '2px 8px', fontSize: 11, boxShadow: 'none', background: 'var(--danger)', color: '#fff' }}
                    onClick={() => hapusTamu(g.uid)}
                  >
                    Hapus
                  </button>
                )}
              </div>

              <input
                placeholder={i === 0 ? 'Nama pelanggan' : 'Nama (boleh kosong)'}
                value={g.customerName}
                onChange={(e) => ubahTamu(g.uid, { customerName: e.target.value })}
                style={{ width: '100%', marginBottom: 6 }}
              />
              <input
                placeholder="No. HP (WA)"
                value={g.customerPhone}
                inputMode="tel"
                onChange={(e) => ubahTamu(g.uid, { customerPhone: e.target.value })}
                style={{ width: '100%', marginBottom: 6 }}
              />
              {g.customerPhone.trim() && (
                <div style={{ fontSize: 11, color: normalizeWaNumber(g.customerPhone) ? 'var(--success)' : 'var(--warning)', marginTop: -4, marginBottom: 6 }}>
                  {normalizeWaNumber(g.customerPhone)
                    ? `wa.me/${normalizeWaNumber(g.customerPhone)}`
                    : 'Nomor belum lengkap / tidak dikenali.'}
                </div>
              )}

              <select
                value={g.therapistId || ''}
                onChange={(e) => ubahTamu(g.uid, { therapistId: e.target.value || null })}
                style={{ width: '100%' }}
              >
                <option value="">-- pilih terapis --</option>
                {cari.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{(t.status || 'free') === 'ambil_tamu' ? ' (sibuk)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}

        <button style={{ width: '100%', marginTop: 4 }} onClick={tambahTamu}>
          ＋ Tambah orang lain
        </button>
      </section>

      {error && <p className="error">{error}</p>}
      {message && <p style={{ fontSize: 13 }}>{message}</p>}

      {saved.length > 0 && (
        <div className="oil-card" style={{ marginTop: 10, textAlign: 'left', borderLeft: '4px solid var(--success)' }}>
          <strong style={{ fontSize: 13 }}>
            {saved.length} reservasi tersimpan — {formatSchedule(saved[0].scheduledAt)}
          </strong>
          <div style={{ marginTop: 6 }}>
            {saved.map((s) => (
              <div key={s.id} style={{ fontSize: 12, marginBottom: 6 }}>
                <div>
                  <strong>{s.namaTampil}</strong> — {s.therapistName}
                  {s.customerPhone ? ` · ${s.customerPhone}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <button
                    style={{ width: 'auto', padding: '4px 10px', fontSize: 11, boxShadow: 'none', background: 'var(--primary-dark)', color: '#fff' }}
                    onClick={() => openProcess(s)}
                  >
                    Isi Treatment
                  </button>
                  <button
                    style={{ width: 'auto', padding: '4px 10px', fontSize: 11, boxShadow: 'none' }}
                    onClick={() => kirimPengingatWa(s)}
                  >
                    📱 WA
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--primary)', color: '#fff' }}
              onClick={() => (saved.length > 1
                ? kirimGrupBanyak(saved, saved[0].scheduledAt)
                : kirimReservasiKeGrup(saved[0]))}
            >
              📢 Kirim ke grup
            </button>
            <button style={{ width: 'auto', padding: '6px 12px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)', color: '#fff' }} onClick={() => setSaved([])}>
              Tutup
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={!canSave || saving} onClick={() => handleSave(true)} style={{ flex: 2 }}>
          {saving
            ? 'Menyimpan...'
            : guests.length > 1
              ? `Simpan ${guests.length} reservasi & kirim ke grup`
              : 'Simpan & kirim pengingat WA'}
        </button>
        <button disabled={!canSave || saving} onClick={() => handleSave(false)} style={{ flex: 1 }}>
          Simpan saja
        </button>
      </div>

      {processTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div className="oil-card" style={{ maxWidth: 520, width: '100%', maxHeight: '88vh', overflowY: 'auto', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong style={{ fontSize: 14 }}>Isi Treatment — {processTarget.customerName || 'Tamu'}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {processTarget.therapistName} · {formatSchedule(processTarget.scheduledAt)}
                </div>
              </div>
              <button style={{ width: 'auto', padding: '4px 10px', fontSize: 12, boxShadow: 'none', background: 'var(--text-secondary)', color: '#fff' }} onClick={() => setProcessTarget(null)}>✕</button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
              Satu tamu boleh punya beberapa treatment, dan satu grup bisa berisi
              beberapa orang. Tiap baris punya treatment dan terapis sendiri;
              isi kolom "Nama orang" kalau baris itu untuk orang yang berbeda.
            </p>

            {pItems.map((b, idx) => {
              const listTreatment = treatments.filter((t) => t.category === b.category);
              return (
                <div key={b.uid} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong style={{ fontSize: 12 }}>Treatment {idx + 1}</strong>
                    {pItems.length > 1 && (
                      <button
                        style={{ width: 'auto', padding: '2px 8px', fontSize: 11, boxShadow: 'none', background: 'var(--danger)', color: '#fff' }}
                        onClick={() => hapusBaris(b.uid)}
                      >
                        Hapus
                      </button>
                    )}
                  </div>

                  <p style={{ marginBottom: 4, fontSize: 12 }}>Kategori</p>
                  <div className="grid-2">
                    {TREATMENT_CATEGORIES.map((c) => (
                      <button
                        key={c}
                        className={b.category === c ? 'active' : ''}
                        style={{ fontSize: 12 }}
                        onClick={() => ubahBaris(b.uid, { category: c, treatment: null, oil: null, size: null })}
                      >
                        {c}
                      </button>
                    ))}
                  </div>

                  <p style={{ margin: '8px 0 4px', fontSize: 12 }}>Treatment</p>
                  {listTreatment.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Belum ada treatment untuk kategori ini.</p>
                  ) : (
                    <select
                      value={b.treatment?.id || ''}
                      onChange={(e) => {
                        const t = listTreatment.find((x) => x.id === e.target.value) || null;
                        ubahBaris(b.uid, { treatment: t, oil: null, size: null });
                      }}
                      style={{ width: '100%' }}
                    >
                      <option value="">-- pilih treatment --</option>
                      {listTreatment.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} - Rp{Number(t.price || 0).toLocaleString('id-ID')}</option>
                      ))}
                    </select>
                  )}

                  {b.treatment && treatmentUsesOil(b.treatment) && (
                    <>
                      <p style={{ margin: '8px 0 4px', fontSize: 12 }}>Minyak & ukuran</p>
                      <select
                        value={b.oil || ''}
                        onChange={(e) => ubahBaris(b.uid, { oil: e.target.value || null, size: e.target.value ? SIZE_NONE : null })}
                        style={{ width: '100%' }}
                      >
                        <option value="">-- pilih minyak --</option>
                        {oilChoicesFor(b.treatment).map((oil) => (
                          <option key={oil} value={oil}>{oil}</option>
                        ))}
                      </select>
                      {b.oil && !isSingleSizeProduct(b.oil) && (
                        <div className="row" style={{ marginTop: 6 }}>
                          {OIL_SIZES.map((size) => (
                            <button key={size} className={b.size === size ? 'active' : ''} onClick={() => ubahBaris(b.uid, { size })}>
                              {size}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  <p style={{ margin: '8px 0 4px', fontSize: 12 }}>Nama orang</p>
                  <input
                    placeholder={processTarget.customerName
                      ? `Kosongkan = ikut nama "${processTarget.customerName}"`
                      : 'Kosongkan = tanpa nama'}
                    value={b.customerName}
                    onChange={(e) => ubahBaris(b.uid, { customerName: e.target.value })}
                    style={{ width: '100%' }}
                  />

                  <p style={{ margin: '8px 0 4px', fontSize: 12 }}>Terapis</p>
                  <select
                    value={b.therapistId || ''}
                    onChange={(e) => ubahBaris(b.uid, { therapistId: e.target.value || null })}
                    style={{ width: '100%' }}
                  >
                    <option value="">-- pilih terapis --</option>
                    {therapists.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{(t.status || 'free') === 'ambil_tamu' ? ' (sibuk)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button
                style={{ width: 'auto', flex: 1, marginBottom: 0 }}
                onClick={() => setPItems((list) => [...list, barisBaru(list[0]?.category, null, '')])}
              >
                ＋ Treatment orang lain
              </button>
              <button
                style={{ width: 'auto', flex: 1, marginBottom: 0 }}
                onClick={() => setPItems((list) => [...list, barisBaru(list[0]?.category, null, list[0]?.customerName)])}
              >
                ＋ Treatment orang yang sama
              </button>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Total {pItems.length} treatment · {hitungOrang(pItems, processTarget.customerName)} orang ·{' '}
              {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
                .format(pItems.reduce((s, b) => s + Number(b.treatment?.price || 0), 0))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={!pSiap || pSaving} onClick={handleProcessSave} style={{ flex: 1 }}>
                {pSaving
                  ? 'Membuat booking...'
                  : `Buat ${pItems.length} Booking & Selesai Reservasi`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
