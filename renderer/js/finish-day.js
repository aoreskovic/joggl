// Finish Day. Pure orchestration over an injected `submit` — no DOM, no IPC — so
// the partial-failure state transitions can be tested without a Jira.
//
// Stopping a timer never submits anything. This is the only path to Jira, and it
// is always explicit.

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
