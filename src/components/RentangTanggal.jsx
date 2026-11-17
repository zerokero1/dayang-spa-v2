import { businessDate, shiftBusinessDate } from '../lib/businessDate';

/** Senin sebagai awal minggu, sama seperti halaman stok/inventory. */
function startOfWeek(dateStr) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return shiftBusinessDate(dateStr, -((day + 6) % 7));
}

function previousMonthRange(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10)
  };
}

/** Rentang bulan penuh sebelum bulan `today` (YYYY-MM-DD). */
export function rentangBulanLalu(today = businessDate()) {
  return previousMonthRange(today);
}

/** Pilihan rentang cepat yang dipakai halaman laporan. */
export function presetRentang(today = businessDate()) {
  const prev = previousMonthRange(today);
  return [
    { label: 'Hari ini', start: today, end: today },
    { label: '7 hari', start: shiftBusinessDate(today, -6), end: today },
    { label: '30 hari', start: shiftBusinessDate(today, -29), end: today },
    { label: 'Minggu ini', start: startOfWeek(today), end: today },
    { label: 'Bulan ini', start: `${today.slice(0, 7)}-01`, end: today },
    { label: 'Bulan lalu', start: prev.start, end: prev.end }
  ];
}

/**
 * Pemilih rentang tanggal standar untuk halaman laporan.
 *
 * Hanya mengatur tampilan dan validasi tanggal; pemuatan data tetap milik
 * halaman masing-masing lewat `onChange`. Tanggal akhir otomatis mengikuti
 * tanggal awal kalau pengguna memilih awal yang lebih besar, supaya rentang
 * tidak pernah terbalik.
 */
export default function RentangTanggal({
  startDate,
  endDate,
  onChange,
  presets,
  label = 'Rentang tanggal',
  hint,
  children
}) {
  const list = presets || presetRentang();
  const isActive = (p) => p.start === startDate && p.end === endDate;

  return (
    <section className="rentang-tanggal">
      <p className="section-title">{label}</p>

      <div className="preset-buttons" role="group" aria-label="Pilihan rentang tanggal cepat">
        {list.map((p) => (
          <button
            type="button"
            key={p.label}
            className={isActive(p) ? 'active' : ''}
            aria-pressed={isActive(p)}
            onClick={() => onChange(p.start, p.end)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="date-range">
        <label>
          Dari
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              onChange(value, endDate && value <= endDate ? endDate : value);
            }}
          />
        </label>
        <span className="date-range-sep">s/d</span>
        <label>
          Sampai
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              // Jaga rentang tetap valid walau tanggal diketik manual (bukan
              // lewat date picker yang sudah punya atribut min).
              onChange(value < startDate ? value : startDate, value);
            }}
          />
        </label>
        {children}
      </div>

      {hint && <p className="rentang-hint">{hint}</p>}
    </section>
  );
}
