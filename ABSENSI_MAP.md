# COMPLETE MAP: Employee Attendance (Absensi) & Shift System
**Codebase analyzed:** D:\dayang-spa-v2 (Vite + React SPA, Supabase backend, Indonesian UI)
**Date:** Fri Oct 02 2026
## 1. Attendance Page (Absensi)
**Primary file:** `src/pages/AbsensiPage.jsx` (104 lines)

### Route
- Route key: `"absensi"` in `src/App.jsx` (PAGES object)
- Entry in v2 App.jsx: `absensi: { label: 'Absensi', icon: 'o.', Component: AbsensiPage }`
- Imported: `import AbsensiPage from './pages/AbsensiPage';` (App.jsx)
- Also appears in kasir mode home tiles: `KASIR_HOME_TILES` includes `{ key: 'absensi', ... }` (visible to kasir role)

### Component signature
- `export default function AbsensiPage({ outletId, active })` (v2)

### Input fields / controls
1. **Pilih karyawan (Employee selection)** - lines 55-68
- Lists all employees from `employees` state (populated by `listenAllTherapists`)
- Renders as buttons: `key={e.id}`, active if `selEmployee?.id === e.id`, displays `e.name`
- On click sets `selEmployee(e)`

2. **Pilih status kehadiran (Status selection)** - lines 70-83
- Renders buttons for each entry in `STATUS_LABELS` (maps ATTENDANCE_TYPES -> Indonesian labels)
- Labels: Hadir, Sakit, Izin, Telat, Alpha, Lembur
- Active if `selStatus === key`, sets `selStatus(key)` on click

3. **Overtime minutes (conditional)** - lines 85-92
- Only shown when `selStatus === ATTENDANCE_TYPES.LEMBUR`
- Number input: placeholder "Menit lembur", value `overtimeMinutes`, controlled

4. **Message area** - line 94: shows `{message}` when set
5. **Simpan button** - lines 96-101
- Disabled if missing selection or saving
- Calls `handleSave()` on click

### Data loading
```javascript
useEffect(() => {
  if (!active) return;
  const unsub = listenAllTherapists(setEmployees);
  return () => unsub();
}, [active]);
```
- Gets all employees from global therapists collection (includes terapis + staf)

### Save logic
```javascript
await recordAttendance({
  outletId,
  employeeId: selEmployee.id,
  employeeName: selEmployee.name,
  type: selStatus,
  overtimeMinutes: selStatus === ATTENDANCE_TYPES.LEMBUR ? Number(overtimeMinutes) : undefined
});
```

### Status values
From `src/lib/constants.js` (v2 lines 104-111):
```javascript
export const ATTENDANCE_TYPES = {
  HADIR: 'hadir',
  SAKIT: 'sakit',
  IZIN: 'izin',
  TELAT: 'telat',
  ALPHA: 'alpha',
  LEMBUR: 'lembur' // overtime
};
```
Labels in AbsensiPage: Hadir/Sakit/Izin/Telat/Alpha/Lembur

### Outlet/date scoping
- `outletId` prop passed from App (context); stored as `outlet_id` (nullable)
- Date determined by `todayId()` in service (WIB-local: adds +7h before ISO slice)
## 2. Attendance Service
**File:** `src/lib/attendanceService.js` (v2, 61 lines)

### Dependencies
- `import { supabase } from './supabase';`
- `import { ATTENDANCE_TYPES } from './constants';`

### `todayId(date = new Date())` (lines 4-7)
```javascript
function todayId(date = new Date()) {
  // WIB = UTC+7: label "hari" harus pakai tanggal WIB, bukan UTC.
  return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}
```
Returns YYYY-MM-DD in WIB timezone (local business day). Important for correct date boundaries.

### `recordAttendance({...})` (lines 9-23)
Exports async function. Parameters:
```javascript
{ outletId, employeeId, employeeName, type, overtimeMinutes, note, date }
```

Behavior:
- Computes `dayId = todayId(date ? new Date(date) : new Date())`
- Upserts to `attendance` table with Supabase:
```javascript
await supabase.from('attendance').upsert({
  employee_id: employeeId,
  employee_name: employeeName,
  outlet_id: outletId || null,
  date: dayId,
  type,
  overtime_minutes: type === ATTENDANCE_TYPES.LEMBUR ? (overtimeMinutes || 0) : 0,
  note: note || ''
});
```
- Sets `overtime_minutes = 0` for non-LEMBUR types
- Throws if error

### `getAttendanceRange(startDate, endDate, outletId)` (lines 25-44)
- Builds query on `attendance`: filters `date >= startDate` and `date <= endDate`
- If `outletId` provided, adds `.eq('outlet_id', outletId)`
- Maps returned rows to normalized shape:
```javascript
{
  id: `${r.employee_id}_${r.date}`,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  outletId: r.outlet_id,
  date: r.date,
  type: r.type,
  overtimeMinutes: r.overtime_minutes,
  note: r.note
}
```

### `summarizeAttendance(records)` (lines 46-61)
Aggregates per employee (by `employeeId`), initializing counters: hadir, sakit, izin, telat, alpha, lembur, overtimeMinutes (all numbers)
- Increments `rec[r.type] += 1` if key exists
- If type is LEMBUR, adds `(r.overtimeMinutes || 0)` to `rec.overtimeMinutes`
- Returns object keyed by employeeId with values containing employeeId, employeeName and counts

Notes (v2): Uses Supabase (not Firebase). Field names use snake_case in DB, mapped to camelCase in return.
## 3. Attendance Report / Recap
**File:** `src/pages/LaporanAbsensiPage.jsx` (v2, 138 lines)
- Route key in App.jsx: `"laporanAbsensi"` (global page)
- Entry: `laporanAbsensi: { label: 'Laporan Absensi', icon: 'dY"<', Component: LaporanAbsensiPage, global: true }`
- Imported in App.jsx

### What it shows
Displays attendance summary per employee for selected date range and optional outlet filter. Shows:
- Per employee card: `employeeName`
- Counts: Hadir, Sakit, Izin, Telat, Alpha, Lembur
- Manual overtime minutes if > 0: shows `(s.overtimeMinutes} menit)`
- Auto overtime (from booking data): "Lembur otomatis (dari booking): X menit (Y hari)" if > 0
- Total lembur: `(manual + auto)` menit if > 0
- Empty state if no data

### Filters
1. **Rentang tanggal (Date range)** - lines 80-86
- Start date: `<input type="date">` bound to `startDate` (state)
- End date: bound to `endDate`
- Default: `todayId()` which gives WIB-local YYYY-MM-DD (adds +7h)

2. **Outlet** - lines 88-98
- Select dropdown with value `outletFilter` (empty string = Semua outlet)
- Options from `OUTLETS` constant

### Actions
- "Tampilkan laporan" button (line 100-102): calls `handleLoad()`, disabled while loading
- "⬇ Download Excel" button (line 110-112, shown only if summary has data): calls `handleDownload()`

### How it loads data (`handleLoad`, lines 20-56)
1. Gets attendance records: `const records = await getAttendanceRange(startDate, endDate, outletFilter || undefined)`
2. Builds summary: `const summary = summarizeAttendance(records)`
3. Loads auto overtime from bookings: `const autoOt = await getOvertimeByEmployee(startDate, endDate)`
4. Merges auto overtime into summary per employee:
- Sets `s.autoOvertimeMinutes = a.totalOvertimeMinutes`, `s.autoOvertimeDays = a.daysCount` for matching employees
5. Handles employees with only auto overtime (no manual attendance): if outletFilter is empty string, adds missing entries from autoOt into summary with zero attendance counts
6. Sets summary state

### Service calls
- `getAttendanceRange(startDate, endDate, outletFilter || undefined)` from `src/lib/attendanceService.js`
- `summarizeAttendance(records)` from attendanceService
- `getOvertimeByEmployee(startDate, endDate)` from `src/lib/overtimeService.js`

### Excel export (`handleDownload`, lines 58-71)
Headers: ['Nama Karyawan', 'Hadir', 'Sakit', 'Izin', 'Telat', 'Alpha', 'Lembur', 'Menit Lembur Manual', 'Lembur Otomatis (Menit)', 'Total Lembur (Menit)']
Row values include manual overtime, auto overtime, and computed total. Exports via `exportExcelReport` with filename pattern `Laporan-Absensi-${outletLabel}-${startDate}_${endDate}`.
## 4. Shift Definitions
**File:** `src/lib/constants.js` (v2)

### SHIFTS constant (line 77)
```javascript
export const SHIFTS = { SP: 'sp', SP1: 'sp1', SP2: 'sp2', MALAM: 'malam', ST: 'st', AD: 'AD', T11: '11' };
```
Keys map to string codes:
- SP -> 'sp'
- SP1 -> 'sp1'  
- SP2 -> 'sp2'
- MALAM -> 'malam'
- ST -> 'st'
- AD -> 'AD'
- T11 -> '11' (note: key is T11, value is '11')

### SHIFT_LABEL (lines 78-88)
```javascript
export const SHIFT_LABEL = {
  sp: 'Shift SP (Split)',
  sp1: 'Shift SP1 (11-14, 17-22)',
  sp2: 'Shift SP2 (12-15, 18-23)',
  malam: 'Shift Malam',
  AD: 'Shift AD (15-23)',
  '11': 'Shift 11 (11-23)',
  st: 'Shift ST (Short Time)'
};
```
Indonesian labels with time ranges shown in labels for some shifts.

### SHIFT_SHORT_CODE (line 89)
```javascript
export const SHIFT_SHORT_CODE = { sp: 'Sp', sp1: 'SpA1', sp2: 'SpA', malam: '15', AD: 'AD', '11': '11', st: 'St' };
```
(Note: in the file as read, SP2 shows as 'SpA' - possibly character encoding artifact in the display; value is 'SpA' followed by something; but the logical mapping is present.)

### Shift start/end times (how expressed)
Shift time ranges are **documented as strings in labels** (human-readable) and **quantified as end minutes from midnight** for overtime calculation in `overtimeService.js`.

**From `src/lib/overtimeService.js` (lines ~10-28):**
```javascript
export const SHIFT_END_MINUTES = {
  [SHIFTS.SP]: 23 * 60,      // 23:00
  [SHIFTS.SP1]: 22 * 60,     // 22:00
  [SHIFTS.SP2]: 23 * 60,     // 23:00
  [SHIFTS.MALAM]: 23 * 60,   // 23:00
  [SHIFTS.AD]: 23 * 60,      // 23:00
  [SHIFTS.T11]: 23 * 60,     // 23:00 (T11 is key, maps to value '11')
  [SHIFTS.ST]: 16 * 60       // 16:00
};
```

**Comment above in overtimeService.js explains:**
- Shift SP1 : 11:00-14:00 & 17:00-22:00   -> selesai 22:00
- Shift SP2 : 12:00-15:00 & 18:00-23:00   -> selesai 23:00
- Shift SP  : 11:00-15:00 & 18:00-23:00   -> selesai 23:00
- Shift Malam / 15: 15:00-23:00           -> selesai 23:00
- Shift 11 (T11/'11'): 11:00-23:00        -> selesai 23:00
- Shift ST / Short: 11:00-16:00            -> selesai 16:00

**Key observation:** Shift times are expressed as **minutes from midnight (local time, WIB)** for end-of-shift calculations. The actual shift definitions (start/end schedule, possibly split shifts) are encoded in comments and in the labels shown in UI. The codebase uses end-minute values for overtime computation.
## 5. Therapist Shift Field
**Field:** `therapists.shift` (text column in DB schema)

### Where is `therapists.shift` used/set?
**Service layer:** `src/lib/therapistService.js`
- `setTherapistShift(therapistId, shift)` (v2 lines ~137-140 in the full file):
```javascript
export async function setTherapistShift(therapistId, shift) {
  const { error } = await supabase.from('therapists').update({ shift: shift || null }).eq('id', therapistId);
  if (error) throw error;
}
```
Sets `shift` to provided value or null. Value should be one of the shift codes from SHIFTS (e.g., 'sp', 'sp1', 'sp2', 'malam', 'st', 'AD', '11').

**UI/Page where assignment happens:** `src/pages/KelolaTerapisPage.jsx`
- Imports: `SHIFTS, SHIFT_LABEL` from constants and `setTherapistShift` from therapistService (line 3)
- Renders a shift dropdown for each therapist (lines 95-103 in KelolaTerapisPage):
```javascript
<select
  value={t.shift || ''}
  onChange={(e) => handleSetShift(t, e.target.value)}
  style={{ padding: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }}
>
  <option value="">Shift: -</option>
  {Object.entries(SHIFT_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
</select>
```
- `handleSetShift(t, shift)` (line 42-44) calls `setTherapistShift(t.id, shift)` when value changes
- Page title: "Kelola Terapis", admin-only in App.jsx (has `adminOnly: true`, `global: true`)

**Schema:** `therapists.shift` is defined as `shift text` in `supabase/schema.sql` line 50 (nullable). Also appears in update script `supabase/update_therapists_2026-09-27.sql` which bulk-sets shifts by name mapping (shows shift values like 'sp1','sp2','15','st','11' etc. matching codes).

**Conclusion:** Shift assignment is done via **Kelola Terapis page** (admin-only) which uses `setTherapistShift` to update `therapists.shift` in the database.
## 6. RPC Functions (Supabase SQL)
**Searched in:** `supabase/*.sql` files under `D:\dayang-spa-v2`

### Attendance-related RPCs
**No RPC function named `record_attendance` found** in the SQL migrations/schema. Attendance is handled via direct table operations (Supabase upsert to `attendance` table) from the client service `attendanceService.js`, not via a stored procedure. The schema has RLS policies allowing authenticated access.

### Other notable RPCs found (for context, not attendance-specific)
The schema.sql and migrations define many booking/inventory RPCs, e.g.:
- `clear_therapist_session(p_therapist_id uuid)` (schema.sql ~231-250)
- `create_booking(...)` returns uuid (schema.sql ~256+)
- `complete_booking(...)` (schema.sql ~329+)
- `mark_booking_paid(...)` (schema.sql ~349+)
- `cancel_booking_full(...)`, `cancel_booking_partial(...)`
- `edit_booking_details(...)`
- `create_booking_batch(p_items jsonb, p_group_id text)` returns table
- `adjust_oil_stock(...)`, `stock_in_out(...)`

No attendance insert/update RPC functions were found in the SQL files. Attendance operations are application-side direct DB writes.

### Shift-related SQL
- `schema.sql` line 50: `shift text` in therapists table
- `supabase/update_therapists_2026-09-27.sql`: bulk update script setting `shift` values by therapist name (values like 'sp1','sp2','15','st','11' etc.) and also setting `home_outlet_id` and `status`
## 7. Table Shape
### attendance table (from `supabase/schema.sql` lines 167-178)
```sql
create table if not exists attendance (
  employee_id uuid not null,                 -- id di tabel therapists
  employee_name text,
  outlet_id text references outlets(id),
  date text not null,                        -- YYYY-MM-DD
  type attendance_type not null default 'hadir',
  overtime_minutes int not null default 0,
  note text default '',
  recorded_at timestamptz not null default now(),
  primary key (employee_id, date)
);
```

**Fields:**
- `employee_id` (uuid, NOT NULL) - FK to therapists.id conceptually (no explicit FK constraint shown; comment says "id di tabel therapists")
- `employee_name` (text, nullable)
- `outlet_id` (text, FK to outlets(id), nullable) - records where input happened
- `date` (text, NOT NULL, YYYY-MM-DD) - composite PK part with employee_id
- `type` (attendance_type enum, NOT NULL, default 'hadir') - enum values: hadir, sakit, izin, telat, alpha, lembur
- `overtime_minutes` (int, NOT NULL, default 0) - populated when type is lembur
- `note` (text, default empty)
- `recorded_at` (timestamptz, NOT NULL, default now())

**Constraints:**
- Primary key on `(employee_id, date)` - one attendance record per employee per day

**Enum type:** `attendance_type` defined at schema.sql line 20: `('hadir','sakit','izin','telat','alpha','lembur')`

**RLS:** Enabled, policy "authenticated all" for CRUD (schema.sql lines 194, 204, 215)

### therapists table - shift/overtime related columns (from `supabase/schema.sql` lines 44-63)
```sql
create table if not exists therapists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'terapis',
  home_outlet_id text references outlets(id),
  shift text,                                 -- SHIFT FIELD (nullable)
  status therapist_status not null default 'free',
  current_outlet_id text references outlets(id),
  current_booking_ids jsonb,
  current_booking_id text,
  current_treatment_names jsonb,
  current_treatment_name text,
  current_paid boolean,
  current_payment_method text,
  current_price numeric,
  current_group_id text,
  start_at bigint,
  end_at bigint
);
```

**Shift-related:** `shift text` (nullable) - stores shift code (sp, sp1, sp2, malam, st, AD, '11')
**Overtime-related:** No direct overtime columns on therapists; overtime is computed from bookings (end times) vs shift end times, and can be manually adjusted via `overtime_adjustments` table (from migration `add_overtime_adjustments.sql`).

**Overtime adjustments table (supporting):**
```sql
create table if not exists public.overtime_adjustments (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references therapists(id) on delete cascade,
  work_date date not null,
  adjusted_minutes integer not null default 0,
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (therapist_id, work_date)
);
```
This stores manual overtime overrides that take precedence over calculated overtime.
## 8. Roles / Permissions
### Role values found
From `src/lib/constants.js` (v2 lines 91-97, STAFF_ROLES):
```javascript
export const STAFF_ROLES = {
  SENIOR_TERAPIS: 'senior_terapis',
  KASIR: 'kasir_staff',
  TERAPIS: 'terapis',
  TRAINING_TERAPIS: 'training_terapis',
  TRAINING_BARU: 'training_baru'
};
```
These are staff/therapist role classifications (for employees in therapists collection).

From App/user roles (system access roles):
**In `src/App.jsx` (v2):** ROLE_LABEL defined around line 72-76:
```javascript
const ROLE_LABEL = {
  admin_pusat: 'Admin Pusat',
  kasir: 'Kasir',
  order_taker: 'Order Taker'
};
```
Also RESTRICTED_ROLE_PAGES (line 67-69): `order_taker` restricted to certain pages.

**In `src/lib/authService.js` (v2 line 22):** Returns profile with `role`, `outletId`, `name` from users table. The users table (schema.sql line 37-42) has `role text not null default 'kasir'` with comment indicating possible values: `-- admin_pusat | kasir | order_taker` (from comment context in original v1; in v2 schema just has default 'kasir').

**How app determines user role/type:**
- User profile stored in `users` table (Supabase Auth linked by id). Profile has `role` field.
- `listenAuthState` in authService fetches profile from DB.
- In App.jsx:
  - `isAdminPusat = profile.role === 'admin_pusat'`
  - For kasir role (`profile.role === 'kasir'`): sets `activeOutlet = profile.outletId`, sets active page to 'beranda' (kasir mode), and kasir sees simplified UI (home tiles)
  - `isOffice = (user.email || '').trim().toLowerCase() === 'office.op@dayang.com'` (line ~140 in App.jsx) - special office account check
  - Page visibility logic (lines ~145+ in App.jsx):
```javascript
const visiblePageEntries = Object.entries(PAGES).filter(([key, p]) => {
  if (p.adminOnly && !isAdminPusat) return false;
  if (p.officeOnly && !isOffice) return false;
  if (p.roles && !p.roles.includes(profile.role)) return false;
  if (allowedKeys && !allowedKeys.includes(key)) return false;
  return true;
});
```
- Restricted pages for order_taker: `RESTRICTED_ROLE_PAGES = { order_taker: ['ambilOrder', 'status', 'ringkasan'] }` (lines 67-69)
- Some pages have `adminOnly: true` (e.g., kelolaTerapis), some have `officeOnly: true` (e.g., koreksiBooking, overtime, logAktivitas, periksaKomisi), some have `roles` array

**Role values summary (system access roles from users.role):**
- `admin_pusat` - admin pusat; `isAdminPusat` true; can see admin-only pages
- `kasir` - kasir; gets kasir home mode, outlet scoped to their outlet
- `order_taker` - order taker; restricted to specific pages only

**Therapist/staff classification roles (therapists.role / STAFF_ROLES):** Different from system access roles - these classify employee type (senior_terapis, kasir_staff, terapis, training_terapis, training_baru). Used in KelolaTerapisPage for assignment.
## Summary of Key File Paths (v2)
- Absensi page: `src/pages/AbsensiPage.jsx`
- Attendance service: `src/lib/attendanceService.js`
- Attendance report: `src/pages/LaporanAbsensiPage.jsx`
- Constants (shifts/attendance types): `src/lib/constants.js`
- Therapist service (shift setter): `src/lib/therapistService.js`
- Shift assignment UI: `src/pages/KelolaTerapisPage.jsx`
- App routes/roles: `src/App.jsx`
- Schema: `supabase/schema.sql`
- Overtime logic: `src/lib/overtimeService.js`
- Overtime adjustments migration: `supabase/add_overtime_adjustments.sql`
