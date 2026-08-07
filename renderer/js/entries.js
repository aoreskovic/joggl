// The entry list: cards, inline editing with bidirectional recalculation, and
// the day total.

import { editorForTarget } from './click-actions.js';
import { showContextMenu } from './context-menu.js';
import { copyPreviousDay } from './copy-day.js';
import {
  canRetarget,
  dirtiedEntry,
  duplicateOf,
  flaggedOverlaps,
  planDeletion,
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
import { applySelection, clearSelection, select, selectMany, selectedIds, toggleSelect } from './selection.js';
import {
  deleteWorklog,
  dropExternalWorklog,
  entriesFor,
  findEntry,
  isToday,
  persistDay,
  persistDayNow,
  setEntriesFor,
  state,
  visibleEntries,
} from './state.js';
import { startTimer, stopTimer } from './timer.js';
import { toast, toastErr, toastOk, toastWarn } from './toast.js';
import { esc, formatDateLabel, hhmmToTs, msToDur, parseDur, plural, snapToQuarter, tsToHHMM, uuid } from './util.js';

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
        note('Drag an issue onto the day view, or double-click an hour there.', 'empty-hint'),
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
    if (event.ctrlKey || event.metaKey) toggleSelect(card.dataset.id);
    else select(card.dataset.id);
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

function resetInput(input) {
  const found = findEntry(input.dataset.id);
  if (!found) return;
  const { entry } = found;
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
  const found = findEntry(input.dataset.id);
  if (!found || isExternal(found.entry)) return;
  // The entry's own day, not the day on screen. HH:MM resolves against a day, and a
  // row is only ever edited on the day it belongs to — but saying which day that is
  // costs nothing and makes this the same rule as every other action here.
  const { entry, dayKey } = found;

  const field = input.dataset.f;
  const card = input.closest('.entry-card');
  const before = { startTs: entry.startTs, endTs: entry.endTs };

  if (field === 'start') {
    const ts = hhmmToTs(input.value, dayKey);
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
    const ts = hhmmToTs(input.value, dayKey);
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
  persistDay(dayKey);
  renderAll();
}

/** The mutating form of `dirtiedEntry`, which is where the rule itself lives. */
export function markDirty(entry) {
  Object.assign(entry, dirtiedEntry(entry));
}

async function handleEntryAction(event) {
  const button = event.currentTarget;
  const found = findEntry(button.dataset.id);
  if (!found) return;
  const { entry } = found;

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
  // The day comes from the entry, not from the screen, and is fixed before the
  // confirmation modal and the Jira DELETE — both of which the day can be stepped
  // underneath, and neither of which is necessarily about the day on screen at all.
  const found = findEntry(id);
  if (!found) return;
  const { entry, dayKey: day } = found;

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
      // The cached Jira-side rows for this day were read before the DELETE, and one
      // of them stands for the worklog now gone. It is taken out here, next to the
      // DELETE that made it false — a synchronous Map write, so it widens no window,
      // and nothing below can draw a row for a worklog Joggl has just removed.
      //
      // Exactly that row, rather than the whole day: dropping the day left every
      // other Manual Jira entry on it blank until a refetch landed, which is
      // bug-worthy on one day and unacceptable across a week. The rest of the cache
      // is still true, so there is no refetch at all.
      dropExternalWorklog(day, entry.worklogId);
    }
  }

  // The local removal comes next, with nothing but the timer stop awaited between it
  // and the DELETE. Once Jira has dropped the worklog, an entry still carrying its
  // worklogId is the dangerous state: a day change or a crash before this line
  // leaves it on the original day, and the next Sync would PUT to a worklog that no
  // longer exists. It also reads as a failed delete while it sits there. A refetch
  // used to run in this gap, which put a whole Jira round trip inside it; there is
  // no refetch now, because the cache was corrected rather than thrown away.
  if (state.timer?.entryId === id) await stopTimer({ save: false });
  setEntriesFor(day, entriesFor(day).filter((e) => e.id !== id));
  await persistDayNow(day);
  renderAll();
}

/**
 * Delete everything selected.
 *
 * One entry falls through to `deleteEntry`, so the single case keeps the wording and
 * the per-entry Jira offer it already has, and there is one path rather than two that
 * drift. More than one asks first — with the counts, which is what makes the question
 * answerable.
 *
 * The Jira half is sequential and honest about partial failure, the same shape
 * `sync.js` uses: an entry whose worklog could not be deleted **stays**, carrying the
 * error, because it still stands for time that is really logged in Jira. Removing it
 * locally would leave that time booked with nothing on screen to account for it,
 * which is the exact failure the single delete's modal exists to prevent.
 */
export async function deleteSelection() {
  // Fixed before the modal, which stays up for as long as the user reads it, and
  // before the DELETEs, which the day can be stepped underneath.
  const items = selectedIds().map((id) => findEntry(id)).filter(Boolean);
  const plan = planDeletion(items);

  if (plan.removable.length === 0) {
    toastWarn(
      plan.external.length > 0
        ? plan.external.length === 1
          ? 'This worklog was made in Jira — delete it there.'
          : 'Those worklogs were made in Jira — delete them there.'
        : 'Nothing selected to delete.',
    );
    return;
  }
  if (plan.removable.length === 1) {
    await deleteEntry(plan.removable[0].entry.id);
    return;
  }

  const answer = await askModal({
    title: `Delete ${plan.removable.length} entries?`,
    body: deleteManyBody(plan),
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      // With nothing synced there is no Jira decision to make, so the plain removal
      // becomes the primary action rather than a second-choice button sitting beside
      // a missing one.
      { label: 'Remove here only', value: 'local', primary: plan.synced.length === 0 },
      ...(plan.synced.length > 0
        ? [{ label: 'Delete in Jira too', value: 'jira', primary: true }]
        : []),
    ],
    dismissValue: 'cancel',
  });
  if (answer === 'cancel') return;

  // The running timer's entry cannot be deleted out from under it.
  if (plan.removable.some(({ entry }) => state.timer?.entryId === entry.id)) {
    await stopTimer({ save: false });
  }

  /** @type {{day: string, entry: object}[]} */
  const failed = [];

  if (answer === 'jira') {
    for (const { entry, dayKey } of plan.synced) {
      try {
        await deleteWorklog(entry);
        // Exactly the row that is gone, next to the DELETE that made it false — the
        // same surgical invalidation `deleteEntry` does, and for the same reason.
        dropExternalWorklog(dayKey, entry.worklogId);
      } catch (err) {
        entry.errorMsg = `Could not delete the worklog — ${err.message}`;
        failed.push({ day: dayKey, entry });
      }
    }
  }

  // Whatever failed in Jira stays here, so the two records agree.
  const keep = new Set(failed.map(({ entry }) => entry.id));
  for (const day of plan.days) {
    const going = plan.idsFor(day);
    setEntriesFor(day, entriesFor(day).filter((e) => !going.has(e.id) || keep.has(e.id)));
    await persistDayNow(day);
  }

  clearSelection();
  renderAll();

  if (plan.external.length > 0) {
    toast(
      `${plural(plan.external.length)} logged in Jira left alone — they are not Joggl’s to remove.`,
    );
  }

  if (failed.length === 0) {
    toastOk(
      answer === 'jira'
        ? `${plural(plan.removable.length)} deleted, and ${plural(plan.synced.length)} removed from Jira.`
        : `${plural(plan.removable.length)} deleted. Nothing was removed from Jira.`,
    );
    return;
  }

  await showDeleteFailures(failed);
}

function deleteManyBody(plan) {
  const body = document.createElement('div');
  const lines = [];
  const unsynced = plan.removable.length - plan.synced.length;
  if (unsynced > 0) lines.push(`${plural(unsynced)} not yet in Jira`);
  if (plan.synced.length > 0) lines.push(`${plural(plan.synced.length)} already synced`);

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `Selected: ${lines.join(' and ')}` +
    (plan.days.length > 1 ? `, across ${plan.days.length} days.` : '.');
  body.appendChild(lede);

  const note = document.createElement('p');
  note.className = 'panel-lede';
  note.textContent =
    plan.synced.length > 0
      ? '“Remove here only” leaves the synced time logged in Jira. “Delete in Jira too” ' +
        'removes those worklogs as well, one at a time — anything that fails stays here, ' +
        'so the two never disagree.'
      : 'None of these has reached Jira, so nothing there is affected.';
  body.appendChild(note);

  if (plan.external.length > 0) {
    const skipped = document.createElement('p');
    skipped.className = 'panel-lede';
    skipped.textContent =
      `${plural(plan.external.length)} in the selection ${plan.external.length === 1 ? 'was' : 'were'} ` +
      'logged in the Jira web UI and will be left alone — they are not Joggl’s to remove.';
    body.appendChild(skipped);
  }

  return body;
}

/** No automatic retry, the same promise Sync makes: the user sees what failed. */
async function showDeleteFailures(failed) {
  const body = document.createElement('div');
  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `${plural(failed.length)} could not be removed from Jira, so ${failed.length === 1 ? 'it is' : 'they are'} ` +
    'still here — the time is really logged there, and deleting the row would hide it.';

  const list = document.createElement('ul');
  list.className = 'fail-list';
  list.innerHTML = failed
    .map(
      ({ day, entry }) =>
        `<li><strong>${esc(entry.issueKey ?? '')}</strong> — ${esc(entry.title)} ` +
        `· ${esc(formatDateLabel(day))}<br><small>${esc(entry.errorMsg)}</small></li>`,
    )
    .join('');

  body.append(lede, list);

  const answer = await askModal({
    title: `${failed.length} worklog${failed.length === 1 ? '' : 's'} not deleted`,
    body,
    buttons: [
      { label: 'Close', value: 'close' },
      { label: 'Retry failed', value: 'retry', primary: true },
    ],
    dismissValue: 'close',
  });
  if (answer !== 'retry') return;

  selectMany(failed.map(({ entry }) => entry.id));
  await deleteSelection();
}

/**
 * Copy an entry onto the same stretch of time. The two land side by side in the
 * day view's overlap columns, which is the handle for dragging the copy where it
 * belongs — moving it is the expected next step, not a correction.
 */
export async function duplicateEntry(id) {
  const found = findEntry(id);
  if (!found || found.entry.endTs === null) return;
  const { entry, dayKey: day } = found;

  const copy = duplicateOf(entry, uuid());
  setEntriesFor(day, sortEntries([...entriesFor(day), copy]));
  await persistDayNow(day);
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
  const found = findEntry(id);
  if (!found) return;
  const { entry, dayKey: day } = found;

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
  setEntriesFor(day, entriesFor(day).map((e) => (e.id === next.id ? next : e)));
  await persistDayNow(day);
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
  const found = findEntry(id);
  if (!found) return;
  const { entry, dayKey: day } = found;

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
  await persistDayNow(day);
  renderAll();
}

export async function splitEntry(id) {
  const found = findEntry(id);
  if (!found || found.entry.endTs === null) return;
  const { entry, dayKey: day } = found;
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

  const midpoint = snapToQuarter((entry.startTs + entry.endTs) / 2, day);
  if (midpoint <= entry.startTs || midpoint >= entry.endTs) {
    toastWarn('Entry is too short to split.');
    return;
  }

  const second = { ...entry, id: uuid(), startTs: midpoint, worklogId: null };
  entry.endTs = midpoint;
  setEntriesFor(day, sortEntries([...entriesFor(day), second]));
  await persistDayNow(day);
  renderAll();
}
