// Time and formatting helpers. Timestamps are epoch ms everywhere; these are the
// render-boundary conversions to local wall clock.

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const QUARTER = 15 * MINUTE;

export function uuid() {
  return crypto.randomUUID();
}

export function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

/**
 * Local calendar date as YYYY-MM-DD.
 * Not toISOString().slice(0,10) — that is UTC, so anyone east of Greenwich would
 * get tomorrow's key late in the evening and lose the day's entries.
 */
export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey() {
  return dateKey();
}

export function addDays(key, n) {
  const d = startOfDay(key);
  d.setDate(d.getDate() + n);
  return dateKey(d.getTime());
}

/** Local midnight for a YYYY-MM-DD key. */
export function startOfDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function startOfDayMs(key) {
  return startOfDay(key).getTime();
}

/**
 * Snap a timestamp to the nearest quarter hour on the clock — :00, :15, :30, :45.
 *
 * Measured from local midnight rather than from the epoch, and never from where a
 * drag happened to begin: snapping a drag *offset* instead would leave an entry
 * that started at 09:07 forever landing on :07, :22, :37, and make its minimum
 * length depend on the minute the timer was stopped.
 */
export function snapToQuarter(ts, dayKey) {
  const midnight = startOfDayMs(dayKey);
  return midnight + Math.round((ts - midnight) / QUARTER) * QUARTER;
}

export function formatDateLabel(key) {
  const d = startOfDay(key);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function tsToHHMM(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function msToHHMMSS(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function msToDur(ms) {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Parses "1h 30m", "90m", "1.5h". Returns null when nothing usable is found. */
export function parseDur(str) {
  const s = String(str).trim().toLowerCase();
  let ms = 0;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*h/);
  const m = s.match(/(\d+)\s*m(?!s)/);
  if (h) ms += parseFloat(h[1].replace(',', '.')) * HOUR;
  if (m) ms += parseInt(m[1], 10) * MINUTE;
  // A bare number is read as minutes — "45" almost always means 45 minutes.
  if (!h && !m && /^\d+$/.test(s)) ms = parseInt(s, 10) * MINUTE;
  return ms > 0 ? ms : null;
}

export function parseHHMM(str) {
  const m = String(str).trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return [h, min];
}

/** "09:30" + a day key → epoch ms in local time, or null when unparseable. */
export function hhmmToTs(str, key) {
  const parsed = parseHHMM(str);
  if (!parsed) return null;
  const d = startOfDay(key);
  d.setHours(parsed[0], parsed[1], 0, 0);
  return d.getTime();
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Pulls "PROJ-123" out of free text like `Standup (PROJ-123)`. */
export function extractIssueKey(text) {
  const m = String(text ?? '').match(/\b([A-Z][A-Z0-9_]+-\d+)\b/);
  return m ? m[1] : null;
}

/** Same shape, but case-insensitive — for deciding whether a query names an issue. */
export function looksLikeIssueKey(text) {
  return /\b[A-Za-z][A-Za-z0-9_]*-\d+\b/.test(String(text ?? ''));
}

/** At or below this many local matches, it is worth asking Jira as well. */
export const REMOTE_LOOKUP_BELOW = 2;

/**
 * Whether a query warrants going out to Jira on top of filtering the issues
 * already loaded.
 *
 * The loaded set is only what the configured JQL sources returned, so anything
 * Done, or assigned to somebody else, is simply not in it. Once the local list
 * has thinned out — or the query names a key outright — the remote lookup is
 * what makes the difference between finding an issue and not.
 */
export function shouldLookupRemote(query, localCount) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return false;
  return localCount <= REMOTE_LOOKUP_BELOW || looksLikeIssueKey(q);
}

export function stripTrailingKey(text) {
  return String(text ?? '')
    .replace(/\s*\(\s*[A-Z][A-Z0-9_]+-\d+\s*\)\s*$/, '')
    .trim();
}

export function debounce(fn, ms) {
  let handle = null;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}
