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
