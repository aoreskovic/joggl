// What Ctrl+C holds, and where a copy of it goes — pasted, or dragged with Ctrl held.
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
/**
 * Where a Ctrl+drag of a selection lands, one placement per entry.
 *
 * The block under the cursor is the anchor: the day it is dropped on and the distance
 * it travelled on the clock are what the rest of the selection follows. Everything
 * else keeps its offset from the anchor, in days as well as on the clock — the same
 * rule Ctrl+V follows, and for the same reason. A selection spanning Tuesday and
 * Thursday is a shape, and a copy of it is that shape moved, not a heap.
 *
 * Times are offsets from each day's own local midnight, never a fixed number of
 * milliseconds, so a drag across a clock change leaves every block at the hour it
 * says. Each copy is held inside the day it lands on, exactly as the dragged block
 * itself is.
 *
 * @param {{entry: object, dayKey: string}[]} items
 * @param {string} anchorDay the day the drag started on
 * @param {string} targetDay the day the cursor is over
 * @param {number} clockDelta ms the anchor moved on the clock
 * @returns {{entry: object, fromDay: string, toDay: string, startTs: number, endTs: number}[]}
 */
export function dragCopyPlacement(items, anchorDay, targetDay, clockDelta) {
  const dayShift = daysBetween(anchorDay, targetDay);

  return (items ?? []).map(({ entry, dayKey }) => {
    const toDay = addDays(dayKey, dayShift);
    const dayStart = startOfDayMs(toDay);
    // addDays, not a constant: the day a copy lands on can be 23 or 25 hours long,
    // and the clamp below is what decides whether its last block fits.
    const dayLength = startOfDayMs(addDays(toDay, 1)) - dayStart;
    const duration = entry.endTs - entry.startTs;
    const wanted = entry.startTs - startOfDayMs(dayKey) + clockDelta;
    const offset = Math.max(0, Math.min(wanted, dayLength - duration));
    return {
      entry,
      fromDay: dayKey,
      toDay,
      startTs: dayStart + offset,
      endTs: dayStart + offset + duration,
    };
  });
}

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
