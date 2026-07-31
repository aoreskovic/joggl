// Finding the most recent day that has any entries on it.
//
// Its own module, with no DOM and no IPC, because every interesting case is one a
// user meets once and remembers — a Monday reaching back over the weekend, the
// first morning after a fortnight off, a fresh install with no history — and none
// of them can be reached by hand without waiting a fortnight. The readers are
// arguments, so all of it is checked in `test/copy-day.test.js` instead.

import { copyableEntries } from './entry-ops.js';
import { addDays } from './util.js';

/**
 * How far back the search will look.
 *
 * Long enough to survive a fortnight off, short enough that the worst case is a
 * bounded wait rather than an open-ended one. Past it, the honest answer is that
 * there is nothing to copy.
 */
export const MAX_LOOKBACK_DAYS = 30;

/**
 * The most recent day before `from` that has any entries, or null.
 *
 * Sequential and closest-first on purpose. Each `readJira` is a JQL plus a worklog
 * read per issue it finds, so firing thirty of them at once to throw away
 * twenty-nine would be rude to a shared Jira and slower than stopping early.
 *
 * @param {object} spec
 * @param {string} spec.from            day key to look back from, exclusive
 * @param {(key: string) => Promise<object[]>} spec.readLocal
 * @param {(key: string) => Promise<object[]>} spec.readJira  answers [] when Jira is off
 * @param {number} [spec.maxBack]
 * @param {(daysBack: number) => void} [spec.onProgress]
 * @returns {Promise<{dayKey: string, entries: object[]}|null>}
 */
export async function findLastDayWithEntries({
  from,
  readLocal,
  readJira,
  maxBack = MAX_LOOKBACK_DAYS,
  onProgress,
}) {
  for (let back = 1; back <= maxBack; back++) {
    const dayKey = addDays(from, -back);
    onProgress?.(back);

    const local = (await readLocal(dayKey)) ?? [];
    const external = (await readJira(dayKey)) ?? [];
    // The same rule the screen uses: a synced entry and the worklog it created in
    // Jira are one stretch of time seen twice, and copying both would book it twice.
    const entries = copyableEntries(local, external);
    if (entries.length > 0) return { dayKey, entries };
  }
  return null;
}
