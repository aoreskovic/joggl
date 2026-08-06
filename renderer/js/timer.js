// The running timer: start, stop, restore after a crash, and the merge decision
// that happens the moment a timer starts.

import { applyMerge, decideMerge, sortEntries, taskKeyOf } from './merge.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import { entriesFor, isToday, persistTimer, readDay, state, writeDay } from './state.js';
import { toast, toastOk, toastWarn } from './toast.js';
import { dateKey, esc, msToDur, msToHHMMSS, todayKey, tsToHHMM, uuid } from './util.js';

const MIN_ENTRY_MS = 10_000;

let tickHandle = null;
let pendingStartTs = null;

export function setPendingStartTs(ts) {
  pendingStartTs = ts;
}

export function getPendingStartTs() {
  return pendingStartTs;
}

export function isRunning() {
  return Boolean(state.timer);
}

/**
 * @param {{issueKey?: string|null, issueId?: string|null, title: string}} task
 */
export async function startTimer(task) {
  if (!isToday()) {
    toastWarn('The timer only runs on today. Switch to today to start tracking.');
    return;
  }
  // Already running this very task: do nothing rather than stop and start again.
  //
  // A double click on a task row used to arrive here twice, and the second call
  // stopped the timer it had just started — a fragment under ten seconds old is
  // discarded on purpose, so a slip of the finger threw the elapsed time away.
  // `taskKeyOf` is merge.js's definition of "the same task", shared so the timer
  // and the merge cannot disagree about it.
  if (state.timer && taskKeyOf(state.timer) === taskKeyOf(task)) return;

  if (state.timer) await stopTimer();

  const startTs = pendingStartTs ?? Date.now();
  pendingStartTs = null;

  if (startTs > Date.now()) {
    toastWarn('Start time cannot be in the future.');
    return;
  }

  const draft = {
    issueKey: task.issueKey ?? null,
    issueId: task.issueId ?? null,
    title: task.title?.trim() || task.issueKey || 'Untitled',
  };

  const mergeChoice = await resolveMergeChoice(draft, startTs);

  state.timer = {
    entryId: uuid(),
    ...draft,
    startTs,
    mergeChoice,
    // The bound the merge decision was made against. It travels with mergeChoice
    // because the two were decided together and only mean anything together: the
    // omnibar can edit `startTs` while the timer runs without retaking the
    // decision, so recomputing this at stop would change the candidate set behind
    // the user's back. Persisted with the timer, so a restore keeps it.
    mergeNotAfterTs: startTs,
  };

  await persistTimer();
  startTicking();
  renderAll();
}

async function resolveMergeChoice(draft, startTs) {
  const decision = decideMerge(state.entries, taskKeyOf(draft), startTs);

  if (decision.action === 'new') return null;

  if (decision.action === 'merge') {
    toast(
      `Continuing "${draft.title}" — this will merge into the earlier entry ` +
        `(${msToDur(Math.max(0, decision.gapMs))} gap).`,
    );
    return 'merge';
  }

  const body = document.createElement('div');
  body.innerHTML =
    `<p class="panel-lede"><strong>${esc(draft.title)}</strong> already has ` +
    `${decision.candidates.length} unsynced entr${decision.candidates.length === 1 ? 'y' : 'ies'} today, ` +
    `totalling <strong>${msToDur(decision.totalMs)}</strong> between ` +
    `<strong>${tsToHHMM(decision.earliestTs)}</strong> and <strong>${tsToHHMM(decision.latestTs)}</strong>.</p>` +
    `<p class="panel-lede">The gap since the last one is <strong>${msToDur(decision.gapMs)}</strong>. ` +
    `Merging makes one block that spans the gap.</p>`;

  const answer = await askModal({
    title: 'Merge with the earlier entry?',
    body,
    buttons: [
      { label: 'Keep separate', value: 'separate' },
      { label: 'Merge into one', value: 'merge', primary: true },
    ],
    dismissValue: 'separate',
  });

  return answer === 'merge' ? 'merge' : null;
}

/**
 * @param {{save?: boolean}} [opts] `save: false` discards the elapsed time —
 *        used when the entry it belongs to is being deleted.
 */
export async function stopTimer({ save = true } = {}) {
  const timer = state.timer;
  if (!timer) return;

  stopTicking();
  state.timer = null;

  const endTs = Date.now();
  const elapsed = endTs - timer.startTs;

  if (save && elapsed < MIN_ENTRY_MS) {
    toastWarn('Entry discarded — under 10 seconds.');
    save = false;
  }

  if (save) {
    const entry = {
      id: timer.entryId,
      issueKey: timer.issueKey,
      issueId: timer.issueId,
      title: timer.title,
      startTs: timer.startTs,
      endTs,
      status: timer.issueKey ? 'pending' : 'local',
      worklogId: null,
      // A timed block starts with no Work Description; it is added afterwards from
      // the right-click menu, once there is something to say about it.
      comment: null,
      errorMsg: null,
    };

    // The entry belongs to the day it started on, which is not necessarily the
    // day currently on screen — the user may have paged back while it ran.
    const targetDate = dateKey(timer.startTs);
    const existing =
      targetDate === state.selectedDate
        ? entriesFor(targetDate)
        : (await readDay(targetDate)).entries;

    // A timer written by an older build has no stored bound; fall back to the
    // entry's start, which is what applyMerge used to derive on its own.
    const notAfterTs = timer.mergeNotAfterTs ?? entry.startTs;

    const merged =
      timer.mergeChoice === 'merge'
        ? sortEntries(applyMerge(existing, entry, notAfterTs))
        : sortEntries([...existing, entry]);

    // One path for both cases now that the write names its day. `writeDay` files the
    // result under `targetDate` and keeps what the store actually wrote, which is
    // what the off-screen branch always did; the on-screen branch used to assign
    // `state.entries` and save "the selected day" separately, which was the same
    // thing only for as long as nobody stepped the day between the two lines.
    await writeDay(targetDate, merged);
    toastOk(`Logged ${msToDur(elapsed)} on ${entry.issueKey ?? entry.title}.`);
  }

  await persistTimer();
  renderAll();
}

/**
 * Restore a timer that survived a quit or a crash. One left running overnight is
 * stopped and written to the day it belongs to rather than inflating today.
 */
export async function restoreTimer(saved) {
  if (!saved?.startTs) return;
  state.timer = saved;

  if (dateKey(saved.startTs) !== todayKey()) {
    await stopTimer();
    toastWarn('A timer left running from an earlier day was stopped and saved to that day.');
    return;
  }
  startTicking();
}

// ── Ticking ────────────────────────────────────────────────────────────────

const tickListeners = new Set();

export function onTick(fn) {
  tickListeners.add(fn);
}

function startTicking() {
  stopTicking();
  tick();
  tickHandle = setInterval(tick, 1000);
}

function stopTicking() {
  clearInterval(tickHandle);
  tickHandle = null;
  const display = document.getElementById('timer-display');
  if (display) {
    display.textContent = '00:00:00';
    display.classList.remove('running');
  }
}

function tick() {
  const timer = state.timer;
  if (!timer) return;
  const display = document.getElementById('timer-display');
  if (display) {
    display.textContent = msToHHMMSS(Date.now() - timer.startTs);
    display.classList.add('running');
  }
  for (const listener of tickListeners) {
    try {
      listener();
    } catch (err) {
      console.error('Tick listener failed:', err);
    }
  }
}
