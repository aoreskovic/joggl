// Finish Day / Re-sync Day — the only path from Joggl to Jira.

import { planFinishDay, resetFailedForRetry, runFinishDay } from './finish-day.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import { isToday, persistDayNow, state, submitWorklog } from './state.js';
import { toast, toastOk, toastWarn } from './toast.js';
import { esc, msToDur } from './util.js';

let running = false;

export function updateFinishButton() {
  const button = document.getElementById('finish-day-btn');
  if (!button) return;
  button.textContent = running ? 'Syncing…' : isToday() ? 'Finish Day' : 'Re-sync Day';
  button.disabled = running;
}

export async function finishDay() {
  if (running) return;

  const plan = planFinishDay(state.entries);

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
    const result = await runFinishDay(state.entries, submitWorklog, {
      onProgress: (done, total) => {
        const button = document.getElementById('finish-day-btn');
        if (button) button.textContent = `Syncing ${done}/${total}…`;
      },
    });

    state.entries = result.entries;
    await persistDayNow();

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

    await showFailureSummary(result);
  } finally {
    running = false;
    updateFinishButton();
    renderAll();
  }
}

// No automatic retry. The user sees exactly what failed and decides.
async function showFailureSummary(result) {
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

  state.entries = resetFailedForRetry(state.entries);
  await persistDayNow();
  renderAll();

  // running is still true here, so clear it before recursing into the next attempt.
  running = false;
  await finishDay();
}
