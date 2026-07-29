// Dragging onto the day view.
//
// Three sources, one gesture: an issue row from the task list, a pinned issue, or
// an entry already logged today. The first two create a half-hour block; the
// third moves the block it already has, keeping its length. What is being
// dragged is settled once, at mousedown, and the rest of the gesture only cares
// about the payload.
//
// Mouse events rather than HTML5 drag-and-drop: the day view's own move and resize
// already work this way, the ghost is then ours to draw and position, and a small
// movement threshold is what lets a single click on a task keep doing what it always
// did, which is start a timer.

import { clampDropStart, DEFAULT_DROP_MS, dropEntryFor, movedEntry } from './entry-ops.js';
import { markDirty } from './entries.js';
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

/** mousedown seen on a draggable row, threshold not yet crossed. */
let pending = null;
/**
 * A live drag: { payload, ghost, startTs, clientX, clientY, scrollFrame }.
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

// ── What each source contributes ───────────────────────────────────────────

/** @returns {{kind, label, key, durationMs, issue?, entryId?}|null} */
function payloadFromTaskList(target) {
  const row = target.closest('.task-item');
  // The pin has its own click and is not a drag handle.
  if (!row || target.closest('.tt-pin')) return null;

  const issue = state.issues.find((i) => i.issueKey === row.dataset.key);
  if (!issue) return null;
  return { kind: 'issue', issue, label: issue.title, key: issue.issueKey, durationMs: DEFAULT_DROP_MS };
}

function payloadFromPins(target) {
  const chip = target.closest('.pin-chip');
  // The × unpins; it is not a drag handle.
  if (!chip || target.closest('.pin-remove')) return null;

  const pin = state.pins.find((p) => p.issueKey === chip.dataset.key);
  if (!pin) return null;
  // A pin stores no issueId. The worklog POST takes the key, so that is enough.
  const issue = { issueKey: pin.issueKey, issueId: null, title: pin.title };
  return { kind: 'issue', issue, label: pin.title, key: pin.issueKey, durationMs: DEFAULT_DROP_MS };
}

function payloadFromEntryList(target) {
  const card = target.closest('.entry-card');
  // The inline time fields and the row's own buttons come first — dragging must
  // not steal a click meant for editing or deleting.
  if (!card || target.closest('.ie') || target.closest('[data-a]')) return null;

  // Only Joggl's own entries, and only finished ones: state.entries excludes the
  // read-only Jira-side worklogs by construction, and a running entry has no end
  // to keep the length of.
  const entry = state.entries.find((e) => e.id === card.dataset.id);
  if (!entry || entry.endTs === null || entry.endTs === undefined) return null;

  return {
    kind: 'entry',
    entryId: entry.id,
    label: entry.title,
    key: entry.issueKey,
    durationMs: entry.endTs - entry.startTs,
  };
}

const SOURCES = [
  ['task-list', payloadFromTaskList],
  ['pin-chips', payloadFromPins],
  ['entry-list', payloadFromEntryList],
];

export function wireDayViewDrag() {
  for (const [id, toPayload] of SOURCES) {
    const host = document.getElementById(id);
    if (!host) continue;

    // Delegated, because every render replaces these children — per-row listeners
    // would be rebound constantly and leak the old ones.
    host.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const payload = toPayload(event.target);
      if (payload) pending = { payload, x: event.clientX, y: event.clientY };
    });
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (drag) {
      armSwallowOnRelease = true;
      teardown();
    } else if (pending) {
      // Between mousedown and the threshold there is no ghost, no preview, nothing
      // a swallowed click would be protecting the user from — so just drop the
      // pending gesture, without arming the swallow window. The release that
      // follows should behave exactly like the click it already is (starting a
      // timer, same as any other click on a task row), not be eaten. Only the
      // pending state needs clearing, so crossing the threshold afterwards cannot
      // still start a drag despite the Escape.
      pending = null;
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
    begin(pending.payload);
  }
  if (!drag) return;

  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  drag.ghost.style.left = `${event.clientX + 12}px`;
  drag.ghost.style.top = `${event.clientY + 12}px`;
  updatePreview(event.clientX, event.clientY);
}

function begin(payload) {
  pending = null;

  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML =
    (payload.key ? `<span class="jira-chip">${esc(payload.key)}</span>` : '') +
    `<span class="drag-ghost-title">${esc(payload.label)}</span>`;
  document.body.appendChild(ghost);
  document.body.classList.add('is-dragging-issue');

  drag = { payload, ghost, startTs: null, clientX: 0, clientY: 0, scrollFrame: 0 };
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

  // Clamped through the same helper the drop uses, so the preview is exactly what
  // committing would produce rather than a second guess at the same rule.
  const start = clampDropStart(startTs, startOfDayMs(state.selectedDate), drag.payload.durationMs);
  showDropPlaceholder(start, start + drag.payload.durationMs);
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

  const { payload, startTs } = drag;
  teardown();
  swallowUntil = Date.now() + SWALLOW_MS;

  // Released somewhere the grid cannot turn into a time: cancel, quietly.
  if (startTs === null) return;

  const dayStartTs = startOfDayMs(state.selectedDate);

  if (payload.kind === 'entry') {
    const entry = state.entries.find((e) => e.id === payload.entryId);
    // It could have been deleted, or the day changed, while the drag was running.
    if (!entry) return;
    const moved = movedEntry(entry, startTs, dayStartTs);
    // A move needs syncing again for exactly the reason a block drag does.
    markDirty(moved);
    state.entries = state.entries.map((e) => (e.id === moved.id ? moved : e));
  } else {
    state.entries = [...state.entries, dropEntryFor(payload.issue, uuid(), startTs, dayStartTs)];
  }

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
