// Sync / Re-sync — the only path from Joggl to Jira.

import {
  nothingToSync,
  planFinishDay,
  resetFailedForRetry,
  runFinishDay,
  syncLabel,
  syncTooltip,
} from './finish-day.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import { notifyDayChange } from './shell.js';
import {
  entriesFor, invalidateExternal, isToday, persistDayNow, setEntriesFor, state, submitWorklog,
} from './state.js';
import { toast, toastOk, toastWarn } from './toast.js';
import { esc, formatDateLabel, msToDur } from './util.js';

let running = false;

/** Whether a sync is in flight. The week's button reads it to disable itself. */
export function isSyncRunning() {
  return running;
}

export function updateFinishButton() {
  const button = document.getElementById('finish-day-btn');
  if (!button) return;

  const plan = planFinishDay(state.entries);
  button.textContent = syncLabel(plan, { isToday: isToday(), busy: running });
  button.title = syncTooltip(plan);
  // Disabled when there is nothing to do, so the day's state is legible from the
  // button alone rather than from pressing it and reading a toast.
  button.disabled = running || nothingToSync(plan);
}

/** Sync the day on screen. */
export function finishDay() {
  return syncDays([state.selectedDate], { isToday: isToday() });
}

/** Sync every day the week view is drawing. */
export function syncWeek(days) {
  return syncDays(days, { verb: 'Sync week' });
}

/**
 * The one path from Joggl to Jira, over one day or seven.
 *
 * Sequential on purpose: the partial-failure story is per entry, and a parallel run
 * would make "successful entries keep their worklogId, failures keep pending"
 * impossible to report honestly. The days are fixed before the first await — a sync
 * takes seconds, nothing suppresses the day shortcuts while it runs, and the results
 * belong to the days whose entries were submitted.
 */
async function syncDays(days, { verb = null, isToday: today = true } = {}) {
  if (running) return;

  const targets = [...new Set(days)].sort();
  const plan = planFinishDay(targets.flatMap((day) => entriesFor(day)));

  if (nothingToSync(plan)) {
    toast(
      plan.alreadySynced.length > 0
        ? 'Everything here is already in Jira.'
        : 'Nothing to sync.',
    );
    return;
  }

  if (plan.running.length > 0) {
    toastWarn('The running timer is not included — stop it first if you want it synced.');
  }

  if (plan.toSubmit.length > 0 && !state.settings.tokenConfigured) {
    toastWarn('Connect Joggl to Jira in Settings before syncing.');
    return;
  }

  running = true;
  renderAll();

  const submitted = [];
  const markedLocal = [];
  /** @type {{day: string, entry: object}[]} */
  const failed = [];
  let done = 0;

  try {
    for (const day of targets) {
      const result = await runFinishDay(entriesFor(day), submitWorklog, {
        onProgress: () => {
          done += 1;
          setBusyLabels(syncLabel(plan, { busy: true, done, total: plan.toSubmit.length }));
        },
      });

      setEntriesFor(day, result.entries);
      await persistDayNow(day);
      // What Jira holds for this day has just changed, so the cached rows are stale
      // by definition — Sync is the one thing that changes them.
      invalidateExternal(day);

      submitted.push(...result.submitted);
      markedLocal.push(...result.markedLocal);
      for (const entry of result.failed) failed.push({ day, entry });
    }

    if (markedLocal.length > 0) {
      toast(
        `${markedLocal.length} entr${markedLocal.length === 1 ? 'y' : 'ies'} ` +
          'without an issue key marked local — they count towards the total but never sync.',
      );
    }

    if (failed.length === 0) {
      if (submitted.length > 0) {
        const total = submitted.reduce((sum, e) => sum + (e.endTs - e.startTs), 0);
        toastOk(
          `${submitted.length} worklog${submitted.length === 1 ? '' : 's'} ` +
            `(${msToDur(total)}) logged to Jira.`,
        );
      }
      return;
    }

    await showFailureSummary({ submitted, failed }, { verb, isToday: today });
  } finally {
    running = false;
    renderAll();
    // Re-read whatever the mounted view draws: newly created worklogs are now
    // claimed by local entries, and the two views must not disagree about Jira.
    notifyDayChange(state.selectedDate);
  }
}

/** Both Sync buttons say the same thing while a run is in flight. */
function setBusyLabels(text) {
  for (const id of ['finish-day-btn', 'week-sync-btn']) {
    const button = document.getElementById(id);
    if (button) button.textContent = text;
  }
}

// No automatic retry. The user sees exactly what failed and decides.
//
// The day is carried on each failure rather than read again: this modal stays open
// for as long as the user reads it, and a week's failures can span several days.
async function showFailureSummary({ submitted, failed }, options) {
  const days = [...new Set(failed.map((f) => f.day))];
  const body = document.createElement('div');
  const list = document.createElement('ul');
  list.className = 'fail-list';
  list.innerHTML = failed
    .map(
      ({ day, entry }) =>
        `<li><strong>${esc(entry.issueKey)}</strong> — ${esc(entry.title)} ` +
        `(${msToDur(entry.endTs - entry.startTs)})` +
        // Only when more than one day is in play; on a single day it is noise.
        `${days.length > 1 ? ` · ${esc(formatDateLabel(day))}` : ''}` +
        `<br><small>${esc(entry.errorMsg)}</small></li>`,
    )
    .join('');

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `${submitted.length} entr${submitted.length === 1 ? 'y' : 'ies'} reached Jira. ` +
    `${failed.length} did not, and ${failed.length === 1 ? 'it is' : 'they are'} ` +
    'still marked pending locally — nothing was logged twice.';

  body.append(lede, list);

  const answer = await askModal({
    title: `${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} failed to sync`,
    body,
    buttons: [
      { label: 'Close', value: 'close' },
      { label: 'Retry failed', value: 'retry', primary: true },
    ],
    dismissValue: 'close',
  });

  if (answer !== 'retry') return;

  for (const day of days) {
    setEntriesFor(day, resetFailedForRetry(entriesFor(day)));
    await persistDayNow(day);
  }
  renderAll();

  // running is still true here, so clear it before recursing into the next attempt.
  running = false;
  await syncDays(days, options);
}
