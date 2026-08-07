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

import { commitCrossDayMove } from './cross-day-commit.js';
import { markDirty } from './entries.js';
import { duplicateOf, sameTimes } from './entry-ops.js';
import { sortEntries } from './merge.js';
import { renderAll } from './render.js';
import { entriesFor, persistDayNow, setEntriesFor, state, visibleEntries, visibleEntriesFor } from './state.js';
import { grid, offsetPxOf } from './timeline-geometry.js';
import { columnAt, columnFor } from './timeline-columns.js';
import { toastWarn } from './toast.js';
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

export function onMoveBlock(event, entry, dayKey) {
  event.preventDefault();
  event.stopPropagation();
  if (locked(entry)) return;

  /**
   * Ctrl turns the move into a copy.
   *
   * The gesture then runs on a duplicate that is in no day log at all, so the
   * original is never touched and the drop is an insert rather than a move. The
   * element under the cursor is still the original's — there is nothing else to
   * drag — so it wears `copying` and springs back when the commit re-renders, which
   * is the honest picture: what is being placed is a copy of it.
   *
   * The copy carries no worklogId, exactly as Ctrl+C/Ctrl+V and *Duplicate* produce,
   * so the next Sync logs it as new work rather than rewriting the original's.
   */
  const copying = event.ctrlKey || event.metaKey;
  const subject = copying ? duplicateOf(entry, uuid()) : entry;

  const origStart = subject.startTs;
  const duration = subject.endTs - origStart;
  const startY = event.clientY;
  // What the entry says on the clock, as an offset from its own day's midnight. A
  // move to another column keeps that offset and adds the drag; a fixed number of
  // milliseconds would shift the block by an hour across a clock change.
  const offset = origStart - startOfDayMs(dayKey);
  const block = document.querySelector(`.sched-entry-block[data-id="${CSS.escape(entry.id)}"]`);
  block?.classList.add('dragging', 'moving');
  if (copying) block?.classList.add('copying');
  let targetDay = dayKey;
  let moved = false;

  const onMouseMove = (move) => {
    const deltaMs = ((move.clientY - startY) / grid.pxPerMin) * 60_000;

    // Which column the cursor is over answers *which day*; the vertical delta answers
    // *what time*. With one column this is exactly what it always did. A cursor that
    // has wandered off every column keeps the day it last had, rather than snapping
    // the block back to where it started.
    const day = columnAt(move.clientX, move.clientY)?.dateKey ?? targetDay;
    const dayStart = startOfDayMs(day);
    const dayEnd = startOfDayMs(addDays(day, 1));

    // Moving keeps the length and snaps the start to the clock grid, so a 47-minute
    // entry stays 47 minutes but always begins on a quarter hour.
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

    if (day !== targetDay) {
      targetDay = day;
      // The block has to live in the column it is being dropped into, or it would
      // hang over the day it left while claiming to be on another.
      columnFor(day)?.appendChild(block);
    }

    // Snapping means most small movements change nothing, and a gesture that never
    // changed the start *or the day* is exactly what a plain click is.
    if (start !== origStart || targetDay !== dayKey) moved = true;

    subject.startTs = start;
    subject.endTs = end;
    liveUpdate(block, subject, targetDay);
  };

  const onMouseUp = async () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    block?.classList.remove('dragging', 'moving', 'copying');
    if (moved) suppressClickUntil = Date.now() + CLICK_TAIL_MS;

    if (copying) {
      // Committed even when it never moved: a copy dropped where it started is a
      // duplicate, which is a thing this app already offers and means to.
      suppressClickUntil = Date.now() + CLICK_TAIL_MS;
      setEntriesFor(targetDay, sortEntries([...entriesFor(targetDay), subject]));
      await persistDayNow(targetDay);
      renderAll();
      return;
    }

    if (targetDay !== dayKey) {
      // Two day logs, written one after the other — see cross-day-commit.js for the
      // write order and what happens if the second write fails. Both day names are
      // fixed here, before the first await, and neither is `state.selectedDate`: in
      // the week view the day on screen is usually neither of them.
      await commitCrossDayMove(subject, dayKey, targetDay, subject.startTs);
      return;
    }
    await commitDrag(
      subject,
      dayKey,
      { startTs: origStart, endTs: origStart + duration },
      { touched: moved },
    );
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
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
