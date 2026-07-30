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
 * `startTs` is also the candidate bound, and it is decided *here*, once, at the
 * moment the timer starts. The caller must carry it on the timer and hand the same
 * number to `applyMerge` at stop — see the note there. Recomputing it later gives
 * a different candidate set and silently rewrites time data.
 *
 * @returns {{action: 'new'}
 *          |{action: 'merge', gapMs: number, candidates: object[]}
 *          |{action: 'ask',   gapMs: number, candidates: object[], totalMs: number,
 *            earliestTs: number, latestTs: number}}
 */
export function decideMerge(entries, taskKey, startTs) {
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
 * `notAfterTs` must be the bound `decideMerge` was given when it offered this merge,
 * not a number worked out again here. It defaults to the new entry's start, which is
 * the same thing whenever nothing moved in between — but a running timer's start can
 * be edited from the omnibar, and the merge decision is not retaken when it is.
 * Deriving the bound from an edited start lets the stop absorb a block booked for
 * later in the day that the start had excluded: 09:50–09:55 worked, 10:30–11:00
 * booked ahead, timer started 10:00 and later corrected to 11:00, and the stop
 * produces one 09:50–11:35 entry that eats the half hour booked ahead.
 *
 * Returns a new array; the input is not mutated.
 */
export function applyMerge(entries, newEntry, notAfterTs = newEntry.startTs) {
  const taskKey = taskKeyOf(newEntry);
  const absorbed = mergeableEntries(entries, taskKey, notAfterTs);
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
    // First description wins rather than the two being joined: resuming a timer on
    // the same issue repeatedly would otherwise append the same sentence each time.
    // The new entry's is preferred because it is the more recent statement of what
    // the block is, and a timer started from the omnibar carries none at all.
    comment: newEntry.comment || base.comment || null,
    errorMsg: null,
    worklogId: null,
  };

  return [...entries.filter((e) => !absorbedIds.has(e.id)), merged];
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => a.startTs - b.startTs);
}
