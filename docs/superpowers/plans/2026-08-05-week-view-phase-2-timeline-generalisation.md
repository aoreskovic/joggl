# Week view phase 2 — timeline generalisation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the timeline's single-day assumptions out of `renderer/js/timeline.js` so a later phase can draw five or seven day columns, and make every write to a day log name the day it means — with no user-visible change except one bug fix.

**Architecture:** `timeline.js` today keeps one module-level `view = { rangeStartMs, pxPerMin, totalMinutes }` that every drag handler, `gridTimeAt`, `placeBlock`, `liveUpdate`, `updateNowMarkers` and `scrollToNow` reads. That splits into shared geometry (`renderer/js/timeline-geometry.js`, DOM-free and unit-testable) plus a `dateKey → element` column map (`renderer/js/timeline-columns.js`), and the drag/resize/move handlers move to `renderer/js/timeline-drag.js`. Alongside it, the renderer's day writes stop meaning "whichever day is selected when the promise resolves" and start naming a day explicitly.

**Tech stack:** Electron 43, plain ES modules in the renderer, `node --test` with `node:assert/strict`, no framework and no new dependency.

## Global Constraints

Copied verbatim from `CLAUDE.md` and the approved spec at
`docs/superpowers/specs/2026-08-05-week-view-design.md`. Every task's requirements
implicitly include this section.

- **No new dependencies.** "Keep the dependency list short… if a dependency needs
  `node-gyp`, find another way."
- **No user-visible change in this phase**, other than the single bug fix in Task 6.
  The spec's acceptance criterion: "All 251 unit tests and all 82 UI checks pass,
  unchanged" — those counts are now **283 unit tests and 85 UI checks**. No UI check
  may be deleted or weakened.
- **`timeline.js` keeps its exact public surface** — `renderTimeline`, `onGridClick`,
  `showDropPlaceholder`, `hideDropPlaceholder`, `hideQuickEntry`, `updateNowMarkers`,
  `scrollToNow`, `computeColumns`, `gridTimeAt` — so `app.js`, `drag-drop.js`,
  `render.js` and `selection.js` do not change in this phase.
- **The drag and snap edge cases here were settled by use, not by design — treat
  behaviour changes as regressions unless they are deliberate.** Moving code between
  files must not change what it computes.
- **Snapping is to the clock, not to the drag.** `snapToQuarter(ts, dayKey)` is
  measured from the *target day's* local midnight, always.
- **Never run Finish Day / Sync against a live site from a script**, in any mode.
- The renderer never sees the API token and never calls Jira directly; all Jira
  traffic goes through IPC to main. No change to the preload allowlist in this phase.
- **A render must never start a lookup.**
- **Touching an entry is not editing it** — `sameTimes` guards every path that can
  mark an entry as needing a re-sync.
- **Bump the version on every commit**: `npm run bump` (minor, `0.16.2` → `0.17.0`)
  for the phase; `npm run bump:fix` (patch) for a fix to something already cut.
  Only Task 7 bumps.
- Test command: `npm test`. Fixture UI check: `npm run uicheck:fast`. **Do not run
  `npm run uicheck` (live Jira) from a task** — the controller runs it once at the end.
- File operations use the file tools, not shell. Shell is for `npm` and `git` only.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `renderer/js/timeline-geometry.js` | **create** | DOM-free. The shared grid geometry (`startHour`, `endHour`, `pxPerMin`, `totalMinutes`), `computeRange`, and the ts ⇄ pixel conversions, each taking the day they are about. |
| `renderer/js/timeline-columns.js` | **create** | DOM. `dateKey → column element`, `columnAt(x, y)`, and `placeBlock`. |
| `renderer/js/timeline-drag.js` | **create** | DOM + state. Move, resize, the live mirror, and the commit. |
| `renderer/js/day-writes.js` | **create** | DOM-free. Debounced per-day writes that cannot file an edit under the wrong day. |
| `renderer/js/timeline.js` | modify | Render, quick entry, and the public surface. ~350 lines lighter. |
| `renderer/js/day-range.js` | modify | Gains `withoutWorklog`. |
| `renderer/js/state.js` | modify | `setEntriesFor`, the day writer, `dropExternalWorklog`, `loadDays` flushing first. |
| `renderer/js/sync.js`, `copy-day.js`, `entries.js` | modify | Capture the day before the first `await`. |
| `test/timeline-geometry.test.js` | **create** | `computeRange`, and the pixel conversions. |
| `test/day-writes.test.js` | **create** | The writer's queue / flush / immediate-write behaviour. |
| `test/day-range.test.js` | modify | `withoutWorklog`. |
| `CLAUDE.md`, `test-and-issues.md` | modify | Task 7. |

Everything DOM-free lands in a module a `node --test` file can import. `state.js`
reads `window.joggl` at module load and so cannot be imported under `node --test` at
all — that is why `day-writes.js` and `timeline-geometry.js` are separate modules
rather than functions inside `state.js` and `timeline.js`.

---

## Task 1: Shared grid geometry

**Files:**
- Create: `renderer/js/timeline-geometry.js`
- Create: `test/timeline-geometry.test.js`
- Modify: `renderer/js/timeline.js` (the range arithmetic at lines 92–114, and every
  read of `view.*` throughout the file)

**Interfaces:**
- Consumes: `startOfDayMs`, `HOUR` from `renderer/js/util.js`.
- Produces, all imported by Tasks 2 and 3:
  - `grid` — `{ startHour: number, endHour: number, pxPerMin: number, totalMinutes: number }`, a module-level mutable object.
  - `setGrid({ startHour, endHour, pxPerMin }): void` — assigns those three and derives `totalMinutes`.
  - `computeRange(entriesByDay: Map<string, Entry[]>, opts?): { startHour, endHour }` where `opts` is `{ today?: string|null, timerStartTs?: number|null, now?: number }`.
  - `rangeStartMs(dayKey: string): number`
  - `offsetPxOf(ts: number, dayKey: string): number`
  - `tsAtOffsetPx(px: number, dayKey: string): number`
  - `gridHeightPx(): number`

**Why the geometry is not `rangeStartMs` on the object.** The spec named the shared
geometry `{ rangeStartMs, pxPerMin, totalMinutes }`, which is the singleton's current
shape. One absolute timestamp cannot serve five columns — each day's hour 7 is a
different instant, and across a clock change the offsets are not even a constant apart.
So the object holds `startHour` and the functions take the day they are about.
`rangeStartMs(dayKey)` reproduces the old field exactly for the selected day.

- [ ] **Step 1: Write the failing test**

Create `test/timeline-geometry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRange,
  grid,
  gridHeightPx,
  offsetPxOf,
  rangeStartMs,
  setGrid,
  tsAtOffsetPx,
} from '../renderer/js/timeline-geometry.js';
import { HOUR, startOfDayMs } from '../renderer/js/util.js';

const DAY = '2026-07-28';
const OTHER = '2026-07-29';

/** A finished entry on `dayKey`, from `fromHour` to `toHour` local time. */
function entry(dayKey, fromHour, toHour) {
  const base = startOfDayMs(dayKey);
  return { id: `${dayKey}-${fromHour}`, startTs: base + fromHour * HOUR, endTs: base + toHour * HOUR };
}

test('computeRange falls back to the working day when nothing is logged', () => {
  assert.deepEqual(computeRange(new Map([[DAY, []]])), { startHour: 7, endHour: 20 });
});

test('computeRange widens the top for an early block', () => {
  const range = computeRange(new Map([[DAY, [entry(DAY, 6.5, 8)]]]));
  assert.equal(range.startHour, 5);
  assert.equal(range.endHour, 20);
});

test('computeRange widens the bottom for a late block', () => {
  const range = computeRange(new Map([[DAY, [entry(DAY, 9, 21)]]]));
  assert.equal(range.startHour, 7);
  assert.equal(range.endHour, 22);
});

test('computeRange clamps to the day', () => {
  const range = computeRange(new Map([[DAY, [entry(DAY, 0, 24)]]]));
  assert.equal(range.startHour, 0);
  assert.equal(range.endHour, 24);
});

test('one early block on one day of a week widens every column', () => {
  const range = computeRange(
    new Map([
      [DAY, [entry(DAY, 9, 10)]],
      [OTHER, [entry(OTHER, 6.5, 7)]],
    ]),
  );
  assert.deepEqual(range, { startHour: 5, endHour: 20 });
});

test('an unfinished entry contributes nothing', () => {
  const open = { id: 'open', startTs: startOfDayMs(DAY) + 3 * HOUR, endTs: null };
  assert.deepEqual(computeRange(new Map([[DAY, [open]]])), { startHour: 7, endHour: 20 });
});

test("today's current hour widens the range only when today is among the days shown", () => {
  const now = startOfDayMs(DAY) + 22 * HOUR;

  const showingToday = computeRange(new Map([[DAY, []]]), { today: DAY, now });
  assert.equal(showingToday.endHour, 24, 'now + 2, clamped to 24');
  assert.equal(showingToday.startHour, 7, 'nowHour - 1 is later than 7, so 7 stands');

  const notShowingToday = computeRange(new Map([[OTHER, []]]), { today: DAY, now });
  assert.deepEqual(notShowingToday, { startHour: 7, endHour: 20 });
});

test('an early hour of the morning pulls the top down to nowHour - 1', () => {
  const now = startOfDayMs(DAY) + 3 * HOUR;
  const range = computeRange(new Map([[DAY, []]]), { today: DAY, now });
  assert.equal(range.startHour, 2);
});

test('a running timer is counted, on today only', () => {
  const now = startOfDayMs(DAY) + 9 * HOUR;
  const timerStartTs = startOfDayMs(DAY) + 4 * HOUR;

  const counted = computeRange(new Map([[DAY, []]]), { today: DAY, timerStartTs, now });
  assert.equal(counted.startHour, 3);

  // The same timer while a different day is on screen touches nothing.
  const ignored = computeRange(new Map([[OTHER, []]]), { today: DAY, timerStartTs, now });
  assert.deepEqual(ignored, { startHour: 7, endHour: 20 });
});

test('setGrid derives the height, and the conversions are inverses', () => {
  setGrid({ startHour: 7, endHour: 20, pxPerMin: 1.5 });
  assert.equal(grid.totalMinutes, 13 * 60);
  assert.equal(gridHeightPx(), 13 * 60 * 1.5);

  assert.equal(rangeStartMs(DAY), startOfDayMs(DAY) + 7 * HOUR);
  assert.equal(offsetPxOf(rangeStartMs(DAY), DAY), 0);
  assert.equal(offsetPxOf(rangeStartMs(DAY) + HOUR, DAY), 90);
  assert.equal(tsAtOffsetPx(90, DAY), rangeStartMs(DAY) + HOUR);
});

test('the conversions are per day, so each column has its own hour 7', () => {
  setGrid({ startHour: 7, endHour: 20, pxPerMin: 1.5 });
  assert.equal(rangeStartMs(OTHER), startOfDayMs(OTHER) + 7 * HOUR);
  assert.equal(offsetPxOf(rangeStartMs(OTHER), OTHER), 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/timeline-geometry.js'`.

- [ ] **Step 3: Write `renderer/js/timeline-geometry.js`**

```js
// The timeline's geometry, shared by every column rendered.
//
// Split out of timeline.js's `view` singleton, and DOM-free so the arithmetic can
// be tested without a browser. One grid per render, day view or week: every column
// shares one hour range, or the rows do not line up across the week and the hour
// gutter — drawn once, for all of them — would mean a different time in each column.
//
// The day is a parameter rather than a field. The singleton held one absolute
// `rangeStartMs`, which cannot serve five columns: each day's hour 7 is a different
// instant, and across a clock change two of them are not even a constant apart.

import { HOUR, startOfDayMs } from './util.js';

/** The hour range every column is drawn against, and the zoom it is drawn at. */
export const grid = { startHour: 7, endHour: 20, pxPerMin: 1.5, totalMinutes: 13 * 60 };

export function setGrid({ startHour, endHour, pxPerMin }) {
  grid.startHour = startHour;
  grid.endHour = endHour;
  grid.pxPerMin = pxPerMin;
  grid.totalMinutes = (endHour - startHour) * 60;
}

/** Local midnight on `dayKey`, plus the range's first hour. */
export function rangeStartMs(dayKey) {
  return startOfDayMs(dayKey) + grid.startHour * HOUR;
}

export function offsetPxOf(ts, dayKey) {
  return ((ts - rangeStartMs(dayKey)) / 60_000) * grid.pxPerMin;
}

export function tsAtOffsetPx(px, dayKey) {
  return rangeStartMs(dayKey) + (px / grid.pxPerMin) * 60_000;
}

export function gridHeightPx() {
  return grid.totalMinutes * grid.pxPerMin;
}

/**
 * The hour range covering every day passed.
 *
 * A full working day at minimum, widened to cover everything logged on any of the
 * days, and — when today is among them — widened to the current hour. Lifted
 * verbatim out of `renderTimeline`, with the loop over days as the only addition:
 * with one day it computes exactly what the day view computed before.
 *
 * @param {Map<string, {startTs: number, endTs: number|null}[]>} entriesByDay
 * @param {{today?: string|null, timerStartTs?: number|null, now?: number}} [opts]
 */
export function computeRange(entriesByDay, { today = null, timerStartTs = null, now = Date.now() } = {}) {
  let startHour = 7;
  let endHour = 20;

  if (today !== null && entriesByDay.has(today)) {
    const nowHour = new Date(now).getHours();
    endHour = Math.max(endHour, Math.min(24, nowHour + 2));
    startHour = Math.min(startHour, Math.max(0, nowHour - 1));
  }

  for (const [dayKey, entries] of entriesByDay) {
    const dayStart = startOfDayMs(dayKey);
    // An entry still running has no end, and `Math.min(x, null)` is 0 — which would
    // drag the range back to midnight rather than leave it alone.
    const stamps = (entries ?? [])
      .filter((e) => e.endTs !== null && e.endTs !== undefined)
      .flatMap((e) => [e.startTs, e.endTs]);

    if (timerStartTs !== null && dayKey === today) stamps.push(timerStartTs, now);
    if (stamps.length === 0) continue;

    startHour = Math.min(startHour, Math.max(0, Math.floor((Math.min(...stamps) - dayStart) / HOUR) - 1));
    endHour = Math.max(endHour, Math.min(24, Math.ceil((Math.max(...stamps) - dayStart) / HOUR) + 1));
  }

  return { startHour, endHour };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS — 283 existing + 11 new.

- [ ] **Step 5: Use it from `renderTimeline`**

In `renderer/js/timeline.js`:

Delete the singleton at line 38 (`const view = { rangeStartMs: 0, pxPerMin: 1.5, totalMinutes: 0 };`) and its comment, and add to the imports:

```js
import {
  computeRange,
  grid,
  gridHeightPx,
  offsetPxOf,
  rangeStartMs,
  setGrid,
} from './timeline-geometry.js';
```

Replace lines 87–114 of `renderTimeline` (from `const dayStart = …` down to and
including `grid.style.height = …`) with:

```js
  const entries = visibleEntries().filter((e) => e.endTs !== null);

  const { startHour, endHour } = computeRange(new Map([[state.selectedDate, entries]]), {
    today: isToday() ? state.selectedDate : null,
    timerStartTs: state.timer && isToday() ? state.timer.startTs : null,
  });
  setGrid({ startHour, endHour, pxPerMin: pxPerMin() });

  gridEl.replaceChildren();
  gridEl.style.height = `${gridHeightPx()}px`;
```

`grid` is now an imported binding, so the local `const grid = document.getElementById('schedule-grid')`
at the top of `renderTimeline` must be renamed to `gridEl` — **rename every use of it
inside that function**, including `gridEl.appendChild(...)` in the hour loop, the block
loop, the live block, the now line and the empty hint. The same rename applies in
`gridTimeAt`, `showDropPlaceholder`, `hideDropPlaceholder`, `updateNowMarkers` and
`scrollToNow`, each of which has its own `const grid = document.getElementById(...)`.

Then replace every remaining read of the old singleton:

| Was | Becomes |
|---|---|
| `view.totalMinutes * px` (grid height) | `gridHeightPx()` |
| `(entry.startTs - view.rangeStartMs) / 60_000 * view.pxPerMin` in `placeBlock` | `offsetPxOf(startTs, state.selectedDate)` |
| `view.pxPerMin` (duration → px) | `grid.pxPerMin` |
| `view.rangeStartMs` in `gridTimeAt` | `rangeStartMs(state.selectedDate)` |
| `view.totalMinutes * view.pxPerMin` in `gridTimeAt` | `gridHeightPx()` |
| `view.pxPerMin` in `onResize` / `onMoveBlock` deltas | `grid.pxPerMin` |
| `(entry.startTs - view.rangeStartMs) / 60_000` in `liveUpdate` | `offsetPxOf(entry.startTs, state.selectedDate) / grid.pxPerMin` — or better, use `offsetPxOf(...)` directly where the result is multiplied by `pxPerMin` a line later |
| `(Date.now() - view.rangeStartMs) / 60_000` in `updateNowMarkers` and `scrollToNow` | `offsetPxOf(Date.now(), state.selectedDate)` for the pixel value; keep a minutes value only where one is compared against `view.totalMinutes` — compare pixels against `gridHeightPx()` instead |

Keep the hour-loop's `const y = (h - startHour) * 60 * px;` as it is — it is already
expressed in the range's own terms.

The arithmetic must come out identical. `offsetPxOf(ts, day)` is
`((ts - (startOfDayMs(day) + startHour * HOUR)) / 60_000) * pxPerMin`, and the old
`view.rangeStartMs` was `startOfDayMs(state.selectedDate) + startHour * 3_600_000`.

- [ ] **Step 6: Verify nothing moved**

Run: `npm test` — 294 passing.
Run: `npm run uicheck:fast` — **85 passed, 0 failed**. Any failure here is a
regression in this step, not a flake; read the check's name and fix the arithmetic.

- [ ] **Step 7: Commit**

```bash
git add renderer/js/timeline-geometry.js renderer/js/timeline.js test/timeline-geometry.test.js
git commit -m "Split the timeline's hour range out of the render"
```

---

## Task 2: Columns

**Files:**
- Create: `renderer/js/timeline-columns.js`
- Modify: `renderer/js/timeline.js`

**Interfaces:**
- Consumes: `grid`, `offsetPxOf`, `gridHeightPx`, `tsAtOffsetPx` from `timeline-geometry.js` (Task 1); `snapToQuarter` from `util.js`.
- Produces, imported by Task 3 and by `timeline.js`:
  - `GUTTER_PX` — `40`, moved here from `timeline.js`.
  - `setColumns(pairs: [string, HTMLElement][]): void` — replaces the whole map.
  - `columnFor(dayKey: string): HTMLElement | null`
  - `columnAt(clientX: number, clientY: number): { dateKey: string, ts: number } | null`
  - `placeBlock(el, startTs, endTs, dayKey, slot, minHeightPx = 6): void` — note the new `dayKey` parameter, fourth, before `slot`.

- [ ] **Step 1: Write `renderer/js/timeline-columns.js`**

There is no unit test for this file: every function reads
`getBoundingClientRect()` or writes inline styles, and `node --test` has no DOM. It is
covered by the UI checks, which drive real `MouseEvent`s against a real window — the
drop-lands-where-the-preview-said checks in particular.

```js
// Which day a point on the timeline belongs to, and where a block sits inside it.
//
// A column owns nothing but its day and its box; the hour range and the zoom are
// shared, and live in timeline-geometry.js. With one column this is exactly the day
// view: `columnAt` answers the selected day for every point inside the grid, which
// is what `gridTimeAt` used to answer unconditionally.

import { grid, gridHeightPx, offsetPxOf, tsAtOffsetPx } from './timeline-geometry.js';
import { snapToQuarter } from './util.js';

/**
 * The hour gutter's width, and it is pinned: the labels are capped at 12px so they
 * cannot outgrow it, and the CSS carries the same 40 as `left: 40px`.
 */
export const GUTTER_PX = 40;

/** dateKey -> the element that day's blocks are positioned inside. */
const columns = new Map();

export function setColumns(pairs) {
  columns.clear();
  for (const [dateKey, el] of pairs) if (el) columns.set(dateKey, el);
}

export function columnFor(dayKey) {
  return columns.get(dayKey) ?? null;
}

/**
 * The day and snapped timestamp a cursor position points at, or null when it falls
 * outside every column.
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
 * 30-minute entry at whatever time that row's Y happened to map to. With several
 * columns the horizontal test stops being a bound and starts being the answer to
 * *which day*, which is the whole reason this function replaced `gridTimeAt`.
 */
export function columnAt(clientX, clientY) {
  for (const [dateKey, el] of columns) {
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) continue;

    const y = clientY - rect.top;
    if (y < 0 || y > gridHeightPx()) continue;

    // Snapped against this column's own midnight, never the selected day's: the two
    // are the same day today, and will not be once a week is on screen.
    return { dateKey, ts: snapToQuarter(tsAtOffsetPx(y, dateKey), dateKey) };
  }
  return null;
}

/**
 * Position a block inside its column.
 *
 * `slot` comes from `computeColumns` — the overlap solver — and is per day, so a
 * block never narrows more than its own day's neighbours require.
 */
export function placeBlock(el, startTs, endTs, dayKey, slot, minHeightPx = 6) {
  const durMin = Math.max(1, (endTs - startTs) / 60_000);
  el.style.top = `${offsetPxOf(startTs, dayKey)}px`;
  el.style.minHeight = `${Math.max(minHeightPx, durMin * grid.pxPerMin)}px`;

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
```

- [ ] **Step 2: Use it from `timeline.js`**

In `renderer/js/timeline.js`:

1. Delete the local `placeBlock` function and the `GUTTER_PX` constant; import both
   `placeBlock` and `GUTTER_PX` (if still referenced) from `./timeline-columns.js`,
   along with `columnAt` and `setColumns`.
2. Every `placeBlock(el, start, end, slot)` call gains the day as its fourth argument:
   `placeBlock(el, start, end, state.selectedDate, slot)`; the live block's
   `placeBlock(block, live.startTs, live.endTs, state.selectedDate, slot, 20)`.
3. At the **top** of `renderTimeline`, right after the `if (!gridEl) return;` guard, register the column:

```js
  // One column today. The map is what a week view fills with five or seven, and it
  // is registered before anything is drawn so a gesture arriving mid-render still
  // resolves to a day.
  setColumns([[state.selectedDate, gridEl]]);
```

4. `gridTimeAt` becomes a wrapper, keeping the exported name and signature that
   `drag-drop.js` imports:

```js
/**
 * The snapped timestamp a cursor position points at, or null when it falls outside
 * the grid. The single-day form of `columnAt`, kept because `drag-drop.js` asks
 * "what time" and, until there is more than one column, that is the whole question.
 */
export function gridTimeAt(clientX, clientY) {
  return columnAt(clientX, clientY)?.ts ?? null;
}
```

Delete the old body and its doc comment — the comment now lives on `columnAt`.

- [ ] **Step 3: Verify**

Run: `npm test` — 294 passing, unchanged.
Run: `npm run uicheck:fast` — 85 passed, 0 failed.

The checks that matter most here are the ones asserting a drop landed where the
preview said, and the quick-entry popup's time. If either fails, the `placeBlock`
day argument or the `columnAt` snap day is wrong.

- [ ] **Step 4: Commit**

```bash
git add renderer/js/timeline-columns.js renderer/js/timeline.js
git commit -m "Give the timeline columns, one of them for now"
```

---

## Task 3: The drag handlers move out

**Files:**
- Create: `renderer/js/timeline-drag.js`
- Modify: `renderer/js/timeline.js`

**Interfaces:**
- Consumes: `grid` from `timeline-geometry.js`; `columnFor`, `placeBlock` from `timeline-columns.js`; `markDirty` from `entries.js`; `sameTimes` from `entry-ops.js`; `renderAll` from `render.js`; `persistDayNow`, `state`, `visibleEntries` from `state.js`; `toastWarn` from `toast.js`; `msToDur`, `QUARTER`, `snapToQuarter`, `startOfDayMs`, `tsToHHMM` from `util.js`.
- Produces, imported by `timeline.js`:
  - `onResize(event, entry, edge, dayKey): void` — `edge` is `'top' | 'bot'`.
  - `onMoveBlock(event, entry, dayKey): void`
  - `isClickSuppressed(): boolean`

**Import direction.** `timeline.js` → `timeline-drag.js` → `timeline-columns.js` →
`timeline-geometry.js`. Nothing points back up; do not import `timeline.js` from
`timeline-drag.js`.

- [ ] **Step 1: Create `renderer/js/timeline-drag.js`**

Move — do not rewrite — `MIN_DURATION_MS`, `EDGE_SNAP_MS`, `locked`, `onResize`,
`suppressClickUntil`, `CLICK_TAIL_MS`, `onMoveBlock`, `liveUpdate` and `commitDrag`
out of `timeline.js`, keeping every comment on them verbatim. The file header:

```js
// Moving and resizing a block, and committing what the gesture produced.
//
// Split out of timeline.js unchanged. The drag and snap edge cases here were settled
// by use rather than by design — a behaviour change is a regression unless it is
// deliberate.
//
// `dayKey` is threaded through every handler rather than read from
// `state.selectedDate`. Today they are always the same day; once a week is on screen
// they are not, and the quarter-hour snap is measured from the *entry's own* day's
// local midnight — which matters when two columns sit on opposite sides of a clock
// change.
```

Four changes, and no others:

1. `onResize(event, entry, edge)` → `onResize(event, entry, edge, dayKey)`, and both
   `snapToQuarter(..., state.selectedDate)` calls inside it become
   `snapToQuarter(..., dayKey)`.
2. `onMoveBlock(event, entry)` → `onMoveBlock(event, entry, dayKey)`; its
   `const dayStart = startOfDayMs(state.selectedDate)` becomes
   `startOfDayMs(dayKey)`, and its `snapToQuarter(origStart + deltaMs, state.selectedDate)`
   becomes `snapToQuarter(origStart + deltaMs, dayKey)`.
3. `liveUpdate(block, entry)` → `liveUpdate(block, entry, dayKey)`, and its manual
   top/height arithmetic goes through the geometry:

```js
function liveUpdate(block, entry, dayKey) {
  if (block) {
    const durMin = Math.max(1, (entry.endTs - entry.startTs) / 60_000);
    block.style.top = `${offsetPxOf(entry.startTs, dayKey)}px`;
    block.style.minHeight = `${Math.max(6, durMin * grid.pxPerMin)}px`;
  }
  // …the entry-card mirror and the total, unchanged…
}
```

   Both `onResize`'s and `onMoveBlock`'s `liveUpdate(block, entry)` calls gain `dayKey`.
   Add `offsetPxOf` to the `timeline-geometry.js` import.

4. `suppressClickUntil` stops being read from `timeline.js` directly — export a reader
   instead, since a `let` binding exported by value would go stale:

```js
/**
 * Whether a click arriving now is the tail of a completed move rather than a click.
 *
 * `preventDefault()` on mousedown stops focus and text selection but not the click,
 * so without this every finished drag would also read as "select this". Module level
 * rather than per-gesture because the commit re-renders: the click lands on the *new*
 * block, which knows nothing about the drag that produced it. A function rather than
 * the variable, because the block builder lives in another module now and an exported
 * `let` read across a module boundary would be a live binding to a moving target —
 * correct here, but only by accident, and a reader says what is being asked.
 */
export function isClickSuppressed() {
  return Date.now() < suppressClickUntil;
}
```

`commitDrag` and `locked` stay module-private. Delete the duplicated JSDoc block above
`commitDrag` — there are two, one of them stale (it describes the older
unconditional-commit behaviour); keep the second, which documents `touched`.

**`onResize`'s edge snapping still reads `visibleEntries()`**, which is the day on
screen. Leave it. With one column that is the entry's own day, and the alternative —
`visibleEntriesFor(dayKey)` — would be a behaviour change dressed as a move: it exists
and is uncalled precisely because phase 3 is where a resize can happen in a column that
is not the selected day. Add a one-line comment saying so, and nothing more:

```js
      // The day on screen, which is this entry's day until there is more than one
      // column. Phase 3 swaps this for `visibleEntriesFor(dayKey)`.
```

- [ ] **Step 2: Wire it from `timeline.js`**

Remove every moved symbol from `timeline.js`, add:

```js
import { isClickSuppressed, onMoveBlock, onResize } from './timeline-drag.js';
```

and update the three call sites inside `buildBlock`:

```js
      handle.addEventListener('mousedown', (event) => onResize(event, entry, edge, dayKey));
```
```js
  block.addEventListener('mousedown', (event) => {
    if (event.target.closest('.sched-handle')) return;
    onMoveBlock(event, entry, dayKey);
  });
```
```js
    // A move that actually moved is not a click, however it ends up on screen.
    if (isClickSuppressed()) return;
```

`buildBlock(entry, slot)` becomes `buildBlock(entry, dayKey, slot)`, and its single
caller in `renderTimeline` passes `state.selectedDate`. `placeBlock` inside
`buildBlock` takes `dayKey` too.

Check the imports `timeline.js` no longer needs — `sameTimes`, `markDirty`,
`persistDayNow`, `toastWarn`, `msToDur`, `QUARTER` are all likely now unused there.
Leaving an unused import is not an error but it is noise; remove the ones nothing in
the file references any more, and **keep** the ones the quick-entry popup and
`renderTimeline` still use.

- [ ] **Step 3: Verify**

Run: `npm test` — 294 passing.
Run: `npm run uicheck:fast` — 85 passed, 0 failed.

Then read the diff of `timeline-drag.js` against the old `timeline.js` region one more
time and confirm that the only differences are the four listed in Step 1. This file is
the phase's highest risk: it is the code the spec calls "settled by use, not by design".

- [ ] **Step 4: Commit**

```bash
git add renderer/js/timeline-drag.js renderer/js/timeline.js
git commit -m "Move the drag handlers into their own module"
```

---

## Task 4: A day write that names its day

**Files:**
- Create: `renderer/js/day-writes.js`
- Create: `test/day-writes.test.js`
- Modify: `renderer/js/state.js`

**The bug being fixed.** `persistDay` is `debounce(() => persistDayNow(), 500)`, and
`persistDayNow` saves `state.entries` — the *selected* day — at the moment the timer
fires. Type into a time field and step to the next day within half a second and the
edit is written under the new day's key, against the new day's entries: the edit is
lost and the wrong day is rewritten with what it already held. `loadDays` has the
mirror of it, documented in its own doc comment: it overwrites `state.days` for every
day in its range straight from disk, so a pending edit is replaced by what is on disk.

**Interfaces:**
- Consumes: nothing — the module is pure.
- Produces:
  - `createDayWriter(save: (dayKey) => Promise<void>, { wait = 500, setTimer = setTimeout, clearTimer = clearTimeout } = {})` returning `{ queue(dayKey), now(dayKey), flush(), pending() }`.
- `state.js` then produces: `persistDay(dayKey?)`, `persistDayNow(dayKey?)`, `persistDayFor(dayKey)`, `flushDayWrites()`, `setEntriesFor(dayKey, entries)`.

- [ ] **Step 1: Write the failing test**

Create `test/day-writes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDayWriter } from '../renderer/js/day-writes.js';

/** A controllable clock, so the tests never sleep. */
function fakeTimers() {
  let next = 1;
  const scheduled = new Map();
  return {
    setTimer(fn) {
      const id = next++;
      scheduled.set(id, fn);
      return id;
    },
    clearTimer(id) {
      scheduled.delete(id);
    },
    /** Fire everything still scheduled. */
    async run() {
      const fns = [...scheduled.values()];
      scheduled.clear();
      for (const fn of fns) await fn();
    },
    count() {
      return scheduled.size;
    },
  };
}

function recorder() {
  const saved = [];
  return { saved, save: async (dayKey) => void saved.push(dayKey) };
}

test('a queued write happens when the timer fires, not before', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  assert.deepEqual(saved, [], 'nothing written yet');
  assert.deepEqual(writer.pending(), ['2026-07-28']);

  await timers.run();
  assert.deepEqual(saved, ['2026-07-28']);
  assert.deepEqual(writer.pending(), []);
});

test('two days queued inside one window both get written', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  writer.queue('2026-07-29');
  await timers.run();

  assert.deepEqual(saved.sort(), ['2026-07-28', '2026-07-29']);
});

test('the same day queued twice is written once', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  writer.queue('2026-07-28');
  await timers.run();

  assert.deepEqual(saved, ['2026-07-28']);
});

test('an immediate write clears that day from the queue', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  await writer.now('2026-07-28');

  assert.deepEqual(saved, ['2026-07-28']);
  assert.deepEqual(writer.pending(), [], 'no second write left owing');

  await timers.run();
  assert.deepEqual(saved, ['2026-07-28'], 'the timer finds nothing to do');
});

test('an immediate write on one day leaves another day still queued', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  await writer.now('2026-07-29');
  await timers.run();

  assert.deepEqual(saved, ['2026-07-29', '2026-07-28']);
});

test('flush writes everything owing at once', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  writer.queue('2026-07-29');
  await writer.flush();

  assert.deepEqual(saved.sort(), ['2026-07-28', '2026-07-29']);
  assert.equal(timers.count(), 0, 'flush cancels the pending timer');
});

test('flush with nothing owing writes nothing', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  await writer.flush();
  assert.deepEqual(saved, []);
});

test('a failing save does not leave the day owing forever', async () => {
  const timers = fakeTimers();
  const attempts = [];
  const writer = createDayWriter(
    async (dayKey) => {
      attempts.push(dayKey);
      throw new Error('disk full');
    },
    timers,
  );

  writer.queue('2026-07-28');
  await assert.rejects(() => writer.flush(), /disk full/);
  assert.deepEqual(attempts, ['2026-07-28']);
  assert.deepEqual(writer.pending(), [], 'taken off the queue, not retried silently');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/day-writes.js'`.

- [ ] **Step 3: Write `renderer/js/day-writes.js`**

```js
// Debounced writes to the day logs, one queue entry per day.
//
// Pure — no DOM, no IPC — so the bookkeeping can be tested without a browser. The
// save itself is injected; state.js supplies the one that goes over IPC.
//
// The debounce used to close over nothing at all: it fired after 500ms and saved
// "the selected day". Type into a time field and step to the next day inside that
// half second and the edit was written under the *new* day's key, against the new
// day's entries — the edit lost, and a day that had not been touched rewritten with
// what it already held. A queue of day keys cannot make that mistake: what is owed
// is decided when the edit happens, not when the timer fires.

/**
 * @param {(dayKey: string) => Promise<void>} save
 * @param {{wait?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout}} [opts]
 */
export function createDayWriter(save, { wait = 500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const owing = new Set();
  let handle = null;

  async function flush() {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
    const days = [...owing];
    // Cleared before the writes rather than after: a save that throws must not leave
    // the day owing, or the next flush retries it silently and the caller that was
    // told about the failure has no say in it.
    owing.clear();
    for (const dayKey of days) await save(dayKey);
  }

  return {
    /** Note that this day needs writing soon. */
    queue(dayKey) {
      owing.add(dayKey);
      if (handle !== null) clearTimer(handle);
      // The promise is returned rather than dropped. `setTimeout` ignores it, but a
      // test's fake clock can await it, which is the difference between asserting
      // what was written and asserting what had been written by the first microtask.
      handle = setTimer(() => {
        handle = null;
        return flush().catch((err) => console.error('Failed to save day log:', err));
      }, wait);
    },

    /** Write this day now, and stop owing it. */
    async now(dayKey) {
      owing.delete(dayKey);
      await save(dayKey);
    },

    /** Write everything owing, now. Rejects if a save does. */
    flush,

    /** Which days are owed a write. For tests, and for anything that must not race one. */
    pending() {
      return [...owing];
    },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test` — 294 + 8 = 302 passing.

- [ ] **Step 5: Wire it into `state.js`**

Add the import:

```js
import { createDayWriter } from './day-writes.js';
```

Replace the block at `renderer/js/state.js:93–99` (`persistDayNow` and `persistDay`)
with:

```js
/**
 * Every day write goes through one queue, so a write decided now cannot land on
 * whichever day happens to be selected when it runs. See day-writes.js.
 */
const dayWriter = createDayWriter((dayKey) => api.days.save(dayKey, entriesFor(dayKey)));

/** Write this day within half a second. Defaults to the day on screen. */
export function persistDay(dayKey = state.selectedDate) {
  dayWriter.queue(dayKey);
}

/** Write this day now. Defaults to the day on screen. */
export function persistDayNow(dayKey = state.selectedDate) {
  return dayWriter.now(dayKey);
}

/** Write everything a debounce still owes. */
export function flushDayWrites() {
  return dayWriter.flush();
}
```

`persistDayFor` at line 129 becomes an alias, since `persistDayNow` now takes the day:

```js
/** The explicit-day form of `persistDayNow`, kept as a name that says so. */
export const persistDayFor = persistDayNow;
```

Add the writer beside `entriesFor`:

```js
/** Replace one day's entries, whether or not it is the day on screen. */
export function setEntriesFor(dayKey, entries) {
  state.days.set(dayKey, entries ?? []);
}
```

And make `loadDays` flush first — replace its first line:

```js
export async function loadDays(from, to) {
  // A debounced edit not yet on disk would be replaced by what is on disk. Writing
  // it out first is cheaper than deciding which days to skip, and leaves memory and
  // disk agreeing rather than merely not fighting.
  await flushDayWrites();

  const logs = await api.days.getRange(from, to);
  …
```

Then update `loadDays`'s doc comment: point 1 ("This overwrites `state.days` for every
day in the range… Phase 3 draws a month including today and must guard this") is now
handled, so replace that paragraph with:

```
 * 1. **This overwrites `state.days` for every day in the range**, straight from disk.
 *    Any debounced edit is flushed first, so what is on disk is what was on screen —
 *    but an edit made *during* the read still loses, which no caller does today.
```

- [ ] **Step 6: Verify**

Run: `npm test` — 302 passing.
Run: `npm run uicheck:fast` — 85 passed, 0 failed. The persistence checks are the
ones to watch.

- [ ] **Step 7: Commit**

```bash
git add renderer/js/day-writes.js renderer/js/state.js test/day-writes.test.js
git commit -m "Decide which day a write belongs to when the edit happens"
```

---

## Task 5: Every write names its day

**Files:**
- Modify: `renderer/js/sync.js`
- Modify: `renderer/js/copy-day.js`
- Modify: `renderer/js/entries.js`
- Modify: `renderer/js/timeline.js`

**Interfaces:**
- Consumes: `entriesFor`, `setEntriesFor`, `persistDayNow(dayKey)` from `state.js` (Task 4).

**The bug being fixed.** Eight places assign `state.entries = …` *after* an `await` —
a modal the user reads, a sync that takes seconds, a Jira DELETE. `state.entries` is a
live view onto the selected day, so if the day changed while that promise was in
flight, the result is filed under the day now on screen: the day the user was actually
working on keeps its stale entries, and an untouched day is overwritten. None of it is
reachable by accident today only because nobody has tried; a week view makes the day
change a mouse click away from every one of these.

**The rule, applied identically at every site:** capture `const day = state.selectedDate`
before the first `await`, then read with `entriesFor(day)`, write with
`setEntriesFor(day, …)`, and persist with `persistDayNow(day)`.

- [ ] **Step 1: `sync.js`**

In `finishDay`, add after the `if (running) return;` guard:

```js
  // The day this sync is about, fixed before anything is awaited. A sync takes
  // seconds and the day can be stepped while it runs; the results belong to the day
  // whose entries were submitted, not to whatever is on screen when Jira answers.
  const day = state.selectedDate;
```

Then `const plan = planFinishDay(entriesFor(day));`, `runFinishDay(entriesFor(day), …)`,
`setEntriesFor(day, result.entries);`, `await persistDayNow(day);`.

In `showFailureSummary`, take the day as a second parameter — the retry modal is open
for as long as the user reads it:

```js
async function showFailureSummary(result, day) {
  …
  setEntriesFor(day, resetFailedForRetry(entriesFor(day)));
  await persistDayNow(day);
```

and call it as `await showFailureSummary(result, day);`.

`updateFinishButton` reads `state.entries` and is a render — leave it exactly as it is.
It is about the day on screen, which is the right meaning there.

- [ ] **Step 2: `copy-day.js`**

`copyPreviousDay` already captures `const target = state.selectedDate;`. Use it:
`setEntriesFor(target, [...entriesFor(target), ...copies]);` and
`await persistDayNow(target);`. `confirmCopy` reads `state.entries.length` twice —
pass `target` in and read `entriesFor(target)`; it is called after `loadDays`, which
awaits.

`clearDay` captures nothing. Add `const day = state.selectedDate;` as its first line,
then read `entriesFor(day)` for `synced` / `rest` / the empty check, and after the
modal `setEntriesFor(day, answer === 'unsynced' ? synced : []);` and
`await persistDayNow(day);`. The title still reads `formatDateLabel(day)`.

- [ ] **Step 3: `entries.js`**

Four functions, each awaiting a modal before writing:

- `deleteEntry(id)` — `const day = state.selectedDate;` first line; then
  `setEntriesFor(day, entriesFor(day).filter((e) => e.id !== id));` and
  `await persistDayNow(day);`. The `invalidateExternal(state.selectedDate)` and
  `refreshExternal(state.selectedDate)` calls become `invalidateExternal(day)` and
  `refreshExternal(day)` — Task 6 changes the first of those again.
- `editEntryTask(id)` — same capture; `setEntriesFor(day, entriesFor(day).map(…))`,
  `await persistDayNow(day)`.
- `editEntryComment(id)` — same capture; the write is `Object.assign(entry, next)` on
  an object already in the array, so only `await persistDayNow(day)` changes.
- `duplicateEntry(id)` and `splitEntry(id)` — no `await` before the write, so the
  capture is unnecessary. Do them anyway, for one reason: the rule is worth being able
  to read off the file rather than reasoning about await placement at each site. One
  line each.

`handleInlineEdit` calls `persistDay()` — it is synchronous up to that point, so
`persistDay(state.selectedDate)` is the same call. Pass it explicitly, same reason.

- [ ] **Step 4: `timeline.js`**

The quick-entry popup's `commit` runs after the user has typed and, when the results
came from Jira, after a remote lookup. `showQuickEntry` already receives `startTs` —
give it the day as well. In `onGridClick`, `columnAt` already answers which column was
clicked; take the day from it rather than from `state.selectedDate`:

```js
export function onGridClick(event) {
  if (event.target.closest('.sched-entry-block') || event.target.closest('.sched-handle')) return;

  clearSelection();

  const at = columnAt(event.clientX, event.clientY);
  if (at === null) return;

  const duration = 30 * 60_000;
  // …the existing latestStart comment, unchanged…
  const latestStart = startOfDayMs(at.dateKey) + 86_400_000 - duration;
  const startTs = Math.min(at.ts, latestStart);

  showQuickEntry(event.clientX, event.clientY, at.dateKey, startTs, startTs + duration);
}
```

and in `showQuickEntry(cx, cy, dayKey, startTs, endTs)`, the commit becomes:

```js
    setEntriesFor(dayKey, [
      ...entriesFor(dayKey),
      { …unchanged… },
    ]);
    await persistDayNow(dayKey);
```

- [ ] **Step 5: Sweep for the ones missed**

Search the renderer for `state.entries =` and confirm every remaining one is either
inside a render, or has no `await` anywhere above it in its function. Search for
`persistDayNow()` and confirm every call now passes a day. Report both lists in the
task report; a site left behind is the whole point of this task.

- [ ] **Step 6: Verify**

Run: `npm test` — 302 passing, unchanged.
Run: `npm run uicheck:fast` — 85 passed, 0 failed. Copy-previous-day, clear-day,
delete, split, duplicate, edit-task, work-description and quick-entry are all covered
there; a mistake in this task shows up as one of them failing.

- [ ] **Step 7: Commit**

```bash
git add renderer/js/sync.js renderer/js/copy-day.js renderer/js/entries.js renderer/js/timeline.js
git commit -m "Name the day at every write, not at every resolve"
```

---

## Task 6: Deleting a worklog stops blanking the day

**Files:**
- Modify: `renderer/js/day-range.js`
- Modify: `test/day-range.test.js`
- Modify: `renderer/js/state.js`
- Modify: `renderer/js/entries.js`
- Modify: `test-and-issues.md`

**The bug, as recorded in `test-and-issues.md` under Confirmed bugs.** After
"Delete in Jira too", *every* Manual Jira entry on that day disappears for one network
round trip and then comes back minus the deleted one. `deleteEntry` drops the whole
day from the external cache next to the successful `DELETE`, and the `renderAll()` that
follows paints before the refetch lands.

The fix the entry itself names: "removing one row from the cache rather than dropping
the day, which is worth doing when the week view makes a whole week's rows vanish
instead of a day's." Removing exactly the row that is gone leaves the cache correct,
so there is no refetch to wait for and no window to paint inside — and one fewer Jira
round trip on a path the user is waiting on.

- [ ] **Step 1: Write the failing test**

Append to `test/day-range.test.js`:

```js
test('withoutWorklog removes exactly the row for that worklog', () => {
  const rows = externalToEntries([
    { worklogId: '101', startTs: 1, endTs: 2, dayKey: '2026-07-28' },
    { worklogId: '102', startTs: 3, endTs: 4, dayKey: '2026-07-28' },
  ]);

  const left = withoutWorklog(rows, '102');
  assert.equal(left.length, 1);
  assert.equal(left[0].worklogId, '101');
  assert.notEqual(left, rows, 'a new array, so nothing mutates the cache in place');
});

test('withoutWorklog compares worklog ids as strings', () => {
  const rows = externalToEntries([{ worklogId: '102', startTs: 1, endTs: 2, dayKey: '2026-07-28' }]);
  // Jira answers with a string; a local entry may carry whatever it was given.
  assert.deepEqual(withoutWorklog(rows, 102), []);
});

test('withoutWorklog leaves a day it does not hold alone', () => {
  const rows = externalToEntries([{ worklogId: '101', startTs: 1, endTs: 2, dayKey: '2026-07-28' }]);
  assert.equal(withoutWorklog(rows, '999').length, 1);
  assert.deepEqual(withoutWorklog(undefined, '999'), []);
});
```

Add `withoutWorklog` to that file's import from `../renderer/js/day-range.js`, and
`externalToEntries` if it is not already imported there.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `withoutWorklog is not a function`.

- [ ] **Step 3: Add it to `renderer/js/day-range.js`**

```js
/**
 * One day's Jira-side rows with the row for `worklogId` taken out.
 *
 * A new array, never a splice: the cache holds these and a render may be reading
 * the old one. Ids are compared as strings because Jira answers with strings and a
 * local entry carries whatever the POST came back with.
 */
export function withoutWorklog(entries, worklogId) {
  const wanted = String(worklogId);
  return (entries ?? []).filter((e) => String(e.worklogId) !== wanted);
}
```

- [ ] **Step 4: Use it from `state.js`**

Add the import, and beside `invalidateExternal`:

```js
/**
 * Forget one Jira-side row, because the worklog behind it has just been deleted.
 *
 * The surgical form of `invalidateExternal`, and the reason there is one: dropping
 * the whole day made every Manual Jira entry on it vanish until a refetch landed,
 * which over a week would be a whole week's rows. Taking out the row that is
 * genuinely gone leaves the rest of the cache true, so nothing has to be re-read.
 */
export function dropExternalWorklog(dayKey, worklogId) {
  if (!state.external.has(dayKey)) return;
  state.external.set(dayKey, withoutWorklog(state.external.get(dayKey), worklogId));
}
```

- [ ] **Step 5: Use it from `entries.js`**

In `deleteEntry`, replace the `invalidateExternal(day)` call and its comment with:

```js
      // The cached Jira-side rows for this day were read before the DELETE, and one
      // of them stands for the worklog now gone. It is taken out here, next to the
      // DELETE that made it false, rather than by dropping the day and refetching:
      // dropping the day blanked every Manual Jira entry on it until the refetch
      // landed, which is bug-worthy on one day and unacceptable across a week.
      dropExternalWorklog(day, entry.worklogId);
```

Delete `deletedInJira` and the whole `if (deletedInJira) { await refreshExternal(day); }`
block at the end of the function, and its comment. The cache is now correct without a
re-read.

Remove `invalidateExternal` and `refreshExternal` from `entries.js`'s import of
`state.js` **only if nothing else in the file uses them** — check first.

- [ ] **Step 6: Verify**

Run: `npm test` — 305 passing.
Run: `npm run uicheck:fast` — 85 passed, 0 failed.

There is deliberately **no UI check for this fix**. Reaching it means deleting a real
Jira worklog, and the live and fixture runs must report the same counts — so a check
that can only run against the fake would break the one thing keeping the fake honest.
The pure helper carries the test; the wiring is three lines.

- [ ] **Step 7: Move the bug to fixed in `test-and-issues.md`**

Delete the whole "After deleting a worklog from Jira, the day briefly shows no
Jira-side rows at all" entry from **Confirmed bugs**, and add a dated block above the
`Fixed on 2026-07-30:` one:

```markdown
Fixed on 2026-08-05:

- **After deleting a worklog from Jira, the day briefly showed no Jira-side rows at
  all.** Not just the deleted one — every **Manual Jira entry** on that day vanished
  for one network round trip. `deleteEntry` dropped the whole day from the external
  cache next to the successful `DELETE`, and the `renderAll()` after it painted from
  an empty cache. Now the one row that is genuinely gone is taken out of the cache
  (`withoutWorklog` in `renderer/js/day-range.js`), which leaves the rest of it true
  and needs no refetch at all — one fewer round trip on a path the user is waiting on.
```

If **Confirmed bugs** is left with no entries, say so in a sentence rather than
leaving a bare heading: `Nothing open.`

- [ ] **Step 8: Commit**

```bash
git add renderer/js/day-range.js renderer/js/state.js renderer/js/entries.js test/day-range.test.js test-and-issues.md
git commit -m "Take one row out of the cache instead of the whole day"
```

---

## Task 7: Documentation and the version

**Files:**
- Modify: `CLAUDE.md`
- Modify: `test-and-issues.md`
- Modify: `package.json` (via `npm run bump`)

**Interfaces:** none — this task writes prose and a version.

- [ ] **Step 1: `CLAUDE.md` — the Working table**

Update the test counts in the *Tests* row: `305 passing, npm test; 85 UI checks,
npm run uicheck (or :fast)`. Confirm the numbers against an actual run rather than
trusting this plan — if they differ, the run is right.

- [ ] **Step 2: `CLAUDE.md` — the Next list**

Item 1 is *Week view*, and its body says the timeline generalisation "phase 1
deliberately left alone: the `view` singleton in `timeline.js` still ties every drag
handler to one column." That is no longer true. Rewrite item 1 so it names only what
is left:

```markdown
1. **Week view** — phase 3 of the sidebar work. Day columns, a work-week / 7-day
   toggle, a week stepper that names the ISO week, and dragging entries between days.
   The plumbing is in: the range data layer landed in 0.16.0, and the generalised
   timeline in 0.17.0 — `timeline-geometry.js` holds one hour range for however many
   columns are drawn, `timeline-columns.js` answers *which day* a point is in, and
   `timeline-drag.js` takes the day as an argument rather than assuming the selected
   one. What is left is the view itself.
```

- [ ] **Step 3: `CLAUDE.md` — a new deviation**

Append to *Deviations from this document, and why* as item 9:

```markdown
9. **The shared timeline geometry holds an hour, not a timestamp.** The week-view
   spec named it `{ rangeStartMs, pxPerMin, totalMinutes }`, which is the shape the
   day view's singleton had. One absolute `rangeStartMs` cannot serve several
   columns: each day's hour 7 is a different instant, and across a clock change two
   of them are not a constant apart. So `timeline-geometry.js` holds `startHour` and
   every conversion — `rangeStartMs(day)`, `offsetPxOf(ts, day)`,
   `tsAtOffsetPx(px, day)` — takes the day it is about. With one column it computes
   exactly what the singleton did.
```

- [ ] **Step 4: `CLAUDE.md` — a new convention**

Append to *Conventions*:

```markdown
- **A write names its day; a render reads the day on screen.** `state.entries` is a
  live view onto the selected day, so any assignment to it after an `await` files the
  result under whichever day is selected when the promise resolves — a sync that takes
  seconds, a modal the user is reading, a Jira `DELETE`. Every such path now captures
  `const day = state.selectedDate` before its first `await` and goes through
  `entriesFor(day)` / `setEntriesFor(day, …)` / `persistDayNow(day)`. The debounced
  write has the same rule in `day-writes.js`: what is owed is decided when the edit
  happens, not when the timer fires. Renders are the exception and stay as they are —
  "the day on screen" is exactly what they mean.
```

- [ ] **Step 5: `test-and-issues.md` — the counts**

Update the check count and the unit-test count wherever they appear (the *The script*
section, and any count in the header). The UI check count is unchanged at 85; the unit
test count changes.

- [ ] **Step 6: Bump and commit**

```bash
npm run bump
npm test
git add CLAUDE.md test-and-issues.md package.json package-lock.json
git commit -m "Generalise the timeline for the week view (0.17.0)"
```

Confirm `package.json` reads `0.17.0`. If `package-lock.json` was not touched, drop it
from the `git add`.

---

## Self-review notes for the controller

Three things this plan is deliberately doing, so a reviewer does not flag them as
mistakes:

1. **No new UI checks.** The spec says so, and Task 6's fix cannot have one — it needs
   a real Jira `DELETE`, and the live and fixture runs must report equal counts.
2. **`gridTimeAt` survives as a wrapper** rather than being replaced everywhere. The
   spec's constraint is that `drag-drop.js` does not change in this phase; it becomes
   `columnAt` in phase 3 when there is a second column to distinguish.
3. **Tasks 4–6 are behaviour changes in a phase that promises none.** Two are latent
   bugs that only a week view can trigger, and one is the recorded blanking bug the
   entry itself says to fix now. All three are the data-layer work phase 3 needs; the
   alternative is doing them inside the week-view commit, where a regression would be
   indistinguishable from the new view's own.
