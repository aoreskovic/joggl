// Moving and resizing a block, and committing what the gesture produced.
//
// Split out of timeline.js unchanged. The drag and snap edge cases here were settled
// by use rather than by design — a behaviour change is a regression unless it is
// deliberate.
//
// `dayKey` is threaded through every handler rather than read from
// `state.selectedDate`. Today they are always the same day; once a week is on screen
// they are not, and the quarter-hour snap is measured from the *entry's own* day's
// local midnight — which matters when two columns sit on opposite sides of a clock
// change.

import { dragCopyPlacement } from './clipboard.js';
import { commitCrossDayMove } from './cross-day-commit.js';
import { markDirty } from './entries.js';
import { duplicateOf, sameTimes } from './entry-ops.js';
import { sortEntries } from './merge.js';
import { renderAll } from './render.js';
import { selectedIds } from './selection.js';
import {
  entriesFor, findEntry, persistDayNow, readDay, setEntriesFor, state, visibleEntries, visibleEntriesFor,
} from './state.js';
import { grid, offsetPxOf } from './timeline-geometry.js';
import { columnAt, columnFor } from './timeline-columns.js';
import { toastErr, toastWarn } from './toast.js';
import { addDays, msToDur, QUARTER, snapToQuarter, startOfDayMs, tsToHHMM, uuid } from './util.js';

// Nothing shorter than one grid step, so a block can never be dragged into a
// sliver that is impossible to grab again.
const MIN_DURATION_MS = QUARTER;
const EDGE_SNAP_MS = 8 * 60_000;

// Joggl's own synced entries stay draggable; the move rewrites the worklog on the
// next Finish Day. Worklogs made in Jira are not Joggl's to move.
function locked(entry) {
  if (entry.external) {
    toastWarn('This worklog was made in Jira — change it there.');
    return true;
  }
  return false;
}

export function onResize(event, entry, edge, dayKey) {
  event.preventDefault();
  event.stopPropagation();
  if (locked(entry)) return;

  const origStart = entry.startTs;
  const origEnd = entry.endTs;
  const startY = event.clientY;
  const block = document.querySelector(`.sched-entry-block[data-id="${CSS.escape(entry.id)}"]`);
  block?.classList.add('dragging');

  const onMouseMove = (move) => {
    // Scaled by the current zoom, not the base — otherwise the block runs away
    // from the cursor at anything other than 1x. Left unrounded: the snap happens
    // on the resulting clock time, not on the drag distance.
    const deltaMs = ((move.clientY - startY) / grid.pxPerMin) * 60_000;

    if (edge === 'top') {
      let next = snapToQuarter(origStart + deltaMs, dayKey);
      // Butting up against a neighbour beats the quarter-hour grid: closing a gap
      // exactly is the thing the grid alone cannot express. The neighbours are this
      // entry's own day's, which is the day on screen until there is more than one
      // column and is not afterwards.
      for (const other of visibleEntriesFor(dayKey)) {
        if (other.id !== entry.id && other.endTs !== null && Math.abs(other.endTs - next) < EDGE_SNAP_MS) {
          next = other.endTs;
        }
      }
      if (next <= origEnd - MIN_DURATION_MS) entry.startTs = next;
    } else {
      let next = snapToQuarter(origEnd + deltaMs, dayKey);
      for (const other of visibleEntriesFor(dayKey)) {
        if (other.id !== entry.id && Math.abs(other.startTs - next) < EDGE_SNAP_MS) {
          next = other.startTs;
        }
      }
      if (next >= origStart + MIN_DURATION_MS) entry.endTs = next;
    }

    liveUpdate(block, entry, dayKey);
  };

  const onMouseUp = async () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    block?.classList.remove('dragging');
    await commitDrag(entry, dayKey, { startTs: origStart, endTs: origEnd });
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

/**
 * Until when a click on a block is the tail of a move rather than a click.
 *
 * `preventDefault()` on mousedown stops focus and text selection but not the click,
 * so without this every completed drag would also read as "select this". Module
 * level rather than per-gesture because the commit re-renders: the click lands on
 * the *new* block, which knows nothing about the drag that produced it.
 */
let suppressClickUntil = 0;
const CLICK_TAIL_MS = 200;

/**
 * Where the dragged block itself wants to be, for one mousemove.
 *
 * Which column the cursor is over answers *which day*; the vertical distance answers
 * *what time*. With one column this is exactly what dragging always did. A cursor
 * that has wandered off every column keeps the day it last had, rather than snapping
 * the block back to where it started.
 *
 * Moving keeps the length and snaps the start to the clock grid, so a 47-minute entry
 * stays 47 minutes but always begins on a quarter hour — and the block is held inside
 * the day it is over.
 */
function anchorAt(move, { startY, offset, duration, fallbackDay }) {
  const deltaMs = ((move.clientY - startY) / grid.pxPerMin) * 60_000;

  const day = columnAt(move.clientX, move.clientY)?.dateKey ?? fallbackDay;
  const dayStart = startOfDayMs(day);
  const dayEnd = startOfDayMs(addDays(day, 1));

  let start = snapToQuarter(dayStart + offset + deltaMs, day);
  let end = start + duration;

  if (start < dayStart) {
    start = dayStart;
    end = start + duration;
  }
  // addDays, not a constant: the autumn clock change makes one day 25 hours, and
  // adding 86,400,000 would cut its last hour off a moment before midnight.
  if (end > dayEnd) {
    end = dayEnd;
    start = end - duration;
  }

  return { day, start, end };
}

export function onMoveBlock(event, entry, dayKey) {
  event.preventDefault();
  event.stopPropagation();

  // Ctrl decides which gesture this is before anything else, including the lock
  // check: `locked` exists to stop a *move*, and a copy never touches the original.
  if (event.ctrlKey || event.metaKey) {
    copyDrag(event, entry, dayKey);
    return;
  }
  if (locked(entry)) return;
  moveDrag(event, entry, dayKey);
}

function moveDrag(event, entry, dayKey) {
  const origStart = entry.startTs;
  const duration = entry.endTs - origStart;
  const startY = event.clientY;
  // What the entry says on the clock, as an offset from its own day's midnight. A
  // move to another column keeps that offset and adds the drag; a fixed number of
  // milliseconds would shift the block by an hour across a clock change.
  const offset = origStart - startOfDayMs(dayKey);
  const block = document.querySelector(`.sched-entry-block[data-id="${CSS.escape(entry.id)}"]`);
  block?.classList.add('dragging', 'moving');
  let targetDay = dayKey;
  let moved = false;

  const onMouseMove = (move) => {
    const { day, start, end } = anchorAt(move, { startY, offset, duration, fallbackDay: targetDay });

    if (day !== targetDay) {
      targetDay = day;
      // The block has to live in the column it is being dropped into, or it would
      // hang over the day it left while claiming to be on another.
      columnFor(day)?.appendChild(block);
      // What the block says it belongs to, kept true while it is in the air: the
      // arrow keys and the checks read the day off here, not off the column.
      if (block) block.dataset.day = day;
    }

    // Snapping means most small movements change nothing, and a gesture that never
    // changed the start *or the day* is exactly what a plain click is.
    if (start !== origStart || targetDay !== dayKey) moved = true;

    entry.startTs = start;
    entry.endTs = end;
    liveUpdate(block, entry, targetDay);
  };

  const onMouseUp = async () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    block?.classList.remove('dragging', 'moving');
    if (moved) suppressClickUntil = Date.now() + CLICK_TAIL_MS;

    if (targetDay !== dayKey) {
      // Two day logs, written one after the other — see cross-day-commit.js for the
      // write order and what happens if the second write fails. Both day names are
      // fixed here, before the first await, and neither is `state.selectedDate`: in
      // the week view the day on screen is usually neither of them.
      await commitCrossDayMove(entry, dayKey, targetDay, entry.startTs);
      return;
    }
    await commitDrag(
      entry,
      dayKey,
      { startTs: origStart, endTs: origStart + duration },
      { touched: moved },
    );
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

/**
 * A ghost: a clone of a block, standing in for the copy that block will become.
 *
 * `cloneNode` carries the classes and the inline geometry but none of the listeners,
 * which is exactly right — for the length of the gesture it is scenery. It takes an
 * id that matches no entry anywhere, so nothing that looks an entry up by `data-id`
 * can find it, and it is appended to the original's own column, where the drag then
 * moves it from column to column.
 */
function ghostFor(original) {
  if (!original) return null;
  const ghost = original.cloneNode(true);
  ghost.dataset.id = `ghost-${uuid()}`;
  // Never the selection's: the selection belongs to the originals, which are all
  // still on screen and still selected.
  ghost.classList.remove('is-selected');
  ghost.classList.add('ghost', 'dragging', 'moving');
  original.parentElement?.appendChild(ghost);
  return ghost;
}

/** Put one ghost where its placement says, moving it between columns as needed. */
function placeGhost(el, { toDay, startTs, endTs }) {
  if (!el) return;
  const column = columnFor(toDay);
  // A copy can land on a day that is not on screen — the week's last column dragged
  // forward takes the rest of the selection past the edge of the week. It is still
  // written on the drop; there is simply nowhere to draw it in the meantime.
  if (!column) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  if (el.parentElement !== column) column.appendChild(el);
  el.dataset.day = toDay;
  el.style.top = `${offsetPxOf(startTs, toDay)}px`;
  el.style.minHeight = `${Math.max(6, ((endTs - startTs) / 60_000) * grid.pxPerMin)}px`;
}

/**
 * What a Ctrl+drag carries: the whole selection, or just the block under the cursor.
 *
 * Dragging one of several selected blocks copies all of them — the same set Ctrl+C
 * would take, since a selection is what this app means by "these ones". Dragging a
 * block that is not in the selection copies that block alone and leaves the selection
 * where it is, because grabbing something unselected is not a statement about what is.
 *
 * A running timer is dropped: it has no end, and `dragCopyPlacement` would place a
 * copy of nothing.
 */
function copyItems(entry, dayKey) {
  const ids = selectedIds();
  if (!ids.includes(entry.id) || ids.length < 2) return [{ entry, dayKey }];
  return ids
    .map((id) => findEntry(id))
    .filter((found) => found?.entry && found.entry.endTs !== null && found.entry.endTs !== undefined);
}

/**
 * Ctrl+drag: copy rather than move.
 *
 * `locked` is deliberately not consulted. An external block is Jira's own record and
 * dragging it would misrepresent something Joggl never created as having changed
 * time; a copy never touches that record — every copy is a new entry in a day log,
 * the originals are not mutated at all — so there is nothing left to protect, and
 * refusing it would only make drag disagree with Ctrl+C/Ctrl+V, which already takes
 * an external row through `findEntry` and hands back an ordinary Joggl entry.
 *
 * **Every copy gets an element of its own, drawn at gesture start.** Dragging the
 * originals and putting copies down at the end told the opposite story: the blocks
 * left their places, holes opened where they had been, and the copies only appeared
 * on release — which reads as a move right up until it is over. So the originals stay
 * put and untouched, and what follows the cursor is a dashed, half-transparent ghost
 * of each.
 *
 * **A Ctrl+drag that never moved is a Ctrl+click.** Committing one anyway — which is
 * what this did until the selection could be dragged — meant the documented way to add
 * a block to the selection silently duplicated it instead, since the copy's own
 * re-render also swallowed the click that would have toggled it.
 *
 * Copies carry no worklogId, exactly as Ctrl+C/Ctrl+V and *Duplicate* produce, so the
 * next Sync logs them as new work rather than rewriting the originals'.
 */
function copyDrag(event, entry, dayKey) {
  const items = copyItems(entry, dayKey);
  const origStart = entry.startTs;
  const duration = entry.endTs - origStart;
  const startY = event.clientY;
  const offset = origStart - startOfDayMs(dayKey);
  const ghosts = items.map(({ entry: e }) =>
    ghostFor(document.querySelector(`.sched-entry-block[data-id="${CSS.escape(e.id)}"]`)),
  );

  let targetDay = dayKey;
  let clockDelta = 0;
  let moved = false;
  let cancelled = false;

  const removeGhosts = () => {
    for (const ghost of ghosts) ghost?.remove();
  };

  const onMouseMove = (move) => {
    const { day, start } = anchorAt(move, { startY, offset, duration, fallbackDay: targetDay });
    targetDay = day;
    // Measured against the anchor's own offset from midnight, not against a
    // timestamp: this is how far the gesture has moved *on the clock*, and it is what
    // the rest of the selection follows across days of different lengths.
    clockDelta = start - startOfDayMs(day) - offset;
    if (start !== origStart || targetDay !== dayKey) moved = true;

    const placed = dragCopyPlacement(items, dayKey, targetDay, clockDelta);
    placed.forEach((placement, i) => placeGhost(ghosts[i], placement));
  };

  const unwire = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keyup', onKeyUp);
  };

  /**
   * Ctrl let go mid-drag calls the whole thing off.
   *
   * Ctrl is what makes this gesture a copy, so letting go of it withdraws the only
   * instruction the gesture had. The alternative — carrying on as a move — would
   * silently turn "place a copy here" into "take the original there" on a keystroke
   * nobody meant as a decision. The ghosts go, the originals never changed, and
   * nothing is written.
   *
   * Read off `keyup` rather than off the modifier on each mousemove: a drag can be
   * held still, and the answer must not wait for the next pixel of movement.
   */
  const onKeyUp = (up) => {
    if (cancelled) return;
    if (up.key !== 'Control' && up.key !== 'Meta') return;
    cancelled = true;
    unwire();
    removeGhosts();
    // The mouse is still down, so a click still follows the release. It is the tail
    // of a drag, not a click on the original.
    if (moved) suppressClickUntil = Date.now() + CLICK_TAIL_MS;
  };

  const onMouseUp = async () => {
    unwire();
    if (cancelled) return;
    // The render below draws the copies properly; the ghosts were only ever for the
    // gesture, and leaving them would double every block for a frame.
    removeGhosts();
    // Never moved: this was a Ctrl+click, and the click handler owns what happens
    // next — it toggles this block in the selection.
    if (!moved) return;
    suppressClickUntil = Date.now() + CLICK_TAIL_MS;
    await commitCopies(items, dayKey, targetDay, clockDelta);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keyup', onKeyUp);
}

/**
 * Write the copies a Ctrl+drag placed, one day log at a time.
 *
 * Every target day is read before anything is merged into it, for the reason
 * `pasteClipboard` in copy-day.js sets out at length: `entriesFor` answers `[]` for a
 * day never loaded — the same shape as a day that is genuinely empty — and
 * `persistDayNow` writes the whole file from memory, so merging into that stand-in
 * would overwrite the real contents of a day nobody looked at. A selection dragged
 * near the end of a visible week routinely places part of itself in the week after.
 *
 * Memory is written before disk, so whatever happens the screen shows what the drop
 * produced; a failed write costs that day's copies a restart, and says so.
 */
async function commitCopies(items, anchorDay, targetDay, clockDelta) {
  const byDay = new Map();
  for (const placement of dragCopyPlacement(items, anchorDay, targetDay, clockDelta)) {
    const copy = {
      ...duplicateOf(placement.entry, uuid()),
      startTs: placement.startTs,
      endTs: placement.endTs,
    };
    const list = byDay.get(placement.toDay);
    if (list) list.push(copy);
    else byDay.set(placement.toDay, [copy]);
  }

  for (const day of byDay.keys()) {
    if (!state.days.has(day)) setEntriesFor(day, (await readDay(day)).entries);
  }
  for (const [day, copies] of byDay) {
    setEntriesFor(day, sortEntries([...entriesFor(day), ...copies]));
  }

  try {
    for (const day of byDay.keys()) await persistDayNow(day);
  } catch (err) {
    toastErr(`Could not save the copy — ${err.message}`);
  } finally {
    renderAll();
  }
}

/**
 * Whether a click arriving now is the tail of a completed move rather than a click.
 *
 * `preventDefault()` on mousedown stops focus and text selection but not the click,
 * so without this every finished drag would also read as "select this". Module level
 * rather than per-gesture because the commit re-renders: the click lands on the *new*
 * block, which knows nothing about the drag that produced it. A function rather than
 * the variable, because the block builder lives in another module now and an exported
 * `let` read across a module boundary would be a live binding to a moving target —
 * correct here, but only by accident, and a reader says what is being asked.
 */
export function isClickSuppressed() {
  return Date.now() < suppressClickUntil;
}

// Mirror the drag into the block and the matching list card without a full
// re-render, which would tear the element out from under the mouse.
function liveUpdate(block, entry, dayKey) {
  if (block) {
    const durMin = Math.max(1, (entry.endTs - entry.startTs) / 60_000);
    block.style.top = `${offsetPxOf(entry.startTs, dayKey)}px`;
    block.style.minHeight = `${Math.max(6, durMin * grid.pxPerMin)}px`;
  }

  const card = document.querySelector(`.entry-card[data-id="${CSS.escape(entry.id)}"]`);
  if (card) {
    const set = (field, value) => {
      const input = card.querySelector(`[data-f="${field}"]`);
      if (input) input.value = value;
    };
    set('start', tsToHHMM(entry.startTs));
    set('end', tsToHHMM(entry.endTs));
    set('dur', msToDur(entry.endTs - entry.startTs));
  }

  const total = document.getElementById('total-display');
  if (total) {
    const ms = visibleEntries().reduce((sum, e) => sum + Math.max(0, (e.endTs ?? e.startTs) - e.startTs), 0);
    total.textContent = `Total: ${msToDur(ms + (state.timer ? Date.now() - state.timer.startTs : 0))}`;
  }
}

/**
 * End of a move or resize.
 *
 * `touched` is false for a gesture that never moved anything — a plain click on a
 * block. There is nothing to repaint then, and the render would replace the block
 * the click had just focused, so focus would fall back to `<body>` and Tab would
 * restart from the top of the list.
 */
async function commitDrag(entry, dayKey, before, { touched = true } = {}) {
  if (sameTimes(entry, before)) {
    // Dragged out and back: liveUpdate moved the element by hand, so the true
    // layout has to be restored even though the times are unchanged.
    if (touched) renderAll();
    return;
  }
  markDirty(entry);
  await persistDayNow(dayKey);
  renderAll();
}
