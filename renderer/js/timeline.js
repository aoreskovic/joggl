// The day view: hour grid, overlap columns, drag to move, drag handles to resize,
// the live in-progress block, and the quick-entry popup.
//
// Ported from the plugin largely as-is. The drag and snap edge cases here were
// settled by use, not by design — treat behaviour changes as regressions unless
// they are deliberate.

import { editorForTarget } from './click-actions.js';
import { showContextMenu } from './context-menu.js';
import { editEntryComment } from './entries.js';
import { createRowNav, wireRovingList } from './keynav.js';
import { renderAll } from './render.js';
import { applySelection, clearSelection, select, toggleSelect } from './selection.js';
import { activeView } from './shell.js';
import {
  entriesFor,
  isToday,
  persistDayNow,
  pxPerMin,
  setEntriesFor,
  state,
  visibleEntriesFor,
} from './state.js';
import { createIssueLookup, searchIssues } from './tasks.js';
import { clearColumns, columnAt, columnFor, columnPairs, GUTTER_PX, placeBlock, setColumns } from './timeline-columns.js';
import { isClickSuppressed, onMoveBlock, onResize } from './timeline-drag.js';
import {
  computeRange,
  grid,
  gridHeightPx,
  offsetPxOf,
  setGrid,
} from './timeline-geometry.js';
import {
  dateKey,
  esc,
  extractIssueKey,
  startOfDayMs,
  stripTrailingKey,
  todayKey,
  tsToHHMM,
  uuid,
} from './util.js';

// One tab stop for the whole grid, arrow keys between blocks. Lazy because the
// grid exists before this module runs but renderTimeline may be called first.
let rovingBlocks = null;
function roving() {
  rovingBlocks ??= wireRovingList({
    container: () => document.getElementById('schedule-grid'),
    rowSelector: '.sched-entry-block:not(.live)',
    onMove: (block) => select(block.dataset.id),
  });
  return rovingBlocks;
}

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
  // The week view registers its own columns, and both renders run on every
  // renderAll. Whichever ran last would own the map, which is a rule nobody can
  // read off the code — so each render draws only while its own view is up.
  if (activeView() !== 'day') return;

  const gridEl = document.getElementById('schedule-grid');
  if (!gridEl) {
    // Nothing was drawn, so nothing is a column. Leaving the last render's map in
    // place would have `columnAt` answering from elements no longer on the page.
    clearColumns();
    return;
  }

  const day = state.selectedDate;
  setColumns([[day, gridEl, GUTTER_PX]]);

  const entries = visibleEntriesFor(day).filter((e) => e.endTs !== null);
  const { startHour, endHour } = computeRange(new Map([[day, entries]]), {
    today: isToday() ? day : null,
    timerStartTs: state.timer && isToday() ? state.timer.startTs : null,
  });
  setGrid({ startHour, endHour, pxPerMin: pxPerMin() });

  gridEl.style.height = `${gridHeightPx()}px`;
  paintDayColumn(gridEl, day, { showLabels: true, emptyHint: true });

  roving().refresh();
  // These blocks are new elements and know nothing about the selection.
  applySelection();
}

/**
 * Draw one day into one column: hour lines, its blocks, the live timer block, the
 * now line, and — when asked — the empty hint.
 *
 * The hour range is *not* computed here. Every column of a week shares one, or the
 * rows do not line up across it, so `setGrid` is the caller's business and this only
 * reads it. The live block belongs to today's column whatever day is selected, which
 * is why the test is `todayKey()` and not `isToday()`.
 *
 * @returns {number} how many finished blocks were drawn
 */
export function paintDayColumn(host, dayKey, { showLabels = true, emptyHint = true } = {}) {
  const px = grid.pxPerMin;
  host.replaceChildren();
  host.style.height = `${gridHeightPx()}px`;

  for (let h = grid.startHour; h <= grid.endHour; h++) {
    const y = (h - grid.startHour) * 60 * px;

    const line = document.createElement('div');
    line.className = 'sched-hour';
    line.style.top = `${y}px`;
    if (showLabels) {
      const label = document.createElement('span');
      label.className = 'sched-hour-label';
      label.textContent = `${String(h % 24).padStart(2, '0')}:00`;
      line.appendChild(label);
    }
    host.appendChild(line);

    if (h < grid.endHour) {
      const half = document.createElement('div');
      half.className = 'sched-half';
      half.style.top = `${y + 30 * px}px`;
      host.appendChild(half);
    }
  }

  const entries = visibleEntriesFor(dayKey).filter((e) => e.endTs !== null);

  // The live block is fed into the column solver as a synthetic entry so it
  // shares columns with whatever it overlaps instead of covering it.
  const live =
    state.timer && dayKey === todayKey()
      ? { id: '__live__', startTs: state.timer.startTs, endTs: Date.now() }
      : null;
  const slots = computeColumns(live ? [...entries, live] : entries);

  for (const entry of entries) {
    host.appendChild(buildBlock(entry, dayKey, slots.get(entry.id) ?? { col: 0, totalCols: 1 }));
  }

  if (live) {
    const slot = slots.get('__live__') ?? { col: 0, totalCols: 1 };
    const block = document.createElement('div');
    block.className = 'sched-entry-block live';
    placeBlock(block, live.startTs, live.endTs, dayKey, slot, 20);
    const label = document.createElement('div');
    label.className = 'sched-entry-label';
    label.textContent =
      (state.timer.issueKey ? `${state.timer.issueKey} ` : '') + state.timer.title;
    block.appendChild(label);
    host.appendChild(block);
  }

  if (dayKey === todayKey()) {
    const nowPx = offsetPxOf(Date.now(), dayKey);
    if (nowPx >= 0 && nowPx <= gridHeightPx()) {
      const nowLine = document.createElement('div');
      nowLine.className = 'sched-now-line';
      nowLine.style.top = `${nowPx}px`;
      const dot = document.createElement('div');
      dot.className = 'sched-now-dot';
      nowLine.appendChild(dot);
      host.appendChild(nowLine);
    }
  }

  // Same reasoning as the empty entry list: the two gestures are undiscoverable,
  // and an empty grid is where there is room to name them. pointer-events off, or
  // the hint would swallow the very click it is describing.
  if (emptyHint && entries.length === 0 && !live) {
    const hint = document.createElement('div');
    hint.className = 'sched-empty-hint';
    hint.textContent = 'Click an hour to add time, or drag an issue here';
    host.appendChild(hint);
  }

  return entries.length;
}

/**
 * The snapped timestamp a cursor position points at, or null when it falls outside
 * the grid. The single-day form of `columnAt`, kept because `drag-drop.js` asks
 * "what time" and, until there is more than one column, that is the whole question.
 */
export function gridTimeAt(clientX, clientY) {
  return columnAt(clientX, clientY)?.ts ?? null;
}

/**
 * Show what a drop would create. Always full width rather than fighting for an
 * overlap column: a preview that reflowed as it passed other blocks would jump
 * sideways under the cursor.
 *
 * The preview lives inside the column it is about, so crossing into another day
 * moves it there rather than leaving it hanging over the day it started in.
 */
export function showDropPlaceholder(startTs, endTs, dayKey = state.selectedDate) {
  const host = columnFor(dayKey);
  if (!host) return;

  let el = document.querySelector('.sched-drop-preview');
  if (el && el.parentElement !== host) {
    el.remove();
    el = null;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'sched-drop-preview';
    const label = document.createElement('div');
    label.className = 'sched-entry-label';
    el.appendChild(label);
    host.appendChild(el);
  }

  placeBlock(el, startTs, endTs, dayKey, { col: 0, totalCols: 1 });
  el.querySelector('.sched-entry-label').textContent =
    `${tsToHHMM(startTs)} – ${tsToHHMM(endTs)}`;
}

export function hideDropPlaceholder() {
  document.querySelector('.sched-drop-preview')?.remove();
}

function buildBlock(entry, dayKey, slot) {
  const block = document.createElement('div');
  block.className = 'sched-entry-block';
  if (entry.status === 'synced') block.classList.add('st-synced');
  if (entry.status === 'error') block.classList.add('st-error');
  if (entry.external) block.classList.add('external');
  block.dataset.id = entry.id;
  // Which column this is, and when it starts. Read by the arrow keys (block-nav.js)
  // and by the UI checks, neither of which can otherwise tell one column from
  // another once the blocks are on the page.
  block.dataset.day = dayKey;
  block.dataset.start = String(entry.startTs);
  // Focusable for the same reason the entry rows are: the Menu key fires
  // contextmenu on whatever has focus. The tab stop is roved, not one per block.
  block.tabIndex = -1;
  placeBlock(block, entry.startTs, entry.endTs, dayKey, slot);

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
      handle.addEventListener('mousedown', (event) => onResize(event, entry, edge, dayKey));
      block.appendChild(handle);
    }
  }

  block.addEventListener('mousedown', (event) => {
    if (event.target.closest('.sched-handle')) return;
    onMoveBlock(event, entry, dayKey);
  });

  block.addEventListener('click', (event) => {
    if (event.target.closest('.sched-handle')) return;
    // A move that actually moved is not a click, however it ends up on screen.
    if (isClickSuppressed()) return;
    if (event.ctrlKey || event.metaKey) toggleSelect(entry.id);
    else select(entry.id);
    // onMoveBlock calls preventDefault on mousedown, which suppresses the focus a
    // click would otherwise give, so the roving tab stop has to be set by hand.
    block.focus();
  });

  block.addEventListener('dblclick', (event) => {
    if (editorForTarget(event.target) === null) return;
    // A block is all label, so this is always the description — see click-actions.js.
    editEntryComment(entry.id);
  });

  block.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event, entry);
  });

  block.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target !== block) return;
    event.preventDefault();
    showContextMenu(
      { clientX: 0, clientY: 0, currentTarget: block, target: block, preventDefault() {} },
      entry,
    );
  });

  return block;
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
  // The week's column heads are sticky, so once the grid is scrolled they sit *over*
  // the top of their own column: a click on one is inside the column's rect, and
  // without this it would open the quick-entry popup at whatever hour is hidden
  // beneath the head.
  if (event.target.closest('.week-colhead')) return;

  // Clicking away from every block is how you put the selection down here, the same
  // as the empty space below the entry rows.
  clearSelection();

  // `columnAt` rather than `gridTimeAt`: the popup writes to a day log, so it needs
  // the day the click landed in, not the day that happens to be selected when the
  // user finishes typing into it.
  const at = columnAt(event.clientX, event.clientY);
  if (at === null) return;

  const duration = 30 * 60_000;
  // Same rule dropEntryFor applies, and for the same reason: pull the start back
  // rather than shorten the block. When the visible range extends to hour 24, a
  // click near the bottom can resolve to exactly next-day midnight, and without
  // this the block would commit as 00:00–00:30 of *tomorrow* under today's key.
  // A 30-minute click silently becoming a 15-minute entry would be a worse
  // surprise than one that lands a quarter hour earlier than clicked.
  const latestStart = startOfDayMs(at.dateKey) + 86_400_000 - duration;
  const startTs = Math.min(at.ts, latestStart);

  showQuickEntry(event.clientX, event.clientY, at.dateKey, startTs, startTs + duration);
}

function showQuickEntry(cx, cy, dayKey, startTs, endTs) {
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
    setEntriesFor(dayKey, [
      ...entriesFor(dayKey),
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
    ]);
    await persistDayNow(dayKey);
    renderAll();
  };

  // Same reach as the omnibar: the loaded issues are only what the JQL sources
  // returned, so anything Done or assigned elsewhere has to come from Jira.
  let remote = { query: '', issues: [] };
  const lookupRemote = createIssueLookup((query, issues) => {
    remote = { query, issues };
    if (quickEntryEl === wrap) renderResults(input.value);
  });

  const nav = createRowNav({ container: () => results, rowSelector: '.task-dd-item' });

  const issueRow = (issue) => {
    const item = document.createElement('div');
    item.className = 'task-dd-item';
    item.dataset.issue = JSON.stringify(issue);
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
    if (nav.handleKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter') return;

    // An arrow-key row is an explicit choice and outranks anything derived from
    // the text — including the free-text fallback below.
    const chosen = nav.activate();
    if (chosen) {
      const issue = JSON.parse(chosen.dataset.issue);
      return commit(issue.issueKey, issue.issueId, issue.title);
    }

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

// The old `if (!isToday()) return` guard is gone because the loop already only
// touches today's column — and in the week view today's column is drawn while
// another day is selected.
export function updateNowMarkers() {
  const today = todayKey();
  for (const [dayKey, host] of columnPairs()) {
    if (dayKey !== today) continue;

    const line = host.querySelector('.sched-now-line');
    const nowPx = offsetPxOf(Date.now(), dayKey);
    if (line && nowPx >= 0 && nowPx <= gridHeightPx()) line.style.top = `${nowPx}px`;

    const live = host.querySelector('.sched-entry-block.live');
    if (live && state.timer) {
      const durMin = Math.max(1, (Date.now() - state.timer.startTs) / 60_000);
      live.style.top = `${offsetPxOf(state.timer.startTs, dayKey)}px`;
      live.style.minHeight = `${Math.max(20, durMin * grid.pxPerMin)}px`;
    }
  }
}

export function scrollToNow() {
  if (dateKey() !== state.selectedDate) return;
  const panel = document.getElementById('right-panel');
  if (!panel) return;
  const nowPx = offsetPxOf(Date.now(), state.selectedDate);
  panel.scrollTop = Math.max(0, nowPx - panel.clientHeight / 3);
}
