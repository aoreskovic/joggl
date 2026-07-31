// Copy previous day, and clear day.
//
// Filling in a day that looks like the last one worked meant dragging every issue
// across by hand; emptying one meant deleting entries a row at a time.
//
// The awkward part is finding the day to copy. Jira-side entries are not stored —
// `state.externalEntries` holds them only for the day on screen — so "the most
// recent day with anything on it" cannot be answered from the day logs alone. A day
// worked entirely through the Jira web UI has no local entries at all, and skipping
// it would copy the wrong day without saying so.

import { findLastDayWithEntries, MAX_LOOKBACK_DAYS } from './day-search.js';
import { copiedToDay } from './entry-ops.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import { persistDayNow, readDay, state } from './state.js';
import { toast, toastOk } from './toast.js';
import { DAY, esc, formatDateLabel, msToDur, startOfDayMs } from './util.js';

/** Reads one day's Jira worklogs. Answers [] rather than throwing when Jira is off. */
function jiraReader() {
  if (!state.settings.baseUrl || !state.settings.tokenConfigured) return async () => [];
  return async (dayKey) => {
    const dayStartTs = startOfDayMs(dayKey);
    return window.joggl.jira.dayWorklogs(dayKey, dayStartTs, dayStartTs + DAY);
  };
}

let busy = false;

export async function copyPreviousDay() {
  if (busy) return;
  const button = document.getElementById('copy-day-btn');
  const target = state.selectedDate;
  busy = true;

  try {
    const found = await findLastDayWithEntries({
      from: target,
      readLocal: async (key) => (await readDay(key)).entries,
      readJira: jiraReader(),
      // Says how far it has got, because a fortnight off means a real wait and a
      // button that only says "Looking…" gives no reason to believe it is working.
      onProgress: (back) => {
        if (button) button.textContent = `Looking… ${back}d`;
      },
    });

    if (!found) {
      toast(`Nothing to copy — no entries in the last ${MAX_LOOKBACK_DAYS} days.`);
      return;
    }

    const copies = copiedToDay(found.entries, found.dayKey, target);
    if (copies.length === 0) {
      toast('Nothing to copy — that day holds only a running timer.');
      return;
    }

    if ((await confirmCopy(found, copies, target)) !== 'copy') return;

    state.entries = [...state.entries, ...copies];
    await persistDayNow();
    renderAll();
    toastOk(`${plural(copies.length)} copied from ${formatDateLabel(found.dayKey)}.`);
  } finally {
    busy = false;
    if (button) button.textContent = 'Copy previous day';
    renderAll();
  }
}

function confirmCopy(found, copies, target) {
  const total = copies.reduce((sum, e) => sum + (e.endTs - e.startTs), 0);
  const body = document.createElement('div');

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.innerHTML =
    `${plural(copies.length)} from <strong>${esc(formatDateLabel(found.dayKey))}</strong>, ` +
    `${esc(msToDur(total))} in all, at the same times on the clock.` +
    // Copies of Jira-side rows arrive as Joggl's own pending entries, so the next
    // Sync logs them as new worklogs. Worth saying before, not after.
    ' They arrive unsynced, so nothing reaches Jira until you press Sync.';
  body.appendChild(lede);

  if (state.entries.length > 0) {
    const warn = document.createElement('p');
    warn.className = 'panel-lede';
    warn.innerHTML =
      `<strong>${esc(formatDateLabel(target))} already has ${plural(state.entries.length)}.</strong> ` +
      'The copies are added to them, not put in their place.';
    body.appendChild(warn);
  }

  return askModal({
    title: 'Copy previous day',
    body,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Copy', value: 'copy', primary: true },
    ],
    dismissValue: 'cancel',
  });
}

export async function clearDay() {
  const synced = state.entries.filter((e) => e.worklogId);
  const rest = state.entries.filter((e) => !e.worklogId);

  if (state.entries.length === 0) {
    toast('Nothing to clear on this day.');
    return;
  }

  const answer = await askModal({
    title: `Clear ${formatDateLabel(state.selectedDate)}?`,
    body: clearBody(synced, rest),
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      ...(synced.length > 0 && rest.length > 0
        ? [{ label: 'Clear unsynced only', value: 'unsynced' }]
        : []),
      { label: 'Clear all', value: 'all', primary: true },
    ],
    dismissValue: 'cancel',
  });
  if (answer === 'cancel') return;

  state.entries = answer === 'unsynced' ? synced : [];
  await persistDayNow();
  renderAll();
  toastOk(answer === 'unsynced' ? `${plural(rest.length)} cleared.` : 'Day cleared.');
}

function clearBody(synced, rest) {
  const body = document.createElement('div');
  const lines = [];

  if (rest.length > 0) lines.push(`${plural(rest.length)} not yet in Jira`);
  if (synced.length > 0) lines.push(`${plural(synced.length)} already synced`);

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent = `This day holds ${lines.join(' and ')}.`;
  body.appendChild(lede);

  // Both of these have caught people out in the single-entry version, so they are
  // said before the button is pressed rather than explained afterwards.
  const note = document.createElement('p');
  note.className = 'panel-lede';
  note.textContent =
    synced.length > 0
      ? 'Nothing is deleted from Jira. Time already synced stays logged there — this ' +
        'only removes Joggl’s copy of it, and rows logged in the Jira web UI are not ' +
        'touched at all.'
      : 'Rows logged in the Jira web UI are not touched — they are not Joggl’s to remove.';
  body.appendChild(note);

  return body;
}

const plural = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
