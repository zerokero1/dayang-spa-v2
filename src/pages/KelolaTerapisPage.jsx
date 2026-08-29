import { useEffect, useState } from 'react';
import { OUTLETS, STAFF_ROLES, SHIFTS, SHIFT_LABEL } from '../lib/constants';
import { listenAllTherapists, addTherapist, setTherapistHomeOutlet, updateTherapistInfo, setTherapistShift, setTherapistStatusManual, removeTherapist, THERAPIST_STATUS_OPTIONS } from '../lib/therapistService';

const ROLE_LABEL = {
  [STAFF_ROLES.SENIOR_TERAPIS]: 'Senior Terapis',
  [STAFF_ROLES.KASIR]: 'Kasir',
  [STAFF_ROLES.TERAPIS]: 'Terapis',
  [STAFF_ROLES.TRAINING_TERAPIS]: 'Training Terapis',
  [STAFF_ROLES.TRAINING_BARU]: 'Training Baru'
};

export default function KelolaTerapisPage() {
  const [therapists, setTherapists] = useState([]);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState(STAFF_ROLES.TERAPIS);
  const [newOutlet, setNewOutlet] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => listenAllTherapists(setTherapists), []);

  const filtered = therapists.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  // Kelompokkan per outlet asal (urutan OUTLETS), sisanya ke "Belum ada outlet"
  const byOutlet = OUTLETS.map((o) => ({
    outlet: o,
    list: filtered.filter((t) => t.homeOutletId === o.id)
  }));
  const noOutlet = filtered.filter((t) => !t.homeOutletId);

  async function handleAdd() {
    if (!newName.trim()) return;
    await addTherapist({ name: newName.trim(), role: newRole, homeOutletId: newOutlet || null });
    setNewName(''); setNewOutlet('');
    setMessage(`${newName} ditambahkan.`);
  }

  async function handleSetOutlet(t, outletId) {
    await setTherapistHomeOutlet(t.id, outletId);
  }

  async function handleSetRole(t, role) {
    await updateTherapistInfo(t.id, { role });
  }

  async function handleSetShift(t, shift) {
    await setTherapistShift(t.id, shift);
  }

  async function handleSetStatus(t, status) {
    await setTherapistStatusManual(t.id, status);
  }

  async function handleRemove(t) {
    if (!window.confirm(`Hapus terapis "${t.name}" dari daftar?`)) return;
    await removeTherapist(t.id);
  }

  return (
    <div className="kasir-page">
      <h2>Kelola Terapis ({therapists.length})</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        Atur outlet asal (ditampilkan sebagai singkatan di nama, mis. "Gading (DR)") dan role tiap terapis
      </p>

      {message && <p style={{ fontSize: 13 }}>{message}</p>}

      <section>
        <p>Tambah terapis baru</p>
        <input placeholder="Nama" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ width: '100%', padding: 11, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
          {Object.entries(ROLE_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        <select value={newOutlet} onChange={(e) => setNewOutlet(e.target.value)} style={{ width: '100%', padding: 11, marginBottom: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
          <option value="">Outlet asal (opsional)</option>
          {OUTLETS.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.id})</option>)}
        </select>
        <button onClick={handleAdd} disabled={!newName.trim()}>Tambah</button>
      </section>

      <section>
        <p>Cari terapis</p>
        <input placeholder="Ketik nama..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </section>

      <section>
        {byOutlet.map(({ outlet, list }) => {
          if (list.length === 0) return null;
          return (
            <div key={outlet.id} style={{ marginBottom: 16 }}>
              <p style={{
                fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)',
                background: 'var(--primary-light)', display: 'inline-block',
                padding: '3px 10px', borderRadius: 6, marginBottom: 6
              }}>
                {outlet.name} ({list.length})
              </p>
              {list.map((t) => (
                <TerapisRow key={t.id} t={t} onSetOutlet={handleSetOutlet} onSetRole={handleSetRole} onSetShift={handleSetShift} onSetStatus={handleSetStatus} onRemove={handleRemove} />
              ))}
            </div>
          );
        })}

        {noOutlet.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{
              fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
              background: 'var(--busy-bg)', display: 'inline-block',
              padding: '3px 10px', borderRadius: 6, marginBottom: 6
            }}>
              Belum ada outlet ({noOutlet.length})
            </p>
            {noOutlet.map((t) => (
              <TerapisRow key={t.id} t={t} onSetOutlet={handleSetOutlet} onSetRole={handleSetRole} onSetShift={handleSetShift} onSetStatus={handleSetStatus} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TerapisRow({ t, onSetOutlet, onSetRole, onSetShift, onSetStatus, onRemove }) {
  return (
    <div className="oil-card" style={{ marginBottom: 8, textAlign: 'left' }}>
      <strong style={{ fontSize: 14 }}>
        {t.name}{t.homeOutletId ? ` (${t.homeOutletId})` : ''}
      </strong>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <select
          value={t.homeOutletId || ''}
          onChange={(e) => onSetOutlet(t, e.target.value)}
          style={{ padding: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }}
        >
          <option value="">Outlet asal: -</option>
          {OUTLETS.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.id})</option>)}
        </select>
        <select
          value={t.role || STAFF_ROLES.TERAPIS}
          onChange={(e) => onSetRole(t, e.target.value)}
          style={{ padding: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }}
        >
          {Object.entries(ROLE_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        <select
          value={t.shift || ''}
          onChange={(e) => onSetShift(t, e.target.value)}
          style={{ padding: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }}
        >
          <option value="">Shift: -</option>
          {Object.entries(SHIFT_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        <select
          value={t.status || 'free'}
          onChange={(e) => onSetStatus(t, e.target.value)}
          style={{ padding: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }}
        >
          {THERAPIST_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          onClick={() => onRemove(t)}
          style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, background: 'var(--danger)', color: '#fff', border: 'none', width: 'auto', marginLeft: 'auto' }}
        >
          Hapus
        </button>
      </div>
    </div>
  );
}
