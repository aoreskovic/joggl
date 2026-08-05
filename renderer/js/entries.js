// The entry list: cards, inline editing with bidirectional recalculation, and
// the day total.

import { editorForTarget } from './click-actions.js';
import { showContextMenu } from './context-menu.js';
import { copyPreviousDay } from './copy-day.js';
import {
  canRetarget,
  duplicateOf,
  flaggedOverlaps,
  retargetEntry,
  sameComment,
  sameTimes,
} from './entry-ops.js';
import { createIssuePicker } from './issue-picker.js';
import { wireRovingList } from './keynav.js';
import { DELETE_ICON, PLAY_ICON } from './icons.js';
import { sortEntries } from './merge.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import { applySelection, clearSelection, select } from './selection.js';
import {
  deleteWorklog,
  invalidateExternal,
  isToday,
  persistDay,
  persistDayNow,
  refreshExternal,
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
    if (state.externalState === 'loading') {
      children.push(note('Loading…'));
    } else {
      // Both ways in are gestures nobody would guess: dragging a row out of the
      // issue list, and clicking an hour on the grid. An empty day is the one
      // moment there is room to say so.
      children.push(note('Nothing logged yet', 'empty-title'));
      children.push(
        note('Drag an issue onto the day view, or click an hour there.', 'empty-hint'),
      );
      // The third way in, offered where it is most useful and least findable: the
      // header button is a few words in small type, and this is the moment someone
      // is looking for exactly this.
      const copy = document.createElement('button');
      copy.className = 'btn-outline empty-action';
      copy.textContent = 'Copy previous day';
      copy.addEventListener('click', () => copyPreviousDay());
      children.push(copy);
    }
  } else {
    const overlaps = flaggedOverlaps(entries);
    // One line for the whole day rather than a sentence on every clashing row. With
    // three rows overlapping, the list was mostly warning text saying what the
    // coloured border on each of them already said.
    if (overlaps.size > 0) children.push(overlapNote(overlaps.size));
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
  rovingEntries().refresh();
  // These rows are new elements and know nothing about the selection.
  applySelection();

  // The count has to stay readable while the panel is collapsed — that is the
  // only thing left saying whether the day has anything in it.
  const count = document.getElementById('day-count');
  if (count) count.textContent = String(entries.length);
}

/**
 * Click and double click on the rows. Bound once, on the container.
 *
 * Delegated for the same reason `wireDayViewDrag` is: every render replaces these
 * children, so per-row listeners would be rebound constantly and leak the old ones.
 */
export function wireEntryList() {
  const list = document.getElementById('entry-list');
  if (!list) return;

  list.addEventListener('click', (event) => {
    const card = event.target.closest('.entry-card');
    // A click on the empty space below the rows is how you put the selection down.
    if (!card) {
      clearSelection();
      return;
    }
    // The time fields and the row's buttons keep their own click.
    if (event.target.closest('.ie, [data-a]')) return;
    select(card.dataset.id);
    // The roving tab stop should follow the mouse, or Tab returns somewhere else.
    card.focus();
  });

  list.addEventListener('dblclick', (event) => {
    const card = event.target.closest('.entry-card');
    if (!card) return;
    const editor = editorForTarget(event.target);
    if (editor === 'task') editEntryTask(card.dataset.id);
    else if (editor === 'comment') editEntryComment(card.dataset.id);
  });
}

/** A multi-line description has to sit on the row's single line. */
function oneLine(text) {
  return String(text ?? '').replace(/\s*\n+\s*/g, ' ').trim();
}

// One tab stop for the whole list, arrow keys within it. Created lazily because
// renderEntryList can run before this module's first import completes.
let roving = null;
function rovingEntries() {
  roving ??= wireRovingList({
    container: () => document.getElementById('entry-list'),
    rowSelector: '.entry-card',
    onMove: (row) => select(row.dataset.id),
  });
  return roving;
}

function note(text, kind) {
  const el = document.createElement('div');
  el.className = `timeline-empty${kind ? ` ${kind}` : ''}`;
  el.textContent = text;
  return el;
}

/**
 * One "n entries overlap" above the list. A single flagged row means it clashes
 * with a Jira-side one, which is not flagged itself — so say what it clashes with
 * rather than leaving a bare "1 entry overlaps" pointing at nothing.
 */
function overlapNote(count) {
  const el = document.createElement('div');
  el.className = 'entry-list-warn';
  el.textContent =
    count === 1 ? '⚠ 1 entry overlaps another' : `⚠ ${count} entries overlap`;
  el.title = 'Allowed, but usually a mistake. The rows themselves are outlined.';
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
  // Focusable so the Menu key has something to fire contextmenu on. Which row is
  // the list's single tab stop is roved by wireRovingList below.
  card.tabIndex = -1;
  if (!external) card.title = 'Drag onto the day view to move this entry';

  card.innerHTML =
    '<div class="entry-name">' +
    '<div class="entry-name-row">' +
    (entry.issueKey ? `<span class="entry-jira">${esc(entry.issueKey)}</span>` : '') +
    `<span class="entry-title" title="${esc(entry.title)}">${esc(entry.title)}</span>` +
    // The Work Description reads on from the title, and has to be unmistakably not
    // part of it: a separator, a grey tone and italics, so the distinction survives
    // greyscale rather than resting on colour alone. It takes the leftover width and
    // clips, so it can never push the times about.
    (entry.comment
      ? `<span class="entry-comment-sep" aria-hidden="true">·</span>` +
        `<span class="entry-comment" title="${esc(entry.comment)}">${esc(oneLine(entry.comment))}</span>`
      : '') +
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
      : `<button class="icon-btn del" data-a="delete" data-id="${esc(entry.id)}" title="Delete">${DELETE_ICON}</button>`) +
    '</div>' +
    // No overlap sentence here: the outline says it, and one line above the list
    // counts them. An errorMsg is different — it is specific to this row.
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

  // Enter on a focused row opens the menu too: it is the row's only action, and
  // hunting for the Menu key on a laptop without one is not a keyboard path.
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target !== card) return;
    event.preventDefault();
    showContextMenu(
      { clientX: 0, clientY: 0, currentTarget: card, target: card, preventDefault() {} },
      entry,
    );
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
  const before = { startTs: entry.startTs, endTs: entry.endTs };

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

  // Focusing a field and clicking away re-parses the value it already held. That
  // is not an edit, and treating it as one flipped a synced entry back to pending
  // so Finish Day offered to rewrite a worklog that was already correct. The
  // fields above have already been normalised, so "09:0" still tidies to "09:00".
  if (sameTimes(entry, before)) return;

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
      } catch (err) {
        toastErr(`Could not delete the worklog in Jira — ${err.message}`);
        return;
      }
      toastOk(`Worklog removed from ${entry.issueKey}.`);
      // The day's cached external list was fetched before this delete and still
      // holds a row for the worklog now gone. Invalidating alone would show zero
      // Manual Jira entries for the whole day until something unrelated happened to
      // refetch it — trading a phantom row for an understated total, which is worse.
      // Refetch through the same tracked `refreshExternal` a day change uses, kept
      // outside the delete's own try/catch: the delete has already succeeded by this
      // point, and a failed refetch here must not read as a failed delete. It also
      // cannot throw out of this handler — `track` in state.js catches internally —
      // and if it does fail, `renderEntryList` already shows the same "could not
      // read this day's worklogs from Jira" note a failed day-change read shows.
      invalidateExternal(state.selectedDate);
      await refreshExternal(state.selectedDate);
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

/**
 * Book the same block of time against a different issue. Times are untouched —
 * that is the point, and it is why this is not just delete-and-redraw.
 */
export async function editEntryTask(id) {
  const entry = currentEntry(id);
  if (!entry) return;

  const allowed = canRetarget(entry);
  if (!allowed.ok) {
    toastWarn(
      allowed.reason === 'external'
        ? 'This worklog was made in Jira — change it there.'
        : `${entry.issueKey} is already logged in Jira, and a worklog cannot be moved to ` +
          'another issue. Delete this entry (it will offer to remove the worklog too) and ' +
          'add it again on the right issue.',
    );
    return;
  }

  const picked = await askModal({
    title: `Edit task — ${tsToHHMM(entry.startTs)}–${tsToHHMM(entry.endTs)}`,
    body: (resolve) => {
      const wrap = document.createElement('div');
      const lede = document.createElement('p');
      lede.className = 'panel-lede';
      lede.textContent = `Currently ${entry.issueKey ?? 'a local entry'} — ${entry.title}. Picking another issue keeps the time exactly as it is.`;
      const picker = createIssuePicker({ onPick: resolve });
      wrap.append(lede, picker.el);
      return wrap;
    },
    buttons: [{ label: 'Cancel', value: null }],
    dismissValue: null,
    focusBody: true,
  });

  if (!picked?.issueKey) return;
  if (picked.issueKey === entry.issueKey) return;

  const next = retargetEntry(entry, picked);
  state.entries = state.entries.map((e) => (e.id === next.id ? next : e));
  await persistDayNow();
  renderAll();
  toastOk(`Moved ${tsToHHMM(next.startTs)}–${tsToHHMM(next.endTs)} to ${next.issueKey}.`);
}

/**
 * Jira's Work Description for this block of time.
 *
 * Plain text only, deliberately: Joggl writes the smallest legal ADF document, and
 * offering bold without offering the rest would set an expectation the field cannot
 * meet. Unlike Edit task this is *not* refused on a synced entry — rewriting the
 * description of an existing worklog is exactly what PUT .../worklog/{id} is for.
 */
export async function editEntryComment(id) {
  const entry = currentEntry(id);
  if (!entry) return;

  if (isExternal(entry)) {
    toastWarn('This worklog was made in Jira — change its description there.');
    return;
  }

  const wrap = document.createElement('div');
  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `What was this time spent on? Jira shows it as the worklog's Work Description on ` +
    `${entry.issueKey ?? 'this entry'}.`;

  const field = document.createElement('textarea');
  field.className = 'comment-field';
  field.rows = 4;
  field.placeholder = 'Plain text — no formatting';
  field.value = entry.comment ?? '';
  wrap.append(lede, field);

  // Enter has to keep inserting newlines in a textarea, so the shortcut is Ctrl+Enter.
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      document.querySelector('#modal-buttons .btn-primary')?.click();
    }
  });

  const answer = await askModal({
    title: `Work description — ${tsToHHMM(entry.startTs)}–${tsToHHMM(entry.endTs)}`,
    body: wrap,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Save', value: 'save', primary: true },
    ],
    dismissValue: null,
    focusBody: true,
  });
  if (answer !== 'save') return;

  const next = { ...entry, comment: field.value.trim() || null };
  // Opening the dialog and closing it unchanged is not an edit, for the same reason
  // clicking a block is not a move.
  if (sameComment(next, entry)) return;

  Object.assign(entry, next);
  markDirty(entry);
  await persistDayNow();
  renderAll();
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
