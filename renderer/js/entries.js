// The entry list: cards, inline editing with bidirectional recalculation, and
// the day total.

import { showContextMenu } from './context-menu.js';
import { duplicateOf, overlappingIds } from './entry-ops.js';
import { PLAY_ICON } from './icons.js';
import { sortEntries } from './merge.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import {
  deleteWorklog,
  isToday,
  persistDay,
  persistDayNow,
  state,
  visibleEntries,
} from './state.js';
import { startTimer, stopTimer } from './timer.js';
import { toast, toastErr, toastOk, toastWarn } from './toast.js';
import { esc, hhmmToTs, msToDur, parseDur, snapToQuarter, tsToHHMM, uuid } from './util.js';

const STATUS_LABEL = {
  pending: '● pending',
  synced: '✓ synced',
  error: '✗ error',
  local: '◇ local',
};

/** True for worklogs that came from Jira and that Joggl has no business rewriting. */
const isExternal = (entry) => entry.external === true;

export function calcTotalMs() {
  // Includes Jira-side worklogs: a total that ignores time booked in the web UI
  // is worse than no total at all.
  let ms = visibleEntries().reduce(
    (sum, e) => sum + Math.max(0, (e.endTs ?? e.startTs) - e.startTs),
    0,
  );
  if (state.timer && isToday()) ms += Date.now() - state.timer.startTs;
  return ms;
}

export function updateTotal() {
  const el = document.getElementById('total-display');
  if (el) el.textContent = `Total: ${msToDur(calcTotalMs())}`;
}

export function renderEntryList() {
  const list = document.getElementById('entry-list');
  if (!list) return;

  const entries = visibleEntries();
  const children = [];

  if (entries.length === 0) {
    children.push(note(state.externalState === 'loading' ? 'Loading…' : 'No entries for this day'));
  } else {
    const overlaps = overlappingIds(entries);
    children.push(
      ...sortEntries(entries).map((entry) => buildEntryCard(entry, overlaps.has(entry.id))),
    );
  }

  if (state.externalState === 'error') {
    children.push(
      note(`Could not read this day's worklogs from Jira — ${state.externalError}`, 'warn'),
    );
  }

  list.replaceChildren(...children);
}

function note(text, kind) {
  const el = document.createElement('div');
  el.className = `timeline-empty${kind ? ` ${kind}` : ''}`;
  el.textContent = text;
  return el;
}

function buildEntryCard(entry, isOverlapping) {
  const duration = Math.max(0, (entry.endTs ?? entry.startTs) - entry.startTs);
  const external = isExternal(entry);
  // External rows still take part in overlap detection, so a local entry that
  // clashes with one is flagged — but the warning is not repeated on the Jira row
  // itself. It invites a fix, and there is nothing here to fix: the row is
  // read-only and the clash is Jira's to sort out.
  const flagOverlap = isOverlapping && !external;

  const card = document.createElement('div');
  card.className =
    'entry-card' + (flagOverlap ? ' overlapping' : '') + (external ? ' external' : '');
  card.dataset.id = entry.id;

  card.innerHTML =
    '<div class="entry-name">' +
    '<div class="entry-name-row">' +
    (entry.issueKey ? `<span class="entry-jira">${esc(entry.issueKey)}</span>` : '') +
    `<span class="entry-title" title="${esc(entry.title)}">${esc(entry.title)}</span>` +
    '</div>' +
    (external
      ? '<div class="entry-sub" title="Logged straight into Jira, not by Joggl. ' +
        'Shown so the day total is right; edit it in Jira.">Manual Jira entry</div>'
      : '') +
    '</div>' +
    '<div class="time-range">' +
    `<input class="ie time-ie" data-f="start" data-id="${esc(entry.id)}" value="${tsToHHMM(entry.startTs)}" title="Start time">` +
    '<span class="sep">–</span>' +
    `<input class="ie time-ie" data-f="end" data-id="${esc(entry.id)}" value="${tsToHHMM(entry.endTs ?? entry.startTs)}" title="End time">` +
    '</div>' +
    `<input class="ie dur-ie" data-f="dur" data-id="${esc(entry.id)}" value="${msToDur(duration)}" title="Duration, e.g. 1h 30m">` +
    `<span class="status-badge st-${esc(entry.status)}" title="${esc(entry.errorMsg ?? '')}">${STATUS_LABEL[entry.status] ?? entry.status}</span>` +
    '<div class="entry-actions">' +
    `<button class="icon-btn" data-a="restart" data-id="${esc(entry.id)}" title="Restart timer on this issue">${PLAY_ICON}</button>` +
    (external
      ? ''
      : `<button class="icon-btn del" data-a="delete" data-id="${esc(entry.id)}" title="Delete">🗑</button>`) +
    '</div>' +
    (flagOverlap
      ? '<div class="entry-err-row">⚠ Overlaps another entry — allowed, but usually a mistake.</div>'
      : '') +
    (entry.errorMsg ? `<div class="entry-err-row">⚠ ${esc(entry.errorMsg)}</div>` : '');

  // Joggl's own entries stay editable after syncing — the edit rewrites the
  // worklog on the next Finish Day. Worklogs Joggl did not create are another
  // matter: it has no record of them beyond what Jira just said, so it does not
  // get to rewrite them.
  if (external) {
    for (const input of card.querySelectorAll('.ie')) {
      input.disabled = true;
      input.title = 'Logged directly in Jira — edit it there.';
    }
  }

  for (const input of card.querySelectorAll('.ie')) {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') {
        resetInput(input);
        input.blur();
      }
    });
    input.addEventListener('blur', handleInlineEdit);
  }
  for (const button of card.querySelectorAll('[data-a]')) {
    button.addEventListener('click', handleEntryAction);
  }

  // The same menu the day-view blocks get — right-clicking the row is where most
  // people will try first.
  card.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.ie')) return; // leave the text fields their own menu
    event.preventDefault();
    showContextMenu(event, entry);
  });

  return card;
}

function currentEntry(id) {
  return visibleEntries().find((e) => e.id === id) ?? null;
}

function resetInput(input) {
  const entry = currentEntry(input.dataset.id);
  if (!entry) return;
  if (input.dataset.f === 'start') input.value = tsToHHMM(entry.startTs);
  else if (input.dataset.f === 'end') input.value = tsToHHMM(entry.endTs ?? entry.startTs);
  else input.value = msToDur((entry.endTs ?? entry.startTs) - entry.startTs);
}

// Rejections are shown on the field itself. Never a modal — modals are for
// decisions, and there is nothing to decide about a typo.
function rejectInput(input, message) {
  input.classList.add('error');
  input.title = message;
  resetInput(input);
  setTimeout(() => {
    input.classList.remove('error');
    input.title = '';
  }, 2000);
}

function handleInlineEdit(event) {
  const input = event.target;
  const entry = currentEntry(input.dataset.id);
  if (!entry || isExternal(entry)) return;

  const field = input.dataset.f;
  const card = input.closest('.entry-card');

  if (field === 'start') {
    const ts = hhmmToTs(input.value, state.selectedDate);
    if (ts === null) return rejectInput(input, 'Use HH:MM, e.g. 09:30');
    if (entry.endTs !== null && ts >= entry.endTs) {
      return rejectInput(input, 'Start must be before the end time');
    }
    // A start in the future is deliberately allowed here. Leave, an out-of-office
    // block, or a meeting already in the diary is drawn by hand precisely because
    // it has not happened, and rejecting the edit left such a block three-quarters
    // editable: end, duration and the day-view drag all accepted it. Only a
    // *running timer* may not start in the future — guarded in the omnibar's
    // start-time field (app.js) and again in startTimer (timer.js).
    entry.startTs = ts;
  } else if (field === 'end') {
    const ts = hhmmToTs(input.value, state.selectedDate);
    if (ts === null) return rejectInput(input, 'Use HH:MM, e.g. 17:00');
    if (ts <= entry.startTs) return rejectInput(input, 'End must be after the start time');
    entry.endTs = ts;
  } else if (field === 'dur') {
    const ms = parseDur(input.value);
    if (ms === null) return rejectInput(input, 'Use a duration like 1h 30m or 45m');
    entry.endTs = entry.startTs + ms;
  }

  // Bidirectional recalculation: whichever field changed, the other two follow.
  if (card) {
    const startInput = card.querySelector('[data-f="start"]');
    const endInput = card.querySelector('[data-f="end"]');
    const durInput = card.querySelector('[data-f="dur"]');
    if (startInput) startInput.value = tsToHHMM(entry.startTs);
    if (endInput) endInput.value = tsToHHMM(entry.endTs ?? entry.startTs);
    if (durInput) durInput.value = msToDur((entry.endTs ?? entry.startTs) - entry.startTs);
  }

  markDirty(entry);
  persistDay();
  renderAll();
}

/**
 * An entry that changed needs syncing again. A previously synced one keeps its
 * worklogId so the next Finish Day rewrites that worklog rather than adding a
 * second one for the same stretch of time.
 */
export function markDirty(entry) {
  if (isExternal(entry)) return;
  if (!entry.issueKey) {
    entry.status = 'local';
    entry.errorMsg = null;
    return;
  }
  if (entry.status === 'synced' || entry.status === 'error') {
    entry.status = 'pending';
    entry.errorMsg = null;
  }
}

async function handleEntryAction(event) {
  const button = event.currentTarget;
  const entry = currentEntry(button.dataset.id);
  if (!entry) return;

  if (button.dataset.a === 'delete') {
    await deleteEntry(entry.id);
    return;
  }

  if (button.dataset.a === 'restart') {
    if (!isToday()) {
      toastWarn('The timer only runs on today.');
      return;
    }
    await startTimer({ issueKey: entry.issueKey, issueId: entry.issueId, title: entry.title });
  }
}

/** Shared by the entry list and the day-view context menu. */
export async function deleteEntry(id) {
  const entry = currentEntry(id);
  if (!entry) return;

  if (isExternal(entry)) {
    toastWarn('This worklog was made in Jira — delete it there.');
    return;
  }

  // Deleting locally would leave the time booked in Jira with nothing on screen
  // to show for it, so the worklog is the decision, not an afterthought.
  if (entry.worklogId) {
    const answer = await askModal({
      title: 'This entry is already in Jira',
      body: `${entry.issueKey} has ${msToDur(entry.endTs - entry.startTs)} logged as worklog ${entry.worklogId}. Deleting it here does not remove it from Jira.`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Remove here only', value: 'local' },
        { label: 'Delete in Jira too', value: 'jira', primary: true },
      ],
      dismissValue: 'cancel',
    });
    if (answer === 'cancel') return;

    if (answer === 'jira') {
      try {
        await deleteWorklog(entry);
        toastOk(`Worklog removed from ${entry.issueKey}.`);
      } catch (err) {
        toastErr(`Could not delete the worklog in Jira — ${err.message}`);
        return;
      }
    }
  }

  if (state.timer?.entryId === id) await stopTimer({ save: false });
  state.entries = state.entries.filter((e) => e.id !== id);
  await persistDayNow();
  renderAll();
}

/**
 * Copy an entry onto the same stretch of time. The two land side by side in the
 * day view's overlap columns, which is the handle for dragging the copy where it
 * belongs — moving it is the expected next step, not a correction.
 */
export async function duplicateEntry(id) {
  const entry = currentEntry(id);
  if (!entry || entry.endTs === null) return;

  const copy = duplicateOf(entry, uuid());
  state.entries = sortEntries([...state.entries, copy]);
  await persistDayNow();
  renderAll();

  toast(
    `Copied ${copy.issueKey ?? copy.title} onto ${tsToHHMM(copy.startTs)}–${tsToHHMM(copy.endTs)}. ` +
      'Drag it where it belongs.',
  );
}

export async function splitEntry(id) {
  const entry = currentEntry(id);
  if (!entry || entry.endTs === null) return;
  if (isExternal(entry)) {
    toastWarn('This worklog was made in Jira — split it there.');
    return;
  }
  if (entry.worklogId) {
    // Splitting would need one worklog updated and a second one created. Doable,
    // but not worth the failure modes until someone actually wants it.
    toastWarn(
      `${entry.issueKey} is already synced. Delete it first if you need to split it, ` +
        'or split the worklog in Jira.',
    );
    return;
  }

  const midpoint = snapToQuarter((entry.startTs + entry.endTs) / 2, state.selectedDate);
  if (midpoint <= entry.startTs || midpoint >= entry.endTs) {
    toastWarn('Entry is too short to split.');
    return;
  }

  const second = { ...entry, id: uuid(), startTs: midpoint, worklogId: null };
  entry.endTs = midpoint;
  state.entries = sortEntries([...state.entries, second]);
  await persistDayNow();
  renderAll();
}
