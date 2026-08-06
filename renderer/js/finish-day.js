// Sync. Pure orchestration over an injected `submit` — no DOM, no IPC — so the
// partial-failure state transitions can be tested without a Jira.
//
// Stopping a timer never submits anything. This is the only path to Jira, and it
// is always explicit.
//
// The button is called **Sync** (today) and **Re-sync** (any other day). The module
// and its functions keep the older name: renaming them would churn every test and
// every UI check for no behaviour, and "finish day" is still what the operation is.

import { msToDur } from './util.js';

/**
 * Split a day's entries into what Finish Day will do with each one.
 *
 * @returns {{toSubmit: object[], toMarkLocal: object[], alreadySynced: object[], running: object[]}}
 */
export function planFinishDay(entries) {
  const toSubmit = [];
  const toMarkLocal = [];
  const alreadySynced = [];
  const running = [];

  for (const entry of entries ?? []) {
    if (entry.endTs === null || entry.endTs === undefined) {
      running.push(entry);
      continue;
    }
    // A worklogId means Jira already holds these minutes. Still `synced` means
    // they are also still correct, so there is nothing to do; anything else means
    // the entry was edited after syncing and its worklog needs rewriting. What
    // the id guarantees either way is that the entry is never *posted* twice —
    // `submit` turns it into an update.
    if (entry.worklogId && entry.status === 'synced') {
      alreadySynced.push(entry);
      continue;
    }
    if (entry.status === 'synced') {
      alreadySynced.push(entry);
      continue;
    }
    if (entry.worklogId) {
      toSubmit.push(entry);
      continue;
    }
    if (!entry.issueKey) {
      toMarkLocal.push(entry);
      continue;
    }
    toSubmit.push(entry);
  }

  // Oldest first, so a partial run leaves a contiguous synced prefix.
  toSubmit.sort((a, b) => a.startTs - b.startTs);
  return { toSubmit, toMarkLocal, alreadySynced, running };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Nothing for the button to do — neither a worklog to write nor an entry to mark. */
export function nothingToSync(plan) {
  return plan.toSubmit.length === 0 && plan.toMarkLocal.length === 0;
}

/**
 * What the Sync button says it will do, before it does it.
 *
 * The one button that writes to Jira used to read `Finish Day` and nothing more,
 * so pressing it was a blind action — worst on a day that also holds read-only
 * Jira-side rows, where most of what is on screen is not going anywhere.
 *
 * The count is what actually reaches Jira. Entries with no issue key are only
 * marked `local`, so folding their minutes into a number about Jira would overstate
 * it; they get their own phrasing when they are all there is, and the tooltip
 * carries the rest.
 *
 * `verb` is for a button that is not about one day — the week's, which cannot be
 * "Sync" or "Re-sync" because a week usually holds some of each.
 *
 * @param {ReturnType<planFinishDay>} plan
 * @param {{isToday?: boolean, busy?: boolean, done?: number, total?: number, verb?: string}} [opts]
 */
export function syncLabel(
  plan,
  { isToday = true, busy = false, done = null, total = null, verb = null } = {},
) {
  if (busy) return done === null ? 'Syncing…' : `Syncing ${done}/${total}…`;
  if (nothingToSync(plan)) return 'Nothing to sync';

  // Past days are a rewrite of a day already dealt with, and saying so is the only
  // warning that this is not the first time.
  const word = verb ?? (isToday ? 'Sync' : 'Re-sync');
  if (plan.toSubmit.length === 0) {
    return `${word} · ${plural(plan.toMarkLocal.length, 'local entry', 'local entries')}`;
  }

  const ms = plan.toSubmit.reduce((sum, e) => sum + Math.max(0, e.endTs - e.startTs), 0);
  return `${word} · ${plural(plan.toSubmit.length, 'entry', 'entries')}, ${msToDur(ms)}`;
}

/** The parts that do not fit on a button, in the order they matter. */
export function syncTooltip(plan) {
  const lines = [];
  if (plan.toSubmit.length > 0) {
    const fresh = plan.toSubmit.filter((e) => !e.worklogId).length;
    const rewrites = plan.toSubmit.length - fresh;
    if (fresh > 0) lines.push(`${plural(fresh, 'entry', 'entries')} to log in Jira`);
    // An edited entry keeps its worklogId and is rewritten in place rather than
    // logged again — worth saying, because the alternative reading is frightening.
    if (rewrites > 0) lines.push(`${plural(rewrites, 'worklog', 'worklogs')} to rewrite, not log again`);
  }
  if (plan.toMarkLocal.length > 0) {
    lines.push(
      `${plural(plan.toMarkLocal.length, 'entry', 'entries')} without an issue — marked local, never sent`,
    );
  }
  if (plan.alreadySynced.length > 0) {
    lines.push(`${plural(plan.alreadySynced.length, 'entry', 'entries')} already in Jira — left alone`);
  }
  if (plan.running.length > 0) lines.push('The running timer is not included — stop it first');
  if (lines.length === 0) lines.push('Nothing on this day is waiting to go to Jira.');
  return lines.join('\n');
}

/**
 * @param {object[]} entries    the day's entries
 * @param {(entry: object) => Promise<{worklogId: string}>} submit
 * @param {{onProgress?: (done: number, total: number, entry: object) => void}} [opts]
 * @returns {Promise<{entries: object[], submitted: object[], failed: object[],
 *                    markedLocal: object[], skipped: object[]}>}
 *
 * Never throws for a Jira failure: a failed entry becomes `error` with a message
 * and the run continues. There is no automatic retry — the caller shows a summary
 * and the user decides.
 */
export async function runFinishDay(entries, submit, { onProgress } = {}) {
  const plan = planFinishDay(entries);
  const byId = new Map((entries ?? []).map((e) => [e.id, { ...e }]));

  const markedLocal = [];
  for (const entry of plan.toMarkLocal) {
    const next = byId.get(entry.id);
    next.status = 'local';
    next.errorMsg = null;
    markedLocal.push(next);
  }

  const submitted = [];
  const failed = [];

  for (const [index, entry] of plan.toSubmit.entries()) {
    const next = byId.get(entry.id);
    try {
      const result = await submit(entry);
      const worklogId = result?.worklogId;
      if (!worklogId) throw new Error('Jira returned no worklog id');
      next.status = 'synced';
      next.worklogId = String(worklogId);
      next.errorMsg = null;
      submitted.push(next);
    } catch (err) {
      next.status = 'error';
      next.errorMsg = err?.message ?? String(err);
      // worklogId is left exactly as it was: absent after a failed create, so a
      // retry posts; present after a failed update, so a retry rewrites.
      failed.push(next);
    }
    onProgress?.(index + 1, plan.toSubmit.length, next);
  }

  return {
    entries: [...byId.values()],
    submitted,
    failed,
    markedLocal,
    skipped: [...plan.alreadySynced, ...plan.running],
  };
}

/**
 * Clear the failures so a retry picks them up. The worklogId is kept: a failed
 * update must retry as an update, not turn into a second worklog.
 */
export function resetFailedForRetry(entries) {
  return (entries ?? []).map((entry) =>
    entry.status === 'error' ? { ...entry, status: 'pending', errorMsg: null } : entry,
  );
}
