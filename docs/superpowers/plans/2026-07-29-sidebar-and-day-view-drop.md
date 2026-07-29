# Sidebar Shell and Drag-to-Day-View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Joggl a collapsible left sidebar that will carry the day, week and month views, move the settings button into it, and let an issue be dragged out of the task list onto the day view to book a 30-minute block.

**Architecture:** A new `renderer/js/shell.js` owns the sidebar, the collapse state and a view registry; the day view registers a mount/unmount pair that only toggles `hidden` on the markup that already exists, so no working day-view code moves. A new `renderer/js/drag-issue.js` owns the drag gesture using mouse events, matching how the day view's own move and resize already work. `timeline.js` gains three small exports for resolving a cursor position to a time and drawing a drop preview; its render and drag paths are untouched.

**Tech Stack:** Electron 43, plain ES modules in the renderer, no framework, no build step. Tests are `node --test` via `npm test`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-29-sidebar-and-day-view-drop-design.md`. Read it before starting.
- **No new dependencies.** Not one. `package.json` gains nothing.
- **No new Jira calls.** This phase is entirely local. If you find yourself adding an IPC channel, you have gone off plan.
- **Renderer has no Node and no network.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Everything here is renderer-side and reaches main only through the existing `window.joggl` bridge.
- **Icons are inline SVG only.** The renderer CSP is `default-src 'none'`, so no external images, fonts or sheets. Follow `renderer/js/icons.js`, whose `svg()` helper produces a `.glyph` element that inherits `currentColor`. `.glyph` sets `fill: currentColor`, so draw **filled** shapes, not stroked ones.
- **Timestamps are epoch ms** internally; convert to local wall clock only at the render boundary. Never `toISOString()` for a date key.
- **Snapping** uses `snapToQuarter(ts, dayKey)` from `renderer/js/util.js`, which snaps wall-clock time measured from local midnight. Never snap a drag offset.
- **Do not change `renderTimeline`, `onResize`, `onMoveBlock`, `placeBlock`, `computeColumns` or `liveUpdate`.** `CLAUDE.md` states the drag and snap edge cases in `timeline.js` were settled by use rather than design; treat behaviour changes there as regressions. The one exception is the `onGridClick` change in Task 3, which is specified exactly.
- **Do not touch `legacy/`.** Read-only reference.
- **Use file tools, not shell, for reading and writing files.** Shell is for `npm` and `git` only.
- **Run tests with:** `npm test` (from `F:\Code\Joggl`). 65 tests pass before you start; none may break.
- **Commit after every task.** End commit messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

### A note on verification in this plan

Task 1 is pure logic and gets a real TDD cycle. Tasks 2 to 4 are DOM, CSS and mouse
handling, and this project has no DOM test harness — `CLAUDE.md` says full UI coverage
is deliberately not the goal, and adding jsdom or Playwright would violate the
no-new-dependencies constraint. Those tasks are verified by running the app with
`npm start` and checking named, observable behaviour. Do not fake a test cycle where
there is no harness, and do not add one.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `renderer/js/shell.js` | The sidebar: tab wiring, active view, collapse state, hover peek, and the `setDragging` suppression hook. The only module that knows the sidebar exists. |
| `renderer/js/drag-issue.js` | The whole drag gesture, from `mousedown` on a task row to the entry a drop creates. |

**Modify:**

| File | Change |
|---|---|
| `renderer/index.html` | Wrap everything in `.shell`, add `<nav id="sidebar">`, move `#settings-btn` into it, give `.app-layout` the id `view-day`. |
| `renderer/css/app.css` | Sidebar, peek, drop preview, drag ghost; `[hidden]` rule; `.app-layout` loses its own height. |
| `renderer/js/icons.js` | `DAY_ICON`, `WEEK_ICON`, `MONTH_ICON`, `SETTINGS_ICON`, `CHEVRON_ICON`. |
| `renderer/js/entry-ops.js` | `DEFAULT_DROP_MS`, `dropEntryFor`. |
| `renderer/js/timeline.js` | `gridTimeAt`, `showDropPlaceholder`, `hideDropPlaceholder`; `onGridClick` calls `gridTimeAt`. |
| `renderer/js/tasks.js` | One line: task rows carry `data-key`. |
| `renderer/js/app.js` | Boot wiring: `wireShell`, register the day view, `wireIssueDrag`. |
| `main/settings.js` | Two new keys in `UI_DEFAULTS`. |
| `test/entry-ops.test.js` | Tests for `dropEntryFor`. |
| `CLAUDE.md` | Narrow the future-start rule; record the new feature in the status table. |

---

## Task 1: The entry a drop creates

The pure function first, because every later task depends on the shape it returns and
on the midnight rule it encodes. It lives in `entry-ops.js`, which exists for exactly
this — "pure transforms on entries, no DOM, no IPC" — next to `duplicateOf`, whose
`(entry, newId)` signature it mirrors.

**Files:**
- Modify: `renderer/js/entry-ops.js` (append after `duplicateOf`, before `overlappingIds`)
- Modify: `CLAUDE.md` (the *Validation* section under *Domain rules*)
- Test: `test/entry-ops.test.js` (append a new section at the end)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_DROP_MS: number` — `30 * 60_000`.
  - `dropEntryFor(issue, newId, startTs, dayStartTs, durationMs = DEFAULT_DROP_MS)` where `issue` is `{ issueKey: string, issueId: string｜null, title: string }`, `newId` is a string, and the rest are epoch ms. Returns an entry `{ id, issueKey, issueId, title, startTs, endTs, status: 'pending', worklogId: null, errorMsg: null }`. Never throws, never mutates its arguments.

- [ ] **Step 1: Write the failing tests**

Append to the end of `test/entry-ops.test.js`. Note the existing file already imports
`planFinishDay` and defines `T(h, m)` for 28 July 2026 — reuse both.

```js
// ── What a drop onto the day view creates ───────────────────────────────────

const DAY_START = T(0);

const dropped = { issueKey: 'PROJ-1', issueId: '10001', title: 'Meetings' };

test('a dropped issue becomes a pending entry of exactly 30 minutes', () => {
  const e = dropEntryFor(dropped, 'e1', T(9, 15), DAY_START);
  assert.equal(e.startTs, T(9, 15));
  assert.equal(e.endTs, T(9, 45));
  assert.equal(e.endTs - e.startTs, DEFAULT_DROP_MS);
  assert.equal(e.status, 'pending');
  assert.equal(e.worklogId, null);
  assert.equal(e.errorMsg, null);
});

test('the dropped entry carries the issue, the title and the given id', () => {
  const e = dropEntryFor(dropped, 'e1', T(9), DAY_START);
  assert.equal(e.id, 'e1');
  assert.equal(e.issueKey, 'PROJ-1');
  assert.equal(e.issueId, '10001');
  assert.equal(e.title, 'Meetings');
});

test('a drop near midnight is pulled back so the block ends on it', () => {
  const e = dropEntryFor(dropped, 'e1', T(23, 45), DAY_START);
  assert.equal(e.endTs, DAY_START + 86_400_000, 'ends exactly at midnight');
  assert.equal(e.startTs, T(23, 30));
  assert.equal(e.endTs - e.startTs, DEFAULT_DROP_MS, 'and keeps its full length');
});

test('a start later than now is allowed, so leave can be booked ahead', () => {
  // Far enough ahead that it is in the future whatever day the test runs on.
  const farStart = new Date(2099, 0, 1, 0, 0, 0, 0).getTime();
  const e = dropEntryFor(dropped, 'e1', farStart + 9 * 3_600_000, farStart);
  assert.equal(e.status, 'pending', 'nothing is rejected for being in the future');
  assert.equal(e.startTs, farStart + 9 * 3_600_000);
});

test('a dropped entry syncs like any other pending entry', () => {
  const e = dropEntryFor(dropped, 'e1', T(9), DAY_START);
  assert.deepEqual(planFinishDay([e]).toSubmit.map((x) => x.id), ['e1']);
});

test('dropEntryFor does not mutate the issue it was given', () => {
  const issue = { ...dropped };
  dropEntryFor(issue, 'e1', T(9), DAY_START);
  assert.deepEqual(issue, dropped);
});
```

Change the existing import line at the top of the file from:

```js
import { duplicateOf, overlappingIds } from '../renderer/js/entry-ops.js';
```

to:

```js
import { DEFAULT_DROP_MS, dropEntryFor, duplicateOf, overlappingIds } from '../renderer/js/entry-ops.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`

Expected: the six new tests fail. Because the import is of a name that does not exist,
`dropEntryFor` is `undefined` and each failure reads `TypeError: dropEntryFor is not a
function`. The 65 existing tests still pass.

- [ ] **Step 3: Write the implementation**

Append to `renderer/js/entry-ops.js`, after `duplicateOf` and before `overlappingIds`:

```js
/** A block drawn by hand on the day view is half an hour wherever it lands. */
export const DEFAULT_DROP_MS = 30 * 60_000;

/**
 * The entry created by dropping an issue onto the day view.
 *
 * `startTs` arrives already snapped to a quarter hour, so the only adjustment made
 * here is at the end of the day: a block that would run past midnight is pulled
 * back to end on it rather than being shortened, because a 30-minute drop that
 * silently became a 15-minute entry would be a worse surprise than one that sits a
 * quarter hour earlier than aimed.
 *
 * A start later than the current time is deliberately allowed. Booking leave, an
 * out-of-office block, or a meeting already in the diary is the reason to draw a
 * block by hand instead of running a timer, and Finish Day submits such an entry
 * like any other. Only a *running timer* may not start in the future — that would
 * have it measuring negative elapsed time.
 *
 * The status is always `pending`: everything in the task list came from Jira and so
 * carries an issue key. There is no keyless path into this function.
 */
export function dropEntryFor(issue, newId, startTs, dayStartTs, durationMs = DEFAULT_DROP_MS) {
  const latestStart = dayStartTs + 86_400_000 - durationMs;
  const start = Math.min(Math.max(startTs, dayStartTs), latestStart);

  return {
    id: newId,
    issueKey: issue.issueKey,
    issueId: issue.issueId ?? null,
    title: issue.title,
    startTs: start,
    endTs: start + durationMs,
    status: 'pending',
    worklogId: null,
    errorMsg: null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: all pass — 65 previous plus 6 new, 71 total.

- [ ] **Step 5: Narrow the future-start rule in `CLAUDE.md`**

In the *Validation* section under *Domain rules*, replace this line:

```markdown
- Start time may not be in the future.
```

with:

```markdown
- A **running timer's** start may not be in the future — it would measure negative
  elapsed time. Entries drawn by hand may be: dropping an issue at 18:00 while it is
  14:00 books leave, an out-of-office block, or a meeting already in the diary, and
  Finish Day submits it like any other pending entry. The constraint therefore lives
  on the omnibar start-time field, not on entry creation.
```

- [ ] **Step 6: Commit**

```bash
git add renderer/js/entry-ops.js test/entry-ops.test.js CLAUDE.md
git commit -m "Add the entry shape a day-view drop creates

Half an hour, pulled back rather than shortened at midnight, and allowed to
start in the future so leave and known meetings can be booked ahead. That last
part narrows the documented rule to the running timer, which is the only place
a future start actually breaks anything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The sidebar shell

The sidebar, the view registry and the collapse state. At the end of this task the app
looks different and the settings button has moved, but the day view behaves exactly as
before.

**Files:**
- Create: `renderer/js/shell.js`
- Modify: `renderer/js/icons.js`
- Modify: `renderer/index.html:15-95`
- Modify: `renderer/css/app.css` (the `[hidden]` rule near `.hidden` at line 25; `.app-layout` at line 102; a new section after it)
- Modify: `renderer/js/app.js` (imports, and the boot wiring block)
- Modify: `main/settings.js:76-81` (`UI_DEFAULTS`)

**Interfaces:**
- Consumes: `saveUi(patch)` and `state.ui` from `state.js`; the `svg()` pattern in `icons.js`.
- Produces:
  - `registerView(id: string, view: { mount(): void, unmount(): void }): void`
  - `setActiveView(id: string): void` — no-op if `id` is already active or unregistered.
  - `setDragging(value: boolean): void` — `true` closes any open peek and blocks a new one.
  - `wireShell(): void` — call once at boot, **after** `loadUi()` has resolved.
  - `DAY_ICON`, `WEEK_ICON`, `MONTH_ICON`, `SETTINGS_ICON`, `CHEVRON_ICON` from `icons.js`, each an SVG string.

- [ ] **Step 1: Add the icons**

Append to `renderer/js/icons.js`. All shapes are filled, because `.glyph` sets
`fill: currentColor` and a stroked path would come out invisible.

```js
// One column, three columns, a month of squares. Filled rather than stroked so
// they work with `.glyph { fill: currentColor }` like the two above.
export const DAY_ICON = svg('<rect x="4.4" y="1.5" width="3.2" height="9" rx="1" />');

export const WEEK_ICON = svg(
  '<rect x="1.2" y="1.5" width="2.4" height="9" rx=".8" />' +
    '<rect x="4.8" y="1.5" width="2.4" height="9" rx=".8" />' +
    '<rect x="8.4" y="1.5" width="2.4" height="9" rx=".8" />',
);

export const MONTH_ICON = svg(
  [0, 1, 2]
    .flatMap((row) => [0, 1, 2].map((col) => ({ row, col })))
    .map(({ row, col }) => `<rect x="${1.2 + col * 3.6}" y="${1.2 + row * 3.6}" width="2.6" height="2.6" rx=".6" />`)
    .join(''),
);

// Sliders rather than a gear: a gear needs an outline to read at 14 px, and an
// outline needs a stroke.
export const SETTINGS_ICON = svg(
  '<rect x="1" y="2.1" width="10" height="1.2" rx=".6" /><circle cx="7.7" cy="2.7" r="1.7" />' +
    '<rect x="1" y="5.4" width="10" height="1.2" rx=".6" /><circle cx="4.1" cy="6" r="1.7" />' +
    '<rect x="1" y="8.7" width="10" height="1.2" rx=".6" /><circle cx="8.4" cy="9.3" r="1.7" />',
);

// Points left. Collapsed, CSS rotates it rather than swapping in a second icon.
export const CHEVRON_ICON = svg('<path d="M7.4 1.6 8.6 2.8 5.4 6l3.2 3.2-1.2 1.2L3 6Z" />');
```

- [ ] **Step 2: Add the two UI prefs to the main-process defaults**

`saveUiPrefs` in `main/settings.js` merges any patch without a whitelist, so this is
not strictly required for the keys to persist — it is here so the defaults are written
down in one place. Change `UI_DEFAULTS` at `main/settings.js:76`:

```js
const UI_DEFAULTS = {
  zoomIdx: 2,
  fontSize: 9,
  panelWidth: 320,
  theme: 'system', // system | light | dark
  sidebarCollapsed: false,
  activeView: 'day', // day | week | month — week and month arrive in later phases
};
```

- [ ] **Step 3: Restructure the markup**

In `renderer/index.html`, replace the opening of the body block. The line
`<div class="app-layout">` at line 16 becomes the sidebar plus a re-opened layout
div carrying an id:

```html
    <div class="shell">
      <nav id="sidebar" class="sidebar">
        <div class="sidebar-brand">
          <span class="sidebar-brand-name">Joggl</span>
          <button id="sidebar-toggle" class="sidebar-toggle" title="Collapse sidebar"
                  aria-label="Collapse sidebar"></button>
        </div>

        <div class="sidebar-tabs">
          <button class="sidebar-item" data-view="day">
            <span class="sidebar-icon"></span><span class="sidebar-label">Day View</span>
          </button>
          <button class="sidebar-item" data-view="week" disabled aria-disabled="true"
                  title="Not built yet">
            <span class="sidebar-icon"></span><span class="sidebar-label">Week View</span>
          </button>
          <button class="sidebar-item" data-view="month" disabled aria-disabled="true"
                  title="Not built yet">
            <span class="sidebar-icon"></span><span class="sidebar-label">Month View</span>
          </button>
        </div>

        <div class="sidebar-spacer"></div>

        <button id="settings-btn" class="sidebar-item" title="Settings">
          <span class="sidebar-icon"></span><span class="sidebar-label">Settings</span>
        </button>
      </nav>

      <div class="app-layout" id="view-day">
```

Then two more edits inside that block:

1. Delete the old settings button from `.day-header-right` (line 53):

```html
            <button id="settings-btn" class="icon-square" title="Settings">⚙</button>
```

The id moves to the sidebar button above; `settings-ui.js:158` binds by id, so no JS
change is needed for the button to keep working.

2. Close the new wrapper. The `</div>` that currently closes `.app-layout` at line 95
gains a sibling:

```html
      </div>
    </div>
```

Leave everything else in the body — `#ctx-menu`, `#toast-stack` and the four overlays —
outside `.shell`, exactly where it is.

- [ ] **Step 4: Add the styles**

Three edits to `renderer/css/app.css`.

First, next to `.hidden` at line 25, add a rule for the `hidden` attribute. This is not
optional: `.app-layout` sets `display: flex`, which beats the user-agent `display: none`
that `hidden` relies on, so without this the day view would never actually hide.

```css
/* `display: flex` on a view container would otherwise beat the user-agent rule
   that makes [hidden] hide, and the hidden view would stay on screen. */
[hidden] {
  display: none !important;
}
```

Second, replace `.app-layout` at line 102. It is no longer the top-level box, so it
gives up owning the viewport height:

```css
.app-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

Third, insert this section immediately before the `/* ── Two-panel layout ── */`
comment at line 100:

```css
/* ── Shell and sidebar ── */

.shell {
  display: flex;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  /* Anchors the peek, which floats over the content rather than pushing it. */
  position: relative;
}

.sidebar {
  width: 168px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 6px;
  background: var(--bg-sunken);
  border-right: 1px solid var(--border);
  overflow: hidden;
  white-space: nowrap;
  transition: width 120ms ease;
}

.sidebar.collapsed {
  width: 44px;
}

/* Peek sits above the task dropdown (200) and below the modal overlay (500), so a
   modal is never obscured by a sidebar the mouse happens to be resting on. */
.sidebar.collapsed.peek {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 168px;
  z-index: 400;
  background: var(--surface-raised);
  box-shadow: var(--shadow-lg);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 4px;
  margin-bottom: 6px;
}

.sidebar-brand-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
}

.sidebar-toggle {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
}

.sidebar-toggle:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.sidebar.collapsed .sidebar-toggle .glyph {
  transform: rotate(180deg);
}

.sidebar-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px;
  background: none;
  border: none;
  border-left: 3px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.sidebar-item:hover:not(:disabled) {
  background: var(--accent-softer);
  color: var(--text);
}

.sidebar-item.is-active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.sidebar-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sidebar-icon {
  display: flex;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
}

.sidebar-icon .glyph {
  width: 14px;
  height: 14px;
}

.sidebar-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-spacer {
  flex: 1;
  min-height: 8px;
}

/* Collapsed and not peeking, the rail is icons only and they centre. */
.sidebar.collapsed:not(.peek) .sidebar-brand-name,
.sidebar.collapsed:not(.peek) .sidebar-label {
  display: none;
}

.sidebar.collapsed:not(.peek) .sidebar-brand {
  justify-content: center;
  padding: 0;
}

.sidebar.collapsed:not(.peek) .sidebar-item {
  justify-content: center;
  padding: 8px 4px;
}
```

- [ ] **Step 5: Write `renderer/js/shell.js`**

```js
// The app shell: the sidebar, which view is showing, and whether the rail is
// collapsed.
//
// Views register a mount/unmount pair instead of being switched on by name here, so
// the week and month views can be added without this module learning anything about
// them. The day view's pair only toggles `hidden` on markup that already exists —
// nothing about the working day view moves into a builder function.

import { CHEVRON_ICON, DAY_ICON, MONTH_ICON, SETTINGS_ICON, WEEK_ICON } from './icons.js';
import { saveUi, state } from './state.js';

/** Long enough that crossing the rail on the way somewhere else does not open it. */
const PEEK_DELAY_MS = 180;

const views = new Map();
let activeId = null;
let peekTimer = null;
let dragging = false;

export function registerView(id, view) {
  views.set(id, view);
}

export function setActiveView(id) {
  if (id === activeId) return;
  const next = views.get(id);
  if (!next) return;

  views.get(activeId)?.unmount();
  activeId = id;
  next.mount();

  for (const button of document.querySelectorAll('.sidebar-item[data-view]')) {
    const isActive = button.dataset.view === id;
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  if (state.ui.activeView !== id) saveUi({ activeView: id }).catch(() => {});
}

/**
 * Called by the drag gesture. A peek opening under the cursor mid-drag would slide
 * over the day view and swallow the drop target, so while a drag is running the rail
 * stays a rail.
 */
export function setDragging(value) {
  dragging = value;
  if (!value) return;
  clearTimeout(peekTimer);
  document.getElementById('sidebar')?.classList.remove('peek');
}

function applyCollapsed(collapsed) {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed', collapsed);
  if (!collapsed) sidebar.classList.remove('peek');

  const toggle = document.getElementById('sidebar-toggle');
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
}

/** Call once at boot, after loadUi() has resolved — the collapse state comes from it. */
export function wireShell() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');

  toggle.innerHTML = CHEVRON_ICON;

  const icons = { day: DAY_ICON, week: WEEK_ICON, month: MONTH_ICON };
  for (const button of sidebar.querySelectorAll('.sidebar-item[data-view]')) {
    button.querySelector('.sidebar-icon').innerHTML = icons[button.dataset.view] ?? '';
    button.addEventListener('click', () => setActiveView(button.dataset.view));
  }
  document.querySelector('#settings-btn .sidebar-icon').innerHTML = SETTINGS_ICON;

  applyCollapsed(Boolean(state.ui.sidebarCollapsed));

  toggle.addEventListener('click', async () => {
    const collapsed = !sidebar.classList.contains('collapsed');
    applyCollapsed(collapsed);
    await saveUi({ sidebarCollapsed: collapsed });
  });

  sidebar.addEventListener('mouseenter', () => {
    if (dragging || !sidebar.classList.contains('collapsed')) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      if (!dragging) sidebar.classList.add('peek');
    }, PEEK_DELAY_MS);
  });

  sidebar.addEventListener('mouseleave', () => {
    clearTimeout(peekTimer);
    sidebar.classList.remove('peek');
  });
}
```

- [ ] **Step 6: Wire it into boot**

In `renderer/js/app.js`, add the import to the block at the top, after the `./render.js`
one (the existing block is roughly alphabetical by module path; match it rather than
reordering anything):

```js
import { registerView, setActiveView, wireShell } from './shell.js';
```

Then in `boot()`, immediately after the line `updateZoomLabel();` (currently
`app.js:81`) and before the `registerRenderer(...)` block, insert:

```js
  wireShell();
  registerView('day', {
    mount() {
      $('view-day').hidden = false;
    },
    unmount() {
      $('view-day').hidden = true;
    },
  });
  // Hardcoded rather than restored from state.ui.activeView: week and month do not
  // exist yet, and restoring a view that is not registered would leave a blank app.
  setActiveView('day');
```

- [ ] **Step 7: Verify the unit tests still pass**

Run: `npm test`

Expected: 71 pass. Nothing in this task touched tested code, so a failure here means
something was edited by accident.

- [ ] **Step 8: Verify in the running app**

Run: `npm start`

Check each of these:

1. The sidebar shows on the left with Joggl, three tabs and Settings at the bottom.
2. Day View is highlighted with a left accent bar; Week View and Month View are dimmed
   and do nothing when clicked, and hovering them says "Not built yet".
3. The Settings button at the bottom opens the settings overlay; Close still closes it.
   There is no settings button in the day header any more.
4. The day view above is unchanged: timer, day nav, pins, entry list, task list, and
   the timeline on the right at its remembered width.
5. Clicking the toggle collapses the rail to icons; the chevron flips; the content
   shifts left. Clicking again expands it.
6. Collapse it, quit the app entirely, start it again — it comes back collapsed. Expand
   it, quit, restart — it comes back expanded.
7. Collapsed, resting the mouse on the rail floats it open over the content after a
   beat, and the content underneath does **not** move. Moving the mouse off closes it.
8. Sweeping the mouse quickly across the rail on the way to the entry list does not
   open the peek.

- [ ] **Step 9: Commit**

```bash
git add renderer/index.html renderer/css/app.css renderer/js/icons.js renderer/js/shell.js renderer/js/app.js main/settings.js
git commit -m "Add a collapsible sidebar and move Settings into it

Views register a mount/unmount pair rather than being switched on by name in
the shell, so the week and month views can be added without the sidebar
learning about them. The day view's pair only toggles \`hidden\` on markup that
already exists, so no working day-view code moves.

The [hidden] rule is load-bearing: .app-layout sets display:flex, which beats
the user-agent rule that makes the attribute hide anything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Resolving a cursor position to a time, and the drop preview

Three exports on `timeline.js` so the drag can ask where the cursor is pointing and
draw what a drop would produce. Nothing in the existing render or drag paths changes,
with one specified exception: `onGridClick` stops carrying its own copy of the
cursor-to-timestamp arithmetic.

**Files:**
- Modify: `renderer/js/timeline.js` (add exports after `placeBlock`; rewrite `onGridClick` at lines 371-384)
- Modify: `renderer/css/app.css` (new rule after `.sched-entry-block.dragging`, line 967)

**Interfaces:**
- Consumes: the module-private `view` object and `placeBlock` inside `timeline.js`.
- Produces:
  - `gridTimeAt(clientY: number): number｜null` — the quarter-hour-snapped timestamp the cursor points at on the selected day, or `null` when the grid is absent or the position falls outside it.
  - `showDropPlaceholder(startTs: number, endTs: number): void` — creates or moves a single `.sched-drop-preview` element inside the grid, labelled `HH:MM – HH:MM`.
  - `hideDropPlaceholder(): void` — removes it. Safe to call when none exists.

- [ ] **Step 1: Add the three exports**

In `renderer/js/timeline.js`, insert after `placeBlock` (which ends at line 177) and
before `buildBlock`:

```js
/**
 * The snapped timestamp a cursor position points at, or null when it falls outside
 * the grid.
 *
 * getBoundingClientRect is viewport-relative and already accounts for the panel's
 * scroll position. Adding scrollTop on top of it — as the plugin did — counted the
 * scroll twice, so once the view had auto-scrolled to now, a click at 16:00 landed
 * somewhere around 21:00. That is why this arithmetic exists exactly once.
 */
export function gridTimeAt(clientY) {
  const grid = document.getElementById('schedule-grid');
  if (!grid) return null;

  const y = clientY - grid.getBoundingClientRect().top;
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
```

`snapToQuarter`, `tsToHHMM` and `state` are already imported in this file; do not add
imports.

- [ ] **Step 2: Make `onGridClick` use it**

Replace the body of `onGridClick` (lines 371-384) with:

```js
export function onGridClick(event) {
  if (event.target.closest('.sched-entry-block') || event.target.closest('.sched-handle')) return;

  const startTs = gridTimeAt(event.clientY);
  if (startTs === null) return;

  showQuickEntry(event.clientX, event.clientY, startTs, startTs + 30 * 60_000);
}
```

The long comment about the double-counted scroll moves to `gridTimeAt`, where the
arithmetic now lives; it is already in the text you added in Step 1. Do not leave a
second copy behind.

- [ ] **Step 3: Style the preview**

In `renderer/css/app.css`, after the `.sched-entry-block.dragging` rule (line 967),
add:

```css
/* What a dropped issue would become. Dashed like the live block, but it is not an
   entry and must never intercept the mouse that is placing it. */
.sched-drop-preview {
  position: absolute;
  border: 1.5px dashed var(--accent);
  border-radius: 3px;
  background: var(--accent-softer);
  pointer-events: none;
  z-index: 15;
}
```

- [ ] **Step 4: Verify the unit tests still pass**

Run: `npm test`

Expected: 71 pass.

- [ ] **Step 5: Verify the quick-entry popup did not regress**

This step exists because Step 2 edited a working code path. Run: `npm start`

1. Click an empty part of the timeline. The quick-entry popup opens and its time line
   reads the quarter hour you clicked, as it did before.
2. Zoom in twice with `+`, scroll the timeline down, and click an empty spot at a
   labelled hour — say 16:00. The popup must say 16:00, not some later hour. This is
   the exact bug the comment in `gridTimeAt` describes.
3. Zoom out to 0.5× and repeat: the popup time still matches the row clicked.
4. Type a name, press Enter, and confirm the entry appears at that time.

- [ ] **Step 6: Commit**

```bash
git add renderer/js/timeline.js renderer/css/app.css
git commit -m "Extract gridTimeAt and add a drop preview to the day view

The cursor-to-timestamp arithmetic was inline in onGridClick and is about to be
needed by the drag gesture as well. It is the calculation that once counted the
panel scroll twice and put a click at 16:00 near 21:00, so it gets to exist
once and nowhere else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The drag gesture

**Files:**
- Create: `renderer/js/drag-issue.js`
- Modify: `renderer/js/tasks.js:179` (one line in `issueRow`)
- Modify: `renderer/css/app.css` (new section before `/* ── Toasts ── */`, near line 1328)
- Modify: `renderer/js/app.js` (import, and one call in the wiring block)

**Interfaces:**
- Consumes: `dropEntryFor` (Task 1 — the default duration is its own default, so `DEFAULT_DROP_MS` is not imported here); `gridTimeAt`, `showDropPlaceholder`, `hideDropPlaceholder` (Task 3); `setDragging` (Task 2); `state`, `persistDayNow` from `state.js`; `renderAll` from `render.js`; `esc`, `startOfDayMs`, `uuid` from `util.js`.
- Produces: `wireIssueDrag(): void` — call once at boot.

- [ ] **Step 1: Let a task row say which issue it is**

In `renderer/js/tasks.js`, in `issueRow`, add one line after `row.className = ...`
(line 179):

```js
  row.dataset.key = issue.issueKey;
```

- [ ] **Step 2: Write `renderer/js/drag-issue.js`**

```js
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
```

- [ ] **Step 3: Style the ghost**

In `renderer/css/app.css`, insert before the `.toast-stack` rule (line 1328):

```css
/* ── Dragging an issue onto the day view ── */

/* Above the quick-entry popup (3000) so it is never hidden behind one that was left
   open, but below the toasts (4000). */
.drag-ghost {
  position: fixed;
  z-index: 3500;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 5px 9px;
  background: var(--surface-raised);
  border: 1.5px solid var(--accent);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  font-size: 12px;
  pointer-events: none;
}

.drag-ghost-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* The cursor has to say "carrying something" everywhere, not just over the row it
   started on. */
body.is-dragging-issue,
body.is-dragging-issue * {
  cursor: grabbing !important;
}
```

- [ ] **Step 4: Wire it into boot**

In `renderer/js/app.js`, add the import after the `./context-menu.js` one:

```js
import { wireIssueDrag } from './drag-issue.js';
```

Then in `boot()`, add a call to the wiring block, after `wireDayView();`:

```js
  wireIssueDrag();
```

- [ ] **Step 5: Verify the unit tests still pass**

Run: `npm test`

Expected: 71 pass.

- [ ] **Step 6: Verify in the running app**

Run: `npm start`

1. **A click still starts a timer.** Click a task in the Issues list. The timer starts,
   as before, and no entry is created on the timeline.
2. **A drag creates a block.** Press on a task, move onto the timeline. A ghost with
   the key and title follows the cursor, and a dashed preview snaps to quarter hours
   showing `HH:MM – HH:MM`. Release: a 30-minute pending entry appears there, in both
   the timeline and the entry list.
3. **Aim is true at every zoom.** Repeat the drop at 0.5×, 1×, 2× and 3× zoom, with the
   timeline scrolled. The entry must land on the quarter hour the preview showed.
4. **Auto-scroll.** Zoom to 3× so the grid is far taller than the panel. Drag a task and
   hold the cursor near the top edge of the timeline: it scrolls, and the preview keeps
   up. Same at the bottom edge.
5. **Cancelling.** Drag a task and release over the left panel — nothing is created and
   no toast appears. Drag another and press Escape mid-drag — the ghost and preview
   vanish and nothing is created.
6. **The peek stays shut.** Collapse the sidebar. Drag a task slowly across the rail on
   the way to the timeline: the sidebar must not float open.
7. **No merging.** Drop the same issue twice, an hour apart, on an issue that already
   has an entry today. Two separate entries, each where it was dropped, no merge prompt.
8. **Overlaps.** Drop an issue on top of an existing entry. Both are flagged as
   overlapping and the timeline splits them into side-by-side columns.
9. **A past day.** Step back a day with `‹` and drop a task. It lands, and it is still
   there after quitting and restarting.
10. **A future block.** On today, drop a task at an hour later than now. The entry is
    created. Press Finish Day and confirm it comes back `synced` with a worklog.
11. **Persistence.** Quit and restart. Every dropped entry is still on its day.

- [ ] **Step 7: Commit**

```bash
git add renderer/js/drag-issue.js renderer/js/tasks.js renderer/js/app.js renderer/css/app.css
git commit -m "Drag an issue from the task list onto the day view

Mouse events, not HTML5 drag-and-drop: the day view's move and resize already
work this way and the ghost is then ours to position. A 4 px threshold keeps a
single click on a task starting a timer, and a short click-swallowing window
after the drag stops a release over the original row from starting one too.

The preview is built through dropEntryFor, so what is drawn is exactly what
the drop will create rather than a second guess at the midnight rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Record it and run the full pass

**Files:**
- Modify: `CLAUDE.md` (the *Working* table and the *Next, roughly in order* list under *Status*)

- [ ] **Step 1: Add the feature to the status table**

In `CLAUDE.md`, under *Status — where the port actually is* → *Working*, add two rows to
the table, after the `Logging` row:

```markdown
| Shell | Collapsible sidebar with a view registry; week and month tabs present but disabled |
| Drag to day view | An issue dragged from the task list becomes a 30-minute pending entry |
```

- [ ] **Step 2: Update what comes next**

In the *Next, roughly in order* list, replace item 1 and 2 — tray icon states and
keyboard-first start/stop — with the two views now specified, keeping the rest of the
list below them:

```markdown
1. **Week view** — phase 2 of the sidebar work. Day columns, a work-week / 7-day
   toggle, a week stepper that names the week of the month, and dragging entries
   between days. Needs the multi-day state and the generalised timeline column that
   phase 1 deliberately left alone: the `view` singleton in `timeline.js` still ties
   every drag handler to one column.
2. **Month view** — phase 3. A calendar grid with hours logged per day, and the day
   view beside it showing whichever day was clicked.
3. **Tray icon states** — the icon should show at a glance whether a timer is running.
   Right now the only signal is opening the window.
4. **Keyboard-first start/stop** — a global shortcut exists for showing the window;
   starting the last task without touching the mouse is the obvious next one.
```

Renumber the remaining items (pagination for busy issues, splitting a synced entry,
macOS build, auto-update) so the list runs 5 to 8.

- [ ] **Step 3: Run the tests one final time**

Run: `npm test`

Expected: 71 pass, 0 fail.

- [ ] **Step 4: Confirm the whole feature end to end**

Run: `npm start` and walk the checklist from the spec's *Manual verification* section
once more in a single sitting, on a fresh start of the app:

- collapse state survives quitting and restarting
- peek does not open while dragging an issue across the sidebar
- a single click on a task still starts a timer and creates no entry
- a drop lands on the hour aimed at, at every zoom level and with the grid scrolled
- a drop on a past day persists and is still there after a restart
- a drop over an existing entry is flagged as overlapping and the overlap columns
  still lay out correctly
- a future-dated entry syncs on Finish Day and comes back as a real Jira worklog

Report the result honestly. If anything in this list fails, it is a bug in this phase,
not a follow-up.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "Record the sidebar and day-view drop in the status

Week and month view move to the top of what comes next, with a note that the
timeline refactor they need was deliberately left out of phase 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

Checked against the spec:

- Sidebar layout, contents, tab order, disabled week/month, settings at the bottom — Task 2
- Collapse widths, persistence, hover peek with its delay and drag suppression — Task 2
- Icons as inline SVG — Task 2, Step 1
- View registry with day registering a `hidden` toggle — Task 2, Steps 5 and 6
- 4 px threshold, ghost, dashed preview, Escape, silent cancel — Task 4
- 30-minute `pending` entry, snapping, midnight clamp, no merging, future starts, past days — Task 1 and Task 4
- Auto-scroll at 24 px / 8 px per frame — Task 4
- `gridTimeAt` extracted with one copy of the arithmetic, plus the two placeholder helpers — Task 3
- `dropEntryFor` unit tests, three spec cases plus id/mutation coverage — Task 1
- The `CLAUDE.md` amendment narrowing the future-start rule — Task 1, Step 5
- The manual verification checklist — Task 5, Step 4

One thing the spec left implicit and this plan makes explicit: the `[hidden]` CSS rule
in Task 2, Step 4. `.app-layout` sets `display: flex`, which overrides the user-agent
rule behind the `hidden` attribute, so without it the day view would never hide and
phase 2's week view would render on top of it.
