// The day view: hour grid, overlap columns, drag to move, drag handles to resize,
// the live in-progress block, and the quick-entry popup.
//
// Ported from the plugin largely as-is. The drag and snap edge cases here were
// settled by use, not by design — treat behaviour changes as regressions unless
// they are deliberate.

import { showContextMenu } from './context-menu.js';
import { markDirty } from './entries.js';
import { sameTimes } from './entry-ops.js';
import { renderAll } from './render.js';
import { isToday, persistDayNow, pxPerMin, state, visibleEntries } from './state.js';
import { createIssueLookup, searchIssues } from './tasks.js';
import { toastWarn } from './toast.js';
import {
  dateKey,
  esc,
  extractIssueKey,
  msToDur,
  QUARTER,
  snapToQuarter,
  startOfDayMs,
  stripTrailingKey,
  tsToHHMM,
  uuid,
} from './util.js';

// Nothing shorter than one grid step, so a block can never be dragged into a
// sliver that is impossible to grab again.
const MIN_DURATION_MS = QUARTER;
const EDGE_SNAP_MS = 8 * 60_000;
const GUTTER_PX = 40;

// Shared between a render and the drag handlers that run against it.
const view = { rangeStartMs: 0, pxPerMin: 1.5, totalMinutes: 0 };

/**
 * Assign each entry a column so concurrent entries sit side by side, Toggl-style.
 * `totalCols` is the width of the widest overlap group the entry belongs to, so
 * a block never narrows more than its neighbours require.
 */
export function computeColumns(entries) {
  const sorted = [...entries].sort((a, b) => a.startTs - b.startTs);
  const colOf = new Map();
  let active = [];

  for (const entry of sorted) {
    active = active.filter((a) => a.endTs > entry.startTs);
    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col++;
    colOf.set(entry.id, col);
    active.push({ endTs: entry.endTs, col });
  }

  const result = new Map();
  for (const entry of entries) {
    const overlapping = entries.filter(
      (o) => o.id !== entry.id && o.startTs < entry.endTs && o.endTs > entry.startTs,
    );
    let maxCol = colOf.get(entry.id) ?? 0;
    for (const o of overlapping) maxCol = Math.max(maxCol, colOf.get(o.id) ?? 0);
    result.set(entry.id, { col: colOf.get(entry.id) ?? 0, totalCols: maxCol + 1 });
  }
  return result;
}

export function renderTimeline() {
  const grid = document.getElementById('schedule-grid');
  if (!grid) return;

  const dayStart = startOfDayMs(state.selectedDate);
  const entries = visibleEntries().filter((e) => e.endTs !== null);

  // A full work day at minimum, auto-expanded to cover everything logged and,
  // on today, the current hour.
  let startHour = 7;
  let endHour = 20;

  if (isToday()) {
    const nowHour = new Date().getHours();
    endHour = Math.max(endHour, Math.min(24, nowHour + 2));
    startHour = Math.min(startHour, Math.max(0, nowHour - 1));
  }

  const stamps = entries.flatMap((e) => [e.startTs, e.endTs]);
  if (state.timer && isToday()) stamps.push(state.timer.startTs, Date.now());
  if (stamps.length) {
    startHour = Math.min(startHour, Math.max(0, Math.floor((Math.min(...stamps) - dayStart) / 3_600_000) - 1));
    endHour = Math.max(endHour, Math.min(24, Math.ceil((Math.max(...stamps) - dayStart) / 3_600_000) + 1));
  }

  const px = pxPerMin();
  view.rangeStartMs = dayStart + startHour * 3_600_000;
  view.pxPerMin = px;
  view.totalMinutes = (endHour - startHour) * 60;

  grid.replaceChildren();
  grid.style.height = `${view.totalMinutes * px}px`;

  for (let h = startHour; h <= endHour; h++) {
    const y = (h - startHour) * 60 * px;

    const line = document.createElement('div');
    line.className = 'sched-hour';
    line.style.top = `${y}px`;
    const label = document.createElement('span');
    label.className = 'sched-hour-label';
    label.textContent = `${String(h % 24).padStart(2, '0')}:00`;
    line.appendChild(label);
    grid.appendChild(line);

    if (h < endHour) {
      const half = document.createElement('div');
      half.className = 'sched-half';
      half.style.top = `${y + 30 * px}px`;
      grid.appendChild(half);
    }
  }

  // The live block is fed into the column solver as a synthetic entry so it
  // shares columns with whatever it overlaps instead of covering it.
  const live =
    state.timer && isToday()
      ? { id: '__live__', startTs: state.timer.startTs, endTs: Date.now() }
      : null;
  const columns = computeColumns(live ? [...entries, live] : entries);

  for (const entry of entries) {
    grid.appendChild(
      buildBlock(entry, columns.get(entry.id) ?? { col: 0, totalCols: 1 }),
    );
  }

  if (live) {
    const slot = columns.get('__live__') ?? { col: 0, totalCols: 1 };
    const block = document.createElement('div');
    block.className = 'sched-entry-block live';
    placeBlock(block, live.startTs, live.endTs, slot, 20);
    const label = document.createElement('div');
    label.className = 'sched-entry-label';
    label.textContent =
      (state.timer.issueKey ? `${state.timer.issueKey} ` : '') + state.timer.title;
    block.appendChild(label);
    grid.appendChild(block);
  }

  if (isToday()) {
    const nowMin = (Date.now() - view.rangeStartMs) / 60_000;
    if (nowMin >= 0 && nowMin <= view.totalMinutes) {
      const nowLine = document.createElement('div');
      nowLine.className = 'sched-now-line';
      nowLine.style.top = `${nowMin * px}px`;
      const dot = document.createElement('div');
      dot.className = 'sched-now-dot';
      nowLine.appendChild(dot);
      grid.appendChild(nowLine);
    }
  }
}

function placeBlock(el, startTs, endTs, slot, minHeightPx = 6) {
  const offsetMin = (startTs - view.rangeStartMs) / 60_000;
  const durMin = Math.max(1, (endTs - startTs) / 60_000);
  el.style.top = `${offsetMin * view.pxPerMin}px`;
  el.style.minHeight = `${Math.max(minHeightPx, durMin * view.pxPerMin)}px`;

  if (slot.totalCols === 1) {
    el.style.left = `${GUTTER_PX}px`;
    el.style.right = '4px';
    el.style.width = '';
  } else {
    const span = `(100% - ${GUTTER_PX + 4}px)`;
    el.style.left = `calc(${GUTTER_PX}px + ${slot.col / slot.totalCols} * ${span})`;
    el.style.width = `calc(${1 / slot.totalCols} * ${span} - 1px)`;
    el.style.right = 'auto';
  }
}

/**
 * The snapped timestamp a cursor position points at, or null when it falls outside
 * the grid.
 *
 * getBoundingClientRect is viewport-relative and already accounts for the panel's
 * scroll position. Adding scrollTop on top of it — as the plugin did — counted the
 * scroll twice, so once the view had auto-scrolled to now, a click at 16:00 landed
 * somewhere around 21:00. That is why this arithmetic exists exactly once.
 *
 * The bound is the full rect, horizontal included. When only `onGridClick` called
 * this, X was already constrained by event dispatch — the listener is on the grid,
 * so nothing outside it ever arrived. The issue drag calls it from document-level
 * handlers where nothing constrains X, and with only the vertical test a press on a
 * task row, a few pixels sideways, and a release still over the task list booked a
 * 30-minute entry at whatever time that row's Y happened to map to.
 */
export function gridTimeAt(clientX, clientY) {
  const grid = document.getElementById('schedule-grid');
  if (!grid) return null;

  const rect = grid.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right) return null;

  const y = clientY - rect.top;
  if (y < 0 || y > view.totalMinutes * view.pxPerMin) return null;

  return snapToQuarter(view.rangeStartMs + (y / view.pxPerMin) * 60_000, state.selectedDate);
}

/**
 * Show what a drop would create. Always full width rather than fighting for an
 * overlap column: a preview that reflowed as it passed other blocks would jump
 * sideways under the cursor.
 */
export function showDropPlaceholder(startTs, endTs) {
  const grid = document.getElementById('schedule-grid');
  if (!grid) return;

  let el = grid.querySelector('.sched-drop-preview');
  if (!el) {
    el = document.createElement('div');
    el.className = 'sched-drop-preview';
    const label = document.createElement('div');
    label.className = 'sched-entry-label';
    el.appendChild(label);
    grid.appendChild(el);
  }

  placeBlock(el, startTs, endTs, { col: 0, totalCols: 1 });
  el.querySelector('.sched-entry-label').textContent =
    `${tsToHHMM(startTs)} – ${tsToHHMM(endTs)}`;
}

export function hideDropPlaceholder() {
  document.querySelector('.sched-drop-preview')?.remove();
}

function buildBlock(entry, slot) {
  const block = document.createElement('div');
  block.className = 'sched-entry-block';
  if (entry.status === 'synced') block.classList.add('st-synced');
  if (entry.status === 'error') block.classList.add('st-error');
  if (entry.external) block.classList.add('external');
  block.dataset.id = entry.id;
  placeBlock(block, entry.startTs, entry.endTs, slot);

  const label = document.createElement('div');
  label.className = 'sched-entry-label';
  label.textContent = (entry.issueKey ? `${entry.issueKey} ` : '') + entry.title;
  block.appendChild(label);

  // A block is 280px wide at best, so the description lives in the tooltip rather
  // than competing with the title for room.
  block.title = [entry.title, entry.comment].filter(Boolean).join('\n');

  if (!entry.external) {
    for (const edge of ['top', 'bot']) {
      const handle = document.createElement('div');
      handle.className = `sched-handle sched-handle-${edge}`;
      handle.addEventListener('mousedown', (event) => onResize(event, entry, edge));
      block.appendChild(handle);
    }
  }

  block.addEventListener('mousedown', (event) => {
    if (event.target.closest('.sched-handle')) return;
    onMoveBlock(event, entry);
  });

  block.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event, entry);
  });

  return block;
}

// ── Dragging ───────────────────────────────────────────────────────────────

// Joggl's own synced entries stay draggable; the move rewrites the worklog on the
// next Finish Day. Worklogs made in Jira are not Joggl's to move.
function locked(entry) {
  if (entry.external) {
    toastWarn('This worklog was made in Jira — change it there.');
    return true;
  }
  return false;
}

function onResize(event, entry, edge) {
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
    const deltaMs = ((move.clientY - startY) / view.pxPerMin) * 60_000;

    if (edge === 'top') {
      let next = snapToQuarter(origStart + deltaMs, state.selectedDate);
      // Butting up against a neighbour beats the quarter-hour grid: closing a gap
      // exactly is the thing the grid alone cannot express.
      for (const other of visibleEntries()) {
        if (other.id !== entry.id && other.endTs !== null && Math.abs(other.endTs - next) < EDGE_SNAP_MS) {
          next = other.endTs;
        }
      }
      if (next <= origEnd - MIN_DURATION_MS) entry.startTs = next;
    } else {
      let next = snapToQuarter(origEnd + deltaMs, state.selectedDate);
      for (const other of visibleEntries()) {
        if (other.id !== entry.id && Math.abs(other.startTs - next) < EDGE_SNAP_MS) {
          next = other.startTs;
        }
      }
      if (next >= origStart + MIN_DURATION_MS) entry.endTs = next;
    }

    liveUpdate(block, entry);
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

function onMoveBlock(event, entry) {
  event.preventDefault();
  event.stopPropagation();
  if (locked(entry)) return;

  const origStart = entry.startTs;
  const duration = entry.endTs - origStart;
  const startY = event.clientY;
  const dayStart = startOfDayMs(state.selectedDate);
  const block = document.querySelector(`.sched-entry-block[data-id="${CSS.escape(entry.id)}"]`);
  block?.classList.add('dragging', 'moving');

  const onMouseMove = (move) => {
    const deltaMs = ((move.clientY - startY) / view.pxPerMin) * 60_000;
    // Moving keeps the length and snaps the start to the clock grid, so a 47-minute
    // entry stays 47 minutes but always begins on a quarter hour.
    let start = snapToQuarter(origStart + deltaMs, state.selectedDate);
    let end = start + duration;

    if (start < dayStart) {
      start = dayStart;
      end = start + duration;
    }
    if (end > dayStart + 86_400_000) {
      end = dayStart + 86_400_000;
      start = end - duration;
    }

    entry.startTs = start;
    entry.endTs = end;
    liveUpdate(block, entry);
  };

  const onMouseUp = async () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    block?.classList.remove('dragging', 'moving');
    await commitDrag(entry, { startTs: origStart, endTs: origStart + duration });
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// Mirror the drag into the block and the matching list card without a full
// re-render, which would tear the element out from under the mouse.
function liveUpdate(block, entry) {
  if (block) {
    const offsetMin = (entry.startTs - view.rangeStartMs) / 60_000;
    const durMin = Math.max(1, (entry.endTs - entry.startTs) / 60_000);
    block.style.top = `${offsetMin * view.pxPerMin}px`;
    block.style.minHeight = `${Math.max(6, durMin * view.pxPerMin)}px`;
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
 * End of a move or resize. `before` is where the block started the gesture.
 *
 * A plain click on a block runs this whole path — mousedown, no movement,
 * mouseup — so committing unconditionally flipped a synced entry back to
 * pending and had Finish Day offer to rewrite a worklog that was already right.
 * A render still happens: liveUpdate left inline styles on the block, and this
 * restores the canonical layout.
 */
async function commitDrag(entry, before) {
  if (sameTimes(entry, before)) {
    renderAll();
    return;
  }
  markDirty(entry);
  await persistDayNow();
  renderAll();
}

// ── Quick entry on an empty part of the grid ───────────────────────────────

let quickEntryEl = null;

export function hideQuickEntry() {
  quickEntryEl?.remove();
  quickEntryEl = null;
  document.removeEventListener('mousedown', onQuickEntryOutside, true);
}

function onQuickEntryOutside(event) {
  if (quickEntryEl && !quickEntryEl.contains(event.target)) hideQuickEntry();
}

export function onGridClick(event) {
  if (event.target.closest('.sched-entry-block') || event.target.closest('.sched-handle')) return;

  const rawStartTs = gridTimeAt(event.clientX, event.clientY);
  if (rawStartTs === null) return;

  const duration = 30 * 60_000;
  // Same rule dropEntryFor applies, and for the same reason: pull the start back
  // rather than shorten the block. When the visible range extends to hour 24, a
  // click near the bottom can resolve to exactly next-day midnight, and without
  // this the block would commit as 00:00–00:30 of *tomorrow* under today's key.
  // A 30-minute click silently becoming a 15-minute entry would be a worse
  // surprise than one that lands a quarter hour earlier than clicked.
  const latestStart = startOfDayMs(state.selectedDate) + 86_400_000 - duration;
  const startTs = Math.min(rawStartTs, latestStart);

  showQuickEntry(event.clientX, event.clientY, startTs, startTs + duration);
}

function showQuickEntry(cx, cy, startTs, endTs) {
  hideQuickEntry();

  const wrap = document.createElement('div');
  wrap.className = 'sched-quick-entry';

  const time = document.createElement('div');
  time.className = 'sched-quick-entry-time';
  time.textContent = `${tsToHHMM(startTs)} – ${tsToHHMM(endTs)}`;
  wrap.appendChild(time);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search an issue, or type a name…';
  input.autocomplete = 'off';
  wrap.appendChild(input);

  const results = document.createElement('div');
  results.className = 'sched-quick-entry-results';
  wrap.appendChild(results);

  const commit = async (issueKey, issueId, title) => {
    hideQuickEntry();
    state.entries = [
      ...state.entries,
      {
        id: uuid(),
        issueKey: issueKey ?? null,
        issueId: issueId ?? null,
        title,
        startTs,
        endTs,
        status: issueKey ? 'pending' : 'local',
        worklogId: null,
        errorMsg: null,
      },
    ];
    await persistDayNow();
    renderAll();
  };

  // Same reach as the omnibar: the loaded issues are only what the JQL sources
  // returned, so anything Done or assigned elsewhere has to come from Jira.
  let remote = { query: '', issues: [] };
  const lookupRemote = createIssueLookup((query, issues) => {
    remote = { query, issues };
    if (quickEntryEl === wrap) renderResults(input.value);
  });

  const issueRow = (issue) => {
    const item = document.createElement('div');
    item.className = 'task-dd-item';
    item.innerHTML =
      `<span class="jira-chip">${esc(issue.issueKey)}</span>` +
      `<span class="task-dd-title">${esc(issue.title)}</span>`;
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      commit(issue.issueKey, issue.issueId, issue.title);
    });
    return item;
  };

  // Positions the popup against its *current* size, flipping above the cursor
  // when it would otherwise run off the bottom of the window.
  //
  // This must never run before the results are in the DOM. It used to be called
  // once, from the outer requestAnimationFrame, against a popup that was still
  // empty — renderResults('') ran a line later. The flip test then measured a
  // ~60px empty popup, decided it fit below the cursor, and the popup went on to
  // grow to ~250px once results arrived, past the bottom edge with no way back.
  // So this is called only from inside renderResults, after `results` has real
  // children — on the initial render and on every later one, since a query
  // shrinking or growing the result count (every keystroke, and the
  // remote-lookup callback landing after Jira answers late) can change the
  // height enough to flip the earlier decision. A popup correctly placed for
  // two results must not be left overflowing when five arrive.
  const position = () => {
    const rect = wrap.getBoundingClientRect();
    const x = Math.min(cx, window.innerWidth - rect.width - 8);
    const y = cy + 8 + rect.height > window.innerHeight ? cy - rect.height - 8 : cy + 8;
    wrap.style.left = `${Math.max(8, x)}px`;
    wrap.style.top = `${Math.max(8, y)}px`;
  };

  // Renders only — see the omnibar's showDropdown for why asking Jira from inside
  // a render is what wedged this popup shut.
  const renderResults = (rawQuery) => {
    const query = String(rawQuery ?? '').trim();
    const local = searchIssues(rawQuery).slice(0, 8);
    const fromJira = remote.query === query ? remote.issues : [];

    results.classList.toggle('expanded', local.length + fromJira.length <= 2);

    const children = local.map(issueRow);
    if (fromJira.length > 0) {
      const separator = document.createElement('div');
      separator.className = 'task-dd-sep';
      separator.textContent = 'Elsewhere in Jira';
      children.push(separator, ...fromJira.map(issueRow));
    }

    if (children.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'task-dd-empty';
      hint.textContent = query ? 'No match — Enter adds it as a local entry.' : 'No issues loaded.';
      children.push(hint);
    }

    results.replaceChildren(...children);

    // Reposition now that the result set — and so the popup's height — may have
    // just changed. See the comment on `position` for why this has to happen
    // after content, not before.
    if (quickEntryEl === wrap) position();
  };

  const refreshResults = (rawQuery) => {
    lookupRemote(String(rawQuery ?? '').trim(), searchIssues(rawQuery).slice(0, 8).length);
    renderResults(rawQuery);
  };

  input.addEventListener('input', () => refreshResults(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return hideQuickEntry();
    if (event.key !== 'Enter') return;
    const raw = input.value.trim();
    if (!raw) return hideQuickEntry();

    const candidates = [...searchIssues(raw), ...(remote.query === raw ? remote.issues : [])];
    if (candidates.length === 1) {
      commit(candidates[0].issueKey, candidates[0].issueId, candidates[0].title);
    } else {
      const key = extractIssueKey(raw);
      commit(key, null, key ? stripTrailingKey(raw) || key : raw);
    }
  });

  document.body.appendChild(wrap);
  quickEntryEl = wrap;
  wrap.style.visibility = 'hidden';

  // Wait for layout, then render results (which positions itself — see
  // `position` above) before revealing, so the user never sees it jump.
  //
  // The reveal is in a finally because it once was not: a bug in the result
  // render threw here, and the popup stayed hidden and unfocused for the rest of
  // the session, which read as "clicking the day view does nothing at all". A
  // popup showing an empty list beats an invisible one.
  requestAnimationFrame(() => {
    try {
      refreshResults('');
    } finally {
      wrap.style.visibility = '';
      input.focus();
    }
  });

  document.addEventListener('mousedown', onQuickEntryOutside, true);
}

// ── Cheap per-second updates between full renders ──────────────────────────

export function updateNowMarkers() {
  if (!isToday()) return;
  const grid = document.getElementById('schedule-grid');
  if (!grid) return;

  const line = grid.querySelector('.sched-now-line');
  const nowMin = (Date.now() - view.rangeStartMs) / 60_000;
  if (line && nowMin >= 0 && nowMin <= view.totalMinutes) {
    line.style.top = `${nowMin * view.pxPerMin}px`;
  }

  const live = grid.querySelector('.sched-entry-block.live');
  if (live && state.timer) {
    const offsetMin = (state.timer.startTs - view.rangeStartMs) / 60_000;
    const durMin = Math.max(1, (Date.now() - state.timer.startTs) / 60_000);
    live.style.top = `${offsetMin * view.pxPerMin}px`;
    live.style.minHeight = `${Math.max(20, durMin * view.pxPerMin)}px`;
  }
}

export function scrollToNow() {
  if (dateKey() !== state.selectedDate) return;
  const panel = document.getElementById('right-panel');
  if (!panel) return;
  const nowMin = (Date.now() - view.rangeStartMs) / 60_000;
  panel.scrollTop = Math.max(0, nowMin * view.pxPerMin - panel.clientHeight / 3);
}
