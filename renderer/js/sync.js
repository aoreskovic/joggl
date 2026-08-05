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
import { entriesFor, isToday, persistDayNow, setEntriesFor, state, submitWorklog } from './state.js';
import { toast, toastOk, toastWarn } from './toast.js';
import { esc, msToDur } from './util.js';

let running = false;

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

export async function finishDay() {
  if (running) return;

  // The day this sync is about, fixed before anything is awaited. A sync takes
  // seconds and the day can be stepped while it runs; the results belong to the day
  // whose entries were submitted, not to whatever is on screen when Jira answers.
  const day = state.selectedDate;
  const plan = planFinishDay(entriesFor(day));

  if (plan.toSubmit.length === 0 && plan.toMarkLocal.length === 0) {
    toast(
      plan.alreadySynced.length > 0
        ? 'Everything on this day is already in Jira.'
        : 'Nothing to sync on this day.',
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
  updateFinishButton();

  try {
    const result = await runFinishDay(entriesFor(day), submitWorklog, {
      onProgress: (done, total) => {
        const button = document.getElementById('finish-day-btn');
        if (button) button.textContent = syncLabel(plan, { busy: true, done, total });
      },
    });

    setEntriesFor(day, result.entries);
    await persistDayNow(day);

    if (result.markedLocal.length > 0) {
      toast(
        `${result.markedLocal.length} entr${result.markedLocal.length === 1 ? 'y' : 'ies'} ` +
          'without an issue key marked local — they count towards the total but never sync.',
      );
    }

    if (result.failed.length === 0) {
      if (result.submitted.length > 0) {
        const total = result.submitted.reduce((sum, e) => sum + (e.endTs - e.startTs), 0);
        toastOk(
          `${result.submitted.length} worklog${result.submitted.length === 1 ? '' : 's'} ` +
            `(${msToDur(total)}) logged to Jira.`,
        );
      }
      return;
    }

    await showFailureSummary(result, day);
  } finally {
    running = false;
    updateFinishButton();
    renderAll();
  }
}

// No automatic retry. The user sees exactly what failed and decides.
//
// `day` is carried in rather than read again: this modal stays open for as long as
// the user reads it, and the entries it is about belong to the day that was synced.
async function showFailureSummary(result, day) {
  const body = document.createElement('div');
  const list = document.createElement('ul');
  list.className = 'fail-list';
  list.innerHTML = result.failed
    .map(
      (entry) =>
        `<li><strong>${esc(entry.issueKey)}</strong> — ${esc(entry.title)} ` +
        `(${msToDur(entry.endTs - entry.startTs)})<br><small>${esc(entry.errorMsg)}</small></li>`,
    )
    .join('');

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `${result.submitted.length} entr${result.submitted.length === 1 ? 'y' : 'ies'} reached Jira. ` +
    `${result.failed.length} did not, and ${result.failed.length === 1 ? 'it is' : 'they are'} ` +
    'still marked pending locally — nothing was logged twice.';

  body.append(lede, list);

  const answer = await askModal({
    title: `${result.failed.length} entr${result.failed.length === 1 ? 'y' : 'ies'} failed to sync`,
    body,
    buttons: [
      { label: 'Close', value: 'close' },
      { label: 'Retry failed', value: 'retry', primary: true },
    ],
    dismissValue: 'close',
  });

  if (answer !== 'retry') return;

  setEntriesFor(day, resetFailedForRetry(entriesFor(day)));
  await persistDayNow(day);
  renderAll();

  // running is still true here, so clear it before recursing into the next attempt.
  running = false;
  await finishDay();
}
