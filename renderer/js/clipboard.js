// What Ctrl+C holds, and where Ctrl+V puts it.
//
// Pure — no DOM, no IPC — because the anchoring rule is the whole feature and it is
// easy to get subtly wrong in a way nobody notices until a pasted week is a day out.

import { copiedToDay } from './entry-ops.js';
import { addDays, startOfDayMs, uuid } from './util.js';

/**
 * Whole days from one key to another.
 *
 * Rounded, never floored: one of the days in between can be 25 hours long, and a
 * clock change would otherwise put a pasted week a day out from one Sunday a year.
 */
export function daysBetween(from, to) {
  return Math.round((startOfDayMs(to) - startOfDayMs(from)) / 86_400_000);
}

/**
 * The clipboard: the entries copied, each with the day it came from, and the earliest
 * of those days — the one that gets anchored onto wherever the paste lands.
 *
 * A running timer is dropped: it has no end to copy, which is the same reason
 * `copiedToDay` filters it out. Nothing copied at all answers null rather than an
 * empty clipboard, so "nothing to paste" and "paste nothing" cannot be confused.
 *
 * @param {{entry: object, dayKey: string}[]} items
 */
export function clipboardFrom(items) {
  const kept = (items ?? []).filter(
    ({ entry }) => entry && entry.endTs !== null && entry.endTs !== undefined,
  );
  if (kept.length === 0) return null;
  return { anchorDay: kept.map(({ dayKey }) => dayKey).sort()[0], items: kept };
}

/**
 * Where a paste lands, as one write per day.
 *
 * **One rule covers every case.** The earliest day in the selection is anchored onto
 * the target day and every offset is preserved — both the offset in days and the time
 * on the clock. So one day's blocks pasted onto another arrive at the same times;
 * Tuesday and Thursday pasted onto Wednesday arrive on Wednesday and Friday; and the
 * whole week selected, stepped forward and pasted onto Monday reproduces the week.
 *
 * The times themselves are `copiedToDay`'s business, which measures them as an offset
 * from local midnight rather than as a fixed number of milliseconds — and everything
 * a copy does not inherit is `duplicateOf`'s.
 *
 * @returns {{dayKey: string, entries: object[]}[]} in day order
 */
export function pastePlan(clip, targetDay, newId = uuid) {
  if (!clip) return [];

  const byDay = new Map();
  for (const { entry, dayKey } of clip.items) {
    const list = byDay.get(dayKey);
    if (list) list.push(entry);
    else byDay.set(dayKey, [entry]);
  }

  return [...byDay.keys()]
    .sort()
    .map((dayKey) => {
      const to = addDays(targetDay, daysBetween(clip.anchorDay, dayKey));
      return { dayKey: to, entries: copiedToDay(byDay.get(dayKey), dayKey, to, newId) };
    });
}
