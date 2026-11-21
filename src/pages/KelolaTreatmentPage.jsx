import { useEffect, useMemo, useState } from 'react';
import { TREATMENT_CATEGORIES, formatRupiah } from '../lib/constants';
import { createTreatment, listenTreatments, setTreatmentActive, updateTreatment } from '../lib/treatmentService';

const OIL_OPTIONS = [
  { value: 'auto', label: 'Otomatis (ikut kategori)' },
  { value: 'yes', label: 'Ya' },
  { value: 'no', label: 'Tidak' }
];

const FORM_KOSONG = {
  nama: '',
  harga: '',
  durasi: '60',
  kategori: 'Massage',
  komisi: '10',
  minyak: 'auto'
};

const rp = (n) => 'Rp' + formatRupiah(n);

/**
 * Kelola katalog treatment (global, semua outlet).
 *
 * "Hapus" sengaja tidak ada: treatment dinonaktifkan agar booking dan struk
 * lama yang menyimpan nama + harga sendiri tetap bisa dibaca.
 */
export default function KelolaTreatmentPage({ active }) {
  const [treatments, setTreatments] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('semua');
  const [form, setForm] = useState(FORM_KOSONG);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!active) return;
    return listenTreatments(setTreatments, { includeInactive: true });
  }, [active]);

  const daftar = useMemo(() => {
    const q = search.trim().toLowerCase();
    return treatments
      .filter((t) => !q || String(t.name || '').toLowerCase().includes(q))
      .filter((t) => (
        statusFilter === 'semua'
          || (statusFilter === 'aktif' ? t.isActive !== false : t.isActive === false)
      ))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [treatments, search, statusFilter]);

  const aktifCount = treatments.filter((t) => t.isActive !== false).length;
  const nonaktifCount = treatments.length - aktifCount;

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...FORM_KOSONG });
  }

  function mulaiEdit(t) {
    setEditingId(t.id);
    setForm({
      nama: t.name || '',
      harga: String(t.price ?? ''),
      durasi: String(t.durationMinutes ?? 60),
      kategori: t.category || 'Massage',
      komisi: String(t.commissionPercent ?? 10),
      minyak: t.usesOil == null ? 'auto' : (t.usesOil ? 'yes' : 'no')
    });
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');
    const input = {
      name: form.nama,
      price: form.harga,
      durationMinutes: form.durasi,
      category: form.kategori,
      commissionPercent: form.komisi,
      usesOil: form.minyak === 'yes' ? true : form.minyak === 'no' ? false : null
    };
    setBusy(true);
    try {
      if (editingId) {
        await updateTreatment(editingId, input);
        setMessage(`Treatment "${input.name.trim()}" diperbarui.`);
      } else {
        await createTreatment(input);
        setMessage(`Treatment "${input.name.trim()}" ditambahkan.`);
      }
      resetForm();
    } catch (err) {
      setMessage('Gagal: ' + (err && err.message ? err.message : 'tidak diketahui'));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(t) {
    const akanAktif = t.isActive === false;
    const konfirmasi = akanAktif
      ? `Aktifkan kembali treatment "${t.name}"?`
      : `Nonaktifkan treatment "${t.name}"?\n\nTreatment tidak akan muncul di kasir atau reservasi, tetapi riwayat transaksi lama tetap tersimpan.`;
    if (!window.confirm(konfirmasi)) return;

    setBusyId(t.id);
    setMessage('');
    try {
      await setTreatmentActive(t.id, akanAktif);
      setMessage(`${t.name} ${akanAktif ? 'diaktifkan kembali' : 'dinonaktifkan'}.`);
      if (!akanAktif && editingId === t.id) resetForm();
    } catch (err) {
      setMessage('Gagal: ' + (err && err.message ? err.message : 'tidak diketahui'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="kasir-page">
      <h2>Kelola Treatment</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Harga dan durasi berlaku untuk semua outlet. Perubahan hanya memengaruhi pesanan baru;
        struk lama tetap memakai harga saat transaksi. Treatment yang dihapus cukup dinonaktifkan.
      </p>

      {message && <p style={{ fontSize: 13 }}>{message}</p>}

      <section>
        <p>{editingId ? 'Edit treatment' : 'Tambah treatment baru'}</p>
        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Nama treatment</label>
          <input
            placeholder="Contoh: Full Body Massage"
            value={form.nama}
            onChange={(e) => setField('nama', e.target.value)}
            required
          />

          <label style={{ fontSize: 12, fontWeight: 700 }}>Harga (Rp)</label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="Contoh: 250000"
            value={form.harga}
            onChange={(e) => setField('harga', e.target.value)}
            required
          />

          <label style={{ fontSize: 12, fontWeight: 700 }}>Durasi (menit)</label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="Contoh: 90"
            value={form.durasi}
            onChange={(e) => setField('durasi', e.target.value)}
            required
          />

          <label style={{ fontSize: 12, fontWeight: 700 }}>Kategori</label>
          <select
            value={form.kategori}
            onChange={(e) => setField('kategori', e.target.value)}
            style={{ width: '100%', padding: 11, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)' }}
          >
            {TREATMENT_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>

          <label style={{ fontSize: 12, fontWeight: 700 }}>Komisi terapis (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={form.komisi}
            onChange={(e) => setField('komisi', e.target.value)}
          />

          <label style={{ fontSize: 12, fontWeight: 700 }}>Pakai minyak / produk</label>
          <select
            value={form.minyak}
            onChange={(e) => setField('minyak', e.target.value)}
            style={{ width: '100%', padding: 11, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)' }}
          >
            {OIL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Menyimpan…' : (editingId ? 'Simpan perubahan' : 'Tambah treatment')}
            </button>
            {editingId && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                Batal
              </button>
            )}
          </div>
        </form>
      </section>

      <section>
        <p>Daftar treatment ({treatments.length}: {aktifCount} aktif, {nonaktifCount} nonaktif)</p>
        <input
          placeholder="Cari nama treatment..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {[['semua', 'Semua'], ['aktif', 'Aktif'], ['nonaktif', 'Nonaktif']].map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={statusFilter === val ? 'chip active' : 'chip'}
              onClick={() => setStatusFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>

        {daftar.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {treatments.length === 0 ? 'Belum ada treatment. Tambahkan yang pertama di atas.' : 'Tidak ada treatment yang cocok.'}
          </p>
        )}

        {daftar.map((t) => (
          <div
            key={t.id}
            className="oil-card"
            style={{ marginBottom: 8, textAlign: 'left', opacity: t.isActive === false ? 0.7 : 1 }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>{t.name}</strong>
              <span className={t.isActive === false ? 'chip' : 'chip active'} style={{ fontSize: 11 }}>
                {t.isActive === false ? 'Nonaktif' : 'Aktif'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {t.category || '-'} · {rp(t.price)} · {t.durationMinutes} menit · komisi {t.commissionPercent}%
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => mulaiEdit(t)}>
                Edit
              </button>
              <button
                type="button"
                className={t.isActive === false ? 'btn btn-sm' : 'btn btn-danger btn-sm'}
                onClick={() => handleToggle(t)}
                disabled={busyId === t.id}
              >
                {busyId === t.id ? 'Menunggu…' : (t.isActive === false ? 'Aktifkan' : 'Nonaktifkan')}
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
