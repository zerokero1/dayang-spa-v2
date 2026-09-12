import { useEffect, useState } from 'react';
import { OUTLETS } from '../lib/constants';
import { listenOilInventory } from '../lib/oilInventoryService';
import { listenInventory } from '../lib/inventoryService';
import { submitStockRequests, getStockRequests, updateStockRequestStatus } from '../lib/stockRequestService';

const LOW_OIL = 1;   // botol
const LOW_ITEM = 2;  // pcs/unit

const STATUS_LABEL = { diajukan: 'Diajukan', diproses: 'Diproses', selesai: 'Selesai', batal: 'Batal' };
const STATUS_COLOR = { diajukan: 'var(--warning)', diproses: 'var(--accent)', selesai: 'var(--success)', batal: 'var(--text-secondary)' };

function outletName(id) {
  return OUTLETS.find((o) => o.id === id)?.name || id;
}

function fmtWib(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 7 * 3600000);
  const date = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

export default function OrderStockPage({ outletId, active, isOffice, profile }) {
  const isAdmin = !!profile && (profile.role === 'admin_pusat' || isOffice);
  const [oils, setOils] = useState([]);
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [draft, setDraft] = useState({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [filterOutlet, setFilterOutlet] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selOutlet, setSelOutlet] = useState(outletId);

  useEffect(() => {
    if (!active) return;
    return listenOilInventory(selOutlet, setOils);
  }, [active, selOutlet]);

  useEffect(() => {
    if (!active) return;
    return listenInventory(selOutlet, setItems);
  }, [active, selOutlet]);

  async function reloadRequests() {
    try {
      setRequests(await getStockRequests(isAdmin && filterOutlet === 'ALL' ? null : filterOutlet === 'ALL' ? outletId : filterOutlet));
    } catch (e) {
      console.warn('stock requests', e);
    }
  }

  useEffect(() => {
    if (!active) return;
    reloadRequests();
    const timer = setInterval(reloadRequests, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, outletId, filterOutlet, isAdmin]);

  function setQty(kind, id, value) {
    const num = parseInt(value, 10);
    setDraft((prev) => {
      const next = { ...prev };
      const key = `${kind}:${id}`;
      if (Number.isFinite(num) && num > 0) next[key] = num;
      else delete next[key];
      return next;
    });
  }

  const hasDraft = Object.keys(draft).length > 0;

  function oilDraftQty(o) {
    const v = draft[`oil:${o.id}`];
    return v ? String(v) : '';
  }

  function itemDraftQty(i) {
    const v = draft[`item:${i.id}`];
    return v ? String(v) : '';
  }

  async function handleSubmit() {
    const rows = [];
    for (const [key, qty] of Object.entries(draft)) {
      const [kind, id] = key.split(':');
      if (kind === 'oil') {
        const o = oils.find((x) => x.id === id);
        if (o) rows.push({ itemType: 'oil', name: o.oilType, size: o.size, unit: 'botol', qty });
      } else {
        const it = items.find((x) => x.id === id);
        if (it) rows.push({ itemType: 'item', name: it.name, size: '', unit: it.unit || 'pcs', qty });
      }
    }
    if (rows.length === 0) {
      setError('Isi jumlah minimal satu minyak/produk yang ingin di-order.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await submitStockRequests({
        outletId: selOutlet,
        createdBy: (profile && profile.name) || '',
        items: rows.map((r) => ({ ...r, note: note.trim() }))
      });
      setDraft({});
      setNote('');
      setMessage(`Order stok terkirim (${rows.length} item). Menunggu diproses pihak pusat.`);
      await reloadRequests();
    } catch (e) {
      setError(e.message || 'Gagal mengirim order stok.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSetStatus(id, status) {
    try {
      await updateStockRequestStatus(id, status);
      await reloadRequests();
    } catch (e) {
      setError(e.message || 'Gagal mengubah status.');
    }
  }

  const showRequests = requests.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (isAdmin && filterOutlet === 'ALL') return true;
    if (isAdmin) return r.outletId === filterOutlet;
    return r.outletId === selOutlet;
  });

  return (
    <div className="kasir-page">
      <h2>Order Stok</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        {isAdmin
          ? 'Lihat dan kelola permintaan stok dari semua outlet.'
          : 'Saat closing, isi jumlah stok yang akan habis lalu kirim — pihak pusat akan memprosesnya.'}
      </p>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Stok saat ini</p>
          {isAdmin ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {OUTLETS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={selOutlet === o.id ? 'chip active' : 'chip'}
                  onClick={() => setSelOutlet(o.id)}
                >
                  {o.name}
                </button>
              ))}
            </div>
          ) : (
            <span className="topbar-outlet-label">Outlet: {outletName(selOutlet)}</span>
          )}
        </div>

        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>🫗 Minyak</p>
        <div className="grid-2">
          {oils.map((o) => {
            const low = (o.stock || 0) <= LOW_OIL;
            return (
              <div key={o.id} className="oil-card">
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {o.oilType} ({o.size})
                  {low && <span style={{ color: 'var(--warning)', fontSize: 11, marginLeft: 6 }}>⚠ akan habis</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Stok: <strong style={{ color: low ? 'var(--warning)' : 'inherit' }}>{o.stock}</strong> botol
                </div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    min="0"
                    placeholder="Jumlah order"
                    value={oilDraftQty(o)}
                    onChange={(e) => setQty('oil', o.id, e.target.value)}
                    style={{ maxWidth: 110 }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>📦 Produk lain</p>
        {items.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada produk lain tercatat.</p>
        ) : (
          <div className="grid-2">
            {items.map((i) => {
              const low = (i.stock || 0) <= LOW_ITEM;
              return (
                <div key={i.id} className="oil-card">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {i.name}
                    {low && <span style={{ color: 'var(--warning)', fontSize: 11, marginLeft: 6 }}>⚠ akan habis</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Stok: <strong style={{ color: low ? 'var(--warning)' : 'inherit' }}>{i.stock}</strong> {i.unit}
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      min="0"
                      placeholder="Jumlah order"
                      value={itemDraftQty(i)}
                      onChange={(e) => setQty('item', i.id, e.target.value)}
                      style={{ maxWidth: 110 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isAdmin && (
          <>
            <p style={{ fontSize: 13, marginTop: 12, marginBottom: 4 }}>Catatan (opsional)</p>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="cth: butuh minggu ini / sekalian refill"
            />
            <div style={{ marginTop: 10 }}>
              <button onClick={handleSubmit} disabled={saving || !hasDraft}>
                {saving ? 'Mengirim...' : '📦 Kirim Order Stok'}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            {message && <p style={{ color: 'var(--success)' }}>{message}</p>}
          </>
        )}
        {isAdmin && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>
            Ketika kasir membuka halaman ini di outlet-nya, mereka bisa mengisi jumlah & mengirim permintaan.
          </p>
        )}
      </section>

      <section>
        <h3 style={{ marginBottom: 8 }}>Riwayat Permintaan</h3>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {['ALL', 'diajukan', 'diproses', 'selesai'].map((f) => (
              <button
                key={f}
                type="button"
                className={statusFilter === f ? 'pos-chip active' : 'pos-chip'}
                onClick={() => setStatusFilter(f)}
              >
                {f === 'ALL' ? 'Semua' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        )}
        {showRequests.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada permintaan stok.</p>
        ) : (
          showRequests.map((r) => (
            <div key={r.id} className="oil-card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <strong>
                  {r.name}{r.size ? ` (${r.size})` : ''} — {r.qty} {r.unit || 'pcs'}
                </strong>
                <span style={{ color: STATUS_COLOR[r.status] || 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {outletName(r.outletId)} · {fmtWib(r.createdAt)} WIB{r.createdBy ? ` · oleh ${r.createdBy}` : ''}
              </div>
              {r.note && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>📝 {r.note}</div>}
              {isAdmin && r.status !== 'selesai' && r.status !== 'batal' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {r.status === 'diajukan' && (
                    <button type="button" className="pos-chip" onClick={() => handleSetStatus(r.id, 'diproses')}>
                      Diproses
                    </button>
                  )}
                  <button type="button" className="pos-chip" onClick={() => handleSetStatus(r.id, 'selesai')}>
                    ✅ Tandai Selesai
                  </button>
                  <button type="button" className="pos-chip" onClick={() => handleSetStatus(r.id, 'batal')}>
                    Batal
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}