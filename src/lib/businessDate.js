const BUSINESS_TIME_ZONE = 'Asia/Makassar';
const BUSINESS_UTC_OFFSET_HOURS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function businessDateFromTimestamp(timestamp) {
  return timestamp ? businessDate(new Date(timestamp)) : '';
}

export function shiftBusinessDate(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function businessDateDaysAgo(days, from = new Date()) {
  return shiftBusinessDate(businessDate(from), -days);
}

export function businessMonth(date = new Date()) {
  return businessDate(date).slice(0, 7);
}

/** Jam dan menit waktu Lombok (0-23, 0-59) dari sebuah Date. */
export function businessTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  // Sebagian mesin mengembalikan "24" untuk tengah malam.
  return { hour: get('hour') % 24, minute: get('minute') };
}

/**
 * Menit sejak 00:00 waktu Lombok. Dipakai untuk aturan yang bergantung pada
 * jam lokal (mis. status jendela shift) agar tidak ikut zona waktu perangkat.
 */
export function businessMinutesOfDay(date = new Date()) {
  const { hour, minute } = businessTimeParts(date);
  return hour * 60 + minute;
}

/** Jam WITA dengan format HH:mm (00:00–23:59), aman untuk ditampilkan. */
export function businessTimeStr(date = new Date()) {
  const { hour, minute } = businessTimeParts(date);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Epoch ms untuk jam tertentu (menit sejak 00:00) pada tanggal Lombok. */
export function businessDayMinutesToMs(dateString, minutes) {
  return startOfBusinessDayUtc(dateString).getTime() + Math.round(minutes) * 60000;
}

export function startOfBusinessDayUtc(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, -BUSINESS_UTC_OFFSET_HOURS));
}

export function endOfBusinessDayUtc(dateString) {
  return new Date(startOfBusinessDayUtc(dateString).getTime() + DAY_MS - 1);
}

export function businessRangeBoundsUtc(startDate, endDate) {
  return {
    startUtc: startOfBusinessDayUtc(startDate),
    endUtc: endOfBusinessDayUtc(endDate)
  };
}

export function businessRangeIso(startDate, endDate) {
  const { startUtc, endUtc } = businessRangeBoundsUtc(startDate, endDate);
  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}
