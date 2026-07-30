// Renderer state and the persistence it needs. `window.joggl` is the preload
// bridge; there is no other way out of this process.

import { DAY, debounce, startOfDayMs, todayKey } from './util.js';

const api = window.joggl;

export const state = {
  selectedDate: todayKey(),
  /** Entries for `selectedDate` only. Other days are read on demand. */
  entries: [],
  /**
   * Worklogs this account has in Jira for `selectedDate` that Joggl did not
   * create — time booked straight into the Jira web UI. Read-only, never
   * persisted, merged in only at render time so they cannot contaminate the
   * day log.
   */
  externalEntries: [],
  externalState: 'idle', // idle | loading | loaded | error
  externalError: null,
  /**
   * The entry a click marked, drawn in both panels at once. Not persisted: it says
   * what is being looked at, which does not survive closing the window, and not the
   * same thing as focus, which is per-panel and moves away the moment you type.
   */
  selectedEntryId: null,
  /** null when idle. mergeChoice is decided at start and applied at stop. */
  timer: null,
  /** Issues loaded from the configured task sources. */
  issues: [],
  issuesBySource: new Map(),
  pins: [],
  settings: { baseUrl: '', email: '', taskSources: [], tokenConfigured: false },
  /**
   * Filled by loadUi() before anything renders. Deliberately empty rather than a
   * second copy of the defaults: main/settings.js owns them, and a duplicate here
   * only ever drifts — it already had neither `sidebarCollapsed` nor `activeView`.
   */
  ui: {},
};

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3];
export const PX_PER_MIN_BASE = 1.5;

export function pxPerMin() {
  return PX_PER_MIN_BASE * (ZOOM_LEVELS[state.ui.zoomIdx] ?? 1);
}

export function isToday() {
  return state.selectedDate === todayKey();
}

// ── Day log ────────────────────────────────────────────────────────────────
//
// A crash must never cost more than the current minute, so every edit schedules
// a write and the important moments (stop, merge, sync) force one immediately.

export async function loadDay(date) {
  const day = await api.days.get(date);
  state.selectedDate = date;
  state.entries = day.entries;
  // Belongs to the day being left, not the one being opened.
  state.externalEntries = [];
  state.externalState = 'idle';
  state.externalError = null;
  return state.entries;
}

export async function persistDayNow() {
  await api.days.save(state.selectedDate, state.entries);
}

export const persistDay = debounce(() => {
  persistDayNow().catch((err) => console.error('Failed to save day log:', err));
}, 500);

export async function readDay(date) {
  return api.days.get(date);
}

export async function writeDay(date, entries) {
  return api.days.save(date, entries);
}

// ── Running timer ──────────────────────────────────────────────────────────

export async function loadTimer() {
  state.timer = await api.timer.get();
  return state.timer;
}

export async function persistTimer() {
  await api.timer.save(state.timer);
}

// ── Settings, pins, UI prefs ───────────────────────────────────────────────

export async function loadSettings() {
  state.settings = await api.settings.get();
  return state.settings;
}

export async function saveSettings(patch) {
  state.settings = await api.settings.save(patch);
  return state.settings;
}

export async function loadPins() {
  state.pins = await api.pins.get();
  return state.pins;
}

export async function savePins(pins) {
  state.pins = await api.pins.save(pins);
  return state.pins;
}

export async function loadUi() {
  state.ui = await api.ui.get();
  return state.ui;
}

export async function saveUi(patch) {
  state.ui = await api.ui.save({ ...state.ui, ...patch });
  return state.ui;
}

// ── Jira, always via main ──────────────────────────────────────────────────

export function searchJira(jql, maxResults) {
  return api.jira.search(jql, maxResults);
}

export function lookupJira(query, limit) {
  return api.jira.lookup(query, limit);
}

/**
 * Create or rewrite the worklog for an entry.
 *
 * An entry that already carries a worklogId is one Joggl has synced before and
 * the user has since edited, so its worklog is updated in place. Posting a
 * second one is the double-booking the worklogId exists to prevent.
 */
export function submitWorklog(entry) {
  const target = entry.issueId ?? entry.issueKey;
  return entry.worklogId
    ? api.jira.updateWorklog(target, entry.worklogId, entry.startTs, entry.endTs, entry.comment)
    : api.jira.submitWorklog(target, entry.startTs, entry.endTs, entry.comment);
}

export function deleteWorklog(entry) {
  return api.jira.deleteWorklog(entry.issueId ?? entry.issueKey, entry.worklogId);
}

/** Pull the day's Jira-side worklogs. Failure is non-fatal: the local day still works. */
export async function loadExternalWorklogs(date = state.selectedDate) {
  if (!state.settings.baseUrl || !state.settings.tokenConfigured) {
    state.externalEntries = [];
    state.externalState = 'idle';
    return [];
  }

  const dayStartTs = startOfDayMs(date);
  state.externalState = 'loading';
  state.externalError = null;

  try {
    const worklogs = await api.jira.dayWorklogs(date, dayStartTs, dayStartTs + DAY);
    // A day change mid-request must not drop yesterday's answer onto today.
    if (date !== state.selectedDate) return [];
    state.externalEntries = worklogs.map((w) => ({
      ...w,
      id: `jira:${w.worklogId}`,
      status: 'synced',
      errorMsg: null,
      external: true,
    }));
    state.externalState = 'loaded';
    return state.externalEntries;
  } catch (err) {
    if (date !== state.selectedDate) return [];
    state.externalEntries = [];
    state.externalState = 'error';
    state.externalError = err.message;
    throw err;
  }
}

/**
 * The day as it should be shown: local entries plus any Jira-side worklog that
 * no local entry already stands for.
 */
export function visibleEntries() {
  const claimed = new Set(state.entries.map((e) => e.worklogId).filter(Boolean));
  return [...state.entries, ...state.externalEntries.filter((e) => !claimed.has(e.worklogId))];
}

export function testConnection(creds) {
  return api.settings.testConnection(creds);
}

export function appVersion() {
  return api.app.version();
}

export function openLogFolder() {
  return api.app.openLogFolder();
}

/** Mirror a renderer-side failure into the log file, best effort. */
export function logToFile(level, message) {
  api.app.log(level, message).catch(() => {});
}
