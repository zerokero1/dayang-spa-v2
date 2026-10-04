import { useMemo, useState } from 'react';
import AbsensiGrid from '../components/AbsensiGrid';
import { daysOfMonth, thisMonthWib } from '../lib/attendanceGrid';

/**
 * Tab "Bulanan" di halaman Absensi: grid satu bulan penuh + shortcut isi
 * satu hari untuk semua orang.
 *
 * Isi grid, editor sel, dan rekap S/A/I/Off ada di components/AbsensiGrid.jsx
 * supaya Laporan Absensi memakai tabel yang sama, bukan versi terpisah.
 */
export default function AbsensiBulanan({ active, employees, outletFilter, onOutletChange, user }) {
  const [month, setMonth] = useState(thisMonthWib);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const first = days[0]?.date || '';
  const last = days[days.length - 1]?.date || '';

  return (
    <AbsensiGrid
      active={active}
      employees={employees}
      outletFilter={outletFilter}
      onOutletChange={onOutletChange}
      user={user}
      days={days}
      first={first}
      last={last}
      showBulk
      controls={(
        <label>
          Bulan
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      )}
    />
  );
}