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
