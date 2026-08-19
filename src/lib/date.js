// Small date helpers built on the native Date, working in the browser's local
// timezone. Content times are stored as ISO strings; day-level grouping uses the
// local calendar day so the calendar matches what the user sees on their clock.

const PAD = (n) => String(n).padStart(2, '0');

export function parse(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Local YYYY-MM-DD key for grouping by calendar day.
export function dayKey(value) {
  const d = parse(value);
  if (!d) return null;
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

// Value for a <input type="datetime-local"> from an ISO string, in local time.
export function toDatetimeLocal(value) {
  const d = parse(value);
  if (!d) return '';
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}T${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}

// datetime-local string -> ISO string (treats the input as local time).
export function fromDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

// Monday-based start of the week containing d.
export function startOfWeek(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  return addDays(x, -dow);
}

export function isSameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

export function isSameMonth(a, b) {
  const x = parse(a);
  const y = parse(b);
  return x && y && x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
}

// A 6x7 grid of days covering the month of `d` (Monday-first), for the calendar.
export function monthMatrix(d) {
  const first = startOfWeek(startOfMonth(d));
  const weeks = [];
  let cursor = first;
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthYear(d) {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shortMonth(d) {
  return MONTHS[parse(d).getMonth()].slice(0, 3);
}

export function longDate(d) {
  const x = parse(d);
  return `${DAYS[x.getDay()]}, ${x.getDate()} ${MONTHS[x.getMonth()].slice(0, 3)} ${x.getFullYear()}`;
}

export function shortDate(d) {
  const x = parse(d);
  if (!x) return '';
  return `${x.getDate()} ${MONTHS[x.getMonth()].slice(0, 3)}`;
}

export function time(d) {
  const x = parse(d);
  if (!x) return '';
  return `${PAD(x.getHours())}:${PAD(x.getMinutes())}`;
}
