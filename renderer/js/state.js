// Renderer state and the persistence it needs. `window.joggl` is the preload
// bridge; there is no other way out of this process.

import {
  bucketByDay,
  eachDay,
  externalToEntries,
  installDayAccessors,
  missingDays,
} from './day-range.js';
import { createDayWriter } from './day-writes.js';
import { copyableEntries } from './entry-ops.js';
import { renderAll } from './render.js';
import { addDays, startOfDayMs, todayKey } from './util.js';

const api = window.joggl;

export const state = {
  selectedDate: todayKey(),
  /**
   * Every day loaded, keyed by day key. `state.entries` below is a live view onto
   * whichever one `selectedDate` names, so day-view code goes on saying
   * `state.entries` and cannot reach another day by accident.
   */
  days: new Map(),
  /**
   * Worklogs this account has in Jira that Joggl did not create — time booked
   * straight into the Jira web UI. Read-only, **never persisted**, merged in only at
   * render time so they cannot contaminate a day log.
   *
   * A session cache, keyed by day. A day is dropped from it only by
   * `invalidateExternal`, which every path that changes what Jira holds calls — Sync,
   * a worklog deleted from Jira, and ↻ Refresh, which is the user saying something
   * changed that Joggl has no way to know about. Writing a *day log* deliberately
   * does not drop it: a local edit changes nothing on Jira's side, so `persistDayNow`
   * has no business throwing this away.
   */
  external: new Map(),
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

installDayAccessors(state, { days: state.days, external: state.external });

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
  state.days.set(date, day.entries);
  // The rows themselves are deliberately *not* cleared any more — they are held per
  // day, so stepping back to a day just visited shows its Jira-side rows at once
  // instead of blanking and refetching. The flags are another matter: they describe
  // the day on screen, so carrying them across would render the previous day's error
  // note against this day until the new read lands.
  state.externalState = state.external.has(date) ? 'loaded' : 'idle';
  state.externalError = null;
  return state.entries;
}

/**
 * Every day write goes through one queue, so a write decided now cannot land on
 * whichever day happens to be selected when it runs. See day-writes.js.
 */
const dayWriter = createDayWriter((dayKey) => api.days.save(dayKey, entriesFor(dayKey)));

/** Write this day within half a second. Defaults to the day on screen. */
export function persistDay(dayKey = state.selectedDate) {
  dayWriter.queue(dayKey);
}

/** Write this day now. Defaults to the day on screen. */
export function persistDayNow(dayKey = state.selectedDate) {
  return dayWriter.now(dayKey);
}

/** Write everything a debounce still owes. */
export function flushDayWrites() {
  return dayWriter.flush();
}

export async function readDay(date) {
  return api.days.get(date);
}

export async function writeDay(date, entries) {
  const saved = await api.days.save(date, entries);
  state.days.set(date, saved.entries);
  return saved;
}

/** One day's entries, whether or not it is the day on screen. */
export function entriesFor(dayKey) {
  return state.days.get(dayKey) ?? [];
}

/**
 * One day as it should be shown: local entries plus unclaimed Jira-side worklogs.
 *
 * No callers yet, and deliberately so: it is the explicit-day form of
 * `visibleEntries`, waiting for the week view to draw a day that is not the one on
 * screen. `onResize`'s edge snapping in timeline-drag.js is the first line that will
 * take it. Not dead code awaiting deletion.
 */
export function visibleEntriesFor(dayKey) {
  return copyableEntries(state.days.get(dayKey) ?? [], state.external.get(dayKey) ?? []);
}

/** The explicit-day form of `persistDayNow`, kept as a name that says so. */
export const persistDayFor = persistDayNow;

/** Replace one day's entries, whether or not it is the day on screen. */
export function setEntriesFor(dayKey, entries) {
  state.days.set(dayKey, entries ?? []);
}

/**
 * Forget the cached Jira-side rows for some days, so the next `loadDays` reads them
 * again. Called after anything that changes what Jira holds for a day.
 */
export function invalidateExternal(...dayKeys) {
  for (const key of dayKeys) state.external.delete(key);
}

/**
 * Load a range of days: the day logs always, and the Jira-side worklogs for whichever
 * of them are not already cached.
 *
 * The Jira read is one request for the whole range. Reading it a day at a time is
 * what made *Copy previous day* crawl, and it is the thing this whole phase exists
 * to stop.
 *
 * Two things a caller has to know, both of them true today and neither of them
 * enforced here:
 *
 * 1. **This overwrites `state.days` for every day in the range**, straight from
 *    disk. Any debounced edit is flushed first, so what is on disk is what was on
 *    screen — but an edit made *during* the read still loses, which no caller does.
 * 2. **Called directly, it is not covered by `whenIdle()`.** `refreshRange` wraps it
 *    in `track`, this does not, so *Copy previous day* is the one range read a UI
 *    check cannot wait on. Swapping it for `refreshRange` is not free: `track`
 *    swallows the rejection, so a Jira failure would turn into a silent "nothing to
 *    copy" instead of propagating to the caller that reports it.
 */
export async function loadDays(from, to) {
  // A debounced edit not yet on disk would be replaced by what is on disk. Writing
  // it out first is cheaper than deciding which days to skip, and leaves memory and
  // disk agreeing rather than merely not fighting.
  await flushDayWrites();

  const logs = await api.days.getRange(from, to);
  for (const key of eachDay(from, to)) state.days.set(key, logs[key]?.entries ?? []);

  if (!state.settings.baseUrl || !state.settings.tokenConfigured) return;

  const wanted = missingDays(from, to, state.external);
  if (wanted.length === 0) return;

  // One request covering the gaps, rather than one per gap. Asking for the whole
  // span even when the middle is cached is cheaper than several narrow reads: the
  // cost is one JQL either way.
  const first = wanted[0];
  const last = wanted[wanted.length - 1];
  const worklogs = await api.jira.rangeWorklogs(
    first,
    last,
    startOfDayMs(first),
    startOfDayMs(addDays(last, 1)),
  );

  const buckets = bucketByDay(worklogs);
  for (const key of eachDay(first, last)) {
    state.external.set(key, externalToEntries(buckets.get(key) ?? []));
  }
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

/**
 * Pull one day's Jira-side worklogs. Failure is non-fatal: the local day still works.
 *
 * Answers from the cache when that day is already held. Every day change calls this,
 * and without the check, stepping back and forth over a week would re-read days whose
 * rows are already on screen — the cache would hold everything and save nothing.
 * Anything that changes what Jira holds calls `invalidateExternal` first, which is
 * what makes the cached answer safe to trust.
 */
export async function loadExternalWorklogs(date = state.selectedDate) {
  if (!state.settings.baseUrl || !state.settings.tokenConfigured) {
    // Deliberately a delete rather than an empty list. Reading it still answers `[]`,
    // but caching one would mark the day as held, so the first read after the setup
    // wizard would answer "nothing on it" from a cache filled before there were any
    // credentials to read with.
    state.external.delete(date);
    state.externalState = 'idle';
    return [];
  }

  if (state.external.has(date)) {
    if (date === state.selectedDate) state.externalState = 'loaded';
    return state.external.get(date);
  }

  const dayStartTs = startOfDayMs(date);
  state.externalState = 'loading';
  state.externalError = null;

  try {
    jiraReads++;
    const worklogs = await api.jira.rangeWorklogs(date, date, dayStartTs, startOfDayMs(addDays(date, 1)));
    // A day change mid-request must not drop yesterday's answer onto today — but the
    // answer is filed under the day it was asked for, so it is kept rather than
    // discarded, and only the status flags belonging to the screen are left alone.
    state.external.set(date, externalToEntries(worklogs));
    if (date !== state.selectedDate) return [];
    state.externalState = 'loaded';
    return state.externalEntries;
  } catch (err) {
    // Deliberately *not* cached: a failed read must be retried on the next visit,
    // not remembered as "this day has nothing on it".
    state.external.delete(date);
    if (date !== state.selectedDate) return [];
    state.externalState = 'error';
    state.externalError = err.message;
    throw err;
  }
}

/**
 * The Jira read that is in flight, or null.
 *
 * Held rather than dropped so something can wait for it. Nothing in the app needs
 * that — every caller here is fire-and-forget — but the UI check does, and the
 * alternative is what it used to do: sleep for a second and a half and hope.
 *
 * One field for both the day read and the range read, because `whenIdle()` means
 * "the Jira read in flight", and a check waiting on the wrong one of two fields is
 * worse than no hook at all. Lives here rather than in `app.js` so every caller of
 * `refreshExternal` — including ones outside `app.js`, like a delete that has just
 * changed what Jira holds — goes through the same tracked read `whenIdle()` covers,
 * rather than a plain untracked `loadExternalWorklogs` that a UI check could race.
 */
export let externalPending = null;

/**
 * Counts every live `rangeWorklogs` request `loadExternalWorklogs` actually makes —
 * the cache-hit branch above deliberately never touches it. Renderer-local, exposed
 * as `window.__jogglTest.jiraReads` in `app.js`'s `installTestHook`, so a UI check
 * can prove a day round trip answered the second time from cache rather than merely
 * answering fast: counting the reads is the only way to tell those two apart.
 */
export let jiraReads = 0;

function track(promise) {
  externalPending = promise
    .then(() => renderAll())
    .catch(() => renderAll())
    .finally(() => {
      externalPending = null;
    });
  return externalPending;
}

/** Pull one day's Jira-side rows and repaint. Answers from the cache; see above. */
export function refreshExternal(date = state.selectedDate) {
  return track(loadExternalWorklogs(date));
}

/** Load a span of days and their Jira-side rows. For the week and month views. */
export function refreshRange(from, to) {
  return track(loadDays(from, to));
}

/**
 * The day as it should be shown: local entries plus any Jira-side worklog that
 * no local entry already stands for.
 */
export function visibleEntries() {
  return copyableEntries(state.entries, state.externalEntries);
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
