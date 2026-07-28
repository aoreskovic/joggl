// Renderer state and the persistence it needs. `window.joggl` is the preload
// bridge; there is no other way out of this process.

import { debounce, todayKey } from './util.js';

const api = window.joggl;

export const state = {
  selectedDate: todayKey(),
  /** Entries for `selectedDate` only. Other days are read on demand. */
  entries: [],
  /** null when idle. mergeChoice is decided at start and applied at stop. */
  timer: null,
  /** Issues loaded from the configured task sources. */
  issues: [],
  issuesBySource: new Map(),
  pins: [],
  settings: { baseUrl: '', email: '', taskSources: [], tokenConfigured: false },
  ui: { zoomIdx: 2, fontSize: 9, panelWidth: 320, theme: 'system' },
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

export function submitWorklog(entry) {
  return api.jira.submitWorklog(entry.issueId ?? entry.issueKey, entry.startTs, entry.endTs);
}

export function testConnection(creds) {
  return api.settings.testConnection(creds);
}

export function appVersion() {
  return api.app.version();
}
