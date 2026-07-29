// Merge-on-repeated-activation. Pure functions, no DOM — starting a timer on an
// issue that already has entries today either merges silently, asks, or does
// nothing, and getting the 30-minute boundary wrong silently rewrites time data.

export const MERGE_GAP_MS = 30 * 60 * 1000;

/**
 * What counts as "the same task". Jira issues match on issue key; entries with
 * no issue key are local, so they match on their (case-insensitive) title.
 */
export function taskKeyOf(entry) {
  if (entry?.issueKey) return `issue:${entry.issueKey}`;
  return `local:${String(entry?.title ?? '').trim().toLowerCase()}`;
}

/**
 * Entries that may be folded into a merge.
 *
 * Anything already pushed to Jira is excluded. Swallowing a synced entry into a
 * larger block would either log its minutes a second time on the next Finish Day
 * or drop the worklogId that guards against exactly that.
 *
 * `notAfterTs` excludes anything that starts after the timer being merged into it.
 * A block dropped onto a later hour of the day view — leave, a meeting already in
 * the diary — has not happened yet, and a block that has not happened cannot be
 * resumed. Without this bound, dropping Meetings on 14:00 and then timing the
 * 10:30 standup produced a single 10:30–14:30 entry and Finish Day submitted four
 * hours for thirty minutes of work.
 */
export function mergeableEntries(entries, taskKey, notAfterTs = Infinity) {
  return (entries ?? []).filter(
    (e) =>
      e.endTs !== null &&
      e.endTs !== undefined &&
      e.status !== 'synced' &&
      !e.worklogId &&
      e.startTs <= notAfterTs &&
      taskKeyOf(e) === taskKey,
  );
}

/**
 * Decide what starting a timer at `startTs` should do.
 *
 * @returns {{action: 'new'}
 *          |{action: 'merge', gapMs: number, candidates: object[]}
 *          |{action: 'ask',   gapMs: number, candidates: object[], totalMs: number,
 *            earliestTs: number, latestTs: number}}
 */
export function decideMerge(entries, taskKey, startTs) {
  // The bound is the timer's start, exactly as in applyMerge below. The two calls
  // are minutes or hours apart — one at start, one at stop — and if they disagreed
  // on the candidate set, the stop would absorb an entry the start never offered.
  const candidates = mergeableEntries(entries, taskKey, startTs);
  if (candidates.length === 0) return { action: 'new' };

  const lastEnd = Math.max(...candidates.map((e) => e.endTs));
  const gapMs = startTs - lastEnd;

  // A gap at or under the threshold — including a negative one, which means the
  // new start overlaps the previous block and is even more clearly a resumption.
  if (gapMs <= MERGE_GAP_MS) return { action: 'merge', gapMs, candidates };

  const spans = candidates.map((e) => [e.startTs, e.endTs]);
  return {
    action: 'ask',
    gapMs,
    candidates,
    totalMs: spans.reduce((sum, [s, e]) => sum + Math.max(0, e - s), 0),
    earliestTs: Math.min(...spans.map(([s]) => s)),
    latestTs: Math.max(...spans.map(([, e]) => e)),
  };
}

/**
 * Collapse `newEntry` and every mergeable same-task entry into one block:
 * earliest start, latest end. The gap between them is deliberately swallowed —
 * that is the point for a shared, all-day issue like Meetings.
 *
 * Returns a new array; the input is not mutated.
 */
export function applyMerge(entries, newEntry) {
  const taskKey = taskKeyOf(newEntry);
  // newEntry.startTs is the timer's start — the same bound decideMerge used when
  // it offered the merge. Passing anything else here (the end, say) would let the
  // stop swallow a block booked for later in the day that was never a candidate.
  const absorbed = mergeableEntries(entries, taskKey, newEntry.startTs);
  if (absorbed.length === 0) return [...entries, newEntry];

  const absorbedIds = new Set(absorbed.map((e) => e.id));
  const base = absorbed.reduce((a, b) => (b.endTs > a.endTs ? b : a));
  const ends = [...absorbed.map((e) => e.endTs), newEntry.endTs].filter(
    (v) => v !== null && v !== undefined,
  );

  const merged = {
    ...base,
    // Keep the new entry's identity for anything the old block did not have.
    issueKey: newEntry.issueKey ?? base.issueKey,
    issueId: newEntry.issueId ?? base.issueId,
    title: newEntry.title || base.title,
    startTs: Math.min(...absorbed.map((e) => e.startTs), newEntry.startTs),
    endTs: ends.length ? Math.max(...ends) : null,
    status: newEntry.issueKey || base.issueKey ? 'pending' : 'local',
    errorMsg: null,
    worklogId: null,
  };

  return [...entries.filter((e) => !absorbedIds.has(e.id)), merged];
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => a.startTs - b.startTs);
}
