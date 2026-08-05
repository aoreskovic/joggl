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

import { markDirty } from './entries.js';
import { sameTimes } from './entry-ops.js';
import { renderAll } from './render.js';
import { persistDayNow, state, visibleEntries } from './state.js';
import { grid, offsetPxOf } from './timeline-geometry.js';
import { toastWarn } from './toast.js';
import { msToDur, QUARTER, snapToQuarter, startOfDayMs, tsToHHMM } from './util.js';

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
      // exactly is the thing the grid alone cannot express.
      //
      // `visibleEntries()` is the day on screen, which is this entry's day until
      // there is more than one column. Phase 3 swaps it for
      // `visibleEntriesFor(dayKey)`; doing it here would be a behaviour change in a
      // phase that promises none.
      for (const other of visibleEntries()) {
        if (other.id !== entry.id && other.endTs !== null && Math.abs(other.endTs - next) < EDGE_SNAP_MS) {
          next = other.endTs;
        }
      }
      if (next <= origEnd - MIN_DURATION_MS) entry.startTs = next;
    } else {
      let next = snapToQuarter(origEnd + deltaMs, dayKey);
      for (const other of visibleEntries()) {
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
    await commitDrag(entry, { startTs: origStart, endTs: origEnd });
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

  const origStart = entry.startTs;
  const duration = entry.endTs - origStart;
  const startY = event.clientY;
  const dayStart = startOfDayMs(dayKey);
  const block = document.querySelector(`.sched-entry-block[data-id="${CSS.escape(entry.id)}"]`);
  block?.classList.add('dragging', 'moving');
  let moved = false;

  const onMouseMove = (move) => {
    const deltaMs = ((move.clientY - startY) / grid.pxPerMin) * 60_000;
    // Moving keeps the length and snaps the start to the clock grid, so a 47-minute
    // entry stays 47 minutes but always begins on a quarter hour.
    let start = snapToQuarter(origStart + deltaMs, dayKey);
    let end = start + duration;

    if (start < dayStart) {
      start = dayStart;
      end = start + duration;
    }
    if (end > dayStart + 86_400_000) {
      end = dayStart + 86_400_000;
      start = end - duration;
    }

    // Snapping means most small movements change nothing, and a gesture that never
    // changed the start is exactly what a plain click is.
    if (start !== origStart) moved = true;

    entry.startTs = start;
    entry.endTs = end;
    liveUpdate(block, entry, dayKey);
  };

  const onMouseUp = async () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    block?.classList.remove('dragging', 'moving');
    if (moved) suppressClickUntil = Date.now() + CLICK_TAIL_MS;
    await commitDrag(entry, { startTs: origStart, endTs: origStart + duration }, { touched: moved });
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
async function commitDrag(entry, before, { touched = true } = {}) {
  if (sameTimes(entry, before)) {
    // Dragged out and back: liveUpdate moved the element by hand, so the true
    // layout has to be restored even though the times are unchanged.
    if (touched) renderAll();
    return;
  }
  markDirty(entry);
  await persistDayNow();
  renderAll();
}
