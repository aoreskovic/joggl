# Week View — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the week view — five or seven day columns sharing one hour range, with everything the day view can do in each of them, entries draggable between days, and one Sync button for the week.

**Architecture:** Phase 2 left the timeline able to answer *which day* a point is in (`timeline-columns.js`) and left the hour range independent of any one day (`timeline-geometry.js`), but only ever registered one column. This phase registers several. `renderer/js/week-view.js` is a new view in the existing registry: it computes one hour range across the visible days, builds a column element per day, registers them all, and paints each with the *same* per-day painter the day view uses. The week shown is the week containing `state.selectedDate`, so every day-navigation path already in the app — `T`, `[`, `]`, Page Up/Down, the calendar — moves the week too, and switching views lands on the day you were looking at.

**Tech Stack:** Electron; plain ES modules in the renderer; `node --test` with `node:assert/strict`; the in-house UI-check harness (`npm run uicheck`, `npm run uicheck:fast`). No new dependencies.

## Global Constraints

These bind every task. Copied from `CLAUDE.md` and the approved spec; exact values are not to be re-derived.

- **No new dependencies.** "Keep the dependency list short… if a dependency needs `node-gyp`, find another way."
- **Process split is non-negotiable:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer never calls Jira directly and never sees the API token. The preload surface is an explicit allowlist — **this phase adds no IPC channel and touches no preload file.**
- **Never trigger Sync / Finish Day from a script, in any mode.** Not from a UI check, not from an inline probe. That rule holds even under `--uicheck-fast`.
- **No baked-in configuration.** No URLs, no project keys, no personal filters.
- **Shell policy:** file tools for all file operations. Shell is for `npm` and `git` only. Never probe the environment.
- **No emoji as icons.** A context-menu item carries either `icon` (a text glyph, escaped) or `svg` (one of our own constants from `icons.js`, not escaped). `📌` on an issue row is the one emoji left.
- **Timestamps are epoch ms internally.** Convert to local wall clock only at the render and Jira-serialisation boundaries. Day keys are **local** dates (`dateKey`), never `toISOString().slice(0,10)`.
- **A day's bounds are `addDays`, not a fixed 86,400,000 ms** — except where an existing helper already takes a `dayStartTs` and adds `86_400_000` to bound *within* one day (`clampDropStart`), which is unchanged here.
- **A write names its day; a render reads the day on screen.** Every path that writes captures `const day = …` before its first `await` and goes through `entriesFor(day)` / `setEntriesFor(day, …)` / `persistDayNow(day)`. In this phase the day is very often *not* `state.selectedDate` — it is the column's own day.
- **Touching an entry is not editing it.** `sameTimes` guards every path that could mark an entry as needing a re-sync.
- **A render must never start a lookup.** Search boxes render from state; the remote lookup is triggered from the event that changed it.
- **Weeks start on Monday**, everywhere, as `WEEKDAY_INITIALS` and `monthGrid` already assume.
- **Week numbering is ISO 8601.** Week 1 is the week containing the first Thursday of January (equivalently, the week containing 4 January). A week's ISO week-year is not always the calendar year of its Monday.
- **The calendar only looks backwards.** A future day is not one this app has anything to say about; `next-day` stops at today, and so does the week stepper.
- **Version bumps:** tasks 1–7 are steps within one change and commit **without** a bump; task 8 runs `npm run bump` once, to `0.18.0`, with the documentation. This is the shape phase 2 used — six plain commits (`0427356`…`d73015c`) then one versioned (`c92e9eb`, 0.17.0) — and it is deliberate: a minor per intermediate step would make the minor stop meaning "something new".
- **`npm test` and `npm run uicheck:fast` must be green at the end of every task.** The live `npm run uicheck` must be green before the branch merges, and **must report the same counts as the fast run** — the only thing keeping `main/jira/fake.js` honest.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `renderer/js/week-range.js` | **new** | Pure. Which days a week holds, what it is called (ISO 8601), which columns are shown. |
| `renderer/js/cross-day.js` | **new** | Pure. Moving one entry from one day log to another. |
| `renderer/js/week-view.js` | **new** | The view: layout, header, columns, totals, mount/unmount, its own renderer. |
| `renderer/js/timeline-columns.js` | modify | Columns hold a gutter width; `columnPairs()` for callers that walk every column. |
| `renderer/js/timeline.js` | modify | `paintDayColumn` extracted; `renderTimeline` becomes its single-column caller; now-markers walk every column. |
| `renderer/js/timeline-drag.js` | modify | A move gesture resolves its target *column*, not just its target time. |
| `renderer/js/drag-drop.js` | modify | A drop lands on the column under the cursor; the omnibar's result rows become a drag source. |
| `renderer/js/shell.js` | modify | `activeView()`, `hasView()`, and an optional per-view `onDayChange`. |
| `renderer/js/entry-ops.js` | modify | `dirtiedEntry` — the "needs re-syncing" rule, made pure so cross-day moves can be tested. |
| `renderer/js/entries.js` | modify | `markDirty` becomes the mutating wrapper over `dirtiedEntry`. |
| `renderer/js/context-menu.js` | modify | `showMenu(event, items)` extracted, so a column header can raise a menu that is not about an entry. |
| `renderer/js/copy-day.js` | modify | `copyPreviousDay(day)` / `clearDay(day)` take an explicit day; `clearWeek(days)` added. |
| `renderer/js/sync.js` | modify | `syncDays(days)` — one summary, one retry, across however many days. |
| `renderer/js/finish-day.js` | modify | `syncLabel` takes a `verb` override, for `Sync week`. |
| `renderer/js/help.js` | modify | A `Week view` group in `SHORTCUTS`. |
| `renderer/js/app.js` | modify | Registers the week view and its renderer; the day view's own day-change work moves into its registration. |
| `renderer/index.html` | modify | `#view-week` markup; the Week tab stops being disabled. |
| `renderer/css/app.css` | modify | Week layout, column heads, gutter. |
| `main/settings.js` | modify | `weekSevenDay: false` in `UI_DEFAULTS`. |
| `test/week-number.test.js` | **new** | ISO week numbering and the label's year rule. |
| `test/week-range.test.js` | **new** | Mondays, Sundays, which columns show, stepping across a year boundary. |
| `test/cross-day-move.test.js` | **new** | An entry leaving one day log and joining another. |
| `test/finish-day.test.js` | modify | The `verb` override. |
| `scripts/ui-check.mjs` | modify | A `weekView()` section, and the two sidebar rows that assert Week is disabled. |
| `test-and-issues.md` | modify | The Week view checklist; the Sidebar rows rewritten. |
| `CLAUDE.md` | modify | What phase 3 built, and why it is shaped this way. |

---

## Task 1: Weeks — which days, and what they are called

Pure module, no DOM, no IPC. Everything later tasks need in order to say *which seven days* and *week 31*.

**Files:**
- Create: `renderer/js/week-range.js`
- Test: `test/week-number.test.js`, `test/week-range.test.js`

**Interfaces:**
- Consumes: `addDays`, `dateKey`, `startOfDay`, `startOfDayMs` from `renderer/js/util.js`.
- Produces:
  - `weekStart(key: string) -> string` — the Monday of that week
  - `weekEnd(key: string) -> string` — the Sunday
  - `weekDays(key: string) -> string[]` — seven keys, Monday first
  - `addWeeks(key: string, n: number) -> string`
  - `isoWeek(key: string) -> { week: number, weekYear: number }`
  - `weekLabel(key: string) -> string` — `27 Jul – 2 Aug · week 31`
  - `visibleWeekDays(key: string, { sevenDay?: boolean, hasTime?: (dayKey: string) => boolean }) -> string[]`

- [ ] **Step 1: Write the failing week-number test**

Create `test/week-number.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isoWeek, weekLabel } from '../renderer/js/week-range.js';

/**
 * The four boundaries the design doc names. Every one of them is a week whose ISO
 * week-year is not the calendar year of the days in it, which is exactly the case
 * that looks like a bug to anyone who has not read ISO 8601.
 */
test('the boundary weeks from the design doc', () => {
  assert.deepEqual(isoWeek('2025-12-29'), { week: 1, weekYear: 2026 });
  assert.deepEqual(isoWeek('2026-01-04'), { week: 1, weekYear: 2026 });
  assert.deepEqual(isoWeek('2026-07-27'), { week: 31, weekYear: 2026 });
  assert.deepEqual(isoWeek('2026-08-02'), { week: 31, weekYear: 2026 }, 'the Sunday is the same week');
  assert.deepEqual(isoWeek('2026-12-28'), { week: 53, weekYear: 2026 });
  assert.deepEqual(isoWeek('2027-01-03'), { week: 53, weekYear: 2026 });
  assert.deepEqual(isoWeek('2027-01-04'), { week: 1, weekYear: 2027 });
});

/**
 * 1 January on each of the seven weekdays. On a Friday, Saturday or Sunday it
 * belongs to the last week of the outgoing year, which is the half of the rule
 * nobody expects.
 */
test('1 January lands in week 1 only when it falls Monday to Thursday', () => {
  assert.deepEqual(isoWeek('2024-01-01'), { week: 1, weekYear: 2024 }, 'Monday');
  assert.deepEqual(isoWeek('2019-01-01'), { week: 1, weekYear: 2019 }, 'Tuesday');
  assert.deepEqual(isoWeek('2025-01-01'), { week: 1, weekYear: 2025 }, 'Wednesday');
  assert.deepEqual(isoWeek('2026-01-01'), { week: 1, weekYear: 2026 }, 'Thursday');
  assert.deepEqual(isoWeek('2027-01-01'), { week: 53, weekYear: 2026 }, 'Friday');
  assert.deepEqual(isoWeek('2022-01-01'), { week: 52, weekYear: 2021 }, 'Saturday');
  assert.deepEqual(isoWeek('2023-01-01'), { week: 52, weekYear: 2022 }, 'Sunday');
});

test('a year has 53 weeks when it starts on a Thursday, and 52 otherwise', () => {
  // 2026 starts on a Thursday, so it has 53.
  assert.equal(isoWeek('2026-12-28').week, 53);
  // 2027 starts on a Friday, so its first three days belong to 2026 and it has 52.
  assert.equal(isoWeek('2027-12-27').week, 52);
  assert.deepEqual(isoWeek('2028-01-03'), { week: 1, weekYear: 2028 });
});

test('the label carries the year only when the week-year is not the Monday’s', () => {
  assert.equal(weekLabel('2026-07-29'), '27 Jul – 2 Aug · week 31');
  // Monday 29 Dec 2025 is in week 1 of 2026 — say so, or it reads as this year's.
  assert.equal(weekLabel('2025-12-31'), '29 Dec – 4 Jan · week 1 of 2026');
  // Monday 28 Dec 2026 is in week 53 of 2026, which *is* the Monday's year.
  assert.equal(weekLabel('2026-12-30'), '28 Dec – 3 Jan · week 53');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/week-range.js'`.

- [ ] **Step 3: Write the failing week-range test**

Create `test/week-range.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addWeeks, visibleWeekDays, weekDays, weekEnd, weekStart } from '../renderer/js/week-range.js';

test('a week runs Monday to Sunday, whichever day you name', () => {
  // Wed 29 Jul 2026 sits in the week Mon 27 Jul – Sun 2 Aug.
  assert.equal(weekStart('2026-07-29'), '2026-07-27');
  assert.equal(weekEnd('2026-07-29'), '2026-08-02');
  assert.equal(weekStart('2026-07-27'), '2026-07-27', 'a Monday is its own start');
  assert.equal(weekStart('2026-08-02'), '2026-07-27', 'a Sunday belongs to the week before it');
});

test('weekDays gives seven keys, Monday first', () => {
  assert.deepEqual(weekDays('2026-08-02'), [
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
    '2026-07-31', '2026-08-01', '2026-08-02',
  ]);
});

test('stepping weeks crosses a year boundary without arithmetic of its own', () => {
  assert.equal(addWeeks('2026-12-30', 1), '2027-01-06');
  assert.equal(addWeeks('2027-01-06', -1), '2026-12-30');
  assert.equal(weekStart(addWeeks('2026-12-30', 1)), '2027-01-04');
});

test('five-day mode shows Monday to Friday', () => {
  assert.deepEqual(visibleWeekDays('2026-07-29'), [
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
  ]);
});

test('seven-day mode shows all seven', () => {
  assert.equal(visibleWeekDays('2026-07-29', { sevenDay: true }).length, 7);
});

/**
 * The one rule this view must never break: time that cannot be seen is time that
 * does not get synced. Five-day mode means "hide the weekend when it is empty".
 */
test('a weekend day holding time is shown even in five-day mode', () => {
  const days = visibleWeekDays('2026-07-29', { hasTime: (key) => key === '2026-08-01' });
  assert.deepEqual(days, [
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01',
  ]);
  assert.equal(days.includes('2026-08-02'), false, 'the empty Sunday stays hidden');
});

test('a weekday holding nothing is still shown', () => {
  assert.equal(visibleWeekDays('2026-07-29', { hasTime: () => false }).length, 5);
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm test`
Expected: FAIL, same missing module.

- [ ] **Step 5: Write the module**

Create `renderer/js/week-range.js`:

```js
// Which days a week holds, what that week is called, and which of its columns are
// drawn.
//
// Pure — no DOM, no IPC — so the numbering can be tested without a browser. The
// numbering is ISO 8601 rather than a rule of our own, because every colleague's
// calendar and every Jira report says ISO, and agreeing with them is worth more
// than any scheme that would be easier to write.

import { addDays, startOfDay, startOfDayMs } from './util.js';

/** The Monday of the week `key` falls in. Weeks start on Monday, everywhere. */
export function weekStart(key) {
  // getDay() counts from Sunday; shift so Monday is 0, the same shift monthGrid makes.
  const shift = (startOfDay(key).getDay() + 6) % 7;
  return addDays(key, -shift);
}

/** The Sunday of the week `key` falls in. */
export function weekEnd(key) {
  return addDays(weekStart(key), 6);
}

/** The seven day keys of that week, Monday first. */
export function weekDays(key) {
  const monday = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** n weeks away. Through addDays, so a clock change cannot shift the date. */
export function addWeeks(key, n) {
  return addDays(key, n * 7);
}

/**
 * ISO 8601 week number, and the week-year it belongs to.
 *
 * Week 1 is the week holding the first Thursday of January — equivalently, the week
 * holding 4 January. So the week-year is not always the calendar year of the day
 * asked about: 29 Dec 2025 is in week 1 of 2026, and 1 Jan 2027 is in week 53 of
 * 2026. All seven days of a week share one week-year, which is why this is answered
 * from the week's Thursday rather than from the day itself.
 */
export function isoWeek(key) {
  const thursday = startOfDay(addDays(weekStart(key), 3));
  const weekYear = thursday.getFullYear();
  // 4 January is always in week 1, by definition, so the Monday of its week is the
  // first Monday of the week-year.
  const firstMonday = startOfDayMs(weekStart(`${weekYear}-01-04`));
  // Rounded, not floored: a clock change makes one of these weeks 25 hours long, and
  // an hour either way must not cost a week.
  const week = Math.round((thursday.getTime() - firstMonday) / (7 * 86_400_000)) + 1;
  return { week, weekYear };
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * How a week is named above its columns: `27 Jul – 2 Aug · week 31`.
 *
 * The year appears only when the ISO week-year differs from the calendar year of the
 * Monday — `week 1 of 2026` for a week beginning 29 December 2025. Saying the year on
 * the other fifty-one weeks would be noise, and not saying it on this one reads as a
 * mistake.
 */
export function weekLabel(key) {
  const from = startOfDay(weekStart(key));
  const to = startOfDay(weekEnd(key));
  const { week, weekYear } = isoWeek(key);
  const span =
    `${from.getDate()} ${MONTHS_SHORT[from.getMonth()]} – ` +
    `${to.getDate()} ${MONTHS_SHORT[to.getMonth()]}`;
  const name = weekYear === from.getFullYear() ? `week ${week}` : `week ${week} of ${weekYear}`;
  return `${span} · ${name}`;
}

/**
 * Which columns the week draws.
 *
 * Monday to Friday by default, all seven when the toggle says so — and a weekend day
 * holding any time at all is drawn either way. Time that cannot be seen is time that
 * does not get synced, and hiding it is the one thing this view must never do. So
 * five-day mode means "hide Saturday and Sunday when they are empty", and a week with
 * Saturday worked renders six columns.
 *
 * `hasTime` is asked rather than assumed so the caller decides what counts — in the
 * app it is `visibleEntriesFor`, which is local entries plus the Jira-side rows.
 */
export function visibleWeekDays(key, { sevenDay = false, hasTime = () => false } = {}) {
  return weekDays(key).filter((day, index) => sevenDay || index < 5 || hasTime(day));
}
```

`dateKey` is not imported here — `addDays`, `startOfDay` and `startOfDayMs` are all it needs.

- [ ] **Step 6: Run both tests and watch them pass**

Run: `npm test`
Expected: PASS — the suite total rises by 11 (308 → 319).

- [ ] **Step 7: Commit**

```bash
git add renderer/js/week-range.js test/week-number.test.js test/week-range.test.js
git commit -m "Say which days a week holds, and what it is called"
```

---

## Task 2: One grid, many columns

Still **no user-visible change**. The painter that draws a day is separated from the day view that calls it once, and the two places that assumed a single grid element — the drop preview and the now markers — start walking the registered columns instead.

**Files:**
- Modify: `renderer/js/timeline-columns.js`
- Modify: `renderer/js/timeline.js`
- Modify: `renderer/js/timeline-drag.js:62`, `:70` (the edge-snap reads)
- Modify: `renderer/js/shell.js` (adds `activeView`, `hasView`)

**Interfaces:**
- Consumes: `computeRange`, `grid`, `gridHeightPx`, `offsetPxOf`, `setGrid` from `timeline-geometry.js`; `visibleEntriesFor`, `pxPerMin`, `state` from `state.js`.
- Produces:
  - `setColumns(pairs: [dateKey, HTMLElement, gutterPx?][])` — gutter defaults to `GUTTER_PX`
  - `columnPairs() -> [dateKey, HTMLElement][]`
  - `paintDayColumn(hostEl, dayKey, { emptyHint?: boolean, showLabels?: boolean }) -> number` (blocks drawn)
  - `showDropPlaceholder(startTs, endTs, dayKey?)`
  - `activeView() -> string|null`, `hasView(id) -> boolean` from `shell.js`

- [ ] **Step 1: Give a column its own gutter width**

In `renderer/js/timeline-columns.js`, replace the map and the three functions that read it:

```js
/**
 * dateKey -> { el, gutterPx }.
 *
 * The gutter is per column because the two views put the hour labels in different
 * places. The day view draws them *inside* the grid, 40px in, and blocks start after
 * them. A week column is under 200px wide and cannot spare 40 of them, so its labels
 * live in a rail of their own to the left and its blocks start at its left edge.
 */
const columns = new Map();

export function setColumns(pairs) {
  columns.clear();
  for (const [dateKey, el, gutterPx = GUTTER_PX] of pairs) {
    if (el) columns.set(dateKey, { el, gutterPx });
  }
}

export function clearColumns() {
  columns.clear();
}

export function columnFor(dayKey) {
  return columns.get(dayKey)?.el ?? null;
}

/** Every column now drawn, for the callers that have to touch all of them. */
export function columnPairs() {
  return [...columns].map(([dateKey, column]) => [dateKey, column.el]);
}
```

In `columnAt`, destructure the entry:

```js
  for (const [dateKey, { el }] of columns) {
```

In `placeBlock`, take the gutter from the column rather than the constant:

```js
export function placeBlock(el, startTs, endTs, dayKey, slot, minHeightPx = 6) {
  const durMin = Math.max(1, (endTs - startTs) / 60_000);
  // The column's own gutter, not the constant: a week column has none.
  const gutter = columns.get(dayKey)?.gutterPx ?? GUTTER_PX;
  el.style.top = `${offsetPxOf(startTs, dayKey)}px`;
  el.style.minHeight = `${Math.max(minHeightPx, durMin * grid.pxPerMin)}px`;

  if (slot.totalCols === 1) {
    el.style.left = `${gutter}px`;
    el.style.right = '4px';
    el.style.width = '';
  } else {
    const span = `(100% - ${gutter + 4}px)`;
    el.style.left = `calc(${gutter}px + ${slot.col / slot.totalCols} * ${span})`;
    el.style.width = `calc(${1 / slot.totalCols} * ${span} - 1px)`;
    el.style.right = 'auto';
  }
}
```

- [ ] **Step 2: Extract the painter out of renderTimeline**

In `renderer/js/timeline.js`, replace `renderTimeline` with these two functions. The body is the old one, cut in half at the point where "the day view" ends and "a day" begins.

```js
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
```

Add the imports `paintDayColumn` and `renderTimeline` now need, and drop what is no longer used:

```js
import { activeView } from './shell.js';
import { entriesFor, isToday, persistDayNow, pxPerMin, setEntriesFor, state, visibleEntriesFor } from './state.js';
import { clearColumns, columnAt, columnFor, columnPairs, GUTTER_PX, placeBlock, setColumns } from './timeline-columns.js';
import { dateKey, esc, extractIssueKey, startOfDayMs, stripTrailingKey, todayKey, tsToHHMM, uuid } from './util.js';
```

`visibleEntries` is no longer imported here — `visibleEntriesFor(day)` says which day it means, and for the selected day the two are the same list.

- [ ] **Step 3: Put the drop preview in the column it is previewing**

Still in `timeline.js`, replace `showDropPlaceholder`:

```js
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
```

- [ ] **Step 4: Update the now markers in every column**

Replace `updateNowMarkers`:

```js
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
```

The old `if (!isToday()) return` guard is gone because the loop already only touches today's column — and in the week view today's column is drawn while another day is selected.

- [ ] **Step 5: Snap a resize against its own day's neighbours**

In `renderer/js/timeline-drag.js`, change the import and both edge-snap loops. This is the item phase 2 deferred with a note; the note goes with it.

```js
import { persistDayNow, state, visibleEntriesFor } from './state.js';
```

```js
      // Butting up against a neighbour beats the quarter-hour grid: closing a gap
      // exactly is the thing the grid alone cannot express. The neighbours are this
      // entry's own day's, which is the day on screen until there is more than one
      // column and is not afterwards.
      for (const other of visibleEntriesFor(dayKey)) {
```

and, on the bottom edge:

```js
      for (const other of visibleEntriesFor(dayKey)) {
```

`liveUpdate`'s total still reads `visibleEntries()` — it is writing into `#total-display`, which is the day view's own header. Leave it; the week view gets its own totals in task 3.

- [ ] **Step 6: Let a module ask which view is up**

In `renderer/js/shell.js`, add beside `setActiveView`:

```js
/** Which view is mounted. Renders use it so two views cannot both draw at once. */
export function activeView() {
  return activeId;
}

/** Whether a view has been registered — a stored preference may name one that has not. */
export function hasView(id) {
  return views.has(id);
}
```

- [ ] **Step 7: Run the tests and the fast UI check**

Run: `npm test`
Expected: PASS, still 319.

Run: `npm run uicheck:fast`
Expected: PASS, 85 of 85 — this task changes no behaviour, and that suite is the only thing that will notice if a drag or snap edge case is lost.

- [ ] **Step 8: Commit**

```bash
git add renderer/js/timeline-columns.js renderer/js/timeline.js renderer/js/timeline-drag.js renderer/js/shell.js
git commit -m "Draw a day into a column, rather than into the day view"
```

---

## Task 3: The week view mounts, and draws the week

The first task with something on screen. Layout, header, stepper, the `5 | 7` toggle, per-day totals, and every column painted by task 2's painter.

**Files:**
- Create: `renderer/js/week-view.js`
- Modify: `renderer/index.html` (the `#view-week` block; the Week tab stops being disabled)
- Modify: `renderer/css/app.css` (append a `Week view` section at the end)
- Modify: `renderer/js/app.js` (registers the view, its renderer, its controls; `selectDate` hands the data load to the active view)
- Modify: `renderer/js/shell.js` (`notifyDayChange`)
- Modify: `main/settings.js` (`weekSevenDay: false`)
- Modify: `scripts/ui-check.mjs`, `test-and-issues.md`

**Interfaces:**
- Consumes: `paintDayColumn`, `setColumns`, `computeRange`/`setGrid`/`grid`/`gridHeightPx`/`offsetPxOf`, `visibleEntriesFor`, `refreshRange`, `saveUi`, `visibleWeekDays`/`weekLabel`/`weekStart`/`weekEnd`/`addWeeks`.
- Produces:
  - `registerWeekView({ selectDate })` — registers the view; `selectDate(dayKey)` is app.js's, passed in because week-view must not import app.js back
  - `renderWeek()` — a renderer, registered in app.js
  - `wireWeekControls()` — called once at boot
  - `updateWeekLive()` — per-second totals, called from `onTick`
  - `weekAnchorDays() -> string[]` — the days now drawn, for tasks 6 and 7

- [ ] **Step 1: Add the markup**

In `renderer/index.html`, drop the `disabled` attributes from the Week tab:

```html
          <button class="sidebar-item" data-view="week" title="Week View">
            <span class="sidebar-icon"></span><span class="sidebar-label">Week View</span>
          </button>
```

Month keeps `disabled aria-disabled="true" title="Not built yet"` exactly as it is.

Then add, immediately after the closing `</div>` of `<div class="app-layout" id="view-day">` and before `</div><!-- .shell -->`:

```html
      <!-- ── WEEK VIEW ── The omnibar and the pin bar are moved into #week-topbar
           on mount and put back on unmount, so there is one of each in the DOM. -->
      <div class="week-layout" id="view-week" hidden>
        <div class="week-topbar" id="week-topbar"></div>

        <div class="week-header">
          <div class="week-nav">
            <button id="prev-week" class="nav-btn" title="Previous week (Page Up)">‹</button>
            <span id="week-label" class="week-label">—</span>
            <button id="next-week" class="nav-btn" title="Next week (Page Down)">›</button>
          </div>
          <div class="week-header-right">
            <div class="sched-zoom">
              <span class="sched-zoom-icon" id="week-zoom-icon" title="Zoom the timeline"></span>
              <button class="sched-zoom-btn" id="week-zoom-out" title="Zoom out">−</button>
              <span class="sched-zoom-lbl" id="week-zoom-lbl">1×</span>
              <button class="sched-zoom-btn" id="week-zoom-in" title="Zoom in">+</button>
            </div>
            <div class="week-seg" role="group" aria-label="Days shown">
              <button id="week-5" title="Monday to Friday">5</button>
              <button id="week-7" title="Monday to Sunday">7</button>
            </div>
            <span id="week-total" class="total-display">Total: 0m</span>
            <!-- Labelled from planFinishDay on every render — see syncLabel. -->
            <button id="week-sync-btn" class="btn-primary">Sync week</button>
          </div>
        </div>

        <div class="week-body">
          <div class="week-scroll" id="week-scroll"></div>
          <div class="week-empty-hint" id="week-empty-hint" hidden>
            Nothing on this week yet — click an hour to add time, or drag an issue onto a day.
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Add the CSS**

Append to `renderer/css/app.css`:

```css
/* ── Week view ─────────────────────────────────────────────────────────────
   One grid holds the whole thing: row 1 is the sticky column heads, row 2 the
   gutter and the day columns. Two separate grids would drift apart the moment a
   scrollbar appeared, and the heads have to sit exactly over their columns. */

.week-layout {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* Matches .app-layout, so switching views does not change how the rail eases. */
  transition: margin-left 120ms ease;
}

.week-topbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 0;
}

.week-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
}

.week-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.week-label {
  font-weight: 600;
  min-width: 210px;
  text-align: center;
}

.week-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.week-seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.week-seg button {
  padding: 2px 10px;
  border: none;
  background: none;
  font: inherit;
  color: var(--text-muted);
  cursor: pointer;
}

.week-seg button.is-active {
  background: var(--accent-soft);
  color: var(--text);
}

.week-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.week-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--bg-sunken);
  display: grid;
  grid-template-columns: 44px repeat(var(--week-col-count, 5), minmax(0, 1fr));
  align-content: start;
}

.week-corner,
.week-colhead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg-sunken);
  border-bottom: 1px solid var(--border);
  padding: 5px 8px;
  min-width: 0;
}

.week-colhead {
  border-left: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.week-colhead.is-today .week-colhead-day {
  color: var(--accent);
}

.week-colhead.is-selected {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.week-colhead-day {
  font-weight: 600;
  white-space: nowrap;
}

.week-colhead-total {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.week-gutter {
  position: relative;
}

.week-gutter .sched-hour-label {
  position: absolute;
  left: 0;
  /* Pulled up half a line so the label straddles its hour line, as it does in the
     day view where it sits on the line's own row. */
  transform: translateY(-2px);
}

.week-col {
  position: relative;
  border-left: 1px solid var(--border);
  min-width: 0;
}

/* A Saturday or Sunday, when the tint is switched on in Settings — the day view
   tints the whole panel, and a week can only tint the columns it applies to. */
.week-col.is-weekend,
.week-colhead.is-weekend {
  background-image: linear-gradient(var(--weekend-tint), var(--weekend-tint));
}

.week-empty-hint {
  position: absolute;
  left: 44px;
  right: 0;
  top: 35%;
  text-align: center;
  padding: 0 24px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-faint);
  /* Never swallow the click it is describing. */
  pointer-events: none;
}
```

- [ ] **Step 3: Add the UI preference**

In `main/settings.js`, add to `UI_DEFAULTS`, keeping the comment style of its neighbours:

```js
  weekSevenDay: false, // week view: Mon–Fri by default, the 5|7 toggle switches it
```

- [ ] **Step 4: Write the view**

Create `renderer/js/week-view.js`:

```js
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

import { wireRovingList } from './keynav.js';
import { applySelection, select } from './selection.js';
import { activeView, registerView } from './shell.js';
import { pxPerMin, refreshRange, saveUi, state, visibleEntriesFor } from './state.js';
import { paintDayColumn } from './timeline.js';
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
    rowSelector: '.sched-entry-block:not(.live)',
    onMove: (block) => select(block.dataset.id),
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

  head.append(name, total);
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
export function wireWeekControls({ onZoom }) {
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
}
```

- [ ] **Step 5: Wire it up in app.js**

In `renderer/js/app.js`:

Add the imports:

```js
import { hasView, registerView, setActiveView, wireShell } from './shell.js';
import { registerWeekView, renderWeek, updateWeekLive, wireWeekControls } from './week-view.js';
```

Replace the view registration and the hardcoded `setActiveView('day')`:

```js
  wireShell();
  registerView('day', {
    mount() {
      $('view-day').hidden = false;
    },
    unmount() {
      $('view-day').hidden = true;
    },
    // Time booked straight into Jira belongs in this day's total too. Fired after
    // the first paint, and never allowed to break the local view if Jira is down.
    onDayChange(date) {
      return refreshExternal(date);
    },
  });
  registerWeekView({ selectDate });
  // Restored now that there is more than one view to restore. Month is still not
  // registered, and a stored preference naming it would leave a blank app.
  setActiveView(hasView(state.ui.activeView) ? state.ui.activeView : 'day');
```

Add `renderWeek` to the renderers, next to `renderTimeline`:

```js
  registerRenderer(renderTimeline);
  registerRenderer(renderWeek);
```

Add the week controls to the wiring block, after `wireDayView()`:

```js
  wireWeekControls({ onZoom: (step) => changeZoom(step) });
```

Fold the two zoom buttons into one function so both headers stay in step:

```js
function updateZoomLabel() {
  const label = `${ZOOM_LEVELS[state.ui.zoomIdx] ?? 1}×`;
  $('zoom-lbl').textContent = label;
  $('week-zoom-lbl').textContent = label;
}

/** One zoom for both views: the week is as tall as the day at the same setting. */
async function changeZoom(step) {
  const next = state.ui.zoomIdx + step;
  if (next < 0 || next > ZOOM_LEVELS.length - 1) return;
  await saveUi({ zoomIdx: next });
  updateZoomLabel();
  renderAll();
}
```

and in `wireDayView`, replace the two zoom listeners with `changeZoom(1)` / `changeZoom(-1)`, and set the week's zoom icon beside the day's:

```js
  $('zoom-icon').innerHTML = ZOOM_ICON;
  $('week-zoom-icon').innerHTML = ZOOM_ICON;

  $('zoom-in').addEventListener('click', () => changeZoom(1));
  $('zoom-out').addEventListener('click', () => changeZoom(-1));
```

In `selectDate`, replace the trailing `refreshExternal(date)` with the view's own load:

```js
  renderAll();

  // Which days have to be read depends on the view: one for the day view, the whole
  // week for the week view. Asked of the view rather than branched on here, so this
  // function does not learn about a view every time one is added.
  notifyDayChange(date);
```

with `notifyDayChange` added to the `./shell.js` import.

Finally add the week's live totals to the tick:

```js
  onTick(() => {
    updateTotal();
    updateWeekLive();
    updateNowMarkers();
  });
```

- [ ] **Step 6: Tell the shell to pass the day on**

In `renderer/js/shell.js`, add:

```js
/**
 * Tell the mounted view the day changed, so it can read whatever days it draws.
 *
 * A hook rather than a branch in app.js: the day view wants one day's Jira-side rows
 * and the week view wants seven, and a third view will want something else again.
 */
export function notifyDayChange(date) {
  return views.get(activeId)?.onDayChange?.(date);
}
```

and call it from `setActiveView` after `next.mount()`, so a view switch loads what the new view needs:

```js
  activeId = id;
  next.mount();
```

Nothing more is needed there — the week view's `mount()` already loads its week, and the day view's day is already in `state.days`.

- [ ] **Step 7: Run the tests and the fast UI check**

Run: `npm test`
Expected: PASS, 319.

Run: `npm run uicheck:fast`
Expected: PASS **except** the two sidebar rows that assert the Week tab is disabled and that clicking it does nothing — 83 of 85, with those two failing. That is the change, not a regression; step 8 rewrites them.

- [ ] **Step 8: Rewrite the two sidebar checks, and add the week's own**

In `scripts/ui-check.mjs`, replace the `sidebar: week and month disabled` and `sidebar: clicking Week does nothing` checks with:

```js
  await check(
    'sidebar: month still disabled, "Not built yet"',
    `return JSON.stringify(H.all('.sidebar-item[data-view]')
       .filter(b => b.dataset.view === 'month')
       .map(b => ({ v: b.dataset.view, disabled: b.disabled, title: b.title })))`,
    (v) => JSON.parse(v).every((b) => b.disabled && b.title === 'Not built yet'),
  );

  await check(
    'sidebar: Week mounts and Day comes back',
    `H.q('.sidebar-item[data-view="week"]').click();
     await H.until(() => !H.q('#view-week').hidden, 8000, 'the week view');
     const week = { active: H.q('.sidebar-item.is-active')?.dataset.view,
                    dayHidden: H.q('#view-day').hidden,
                    omnibarInWeek: !!H.q('#week-topbar #task-input') };
     H.q('.sidebar-item[data-view="day"]').click();
     await H.until(() => !H.q('#view-day').hidden, 8000, 'the day view');
     return JSON.stringify({ ...week, backToDay: !!H.q('.left-panel > .omnibar #task-input'),
                             weekHidden: H.q('#view-week').hidden })`,
    (v) => {
      const d = JSON.parse(v);
      return d.active === 'week' && d.dayHidden && d.omnibarInWeek && d.backToDay && d.weekHidden;
    },
  );
```

Add a `weekView()` section, and call it from `runChecks` after `sidebar()`:

```js
async function weekView() {
  // Every check here leaves the app back on the day view, so nothing after this
  // section has to know the week view exists.
  const inWeek = (js) => `
    H.q('.sidebar-item[data-view="week"]').click();
    await H.until(() => !H.q('#view-week').hidden, 8000, 'the week view');
    await H.settle();
    try { ${js} } finally {
      H.q('.sidebar-item[data-view="day"]').click();
      await H.until(() => !H.q('#view-day').hidden, 8000, 'the day view');
    }`;

  await check(
    'week: five columns by default, Monday first',
    inWeek(`return JSON.stringify(H.all('.week-colhead').map(h => h.querySelector('.week-colhead-day').textContent));`),
    (v) => {
      const heads = JSON.parse(v);
      return heads.length >= 5 && heads[0].startsWith('Mon') && heads[4].startsWith('Fri');
    },
  );

  await check(
    'week: the 5|7 toggle shows the weekend, and sticks',
    inWeek(`H.q('#week-7').click();
            await H.until(() => H.all('.week-colhead').length === 7, 4000, 'seven columns');
            const seven = H.all('.week-colhead').length;
            const active = H.q('#week-7').classList.contains('is-active');
            const stored = (await window.joggl.ui.get()).weekSevenDay;
            H.q('#week-5').click();
            await H.until(() => H.all('.week-colhead').length <= 6, 4000, 'back to five');
            return JSON.stringify({ seven, active, stored, back: H.all('.week-colhead').length });`),
    (v) => {
      const d = JSON.parse(v);
      return d.seven === 7 && d.active && d.stored === true && d.back <= 6;
    },
  );

  await check(
    'week: the stepper names the ISO week and stops at this one',
    inWeek(`const here = H.q('#week-label').textContent;
            const stuck = H.q('#next-week').disabled;
            H.q('#prev-week').click();
            await H.until(() => H.q('#week-label').textContent !== here, 8000, 'the week to step');
            await H.settle();
            const back = H.q('#week-label').textContent;
            const open = !H.q('#next-week').disabled;
            H.q('#next-week').click();
            await H.until(() => H.q('#week-label').textContent === here, 8000, 'the week to come back');
            await H.settle();
            return JSON.stringify({ here, back, stuck, open });`),
    (v) => {
      const d = JSON.parse(v);
      return d.stuck && d.open && d.back !== d.here && /· week \\d+/.test(d.here);
    },
  );

  await check(
    'week: every column shares one hour range',
    inWeek(`const tops = H.all('.week-col').map(c => Math.round(c.getBoundingClientRect().top));
            const heights = H.all('.week-col').map(c => Math.round(c.getBoundingClientRect().height));
            return JSON.stringify({ tops: [...new Set(tops)].length, heights: [...new Set(heights)].length });`),
    (v) => {
      const d = JSON.parse(v);
      return d.tops === 1 && d.heights === 1;
    },
  );

  await check(
    'week: today is marked, and the anchor column is the selected one',
    inWeek(`return JSON.stringify({
              today: H.all('.week-colhead.is-today').length,
              selected: H.all('.week-colhead.is-selected').length,
            });`),
    (v) => {
      const d = JSON.parse(v);
      return d.today === 1 && d.selected === 1;
    },
  );
}
```

Register it in `runChecks`:

```js
    await sidebar();
    await weekView();
```

- [ ] **Step 9: Add the checklist rows**

In `test-and-issues.md`, rewrite the two Sidebar rows and add a Week view section after *On this day*:

```markdown
| Click Month View | Nothing happens. It is dimmed and says "Not built yet" on hover. |
| Click Week View | The week view opens. The search box and the pins move to the top of it; the issue list and **On this day** are not in this view. Click Day View — everything is back where it was. |
```

```markdown
### Week view

| Do this | Correct result |
|---|---|
| Open the week view | Five columns, Monday to Friday, with the weekday and date in each head and that day's total on the right. Today's column is marked. |
| Click **7** | Saturday and Sunday appear. Click **5** — they go again. Quit and restart: the choice is remembered. |
| Put time on a Saturday, then click **5** | Saturday stays on screen. Time that cannot be seen is time that never gets synced. |
| Read the week label | `27 Jul – 2 Aug · week 31`. The year appears only on a week whose ISO week-year is not its Monday's — `29 Dec – 4 Jan · week 1 of 2026`. |
| Click **‹** and **›** | A week back and forward. **›** is dimmed on the week holding today. |
| Press Page Up and Page Down | The same, from the keyboard. `[` and `]` still step a single day, moving the marked column and, at the ends, the week. |
| Look across the columns | The hours line up: one range for the whole week, widened to cover whatever is logged on any day of it. |
| Zoom in and out | Both views share the setting — set it here, go to the day view, and it is the same. |
```

- [ ] **Step 10: Run the fast UI check again**

Run: `npm run uicheck:fast`
Expected: PASS, 88 of 88 (85 − 1 removed + 4 added).

- [ ] **Step 11: Commit**

```bash
git add renderer/js/week-view.js renderer/js/app.js renderer/js/shell.js renderer/index.html renderer/css/app.css main/settings.js scripts/ui-check.mjs test-and-issues.md
git commit -m "Draw the week"
```

---

## Task 4: Everything a column can do

The blocks already carry their own listeners — `paintDayColumn` builds them with `buildBlock`, so select, double-click, right-click, resize and move come free the moment a column is drawn. What is left is the two gestures that reach the grid rather than a block: clicking an empty hour, and dropping something onto it.

**Files:**
- Modify: `renderer/js/drag-drop.js`
- Modify: `renderer/js/timeline.js` (`onGridClick` ignores a sticky column head)
- Modify: `renderer/js/week-view.js` (the grid click listener)
- Modify: `renderer/js/app.js` (`reloadDay` covers the days on screen)
- Modify: `scripts/ui-check.mjs`, `test-and-issues.md`

**Interfaces:**
- Consumes: `columnAt` from `timeline-columns.js`; `showDropPlaceholder(startTs, endTs, dayKey)` from task 2.
- Produces: no new exports. `payloadFromEntryList` gains a `dayKey` field, which task 5 reads.

- [ ] **Step 1: A drop lands on the column it was released over**

In `renderer/js/drag-drop.js`, change the import and the three places that assumed one grid.

```js
import { columnAt } from './timeline-columns.js';
import { hideDropPlaceholder, showDropPlaceholder } from './timeline.js';
```

`gridTimeAt` is no longer imported here. It stays exported from `timeline.js` — it is the single-day form and the checklist still names it — but this module now asks the fuller question.

The live drag's comment and the preview:

```js
/**
 * A live drag: { payload, ghost, at, clientX, clientY, scrollFrame }.
 *
 * `at` is `columnAt`'s answer — `{ dateKey, ts }` or null — so the drop knows which
 * day it landed on and not merely what time. Both coordinates are stored because
 * autoScroll re-resolves it when the panel scrolls under a cursor that has not moved.
 */
let drag = null;
```

```js
function updatePreview(clientX, clientY) {
  const at = columnAt(clientX, clientY);
  drag.at = at;

  if (at === null) {
    hideDropPlaceholder();
    return;
  }

  // Clamped through the same helper the drop uses, so the preview is exactly what
  // committing would produce rather than a second guess at the same rule. Against
  // the target column's own midnight, never the selected day's.
  const start = clampDropStart(at.ts, startOfDayMs(at.dateKey), drag.payload.durationMs);
  showDropPlaceholder(start, start + drag.payload.durationMs, at.dateKey);
}
```

```js
  drag = { payload, ghost, at: null, clientX: 0, clientY: 0, scrollFrame: 0 };
```

- [ ] **Step 2: Auto-scroll whichever panel is under the drag**

Still in `drag-drop.js`, add above `autoScroll` and use it in place of the two `getElementById('right-panel')` reads:

```js
/**
 * The scroll container the drag is over — the day view's panel, or the week's grid.
 *
 * Asked by which view is mounted rather than by hit-testing: at the moment the
 * cursor is over the task list, no column is under it at all, and the whole point of
 * the auto-scroll band is to work from outside the panel.
 */
function scrollHost() {
  const week = document.getElementById('view-week');
  if (week && !week.hidden) return document.getElementById('week-scroll');
  return document.getElementById('right-panel');
}
```

```js
function autoScroll() {
  if (!drag) return; // the drag is over — this is the genuine terminator.
  drag.scrollFrame = requestAnimationFrame(autoScroll);

  const panel = scrollHost();
  if (!panel) return;
  …
```

- [ ] **Step 3: Commit the drop against the column's day**

Replace the body of `onMouseUp` from `const { payload, startTs } = drag;` down:

```js
  const { payload, at } = drag;
  teardown();
  swallowUntil = Date.now() + SWALLOW_MS;

  // Released somewhere no column covers: cancel, quietly.
  if (at === null) return;

  // The day the drop landed on — the column's, not the one that happens to be
  // selected. Read once, so the write below cannot be redirected by a day change.
  const day = at.dateKey;
  const dayStartTs = startOfDayMs(day);

  if (payload.kind === 'entry') {
    const source = payload.dayKey ?? state.selectedDate;
    const entry = entriesFor(source).find((e) => e.id === payload.entryId);
    // It could have been deleted, or the day changed, while the drag was running.
    if (!entry) return;
    // Dropping a row from "On this day" onto another day is unreachable today — that
    // list only exists in the day view, which draws one column. Task 5 gives this
    // branch its move; until then, refusing beats writing the entry onto a day and
    // leaving it on the one it came from as well.
    if (day !== source) return;
    const moved = movedEntry(entry, at.ts, dayStartTs);
    // Dropped back where it started: not a move, so do not mark it as needing a
    // re-sync. Same reason commitDrag checks.
    if (sameTimes(moved, entry)) return;
    // A move needs syncing again for exactly the reason a block drag does.
    markDirty(moved);
    setEntriesFor(source, entriesFor(source).map((e) => (e.id === moved.id ? moved : e)));
  } else {
    setEntriesFor(day, [
      ...entriesFor(day),
      dropEntryFor(payload.issue, uuid(), at.ts, dayStartTs),
    ]);
  }

  await persistDayNow(day);
  renderAll();
}
```

and record the source day when the gesture starts, in `payloadFromEntryList`:

```js
  return {
    kind: 'entry',
    entryId: entry.id,
    // The day this row belongs to, fixed at mousedown. The drop may land days away.
    dayKey: state.selectedDate,
    label: entry.title,
    key: entry.issueKey,
    durationMs: entry.endTs - entry.startTs,
  };
```

- [ ] **Step 4: Make the omnibar's results a drag source**

With no issue list in the week view, the omnibar is how an issue that is not pinned gets onto a day. Add to `drag-drop.js`, beside the other three:

```js
/**
 * A result row in the omnibar's dropdown.
 *
 * The row's own mousedown picks the issue and hides the list, which is what a click
 * there has always meant; the drag continues regardless, because `begin` captured
 * the payload before the list went away and the ghost is ours.
 */
function payloadFromDropdown(target) {
  const row = target.closest('.task-dd-item');
  if (!row?.dataset.issue) return null;
  const issue = JSON.parse(row.dataset.issue);
  return { kind: 'issue', issue, label: issue.title, key: issue.issueKey, durationMs: DEFAULT_DROP_MS };
}

const SOURCES = [
  ['task-list', payloadFromTaskList],
  ['pin-chips', payloadFromPins],
  ['entry-list', payloadFromEntryList],
  ['task-dropdown', payloadFromDropdown],
];
```

- [ ] **Step 5: A click on a sticky column head is not a click on an hour**

In `renderer/js/timeline.js`, add to the top of `onGridClick`:

```js
export function onGridClick(event) {
  if (event.target.closest('.sched-entry-block') || event.target.closest('.sched-handle')) return;
  // The week's column heads are sticky, so once the grid is scrolled they sit *over*
  // the top of their own column: a click on one is inside the column's rect, and
  // without this it would open the quick-entry popup at whatever hour is hidden
  // beneath the head.
  if (event.target.closest('.week-colhead')) return;
```

- [ ] **Step 6: Wire the week's grid**

In `renderer/js/week-view.js`, import `onGridClick` alongside `paintDayColumn` and add to `wireWeekControls`:

```js
  // Clicking an empty hour, in whichever column it was: onGridClick asks columnAt,
  // so it writes to the day the click landed in and not the day that is selected.
  $('week-scroll').addEventListener('click', onGridClick);
```

- [ ] **Step 7: Let the test hook reload every day on screen**

In `renderer/js/app.js`, `installTestHook`'s `reloadDay` currently re-reads the selected day. In the week view five to seven days are on screen, and a check that writes to one of them would see nothing change.

```js
    /**
     * Re-read the day logs on screen and repaint, **without** touching Jira.
     *
     * Every day drawn, not just the selected one: the week view has five to seven on
     * screen, and a check that clears one of the others would otherwise see the old
     * rows for the rest of the run. Deliberately not `selectDate` — that is a day
     * *change*, which clears the selection and asks Jira for rows the harness
     * already has and never invalidates.
     */
    async reloadDay() {
      for (const key of new Set([state.selectedDate, ...weekAnchorDays()])) {
        const day = await window.joggl.days.get(key);
        setEntriesFor(key, day.entries);
      }
      renderAll();
    },
```

with `weekAnchorDays` added to the `./week-view.js` import.

- [ ] **Step 8: Run the tests and the fast UI check**

Run: `npm test`
Expected: PASS, 319.

Run: `npm run uicheck:fast`
Expected: PASS, 88 of 88.

- [ ] **Step 9: Add the checks**

In `scripts/ui-check.mjs`, add to the `HELPERS` block, beside `resetDay`:

```js
  /** Empty some days and repaint, for the week checks that write to more than one. */
  async clearDays(keys) {
    for (const key of keys) await window.joggl.days.save(key, []);
    await window.__jogglTest.reloadDay();
  },
  /** The day key a week column stands for. */
  colDay(index) {
    return H.all('.week-colhead')[index]?.dataset.day ?? null;
  },
```

and to `weekView()`:

```js
  await check(
    'week: a pin dropped on a column lands on that column’s day',
    inWeek(`await H.clearPins();
            H.q('#add-pin-btn').click(); await H.sleep(200);
            H.q('#pin-results .task-dd-item button')?.click(); await H.sleep(250);
            H.q('#close-pin').click(); await H.sleep(150);
            const chip = H.q('.pin-chip');
            const col = H.all('.week-col')[1], day = H.colDay(1);
            const box = col.getBoundingClientRect();
            const y = Math.round(box.top + 120);
            H.drag(chip, Math.round(box.left + box.width / 2), y);
            await H.sleep(400);
            const made = (await window.joggl.days.get(day)).entries.length;
            const elsewhere = (await window.joggl.days.get(H.colDay(0))).entries.length;
            await H.clearDays([day, H.colDay(0)]);
            await H.clearPins();
            return JSON.stringify({ made, elsewhere });`),
    (v) => {
      const d = JSON.parse(v);
      return d.made === 1 && d.elsewhere === 0;
    },
  );

  await check(
    'week: clicking an empty hour opens the popup for that column’s day',
    inWeek(`const col = H.all('.week-col')[2], day = H.colDay(2);
            const box = col.getBoundingClientRect();
            H.mouse(col, 'click', Math.round(box.left + box.width / 2), Math.round(box.top + 160));
            await H.until(() => !!H.q('.sched-quick-entry'), 4000, 'the quick-entry popup');
            const input = H.q('.sched-quick-entry input');
            input.value = 'week popup entry';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await H.sleep(250);
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await H.until(() => !H.q('.sched-quick-entry'), 4000, 'the popup to close');
            await H.sleep(200);
            const made = (await window.joggl.days.get(day)).entries.map(e => e.title);
            await H.clearDays([day]);
            return JSON.stringify({ made });`),
    (v) => JSON.parse(v).made.length === 1,
  );

  await check(
    'week: a block selects, and its menu opens',
    inWeek(`const day = H.colDay(1);
            await window.joggl.days.save(day, [{
              id: 'wk-sel-1', issueKey: 'GEN-1', issueId: null, title: 'Selectable',
              startTs: new Date(day + 'T10:00:00').getTime(),
              endTs: new Date(day + 'T11:00:00').getTime(),
              status: 'pending', worklogId: null, comment: null, errorMsg: null,
            }]);
            await window.__jogglTest.reloadDay();
            await H.until(() => !!H.q('.week-col [data-id="wk-sel-1"]'), 4000, 'the block');
            const block = H.q('.week-col [data-id="wk-sel-1"]');
            H.click(block);
            const selected = block.classList.contains('is-selected');
            block.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
            await H.until(() => !H.q('#ctx-menu').classList.contains('hidden'), 4000, 'the menu');
            const items = H.all('#ctx-menu .ctx-item').length;
            H.q('#ctx-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await H.clearDays([day]);
            return JSON.stringify({ selected, items });`),
    (v) => {
      const d = JSON.parse(v);
      return d.selected && d.items === 6;
    },
  );
```

- [ ] **Step 10: Add the checklist rows**

Append to the **Week view** table in `test-and-issues.md`:

```markdown
| Drag a pin onto Wednesday's column | A half-hour block appears on Wednesday, where the preview said — not on the day the day view had selected. |
| Type in the search box and drag a result onto a column | The same. The result rows are draggable; this is how an issue that is not pinned gets onto a day here. |
| Click an empty hour in any column | The quick-entry popup opens, and what it creates lands on **that** column's day. |
| Scroll the week down, then click a column head | Nothing is created. The heads sit over their own columns once scrolled, and a click on one only marks the day. |
| Click a block, double-click it, right-click it | Select, work description, the full menu — the same as the day view, because it is the same code. |
| Drag a block's edges | Resize, snapping to the quarter hour and to its own day's neighbours. |
```

- [ ] **Step 11: Run the fast UI check**

Run: `npm run uicheck:fast`
Expected: PASS, 91 of 91.

- [ ] **Step 12: Commit**

```bash
git add renderer/js/drag-drop.js renderer/js/timeline.js renderer/js/week-view.js renderer/js/app.js scripts/ui-check.mjs test-and-issues.md
git commit -m "Give every column the gestures the day view has"
```

---

## Task 5: Dragging between days

The reason phase 2 existed. A block dragged out of one column and into another leaves one day log and joins another, in one commit.

**Files:**
- Create: `renderer/js/cross-day.js`
- Modify: `renderer/js/entry-ops.js` (`dirtiedEntry`)
- Modify: `renderer/js/entries.js` (`markDirty` becomes its wrapper)
- Modify: `renderer/js/timeline-drag.js` (`onMoveBlock` resolves a column)
- Modify: `renderer/js/drag-drop.js` (the deferred branch from task 4)
- Test: `test/cross-day-move.test.js`
- Modify: `scripts/ui-check.mjs`, `test-and-issues.md`

**Interfaces:**
- Consumes: `movedEntry`, `sameTimes` from `entry-ops.js`; `columnAt`, `columnFor` from `timeline-columns.js`; `entriesFor`, `setEntriesFor`, `persistDayNow` from `state.js`.
- Produces:
  - `dirtiedEntry(entry) -> entry` (pure; `entry-ops.js`)
  - `canCrossDays(entry) -> boolean` (`cross-day.js`)
  - `crossDayMove({ entry, fromEntries, toEntries, toDayStartMs, startTs }) -> { from, to, moved }`

- [ ] **Step 1: Write the failing test**

Create `test/cross-day-move.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canCrossDays, crossDayMove } from '../renderer/js/cross-day.js';
import { startOfDayMs } from '../renderer/js/util.js';

const at = (dayKey, hh, mm = 0) => startOfDayMs(dayKey) + hh * 3_600_000 + mm * 60_000;

function entry(overrides = {}) {
  return {
    id: 'e1',
    issueKey: 'GEN-1',
    issueId: null,
    title: 'Standup',
    startTs: at('2026-07-28', 9),
    endTs: at('2026-07-28', 10),
    status: 'pending',
    worklogId: null,
    comment: null,
    errorMsg: null,
    ...overrides,
  };
}

test('an entry leaves one day log and joins the other', () => {
  const moving = entry();
  const other = entry({ id: 'e2' });
  const { from, to, moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving, other],
    toEntries: [],
    toDayStartMs: startOfDayMs('2026-07-30'),
    startTs: at('2026-07-30', 9),
  });

  assert.deepEqual(from.map((e) => e.id), ['e2'], 'gone from the day it left');
  assert.deepEqual(to.map((e) => e.id), ['e1'], 'and only on the one it joined');
  assert.equal(moved.startTs, at('2026-07-30', 9));
  assert.equal(moved.endTs, at('2026-07-30', 10), 'the same length');
});

test('a synced entry keeps its worklogId and goes back to pending', () => {
  const moving = entry({ status: 'synced', worklogId: '60504' });
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs: startOfDayMs('2026-07-30'),
    startTs: at('2026-07-30', 9),
  });

  // The issue has not changed — only when the work started — so the id stays valid
  // and the next Sync rewrites that worklog with PUT rather than posting a second.
  assert.equal(moved.worklogId, '60504');
  assert.equal(moved.status, 'pending');
  assert.equal(moved.errorMsg, null);
});

test('an entry with no issue key lands local, not pending', () => {
  const moving = entry({ issueKey: null, status: 'local' });
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs: startOfDayMs('2026-07-30'),
    startTs: at('2026-07-30', 9),
  });
  assert.equal(moved.status, 'local');
});

test('a Jira-side row is not Joggl’s to move', () => {
  assert.equal(canCrossDays(entry({ external: true })), false);
  assert.equal(canCrossDays(entry()), true);
});

/**
 * The autumn clock change makes one day 25 hours long. Measured as an offset from
 * the *target* day's own midnight, an entry keeps the time it says on the clock; as
 * a fixed number of milliseconds it would quietly claim the work happened an hour
 * earlier. Asserted as an offset so this holds in any timezone, including one with
 * no clock change at all.
 */
test('the time on the clock survives a move across a clock change', () => {
  const moving = entry({
    startTs: at('2026-10-24', 9),
    endTs: at('2026-10-24', 10, 30),
  });
  const toDayStartMs = startOfDayMs('2026-10-25');
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs,
    startTs: toDayStartMs + 9 * 3_600_000,
  });

  assert.equal(moved.startTs - toDayStartMs, 9 * 3_600_000, '09:00 on the day it landed');
  assert.equal(moved.endTs - moved.startTs, 90 * 60_000, 'still an hour and a half');
});

test('an entry dropped past the end of the target day is pulled back, not shortened', () => {
  const moving = entry({
    startTs: at('2026-07-28', 23),
    endTs: at('2026-07-28', 23, 45),
  });
  const toDayStartMs = startOfDayMs('2026-07-30');
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs,
    startTs: toDayStartMs + 86_400_000 - 15 * 60_000,
  });
  assert.equal(moved.endTs - moved.startTs, 45 * 60_000, 'the length is untouched');
  assert.equal(moved.endTs, toDayStartMs + 86_400_000, 'and it ends on midnight');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/cross-day.js'`.

- [ ] **Step 3: Make the re-sync rule pure**

In `renderer/js/entry-ops.js`, add:

```js
/**
 * The entry, marked as needing to reach Jira again.
 *
 * The rule `markDirty` has always applied, pulled out of `entries.js` so a move that
 * changes day can be tested without a DOM. The worklogId is deliberately kept: an
 * entry edited after syncing is *rewritten* with `PUT .../worklog/{id}`, never posted
 * a second time. A Jira-side row is returned untouched — it is not Joggl's record.
 */
export function dirtiedEntry(entry) {
  if (entry?.external) return entry;
  if (!entry?.issueKey) return { ...entry, status: 'local', errorMsg: null };
  if (entry.status === 'synced' || entry.status === 'error') {
    return { ...entry, status: 'pending', errorMsg: null };
  }
  return entry;
}
```

and in `renderer/js/entries.js` replace `markDirty`'s body, keeping the name and its mutating contract — half a dozen call sites rely on it changing the object they hold:

```js
/** The mutating form of `dirtiedEntry`, which is where the rule itself lives. */
export function markDirty(entry) {
  Object.assign(entry, dirtiedEntry(entry));
}
```

with `dirtiedEntry` added to the `./entry-ops.js` import. Leave `isExternal` alone — it has other callers.

- [ ] **Step 4: Write the module**

Create `renderer/js/cross-day.js`:

```js
// Moving one entry from one day log to another.
//
// Pure — no DOM, no IPC — because this is the one gesture that writes two day logs
// at once, and getting it half done means an entry on both days or on neither.
//
// A **synced** entry may cross days. Its worklogId stays valid because the issue has
// not changed, only when the work started, so it returns to `pending` and the next
// Sync rewrites the worklog with PUT — exactly as a move within a day already does.
// This is not the case retargeting refuses; that one changes the issue, and a worklog
// id is only valid on the issue it was created against.

import { dirtiedEntry, movedEntry } from './entry-ops.js';

/** A Jira-side row is not Joggl's to move. Everything else may cross. */
export function canCrossDays(entry) {
  return !entry?.external;
}

/**
 * The two day logs after an entry moves between them.
 *
 * `startTs` is already on the target day and already snapped — the gesture decided
 * it, against that day's own midnight. `movedEntry` only keeps the length and clamps
 * the block inside the day, which is the same rule every drop uses.
 *
 * @returns {{from: object[], to: object[], moved: object}}
 */
export function crossDayMove({ entry, fromEntries, toEntries, toDayStartMs, startTs }) {
  const moved = dirtiedEntry(movedEntry(entry, startTs, toDayStartMs));
  return {
    from: (fromEntries ?? []).filter((e) => e.id !== entry.id),
    to: [...(toEntries ?? []), moved],
    moved,
  };
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npm test`
Expected: PASS — 325.

- [ ] **Step 6: Let a move gesture change column**

In `renderer/js/timeline-drag.js`, add the imports:

```js
import { canCrossDays, crossDayMove } from './cross-day.js';
import { entriesFor, persistDayNow, setEntriesFor, state, visibleEntriesFor } from './state.js';
import { columnAt, columnFor } from './timeline-columns.js';
import { addDays, msToDur, QUARTER, snapToQuarter, startOfDayMs, tsToHHMM } from './util.js';
```

and replace `onMoveBlock`'s gesture body:

```js
export function onMoveBlock(event, entry, dayKey) {
  event.preventDefault();
  event.stopPropagation();
  if (locked(entry)) return;

  const origStart = entry.startTs;
  const duration = entry.endTs - origStart;
  const startY = event.clientY;
  // What the entry says on the clock, as an offset from its own day's midnight. A
  // move to another column keeps that offset and adds the drag; a fixed number of
  // milliseconds would shift the block by an hour across a clock change.
  const offset = origStart - startOfDayMs(dayKey);
  const block = document.querySelector(`.sched-entry-block[data-id="${CSS.escape(entry.id)}"]`);
  block?.classList.add('dragging', 'moving');
  let targetDay = dayKey;
  let moved = false;

  const onMouseMove = (move) => {
    const deltaMs = ((move.clientY - startY) / grid.pxPerMin) * 60_000;

    // Which column the cursor is over answers *which day*; the vertical delta answers
    // *what time*. With one column this is exactly what it always did. A cursor that
    // has wandered off every column keeps the day it last had, rather than snapping
    // the block back to where it started.
    const day = columnAt(move.clientX, move.clientY)?.dateKey ?? targetDay;
    const dayStart = startOfDayMs(day);
    const dayEnd = startOfDayMs(addDays(day, 1));

    // Moving keeps the length and snaps the start to the clock grid, so a 47-minute
    // entry stays 47 minutes but always begins on a quarter hour.
    let start = snapToQuarter(dayStart + offset + deltaMs, day);
    let end = start + duration;

    if (start < dayStart) {
      start = dayStart;
      end = start + duration;
    }
    // addDays, not a constant: the autumn clock change makes one day 25 hours, and
    // adding 86,400,000 would cut its last hour off a moment before midnight.
    if (end > dayEnd) {
      end = dayEnd;
      start = end - duration;
    }

    if (day !== targetDay) {
      targetDay = day;
      // The block has to live in the column it is being dropped into, or it would
      // hang over the day it left while claiming to be on another.
      columnFor(day)?.appendChild(block);
    }

    // Snapping means most small movements change nothing, and a gesture that never
    // changed the start *or the day* is exactly what a plain click is.
    if (start !== origStart || targetDay !== dayKey) moved = true;

    entry.startTs = start;
    entry.endTs = end;
    liveUpdate(block, entry, targetDay);
  };

  const onMouseUp = async () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    block?.classList.remove('dragging', 'moving');
    if (moved) suppressClickUntil = Date.now() + CLICK_TAIL_MS;

    if (targetDay !== dayKey) {
      await commitCrossDay(entry, dayKey, targetDay);
      return;
    }
    await commitDrag(
      entry,
      dayKey,
      { startTs: origStart, endTs: origStart + duration },
      { touched: moved },
    );
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

/**
 * End of a move that changed column.
 *
 * Two day logs, written one after the other. Both names are fixed before the first
 * await, and neither is `state.selectedDate` — in the week view the day on screen is
 * usually neither of them.
 */
async function commitCrossDay(entry, fromDay, toDay) {
  if (!canCrossDays(entry)) return;

  const { from, to } = crossDayMove({
    entry,
    fromEntries: entriesFor(fromDay),
    toEntries: entriesFor(toDay),
    toDayStartMs: startOfDayMs(toDay),
    startTs: entry.startTs,
  });

  setEntriesFor(fromDay, from);
  setEntriesFor(toDay, to);
  await persistDayNow(fromDay);
  await persistDayNow(toDay);
  renderAll();
}
```

- [ ] **Step 7: The same for a row dragged out of the entry list**

In `renderer/js/drag-drop.js`, replace task 4's deferred refusal:

```js
    if (day !== source) {
      const { from, to } = crossDayMove({
        entry,
        fromEntries: entriesFor(source),
        toEntries: entriesFor(day),
        toDayStartMs: dayStartTs,
        startTs: at.ts,
      });
      setEntriesFor(source, from);
      setEntriesFor(day, to);
      await persistDayNow(source);
      await persistDayNow(day);
      renderAll();
      return;
    }
```

with `import { crossDayMove } from './cross-day.js';` added.

- [ ] **Step 8: Run everything**

Run: `npm test`
Expected: PASS, 325.

Run: `npm run uicheck:fast`
Expected: PASS, 91 of 91 — the day view has one column, so no move can change day there, and every existing drag check must still pass unchanged.

- [ ] **Step 9: Add the check**

In `scripts/ui-check.mjs`, add to `weekView()`:

```js
  await check(
    'week: a block dragged to another column changes day, and only once',
    inWeek(`const from = H.colDay(0), to = H.colDay(2);
            await window.joggl.days.save(from, [{
              id: 'wk-move-1', issueKey: 'GEN-1', issueId: null, title: 'Travelling',
              startTs: new Date(from + 'T10:00:00').getTime(),
              endTs: new Date(from + 'T11:00:00').getTime(),
              status: 'synced', worklogId: '99001', comment: null, errorMsg: null,
            }]);
            await window.__jogglTest.reloadDay();
            await H.until(() => !!H.q('.week-col [data-id="wk-move-1"]'), 4000, 'the block');
            const target = H.all('.week-col')[2].getBoundingClientRect();
            H.drag(H.q('.week-col [data-id="wk-move-1"]'),
                   Math.round(target.left + target.width / 2),
                   Math.round(target.top + 200));
            await H.sleep(500);
            const left = (await window.joggl.days.get(from)).entries.length;
            const landed = (await window.joggl.days.get(to)).entries;
            await H.clearDays([from, to]);
            return JSON.stringify({
              left,
              landed: landed.length,
              worklogId: landed[0]?.worklogId ?? null,
              status: landed[0]?.status ?? null,
            });`),
    (v) => {
      const d = JSON.parse(v);
      return d.left === 0 && d.landed === 1 && d.worklogId === '99001' && d.status === 'pending';
    },
  );
```

- [ ] **Step 10: Add the checklist rows**

Append to the **Week view** table:

```markdown
| Drag a block from Monday's column onto Thursday's | It moves. Monday no longer has it, Thursday does, at the time the preview showed. |
| Drag a **synced** block to another day | It moves and goes back to ● pending. Sync then *rewrites* that worklog rather than logging a second one — the issue has not changed, only when the work started. |
| Drag a **Manual Jira entry** anywhere | It refuses, with the message it already gives. It is not Joggl's to move. |
| Drag a block out of a column and release over the header | It stays on the last column it was over. Nothing is created on a day the cursor never entered. |
```

- [ ] **Step 11: Commit**

```bash
git add renderer/js/cross-day.js renderer/js/entry-ops.js renderer/js/entries.js renderer/js/timeline-drag.js renderer/js/drag-drop.js test/cross-day-move.test.js scripts/ui-check.mjs test-and-issues.md
git commit -m "Move an entry between days in one gesture"
```

---

## Task 6: Sync the week

One button, the same bookkeeping. The per-day sync runs over the visible days in turn; successes keep `synced` and their `worklogId`, failures get `error` and a message, no automatic retry, one summary at the end with **Retry failed**.

> **Never press this button from a script.** Not in the fast run either. The checks in this task read the label and the disabled state from a seeded store and stop there.

**Files:**
- Modify: `renderer/js/finish-day.js` (a `verb` override)
- Modify: `renderer/js/sync.js` (`syncDays` over any number of days)
- Modify: `renderer/js/week-view.js` (the week's button label)
- Modify: `renderer/js/app.js` (wires the button; the day handler loses its manual cache work)
- Test: `test/finish-day.test.js`
- Modify: `scripts/ui-check.mjs`, `test-and-issues.md`

**Interfaces:**
- Consumes: `planFinishDay`, `runFinishDay`, `nothingToSync`, `syncLabel`, `syncTooltip`, `resetFailedForRetry`; `notifyDayChange` from `shell.js`.
- Produces:
  - `syncLabel(plan, { …, verb?: string })`
  - `finishDay()` — unchanged signature, still the day on screen
  - `syncWeek(days: string[])`
  - `isSyncRunning() -> boolean`
  - `updateWeekSyncButton()` (`week-view.js`, called at the end of `renderWeek`)

- [ ] **Step 1: Write the failing label test**

Append to `test/finish-day.test.js`:

```js
test('a caller can name the verb, for a button that is not about one day', () => {
  const plan = planFinishDay([
    { id: 'a', issueKey: 'GEN-1', startTs: 0, endTs: 3_600_000, status: 'pending' },
    { id: 'b', issueKey: 'GEN-2', startTs: 0, endTs: 1_800_000, status: 'pending' },
  ]);
  assert.equal(syncLabel(plan, { verb: 'Sync week' }), 'Sync week · 2 entries, 1h 30m');
  // The verb does not override the day rule for callers that do not pass one.
  assert.equal(syncLabel(plan, { isToday: false }), 'Re-sync · 2 entries, 1h 30m');
});

test('nothing to sync outranks the verb', () => {
  const plan = planFinishDay([{ id: 'a', issueKey: 'GEN-1', startTs: 0, endTs: 60_000, status: 'synced', worklogId: '1' }]);
  assert.equal(syncLabel(plan, { verb: 'Sync week' }), 'Nothing to sync');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `'Sync · 2 entries, 1h 30m' !== 'Sync week · 2 entries, 1h 30m'`.

- [ ] **Step 3: Add the verb**

In `renderer/js/finish-day.js`, extend `syncLabel`'s options and use the override:

```js
/**
 * …
 * `verb` is for a button that is not about one day — the week's, which cannot be
 * "Sync" or "Re-sync" because a week usually holds some of each.
 *
 * @param {ReturnType<planFinishDay>} plan
 * @param {{isToday?: boolean, busy?: boolean, done?: number, total?: number, verb?: string}} [opts]
 */
export function syncLabel(
  plan,
  { isToday = true, busy = false, done = null, total = null, verb = null } = {},
) {
  if (busy) return done === null ? 'Syncing…' : `Syncing ${done}/${total}…`;
  if (nothingToSync(plan)) return 'Nothing to sync';

  // Past days are a rewrite of a day already dealt with, and saying so is the only
  // warning that this is not the first time.
  const word = verb ?? (isToday ? 'Sync' : 'Re-sync');
  if (plan.toSubmit.length === 0) {
    return `${word} · ${plural(plan.toMarkLocal.length, 'local entry', 'local entries')}`;
  }

  const ms = plan.toSubmit.reduce((sum, e) => sum + Math.max(0, e.endTs - e.startTs), 0);
  return `${word} · ${plural(plan.toSubmit.length, 'entry', 'entries')}, ${msToDur(ms)}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — 327.

- [ ] **Step 5: Sync however many days there are**

Rewrite `renderer/js/sync.js` below `updateFinishButton`. The imports gain `invalidateExternal` and `notifyDayChange`:

```js
import { notifyDayChange } from './shell.js';
import {
  entriesFor, invalidateExternal, isToday, persistDayNow, setEntriesFor, state, submitWorklog,
} from './state.js';
```

```js
let running = false;

/** Whether a sync is in flight. The week's button reads it to disable itself. */
export function isSyncRunning() {
  return running;
}

export function updateFinishButton() {
  const button = document.getElementById('finish-day-btn');
  if (!button) return;

  const plan = planFinishDay(state.entries);
  button.textContent = syncLabel(plan, { isToday: isToday(), busy: running });
  button.title = syncTooltip(plan);
  // Disabled when there is nothing to do, so the day's state is legible from the
  // button alone rather than from pressing it and reading a toast.
  button.disabled = running || nothingToSync(plan);
}

/** Sync the day on screen. */
export function finishDay() {
  return syncDays([state.selectedDate], { isToday: isToday() });
}

/** Sync every day the week view is drawing. */
export function syncWeek(days) {
  return syncDays(days, { verb: 'Sync week' });
}

/**
 * The one path from Joggl to Jira, over one day or seven.
 *
 * Sequential on purpose: the partial-failure story is per entry, and a parallel run
 * would make "successful entries keep their worklogId, failures keep pending"
 * impossible to report honestly. The days are fixed before the first await — a sync
 * takes seconds, nothing suppresses the day shortcuts while it runs, and the results
 * belong to the days whose entries were submitted.
 */
async function syncDays(days, { verb = null, isToday: today = true } = {}) {
  if (running) return;

  const targets = [...new Set(days)].sort();
  const plan = planFinishDay(targets.flatMap((day) => entriesFor(day)));

  if (nothingToSync(plan)) {
    toast(
      plan.alreadySynced.length > 0
        ? 'Everything here is already in Jira.'
        : 'Nothing to sync.',
    );
    return;
  }

  if (plan.running.length > 0) {
    toastWarn('The running timer is not included — stop it first if you want it synced.');
  }

  if (plan.toSubmit.length > 0 && !state.settings.tokenConfigured) {
    toastWarn('Connect Joggl to Jira in Settings before syncing.');
    return;
  }

  running = true;
  renderAll();

  const submitted = [];
  const markedLocal = [];
  /** @type {{day: string, entry: object}[]} */
  const failed = [];
  let done = 0;

  try {
    for (const day of targets) {
      const result = await runFinishDay(entriesFor(day), submitWorklog, {
        onProgress: () => {
          done += 1;
          setBusyLabels(syncLabel(plan, { busy: true, done, total: plan.toSubmit.length }));
        },
      });

      setEntriesFor(day, result.entries);
      await persistDayNow(day);
      // What Jira holds for this day has just changed, so the cached rows are stale
      // by definition — Sync is the one thing that changes them.
      invalidateExternal(day);

      submitted.push(...result.submitted);
      markedLocal.push(...result.markedLocal);
      for (const entry of result.failed) failed.push({ day, entry });
    }

    if (markedLocal.length > 0) {
      toast(
        `${markedLocal.length} entr${markedLocal.length === 1 ? 'y' : 'ies'} ` +
          'without an issue key marked local — they count towards the total but never sync.',
      );
    }

    if (failed.length === 0) {
      if (submitted.length > 0) {
        const total = submitted.reduce((sum, e) => sum + (e.endTs - e.startTs), 0);
        toastOk(
          `${submitted.length} worklog${submitted.length === 1 ? '' : 's'} ` +
            `(${msToDur(total)}) logged to Jira.`,
        );
      }
      return;
    }

    await showFailureSummary({ submitted, failed }, { verb, isToday: today });
  } finally {
    running = false;
    renderAll();
    // Re-read whatever the mounted view draws: newly created worklogs are now
    // claimed by local entries, and the two views must not disagree about Jira.
    notifyDayChange(state.selectedDate);
  }
}

/** Both Sync buttons say the same thing while a run is in flight. */
function setBusyLabels(text) {
  for (const id of ['finish-day-btn', 'week-sync-btn']) {
    const button = document.getElementById(id);
    if (button) button.textContent = text;
  }
}
```

and the summary, which now knows which day each failure was on:

```js
// No automatic retry. The user sees exactly what failed and decides.
//
// The day is carried on each failure rather than read again: this modal stays open
// for as long as the user reads it, and a week's failures can span several days.
async function showFailureSummary({ submitted, failed }, options) {
  const days = [...new Set(failed.map((f) => f.day))];
  const body = document.createElement('div');
  const list = document.createElement('ul');
  list.className = 'fail-list';
  list.innerHTML = failed
    .map(
      ({ day, entry }) =>
        `<li><strong>${esc(entry.issueKey)}</strong> — ${esc(entry.title)} ` +
        `(${msToDur(entry.endTs - entry.startTs)})` +
        // Only when more than one day is in play; on a single day it is noise.
        `${days.length > 1 ? ` · ${esc(formatDateLabel(day))}` : ''}` +
        `<br><small>${esc(entry.errorMsg)}</small></li>`,
    )
    .join('');

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `${submitted.length} entr${submitted.length === 1 ? 'y' : 'ies'} reached Jira. ` +
    `${failed.length} did not, and ${failed.length === 1 ? 'it is' : 'they are'} ` +
    'still marked pending locally — nothing was logged twice.';

  body.append(lede, list);

  const answer = await askModal({
    title: `${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} failed to sync`,
    body,
    buttons: [
      { label: 'Close', value: 'close' },
      { label: 'Retry failed', value: 'retry', primary: true },
    ],
    dismissValue: 'close',
  });

  if (answer !== 'retry') return;

  for (const day of days) {
    setEntriesFor(day, resetFailedForRetry(entriesFor(day)));
    await persistDayNow(day);
  }
  renderAll();

  // running is still true here, so clear it before recursing into the next attempt.
  running = false;
  await syncDays(days, options);
}
```

with `formatDateLabel` added to the `./util.js` import.

- [ ] **Step 6: Label the week's button**

In `renderer/js/week-view.js`, import the pure planner and the running flag, and add:

```js
import { nothingToSync, planFinishDay, syncLabel, syncTooltip } from './finish-day.js';
import { isSyncRunning } from './sync.js';
```

```js
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
```

and call it from the end of `renderWeekHeader`:

```js
  $('week-total').textContent = `Total: ${msToDur(total)}`;
  updateWeekSyncButton();
```

`visibleEntriesFor(day).filter((e) => !e.external)` is `entriesFor(day)` by construction; it is written this way so the exclusion of Jira-side rows is visible at the point where somebody might otherwise add them.

- [ ] **Step 7: Wire the button, and simplify the day's**

In `renderer/js/app.js`:

```js
import { finishDay, syncWeek, updateFinishButton } from './sync.js';
```

```js
  $('finish-day-btn').addEventListener('click', () => finishDay());
```

The `invalidateExternal` / `refreshExternal` pair that used to follow it is gone — `syncDays` invalidates every day it touched and asks the mounted view to re-read, which is the same work done once for one day or seven. `invalidateExternal` stays imported in `app.js` for the ↻ Refresh button.

In `wireWeekControls`, add the week's:

```js
  $('week-sync-btn').addEventListener('click', () => onSync());
```

and pass it in from `app.js`:

```js
  wireWeekControls({
    onZoom: (step) => changeZoom(step),
    onSync: () => syncWeek(weekAnchorDays()),
  });
```

- [ ] **Step 8: Run everything**

Run: `npm test`
Expected: PASS, 327.

Run: `npm run uicheck:fast`
Expected: PASS, 91 of 91. The day view's Sync button label checks must be unchanged — `finishDay()` still plans over one day.

- [ ] **Step 9: Add the checks**

In `scripts/ui-check.mjs`, add to `weekView()`. Neither of these presses the button.

```js
  await check(
    'week: Sync counts the whole week, and says so',
    inWeek(`const a = H.colDay(0), b = H.colDay(2);
            const block = (id, day, from, to) => ({
              id, issueKey: 'GEN-1', issueId: null, title: 'Work',
              startTs: new Date(day + 'T' + from).getTime(),
              endTs: new Date(day + 'T' + to).getTime(),
              status: 'pending', worklogId: null, comment: null, errorMsg: null,
            });
            await window.joggl.days.save(a, [block('wk-s-1', a, '09:00:00', '10:00:00')]);
            await window.joggl.days.save(b, [block('wk-s-2', b, '09:00:00', '10:30:00')]);
            await window.__jogglTest.reloadDay();
            await H.until(() => H.q('#week-sync-btn').textContent.includes('entries'), 4000, 'the label');
            const label = H.q('#week-sync-btn').textContent;
            const disabled = H.q('#week-sync-btn').disabled;
            await H.clearDays([a, b]);
            await H.until(() => H.q('#week-sync-btn').disabled, 4000, 'the button to go quiet');
            return JSON.stringify({ label, disabled, empty: H.q('#week-sync-btn').textContent });`),
    (v) => {
      const d = JSON.parse(v);
      return d.label === 'Sync week · 2 entries, 2h 30m' && d.disabled === false &&
        d.empty === 'Nothing to sync';
    },
  );

  await check(
    'week: an empty week says what to do, and stops saying it once there is time',
    inWeek(`const day = H.colDay(1);
            await H.clearDays(H.all('.week-colhead').map(h => h.dataset.day));
            const hintShown = !H.q('#week-empty-hint').hidden;
            await window.joggl.days.save(day, [{
              id: 'wk-hint-1', issueKey: 'GEN-1', issueId: null, title: 'Something',
              startTs: new Date(day + 'T09:00:00').getTime(),
              endTs: new Date(day + 'T10:00:00').getTime(),
              status: 'pending', worklogId: null, comment: null, errorMsg: null,
            }]);
            await window.__jogglTest.reloadDay();
            await H.until(() => H.q('#week-empty-hint').hidden, 4000, 'the hint to go');
            await H.clearDays([day]);
            return JSON.stringify({ hintShown, gone: H.q('#week-empty-hint').hidden });`),
    (v) => {
      const d = JSON.parse(v);
      return d.gone === true;
    },
  );
```

The empty-week check asserts only what it can: against a live site a Jira-side row may sit on one of the days, so `hintShown` is reported but not required — the same reason `findEmptyDay` exists.

- [ ] **Step 10: Add the checklist rows**

Append to the **Week view** table:

```markdown
| Read the **Sync week** button | `Sync week · 12 entries, 34h 15m` — what will actually reach Jira, across every column shown. With nothing waiting it reads **Nothing to sync** and is dimmed. |
| Hover it | The tooltip says what is a rewrite rather than a fresh log, what is already in Jira, and that the running timer is excluded. |
| Press it with entries on three days | They go up day by day. One summary at the end; on a partial failure the failures name their day and **Retry failed** retries only those. |
| Press it, then look at the day view | The same entries are ✓ synced there. Nothing is logged twice. |
```

- [ ] **Step 11: Commit**

```bash
git add renderer/js/finish-day.js renderer/js/sync.js renderer/js/week-view.js renderer/js/app.js test/finish-day.test.js scripts/ui-check.mjs test-and-issues.md
git commit -m "Sync a week the same way as a day"
```

---

## Task 7: A menu on every column head

Where the two buttons in the *On this day* header go in this view, plus the one that only makes sense here.

**Files:**
- Modify: `renderer/js/context-menu.js` (`showMenu` extracted)
- Modify: `renderer/js/copy-day.js` (an explicit day; `clearWeek`)
- Modify: `renderer/js/week-view.js` (the `⋯` button)
- Modify: `scripts/ui-check.mjs`, `test-and-issues.md`

**Interfaces:**
- Produces:
  - `showMenu(event, items: {icon?, svg?, label, danger?, run}[])` (`context-menu.js`)
  - `copyPreviousDay(target?: string)`, `clearDay(day?: string)`, `clearWeek(days: string[])` (`copy-day.js`)

- [ ] **Step 1: Let the menu hold something that is not an entry**

In `renderer/js/context-menu.js`, split `showContextMenu` in two. Everything from `menu.setAttribute('role', 'menu')` down moves into `showMenu`, unchanged:

```js
/**
 * Raise the shared menu with whatever rows the caller wants.
 *
 * Extracted from `showContextMenu` so a column head can raise a menu that is not
 * about an entry. Everything about *behaviour* — the arrow keys, Enter, Escape, Tab,
 * the focus that goes back to the opener, being pulled inside the window — is here
 * and so cannot come to differ between the two.
 *
 * @param {MouseEvent|{clientX, clientY, currentTarget, target, preventDefault}} event
 * @param {{icon?: string, svg?: string, label: string, danger?: boolean, run: Function}[]} items
 */
export function showMenu(event, items) {
  hideContextMenu();
  const menu = document.getElementById('ctx-menu');
  if (!menu || items.length === 0) return;

  const choose = (item) => { … };   // unchanged

  menu.setAttribute('role', 'menu');
  …                                  // the rest of the old body, unchanged
}

export function showContextMenu(event, entry) {
  if (!actions) return;
  showMenu(event, [
    { icon: '✎', label: 'Edit task', run: () => actions.editTask(entry) },
    // Jira's own name for the field, so it is recognisable to anyone who fills it
    // in through the Jira UI — which, on this site, is everyone.
    { icon: '≡', label: 'Work description', run: () => actions.editComment(entry) },
    { icon: '⏵', label: 'Restart timer', run: () => actions.restart(entry) },
    { icon: '⧉', label: 'Duplicate', run: () => actions.duplicate(entry) },
    { icon: '✂', label: 'Split at midpoint', run: () => actions.split(entry) },
    // Drawn rather than 🗑, for the reason given over DELETE_ICON: the emoji's ribs
    // turn to mush at this size. The others are geometric glyphs, which do not.
    { svg: DELETE_ICON, label: 'Delete', danger: true, run: () => actions.remove(entry) },
  ]);
}
```

- [ ] **Step 2: Give copy and clear an explicit day**

In `renderer/js/copy-day.js`:

```js
/**
 * @param {string} [target] the day to fill. Defaults to the day on screen; the week
 *   view passes the column's own day, which is usually not the same thing.
 */
export async function copyPreviousDay(target = state.selectedDate) {
  if (busy) return;
  const button = document.getElementById('copy-day-btn');
  busy = true;
  …
```

(the rest of the body is unchanged — it already reads `target` throughout, and the button it disables is the day view's, which is simply not on screen when a column menu raised this).

```js
/**
 * @param {string} [day] the day to empty. Local only — this never issues a DELETE to
 *   Jira, and cannot touch a Jira-side row because those are not `state.entries`.
 */
export async function clearDay(day = state.selectedDate) {
  // Fixed before the modal opens: it stays up for as long as the user reads it, and
  // clearing must empty the day the button was pressed on.
  const entries = entriesFor(day);
  …
```

and add:

```js
/**
 * Empty a whole week.
 *
 * The same promise `clearDay` makes, seven times over: local only, nothing is deleted
 * from Jira, and rows logged in the Jira web UI are not Joggl's to remove. Asked once
 * rather than per day — seven modals is not a confirmation, it is an obstacle course
 * — and the count in the question is what makes it answerable.
 */
export async function clearWeek(days) {
  const targets = [...new Set(days)].sort();
  const all = targets.flatMap((day) => entriesFor(day));
  const synced = all.filter((e) => e.worklogId);

  if (all.length === 0) {
    toast('Nothing to clear this week.');
    return;
  }

  const body = clearBody(synced, all.filter((e) => !e.worklogId));
  const days_ = document.createElement('p');
  days_.className = 'panel-lede';
  days_.textContent = `Across ${targets.length} day${targets.length === 1 ? '' : 's'}.`;
  body.appendChild(days_);

  const answer = await askModal({
    title: 'Clear this week?',
    body,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      ...(synced.length > 0 && synced.length < all.length
        ? [{ label: 'Clear unsynced only', value: 'unsynced' }]
        : []),
      { label: 'Clear all', value: 'all', primary: true },
    ],
    dismissValue: 'cancel',
  });
  if (answer === 'cancel') return;

  for (const day of targets) {
    setEntriesFor(day, answer === 'unsynced' ? entriesFor(day).filter((e) => e.worklogId) : []);
    await persistDayNow(day);
  }
  renderAll();
  toastOk(answer === 'unsynced' ? 'Unsynced entries cleared.' : 'Week cleared.');
}
```

- [ ] **Step 3: Put the button on the head**

In `renderer/js/week-view.js`, import `clearDay`, `clearWeek`, `copyPreviousDay` and `showMenu`, and extend `buildHead`:

```js
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
```

and the CSS, beside the other week rules:

```css
.week-colhead-menu {
  border: none;
  background: none;
  padding: 0 2px;
  font: inherit;
  line-height: 1;
  color: var(--text-faint);
  cursor: pointer;
}

.week-colhead-menu:hover {
  color: var(--text);
}
```

Note `.week-colhead-total`'s `margin-left: auto` already pushes the total and this button to the right.

- [ ] **Step 4: Run the tests and the fast UI check**

Run: `npm test`
Expected: PASS, 327.

Run: `npm run uicheck:fast`
Expected: PASS, 93 of 93 — including the day view's own Copy previous day and Clear day checks, which call the same functions with no argument.

- [ ] **Step 5: Add the checks**

```js
  await check(
    'week: the column menu clears that day and leaves the rest',
    inWeek(`const a = H.colDay(0), b = H.colDay(1);
            const block = (id, day) => ({
              id, issueKey: 'GEN-1', issueId: null, title: 'Work',
              startTs: new Date(day + 'T09:00:00').getTime(),
              endTs: new Date(day + 'T10:00:00').getTime(),
              status: 'pending', worklogId: null, comment: null, errorMsg: null,
            });
            await window.joggl.days.save(a, [block('wk-c-1', a)]);
            await window.joggl.days.save(b, [block('wk-c-2', b)]);
            await window.__jogglTest.reloadDay();
            await H.until(() => !!H.q('[data-id="wk-c-1"]'), 4000, 'the seeded blocks');

            H.all('.week-colhead')[0].querySelector('.week-colhead-menu').click();
            await H.until(() => !H.q('#ctx-menu').classList.contains('hidden'), 4000, 'the menu');
            const labels = H.all('#ctx-menu .ctx-item').map(i => i.textContent);
            H.all('#ctx-menu .ctx-item')[1].click();
            await H.until(() => !H.q('#modal-overlay').classList.contains('hidden'), 4000, 'the confirmation');
            H.all('#modal-buttons button').find(b => b.textContent === 'Clear all').click();
            await H.until(() => H.q('#modal-overlay').classList.contains('hidden'), 4000, 'the modal to close');
            await H.sleep(250);

            const left = (await window.joggl.days.get(a)).entries.length;
            const kept = (await window.joggl.days.get(b)).entries.length;
            await H.clearDays([a, b]);
            return JSON.stringify({ labels, left, kept });`),
    (v) => {
      const d = JSON.parse(v);
      return d.left === 0 && d.kept === 1 &&
        JSON.stringify(d.labels) === JSON.stringify(['Copy previous day', 'Clear day', 'Clear week']);
    },
  );
```

- [ ] **Step 6: Add the checklist rows**

```markdown
| Click **⋯** on a column head | A menu: Copy previous day, Clear day, Clear week. The three the *On this day* header has, plus the one only a week can offer. |
| Copy previous day from a column | That column fills from the last day with anything on it, at the same times. The other columns are untouched. |
| Clear day from a column | Only that column empties. It asks first, offers to spare the synced entries, and nothing is deleted from Jira. |
| Clear week | Asks once, naming how many entries across how many days. Local only — every worklog already in Jira stays there. |
```

- [ ] **Step 7: Commit**

```bash
git add renderer/js/context-menu.js renderer/js/copy-day.js renderer/js/week-view.js renderer/css/app.css scripts/ui-check.mjs test-and-issues.md
git commit -m "Put a day's actions on its column"
```

---

## Task 8: The timer, the keyboard, and the documentation

The last task. The timer runs only on today, which in this view is usually a column already on screen; the help panel learns the week's bindings; `CLAUDE.md` and `test-and-issues.md` record what was built; the version becomes `0.18.0`.

**Files:**
- Modify: `renderer/js/app.js` (the omnibar's enabled rule, and starting from a past week)
- Modify: `renderer/js/shell.js` (a view switch repaints)
- Modify: `renderer/js/help.js`, `renderer/index.html` (the help prose)
- Modify: `scripts/ui-check.mjs`, `test-and-issues.md`, `CLAUDE.md`
- Modify: `package.json` via `npm run bump`

- [ ] **Step 1: A view switch repaints**

In `renderer/js/shell.js`, `setActiveView` mounts the new view but nothing redraws it or the controls that depend on which view is up.

```js
import { renderAll } from './render.js';
```

```js
  views.get(activeId)?.unmount();
  activeId = id;
  next.mount();
  // The new view has nothing on it until something draws, and the omnibar's own
  // enabled rule depends on which view is up — see updateTimerUi.
  renderAll();
```

`render.js` imports nothing, so this closes no cycle.

- [ ] **Step 2: The omnibar stays live in the week view**

In `renderer/js/app.js`, take the three `disabled` lines out of `selectDate`:

```js
async function selectDate(date) {
  // The selected entry belongs to the day being left, and its id would otherwise
  // sit in state waiting to match something on a day it was never on.
  clearSelection();
  await loadDay(date);

  $('current-date-label').textContent = formatDateLabel(date);
  $('next-day').disabled = date >= todayKey();

  // A property of the day now on screen, so it belongs here rather than in a render.
  applyWeekendTint();

  renderAll();
  notifyDayChange(date);
}
```

and put the rule where it is re-evaluated on every render — including after a view switch, which is not a day change:

```js
function updateTimerUi() {
  const input = $('task-input');
  const startInput = $('start-time-input');
  const button = $('start-stop-btn');
  const display = $('timer-display');
  const running = Boolean(state.timer);

  // The timer runs only on today. In the day view that means the controls are dead
  // on any other day; in the week view today is usually a column already on screen,
  // so they stay live and starting one steps the view to this week instead.
  const canStart = isToday() || activeView() === 'week';
  input.disabled = !canStart;
  startInput.disabled = !canStart;
  button.disabled = !canStart && !running;

  …                       // the rest of the function is unchanged
}
```

with `activeView` added to the `./shell.js` import.

- [ ] **Step 3: Starting from a past week comes home first**

In the start button's handler:

```js
  $('start-stop-btn').addEventListener('click', async () => {
    if (state.timer) {
      await stopTimer();
      return;
    }
    if (!isToday()) {
      // Only the week view offers this: the day view's controls are dead off today,
      // so there is nothing to press. Stepping to today puts the block that is about
      // to start where it can be seen.
      if (activeView() !== 'week') return;
      await selectDate(todayKey());
    }
    …
```

and in `resumeOrToggleTimer`, the same exemption plus a lookup that names its day:

```js
function resumeOrToggleTimer() {
  const input = $('task-input');
  if (state.timer || input.value.trim() || (!isToday() && activeView() !== 'week')) {
    $('start-stop-btn').click();
    return;
  }

  // Today's, explicitly: in the week view the selected day is often not today, and
  // resuming "the day's last entry" means the day the timer would run on.
  const last = [...entriesFor(todayKey())]
    .filter((e) => !e.external && e.endTs !== null)
    .sort((a, b) => b.endTs - a.endTs)[0];
  …
```

with `entriesFor` added to the `./state.js` import.

- [ ] **Step 4: Teach the help panel the week**

In `renderer/js/help.js`, add a group after *Moving between days*:

```js
  {
    group: 'In the week view',
    keys: [
      ['‹ ›', 'A week back and forward. Page Up and Page Down do the same'],
      ['[ or ]', 'A day — which moves the marked column, and steps the week at its ends'],
      ['5 | 7', 'Monday to Friday, or the whole week. A weekend with time on it is shown either way'],
      ['Drag a block sideways', 'Move it to another day. A synced one goes back to pending and is rewritten, never logged twice'],
    ],
  },
```

and in `renderer/index.html`, a section of prose before *Keyboard*:

```html
        <div class="settings-section">
          <div class="settings-section-title">Seeing the week</div>
          <ul class="help-list">
            <li>
              <strong>Week View</strong> in the sidebar shows Monday to Friday side by
              side — <strong>7</strong> adds the weekend, and a Saturday or Sunday with
              time on it is shown either way, because time you cannot see is time that
              never gets synced.
            </li>
            <li>
              Every column does what the day view does: click an empty hour, drag and
              resize blocks, right-click for the menu. <strong>Drag a block sideways</strong>
              to move it to another day.
            </li>
            <li>
              <strong>Sync week</strong> sends every pending entry across the columns
              shown, and says how many before you press it. <strong>⋯</strong> on a
              column head copies into that day, empties it, or empties the week —
              none of which deletes anything from Jira.
            </li>
          </ul>
        </div>
```

- [ ] **Step 5: Update the help check**

In `scripts/ui-check.mjs`, the `help()` section counts the rows the table renders and asserts specific ones. Re-run it, read what it reports, and update the expected count to the number `SHORTCUTS` now produces. Add one assertion for the new group so the count cannot drift back:

```js
  await check(
    'help: the week view has its own bindings',
    `H.q('#help-btn').click(); await H.sleep(200);
     const groups = H.all('#help-shortcuts .help-keys-group th').map(t => t.textContent);
     const keys = H.all('#help-shortcuts kbd').map(k => k.textContent);
     H.q('#close-help').click(); await H.sleep(150);
     return JSON.stringify({ hasGroup: groups.includes('In the week view'),
                             hasToggle: keys.includes('5 | 7') })`,
    (v) => {
      const d = JSON.parse(v);
      return d.hasGroup && d.hasToggle;
    },
  );
```

- [ ] **Step 6: Add the last checklist rows**

Append to the **Week view** table in `test-and-issues.md`:

```markdown
| Step back three weeks, then start a timer from the search box | The view jumps to this week and the timer runs in today's column. A timer only ever runs on today. |
| Watch a running timer in the week view | Its block grows in today's column, takes part in that column's overlap layout, and both the day total and the week total count it. |
| Press F1 | The shortcut table has an **In the week view** group. |
| Switch to the week view and back, twice | The search box and pins move with it each time. There is never a second copy of either, and Ctrl+L still reaches the box. |
```

- [ ] **Step 7: Update CLAUDE.md**

Four edits.

**a.** In the *Working* table, add a row after `Shell`:

```markdown
| Week view | Five or seven day columns sharing one hour range; everything a day column can do, plus dragging between days, a per-column menu, and one Sync for the week |
```

**b.** In the same table, update the counts to what the runs actually report:

```markdown
| Tests | 327 passing, `npm test`; <N> UI checks, `npm run uicheck` (or `:fast`) |
```

**c.** In *Next, roughly in order*, delete item 1 (week view) and renumber. Month view becomes item 1, and its text gains what phase 3 leaves ready for it:

```markdown
1. **Month view** — phase 4 of the sidebar work. A calendar grid with hours logged per
   day, and the day view beside it showing whichever day was clicked. Everything it
   needs is now in: the range data layer, the shared timeline geometry, the column map
   and the view registry with its `onDayChange` hook.
```

**d.** Add to *Deviations from this document, and why*, as items 10 and 11:

```markdown
10. **The week shown is the week containing `state.selectedDate`.** The spec described
    a week stepper and left the relationship to the day view open. Making the week a
    function of the selected day means every navigation path already in the app — `T`,
    `[`, `]`, Page Up/Down, the calendar — moves the week without knowing this view
    exists, switching views lands on the day that was marked, and there is one answer
    to "which day is this about" for the column menus and for phase 4's paste target.
    The stepper is `selectDate(addWeeks(anchor, ±1))` and nothing more.

11. **The omnibar and the pin bar are moved into the week view, not copied.** Both are
    static markup inside the day view's left panel, and every listener in the app is
    bound by id — including the drag sources, which are delegated onto `#pin-chips`
    itself. A second copy would mean two `#task-input`s and half the wiring pointing at
    whichever the DOM answered with first. Moving a node keeps its listeners, so
    `mount` appends the two into `#week-topbar` and `unmount` puts them back against
    fixed anchors.
```

**e.** Add a short section after *Clicking*, since the shape of the view is worth writing down once:

```markdown
## The week

Five columns, Monday to Friday, or seven. Each is a day, and each is drawn by the
same painter the day view uses — `paintDayColumn` — so a block behaves identically
wherever it is.

Three things are shared across the columns and one is not:

- **One hour range.** `computeRange` is given every visible day at once, so the rows
  line up. A 06:30 block on Tuesday widens Monday too, which is the point: columns
  that each chose their own range would be unreadable side by side.
- **One zoom**, the day view's, so the two cannot disagree about how tall an hour is.
- **One gutter, outside the columns.** The day view draws its hour labels inside the
  grid, 40px in, and `placeBlock` offsets every block by that much. A week column is
  under 200px wide and cannot spare 40 of them, so the labels move to a rail of their
  own and the columns register a gutter of zero. That width is per column for exactly
  this reason.
- **The overlap solver is not shared.** `computeColumns` runs per day, so a block
  never narrows because of something on another day.

**Weeks are ISO 8601**, because every colleague's calendar and every Jira report is.
Two things follow that look like bugs until they are read: a week has a *week-year*
which is not always the calendar year of its Monday, and 1 January is in week 1 only
when it falls Monday to Thursday. The label says the year only when it differs.

**Five-day mode hides an empty weekend, not a worked one.** A Saturday holding any
time — local or Jira-side — is drawn whatever the toggle says. Time that cannot be
seen is time that does not get synced, and hiding it is the one thing this view must
never do.

**A block dragged sideways changes day.** It leaves one day log and joins another in
one gesture, and a synced entry may do it: the worklogId stays valid because the issue
has not changed, only when the work started, so the entry returns to `pending` and the
next Sync rewrites the worklog with `PUT`. That is the same rule a move within a day
already followed. Retargeting still refuses, because that one changes the issue, and a
worklog id is only valid on the issue it was created against.
```

- [ ] **Step 8: Bump the version**

```bash
npm run bump
```

Expected: `0.17.2` → `0.18.0`. A change bumps the minor; this is the one commit of the phase that carries it, the same shape phase 2 used.

- [ ] **Step 9: Verify everything**

Run: `npm test`
Expected: PASS — 327.

Run: `npm run uicheck:fast`
Expected: PASS — every check. **Record the number it reports** and make sure `CLAUDE.md` and any count in `test-and-issues.md` say that number and not a stale one.

Run: `npm run uicheck`
Expected: the same number, passing. This is the merge gate — the live and fixture runs reporting the same counts is the only thing keeping `main/jira/fake.js` honest. If it fails at startup with *401 from Jira — your email or API token is wrong or expired*, that is the expired development token, not this branch: report it and stop rather than merging on the fast run alone.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Show the week (0.18.0)"
```

---

## Self-review notes for the controller

Read before dispatching Task 1. Three things in this plan are deliberate and will look like defects to a reviewer seeing only one task's diff.

1. **Task 4 writes a branch that refuses, and task 5 replaces it.** `drag-drop.js`'s entry branch returns early when the drop lands on a day other than the row's own. In task 4 that state is unreachable — the "On this day" list exists only in the day view, which draws one column — so the alternative would be a half-written cross-day move sitting in the tree for one task with no way to reach it. The comment says which task fills it. If a reviewer flags it as dead code, this is the answer.

2. **No unit tests for `week-view.js`, `timeline-columns.js` or the painter.** Every function in them reads `getBoundingClientRect()` or writes inline styles, and `node --test` has no DOM. That is what the UI check is for, and this phase adds fourteen of them. Three pure modules carry the logic that *can* be tested — `week-range.js`, `cross-day.js`, and the `dirtiedEntry` rule pulled out of `entries.js` — and they are tested.

3. **Task 2 promises no user-visible change but touches the drag handlers.** The edge-snap reads move from `visibleEntries()` to `visibleEntriesFor(dayKey)`. With one column those return the same list, which is exactly why phase 2 left a note saying to do it here rather than there. `npm run uicheck:fast` reporting the same 85 is the evidence; if it does not, the change is wrong, not the suite.

Two things a reviewer should look for and this plan may have got wrong:

- **Sticky column heads overlap their own columns once scrolled.** Task 4 guards the click; the *drop* is not guarded, so releasing a drag over a head lands the block at whatever hour is hidden beneath it. That is a small wrong answer rather than a lost entry, and guarding it properly means hit-testing the head in `columnAt`, which would put view-specific markup into the geometry module. If it reads badly in use, the fix belongs in `columnAt` with a comment, not in three call sites.
- **`renderWeek` rebuilds every column on every `renderAll`.** The day view already rebuilds its grid the same way and a repaint is cheap, but a week is five to seven times the elements. If a drag stutters, the answer is the one `liveUpdate` already uses — mirror the gesture by hand and do not re-render until it commits — not a diffing layer.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-05-week-view-phase-3-week-view.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration, and a whole-branch review at the end.
2. **Inline Execution** — the tasks run in this session, with checkpoints for review.




