import { useEffect, useState } from 'react';
import { ATTENDANCE_TYPES } from '../lib/constants';
import { recordAttendance } from '../lib/attendanceService';
import { listenAllTherapists } from '../lib/therapistService';

const STATUS_LABELS = {
  [ATTENDANCE_TYPES.HADIR]: 'Hadir',
  [ATTENDANCE_TYPES.SAKIT]: 'Sakit',
  [ATTENDANCE_TYPES.IZIN]: 'Izin',
  [ATTENDANCE_TYPES.TELAT]: 'Telat',
  [ATTENDANCE_TYPES.ALPHA]: 'Alpha',
  [ATTENDANCE_TYPES.LEMBUR]: 'Lembur'
};

export default function AbsensiPage({ outletId }) {
  const [employees, setEmployees] = useState([]);
  const [selEmployee, setSelEmployee] = useState(null);
  const [selStatus, setSelStatus] = useState(null);
  const [overtimeMinutes, setOvertimeMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Karyawan (semua terapis + staf) sekarang di koleksi global /therapists
    const unsub = listenAllTherapists(setEmployees);
    return () => unsub();
  }, []);

  async function handleSave() {
    if (!selEmployee || !selStatus) return;
    setSaving(true);
    setMessage('');
    try {
      await recordAttendance({
        outletId,
        employeeId: selEmployee.id,
        employeeName: selEmployee.name,
        type: selStatus,
        overtimeMinutes: selStatus === ATTENDANCE_TYPES.LEMBUR ? Number(overtimeMinutes) : undefined
      });
      setMessage(`Absensi ${selEmployee.name} - ${STATUS_LABELS[selStatus]} tersimpan`);
      setSelEmployee(null); setSelStatus(null); setOvertimeMinutes('');
    } catch (e) {
      setMessage('Gagal menyimpan: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kasir-page">
      <h2>Absensi - {outletId}</h2>

      <section>
        <p>1. Pilih karyawan</p>
        <div className="grid-2">
          {employees.map((e) => (
            <button
              key={e.id}
              className={selEmployee?.id === e.id ? 'active' : ''}
              onClick={() => setSelEmployee(e)}
            >
              {e.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <p>2. Pilih status kehadiran</p>
        <div className="grid-2">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={selStatus === key ? 'active' : ''}
              onClick={() => setSelStatus(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {selStatus === ATTENDANCE_TYPES.LEMBUR && (
        <input
          type="number"
          placeholder="Menit lembur"
          value={overtimeMinutes}
          onChange={(e) => setOvertimeMinutes(e.target.value)}
        />
      )}

      {message && <p>{message}</p>}

      <button
        disabled={!selEmployee || !selStatus || saving}
        onClick={handleSave}
      >
        {saving ? 'Menyimpan...' : 'Simpan absensi'}
      </button>
    </div>
  );
}
