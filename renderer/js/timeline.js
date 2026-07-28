// The day view: hour grid, overlap columns, drag to move, drag handles to resize,
// the live in-progress block, and the quick-entry popup.
//
// Ported from the plugin largely as-is. The drag and snap edge cases here were
// settled by use, not by design — treat behaviour changes as regressions unless
// they are deliberate.

import { deleteEntry, splitEntry } from './entries.js';
import { renderAll } from './render.js';
import { isToday, persistDayNow, pxPerMin, state } from './state.js';
import { searchIssues } from './tasks.js';
import { startTimer } from './timer.js';
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
  const entries = state.entries.filter((e) => e.endTs !== null);

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

function buildBlock(entry, slot) {
  const block = document.createElement('div');
  block.className = 'sched-entry-block';
  if (entry.status === 'synced') block.classList.add('st-synced');
  if (entry.status === 'error') block.classList.add('st-error');
  block.dataset.id = entry.id;
  placeBlock(block, entry.startTs, entry.endTs, slot);

  const label = document.createElement('div');
  label.className = 'sched-entry-label';
  label.textContent = (entry.issueKey ? `${entry.issueKey} ` : '') + entry.title;
  block.appendChild(label);

  for (const edge of ['top', 'bot']) {
    const handle = document.createElement('div');
    handle.className = `sched-handle sched-handle-${edge}`;
    handle.addEventListener('mousedown', (event) => onResize(event, entry, edge));
    block.appendChild(handle);
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

function locked(entry) {
  if (entry.worklogId) {
    toastWarn('Already logged to Jira — change the worklog in Jira instead.');
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
      for (const other of state.entries) {
        if (other.id !== entry.id && other.endTs !== null && Math.abs(other.endTs - next) < EDGE_SNAP_MS) {
          next = other.endTs;
        }
      }
      if (next <= origEnd - MIN_DURATION_MS) entry.startTs = next;
    } else {
      let next = snapToQuarter(origEnd + deltaMs, state.selectedDate);
      for (const other of state.entries) {
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
    await commitDrag(entry);
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
    await commitDrag(entry);
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
    const ms = state.entries.reduce((sum, e) => sum + Math.max(0, (e.endTs ?? e.startTs) - e.startTs), 0);
    total.textContent = `Total: ${msToDur(ms + (state.timer ? Date.now() - state.timer.startTs : 0))}`;
  }
}

async function commitDrag(entry) {
  if (entry.status === 'error') {
    entry.status = entry.issueKey ? 'pending' : 'local';
    entry.errorMsg = null;
  }
  await persistDayNow();
  renderAll();
}

// ── Context menu ───────────────────────────────────────────────────────────

export function hideContextMenu() {
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.replaceChildren();
}

function showContextMenu(event, entry) {
  hideContextMenu();
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;

  const items = [
    { icon: '⏵', label: 'Restart timer', run: () => startTimer({ issueKey: entry.issueKey, issueId: entry.issueId, title: entry.title }) },
    { icon: '✂', label: 'Split at midpoint', run: () => splitEntry(entry.id) },
    { icon: '🗑', label: 'Delete', danger: true, run: () => deleteEntry(entry.id) },
  ];

  for (const item of items) {
    const el = document.createElement('div');
    el.className = `ctx-item${item.danger ? ' danger' : ''}`;
    el.textContent = `${item.icon}  ${item.label}`;
    el.addEventListener('click', () => {
      hideContextMenu();
      Promise.resolve(item.run()).catch((err) => console.error(err));
    });
    menu.appendChild(el);
  }

  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 4);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 4);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
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

  const panel = document.getElementById('right-panel');
  const grid = document.getElementById('schedule-grid');
  const y = event.clientY - grid.getBoundingClientRect().top + panel.scrollTop;
  const clicked = view.rangeStartMs + (y / view.pxPerMin) * 60_000;

  const startTs = snapToQuarter(clicked, state.selectedDate);
  showQuickEntry(event.clientX, event.clientY, startTs, startTs + 30 * 60_000);
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

  const renderResults = (query) => {
    results.replaceChildren();
    const matches = searchIssues(query).slice(0, 8);
    // Same rule as the omnibar: few enough candidates, show the whole summary.
    results.classList.toggle('expanded', matches.length <= 2);

    if (matches.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'task-dd-empty';
      hint.textContent = query.trim()
        ? 'No match — Enter adds it as a local entry.'
        : 'No issues loaded.';
      results.appendChild(hint);
      return;
    }

    for (const issue of matches) {
      const item = document.createElement('div');
      item.className = 'task-dd-item';
      item.innerHTML =
        `<span class="jira-chip">${esc(issue.issueKey)}</span>` +
        `<span class="task-dd-title">${esc(issue.title)}</span>`;
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        commit(issue.issueKey, issue.issueId, issue.title);
      });
      results.appendChild(item);
    }
  };

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return hideQuickEntry();
    if (event.key !== 'Enter') return;
    const raw = input.value.trim();
    if (!raw) return hideQuickEntry();
    const matches = searchIssues(raw);
    if (matches.length === 1) {
      commit(matches[0].issueKey, matches[0].issueId, matches[0].title);
    } else {
      const key = extractIssueKey(raw);
      commit(key, null, key ? stripTrailingKey(raw) || key : raw);
    }
  });

  document.body.appendChild(wrap);
  quickEntryEl = wrap;
  wrap.style.visibility = 'hidden';

  // Position after layout so the popup can be flipped when it would fall off screen.
  requestAnimationFrame(() => {
    const rect = wrap.getBoundingClientRect();
    const x = Math.min(cx, window.innerWidth - rect.width - 8);
    const y = cy + 8 + rect.height > window.innerHeight ? cy - rect.height - 8 : cy + 8;
    wrap.style.left = `${Math.max(8, x)}px`;
    wrap.style.top = `${Math.max(8, y)}px`;
    wrap.style.visibility = '';
    input.focus();
    renderResults('');
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
