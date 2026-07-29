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

/**
 * Below this, the gesture was a click and the timer should start as always. Six
 * rather than the four this started at: a click on a task row is the primary
 * action, and a hand that slips a few pixels while pressing must not turn into a
 * drag that swallows the click and starts nothing.
 */
const THRESHOLD_PX = 6;
/** How close to the panel edge starts an auto-scroll, and how fast it goes. */
const EDGE_PX = 24;
const EDGE_SCROLL_PX = 8;
/** How long after a drag a stray click is ignored. */
const SWALLOW_MS = 150;

/** mousedown seen on a row, threshold not yet crossed. */
let pending = null;
/**
 * A live drag: { issue, ghost, startTs, clientX, clientY, scrollFrame }.
 *
 * Both coordinates are stored because autoScroll re-resolves the drop time from
 * them when the panel scrolls under a cursor that has not moved, and gridTimeAt
 * bounds the drop on the grid's full rect, X included.
 */
let drag = null;
let swallowUntil = 0;
/**
 * Set when Escape cancels a drag while the button is presumably still down. The
 * swallow window exists to eat the click a release-over-the-row produces, so it
 * has to be measured from that release, not from teardown — Escape and the
 * release it precedes can be well over 150ms apart.
 */
let armSwallowOnRelease = false;

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
    if (event.key === 'Escape' && drag) {
      armSwallowOnRelease = true;
      teardown();
    }
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
  // A release that never reached us — focus stolen mid-drag, or Chromium's implicit
  // capture swallowing a plain release outside the window — would otherwise leave
  // `drag`/`pending` stuck live for the rest of the session. The next movement
  // without the button held is the first evidence the gesture is over.
  if (event.buttons === 0) {
    if (drag) teardown();
    pending = null;
    // Whatever release this stands in for has already happened, unseen. Don't
    // leave a swallow window armed for some unrelated mouseup to trigger later.
    armSwallowOnRelease = false;
    return;
  }

  if (pending && !drag) {
    const moved =
      Math.abs(event.clientX - pending.x) >= THRESHOLD_PX ||
      Math.abs(event.clientY - pending.y) >= THRESHOLD_PX;
    if (!moved) return;
    begin(pending.issue);
  }
  if (!drag) return;

  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  drag.ghost.style.left = `${event.clientX + 12}px`;
  drag.ghost.style.top = `${event.clientY + 12}px`;
  updatePreview(event.clientX, event.clientY);
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

  drag = { issue, ghost, startTs: null, clientX: 0, clientY: 0, scrollFrame: 0 };
  // A peek opening under the cursor would slide over the grid and eat the drop.
  setDragging(true);
  drag.scrollFrame = requestAnimationFrame(autoScroll);
}

function updatePreview(clientX, clientY) {
  const startTs = gridTimeAt(clientX, clientY);
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
  if (!drag) return; // the drag is over — this is the genuine terminator.
  drag.scrollFrame = requestAnimationFrame(autoScroll);

  // #right-panel is static markup and never absent, but if it ever were, that is
  // a reason to skip this one frame, not to stop rescheduling and silently kill
  // auto-scroll for the rest of the drag.
  const panel = document.getElementById('right-panel');
  if (!panel) return;

  const rect = panel.getBoundingClientRect();
  const y = drag.clientY;
  let delta = 0;

  // The task list sits to the left of this panel, so testing Y alone would make
  // dragging across it at a low Y scroll the timeline with no preview in sight.
  // Gate on X first: at or right of the panel's left edge reads as "over the
  // timeline's column, or having been pushed out of the window above or below it"
  // — the panel is docked to the right, so nothing right of that edge is the task
  // list.
  if (drag.clientX >= rect.left) {
    // No containment half on either branch, on purpose. The old `y >= rect.top` /
    // `y <= rect.bottom` guards were meant to mean "the cursor is inside the
    // panel", but combined with the edge band they made the band unreachable from
    // outside: the moment the cursor rose above the panel's top, the up-scroll
    // branch stopped firing (mirrored at the bottom), and pushing harder — the
    // natural reaction — only made it worse. Anything at or past the edge, inside
    // the window or beyond it, scrolls.
    if (y < rect.top + EDGE_PX) delta = -EDGE_SCROLL_PX;
    else if (y > rect.bottom - EDGE_PX) delta = EDGE_SCROLL_PX;
  }

  if (delta !== 0) {
    panel.scrollTop += delta;
    // The grid just moved under a cursor that did not, so the preview has to
    // follow — from the stored coordinates, since there is no event here.
    updatePreview(drag.clientX, y);
  }
}

async function onMouseUp() {
  if (!drag) {
    // Escape already tore the drag down while the button was presumably still
    // held; this release is the one the swallow window was waiting for, so it is
    // armed only now, measured from here rather than from teardown.
    if (armSwallowOnRelease) {
      armSwallowOnRelease = false;
      swallowUntil = Date.now() + SWALLOW_MS;
    }
    pending = null;
    return;
  }

  const { issue, startTs } = drag;
  teardown();
  swallowUntil = Date.now() + SWALLOW_MS;

  // Released somewhere the grid cannot turn into a time: cancel, quietly.
  if (startTs === null) return;

  state.entries = [
    ...state.entries,
    dropEntryFor(issue, uuid(), startTs, startOfDayMs(state.selectedDate)),
  ];
  await persistDayNow();
  renderAll();
}

// Does not arm the swallow window itself — that has to happen at the release the
// window exists to protect, which is not always this call: teardown() also runs
// from Escape (button likely still down) and from a lost-mouseup detected on the
// next mousemove (no click will follow that release at all). See the two call
// sites that set `swallowUntil` for where it actually belongs.
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
}
