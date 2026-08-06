// Which entries are selected, and the highlight that says so in every panel.
//
// An entry is drawn twice in the day view — a row in "On this day" and a block on the
// grid — and with overlap columns it is often unclear which block belongs to which
// row. Selecting marks both. In the week view a block is drawn once, in its column.
//
// **This never re-renders.** A render replaces the element, and if the first click of
// a double click did that, the second would land on a new node and the `dblclick`
// would never fire. The classes go straight onto the elements, the same reason
// `liveUpdate` in timeline-drag.js mirrors a drag by hand.

import { pruned, selectOnly, toggled } from './selection-model.js';
import { BAND_THRESHOLD_PX, canStartBand, enclosedIds, normalisedRect } from './rubber-band.js';
import { state } from './state.js';

const CLASS = 'is-selected';
const BOTH = '.entry-card, .sched-entry-block';

/**
 * Every entry id the app currently holds, local and Jira-side.
 *
 * The yardstick `pruned` measures the selection against, so an entry that has been
 * deleted — here, in Jira, or by Clear week — simply stops being selected.
 */
function presentIds() {
  const present = new Set();
  for (const source of [state.days, state.external]) {
    for (const entries of source.values()) {
      for (const entry of entries ?? []) present.add(entry.id);
    }
  }
  return present;
}

/** The selection, as an array, with anything that no longer exists dropped. */
export function selectedIds() {
  return [...pruned(state.selectedEntryIds, presentIds())];
}

export function isSelected(id) {
  return state.selectedEntryIds.has(id);
}

/** A plain click. */
export function select(id) {
  state.selectedEntryIds = selectOnly(id);
  applySelection();
}

/** Ctrl+click. */
export function toggleSelect(id) {
  state.selectedEntryIds = toggled(state.selectedEntryIds, id);
  applySelection();
}

export function selectMany(ids) {
  state.selectedEntryIds = new Set(ids);
  applySelection();
}

/**
 * Ctrl+A: everything on screen — the week's columns, or the day's grid and rows.
 *
 * Read off the DOM rather than out of state, because "visible" is exactly what is
 * drawn: in five-day mode an empty weekend is not on screen and is not selected, and
 * in the day view the same entry appears as a block and a row, which the set folds
 * back into one.
 */
export function selectAllVisible() {
  selectMany(
    [...document.querySelectorAll('.sched-entry-block:not(.live), .entry-card')]
      .map((el) => el.dataset.id)
      .filter(Boolean),
  );
}

export function clearSelection() {
  if (state.selectedEntryIds.size === 0) return;
  state.selectedEntryIds = new Set();
  applySelection();
}

/**
 * Paint the selection onto whatever is on screen now.
 *
 * Called at the end of every render, because a render builds fresh elements that know
 * nothing about it — the ids in `state` are the truth, the classes only their shadow.
 * `.week-colhead.is-selected` is deliberately not in `BOTH`: on a column head the same
 * class means "this is the week's anchor day", which is a different thing.
 */
export function applySelection() {
  const ids = state.selectedEntryIds;
  for (const el of document.querySelectorAll(BOTH)) {
    el.classList.toggle(CLASS, ids.has(el.dataset.id));
  }
}

// ── The rubber band ────────────────────────────────────────────────────────

/**
 * Until when a click is the tail of a band rather than a click.
 *
 * The grid's own click clears the selection and opens the quick-entry popup — which
 * is exactly right for a click on empty space, and exactly wrong for the click that
 * follows a band, which would wipe what the band had just selected a frame earlier.
 * Module level rather than per-gesture for the same reason `timeline-drag.js` keeps
 * its own: the commit re-renders, and the click lands on a new element.
 */
let bandSuppressedUntil = 0;
const BAND_TAIL_MS = 200;

export function isBandSuppressed() {
  return Date.now() < bandSuppressedUntil;
}

/** Called once at boot. Both grids exist in the markup from the start. */
export function wireRubberBand() {
  for (const id of ['schedule-grid', 'week-scroll']) {
    document.getElementById(id)?.addEventListener('mousedown', onBandStart);
  }
}

function onBandStart(event) {
  if (event.button !== 0 || !canStartBand(event.target)) return;

  const origin = { x: event.clientX, y: event.clientY };
  let el = null;

  const onMouseMove = (move) => {
    const crossed =
      Math.abs(move.clientX - origin.x) >= BAND_THRESHOLD_PX ||
      Math.abs(move.clientY - origin.y) >= BAND_THRESHOLD_PX;
    if (!el && !crossed) return;

    if (!el) {
      el = document.createElement('div');
      el.className = 'rubber-band';
      document.body.appendChild(el);
      // Only once the band is real: a press that never became one must leave the
      // text selection and the focus it would otherwise have taken.
      move.preventDefault();
    }

    const rect = normalisedRect(origin, { x: move.clientX, y: move.clientY });
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.right - rect.left}px`;
    el.style.height = `${rect.bottom - rect.top}px`;
  };

  const onMouseUp = (up) => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (!el) return; // never crossed the threshold — this was a click, leave it alone

    el.remove();
    el = null;
    bandSuppressedUntil = Date.now() + BAND_TAIL_MS;

    // Viewport coordinates on both sides: the band is positioned fixed and the boxes
    // come from getBoundingClientRect, so neither needs to know how far the grid has
    // been scrolled.
    const rect = normalisedRect(origin, { x: up.clientX, y: up.clientY });
    const boxes = [...document.querySelectorAll('.sched-entry-block:not(.live)')].map((block) => {
      const box = block.getBoundingClientRect();
      return { id: block.dataset.id, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    selectMany(enclosedIds(rect, boxes));
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
