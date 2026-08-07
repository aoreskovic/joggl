// The week view: five or seven day columns sharing one hour range.
//
// **The week shown is the week containing `state.selectedDate`.** That is the whole
// navigation model. T, [, ], Page Up / Page Down and the calendar all move the
// anchor, so they all move the week without knowing this view exists, and switching
// back to the day view lands on the day that was highlighted here.
//
// The omnibar and the pin bar are **moved** into this view's top strip rather than
// copied. Two copies would mean two `#task-input`s, and every listener in the app is
// bound by id — including the drag sources, which are delegated onto `#pin-chips`
// itself and survive the move because moving a node keeps its listeners.

import { showMenu } from './context-menu.js';
import { clearDay, clearWeek, copyPreviousDay } from './copy-day.js';
import { nothingToSync, planFinishDay, syncLabel, syncTooltip } from './finish-day.js';
import { wireRovingList } from './keynav.js';
import { applySelection, select } from './selection.js';
import { activeView, registerView } from './shell.js';
import { isSyncRunning } from './sync.js';
import { pxPerMin, refreshRange, saveUi, state, visibleEntriesFor } from './state.js';
import { blockNavResolver, onGridClick, onGridDblClick, paintDayColumn } from './timeline.js';
import { setColumns } from './timeline-columns.js';
import { computeRange, grid, gridHeightPx, offsetPxOf, setGrid } from './timeline-geometry.js';
import { isWeekend, msToDur, pad, startOfDay, todayKey } from './util.js';
import { addWeeks, visibleWeekDays, weekEnd, weekLabel, weekStart } from './week-range.js';

const $ = (id) => document.getElementById(id);

/** app.js's day selector, handed over at registration — importing it back is a cycle. */
let selectDay = async () => {};

/** The days now drawn, in order. Read by the week's Sync button and column menus. */
let drawnDays = [];

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function weekAnchorDays() {
  return [...drawnDays];
}

// One tab stop for the whole week, arrow keys between blocks — the same shape the
// day view's grid uses, and a separate instance because they are separate lists.
let rovingBlocks = null;
function roving() {
  rovingBlocks ??= wireRovingList({
    container: () => $('week-scroll'),
    rowSelector: '.sched-entry-block:not(.live):not(.ghost)',
    onMove: (block) => select(block.dataset.id),
    resolve: blockNavResolver,
  });
  return rovingBlocks;
}

export function registerWeekView({ selectDate }) {
  selectDay = selectDate;
  registerView('week', {
    mount() {
      $('view-week').hidden = false;
      // Order matters on the way back out, so both nodes are taken by name here and
      // put back against fixed anchors in unmount().
      $('week-topbar').append(document.querySelector('.omnibar'), document.querySelector('.pins-bar'));
      renderWeek();
      loadWeek(state.selectedDate);
      // After the first paint, so there is a grid to scroll.
      setTimeout(scrollWeekToNow, 50);
    },
    unmount() {
      const left = document.querySelector('.left-panel');
      left.insertBefore(document.querySelector('.omnibar'), left.firstChild);
      document.querySelector('.day-header').after(document.querySelector('.pins-bar'));
      $('view-week').hidden = true;
      // A column head carries `is-selected` to mark the week's anchor day — a
      // different meaning than the same class on an entry block or row, and left
      // in the DOM it collides with them: `selection.js`'s applySelection() and
      // every check built on it query `.is-selected` across the whole document to
      // mean "the selected entry", never scoped to this view. Clearing the columns
      // on the way out, rather than leaving last render's heads and blocks sitting
      // hidden, keeps that meaning unambiguous everywhere outside the week view.
      $('week-scroll').replaceChildren();
      drawnDays = [];
    },
    onDayChange(date) {
      return loadWeek(date);
    },
  });
}

/** The week's day logs and its Jira-side rows, in one range read. */
function loadWeek(anchor) {
  return refreshRange(weekStart(anchor), weekEnd(anchor));
}

function sevenDay() {
  return state.ui.weekSevenDay === true;
}

function dayTotalMs(dayKey) {
  const logged = visibleEntriesFor(dayKey).reduce(
    (sum, e) => sum + Math.max(0, (e.endTs ?? e.startTs) - e.startTs),
    0,
  );
  const live = state.timer && dayKey === todayKey() ? Date.now() - state.timer.startTs : 0;
  return logged + live;
}

export function renderWeek() {
  // Both renders run on every renderAll, and both write the one column map. Whichever
  // ran last would own it, which is a rule nobody can read off the code — so each
  // render draws only while its own view is up.
  if (activeView() !== 'week') return;

  const scroll = $('week-scroll');
  if (!scroll) return;

  const anchor = state.selectedDate;
  const days = visibleWeekDays(anchor, {
    sevenDay: sevenDay(),
    hasTime: (day) => visibleEntriesFor(day).length > 0,
  });
  drawnDays = days;

  // One hour range for every column, or the rows do not line up across the week.
  const byDay = new Map(
    days.map((day) => [day, visibleEntriesFor(day).filter((e) => e.endTs !== null)]),
  );
  setGrid({
    ...computeRange(byDay, {
      today: todayKey(),
      timerStartTs: state.timer ? state.timer.startTs : null,
    }),
    pxPerMin: pxPerMin(),
  });

  const gutter = buildGutter();
  const columns = days.map(() => {
    const column = document.createElement('div');
    column.className = 'week-col';
    return column;
  });
  const tint = state.ui.weekendTint !== false;

  const corner = document.createElement('div');
  corner.className = 'week-corner';

  scroll.style.setProperty('--week-col-count', String(days.length));
  scroll.replaceChildren(corner, ...days.map(buildHead), gutter, ...columns);

  // Registered before anything is painted, so a gesture arriving mid-render still
  // resolves to a day. No gutter inside a column: the labels are in the rail.
  setColumns(days.map((day, i) => [day, columns[i], 0]));

  let drawn = 0;
  for (const [i, day] of days.entries()) {
    if (tint && isWeekend(day)) columns[i].classList.add('is-weekend');
    // The anchor day, marked down the whole column and not only in its head — the
    // head is off the top of the screen as soon as the grid is scrolled, and this is
    // the day a paste lands on. A class of its own, not `is-selected`: that one means
    // "this entry is selected" everywhere it is queried.
    if (day === anchor) columns[i].classList.add('is-anchor-day');
    drawn += paintDayColumn(columns[i], day, { showLabels: false, emptyHint: false });
  }

  $('week-empty-hint').hidden = drawn > 0 || Boolean(state.timer);
  renderWeekHeader(days);

  roving().refresh();
  // These blocks are new elements and know nothing about the selection.
  applySelection();
}

function buildGutter() {
  const gutter = document.createElement('div');
  gutter.className = 'week-gutter';
  gutter.style.height = `${gridHeightPx()}px`;
  for (let h = grid.startHour; h <= grid.endHour; h++) {
    const label = document.createElement('span');
    label.className = 'sched-hour-label';
    label.style.top = `${(h - grid.startHour) * 60 * grid.pxPerMin}px`;
    label.textContent = `${pad(h % 24)}:00`;
    gutter.appendChild(label);
  }
  return gutter;
}

function buildHead(dayKey) {
  const date = startOfDay(dayKey);
  const head = document.createElement('div');
  head.className = 'week-colhead';
  head.dataset.day = dayKey;
  if (dayKey === todayKey()) head.classList.add('is-today');
  if (dayKey === state.selectedDate) head.classList.add('is-selected');
  if (state.ui.weekendTint !== false && isWeekend(dayKey)) head.classList.add('is-weekend');

  const name = document.createElement('span');
  name.className = 'week-colhead-day';
  name.textContent = `${WEEKDAY_NAMES[(date.getDay() + 6) % 7]} ${date.getDate()}`;

  const total = document.createElement('span');
  total.className = 'week-colhead-total';
  total.textContent = msToDur(dayTotalMs(dayKey));

  const menu = document.createElement('button');
  menu.className = 'week-colhead-menu';
  menu.type = 'button';
  menu.textContent = '⋯';
  menu.title = 'What to do with this day';
  menu.setAttribute('aria-label', `Actions for ${dayKey}`);
  menu.addEventListener('click', (event) => {
    // The head is itself a click target — selecting the day — so this stops there.
    event.stopPropagation();
    showMenu(event, [
      { icon: '⧉', label: 'Copy previous day', run: () => copyPreviousDay(dayKey) },
      { icon: '⌫', label: 'Clear day', run: () => clearDay(dayKey) },
      { icon: '⌫', label: 'Clear week', danger: true, run: () => clearWeek(weekAnchorDays()) },
    ]);
  });

  head.append(name, total, menu);
  // Clicking a head makes that day the anchor — which marks the column, and is the
  // day the day view shows on the way back.
  head.addEventListener('click', () => selectDay(dayKey));
  return head;
}

function renderWeekHeader(days) {
  const anchor = state.selectedDate;
  $('week-label').textContent = weekLabel(anchor);
  // The calendar only looks backwards, so the week holding today is the last one.
  $('next-week').disabled = weekStart(anchor) >= weekStart(todayKey());

  $('week-5').classList.toggle('is-active', !sevenDay());
  $('week-7').classList.toggle('is-active', sevenDay());

  const total = days.reduce((sum, day) => sum + dayTotalMs(day), 0);
  $('week-total').textContent = `Total: ${msToDur(total)}`;
  updateWeekSyncButton();
}

/**
 * What the week's Sync button says it will do, before it does it.
 *
 * `syncLabel`'s counting rules, unchanged: only what reaches Jira is counted, and
 * entries with no issue key get their own phrasing. The plan is built from the days
 * drawn — a weekend hidden because it is empty has nothing to contribute anyway.
 */
export function updateWeekSyncButton() {
  const button = $('week-sync-btn');
  if (!button) return;
  const busy = isSyncRunning();
  const plan = planFinishDay(drawnDays.flatMap((day) => visibleEntriesFor(day).filter((e) => !e.external)));
  button.textContent = syncLabel(plan, { verb: 'Sync week', busy });
  button.title = syncTooltip(plan);
  button.disabled = busy || nothingToSync(plan);
}

/**
 * The per-second update, between full renders. Only the numbers move — rebuilding
 * the columns every second would tear a drag out from under the mouse, which is the
 * same reason `liveUpdate` mirrors a drag by hand.
 */
export function updateWeekLive() {
  if (activeView() !== 'week') return;
  for (const head of document.querySelectorAll('.week-colhead')) {
    const total = head.querySelector('.week-colhead-total');
    if (total) total.textContent = msToDur(dayTotalMs(head.dataset.day));
  }
  const sum = drawnDays.reduce((acc, day) => acc + dayTotalMs(day), 0);
  $('week-total').textContent = `Total: ${msToDur(sum)}`;
}

function scrollWeekToNow() {
  const scroll = $('week-scroll');
  if (!scroll) return;
  const nowPx = offsetPxOf(Date.now(), todayKey());
  scroll.scrollTop = Math.max(0, nowPx - scroll.clientHeight / 3);
}

/** Called once at boot. The controls outlive every render, so they are bound once. */
export function wireWeekControls({ onZoom, onSync }) {
  $('week-sync-btn').addEventListener('click', () => onSync());
  $('prev-week').addEventListener('click', () => selectDay(addWeeks(state.selectedDate, -1)));
  $('next-week').addEventListener('click', () => {
    if ($('next-week').disabled) return;
    const target = addWeeks(state.selectedDate, 1);
    // Forward past today lands on today, the same clamp the day arrows and the
    // calendar apply, for the same reason.
    selectDay(target > todayKey() ? todayKey() : target);
  });

  for (const [id, value] of [['week-5', false], ['week-7', true]]) {
    $(id).addEventListener('click', async () => {
      if (sevenDay() === value) return;
      await saveUi({ weekSevenDay: value });
      renderWeek();
    });
  }

  $('week-zoom-in').addEventListener('click', () => onZoom(1));
  $('week-zoom-out').addEventListener('click', () => onZoom(-1));

  // Clicking an empty hour marks that column's day; double-clicking it opens the
  // quick entry there. Both ask columnAt, so they answer for the day the pointer was
  // over and not for the day that happens to be selected.
  $('week-scroll').addEventListener('click', onGridClick);
  $('week-scroll').addEventListener('dblclick', onGridDblClick);
}
