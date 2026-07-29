// Dragging an issue out of the task list onto the day view.
//
// Mouse events rather than HTML5 drag-and-drop: the day view's own move and resize
// already work this way, the ghost is then ours to draw and position, and a small
// movement threshold is what lets a single click on a task keep doing what it always
// did, which is start a timer.

import { dropEntryFor } from './entry-ops.js';
import { renderAll } from './render.js';
import { setDragging } from './shell.js';
import { persistDayNow, state } from './state.js';
import { gridTimeAt, hideDropPlaceholder, showDropPlaceholder } from './timeline.js';
import { esc, startOfDayMs, uuid } from './util.js';

/** Below this, the gesture was a click and the timer should start as always. */
const THRESHOLD_PX = 4;
/** How close to the panel edge starts an auto-scroll, and how fast it goes. */
const EDGE_PX = 24;
const EDGE_SCROLL_PX = 8;
/** How long after a drag a stray click is ignored. */
const SWALLOW_MS = 150;

/** mousedown seen on a row, threshold not yet crossed. */
let pending = null;
/** A live drag: { issue, ghost, startTs, clientY, scrollFrame }. */
let drag = null;
let swallowUntil = 0;

export function wireIssueDrag() {
  const list = document.getElementById('task-list');
  if (!list) return;

  // Delegated, because renderTaskList replaces every child on each render — per-row
  // listeners would be rebound constantly and leak the old ones.
  list.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const row = event.target.closest('.task-item');
    // The pin has its own click and is not a drag handle.
    if (!row || event.target.closest('.tt-pin')) return;

    const issue = state.issues.find((i) => i.issueKey === row.dataset.key);
    if (issue) pending = { issue, x: event.clientX, y: event.clientY };
  });

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) teardown();
  });

  // A drag that ends over the row it began on still produces a click, and that click
  // would start a timer on the issue just dropped.
  document.addEventListener(
    'click',
    (event) => {
      if (Date.now() > swallowUntil) return;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
}

function onMouseMove(event) {
  if (pending && !drag) {
    const moved =
      Math.abs(event.clientX - pending.x) >= THRESHOLD_PX ||
      Math.abs(event.clientY - pending.y) >= THRESHOLD_PX;
    if (!moved) return;
    begin(pending.issue);
  }
  if (!drag) return;

  drag.clientY = event.clientY;
  drag.ghost.style.left = `${event.clientX + 12}px`;
  drag.ghost.style.top = `${event.clientY + 12}px`;
  updatePreview(event.clientY);
}

function begin(issue) {
  pending = null;

  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML =
    `<span class="jira-chip">${esc(issue.issueKey)}</span>` +
    `<span class="drag-ghost-title">${esc(issue.title)}</span>`;
  document.body.appendChild(ghost);
  document.body.classList.add('is-dragging-issue');

  drag = { issue, ghost, startTs: null, clientY: 0, scrollFrame: 0 };
  // A peek opening under the cursor would slide over the grid and eat the drop.
  setDragging(true);
  drag.scrollFrame = requestAnimationFrame(autoScroll);
}

function updatePreview(clientY) {
  const startTs = gridTimeAt(clientY);
  drag.startTs = startTs;

  if (startTs === null) {
    hideDropPlaceholder();
    return;
  }

  // Built through dropEntryFor so the preview is exactly what a drop would create,
  // midnight pull-back included, rather than a second guess at the same rule.
  const preview = dropEntryFor(drag.issue, 'preview', startTs, startOfDayMs(state.selectedDate));
  showDropPlaceholder(preview.startTs, preview.endTs);
}

/**
 * The grid is usually taller than the panel, so an hour scrolled out of sight would
 * otherwise be unreachable from a task list that sits at the bottom left.
 */
function autoScroll() {
  if (!drag) return;
  const panel = document.getElementById('right-panel');
  if (!panel) return;

  const rect = panel.getBoundingClientRect();
  const y = drag.clientY;
  let delta = 0;
  if (y >= rect.top && y - rect.top < EDGE_PX) delta = -EDGE_SCROLL_PX;
  else if (y <= rect.bottom && rect.bottom - y < EDGE_PX) delta = EDGE_SCROLL_PX;

  if (delta !== 0) {
    panel.scrollTop += delta;
    // The grid just moved under a cursor that did not, so the preview has to follow.
    updatePreview(y);
  }

  drag.scrollFrame = requestAnimationFrame(autoScroll);
}

async function onMouseUp() {
  if (!drag) {
    pending = null;
    return;
  }

  const { issue, startTs } = drag;
  teardown();

  // Released somewhere the grid cannot turn into a time: cancel, quietly.
  if (startTs === null) return;

  state.entries = [
    ...state.entries,
    dropEntryFor(issue, uuid(), startTs, startOfDayMs(state.selectedDate)),
  ];
  await persistDayNow();
  renderAll();
}

function teardown() {
  if (drag) {
    cancelAnimationFrame(drag.scrollFrame);
    drag.ghost.remove();
  }
  drag = null;
  pending = null;
  hideDropPlaceholder();
  document.body.classList.remove('is-dragging-issue');
  setDragging(false);
  swallowUntil = Date.now() + SWALLOW_MS;
}
