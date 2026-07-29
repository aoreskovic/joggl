// Pure transforms on entries. No DOM, no IPC — the rules here decide what Jira
// ends up holding, so they are kept testable.

/**
 * A copy of `entry` covering the same stretch of time.
 *
 * The copy deliberately inherits **no** worklog. Carrying the original's
 * worklogId across would make the next Finish Day rewrite that one worklog with
 * the copy's times — overwriting the original's record and never giving the copy
 * one of its own. Two entries, two worklogs.
 *
 * The copy also stops being external: a duplicate of a worklog made in Jira is
 * Joggl's own new entry, not a second view of Jira's record.
 */
export function duplicateOf(entry, newId) {
  return {
    id: newId,
    issueKey: entry.issueKey ?? null,
    issueId: entry.issueId ?? null,
    title: entry.title,
    startTs: entry.startTs,
    endTs: entry.endTs,
    status: entry.issueKey ? 'pending' : 'local',
    worklogId: null,
    errorMsg: null,
  };
}

/** A block drawn by hand on the day view is half an hour wherever it lands. */
export const DEFAULT_DROP_MS = 30 * 60_000;

/**
 * The entry created by dropping an issue onto the day view.
 *
 * `startTs` arrives already snapped to a quarter hour, so the only adjustment made
 * here is at the end of the day: a block that would run past midnight is pulled
 * back to end on it rather than being shortened, because a 30-minute drop that
 * silently became a 15-minute entry would be a worse surprise than one that sits a
 * quarter hour earlier than aimed.
 *
 * A start later than the current time is deliberately allowed. Booking leave, an
 * out-of-office block, or a meeting already in the diary is the reason to draw a
 * block by hand instead of running a timer, and Finish Day submits such an entry
 * like any other. Only a *running timer* may not start in the future — that would
 * have it measuring negative elapsed time.
 *
 * The status is always `pending`: everything in the task list came from Jira and so
 * carries an issue key. There is no keyless path into this function.
 *
 * The lower clamp is not belt-and-braces. The overnight day-rollover in `app.js`
 * can fire mid-drag: `state.selectedDate` advances to the new day while the drag's
 * `startTs`, resolved from a grid drawn for yesterday, still points at yesterday.
 * Without the clamp that drop would land in a day the entry is not filed under and
 * disappear from the view that holds it.
 */
export function dropEntryFor(issue, newId, startTs, dayStartTs, durationMs = DEFAULT_DROP_MS) {
  const latestStart = dayStartTs + 86_400_000 - durationMs;
  const start = Math.min(Math.max(startTs, dayStartTs), latestStart);

  return {
    id: newId,
    issueKey: issue.issueKey,
    issueId: issue.issueId ?? null,
    title: issue.title,
    startTs: start,
    endTs: start + durationMs,
    status: 'pending',
    worklogId: null,
    errorMsg: null,
  };
}

/** Ids of entries whose time ranges overlap. Allowed, but usually a mistake. */
export function overlappingIds(entries) {
  const ids = new Set();
  const done = (entries ?? []).filter((e) => e.endTs !== null && e.endTs !== undefined);

  for (let i = 0; i < done.length; i++) {
    for (let j = i + 1; j < done.length; j++) {
      const a = done[i];
      const b = done[j];
      if (a.startTs < b.endTs && b.startTs < a.endTs) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}
