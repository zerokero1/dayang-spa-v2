import { useEffect, useState } from 'react';
import { OUTLETS } from './lib/constants';
import { listenAuthState, logout } from './lib/authService';
import { listenAllTherapists } from './lib/therapistService';
import { completeBooking } from './lib/bookingService';
import LoginPage from './pages/LoginPage';
import KasirPage from './pages/KasirPage';
import AbsensiPage from './pages/AbsensiPage';
import LaporanPage from './pages/LaporanPage';
import InventoryPage from './pages/InventoryPage';
import StokMinyakPage from './pages/StokMinyakPage';
import StatusTerapisPage from './pages/StatusTerapisPage';
import ReservasiPage from './pages/ReservasiPage';
import KelolaTerapisPage from './pages/KelolaTerapisPage';
import LaporanAbsensiPage from './pages/LaporanAbsensiPage';
import LaporanInventoryPage from './pages/LaporanInventoryPage';
import AmbilOrderPage from './pages/AmbilOrderPage';
import StrukPage from './pages/StrukPage';
import RingkasanTransaksiPage from './pages/RingkasanTransaksiPage';
import './styles.css';

const PAGES = {
  kasir: { label: 'Kasir', icon: '🧾', Component: KasirPage },
  ambilOrder: { label: 'Ambil Order', icon: '🛍️', Component: AmbilOrderPage, global: true, roles: ['order_taker'] },
  ringkasan: { label: 'Ringkasan Transaksi', icon: '📊', Component: RingkasanTransaksiPage, global: true },
  struk: { label: 'Struk', icon: '🧾', Component: StrukPage },
  reservasi: { label: 'Reservasi', icon: '🗓️', Component: ReservasiPage },
  status: { label: 'Status Terapis', icon: '💆', Component: StatusTerapisPage, global: true },
  absensi: { label: 'Absensi', icon: '✅', Component: AbsensiPage },
  inventory: { label: 'Inventory', icon: '📦', Component: InventoryPage },
  minyak: { label: 'Stok Minyak', icon: '🫗', Component: StokMinyakPage },
  laporan: { label: 'Laporan Keuangan', icon: '💰', Component: LaporanPage },
  laporanAbsensi: { label: 'Laporan Absensi', icon: '📋', Component: LaporanAbsensiPage, global: true },
  laporanInventory: { label: 'Laporan Inventory', icon: '📦', Component: LaporanInventoryPage, global: true },
  kelolaTerapis: { label: 'Kelola Terapis', icon: '👥', Component: KelolaTerapisPage, global: true, adminOnly: true }
};

// Role yang hanya boleh melihat sebagian halaman (staff order-taking).
// Semua role lain (admin_pusat, kasir) tetap melihat semua halaman seperti biasa,
// KECUALI halaman yang secara eksplisit dibatasi ke role tertentu lewat "roles".
const RESTRICTED_ROLE_PAGES = {
  order_taker: ['ambilOrder', 'status', 'ringkasan']
};

const ROLE_LABEL = {
  admin_pusat: 'Admin Pusat',
  kasir: 'Kasir',
  order_taker: 'Order Taker'
};

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeOutlet, setActiveOutlet] = useState(null);
  const [activePage, setActivePage] = useState('kasir');

  useEffect(() => {
    const unsub = listenAuthState((u, p) => {
      setUser(u);
      setProfile(p);
      setAuthLoading(false);
      if (p) {
        setActiveOutlet(p.role === 'kasir' ? p.outletId : OUTLETS[0].id);
        if (RESTRICTED_ROLE_PAGES[p.role]) {
          setActivePage(RESTRICTED_ROLE_PAGES[p.role][0]);
        }
      }
    });
    return () => unsub();
  }, []);

  // Auto-selesaikan terapis yang waktu treatment-nya sudah habis, supaya
  // status kembali "free" tanpa perlu klik manual "Tandai Selesai".
  // Berjalan selama app ini terbuka di perangkat mana pun.
  useEffect(() => {
    if (!user || !profile) return;
    let latestTherapists = [];

    function checkAndComplete() {
      const now = Date.now();
      latestTherapists.forEach((t) => {
        if (
          t.status === 'ambil_tamu' &&
          t.endAt && t.endAt <= now &&
          t.currentOutletId
        ) {
          // Selesaikan SEMUA booking terapis (mendukung 1 terapis = beberapa treatment)
          const ids = Array.isArray(t.currentBookingIds) && t.currentBookingIds.length
            ? t.currentBookingIds
            : (t.currentBookingId ? [t.currentBookingId] : []);
          ids.forEach((bId) => {
            completeBooking(t.currentOutletId, bId, t.id).catch(() => {});
          });
        }
      });
    }

    const unsub = listenAllTherapists((all) => {
      latestTherapists = all;
      checkAndComplete();
    });
    const interval = setInterval(checkAndComplete, 20000); // cek tiap 20 detik

    return () => { unsub(); clearInterval(interval); };
  }, [user, profile]);

  if (authLoading) return <div className="app"><p>Memuat...</p></div>;
  if (!user) return <LoginPage />;
  if (!profile) {
    return (
      <div className="app">
        <p>Akun Anda belum diberi akses (role/outlet). Hubungi admin pusat.</p>
        <button onClick={logout}>Keluar</button>
      </div>
    );
  }

  const isAdminPusat = profile.role === 'admin_pusat';
  const visibleOutlets = isAdminPusat ? OUTLETS : OUTLETS.filter((o) => o.id === profile.outletId);
  const currentPage = PAGES[activePage];
  const allowedKeys = RESTRICTED_ROLE_PAGES[profile.role] || null;
  const visiblePageEntries = Object.entries(PAGES).filter(([key, p]) => {
    if (p.adminOnly && !isAdminPusat) return false;
    if (p.roles && !p.roles.includes(profile.role)) return false;
    if (allowedKeys && !allowedKeys.includes(key)) return false;
    return true;
  });

  const userName = profile.name || user.email || 'Pengguna';
  const roleLabel = ROLE_LABEL[profile.role] || profile.role;
  const activeOutletName = OUTLETS.find((o) => o.id === activeOutlet)?.name || activeOutlet;

  return (
    <div className="app-shell">
      {/* ===== Sidebar navigasi ===== */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">🫧</span>
          <span className="sidebar-brand-text">
            <strong>Dayang Spa</strong>
            <small>Sistem Manajemen</small>
          </span>
        </div>
        <nav className="sidebar-nav">
          {visiblePageEntries.map(([key, p]) => (
            <button
              key={key}
              className={activePage === key ? 'nav-item active' : 'nav-item'}
              onClick={() => setActivePage(key)}
            >
              <span className="nav-icon">{p.icon}</span>
              <span className="nav-label">{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{userName.charAt(0).toUpperCase()}</div>
          <div className="sidebar-user-text">
            <strong>{userName}</strong>
            <small>{roleLabel}</small>
          </div>
          <button className="logout-btn" onClick={logout} title="Keluar">⎋</button>
        </div>
      </aside>

      {/* ===== Area utama ===== */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{currentPage.label}</h1>
            {!currentPage.global && visibleOutlets.length > 1 && (
              <span className="outlet-switch">
                {visibleOutlets.map((o) => (
                  <button
                    key={o.id}
                    className={activeOutlet === o.id ? 'chip active' : 'chip'}
                    onClick={() => setActiveOutlet(o.id)}
                  >
                    {o.name}
                  </button>
                ))}
              </span>
            )}
          </div>
          {!currentPage.global && (
            <span className="topbar-outlet-label">Outlet: {activeOutletName}</span>
          )}
        </header>

        <main className="content">
          {visiblePageEntries.map(([key, p]) => (
            <div key={key} style={{ display: activePage === key ? 'block' : 'none' }}>
              <p.Component outletId={activeOutlet} active={activePage === key} />
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
