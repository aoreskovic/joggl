// Which entry is selected, and the highlight that says so in both panels.
//
// An entry is drawn twice — a row in "On this day" and a block on the day view —
// and with overlap columns it is often unclear which block belongs to which row.
// Selecting one marks both.
//
// **This never re-renders.** A render replaces the element, and if the first click
// of a double click did that, the second click would land on a new node and the
// `dblclick` would never fire. The class goes straight onto the two elements, the
// same reason `liveUpdate` in timeline.js mirrors a drag by hand.

import { state } from './state.js';

const CLASS = 'is-selected';
const BOTH = '.entry-card, .sched-entry-block';

export function select(id) {
  state.selectedEntryId = id ?? null;
  applySelection();
}

export function clearSelection() {
  if (state.selectedEntryId === null) return;
  state.selectedEntryId = null;
  applySelection();
}

/**
 * Paint the selection onto whatever is on screen now.
 *
 * Called at the end of both renders, because a render builds fresh elements that
 * know nothing about it — the id in `state` is the truth, the class is only its
 * shadow.
 */
export function applySelection() {
  const id = state.selectedEntryId;
  for (const el of document.querySelectorAll(BOTH)) {
    el.classList.toggle(CLASS, id !== null && el.dataset.id === id);
  }
}
