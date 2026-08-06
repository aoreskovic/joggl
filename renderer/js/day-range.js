// Ranges of days, and what comes back for them.
//
// Pure — no DOM, no IPC — and deliberately not part of state.js, which reads
// `window.joggl` at module load and so cannot be imported under `node --test` at
// all. The arithmetic deciding which days get fetched, and which day a worklog
// lands on, is worth testing; the IPC calls around it are covered by the UI check.

import { addDays } from './util.js';

/** Every day key from `from` to `to`, inclusive. Backwards gives nothing. */
export function eachDay(from, to) {
  const keys = [];
  for (let key = from; key <= to; key = addDays(key, 1)) keys.push(key);
  return keys;
}

/** Anything carrying a `dayKey`, grouped by it. */
export function bucketByDay(items) {
  const buckets = new Map();
  for (const item of items ?? []) {
    const list = buckets.get(item.dayKey);
    if (list) list.push(item);
    else buckets.set(item.dayKey, [item]);
  }
  return buckets;
}

/**
 * Jira's worklogs as the read-only entries the day view renders.
 *
 * The id is namespaced so it can never collide with a local uuid, and `worklogId` is
 * kept because `copyableEntries` uses it to drop a row a local synced entry already
 * stands for. `external: true` is what every refusal in the app keys off.
 */
export function externalToEntries(worklogs) {
  return (worklogs ?? []).map((w) => ({
    ...w,
    id: `jira:${w.worklogId}`,
    status: 'synced',
    errorMsg: null,
    external: true,
  }));
}

/**
 * The days in a range not already held.
 *
 * A day held as an empty list counts as held — otherwise an empty day would be
 * refetched on every render, which over a week is seven wasted requests a repaint.
 */
export function missingDays(from, to, have) {
  return eachDay(from, to).filter((key) => !have.has(key));
}

/**
 * One day's Jira-side rows with the row for `worklogId` taken out.
 *
 * A new array, never a splice: the cache holds these and a render may be reading the
 * old one. Ids are compared as strings because Jira answers with strings and a local
 * entry carries whatever the POST came back with.
 */
export function withoutWorklog(entries, worklogId) {
  const wanted = String(worklogId);
  return (entries ?? []).filter((e) => String(e.worklogId) !== wanted);
}

/**
 * Make `target.entries` and `target.externalEntries` live views onto the selected
 * day of two Maps.
 *
 * `state.entries` is read in about forty places across eleven modules. Rewriting all
 * of them to take a day argument would be a large change for no user-visible gain,
 * and every one of those call sites means "the day on screen" — so the storage moves
 * and the name stays. The property is deliberately not writable-as-a-whole: assigning
 * `state.entries = [...]` files the array under the selected day, which is what every
 * existing caller already means by it.
 *
 * Reading a day never written answers `[]` rather than `undefined`, so no caller has
 * to tell "not loaded" from "nothing on it" — the same promise `days.getDays` makes
 * in main.
 */
export function installDayAccessors(target, { days, external }) {
  Object.defineProperty(target, 'entries', {
    get: () => days.get(target.selectedDate) ?? [],
    set: (value) => days.set(target.selectedDate, value ?? []),
  });
  Object.defineProperty(target, 'externalEntries', {
    get: () => external.get(target.selectedDate) ?? [],
    set: (value) => external.set(target.selectedDate, value ?? []),
  });
}
