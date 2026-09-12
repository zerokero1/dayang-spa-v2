import { useEffect, useState } from 'react';
import { ONCALL_PACKAGES, DEFAULT_ONCALL_COMMISSION_PCT, PAYMENT_METHOD_LABEL } from '../lib/constants';
import { listenAllTherapists } from '../lib/therapistService';
import { createOncallBookingMulti, editOncallBooking, cancelOncallBooking, getTodayOncall } from '../lib/oncallService';

const rp = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');

function todayId() {
  const now = new Date(Date.now() + 7 * 3600000);
  return now.toISOString().slice(0, 10);
}

function fmtWib(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 7 * 3600000);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export default function OncallPage({ outletId, active }) {
  const [therapists, setTherapists] = useState([]);
  const [selPkg, setSelPkg] = useState(null);
  const [selDur, setSelDur] = useState(null);
  const [selTherapists, setSelTherapists] = useState({});
  const [customerName, setCustomerName] = useState('');
  const [commissionPct, setCommissionPct] = useState(String(DEFAULT_ONCALL_COMMISSION_PCT));
  const [method, setMethod] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [oncallList, setOncallList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    if (!active) return;
    const unsub = listenAllTherapists(setTherapists);
    return () => unsub();
  }, [active]);

  async function loadList() {
    setLoadingList(true);
    try {
      setOncallList(await getTodayOncall(outletId, todayId()));
    } catch (e) {
      console.warn('oncall list', e);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    loadList();
    const timer = setInterval(loadList, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, outletId]);

  const pkg = ONCALL_PACKAGES.find((p) => p.id === selPkg) || null;
  const dur = pkg ? pkg.durations.find((d) => d.minutes === selDur) || null : null;
  const price = dur ? dur.price : 0;
  const therapistOptions = therapists
    .filter((t) => (t.status || 'free') !== 'ambil_tamu')
    .sort((a, b) => {
      const ao = a.homeOutletId === outletId ? 0 : 1;
      const bo = b.homeOutletId === outletId ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  const selEntries = therapistOptions
    .filter((t) => selTherapists[t.id] !== undefined)
    .map((t) => ({ id: t.id, name: t.name, homeOutletId: t.homeOutletId, time: selTherapists[t.id] || '' }));
  const commissionVal = Number.isFinite(parseFloat(commissionPct)) ? parseFloat(commissionPct) : null;
  const therapistCommissionRp = commissionVal != null && price ? Math.round((commissionVal / 100) * price) : 0;
  const totalPrice = price * selEntries.length;

  const canSubmit =
    pkg && dur && selEntries.length > 0 &&
    selEntries.every((e) => /^\d{2}:\d{2}$/.test(e.time)) &&
    customerName.trim() &&
    method && commissionVal != null && commissionVal >= 0 && commissionVal <= 100;

  function resetForm() {
    setSelPkg(null);
    setSelDur(null);
    setSelTherapists({});
    setCustomerName('');
    setCommissionPct(String(DEFAULT_ONCALL_COMMISSION_PCT));
    setMethod('');
    setError('');
  }

  function toggleTherapist(id) {
    setSelTherapists((prev) => {
      const next = { ...prev };
      if (next[id] !== undefined) delete next[id];
      else next[id] = '';
      return next;
    });
  }

  function setTherapistTime(id, time) {
    setSelTherapists((prev) => ({ ...prev, [id]: time }));
  }

  async function handleSubmit() {
    if (!canSubmit) {
      setError('Lengkapi paket, durasi, minimal satu terapis dengan waktu mulai, nama tamu/hotel, dan metode pembayaran.');
      return;
    }
    const entries = selEntries.map((e) => {
      const [h, m] = e.time.split(':').map(Number);
      return { therapist_id: e.id, start_hour: h, start_minute: m };
    });
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await createOncallBookingMulti({
        outletId,
        customerName: customerName.trim(),
        paymentMethod: method,
        packageName: `${pkg.name} (Full Body ${dur.minutes} mnt)`,
        durationMinutes: dur.minutes,
        price,
        commissionPercent: commissionVal,
        hotelCommission: pkg.hotelCommission,
        entries
      });
      setMessage(`Order oncall ${selEntries.length} terapis berhasil dicatat dan langsung lunas.`);
      resetForm();
      await loadList();
    } catch (e) {
      setError(e.message || 'Gagal mencatat order oncall.');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(b) {
    setEditTarget(b);
    setEditForm({
      therapistId: b.therapistId || '',
      packageName: b.treatmentName || '',
      durationMinutes: b.durationMinutes || 60,
      price: b.treatmentPrice || 0,
      commissionPercent: b.commissionPercent || DEFAULT_ONCALL_COMMISSION_PCT,
      hotelCommission: b.hotelCommission || 0,
      customerName: b.customerName || '',
      method: b.paymentMethod || 'cash'
    });
    setEditError('');
  }

  function closeEdit() {
    setEditTarget(null);
    setEditForm(null);
    setEditError('');
  }

  function setEF(key, val) {
    setEditForm((f) => ({ ...f, [key]: val }));
  }

  async function handleCancel(b) {
    if (!window.confirm(`Batalkan transaksi "${b.treatmentName}" untuk ${b.therapistName}? Komisi tidak lagi dihitung dan terapis dibebaskan.`)) return;
    try {
      await cancelOncallBooking(b.id);
      setMessage('Transaksi oncall dibatalkan.');
      await loadList();
    } catch (e) {
      setError(e.message || 'Gagal membatalkan transaksi oncall.');
    }
  }

  async function handleEditSave() {
    if (!editTarget || !editForm) return;
    const comm = Number.isFinite(parseFloat(editForm.commissionPercent))
      ? parseFloat(editForm.commissionPercent) : null;
    if (!editForm.therapistId || !editForm.packageName.trim() ||
        !editForm.customerName.trim() || !editForm.method ||
        comm == null || comm < 0 || comm > 100) {
      setEditError('Lengkapi terapis, nama paket, nama tamu, metode bayar, dan komisi (0–100).');
      return;
    }
    const th = therapists.find((t) => t.id === editForm.therapistId);
    setEditing(true);
    setEditError('');
    try {
      await editOncallBooking({
        bookingId: editTarget.id,
        therapistId: editForm.therapistId,
        therapistName: th ? th.name : editTarget.therapistName,
        packageName: editForm.packageName.trim(),
        durationMinutes: Math.round(Number(editForm.durationMinutes) || 0),
        price: Number(editForm.price) || 0,
        commissionPercent: comm,
        hotelCommission: Number(editForm.hotelCommission) || 0,
        customerName: editForm.customerName.trim(),
        paymentMethod: editForm.method
      });
      setMessage('Transaksi oncall berhasil diubah.');
      closeEdit();
      await loadList();
    } catch (e) {
      setEditError(e.message || 'Gagal menyimpan perubahan oncall.');
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="kasir-page">
      <h2>Oncall Full Body Massage</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Order massage ke hotel/tamu — tercatat langsung lunas, komisi hotel dihitung otomatis.
      </p>

      <section>
        <p>Pilih menu</p>
        <div className="grid-2">
          {ONCALL_PACKAGES.map((p) => (
            <button
              key={p.id}
              className={selPkg === p.id ? 'active' : ''}
              onClick={() => { setSelPkg(p.id); setSelDur(null); }}
            >
              <strong>{p.name}</strong>
              <span style={{ display: 'block', fontSize: 12 }}>Komisi hotel {rp(p.hotelCommission)}</span>
            </button>
          ))}
        </div>
      </section>

      {pkg && (
        <section>
          <p>Durasi</p>
          <div className="grid-2">
            {pkg.durations.map((d) => (
              <button
                key={d.minutes}
                className={selDur === d.minutes ? 'active' : ''}
                onClick={() => setSelDur(d.minutes)}
              >
                <strong>{d.minutes} menit</strong>
                <span style={{ display: 'block', fontSize: 12 }}>{rp(d.price)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <p>Terapis (bisa pilih lebih dari satu)</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {therapistOptions.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Tidak ada terapis tersedia saat ini (semua sedang bertugas / belum ada data terapis).
            </p>
          )}
          {therapistOptions.map((t) => (
            <label
              key={t.id}
              className={'pos-chip' + (selTherapists[t.id] !== undefined ? ' active' : '')}
              style={{ cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={selTherapists[t.id] !== undefined}
                onChange={() => toggleTherapist(t.id)}
                style={{ marginRight: 5, accentColor: 'var(--accent)' }}
              />
              {t.name}{t.homeOutletId && t.homeOutletId !== outletId ? ` · ${t.homeOutletId}` : ''}
            </label>
          ))}
        </div>

        {selEntries.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 13, marginBottom: 4 }}>Atur waktu mulai (boleh beda per terapis)</p>
            {selEntries.map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, flex: 1 }}>{e.name}{e.homeOutletId && e.homeOutletId !== outletId ? ` · ${e.homeOutletId}` : ''}</span>
                <input
                  type="time"
                  value={e.time}
                  onChange={(ev) => setTherapistTime(e.id, ev.target.value)}
                  style={{ maxWidth: 120 }}
                />
                <button type="button" className="pos-chip" onClick={() => toggleTherapist(e.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <p>Nama tamu / hotel</p>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="cth: Hotel xxx / Ms. yyy"
        />
      </section>

      <section>
        <p>Komisi terapis (%)</p>
        <input
          type="number"
          value={commissionPct}
          onChange={(e) => setCommissionPct(e.target.value)}
          style={{ maxWidth: 160 }}
        />
      </section>

      <section>
        <p>Metode pembayaran (wajib)</p>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([val, label]) => (
            <button key={val} className={method === val ? 'pos-chip active' : 'pos-chip'} onClick={() => setMethod(val)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {pkg && dur && (
        <div className="oil-card" style={{ marginTop: 8 }}>
          <strong>Ringkasan</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 13, marginTop: 6, color: 'var(--text-secondary)' }}>
            <div>Paket: {pkg.name} ({dur.minutes} mnt)</div>
            <div>Harga: {rp(price)} / terapis</div>
            <div>Terapis: {selEntries.length || 0}</div>
            <div>Total: {rp(totalPrice)}</div>
            <div>Komisi hotel: {rp(pkg.hotelCommission)} / terapis</div>
            <div>Komisi terapis ({commissionVal ?? 0}%): {rp(therapistCommissionRp)} / terapis</div>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {message && <p style={{ color: 'var(--success)' }}>{message}</p>}

      <button onClick={handleSubmit} disabled={saving}>
        {saving ? 'Menyimpan...' : 'Catat Order Oncall'}
      </button>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Transaksi Oncall Hari Ini</h3>
          {loadingList && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>memuat...</span>}
        </div>
        {oncallList.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada transaksi oncall hari ini.</p>
        ) : (
          oncallList.map((b) => (
            <div key={b.id} className="oil-card" style={{ marginBottom: 8, opacity: b.status === 'batal' ? 0.55 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <strong>{b.treatmentName}</strong>
                <span>{b.status === 'batal' ? '❌' : ''} {rp(b.treatmentPrice)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {b.therapistName} · {b.customerName || '-'} · {fmtWib(b.createdAt)} WIB ·{' '}
                {b.paymentMethod === 'cardless' ? 'Cardless' : 'Cash'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Komisi hotel {rp(b.hotelCommission)} · Komisi terapis {rp(b.commissionAmount)} · {b.durationMinutes || '-'} mnt
              </div>
              {b.status === 'batal' ? (
                <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6, fontWeight: 600 }}>Transaksi dibatalkan</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    className="pos-chip"
                    onClick={() => openEdit(b)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    type="button"
                    className="pos-chip"
                    onClick={() => handleCancel(b)}
                  >
                    🗑️ Hapus
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {editTarget && editForm && (
        <div style={styles.overlay}>
          <div className="oil-card" style={styles.modal}>
            <h3 style={{ marginTop: 0 }}>✏️ Edit Transaksi Oncall</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8 }}>
              {editTarget.therapistName} · {editTarget.customerName || '-'} · {fmtWib(editTarget.createdAt)} WIB
            </p>

            <p style={{ fontSize: 13, marginBottom: 4 }}>Terapis</p>
            <select value={editForm.therapistId || ''} onChange={(e) => setEF('therapistId', e.target.value)}>
              <option value="">Pilih terapis…</option>
              {therapists
                .filter((t) => (t.status || 'free') !== 'ambil_tamu')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.homeOutletId ? ` · ${t.homeOutletId}` : ''}
                  </option>
                ))}
            </select>

            <p style={{ fontSize: 13, marginBottom: 4 }}>Nama paket</p>
            <input
              type="text"
              value={editForm.packageName}
              onChange={(e) => setEF('packageName', e.target.value)}
              placeholder="cth: Balinese Full Body 90 mnt"
            />

            <p style={{ fontSize: 13, marginBottom: 4 }}>Durasi (menit)</p>
            <input
              type="number"
              value={editForm.durationMinutes}
              onChange={(e) => setEF('durationMinutes', e.target.value)}
              style={{ maxWidth: 160 }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div>
                <p style={{ fontSize: 13, marginBottom: 4 }}>Harga (Rp)</p>
                <input
                  type="number"
                  value={editForm.price}
                  onChange={(e) => setEF('price', e.target.value)}
                />
              </div>
              <div>
                <p style={{ fontSize: 13, marginBottom: 4 }}>Komisi hotel (Rp)</p>
                <input
                  type="number"
                  value={editForm.hotelCommission}
                  onChange={(e) => setEF('hotelCommission', e.target.value)}
                />
              </div>
            </div>

            <p style={{ fontSize: 13, marginBottom: 4 }}>Komisi terapis (%)</p>
            <input
              type="number"
              value={editForm.commissionPercent}
              onChange={(e) => setEF('commissionPercent', e.target.value)}
              style={{ maxWidth: 160 }}
            />

            <p style={{ fontSize: 13, marginBottom: 4 }}>Nama tamu / hotel</p>
            <input
              type="text"
              value={editForm.customerName}
              onChange={(e) => setEF('customerName', e.target.value)}
              placeholder="cth: Hotel xxx / Ms. yyy"
            />

            <p style={{ fontSize: 13, marginBottom: 4 }}>Metode pembayaran</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={editForm.method === val ? 'pos-chip active' : 'pos-chip'}
                  onClick={() => setEF('method', val)}
                >
                  {label}
                </button>
              ))}
            </div>

            {editError && <p className="error">{editError}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={handleEditSave} disabled={editing}>
                {editing ? 'Menyimpan...' : '💾 Simpan'}
              </button>
              <button type="button" className="btn-secondary" onClick={closeEdit} disabled={editing}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 90,
    display: 'grid',
    placeItems: 'center',
    padding: 12
  },
  modal: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90vh',
    overflowY: 'auto'
  }
};