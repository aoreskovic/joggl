// The entry list: cards, inline editing with bidirectional recalculation, and
// the day total.

import { sortEntries } from './merge.js';
import { renderAll } from './render.js';
import { isToday, persistDay, persistDayNow, state } from './state.js';
import { startTimer, stopTimer } from './timer.js';
import { toastWarn } from './toast.js';
import { esc, hhmmToTs, msToDur, parseDur, tsToHHMM } from './util.js';

const STATUS_LABEL = {
  pending: '● pending',
  synced: '✓ synced',
  error: '✗ error',
  local: '◇ local',
};

/** Ids of entries whose time ranges overlap. Allowed, but usually a mistake. */
export function overlappingIds(entries) {
  const ids = new Set();
  const done = entries.filter((e) => e.endTs !== null);
  for (let i = 0; i < done.length; i++) {
    for (let j = i + 1; j < done.length; j++) {
      const a = done[i];
      const b = done[j];
      if (a.startTs < b.endTs && b.startTs < a.endTs) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

export function calcTotalMs() {
  let ms = state.entries.reduce(
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

  if (state.entries.length === 0) {
    list.replaceChildren(note('No entries for this day'));
    return;
  }

  const overlaps = overlappingIds(state.entries);
  list.replaceChildren(
    ...sortEntries(state.entries).map((entry) => buildEntryCard(entry, overlaps.has(entry.id))),
  );
}

function note(text) {
  const el = document.createElement('div');
  el.className = 'timeline-empty';
  el.textContent = text;
  return el;
}

function buildEntryCard(entry, isOverlapping) {
  const duration = Math.max(0, (entry.endTs ?? entry.startTs) - entry.startTs);
  const card = document.createElement('div');
  card.className = `entry-card${isOverlapping ? ' overlapping' : ''}`;
  card.dataset.id = entry.id;

  card.innerHTML =
    '<div class="entry-name">' +
    (entry.issueKey ? `<span class="entry-jira">${esc(entry.issueKey)}</span>` : '') +
    `<span class="entry-title" title="${esc(entry.title)}">${esc(entry.title)}</span>` +
    '</div>' +
    '<div class="time-range">' +
    `<input class="ie time-ie" data-f="start" data-id="${esc(entry.id)}" value="${tsToHHMM(entry.startTs)}" title="Start time">` +
    '<span class="sep">–</span>' +
    `<input class="ie time-ie" data-f="end" data-id="${esc(entry.id)}" value="${tsToHHMM(entry.endTs ?? entry.startTs)}" title="End time">` +
    '</div>' +
    `<input class="ie dur-ie" data-f="dur" data-id="${esc(entry.id)}" value="${msToDur(duration)}" title="Duration, e.g. 1h 30m">` +
    `<span class="status-badge st-${esc(entry.status)}" title="${esc(entry.errorMsg ?? '')}">${STATUS_LABEL[entry.status] ?? entry.status}</span>` +
    '<div class="entry-actions">' +
    `<button class="icon-btn" data-a="restart" data-id="${esc(entry.id)}" title="Restart timer on this issue">▶</button>` +
    `<button class="icon-btn del" data-a="delete" data-id="${esc(entry.id)}" title="Delete">🗑</button>` +
    '</div>' +
    (isOverlapping
      ? '<div class="entry-err-row">⚠ Overlaps another entry — allowed, but usually a mistake.</div>'
      : '') +
    (entry.errorMsg ? `<div class="entry-err-row">⚠ ${esc(entry.errorMsg)}</div>` : '');

  // A synced entry has already reached Jira. Editing it locally would silently
  // desync the two, so the fields are frozen.
  if (entry.worklogId) {
    for (const input of card.querySelectorAll('.ie')) {
      input.disabled = true;
      input.title = 'Already logged to Jira — edit the worklog in Jira instead.';
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
  return card;
}

function currentEntry(id) {
  return state.entries.find((e) => e.id === id) ?? null;
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
  if (!entry) return;

  const field = input.dataset.f;
  const card = input.closest('.entry-card');

  if (field === 'start') {
    const ts = hhmmToTs(input.value, state.selectedDate);
    if (ts === null) return rejectInput(input, 'Use HH:MM, e.g. 09:30');
    if (entry.endTs !== null && ts >= entry.endTs) {
      return rejectInput(input, 'Start must be before the end time');
    }
    if (ts > Date.now()) return rejectInput(input, 'Start time cannot be in the future');
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

  // An edited entry is worth another attempt at syncing.
  if (entry.status === 'error') {
    entry.status = entry.issueKey ? 'pending' : 'local';
    entry.errorMsg = null;
  }

  persistDay();
  renderAll();
}

async function handleEntryAction(event) {
  const button = event.currentTarget;
  const entry = currentEntry(button.dataset.id);
  if (!entry) return;

  if (button.dataset.a === 'delete') {
    if (entry.worklogId) {
      toastWarn(
        `${entry.issueKey} is already logged in Jira. Delete the worklog there first, ` +
          'otherwise the time stays booked.',
      );
      return;
    }
    if (state.timer?.entryId === entry.id) await stopTimer({ save: false });
    state.entries = state.entries.filter((e) => e.id !== entry.id);
    await persistDayNow();
    renderAll();
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

/** Right-click actions on a day-view block, shared with the context menu. */
export async function deleteEntry(id) {
  const entry = currentEntry(id);
  if (!entry) return;
  if (entry.worklogId) {
    toastWarn(`${entry.issueKey} is already logged in Jira — delete the worklog there first.`);
    return;
  }
  if (state.timer?.entryId === id) await stopTimer({ save: false });
  state.entries = state.entries.filter((e) => e.id !== id);
  await persistDayNow();
  renderAll();
}

export async function splitEntry(id) {
  const entry = currentEntry(id);
  if (!entry || entry.endTs === null) return;
  if (entry.worklogId) {
    toastWarn('Already logged to Jira — split it in Jira instead.');
    return;
  }

  const quarter = 15 * 60_000;
  const midpoint = Math.round((entry.startTs + entry.endTs) / 2 / quarter) * quarter;
  if (midpoint <= entry.startTs || midpoint >= entry.endTs) {
    toastWarn('Entry is too short to split.');
    return;
  }

  const second = { ...entry, id: crypto.randomUUID(), startTs: midpoint, worklogId: null };
  entry.endTs = midpoint;
  state.entries = sortEntries([...state.entries, second]);
  await persistDayNow();
  renderAll();
}
