// Copy previous day, and clear day.
//
// Filling in a day that looks like the last one worked meant dragging every issue
// across by hand; emptying one meant deleting entries a row at a time.
//
// The awkward part is finding the day to copy. Jira-side entries are never persisted,
// so "the most recent day with anything on it" cannot be answered from the day logs
// alone: a day worked entirely through the Jira web UI has no local entries at all,
// and skipping it would copy the wrong day without saying so. `state.external` now
// holds a day at a time across the whole lookback window rather than just the day on
// screen, which is what lets one range read answer the entire search below.

import { findLastDayWithEntries, MAX_LOOKBACK_DAYS } from './day-search.js';
import { copiedToDay, planClearWeek } from './entry-ops.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import { entriesFor, loadDays, persistDayNow, setEntriesFor, state } from './state.js';
import { toast, toastErr, toastOk } from './toast.js';
import { addDays, esc, formatDateLabel, msToDur } from './util.js';

/**
 * Pull the whole lookback window in one go, then answer from it.
 *
 * The search itself is unchanged — it still walks back a day at a time and still
 * stops at the first day with anything on it. What changed is what a step costs:
 * each one used to be a JQL plus a worklog read per issue it found, so a fortnight
 * off meant fourteen sequential round trips and a visible wait. One range read
 * covers all thirty days for the price of one, and the walk becomes arithmetic.
 */
async function prefetchedReaders(from) {
  const oldest = addDays(from, -MAX_LOOKBACK_DAYS);
  const newest = addDays(from, -1);
  await loadDays(oldest, newest);
  return {
    readLocal: async (key) => entriesFor(key),
    readJira: async (key) => state.external.get(key) ?? [],
  };
}

let busy = false;

/**
 * @param {string} [target] the day to fill. Defaults to the day on screen; the week
 *   view passes the column's own day, which is usually not the same thing.
 */
export async function copyPreviousDay(target = state.selectedDate) {
  if (busy) return;
  const button = document.getElementById('copy-day-btn');
  busy = true;

  if (button) {
    button.textContent = 'Looking…';
    button.disabled = true;
  }

  try {
    const { readLocal, readJira } = await prefetchedReaders(target);
    const found = await findLastDayWithEntries({ from: target, readLocal, readJira });

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

    setEntriesFor(target, [...entriesFor(target), ...copies]);
    await persistDayNow(target);
    renderAll();
    toastOk(`${plural(copies.length)} copied from ${formatDateLabel(found.dayKey)}.`);
  } finally {
    busy = false;
    if (button) {
      button.textContent = 'Copy previous day';
      button.disabled = false;
    }
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

  const already = entriesFor(target);
  if (already.length > 0) {
    const warn = document.createElement('p');
    warn.className = 'panel-lede';
    warn.innerHTML =
      `<strong>${esc(formatDateLabel(target))} already has ${plural(already.length)}.</strong> ` +
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

/**
 * @param {string} [day] the day to empty. Local only — this never issues a DELETE to
 *   Jira, and cannot touch a Jira-side row because those are not `state.entries`.
 */
export async function clearDay(day = state.selectedDate) {
  // Fixed before the modal opens: it stays up for as long as the user reads it, and
  // clearing must empty the day the button was pressed on.
  const entries = entriesFor(day);
  const synced = entries.filter((e) => e.worklogId);
  const rest = entries.filter((e) => !e.worklogId);

  if (entries.length === 0) {
    toast('Nothing to clear on this day.');
    return;
  }

  const answer = await askModal({
    title: `Clear ${formatDateLabel(day)}?`,
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

  setEntriesFor(day, answer === 'unsynced' ? synced : []);
  await persistDayNow(day);
  renderAll();
  toastOk(answer === 'unsynced' ? `${plural(rest.length)} cleared.` : 'Day cleared.');
}

/**
 * Empty a whole week.
 *
 * The same promise `clearDay` makes, seven times over: local only, nothing is deleted
 * from Jira, and rows logged in the Jira web UI are not Joggl's to remove. Asked once
 * rather than per day — seven modals is not a confirmation, it is an obstacle course
 * — and the count in the question is what makes it answerable.
 */
export async function clearWeek(days) {
  const plan = planClearWeek(days, entriesFor);

  if (plan.all.length === 0) {
    toast('Nothing to clear this week.');
    return;
  }

  const body = clearBody(plan.synced, plan.unsynced, 'This week');
  const days_ = document.createElement('p');
  days_.className = 'panel-lede';
  days_.textContent = `Across ${plan.days.length} day${plan.days.length === 1 ? '' : 's'}.`;
  body.appendChild(days_);

  const answer = await askModal({
    title: 'Clear this week?',
    body,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      ...(plan.offerUnsyncedOnly ? [{ label: 'Clear unsynced only', value: 'unsynced' }] : []),
      { label: 'Clear all', value: 'all', primary: true },
    ],
    dismissValue: 'cancel',
  });
  if (answer === 'cancel') return;

  // Every day's result is computed and written to memory before any write to disk
  // is attempted, so whatever happens next the screen — once `renderAll` runs in the
  // `finally` below — shows every column cleared. A `persistDayNow` that throws
  // partway through only risks that one day's clear not surviving a restart; it does
  // not leave any column looking untouched on screen right now.
  for (const day of plan.days) {
    setEntriesFor(day, plan.resultFor(day, answer));
  }

  try {
    for (const day of plan.days) {
      await persistDayNow(day);
    }
    toastOk(answer === 'unsynced' ? `${plural(plan.unsynced.length)} cleared.` : 'Week cleared.');
  } catch (err) {
    toastErr(`Could not save clearing the week — ${err.message}`);
  } finally {
    renderAll();
  }
}

function clearBody(synced, rest, subject = 'This day') {
  const body = document.createElement('div');
  const lines = [];

  if (rest.length > 0) lines.push(`${plural(rest.length)} not yet in Jira`);
  if (synced.length > 0) lines.push(`${plural(synced.length)} already synced`);

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent = `${subject} holds ${lines.join(' and ')}.`;
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
