// Jump to a date.
//
// Stepping a day at a time is fine for yesterday and useless for last month —
// reaching June from July was about fifty clicks. This is a month grid in the one
// modal, opened from the date label.
//
// It only ever looks backwards: the timer runs on today and `next-day` stops there,
// so a future day is not a day this app has anything to say about. Those cells are
// disabled rather than hidden, because a month with holes in it reads as broken.

import { askModal } from './modal.js';
import {
  addDays,
  addMonths,
  monthGrid,
  monthLabel,
  startOfDay,
  todayKey,
  WEEKDAY_INITIALS,
} from './util.js';

/**
 * @param {string} selectedKey the day currently on screen, YYYY-MM-DD
 * @returns {Promise<string|null>} the chosen day, or null if dismissed
 */
export function pickDate(selectedKey) {
  return askModal({
    title: 'Jump to a date',
    body: (resolve) => buildCalendar(selectedKey, resolve),
    buttons: [{ label: 'Cancel', value: null }],
    dismissValue: null,
    focusBody: true,
  });
}

function buildCalendar(selectedKey, resolve) {
  const el = document.createElement('div');
  el.className = 'date-picker';

  const label = document.createElement('span');
  label.className = 'date-picker-month';
  const prev = stepButton('‹', 'Previous month');
  const next = stepButton('›', 'Next month');

  const head = document.createElement('div');
  head.className = 'date-picker-head';
  head.append(prev, label, next);

  const weekdays = document.createElement('div');
  weekdays.className = 'date-picker-week';
  for (const name of WEEKDAY_INITIALS) {
    const cell = document.createElement('span');
    cell.textContent = name;
    weekdays.appendChild(cell);
  }

  const grid = document.createElement('div');
  grid.className = 'date-picker-grid';

  const hint = document.createElement('div');
  hint.className = 'form-hint';
  hint.textContent = 'Arrows move a day or a week, Page Up and Page Down a month.';

  el.append(head, weekdays, grid, hint);

  const today = todayKey();
  /** Which month is on screen. */
  let anchor = clampToPast(selectedKey);
  /** The grid's single tab stop — one, so Tab does not walk 42 buttons. */
  let cursor = anchor;

  function clampToPast(key) {
    return key > today ? today : key;
  }

  function render({ moveFocus = false } = {}) {
    label.textContent = monthLabel(anchor);
    // Nothing to see in a month that has not happened.
    next.disabled = startOfMonth(addMonths(anchor, 1)) > today;

    const cells = [];
    for (const week of monthGrid(anchor)) {
      for (const day of week) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className =
          'date-cell' +
          (day.inMonth ? '' : ' outside') +
          (day.key === today ? ' is-today' : '') +
          (day.key === selectedKey ? ' is-selected' : '');
        cell.dataset.key = day.key;
        cell.textContent = String(startOfDay(day.key).getDate());
        cell.disabled = day.key > today;
        // Roving: only the cursor is reachable by Tab, arrows move within.
        cell.tabIndex = day.key === cursor ? 0 : -1;
        if (day.key === cursor) cell.dataset.autofocus = 'true';
        cell.title = day.key;
        cells.push(cell);
      }
    }
    grid.replaceChildren(...cells);

    // Only when a key moved the cursor. Doing it on the first render would steal
    // focus from askModal, which is what puts it here in the first place.
    if (moveFocus) grid.querySelector('[tabindex="0"]')?.focus();
  }

  function moveTo(key, { sameMonth = false } = {}) {
    const wanted = clampToPast(key);
    if (wanted === cursor) return;
    cursor = wanted;
    // Following the cursor out of the month is the whole point of arrow keys at the
    // edges; a month step keeps whatever month it just moved to.
    if (!sameMonth) anchor = cursor;
    render({ moveFocus: true });
  }

  prev.addEventListener('click', () => stepMonth(-1));
  next.addEventListener('click', () => stepMonth(1));

  function stepMonth(n) {
    anchor = clampToPast(addMonths(anchor, n));
    cursor = anchor;
    render({ moveFocus: true });
  }

  grid.addEventListener('click', (event) => {
    const key = event.target.closest('.date-cell')?.dataset.key;
    if (key) resolve(key);
  });

  grid.addEventListener('keydown', (event) => {
    const by = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }[event.key];

    if (by !== undefined) {
      event.preventDefault();
      moveTo(addDays(cursor, by));
      return;
    }
    // A month, because Arrow Up and Down already move a week. Nothing else in the
    // dialog can change the month from the keyboard.
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      stepMonth(event.key === 'PageUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const d = startOfDay(anchor);
      const day = event.key === 'Home' ? 1 : new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      moveTo(addDays(anchor, day - d.getDate()), { sameMonth: true });
    }
  });

  render();
  return el;
}

function stepButton(glyph, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav-btn';
  button.textContent = glyph;
  button.title = title;
  return button;
}

function startOfMonth(key) {
  const d = startOfDay(key);
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
