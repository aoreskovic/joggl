// Which editor a double click opens.
//
// The rule is "the editor for what you clicked", and it lives here rather than in
// the two places that dispatch it so the entry list and the day view cannot drift
// apart about what a region means.
//
// A day-view block resolves to the description whatever part of it was hit: the
// block is all label, so there is no "anywhere else" to aim at, and the description
// is the dominant need there — of 391 real worklogs sampled on this site, every one
// carried one, while repointing a block at another issue is a rare correction. Edit
// task stays first on the block's right-click menu.

/** Regions that already mean something on a double click. Left alone. */
export const KEEPS_ITS_OWN = '.ie, [data-a], .sched-handle, input, textarea, select, button, a';
/** The task name and its key — the only region that means "which issue is this". */
export const TASK_NAME = '.entry-title, .entry-jira';
/** Either representation of one entry. */
export const ENTRY = '.entry-card, .sched-entry-block';

/**
 * @param {{closest: (selector: string) => unknown}|null} target what was clicked
 * @returns {'task'|'comment'|null} null when the double click is not ours
 */
export function editorForTarget(target) {
  if (!target || typeof target.closest !== 'function') return null;
  // A double click in a time field selects the text, and on a button it is just a
  // second press. Neither is an invitation to open a dialog over the top.
  if (target.closest(KEEPS_ITS_OWN)) return null;
  if (!target.closest(ENTRY)) return null;
  return target.closest(TASK_NAME) ? 'task' : 'comment';
}
