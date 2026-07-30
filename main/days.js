// Day logs. One store key per day — `day:2026-07-28` — never all history in one.

import * as store from './store.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['pending', 'synced', 'error', 'local']);

function assertDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  }
  return date;
}

// The renderer owns entry state; main only guards the shape, so that one bad
// write can never make a whole day unloadable.
function normaliseEntry(raw) {
  const startTs = Number(raw?.startTs);
  if (!Number.isFinite(startTs)) return null;
  const endTs = raw.endTs === null || raw.endTs === undefined ? null : Number(raw.endTs);
  if (endTs !== null && !Number.isFinite(endTs)) return null;

  return {
    id: String(raw.id),
    issueKey: raw.issueKey ? String(raw.issueKey) : null,
    issueId: raw.issueId ? String(raw.issueId) : null,
    title: String(raw.title ?? ''),
    startTs,
    endTs,
    status: STATUSES.has(raw.status) ? raw.status : 'pending',
    worklogId: raw.worklogId ? String(raw.worklogId) : null,
    // Jira's Work Description. Held as plain text; the ADF it becomes is built at
    // the Jira boundary, in main/jira/adf.js.
    comment: raw.comment ? String(raw.comment) : null,
    errorMsg: raw.errorMsg ? String(raw.errorMsg) : null,
  };
}

export async function getDay(date) {
  assertDate(date);
  const saved = await store.get(`day:${date}`);
  const entries = Array.isArray(saved?.entries)
    ? saved.entries.map(normaliseEntry).filter(Boolean)
    : [];
  return { date, entries };
}

export async function saveDay(date, entries) {
  assertDate(date);
  const clean = (Array.isArray(entries) ? entries : []).map(normaliseEntry).filter(Boolean);
  await store.set(`day:${date}`, { date, entries: clean });
  return { date, entries: clean };
}

// Survives a crash or a quit while the timer is running. Kept out of the day
// log so restoring it can never corrupt logged entries.
export async function getRunningTimer() {
  return (await store.get('timer')) ?? null;
}

export async function saveRunningTimer(timer) {
  if (!timer) return store.del('timer');
  return store.set('timer', timer);
}
