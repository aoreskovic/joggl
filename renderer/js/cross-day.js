// Moving one entry from one day log to another.
//
// Pure — no DOM, no IPC — because this is the one gesture that writes two day logs
// at once, and getting it half done means an entry on both days or on neither.
//
// A **synced** entry may cross days. Its worklogId stays valid because the issue has
// not changed, only when the work started, so it returns to `pending` and the next
// Sync rewrites the worklog with PUT — exactly as a move within a day already does.
// This is not the case retargeting refuses; that one changes the issue, and a worklog
// id is only valid on the issue it was created against.

import { dirtiedEntry, movedEntry } from './entry-ops.js';

/** A Jira-side row is not Joggl's to move. Everything else may cross. */
export function canCrossDays(entry) {
  return !entry?.external;
}

/**
 * The two day logs after an entry moves between them.
 *
 * `startTs` is already on the target day and already snapped — the gesture decided
 * it, against that day's own midnight. `movedEntry` only keeps the length and clamps
 * the block inside the day, which is the same rule every drop uses.
 *
 * @returns {{from: object[], to: object[], moved: object}}
 */
export function crossDayMove({ entry, fromEntries, toEntries, toDayStartMs, startTs }) {
  const moved = dirtiedEntry(movedEntry(entry, startTs, toDayStartMs));
  return {
    from: (fromEntries ?? []).filter((e) => e.id !== entry.id),
    to: [...(toEntries ?? []), moved],
    moved,
  };
}
