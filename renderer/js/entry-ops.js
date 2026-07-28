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
