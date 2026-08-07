# Week View — Phase 4: Selecting and Copying — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selection a set rather than one id, so several entries can be picked with Ctrl+click, a rubber band or Ctrl+A, then copied onto another day, pasted keeping every offset, or deleted together.

**Architecture:** Phase 3 left one selected id, and left every entry action looking its entry up in the *selected day* — which is why the week view's right-click menu does nothing on a column that is not the marked one. Task 1 fixes that first, because nothing that operates across days can be built on top of it. Then `state.selectedEntryId` becomes `state.selectedEntryIds`, a Set, and four pure modules carry the logic that can be tested without a DOM: `selection-model.js` (set arithmetic), `rubber-band.js` (enclosure), `block-nav.js` (which block an arrow key lands on), and `clipboard.js` (where a paste goes). The DOM wiring hangs off modules that already exist — `selection.js` grows the band gesture, `copy-day.js` grows copy and paste, `entries.js` grows the batch delete, `app.js` grows five key bindings.

**Tech Stack:** Electron; plain ES modules in the renderer; `node --test` with `node:assert/strict`; the in-house UI-check harness (`npm run uicheck`, `npm run uicheck:fast`). No new dependencies.

## Global Constraints

These bind every task. Copied from `CLAUDE.md` and the approved spec (`docs/superpowers/specs/2026-08-05-week-view-design.md`, *Phase 4 — Selecting and copying*); exact values are not to be re-derived.

- **No new dependencies.** "Keep the dependency list short… if a dependency needs `node-gyp`, find another way."
- **Process split is non-negotiable:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer never calls Jira directly and never sees the API token. **This phase adds no IPC channel, touches no preload file, and adds no UI preference** — everything it needs is already in `state`, and the selection is deliberately not persisted (it says what is being looked at, which does not survive closing the window).
- **Never trigger Sync / Finish Day from a script**, in any mode, including `--uicheck-fast`. **Task 6 adds a second way to reach a live Jira write — the batch "Delete in Jira too". The same rule covers it: no UI check may ever press that button.** Every delete check presses **Remove here only**.
- **No baked-in configuration.** No URLs, no project keys, no personal filters.
- **Shell policy:** file tools for all file operations. Shell is for `npm` and `git` only. Never probe the environment.
- **No emoji as icons.** A context-menu item carries either `icon` (a text glyph, escaped) or `svg` (one of our own constants from `icons.js`, not escaped). `📌` on an issue row is the one emoji left.
- **Timestamps are epoch ms internally.** Convert to local wall clock only at the render and Jira-serialisation boundaries. Day keys are **local** dates, never `toISOString().slice(0,10)`.
- **A day's bounds are `addDays`, not a fixed 86,400,000 ms** — and a *count* of days between two keys is `Math.round`, never a floor, because one of the days between can be 25 hours long.
- **A write names its day; a render reads the day on screen.** Every path that writes captures its day before its first `await` and goes through `entriesFor(day)` / `setEntriesFor(day, …)` / `persistDayNow(day)`. In this phase a single gesture routinely writes several days at once.
- **Touching an entry is not editing it.** `sameTimes` guards every path that could mark an entry as needing a re-sync.
- **A copy carries no `worklogId` and arrives unsynced.** `duplicateOf` is the one rule — carrying the original's id across would make the next Sync rewrite that worklog with the copy's times. A copy of a Jira-side row becomes an ordinary entry of Joggl's own.
- **Times are rebased as an offset from local midnight**, never as a fixed number of milliseconds — `copiedToDay`'s reasoning, so a copy across a clock change does not quietly claim the work happened an hour earlier.
- **Enclosure, not intersection.** A rubber band catches a block only when the box fully contains it.
- **Selecting must not re-render.** `selection.js` puts the class straight onto the elements; `applySelection()` runs at the end of every render because the ids in state are the truth and the classes are only their shadow.
- **Bare-key shortcuts stay suppressed while a modal is open and while the caret is in a field.** `Ctrl+A`, `Ctrl+C` and `Ctrl+V` are additionally suppressed while typing — unlike `Ctrl+L`, they have a meaning inside a text field that must win.
- **A new binding means a new row in `SHORTCUTS`** in `renderer/js/help.js`. The UI check counts the rows.
- **Version bumps:** task 1 is a fix to behaviour already shipped in 0.18.0, so it takes `npm run bump:fix` → **0.18.1** and can stand on its own. Tasks 2–6 are steps within one change and commit **without** a bump. Task 7 runs `npm run bump` once → **0.19.0**, with the documentation. This is the shape phases 2 and 3 used, and it is deliberate: a minor per intermediate step would make the minor stop meaning "something new".
- **`npm test` and `npm run uicheck:fast` must be green at the end of every task.** The live `npm run uicheck` must be green before the branch merges, and **must report the same counts as the fast run** — the only thing keeping `main/jira/fake.js` honest.

### Decisions taken before this plan was written

Three questions were put to the user and answered; they are settled and are not to be re-opened.

1. **The cross-day lookup bug is fixed here, first** (task 1), rather than in a separate branch or left alone.
2. **Jira-side rows are selectable and copyable, never deletable.** A band or Ctrl+A picks them up; copying one produces an ordinary Joggl entry, exactly as *Copy previous day* already does; a delete skips them and says how many it left behind.
3. **A batch delete offers "Delete in Jira too"** for the synced entries in it, with a per-entry partial-failure summary and **Retry failed**, modelled on `sync.js`. It is not local-only, and it does not refuse.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `renderer/js/day-range.js` | modify | `locateEntry` — which day an entry id is filed under. |
| `renderer/js/state.js` | modify | `findEntry(id)`; `selectedEntryIds` replaces `selectedEntryId`. |
| `renderer/js/entries.js` | modify | Every action finds and writes the entry's **own** day. Gains `deleteSelection`. |
| `renderer/js/selection-model.js` | **new** | Pure. Set arithmetic: select one, toggle one, drop ids that no longer stand for anything. |
| `renderer/js/selection.js` | modify | The Set, the classes, Ctrl+click, Ctrl+A, and the rubber-band gesture. |
| `renderer/js/rubber-band.js` | **new** | Pure. Normalising a dragged box, and which blocks it encloses. |
| `renderer/js/block-nav.js` | **new** | Pure. Which block `↑ ↓ ← → Home End` lands on, given a set of blocks in columns. |
| `renderer/js/keynav.js` | modify | `wireRovingList` takes an optional `resolve`, so a grid can answer the arrows itself. |
| `renderer/js/clipboard.js` | **new** | Pure. What Ctrl+C holds, and where a paste lands. |
| `renderer/js/copy-day.js` | modify | `copySelection()` / `pasteClipboard()` beside the day-level copy it already owns. |
| `renderer/js/entry-ops.js` | modify | `planDeletion` — what deleting a selection would actually do. |
| `renderer/js/timeline.js` | modify | Blocks carry `data-day` / `data-start`; Ctrl+click toggles; the band suppresses the grid click; the day grid answers arrows through `block-nav`. |
| `renderer/js/timeline-drag.js` | modify | `Ctrl+drag` copies rather than moves. |
| `renderer/js/week-view.js` | modify | The week's roving list answers arrows through `block-nav`. |
| `renderer/js/app.js` | modify | `Ctrl+A`, `Ctrl+C`, `Ctrl+V`, `Delete`; wires the band once at boot. |
| `renderer/js/help.js` | modify | A `Selecting and copying` group in `SHORTCUTS`. |
| `renderer/index.html` | modify | The help prose for it. |
| `renderer/css/app.css` | modify | `.rubber-band`, and the copying block. |
| `test/locate-entry.test.js` | **new** | Which day an id is on, local and Jira-side, and a miss. |
| `test/selection.test.js` | **new** | The Set replacing the scalar; click, Ctrl+click, Ctrl+A, Escape; a deleted entry leaving the selection. |
| `test/rubber-band.test.js` | **new** | Enclosure and not intersection; a box drawn in either direction; a band that must not start. |
| `test/block-nav.test.js` | **new** | Within a column by time; across columns to the nearest time; empty columns skipped; the ends. |
| `test/paste.test.js` | **new** | The anchor rule for one day, two non-adjacent days and a whole week; copies unsynced; a keyless entry; a paste across a clock change. |
| `test/delete-many.test.js` | **new** | What a deletion plan holds: removable, synced, Jira-side skipped, grouped by day. |
| `scripts/ui-check.mjs` | modify | Fourteen checks across `weekView()`, `clicks()`, `keyboard()` and `help()`. |
| `test-and-issues.md` | modify | A **Selecting and copying** table; the stale header counts corrected. |
| `CLAUDE.md` | modify | What phase 4 built, and the rules that are not obvious from the code. |

---

## Task 1: An entry action finds — and writes — its own day

A bug fix, and the foundation for everything after it. `currentEntry(id)` in `entries.js` looks the id up in `visibleEntries()`, which is the **selected day only**, and every action then writes to `state.selectedDate`. In the day view those are always the entry's own day. In the week view they are usually not: right-click a block in any column other than the marked one and **Work description, Delete, Duplicate, Split and Edit task all do nothing at all**, because the lookup returns null and each action returns silently.

**Files:**
- Modify: `renderer/js/day-range.js`, `renderer/js/state.js`, `renderer/js/entries.js`
- Test: `test/locate-entry.test.js`
- Modify: `scripts/ui-check.mjs` (two checks in `weekView()`), `test-and-issues.md`

**Interfaces:**
- Consumes: `state.days`, `state.external` (both `Map<dateKey, Entry[]>`).
- Produces:
  - `locateEntry(id: string, days: Map, external: Map) -> {entry: object, dayKey: string} | null` — `day-range.js`
  - `findEntry(id: string) -> {entry, dayKey} | null` — `state.js`, the bound form

- [ ] **Step 1: Write the failing test**

Create `test/locate-entry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { locateEntry } from '../renderer/js/day-range.js';

const entry = (id) => ({ id, issueKey: 'GEN-1', title: 'Standup', startTs: 0, endTs: 1 });

test('an entry is found on the day it is filed under, not the day on screen', () => {
  const days = new Map([
    ['2026-08-03', [entry('a'), entry('b')]],
    ['2026-08-06', [entry('c')]],
  ]);
  assert.equal(locateEntry('c', days, new Map()).dayKey, '2026-08-06');
  assert.equal(locateEntry('a', days, new Map()).dayKey, '2026-08-03');
  assert.equal(locateEntry('a', days, new Map()).entry.id, 'a');
});

test('a Jira-side row is found too, so the refusals that name it still fire', () => {
  const external = new Map([['2026-08-04', [{ ...entry('jira:900'), external: true }]]]);
  const found = locateEntry('jira:900', new Map(), external);
  assert.equal(found.dayKey, '2026-08-04');
  assert.equal(found.entry.external, true);
});

/**
 * Local first, always. A synced local entry and the Jira worklog it created are the
 * same half hour seen twice, and it is the local one that may be edited.
 */
test('a local entry wins over a Jira-side row of the same id', () => {
  const days = new Map([['2026-08-03', [entry('same')]]]);
  const external = new Map([['2026-08-05', [{ ...entry('same'), external: true }]]]);
  assert.equal(locateEntry('same', days, external).dayKey, '2026-08-03');
});

test('an id nothing holds answers null rather than throwing', () => {
  assert.equal(locateEntry('nope', new Map([['2026-08-03', [entry('a')]]]), new Map()), null);
  assert.equal(locateEntry(null, new Map(), new Map()), null);
  assert.equal(locateEntry('a', new Map([['2026-08-03', undefined]]), new Map()), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `locateEntry is not a function`.

- [ ] **Step 3: Write the lookup**

Append to `renderer/js/day-range.js`:

```js
/**
 * The entry with this id, and the day it is filed under.
 *
 * Every entry action used to look its entry up in the *selected day* and write back
 * to `state.selectedDate`. In the day view those are the same day and always were.
 * In the week view they are usually not: a block in any column but the marked one
 * was found by nothing, so Work description, Delete, Duplicate, Split and Edit task
 * all returned silently — the menu opened and the item did nothing.
 *
 * Local entries first, then the Jira-side rows. A synced local entry and the worklog
 * it created are the same half hour seen twice, and it is the local one that may be
 * edited; the Jira-side row is searched at all only so the refusals that name it
 * ("this worklog was made in Jira — change it there") still have something to refuse.
 */
export function locateEntry(id, days, external) {
  if (id === null || id === undefined) return null;
  for (const source of [days, external]) {
    for (const [dayKey, entries] of source ?? []) {
      const entry = (entries ?? []).find((e) => e.id === id);
      if (entry) return { entry, dayKey };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — the suite total rises by 4 (334 → 338).

- [ ] **Step 5: Bind it to the app's state**

In `renderer/js/state.js`, add `locateEntry` to the `./day-range.js` import:

```js
import {
  bucketByDay,
  eachDay,
  externalToEntries,
  installDayAccessors,
  locateEntry,
  missingDays,
  withoutWorklog,
} from './day-range.js';
```

and add, beside `visibleEntriesFor`:

```js
/**
 * The entry with this id and the day holding it, across every day loaded.
 *
 * The bound form of `locateEntry`. Every entry action goes through it, so an action
 * reached from a week column writes to that column's day and not to whichever day
 * happens to be marked.
 */
export function findEntry(id) {
  return locateEntry(id, state.days, state.external);
}
```

- [ ] **Step 6: Make every action use the entry's own day**

In `renderer/js/entries.js`, replace `findEntry`'s predecessor and all seven call sites.

Add `findEntry` to the `./state.js` import and drop `visibleEntries` from it only if nothing else uses it — `calcTotalMs` and `renderEntryList` still do, so **keep it**:

```js
import {
  deleteWorklog,
  dropExternalWorklog,
  entriesFor,
  findEntry,
  isToday,
  persistDay,
  persistDayNow,
  setEntriesFor,
  state,
  visibleEntries,
} from './state.js';
```

Delete `currentEntry` entirely:

```js
function currentEntry(id) {
  return visibleEntries().find((e) => e.id === id) ?? null;
}
```

`resetInput` becomes:

```js
function resetInput(input) {
  const found = findEntry(input.dataset.id);
  if (!found) return;
  const { entry } = found;
  if (input.dataset.f === 'start') input.value = tsToHHMM(entry.startTs);
  else if (input.dataset.f === 'end') input.value = tsToHHMM(entry.endTs ?? entry.startTs);
  else input.value = msToDur((entry.endTs ?? entry.startTs) - entry.startTs);
}
```

`handleInlineEdit`'s opening, its two `hhmmToTs` calls and its write:

```js
function handleInlineEdit(event) {
  const input = event.target;
  const found = findEntry(input.dataset.id);
  if (!found || isExternal(found.entry)) return;
  // The entry's own day, not the day on screen. HH:MM resolves against a day, and a
  // row is only ever edited on the day it belongs to — but saying which day that is
  // costs nothing and makes this the same rule as every other action here.
  const { entry, dayKey } = found;

  const field = input.dataset.f;
  const card = input.closest('.entry-card');
  const before = { startTs: entry.startTs, endTs: entry.endTs };

  if (field === 'start') {
    const ts = hhmmToTs(input.value, dayKey);
    …                       // unchanged from here to the sameTimes guard
```

```js
  } else if (field === 'end') {
    const ts = hhmmToTs(input.value, dayKey);
```

```js
  markDirty(entry);
  persistDay(dayKey);
  renderAll();
}
```

`handleEntryAction`:

```js
async function handleEntryAction(event) {
  const button = event.currentTarget;
  const found = findEntry(button.dataset.id);
  if (!found) return;
  const { entry } = found;
  …                         // the rest is unchanged
```

The five actions each replace their opening two lines. `deleteEntry`:

```js
export async function deleteEntry(id) {
  // The day comes from the entry, not from the screen, and is fixed before the
  // confirmation modal and the Jira DELETE — both of which the day can be stepped
  // underneath, and neither of which is necessarily about the day on screen at all.
  const found = findEntry(id);
  if (!found) return;
  const { entry, dayKey: day } = found;
  …                         // the rest is unchanged
```

`duplicateEntry`:

```js
export async function duplicateEntry(id) {
  const found = findEntry(id);
  if (!found || found.entry.endTs === null) return;
  const { entry, dayKey: day } = found;
  …
```

`editEntryTask`:

```js
export async function editEntryTask(id) {
  const found = findEntry(id);
  if (!found) return;
  const { entry, dayKey: day } = found;
  …
```

`editEntryComment`:

```js
export async function editEntryComment(id) {
  const found = findEntry(id);
  if (!found) return;
  const { entry, dayKey: day } = found;
  …
```

`splitEntry`, whose `snapToQuarter` now measures from the right midnight:

```js
export async function splitEntry(id) {
  const found = findEntry(id);
  if (!found || found.entry.endTs === null) return;
  const { entry, dayKey: day } = found;
  …
  const midpoint = snapToQuarter((entry.startTs + entry.endTs) / 2, day);
  …
```

- [ ] **Step 7: Give a block its day and its start, in the DOM**

The two checks below, and task 4, need to know which column a block is in without asking the app. In `renderer/js/timeline.js`, in `buildBlock`, beside `block.dataset.id = entry.id;`:

```js
  block.dataset.id = entry.id;
  // Which column this is, and when it starts. Read by the arrow keys (block-nav.js)
  // and by the UI checks, neither of which can otherwise tell one column from
  // another once the blocks are on the page.
  block.dataset.day = dayKey;
  block.dataset.start = String(entry.startTs);
```

- [ ] **Step 8: Add the two UI checks**

In `scripts/ui-check.mjs`, append to `weekView()`, before its closing brace. Note `inWeek` is already defined at the top of that function and puts the app back on the day view afterwards.

```js
  // The day the week is anchored on is the *selected* one, and it is the only day
  // the old lookup could see. So both of these deliberately pick a column that is
  // not it — that is the whole bug.
  const seedOffAnchor = (id, extra = '') => `
    const heads = H.all('.week-colhead');
    const i = heads.findIndex(h => !h.classList.contains('is-selected'));
    const day = H.colDay(i);
    const at = (hh) => new Date(day + 'T' + String(hh).padStart(2, '0') + ':00:00').getTime();
    await window.joggl.days.save(day, [
      { id: '${id}', issueKey: 'GEN-1', issueId: null, title: 'Off the anchor',
        startTs: at(9), endTs: at(10), status: 'pending', worklogId: null,
        comment: null, errorMsg: null },
      ${extra}
    ]);
    await window.__jogglTest.reloadDay();
    await H.until(() => !!H.q('.sched-entry-block[data-id="${id}"]'), 4000, 'the seeded block');`;

  await check(
    'week: an action on a column that is not the marked day still reaches its entry',
    inWeek(`${seedOffAnchor('x-off-1')}
            const block = H.q('.sched-entry-block[data-id="x-off-1"]');
            const onAnchor = block.dataset.day === H.q('.week-colhead.is-selected').dataset.day;
            block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
            await H.until(() => !H.q('#modal-overlay').classList.contains('hidden'), 4000, 'the description dialog');
            H.q('#modal-body .comment-field').value = 'written from another column';
            H.all('#modal-buttons button').find(b => b.textContent === 'Save').click();
            await H.until(() => H.q('#modal-overlay').classList.contains('hidden'), 4000, 'the dialog to close');
            await H.sleep(250);
            const saved = (await window.joggl.days.get(day)).entries[0].comment;
            await H.clearDays([day]);
            return JSON.stringify({ onAnchor, saved });`),
    (v) => {
      const d = JSON.parse(v);
      // If the seeded day *were* the anchor the check would prove nothing at all.
      return d.onAnchor === false && d.saved === 'written from another column';
    },
  );

  await check(
    'week: deleting from a column that is not the marked day empties that day, not another',
    inWeek(`${seedOffAnchor(
      'x-off-2',
      `{ id: 'x-off-keep', issueKey: 'GEN-2', issueId: null, title: 'Stays',
         startTs: at(14), endTs: at(15), status: 'pending', worklogId: null,
         comment: null, errorMsg: null },`,
    )}
            const anchorBefore = (await window.joggl.days.get(H.q('.week-colhead.is-selected').dataset.day)).entries.length;
            const block = H.q('.sched-entry-block[data-id="x-off-2"]');
            block.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
            await H.until(() => !H.q('#ctx-menu').classList.contains('hidden'), 4000, 'the menu');
            H.all('#ctx-menu .ctx-item').find(i => i.textContent.includes('Delete')).click();
            await H.sleep(400);
            const left = (await window.joggl.days.get(day)).entries.map(e => e.id);
            const anchorAfter = (await window.joggl.days.get(H.q('.week-colhead.is-selected').dataset.day)).entries.length;
            await H.clearDays([day]);
            return JSON.stringify({ left, anchorBefore, anchorAfter });`),
    (v) => {
      const d = JSON.parse(v);
      return JSON.stringify(d.left) === JSON.stringify(['x-off-keep']) &&
        d.anchorAfter === d.anchorBefore;
    },
  );
```

- [ ] **Step 9: Record it in the checklist**

In `test-and-issues.md`, append to the **Week view** table:

```markdown
| Right-click a block in a column that is **not** the marked day | Every item works — Work description, Duplicate, Split, Edit task, Delete. They read and write that column's day, not the marked one. |
```

and add to *Open issues → Confirmed bugs*, under a new dated heading above the 2026-08-05 list:

```markdown
Fixed on 2026-08-06:

- **In the week view, the right-click menu did nothing on any column but the marked
  one.** `currentEntry(id)` looked the entry up in `visibleEntries()` — the selected
  day — and every action then wrote to `state.selectedDate`. In the day view those are
  the same day and always were, which is why this shipped: the menu opened, the dialog
  never did, and nothing was logged. Entries are now located across every day loaded
  (`locateEntry` in `renderer/js/day-range.js`, `findEntry` in `state.js`) and each
  action writes the day it found.
```

- [ ] **Step 10: Verify**

Run: `npm test`
Expected: PASS — 338.

Run: `npm run uicheck:fast`
Expected: PASS — 101 of 101 (99 + 2).

- [ ] **Step 11: Bump the patch and commit**

```bash
npm run bump:fix
```

Expected: `0.18.0` → `0.18.1`. A fix to a version already cut takes the patch — see *Conventions* in `CLAUDE.md`.

```bash
git add -A
git commit -m "Find an entry on its own day, not the day on screen (0.18.1)"
```

---

## Task 2: The selection is a set

No new gesture yet beyond Ctrl+click — the scalar becomes a Set and everything that reads it follows. Doing this on its own keeps the diff readable: the band, the arrows, the clipboard and the delete all assume it.

**Files:**
- Create: `renderer/js/selection-model.js`
- Modify: `renderer/js/selection.js`, `renderer/js/state.js`, `renderer/js/entries.js`, `renderer/js/timeline.js`
- Test: `test/selection.test.js`
- Modify: `scripts/ui-check.mjs` (two checks in `clicks()`)

**Interfaces:**
- Consumes: `state.days`, `state.external`, `findEntry` from task 1.
- Produces:
  - `selectOnly(id) -> Set<string>`, `toggled(ids, id) -> Set<string>`, `pruned(ids, present) -> Set<string>` — `selection-model.js`
  - `select(id)`, `toggleSelect(id)`, `selectMany(ids)`, `selectAllVisible()`, `clearSelection()`, `selectedIds() -> string[]`, `applySelection()` — `selection.js`

- [ ] **Step 1: Write the failing test**

Create `test/selection.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pruned, selectOnly, toggled } from '../renderer/js/selection-model.js';

const ids = (set) => [...set].sort();

test('a plain click replaces whatever was selected', () => {
  assert.deepEqual(ids(selectOnly('a')), ['a']);
  // Not an addition to the last one — the whole point of the plain click.
  assert.deepEqual(ids(selectOnly('b')), ['b']);
});

test('nothing selected is an empty set, never null', () => {
  assert.deepEqual(ids(selectOnly(null)), []);
  assert.deepEqual(ids(selectOnly(undefined)), []);
});

test('Ctrl+click adds one, and Ctrl+click again takes it back out', () => {
  const one = toggled(new Set(['a']), 'b');
  assert.deepEqual(ids(one), ['a', 'b']);
  assert.deepEqual(ids(toggled(one, 'a')), ['b']);
  assert.deepEqual(ids(toggled(toggled(one, 'a'), 'b')), []);
});

test('toggling returns a new set rather than mutating the one it was given', () => {
  const before = new Set(['a']);
  const after = toggled(before, 'b');
  assert.deepEqual(ids(before), ['a'], 'the original is untouched');
  assert.deepEqual(ids(after), ['a', 'b']);
});

/**
 * An entry being deleted has to leave the selection, or Ctrl+C and Delete would go
 * on acting on something that is not there. Answered by filtering against what the
 * app actually holds, rather than by bookkeeping at every delete site — one rule,
 * and no path can forget to run it.
 */
test('an id that no longer stands for anything is dropped', () => {
  const present = new Set(['a', 'c']);
  assert.deepEqual(ids(pruned(new Set(['a', 'b', 'c']), present)), ['a', 'c']);
  assert.deepEqual(ids(pruned(new Set(), present)), []);
  assert.deepEqual(ids(pruned(new Set(['b']), present)), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/selection-model.js'`.

- [ ] **Step 3: Write the pure model**

Create `renderer/js/selection-model.js`:

```js
// The selection, as arithmetic over a set of entry ids.
//
// Pure — no DOM, no state — so what a click, a Ctrl+click and a delete do to the
// selection can be tested without a browser. `selection.js` holds the set and paints
// the classes; this decides what the set becomes.

/** A plain click: this one, and nothing else. */
export function selectOnly(id) {
  return id === null || id === undefined ? new Set() : new Set([id]);
}

/** Ctrl+click: in if it was out, out if it was in. A new set, never a mutation. */
export function toggled(ids, id) {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * The selection with anything that no longer stands for an entry taken out.
 *
 * Applied on every read rather than at each site that deletes something. There are
 * six of those and counting — the single delete, the batch, Clear day, Clear week, a
 * merge, a sync that turns an entry into another — and one of them forgetting to
 * prune would leave Ctrl+C copying a ghost.
 */
export function pruned(ids, present) {
  return new Set([...ids].filter((id) => present.has(id)));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — 343 (338 + 5).

- [ ] **Step 5: Hold a set in state**

In `renderer/js/state.js`, replace the `selectedEntryId` field:

```js
  /**
   * The entries a click, a Ctrl+click or a rubber band marked, drawn in every panel
   * at once. Not persisted: it says what is being looked at, which does not survive
   * closing the window, and it is not the same thing as focus, which is per-panel and
   * moves away the moment you type.
   */
  selectedEntryIds: new Set(),
```

- [ ] **Step 6: Rewrite selection.js**

Replace `renderer/js/selection.js` entirely:

```js
// Which entries are selected, and the highlight that says so in every panel.
//
// An entry is drawn twice in the day view — a row in "On this day" and a block on the
// grid — and with overlap columns it is often unclear which block belongs to which
// row. Selecting marks both. In the week view a block is drawn once, in its column.
//
// **This never re-renders.** A render replaces the element, and if the first click of
// a double click did that, the second would land on a new node and the `dblclick`
// would never fire. The classes go straight onto the elements, the same reason
// `liveUpdate` in timeline-drag.js mirrors a drag by hand.

import { pruned, selectOnly, toggled } from './selection-model.js';
import { state } from './state.js';

const CLASS = 'is-selected';
const BOTH = '.entry-card, .sched-entry-block';

/**
 * Every entry id the app currently holds, local and Jira-side.
 *
 * The yardstick `pruned` measures the selection against, so an entry that has been
 * deleted — here, in Jira, or by Clear week — simply stops being selected.
 */
function presentIds() {
  const present = new Set();
  for (const source of [state.days, state.external]) {
    for (const entries of source.values()) {
      for (const entry of entries ?? []) present.add(entry.id);
    }
  }
  return present;
}

/** The selection, as an array, with anything that no longer exists dropped. */
export function selectedIds() {
  return [...pruned(state.selectedEntryIds, presentIds())];
}

export function isSelected(id) {
  return state.selectedEntryIds.has(id);
}

/** A plain click. */
export function select(id) {
  state.selectedEntryIds = selectOnly(id);
  applySelection();
}

/** Ctrl+click. */
export function toggleSelect(id) {
  state.selectedEntryIds = toggled(state.selectedEntryIds, id);
  applySelection();
}

export function selectMany(ids) {
  state.selectedEntryIds = new Set(ids);
  applySelection();
}

/**
 * Ctrl+A: everything on screen — the week's columns, or the day's grid and rows.
 *
 * Read off the DOM rather than out of state, because "visible" is exactly what is
 * drawn: in five-day mode an empty weekend is not on screen and is not selected, and
 * in the day view the same entry appears as a block and a row, which the set folds
 * back into one.
 */
export function selectAllVisible() {
  selectMany(
    [...document.querySelectorAll('.sched-entry-block:not(.live), .entry-card')]
      .map((el) => el.dataset.id)
      .filter(Boolean),
  );
}

export function clearSelection() {
  if (state.selectedEntryIds.size === 0) return;
  state.selectedEntryIds = new Set();
  applySelection();
}

/**
 * Paint the selection onto whatever is on screen now.
 *
 * Called at the end of every render, because a render builds fresh elements that know
 * nothing about it — the ids in `state` are the truth, the classes only their shadow.
 * `.week-colhead.is-selected` is deliberately not in `BOTH`: on a column head the same
 * class means "this is the week's anchor day", which is a different thing.
 */
export function applySelection() {
  const ids = state.selectedEntryIds;
  for (const el of document.querySelectorAll(BOTH)) {
    el.classList.toggle(CLASS, ids.has(el.dataset.id));
  }
}
```

- [ ] **Step 7: Ctrl+click on a row and on a block**

In `renderer/js/entries.js`, add `toggleSelect` to the `./selection.js` import and change the list's click handler:

```js
    // The time fields and the row's buttons keep their own click.
    if (event.target.closest('.ie, [data-a]')) return;
    if (event.ctrlKey || event.metaKey) toggleSelect(card.dataset.id);
    else select(card.dataset.id);
    // The roving tab stop should follow the mouse, or Tab returns somewhere else.
    card.focus();
```

In `renderer/js/timeline.js`, add `toggleSelect` to the same import and change the block's click handler:

```js
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
```

- [ ] **Step 8: Add the two UI checks**

In `scripts/ui-check.mjs`, append to `clicks()`:

```js
  await check(
    'Ctrl+click adds a second entry to the selection, and takes it back out',
    `await H.resetDay();
     const at = (hh) => { const d = new Date(); d.setHours(hh, 0, 0, 0); return d.getTime(); };
     await window.joggl.days.save(H.todayKey(), [
       { id: 'sel-a', issueKey: 'GEN-1', issueId: null, title: 'First', startTs: at(9),
         endTs: at(10), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       { id: 'sel-b', issueKey: 'GEN-2', issueId: null, title: 'Second', startTs: at(11),
         endTs: at(12), status: 'pending', worklogId: null, comment: null, errorMsg: null },
     ]);
     await window.__jogglTest.reloadDay();
     const click = (id, ctrl) => {
       const el = H.q('.sched-entry-block[data-id="' + id + '"]');
       el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: ctrl }));
     };
     click('sel-a', false);
     const one = H.all('.sched-entry-block.is-selected').length;
     click('sel-b', true);
     const two = H.all('.sched-entry-block.is-selected').length;
     click('sel-b', true);
     const back = H.all('.sched-entry-block.is-selected').length;
     click('sel-b', false);
     const plain = H.all('.sched-entry-block.is-selected').map(e => e.dataset.id);
     await H.resetDay();
     return JSON.stringify({ one, two, back, plain })`,
    (v) => {
      const d = JSON.parse(v);
      return d.one === 1 && d.two === 2 && d.back === 1 &&
        JSON.stringify(d.plain) === JSON.stringify(['sel-b']);
    },
  );

  await check(
    'the selection marks the row and the block together, and Escape puts it all down',
    `await H.resetDay();
     const at = (hh) => { const d = new Date(); d.setHours(hh, 0, 0, 0); return d.getTime(); };
     await window.joggl.days.save(H.todayKey(), [
       { id: 'sel-c', issueKey: 'GEN-1', issueId: null, title: 'Both', startTs: at(9),
         endTs: at(10), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       { id: 'sel-d', issueKey: 'GEN-2', issueId: null, title: 'Both too', startTs: at(11),
         endTs: at(12), status: 'pending', worklogId: null, comment: null, errorMsg: null },
     ]);
     await window.__jogglTest.reloadDay();
     for (const id of ['sel-c', 'sel-d']) {
       H.q('.sched-entry-block[data-id="' + id + '"]').dispatchEvent(
         new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
     }
     const blocks = H.all('.sched-entry-block.is-selected').length;
     const cards = H.all('.entry-card.is-selected').length;
     document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
     await H.sleep(150);
     const after = H.all('.is-selected').length;
     await H.resetDay();
     return JSON.stringify({ blocks, cards, after })`,
    (v) => {
      const d = JSON.parse(v);
      return d.blocks === 2 && d.cards === 2 && d.after === 0;
    },
  );
```

- [ ] **Step 9: Verify**

Run: `npm test`
Expected: PASS — 343.

Run: `npm run uicheck:fast`
Expected: PASS — 103 of 103. Watch the existing selection checks in `clicks()` especially: they assert one `.is-selected`, which a Set that starts empty and replaces on a plain click still satisfies.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Select several entries rather than one"
```

---

## Task 3: A rubber band on the empty grid

**Files:**
- Create: `renderer/js/rubber-band.js`
- Modify: `renderer/js/selection.js` (the gesture), `renderer/js/timeline.js` (the grid click stands aside), `renderer/js/app.js` (wire it once), `renderer/css/app.css`
- Test: `test/rubber-band.test.js`
- Modify: `scripts/ui-check.mjs` (two checks in `clicks()`)

**Interfaces:**
- Consumes: `selectMany` from `selection.js`.
- Produces:
  - `normalisedRect(a, b) -> {left, right, top, bottom}`, `enclosedIds(rect, boxes) -> string[]`, `canStartBand(target) -> boolean`, `BAND_THRESHOLD_PX` — `rubber-band.js`
  - `wireRubberBand()`, `isBandSuppressed() -> boolean` — `selection.js`

- [ ] **Step 1: Write the failing test**

Create `test/rubber-band.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canStartBand, enclosedIds, normalisedRect } from '../renderer/js/rubber-band.js';

const box = (id, top, bottom, left = 10, right = 90) => ({ id, top, bottom, left, right });

/** A stand-in for an element, with just the `closest` the predicate asks for. */
const target = (...selectors) => ({
  closest: (query) => (selectors.some((s) => query.includes(s)) ? {} : null),
});

test('a box drawn in any direction is the same box', () => {
  const downRight = normalisedRect({ x: 10, y: 20 }, { x: 100, y: 200 });
  const upLeft = normalisedRect({ x: 100, y: 200 }, { x: 10, y: 20 });
  assert.deepEqual(downRight, { left: 10, right: 100, top: 20, bottom: 200 });
  assert.deepEqual(upLeft, downRight, 'dragging up and left draws the same rectangle');
});

/**
 * Enclosure, not intersection. A band drawn down a column of full-width blocks
 * crosses every one of them; catching what it merely touched would select the lot.
 */
test('a block is caught only when the box contains all of it', () => {
  const boxes = [box('inside', 30, 60), box('crossed', 90, 300), box('elsewhere', 400, 450)];
  const rect = normalisedRect({ x: 0, y: 10 }, { x: 100, y: 200 });
  assert.deepEqual(enclosedIds(rect, boxes), ['inside']);
});

test('a block wider than the band is not caught, however tall the band is', () => {
  const boxes = [box('wide', 30, 60, 0, 500)];
  const rect = normalisedRect({ x: 0, y: 0 }, { x: 100, y: 900 });
  assert.deepEqual(enclosedIds(rect, boxes), []);
});

test('a band touching nothing catches nothing, and never throws on an empty grid', () => {
  const rect = normalisedRect({ x: 0, y: 0 }, { x: 5, y: 5 });
  assert.deepEqual(enclosedIds(rect, [box('a', 30, 60)]), []);
  assert.deepEqual(enclosedIds(rect, []), []);
  assert.deepEqual(enclosedIds(rect, null), []);
});

/**
 * A press on a block is already a move gesture, and the two would fight over the
 * same mousedown. The band starts on empty grid only.
 */
test('the band refuses to start anywhere a press already means something', () => {
  assert.equal(canStartBand(target('#schedule-grid')), true);
  assert.equal(canStartBand(target('#week-scroll')), true);
  assert.equal(canStartBand(target('#schedule-grid', '.sched-entry-block')), false);
  assert.equal(canStartBand(target('#week-scroll', '.sched-handle')), false);
  assert.equal(canStartBand(target('#week-scroll', '.week-colhead')), false);
  assert.equal(canStartBand(target('.sched-quick-entry')), false);
  assert.equal(canStartBand(target('#task-list')), false, 'not a grid at all');
  assert.equal(canStartBand(null), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/rubber-band.js'`.

- [ ] **Step 3: Write the pure module**

Create `renderer/js/rubber-band.js`:

```js
// Which blocks a band drawn on the grid catches.
//
// Pure — no DOM — so the rule can be tested against a fixed set of boxes. The caller
// reads the boxes with getBoundingClientRect and does the drawing.

/**
 * Below this the gesture was a click, and a click on empty grid already means
 * something: it opens the quick-entry popup. Six, matching drag-drop.js, because a
 * hand that slips a few pixels while pressing must not swallow that.
 */
export const BAND_THRESHOLD_PX = 6;

/** The box between two points, whichever corner the drag began at. */
export function normalisedRect(a, b) {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  };
}

/**
 * The ids of the boxes the band fully contains.
 *
 * **Enclosure, not intersection.** A block spans the whole width of its column, so a
 * band drawn down a column crosses every block it passes; catching what it merely
 * touched would mean a short drag selected the day. Requiring containment makes the
 * band say what it looks like it says.
 */
export function enclosedIds(rect, boxes) {
  return (boxes ?? [])
    .filter(
      (b) =>
        b.left >= rect.left && b.right <= rect.right &&
        b.top >= rect.top && b.bottom <= rect.bottom,
    )
    .map((b) => b.id);
}

/**
 * Whether a press here may start a band.
 *
 * A press on a block is already a move gesture and the two would fight over the same
 * mousedown; a press on a resize handle is a resize; a column head is a day selector
 * that happens to sit over its own column once scrolled. So: inside a grid, and on
 * none of those.
 *
 * Takes anything with `closest`, the same shape `editorForTarget` takes, so it can be
 * tested with an object instead of a DOM.
 */
export function canStartBand(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest('.sched-entry-block, .sched-handle, .week-colhead, .sched-quick-entry')) {
    return false;
  }
  return Boolean(target.closest('#schedule-grid, #week-scroll'));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — 348 (343 + 5).

- [ ] **Step 5: Draw it, and wire the gesture**

In `renderer/js/selection.js`, add the import and append the gesture:

```js
import { BAND_THRESHOLD_PX, canStartBand, enclosedIds, normalisedRect } from './rubber-band.js';
```

```js
// ── The rubber band ────────────────────────────────────────────────────────

/**
 * Until when a click is the tail of a band rather than a click.
 *
 * The grid's own click clears the selection and opens the quick-entry popup — which
 * is exactly right for a click on empty space, and exactly wrong for the click that
 * follows a band, which would wipe what the band had just selected a frame earlier.
 * Module level rather than per-gesture for the same reason `timeline-drag.js` keeps
 * its own: the commit re-renders, and the click lands on a new element.
 */
let bandSuppressedUntil = 0;
const BAND_TAIL_MS = 200;

export function isBandSuppressed() {
  return Date.now() < bandSuppressedUntil;
}

/** Called once at boot. Both grids exist in the markup from the start. */
export function wireRubberBand() {
  for (const id of ['schedule-grid', 'week-scroll']) {
    document.getElementById(id)?.addEventListener('mousedown', onBandStart);
  }
}

function onBandStart(event) {
  if (event.button !== 0 || !canStartBand(event.target)) return;

  const origin = { x: event.clientX, y: event.clientY };
  let el = null;

  const onMouseMove = (move) => {
    const crossed =
      Math.abs(move.clientX - origin.x) >= BAND_THRESHOLD_PX ||
      Math.abs(move.clientY - origin.y) >= BAND_THRESHOLD_PX;
    if (!el && !crossed) return;

    if (!el) {
      el = document.createElement('div');
      el.className = 'rubber-band';
      document.body.appendChild(el);
      // Only once the band is real: a press that never became one must leave the
      // text selection and the focus it would otherwise have taken.
      move.preventDefault();
    }

    const rect = normalisedRect(origin, { x: move.clientX, y: move.clientY });
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.right - rect.left}px`;
    el.style.height = `${rect.bottom - rect.top}px`;
  };

  const onMouseUp = (up) => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (!el) return; // never crossed the threshold — this was a click, leave it alone

    el.remove();
    el = null;
    bandSuppressedUntil = Date.now() + BAND_TAIL_MS;

    // Viewport coordinates on both sides: the band is positioned fixed and the boxes
    // come from getBoundingClientRect, so neither needs to know how far the grid has
    // been scrolled.
    const rect = normalisedRect(origin, { x: up.clientX, y: up.clientY });
    const boxes = [...document.querySelectorAll('.sched-entry-block:not(.live)')].map((block) => {
      const box = block.getBoundingClientRect();
      return { id: block.dataset.id, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    selectMany(enclosedIds(rect, boxes));
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
```

- [ ] **Step 6: Let the grid click stand aside**

In `renderer/js/timeline.js`, add `isBandSuppressed` to the `./selection.js` import and put it at the top of `onGridClick`, above everything else:

```js
export function onGridClick(event) {
  // A band that just finished produces a click on the grid it was drawn over, and
  // this function clears the selection and opens the quick-entry popup. Without
  // standing aside, every band would select and then instantly deselect.
  if (isBandSuppressed()) return;
  if (event.target.closest('.sched-entry-block') || event.target.closest('.sched-handle')) return;
  …
```

- [ ] **Step 7: Wire it at boot**

In `renderer/js/app.js`, add `wireRubberBand` to the `./selection.js` import and call it in `boot()`, in the wiring block after `wireDayViewDrag()`:

```js
  wireDayViewDrag();
  wireRubberBand();
```

- [ ] **Step 8: Add the CSS**

Append to `renderer/css/app.css`, at the end of the *Week view* section:

```css
/* The rubber band. Fixed, because it is drawn in viewport coordinates and must not
   scroll with the grid under it mid-gesture; pointer-events off, or it would take the
   mouseup that ends it. */
.rubber-band {
  position: fixed;
  z-index: 60;
  border: 1px solid var(--accent);
  background: var(--accent-softer);
  pointer-events: none;
}
```

- [ ] **Step 9: Add the two UI checks**

In `scripts/ui-check.mjs`, append to `clicks()`:

```js
  await check(
    'a rubber band selects what it encloses, and not what it merely crosses',
    `await H.resetDay();
     const at = (hh, mm) => { const d = new Date(); d.setHours(hh, mm || 0, 0, 0); return d.getTime(); };
     await window.joggl.days.save(H.todayKey(), [
       { id: 'band-in', issueKey: 'GEN-1', issueId: null, title: 'Enclosed', startTs: at(10),
         endTs: at(10, 30), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       { id: 'band-cross', issueKey: 'GEN-2', issueId: null, title: 'Crossed', startTs: at(11),
         endTs: at(15), status: 'pending', worklogId: null, comment: null, errorMsg: null },
     ]);
     await window.__jogglTest.reloadDay();
     await H.showHour('10:00');
     const inBox = H.q('.sched-entry-block[data-id="band-in"]').getBoundingClientRect();
     const crossBox = H.q('.sched-entry-block[data-id="band-cross"]').getBoundingClientRect();
     // From above the first block to halfway down the second: the first is contained,
     // the second only crossed. Wide enough on both sides to contain the full width.
     const x1 = Math.round(Math.min(inBox.left, crossBox.left) - 6);
     const x2 = Math.round(Math.max(inBox.right, crossBox.right) + 6);
     const y1 = Math.round(inBox.top - 6);
     const y2 = Math.round(crossBox.top + crossBox.height / 2);
     H.mouse(H.q('#schedule-grid'), 'mousedown', x1, y1, 1);
     for (let i = 1; i <= 5; i++) {
       H.mouse(document, 'mousemove', Math.round(x1 + (x2 - x1) * i / 5), Math.round(y1 + (y2 - y1) * i / 5), 1);
     }
     H.mouse(document, 'mouseup', x2, y2, 0);
     await H.sleep(200);
     const picked = H.all('.sched-entry-block.is-selected').map(e => e.dataset.id);
     const popup = !!H.q('.sched-quick-entry');
     await H.resetDay();
     return JSON.stringify({ picked, popup })`,
    (v) => {
      const d = JSON.parse(v);
      // The popup must not have opened: the click the band produces has to be
      // suppressed, or the band would select and deselect in the same gesture.
      return JSON.stringify(d.picked) === JSON.stringify(['band-in']) && d.popup === false;
    },
  );

  await check(
    'a press on a block is a move, not a band, and a press that never moves is still a click',
    `await H.resetDay();
     const at = (hh) => { const d = new Date(); d.setHours(hh, 0, 0, 0); return d.getTime(); };
     await window.joggl.days.save(H.todayKey(), [
       { id: 'band-block', issueKey: 'GEN-1', issueId: null, title: 'A block', startTs: at(10),
         endTs: at(11), status: 'pending', worklogId: null, comment: null, errorMsg: null },
     ]);
     await window.__jogglTest.reloadDay();
     await H.showHour('10:00');
     const box = H.q('.sched-entry-block[data-id="band-block"]').getBoundingClientRect();
     H.mouse(H.q('.sched-entry-block[data-id="band-block"]'), 'mousedown',
             Math.round(box.left + 20), Math.round(box.top + 8), 1);
     H.mouse(document, 'mousemove', Math.round(box.left + 60), Math.round(box.top + 40), 1);
     const bandOnBlock = !!H.q('.rubber-band');
     H.mouse(document, 'mouseup', Math.round(box.left + 60), Math.round(box.top + 40), 0);
     await H.sleep(250);

     // And a plain click on empty grid still opens the popup, unchanged.
     const y = await H.showHour('14:00');
     H.mouse(H.q('#schedule-grid'), 'mousedown', H.gridX(), y, 1);
     H.mouse(document, 'mouseup', H.gridX(), y, 0);
     H.q('#schedule-grid').dispatchEvent(new MouseEvent('click', {
       bubbles: true, cancelable: true, clientX: H.gridX(), clientY: y }));
     await H.sleep(300);
     const popup = !!H.q('.sched-quick-entry');
     document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
     await H.resetDay();
     return JSON.stringify({ bandOnBlock, popup })`,
    (v) => {
      const d = JSON.parse(v);
      return d.bandOnBlock === false && d.popup === true;
    },
  );
```

- [ ] **Step 10: Verify**

Run: `npm test`
Expected: PASS — 348.

Run: `npm run uicheck:fast`
Expected: PASS — 105 of 105.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Draw a box round the blocks it encloses"
```

---

## Task 4: Arrows across columns and within one

Today both grids use `wireRovingList`, which walks the rows in **DOM order**. In the week that is column by column, so `↓` on the last block of Monday jumps to Tuesday morning; and within a column the order is `visibleEntriesFor`'s — local entries then Jira-side rows — which is not time order either.

**Files:**
- Create: `renderer/js/block-nav.js`
- Modify: `renderer/js/keynav.js`, `renderer/js/timeline.js`, `renderer/js/week-view.js`
- Test: `test/block-nav.test.js`
- Modify: `scripts/ui-check.mjs` (two checks in `keyboard()`)

**Interfaces:**
- Consumes: `data-day` / `data-start` on a block, added in task 1 step 7; `startOfDayMs` from `util.js`.
- Produces:
  - `nextBlockId(blocks, fromId, key) -> string | null`, where a block is `{id, day, offsetMs}` — `block-nav.js`
  - `wireRovingList({container, rowSelector, onMove, resolve})` — `resolve(rows, from, key) -> Element | null` — `keynav.js`

- [ ] **Step 1: Write the failing test**

Create `test/block-nav.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextBlockId } from '../renderer/js/block-nav.js';

const HOUR = 3_600_000;
const b = (id, day, hour) => ({ id, day, offsetMs: hour * HOUR });

// Mon holds three, Tue is empty, Wed holds one late, Thu holds one early.
const week = [
  b('mon-9', '2026-08-03', 9),
  b('mon-14', '2026-08-03', 14),
  b('mon-11', '2026-08-03', 11),
  b('wed-16', '2026-08-05', 16),
  b('thu-8', '2026-08-06', 8),
];

test('up and down move within one column, in time order and not DOM order', () => {
  // mon-11 is third in the array and second on the clock.
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowDown'), 'mon-11');
  assert.equal(nextBlockId(week, 'mon-11', 'ArrowDown'), 'mon-14');
  assert.equal(nextBlockId(week, 'mon-14', 'ArrowUp'), 'mon-11');
});

/**
 * Clamped, not wrapped — which is what `wireRovingList` has always done, and the two
 * grids must not answer the same key differently.
 */
test('the ends of a column hold', () => {
  assert.equal(nextBlockId(week, 'mon-14', 'ArrowDown'), 'mon-14');
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowUp'), 'mon-9');
});

test('Home and End go to the ends of the column, not of the week', () => {
  assert.equal(nextBlockId(week, 'mon-11', 'Home'), 'mon-9');
  assert.equal(nextBlockId(week, 'mon-9', 'End'), 'mon-14');
});

/**
 * Sideways lands on the block nearest the same time on the clock — what the eye
 * would call "across from here". Compared as an offset from midnight rather than as
 * a timestamp, so two columns either side of a clock change still line up.
 */
test('left and right cross to the nearest time in the next column that has anything', () => {
  // Tuesday is empty, so Monday 14:00 goes right to Wednesday.
  assert.equal(nextBlockId(week, 'mon-14', 'ArrowRight'), 'wed-16');
  assert.equal(nextBlockId(week, 'wed-16', 'ArrowLeft'), 'mon-14', 'the nearest of Monday’s three');
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowRight'), 'wed-16', 'the only one there');
  assert.equal(nextBlockId(week, 'thu-8', 'ArrowLeft'), 'wed-16');
});

/**
 * Staying put rather than wrapping: a jump from Friday to Monday would read as the
 * week having stepped, which it has not.
 */
test('there is nothing past the ends of the week', () => {
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowLeft'), null);
  assert.equal(nextBlockId(week, 'thu-8', 'ArrowRight'), null);
});

test('one column answers up and down and nothing else — the day view', () => {
  const day = [b('a', '2026-08-03', 9), b('c', '2026-08-03', 15), b('b', '2026-08-03', 12)];
  assert.equal(nextBlockId(day, 'a', 'ArrowDown'), 'b');
  assert.equal(nextBlockId(day, 'b', 'ArrowRight'), null);
  assert.equal(nextBlockId(day, 'b', 'ArrowLeft'), null);
});

test('a key nothing is bound to, and an id nothing holds, both answer null', () => {
  assert.equal(nextBlockId(week, 'mon-9', 'PageDown'), null);
  assert.equal(nextBlockId(week, 'nope', 'ArrowDown'), null);
  assert.equal(nextBlockId([], 'mon-9', 'ArrowDown'), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/block-nav.js'`.

- [ ] **Step 3: Write the pure module**

Create `renderer/js/block-nav.js`:

```js
// Which block an arrow key lands on.
//
// Pure — no DOM — so the rule can be tested without a grid. The caller reads the
// blocks off the page and turns the answer back into an element.
//
// The blocks arrive in DOM order, which is column by column and, within a column,
// whatever order `visibleEntriesFor` returned — local entries then Jira-side rows.
// Neither is what the eye sees, so both the column grouping and the time order are
// worked out here rather than assumed.

/**
 * @param {{id: string, day: string, offsetMs: number}[]} blocks every block drawn.
 *        `offsetMs` is measured from its own day's midnight, so two columns on
 *        opposite sides of a clock change still line up by what they say on the clock.
 * @param {string} fromId the block the keyboard is on
 * @param {string} key the KeyboardEvent key
 * @returns {string|null} the id to move to, or null when the key means nothing here
 */
export function nextBlockId(blocks, fromId, key) {
  const all = blocks ?? [];
  const from = all.find((b) => b.id === fromId);
  if (!from) return null;

  const inDay = (day) => all.filter((b) => b.day === day).sort((a, b) => a.offsetMs - b.offsetMs);

  if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
    const column = inDay(from.day);
    if (key === 'Home') return column[0].id;
    if (key === 'End') return column[column.length - 1].id;
    const at = column.findIndex((b) => b.id === fromId);
    // Clamped rather than wrapped, because that is what wireRovingList has always
    // done for these two grids and a key must not mean two things.
    const to = Math.min(Math.max(at + (key === 'ArrowDown' ? 1 : -1), 0), column.length - 1);
    return column[to].id;
  }

  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;

  const days = [...new Set(all.map((b) => b.day))].sort();
  const step = key === 'ArrowRight' ? 1 : -1;

  for (let i = days.indexOf(from.day) + step; i >= 0 && i < days.length; i += step) {
    const column = inDay(days[i]);
    // An empty column is stepped over rather than swallowing the keypress: with the
    // weekend hidden and a quiet Tuesday, otherwise the arrow would appear dead.
    if (column.length === 0) continue;
    // The nearest block on the clock — what the eye would call "across from here".
    return column.reduce((best, b) =>
      Math.abs(b.offsetMs - from.offsetMs) < Math.abs(best.offsetMs - from.offsetMs) ? b : best,
    ).id;
  }

  // Nothing that way: stay put. Wrapping Friday round to Monday would read as the
  // week having stepped, which it has not.
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — 355 (348 + 7).

- [ ] **Step 5: Let a list answer its own arrows**

In `renderer/js/keynav.js`, extend `wireRovingList`. Add to its doc block:

```js
 * @param {(rows: Element[], from: Element, key: string) => Element|null} [spec.resolve]
 *        Which row a key means, for a list that is not a straight line — the week's
 *        grid is columns, where Down means "later that day" and Right means "the next
 *        column". Absent, the linear behaviour below applies.
```

and change the signature and the key handling:

```js
export function wireRovingList({ container, rowSelector, onMove, resolve }) {
```

```js
      let to = null;
      if (resolve) {
        // The list decides. Anything it does not answer for is left alone entirely,
        // so a grid does not have to re-implement the keys it does not care about.
        const row = resolve(all, all[from], event.key);
        if (!row) return;
        to = all.indexOf(row);
        if (to < 0) return;
      } else if (event.key === 'ArrowDown') to = Math.min(from + 1, all.length - 1);
      else if (event.key === 'ArrowUp') to = Math.max(from - 1, 0);
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = all.length - 1;
      if (to === null) return;
```

- [ ] **Step 6: Give both grids the resolver**

Both grids build their block list the same way, so the reader lives once. In `renderer/js/timeline.js`, add the imports:

```js
import { nextBlockId } from './block-nav.js';
```

and, beside `roving()`:

```js
/**
 * The rows of a grid as `block-nav` wants them: which column, and how far into it.
 *
 * Exported because the week view's roving list needs exactly the same reading of
 * exactly the same elements — the two grids differ in how many columns they draw and
 * in nothing else.
 */
export function blockNavResolver(rows, from, key) {
  const blocks = rows.map((el) => ({
    id: el.dataset.id,
    day: el.dataset.day,
    offsetMs: Number(el.dataset.start) - startOfDayMs(el.dataset.day),
  }));
  const id = nextBlockId(blocks, from?.dataset.id, key);
  return id ? rows.find((el) => el.dataset.id === id) ?? null : null;
}
```

and pass it:

```js
  rovingBlocks ??= wireRovingList({
    container: () => document.getElementById('schedule-grid'),
    rowSelector: '.sched-entry-block:not(.live)',
    onMove: (block) => select(block.dataset.id),
    resolve: blockNavResolver,
  });
```

In `renderer/js/week-view.js`, add `blockNavResolver` to the `./timeline.js` import and pass it the same way:

```js
  rovingBlocks ??= wireRovingList({
    container: () => $('week-scroll'),
    rowSelector: '.sched-entry-block:not(.live)',
    onMove: (block) => select(block.dataset.id),
    resolve: blockNavResolver,
  });
```

- [ ] **Step 7: Add the two UI checks**

In `scripts/ui-check.mjs`, append to `keyboard()`:

```js
  await check(
    'the day grid’s arrows walk its blocks in time order, not the order they were drawn',
    `await H.resetDay();
     const at = (hh) => { const d = new Date(); d.setHours(hh, 0, 0, 0); return d.getTime(); };
     // Deliberately out of order in the day log, so DOM order and time order differ.
     await window.joggl.days.save(H.todayKey(), [
       { id: 'nav-late', issueKey: 'GEN-1', issueId: null, title: 'Late', startTs: at(15),
         endTs: at(16), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       { id: 'nav-early', issueKey: 'GEN-2', issueId: null, title: 'Early', startTs: at(9),
         endTs: at(10), status: 'pending', worklogId: null, comment: null, errorMsg: null },
     ]);
     await window.__jogglTest.reloadDay();
     const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', {
       key, bubbles: true, cancelable: true }));
     const early = H.q('.sched-entry-block[data-id="nav-early"]');
     early.focus();
     press(early, 'ArrowDown');
     const down = document.activeElement?.dataset.id ?? null;
     press(document.activeElement, 'ArrowUp');
     const up = document.activeElement?.dataset.id ?? null;
     press(document.activeElement, 'ArrowUp');
     const held = document.activeElement?.dataset.id ?? null;
     await H.resetDay();
     return JSON.stringify({ down, up, held })`,
    (v) => {
      const d = JSON.parse(v);
      // Held at the top rather than wrapping — the same clamp every roving list has.
      return d.down === 'nav-late' && d.up === 'nav-early' && d.held === 'nav-early';
    },
  );

  await check(
    'in the week view ← and → cross columns while ↑ and ↓ stay in one',
    `H.q('.sidebar-item[data-view="week"]').click();
     await H.until(() => !H.q('#view-week').hidden, 8000, 'the week view');
     await H.settle();
     try {
       const a = H.colDay(0), b = H.colDay(1);
       const on = (day, hh) => new Date(day + 'T' + String(hh).padStart(2, '0') + ':00:00').getTime();
       await window.joggl.days.save(a, [
         { id: 'wk-a9', issueKey: 'GEN-1', issueId: null, title: 'A nine', startTs: on(a, 9),
           endTs: on(a, 10), status: 'pending', worklogId: null, comment: null, errorMsg: null },
         { id: 'wk-a15', issueKey: 'GEN-1', issueId: null, title: 'A three', startTs: on(a, 15),
           endTs: on(a, 16), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       ]);
       await window.joggl.days.save(b, [
         { id: 'wk-b14', issueKey: 'GEN-2', issueId: null, title: 'B two', startTs: on(b, 14),
           endTs: on(b, 15), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       ]);
       await window.__jogglTest.reloadDay();
       await H.until(() => !!H.q('.sched-entry-block[data-id="wk-b14"]'), 4000, 'the seeded blocks');
       const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', {
         key, bubbles: true, cancelable: true }));
       const start = H.q('.sched-entry-block[data-id="wk-a9"]');
       start.focus();
       press(start, 'ArrowDown');
       const down = document.activeElement?.dataset.id ?? null;
       press(document.activeElement, 'ArrowRight');
       const right = document.activeElement?.dataset.id ?? null;
       press(document.activeElement, 'ArrowLeft');
       const left = document.activeElement?.dataset.id ?? null;
       await H.clearDays([a, b]);
       return JSON.stringify({ down, right, left });
     } finally {
       H.q('.sidebar-item[data-view="day"]').click();
       await H.until(() => !H.q('#view-day').hidden, 8000, 'the day view');
     }`,
    (v) => {
      const d = JSON.parse(v);
      // Down stays on Monday; right crosses to Tuesday's only block; left comes back
      // to whichever of Monday's two is nearest 14:00, which is the 15:00 one.
      return d.down === 'wk-a15' && d.right === 'wk-b14' && d.left === 'wk-a15';
    },
  );
```

- [ ] **Step 8: Verify, and check the existing keyboard rows**

Run: `npm test`
Expected: PASS — 355.

Run: `npm run uicheck:fast`
Expected: PASS — 107 of 107. **The day view's arrow order has changed from DOM order to time order.** Any existing check in `keyboard()` or `clicks()` that walks the day grid with arrows and names an expected id may now expect a different one. If one fails, read what it reports: if the new order is time order, the check's expectation is what is stale, not the code — update it and say so in the commit.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Move between columns with the arrow keys"
```

---

## Task 5: Copy and paste

**Files:**
- Create: `renderer/js/clipboard.js`
- Modify: `renderer/js/copy-day.js`, `renderer/js/timeline-drag.js`, `renderer/js/app.js`, `renderer/css/app.css`
- Test: `test/paste.test.js`
- Modify: `scripts/ui-check.mjs` (three checks in `weekView()`)

**Interfaces:**
- Consumes: `copiedToDay`, `duplicateOf` from `entry-ops.js`; `selectedIds` from `selection.js`; `findEntry` from `state.js`; `sortEntries` from `merge.js`.
- Produces:
  - `daysBetween(from, to) -> number`, `clipboardFrom(items) -> {anchorDay, items} | null`, `pastePlan(clip, targetDay, newId?) -> {dayKey, entries}[]` — `clipboard.js`
  - `copySelection()`, `pasteClipboard(target?)` — `copy-day.js`

- [ ] **Step 1: Write the failing test**

Create `test/paste.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clipboardFrom, daysBetween, pastePlan } from '../renderer/js/clipboard.js';
import { startOfDayMs } from '../renderer/js/util.js';

const at = (dayKey, hh, mm = 0) => startOfDayMs(dayKey) + hh * 3_600_000 + mm * 60_000;

function item(id, dayKey, hh, overrides = {}) {
  return {
    dayKey,
    entry: {
      id,
      issueKey: 'GEN-1',
      issueId: '10042',
      title: 'Standup',
      startTs: at(dayKey, hh),
      endTs: at(dayKey, hh + 1),
      status: 'synced',
      worklogId: '60504',
      comment: 'what I did',
      errorMsg: null,
      ...overrides,
    },
  };
}

// A counter, so the ids in the assertions are predictable.
const ids = () => {
  let n = 0;
  return () => `copy-${++n}`;
};

test('whole days apart, rounded — one of the days between can be 25 hours long', () => {
  assert.equal(daysBetween('2026-08-03', '2026-08-06'), 3);
  assert.equal(daysBetween('2026-08-06', '2026-08-03'), -3);
  assert.equal(daysBetween('2026-08-03', '2026-08-03'), 0);
  // Across the autumn clock change, which makes 25 October 25 hours long here.
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
});

test('the clipboard remembers the earliest day it holds', () => {
  const clip = clipboardFrom([item('b', '2026-08-05', 9), item('a', '2026-08-03', 14)]);
  assert.equal(clip.anchorDay, '2026-08-03');
  assert.equal(clip.items.length, 2);
});

test('a running timer has no end to copy, and an empty clipboard is null not a husk', () => {
  assert.equal(clipboardFrom([item('r', '2026-08-03', 9, { endTs: null })]), null);
  assert.equal(clipboardFrom([]), null);
  assert.equal(clipboardFrom(null), null);
  assert.deepEqual(pastePlan(null, '2026-08-10'), []);
});

test('one day’s blocks pasted onto another arrive at the same times', () => {
  const clip = clipboardFrom([item('a', '2026-08-03', 9), item('b', '2026-08-03', 14)]);
  const plan = pastePlan(clip, '2026-08-10', ids());

  assert.equal(plan.length, 1);
  assert.equal(plan[0].dayKey, '2026-08-10');
  assert.deepEqual(
    plan[0].entries.map((e) => e.startTs - startOfDayMs('2026-08-10')),
    [9 * 3_600_000, 14 * 3_600_000],
  );
});

/**
 * The one rule: the earliest day is anchored onto the target and every offset is
 * kept, in days as well as on the clock.
 */
test('Tuesday and Thursday pasted onto Wednesday arrive on Wednesday and Friday', () => {
  const clip = clipboardFrom([item('tue', '2026-08-04', 9), item('thu', '2026-08-06', 11)]);
  const plan = pastePlan(clip, '2026-08-05', ids());
  assert.deepEqual(plan.map((p) => p.dayKey), ['2026-08-05', '2026-08-07']);
});

test('a whole week pasted onto a Monday reproduces the week', () => {
  const clip = clipboardFrom([
    item('mon', '2026-08-03', 9),
    item('wed', '2026-08-05', 9),
    item('fri', '2026-08-07', 9),
  ]);
  const plan = pastePlan(clip, '2026-08-10', ids());
  assert.deepEqual(plan.map((p) => p.dayKey), ['2026-08-10', '2026-08-12', '2026-08-14']);
});

/**
 * duplicateOf's promise, reached through copiedToDay: carrying the original's
 * worklogId across would make the next Sync rewrite that one worklog with the copy's
 * times, overwriting the original's record and never giving the copy one of its own.
 */
test('copies arrive unsynced, carrying no worklog, keeping the description', () => {
  const clip = clipboardFrom([item('a', '2026-08-03', 9)]);
  const [copy] = pastePlan(clip, '2026-08-10', ids())[0].entries;

  assert.equal(copy.worklogId, null);
  assert.equal(copy.status, 'pending');
  assert.equal(copy.id, 'copy-1', 'a new id, not the original’s');
  assert.equal(copy.comment, 'what I did');
  assert.equal(copy.errorMsg, null);
});

test('a copy of a Jira-side row becomes an ordinary entry of Joggl’s own', () => {
  const clip = clipboardFrom([item('j', '2026-08-03', 9, { id: 'jira:900', external: true })]);
  const [copy] = pastePlan(clip, '2026-08-10', ids())[0].entries;
  assert.equal(copy.external, undefined);
  assert.equal(copy.status, 'pending');
});

test('an entry with no issue key arrives local, and never syncs', () => {
  const clip = clipboardFrom([item('l', '2026-08-03', 9, { issueKey: null, issueId: null, worklogId: null, status: 'local' })]);
  const [copy] = pastePlan(clip, '2026-08-10', ids())[0].entries;
  assert.equal(copy.status, 'local');
});

/**
 * Measured as an offset from local midnight, never as a fixed number of
 * milliseconds: a copy across a clock change must not quietly claim the work
 * happened an hour earlier. Asserted as an offset so it holds in any timezone,
 * including one with no clock change at all.
 */
test('a paste across a clock change keeps the time on the clock', () => {
  const clip = clipboardFrom([item('a', '2026-10-24', 9)]);
  const [copy] = pastePlan(clip, '2026-10-25', ids())[0].entries;
  assert.equal(copy.startTs - startOfDayMs('2026-10-25'), 9 * 3_600_000);
  assert.equal(copy.endTs - copy.startTs, 3_600_000, 'still an hour long');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/clipboard.js'`.

- [ ] **Step 3: Write the pure module**

Create `renderer/js/clipboard.js`:

```js
// What Ctrl+C holds, and where Ctrl+V puts it.
//
// Pure — no DOM, no IPC — because the anchoring rule is the whole feature and it is
// easy to get subtly wrong in a way nobody notices until a pasted week is a day out.

import { copiedToDay } from './entry-ops.js';
import { addDays, startOfDayMs, uuid } from './util.js';

/**
 * Whole days from one key to another.
 *
 * Rounded, never floored: one of the days in between can be 25 hours long, and a
 * clock change would otherwise put a pasted week a day out from one Sunday a year.
 */
export function daysBetween(from, to) {
  return Math.round((startOfDayMs(to) - startOfDayMs(from)) / 86_400_000);
}

/**
 * The clipboard: the entries copied, each with the day it came from, and the earliest
 * of those days — the one that gets anchored onto wherever the paste lands.
 *
 * A running timer is dropped: it has no end to copy, which is the same reason
 * `copiedToDay` filters it out. Nothing copied at all answers null rather than an
 * empty clipboard, so "nothing to paste" and "paste nothing" cannot be confused.
 *
 * @param {{entry: object, dayKey: string}[]} items
 */
export function clipboardFrom(items) {
  const kept = (items ?? []).filter(
    ({ entry }) => entry && entry.endTs !== null && entry.endTs !== undefined,
  );
  if (kept.length === 0) return null;
  return { anchorDay: kept.map(({ dayKey }) => dayKey).sort()[0], items: kept };
}

/**
 * Where a paste lands, as one write per day.
 *
 * **One rule covers every case.** The earliest day in the selection is anchored onto
 * the target day and every offset is preserved — both the offset in days and the time
 * on the clock. So one day's blocks pasted onto another arrive at the same times;
 * Tuesday and Thursday pasted onto Wednesday arrive on Wednesday and Friday; and the
 * whole week selected, stepped forward and pasted onto Monday reproduces the week.
 *
 * The times themselves are `copiedToDay`'s business, which measures them as an offset
 * from local midnight rather than as a fixed number of milliseconds — and everything
 * a copy does not inherit is `duplicateOf`'s.
 *
 * @returns {{dayKey: string, entries: object[]}[]} in day order
 */
export function pastePlan(clip, targetDay, newId = uuid) {
  if (!clip) return [];

  const byDay = new Map();
  for (const { entry, dayKey } of clip.items) {
    const list = byDay.get(dayKey);
    if (list) list.push(entry);
    else byDay.set(dayKey, [entry]);
  }

  return [...byDay.keys()]
    .sort()
    .map((dayKey) => {
      const to = addDays(targetDay, daysBetween(clip.anchorDay, dayKey));
      return { dayKey: to, entries: copiedToDay(byDay.get(dayKey), dayKey, to, newId) };
    });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — 365 (355 + 10).

- [ ] **Step 5: Wire copy and paste**

In `renderer/js/copy-day.js`, add the imports:

```js
import { clipboardFrom, pastePlan } from './clipboard.js';
import { sortEntries } from './merge.js';
import { selectedIds } from './selection.js';
import { entriesFor, findEntry, loadDays, persistDayNow, setEntriesFor, state } from './state.js';
```

and append:

```js
// ── Copying a selection, and pasting it ────────────────────────────────────

/**
 * What Ctrl+C is holding. Renderer-local and not persisted, exactly like the
 * selection: it says what you are in the middle of doing, and that does not survive
 * closing the window.
 */
let clipboard = null;

export function copySelection() {
  const items = selectedIds()
    .map((id) => findEntry(id))
    .filter(Boolean);
  const clip = clipboardFrom(items);

  if (!clip) {
    toast('Nothing to copy — select some entries first.');
    return;
  }
  clipboard = clip;
  toastOk(`${plural(clip.items.length)} copied. Ctrl+V pastes onto the marked day.`);
}

/**
 * Paste onto the marked day.
 *
 * The target is `state.selectedDate` — the week's anchor, which is what clicking a
 * column head sets and what the day view is showing. There is one answer in this app
 * to "which day is this about" and this is it.
 *
 * Every day's result is written to memory before any write to disk is attempted, for
 * the reason `clearWeek` gives: whatever happens next, the screen ends up showing
 * what memory holds, and a `persistDayNow` that throws partway through risks only
 * that one day's paste not surviving a restart.
 */
export async function pasteClipboard(target = state.selectedDate) {
  if (!clipboard) {
    toast('Nothing copied yet — select some entries and press Ctrl+C.');
    return;
  }

  const plan = pastePlan(clipboard, target);
  for (const { dayKey, entries } of plan) {
    setEntriesFor(dayKey, sortEntries([...entriesFor(dayKey), ...entries]));
  }

  const count = plan.reduce((sum, p) => sum + p.entries.length, 0);
  try {
    for (const { dayKey } of plan) await persistDayNow(dayKey);
    toastOk(
      `${plural(count)} pasted onto ${formatDateLabel(target)}` +
        (plan.length > 1 ? ` and ${plan.length - 1} more day${plan.length === 2 ? '' : 's'}` : '') +
        '. They arrive unsynced — nothing reaches Jira until you press Sync.',
    );
  } catch (err) {
    toastErr(`Could not save the paste — ${err.message}`);
  } finally {
    renderAll();
  }
}
```

- [ ] **Step 6: Ctrl+drag copies rather than moves**

In `renderer/js/timeline-drag.js`, add the imports:

```js
import { duplicateOf, sameTimes } from './entry-ops.js';
import { sortEntries } from './merge.js';
import { entriesFor, persistDayNow, setEntriesFor, state, visibleEntries, visibleEntriesFor } from './state.js';
import { uuid } from './util.js';   // add uuid to the existing util import
```

and rewrite the head of `onMoveBlock`, plus its mouseup:

```js
export function onMoveBlock(event, entry, dayKey) {
  event.preventDefault();
  event.stopPropagation();
  if (locked(entry)) return;

  /**
   * Ctrl turns the move into a copy.
   *
   * The gesture then runs on a duplicate that is in no day log at all, so the
   * original is never touched and the drop is an insert rather than a move. The
   * element under the cursor is still the original's — there is nothing else to
   * drag — so it wears `copying` and springs back when the commit re-renders, which
   * is the honest picture: what is being placed is a copy of it.
   *
   * The copy carries no worklogId, exactly as Ctrl+C/Ctrl+V and *Duplicate* produce,
   * so the next Sync logs it as new work rather than rewriting the original's.
   */
  const copying = event.ctrlKey || event.metaKey;
  const subject = copying ? duplicateOf(entry, uuid()) : entry;

  const origStart = subject.startTs;
  const duration = subject.endTs - origStart;
  const startY = event.clientY;
  const offset = origStart - startOfDayMs(dayKey);
  const block = document.querySelector(`.sched-entry-block[data-id="${CSS.escape(entry.id)}"]`);
  block?.classList.add('dragging', 'moving');
  if (copying) block?.classList.add('copying');
  let targetDay = dayKey;
  let moved = false;
```

Every remaining `entry.startTs` / `entry.endTs` inside the handler becomes `subject.…`:

```js
    entry.startTs = start;      →      subject.startTs = start;
    entry.endTs = end;          →      subject.endTs = end;
    liveUpdate(block, entry, targetDay);   →   liveUpdate(block, subject, targetDay);
```

and the mouseup gains one branch, first:

```js
  const onMouseUp = async () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    block?.classList.remove('dragging', 'moving', 'copying');
    if (moved) suppressClickUntil = Date.now() + CLICK_TAIL_MS;

    if (copying) {
      // Committed even when it never moved: a copy dropped where it started is a
      // duplicate, which is a thing this app already offers and means to.
      suppressClickUntil = Date.now() + CLICK_TAIL_MS;
      setEntriesFor(targetDay, sortEntries([...entriesFor(targetDay), subject]));
      await persistDayNow(targetDay);
      renderAll();
      return;
    }

    if (targetDay !== dayKey) {
      …                        // unchanged
```

- [ ] **Step 7: The keys**

In `renderer/js/app.js`, add to the imports:

```js
import { clearDay, copyPreviousDay, copySelection, pasteClipboard } from './copy-day.js';
import { clearSelection, selectAllVisible, wireRubberBand } from './selection.js';
```

and in `wireGlobal`'s keydown, after the Ctrl+Enter block and **before** the bare-key guard:

```js
    // Ctrl+A, Ctrl+C and Ctrl+V mean something inside a text field, and there it has
    // to win — unlike Ctrl+L, which is deliberately reachable from the search box
    // itself. So these three are suppressed while typing.
    if ((event.ctrlKey || event.metaKey) && !typing) {
      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        selectAllVisible();
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        pasteClipboard();
        return;
      }
    }
```

- [ ] **Step 8: The copying block**

Append to `renderer/css/app.css`, next to `.sched-entry-block.dragging`:

```css
/* Ctrl+drag: what is being placed is a copy, and the block under the cursor is the
   original standing in for it. Dashed, so it does not read as the original moving. */
.sched-entry-block.copying {
  border-style: dashed;
}
```

- [ ] **Step 9: Add the three UI checks**

In `scripts/ui-check.mjs`, append to `weekView()`:

```js
  await check(
    'week: copy a day’s blocks and paste them onto another, at the same times',
    inWeek(`const from = H.colDay(0), to = H.colDay(2);
            const on = (day, hh) => new Date(day + 'T' + String(hh).padStart(2, '0') + ':00:00').getTime();
            await window.joggl.days.save(from, [
              { id: 'cp-1', issueKey: 'GEN-1', issueId: null, title: 'Nine', startTs: on(from, 9),
                endTs: on(from, 10), status: 'synced', worklogId: '60504', comment: 'kept', errorMsg: null },
              { id: 'cp-2', issueKey: 'GEN-2', issueId: null, title: 'Two', startTs: on(from, 14),
                endTs: on(from, 15), status: 'pending', worklogId: null, comment: null, errorMsg: null },
            ]);
            await window.joggl.days.save(to, []);
            await window.__jogglTest.reloadDay();
            await H.until(() => !!H.q('.sched-entry-block[data-id="cp-2"]'), 4000, 'the seeded blocks');
            for (const id of ['cp-1', 'cp-2']) {
              H.q('.sched-entry-block[data-id="' + id + '"]').dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
            }
            const press = (key) => document.body.dispatchEvent(new KeyboardEvent('keydown', {
              key, ctrlKey: true, bubbles: true, cancelable: true }));
            press('c');
            // The paste lands on the marked day, so mark the target column first.
            H.q('.week-colhead[data-day="' + to + '"]').click();
            await H.settle();
            press('v');
            await H.sleep(500);
            const landed = (await window.joggl.days.get(to)).entries
              .map(e => ({ h: new Date(e.startTs).getHours(), status: e.status,
                           worklogId: e.worklogId, comment: e.comment }));
            const source = (await window.joggl.days.get(from)).entries.length;
            await H.clearDays([from, to]);
            await H.goToday();
            return JSON.stringify({ landed, source });`),
    (v) => {
      const d = JSON.parse(v);
      // Both copies at the same hours, both unsynced and carrying no worklog — the
      // synced one included, or the next Sync would rewrite the original's worklog.
      return d.source === 2 && d.landed.length === 2 &&
        d.landed.map((e) => e.h).join() === '9,14' &&
        d.landed.every((e) => e.worklogId === null && e.status === 'pending') &&
        d.landed[0].comment === 'kept';
    },
  );

  await check(
    'week: a two-day selection pasted keeps the gap between the days',
    inWeek(`const a = H.colDay(0), b = H.colDay(2), target = H.colDay(1);
            const on = (day, hh) => new Date(day + 'T' + String(hh).padStart(2, '0') + ':00:00').getTime();
            const seed = (day, id) => ({ id, issueKey: 'GEN-1', issueId: null, title: id,
              startTs: on(day, 10), endTs: on(day, 11), status: 'pending', worklogId: null,
              comment: null, errorMsg: null });
            await window.joggl.days.save(a, [seed(a, 'gap-a')]);
            await window.joggl.days.save(b, [seed(b, 'gap-b')]);
            await window.joggl.days.save(target, []);
            await window.__jogglTest.reloadDay();
            await H.until(() => !!H.q('.sched-entry-block[data-id="gap-b"]'), 4000, 'the seeded blocks');
            for (const id of ['gap-a', 'gap-b']) {
              H.q('.sched-entry-block[data-id="' + id + '"]').dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
            }
            const press = (key) => document.body.dispatchEvent(new KeyboardEvent('keydown', {
              key, ctrlKey: true, bubbles: true, cancelable: true }));
            press('c');
            H.q('.week-colhead[data-day="' + target + '"]').click();
            await H.settle();
            press('v');
            await H.sleep(600);
            // The earliest day anchors onto the target, so the second lands two days
            // later — which is the column after the one after the target.
            const onTarget = (await window.joggl.days.get(target)).entries.length;
            const twoLater = H.colDay(3);
            const onTwoLater = (await window.joggl.days.get(twoLater)).entries.length;
            await H.clearDays([a, b, target, twoLater]);
            await H.goToday();
            return JSON.stringify({ onTarget, onTwoLater });`),
    (v) => {
      const d = JSON.parse(v);
      return d.onTarget === 1 && d.onTwoLater === 1;
    },
  );

  await check(
    'week: Ctrl+drag copies a block instead of moving it',
    inWeek(`const from = H.colDay(0), to = H.colDay(3);
            const on = (day, hh) => new Date(day + 'T' + String(hh).padStart(2, '0') + ':00:00').getTime();
            await window.joggl.days.save(from, [
              { id: 'ctrl-drag', issueKey: 'GEN-1', issueId: null, title: 'Copy me',
                startTs: on(from, 10), endTs: on(from, 11), status: 'pending', worklogId: null,
                comment: null, errorMsg: null },
            ]);
            await window.joggl.days.save(to, []);
            await window.__jogglTest.reloadDay();
            await H.until(() => !!H.q('.sched-entry-block[data-id="ctrl-drag"]'), 4000, 'the seeded block');
            const block = H.q('.sched-entry-block[data-id="ctrl-drag"]');
            const box = block.getBoundingClientRect();
            const target = H.all('.week-col')[3].getBoundingClientRect();
            const sx = Math.round(box.left + 10), sy = Math.round(box.top + 8);
            const tx = Math.round(target.left + target.width / 2);
            block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
              button: 0, buttons: 1, clientX: sx, clientY: sy, ctrlKey: true }));
            for (let i = 1; i <= 5; i++) {
              H.mouse(document, 'mousemove', Math.round(sx + (tx - sx) * i / 5), sy, 1);
            }
            H.mouse(document, 'mouseup', tx, sy, 0);
            await H.sleep(500);
            const left = (await window.joggl.days.get(from)).entries.map(e => e.id);
            const arrived = (await window.joggl.days.get(to)).entries.map(e => ({ id: e.id, worklogId: e.worklogId }));
            await H.clearDays([from, to]);
            return JSON.stringify({ left, arrived });`),
    (v) => {
      const d = JSON.parse(v);
      return JSON.stringify(d.left) === JSON.stringify(['ctrl-drag']) &&
        d.arrived.length === 1 && d.arrived[0].id !== 'ctrl-drag' && d.arrived[0].worklogId === null;
    },
  );
```

- [ ] **Step 10: Verify**

Run: `npm test`
Expected: PASS — 365.

Run: `npm run uicheck:fast`
Expected: PASS — 110 of 110.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Copy a selection and paste it, keeping every offset"
```

---

## Task 6: Delete the selection

The one task in this phase that can write to Jira. Read the constraint at the top again: **no UI check may press "Delete in Jira too"**.

**Files:**
- Modify: `renderer/js/entry-ops.js` (`planDeletion`), `renderer/js/entries.js` (`deleteSelection`), `renderer/js/app.js` (the `Delete` key)
- Test: `test/delete-many.test.js`
- Modify: `scripts/ui-check.mjs` (two checks in `clicks()`)

**Interfaces:**
- Consumes: `selectedIds` from `selection.js`; `findEntry`, `deleteWorklog`, `dropExternalWorklog` from `state.js`; `askModal`.
- Produces:
  - `planDeletion(items) -> {removable, synced, external, days, idsFor(day)}` — `entry-ops.js`
  - `deleteSelection()` — `entries.js`

- [ ] **Step 1: Write the failing test**

Create `test/delete-many.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planDeletion } from '../renderer/js/entry-ops.js';

const item = (id, dayKey, overrides = {}) => ({
  dayKey,
  entry: { id, issueKey: 'GEN-1', title: 'Standup', worklogId: null, ...overrides },
});

test('a plan separates what can go, what is in Jira, and what is not ours', () => {
  const plan = planDeletion([
    item('a', '2026-08-03'),
    item('b', '2026-08-03', { worklogId: '60504' }),
    item('jira:900', '2026-08-04', { external: true, worklogId: '900' }),
  ]);

  assert.deepEqual(plan.removable.map((i) => i.entry.id), ['a', 'b']);
  assert.deepEqual(plan.synced.map((i) => i.entry.id), ['b']);
  assert.deepEqual(plan.external.map((i) => i.entry.id), ['jira:900']);
});

/**
 * A Jira-side row is never removed, so a day that holds only those is not a day this
 * touches at all — writing it would rewrite a day log for no reason.
 */
test('the days are only the ones something is actually coming off', () => {
  const plan = planDeletion([
    item('a', '2026-08-05'),
    item('b', '2026-08-03'),
    item('jira:900', '2026-08-07', { external: true }),
  ]);
  assert.deepEqual(plan.days, ['2026-08-03', '2026-08-05'], 'in order, and no Jira-only day');
});

test('the ids coming off a given day, and no other day’s', () => {
  const plan = planDeletion([
    item('a', '2026-08-03'),
    item('b', '2026-08-03'),
    item('c', '2026-08-05'),
  ]);
  assert.deepEqual([...plan.idsFor('2026-08-03')].sort(), ['a', 'b']);
  assert.deepEqual([...plan.idsFor('2026-08-05')], ['c']);
  assert.deepEqual([...plan.idsFor('2026-08-09')], []);
});

test('a selection of nothing but Jira rows removes nothing', () => {
  const plan = planDeletion([item('jira:900', '2026-08-04', { external: true })]);
  assert.equal(plan.removable.length, 0);
  assert.deepEqual(plan.days, []);
});

test('an empty selection is a plan, not a crash', () => {
  const plan = planDeletion([]);
  assert.deepEqual(plan.removable, []);
  assert.deepEqual(plan.days, []);
  assert.deepEqual(planDeletion(null).removable, []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `planDeletion is not a function`.

- [ ] **Step 3: Write the plan**

In `renderer/js/entry-ops.js`, append after `planClearWeek`:

```js
/**
 * What deleting a selection would actually do.
 *
 * The sibling of `planClearWeek`, and here for the same reason: the split between
 * what goes, what has a worklog behind it and what is not Joggl's to touch decides
 * what the modal says and what it then does, and it is worth testing without a DOM.
 *
 * A **Jira-side row is never removed**. It may be selected — copying a day that
 * includes time booked in the web UI is exactly what *Copy previous day* already does
 * — but it is not Joggl's record, so a delete steps over it and says how many it left.
 *
 * @param {{entry: object, dayKey: string}[]} items
 */
export function planDeletion(items) {
  const all = items ?? [];
  const external = all.filter(({ entry }) => entry?.external);
  const removable = all.filter(({ entry }) => entry && !entry.external);

  return {
    removable,
    external,
    synced: removable.filter(({ entry }) => entry.worklogId),
    // Only the days something is actually coming off: a day holding nothing but
    // Jira-side rows must not have its day log rewritten for no reason.
    days: [...new Set(removable.map(({ dayKey }) => dayKey))].sort(),
    /** The ids coming off `day`. */
    idsFor(day) {
      return new Set(removable.filter((i) => i.dayKey === day).map((i) => i.entry.id));
    },
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — 371 (366 + 5).

- [ ] **Step 5: Write the batch delete**

In `renderer/js/entries.js`, the three import lines this needs, in full — `formatDateLabel`
and `selectMany` are new to this file, the rest already partly there:

```js
import {
  canRetarget,
  dirtiedEntry,
  duplicateOf,
  flaggedOverlaps,
  planDeletion,
  retargetEntry,
  sameComment,
  sameTimes,
} from './entry-ops.js';
import { applySelection, clearSelection, select, selectMany, selectedIds, toggleSelect } from './selection.js';
import { esc, formatDateLabel, hhmmToTs, msToDur, parseDur, plural, snapToQuarter, tsToHHMM, uuid } from './util.js';
```

`plural` is new. `copy-day.js` has had its own copy of that one line since *Copy previous
day*, and this would be the second — so it moves to `util.js`, where `msToDur` and
`formatDateLabel` already live, rather than being written out twice. In
`renderer/js/util.js`:

```js
/** `1 entry` / `3 entries`. Here rather than twice over, now that two modules count. */
export function plural(n) {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}
```

and in `renderer/js/copy-day.js`, delete its local definition —

```js
const plural = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
```

— and add `plural` to its existing `./util.js` import instead:

```js
import { addDays, esc, formatDateLabel, msToDur, plural } from './util.js';
```

Then append after `deleteEntry` in `entries.js`:

```js
/**
 * Delete everything selected.
 *
 * One entry falls through to `deleteEntry`, so the single case keeps the wording and
 * the per-entry Jira offer it already has, and there is one path rather than two that
 * drift. More than one asks first — with the counts, which is what makes the question
 * answerable.
 *
 * The Jira half is sequential and honest about partial failure, the same shape
 * `sync.js` uses: an entry whose worklog could not be deleted **stays**, carrying the
 * error, because it still stands for time that is really logged in Jira. Removing it
 * locally would leave that time booked with nothing on screen to account for it,
 * which is the exact failure the single delete's modal exists to prevent.
 */
export async function deleteSelection() {
  // Fixed before the modal, which stays up for as long as the user reads it, and
  // before the DELETEs, which the day can be stepped underneath.
  const items = selectedIds().map((id) => findEntry(id)).filter(Boolean);
  const plan = planDeletion(items);

  if (plan.removable.length === 0) {
    toastWarn(
      plan.external.length > 0
        ? 'Those worklogs were made in Jira — delete them there.'
        : 'Nothing selected to delete.',
    );
    return;
  }
  if (plan.removable.length === 1) {
    await deleteEntry(plan.removable[0].entry.id);
    return;
  }

  const answer = await askModal({
    title: `Delete ${plan.removable.length} entries?`,
    body: deleteManyBody(plan),
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      // With nothing synced there is no Jira decision to make, so the plain removal
      // becomes the primary action rather than a second-choice button sitting beside
      // a missing one.
      { label: 'Remove here only', value: 'local', primary: plan.synced.length === 0 },
      ...(plan.synced.length > 0
        ? [{ label: 'Delete in Jira too', value: 'jira', primary: true }]
        : []),
    ],
    dismissValue: 'cancel',
  });
  if (answer === 'cancel') return;

  // The running timer's entry cannot be deleted out from under it.
  if (plan.removable.some(({ entry }) => state.timer?.entryId === entry.id)) {
    await stopTimer({ save: false });
  }

  /** @type {{day: string, entry: object}[]} */
  const failed = [];

  if (answer === 'jira') {
    for (const { entry, dayKey } of plan.synced) {
      try {
        await deleteWorklog(entry);
        // Exactly the row that is gone, next to the DELETE that made it false — the
        // same surgical invalidation `deleteEntry` does, and for the same reason.
        dropExternalWorklog(dayKey, entry.worklogId);
      } catch (err) {
        entry.errorMsg = `Could not delete the worklog — ${err.message}`;
        failed.push({ day: dayKey, entry });
      }
    }
  }

  // Whatever failed in Jira stays here, so the two records agree.
  const keep = new Set(failed.map(({ entry }) => entry.id));
  for (const day of plan.days) {
    const going = plan.idsFor(day);
    setEntriesFor(day, entriesFor(day).filter((e) => !going.has(e.id) || keep.has(e.id)));
    await persistDayNow(day);
  }

  clearSelection();
  renderAll();

  if (plan.external.length > 0) {
    toast(
      `${plural(plan.external.length)} logged in Jira left alone — they are not Joggl’s to remove.`,
    );
  }

  if (failed.length === 0) {
    toastOk(
      answer === 'jira'
        ? `${plural(plan.removable.length)} deleted, and ${plural(plan.synced.length)} removed from Jira.`
        : `${plural(plan.removable.length)} deleted. Nothing was removed from Jira.`,
    );
    return;
  }

  await showDeleteFailures(failed);
}

function deleteManyBody(plan) {
  const body = document.createElement('div');
  const lines = [];
  const unsynced = plan.removable.length - plan.synced.length;
  if (unsynced > 0) lines.push(`${plural(unsynced)} not yet in Jira`);
  if (plan.synced.length > 0) lines.push(`${plural(plan.synced.length)} already synced`);

  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `Selected: ${lines.join(' and ')}` +
    (plan.days.length > 1 ? `, across ${plan.days.length} days.` : '.');
  body.appendChild(lede);

  const note = document.createElement('p');
  note.className = 'panel-lede';
  note.textContent =
    plan.synced.length > 0
      ? '“Remove here only” leaves the synced time logged in Jira. “Delete in Jira too” ' +
        'removes those worklogs as well, one at a time — anything that fails stays here, ' +
        'so the two never disagree.'
      : 'None of these has reached Jira, so nothing there is affected.';
  body.appendChild(note);

  if (plan.external.length > 0) {
    const skipped = document.createElement('p');
    skipped.className = 'panel-lede';
    skipped.textContent =
      `${plural(plan.external.length)} in the selection ${plan.external.length === 1 ? 'was' : 'were'} ` +
      'logged in the Jira web UI and will be left alone — they are not Joggl’s to remove.';
    body.appendChild(skipped);
  }

  return body;
}

/** No automatic retry, the same promise Sync makes: the user sees what failed. */
async function showDeleteFailures(failed) {
  const body = document.createElement('div');
  const lede = document.createElement('p');
  lede.className = 'panel-lede';
  lede.textContent =
    `${plural(failed.length)} could not be removed from Jira, so ${failed.length === 1 ? 'it is' : 'they are'} ` +
    'still here — the time is really logged there, and deleting the row would hide it.';

  const list = document.createElement('ul');
  list.className = 'fail-list';
  list.innerHTML = failed
    .map(
      ({ day, entry }) =>
        `<li><strong>${esc(entry.issueKey ?? '')}</strong> — ${esc(entry.title)} ` +
        `· ${esc(formatDateLabel(day))}<br><small>${esc(entry.errorMsg)}</small></li>`,
    )
    .join('');

  body.append(lede, list);

  const answer = await askModal({
    title: `${failed.length} worklog${failed.length === 1 ? '' : 's'} not deleted`,
    body,
    buttons: [
      { label: 'Close', value: 'close' },
      { label: 'Retry failed', value: 'retry', primary: true },
    ],
    dismissValue: 'close',
  });
  if (answer !== 'retry') return;

  selectMany(failed.map(({ entry }) => entry.id));
  await deleteSelection();
}
```

Add what this needs to the imports at the top of `entries.js`: `selectMany` from `./selection.js`, and `formatDateLabel` from `./util.js`. The existing file-local `plural` — `copy-day.js` has one of its own; this is a second, deliberately, rather than a shared export for four words.

- [ ] **Step 6: The Delete key**

In `renderer/js/app.js`, add `deleteSelection` to the `./entries.js` import, and add it to `wireGlobal`'s bare-key section, beside `[` and `]`:

```js
    } else if (event.key === 'Delete') {
      // A bare key, so it is already suppressed while typing and behind a modal.
      event.preventDefault();
      deleteSelection();
    }
```

- [ ] **Step 7: Add the two UI checks**

In `scripts/ui-check.mjs`, append to `clicks()`. **Neither presses "Delete in Jira too".**

```js
  await check(
    'Delete asks before removing more than one, and names what it holds',
    `await H.resetDay();
     const at = (hh) => { const d = new Date(); d.setHours(hh, 0, 0, 0); return d.getTime(); };
     await window.joggl.days.save(H.todayKey(), [
       { id: 'del-a', issueKey: 'GEN-1', issueId: null, title: 'One', startTs: at(9),
         endTs: at(10), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       { id: 'del-b', issueKey: 'GEN-2', issueId: null, title: 'Two', startTs: at(11),
         endTs: at(12), status: 'pending', worklogId: null, comment: null, errorMsg: null },
     ]);
     await window.__jogglTest.reloadDay();
     for (const id of ['del-a', 'del-b']) {
       H.q('.sched-entry-block[data-id="' + id + '"]').dispatchEvent(
         new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
     }
     document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
     await H.until(() => !H.q('#modal-overlay').classList.contains('hidden'), 4000, 'the confirmation');
     const title = H.q('#modal-title').textContent;
     const buttons = H.all('#modal-buttons button').map(b => b.textContent);
     const body = H.q('#modal-body').textContent;
     H.all('#modal-buttons button').find(b => b.textContent === 'Cancel').click();
     await H.until(() => H.q('#modal-overlay').classList.contains('hidden'), 3000, 'the modal to close');
     await H.sleep(200);
     const stillThere = (await window.joggl.days.get(H.todayKey())).entries.length;
     await H.resetDay();
     return JSON.stringify({ title, buttons, body, stillThere })`,
    (v) => {
      const d = JSON.parse(v);
      // Nothing synced here, so there is no Jira button to offer — and Cancel must
      // leave both entries exactly where they were.
      return /Delete 2 entries/.test(d.title) && d.stillThere === 2 &&
        d.buttons.includes('Remove here only') &&
        !d.buttons.includes('Delete in Jira too') &&
        /None of these has reached Jira/.test(d.body);
    },
  );

  await check(
    '“Remove here only” takes the selection off every day it spans, and touches Jira on none',
    `H.q('.sidebar-item[data-view="week"]').click();
     await H.until(() => !H.q('#view-week').hidden, 8000, 'the week view');
     await H.settle();
     try {
       const a = H.colDay(0), b = H.colDay(1);
       const on = (day, hh) => new Date(day + 'T' + String(hh).padStart(2, '0') + ':00:00').getTime();
       await window.joggl.days.save(a, [
         { id: 'dm-a1', issueKey: 'GEN-1', issueId: null, title: 'Going', startTs: on(a, 9),
           endTs: on(a, 10), status: 'pending', worklogId: null, comment: null, errorMsg: null },
         { id: 'dm-a2', issueKey: 'GEN-1', issueId: null, title: 'Staying', startTs: on(a, 14),
           endTs: on(a, 15), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       ]);
       await window.joggl.days.save(b, [
         { id: 'dm-b1', issueKey: 'GEN-2', issueId: null, title: 'Going too', startTs: on(b, 9),
           endTs: on(b, 10), status: 'pending', worklogId: null, comment: null, errorMsg: null },
       ]);
       await window.__jogglTest.reloadDay();
       await H.until(() => !!H.q('.sched-entry-block[data-id="dm-b1"]'), 4000, 'the seeded blocks');
       const before = window.__jogglTest.jiraReads;
       for (const id of ['dm-a1', 'dm-b1']) {
         H.q('.sched-entry-block[data-id="' + id + '"]').dispatchEvent(
           new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
       }
       document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
       await H.until(() => !H.q('#modal-overlay').classList.contains('hidden'), 4000, 'the confirmation');
       H.all('#modal-buttons button').find(t => t.textContent === 'Remove here only').click();
       await H.until(() => H.q('#modal-overlay').classList.contains('hidden'), 4000, 'the modal to close');
       await H.sleep(500);
       const leftA = (await window.joggl.days.get(a)).entries.map(e => e.id);
       const leftB = (await window.joggl.days.get(b)).entries.map(e => e.id);
       const selected = H.all('.sched-entry-block.is-selected').length;
       await H.clearDays([a, b]);
       return JSON.stringify({ leftA, leftB, selected, before, after: window.__jogglTest.jiraReads });
     } finally {
       H.q('.sidebar-item[data-view="day"]').click();
       await H.until(() => !H.q('#view-day').hidden, 8000, 'the day view');
     }`,
    (v) => {
      const d = JSON.parse(v);
      return JSON.stringify(d.leftA) === JSON.stringify(['dm-a2']) &&
        JSON.stringify(d.leftB) === JSON.stringify([]) &&
        d.selected === 0;
    },
  );
```

- [ ] **Step 8: Verify**

Run: `npm test`
Expected: PASS — 371.

Run: `npm run uicheck:fast`
Expected: PASS — 114 of 114.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Delete a selection, and say what that means for Jira"
```

---

## Task 7: The help panel, the documentation, and the version

**Files:**
- Modify: `renderer/js/help.js`, `renderer/index.html`
- Modify: `scripts/ui-check.mjs`, `test-and-issues.md`, `CLAUDE.md`
- Modify: `package.json` via `npm run bump`

- [ ] **Step 1: Add the bindings to the one list**

In `renderer/js/help.js`, add a group after *In the week view*:

```js
  {
    group: 'Selecting and copying',
    keys: [
      ['Click', 'Select one entry — marked in every panel it appears in'],
      ['Ctrl + click', 'Add one to the selection, or take it out again'],
      ['Drag on empty grid', 'A rubber band. It catches a block when the box encloses it, not when it merely crosses it'],
      ['Ctrl + A', 'Select everything on screen — the week, or the day'],
      ['Ctrl + C', 'Copy the selection'],
      ['Ctrl + V', 'Paste onto the marked day, keeping every offset — in days as well as on the clock'],
      ['Ctrl + drag', 'Copy a block instead of moving it'],
      ['Delete', 'Delete the selection. More than one asks first, and says what is already in Jira'],
      ['← →', 'Move between columns; ↑ ↓ move within one'],
    ],
  },
```

- [ ] **Step 2: Add the prose**

In `renderer/index.html`, before the `Keyboard` section (currently at line 455):

```html
        <div class="settings-section">
          <div class="settings-section-title">Selecting several at once</div>
          <ul class="help-list">
            <li>
              <strong>Ctrl+click</strong> adds an entry to the selection, and
              <strong>dragging on empty grid</strong> draws a box round several. The box
              has to <em>enclose</em> a block to catch it — a band drawn down a column
              would otherwise sweep up everything it crossed. <strong>Ctrl+A</strong>
              takes everything on screen, <strong>Escape</strong> puts it all down.
            </li>
            <li>
              <strong>Ctrl+C</strong> copies the selection and <strong>Ctrl+V</strong>
              pastes it onto the marked day, keeping every offset: Tuesday and Thursday
              pasted onto a Wednesday arrive on Wednesday and Friday, at the same times
              on the clock. <strong>Ctrl+drag</strong> copies a single block where you
              can already see the target. Copies always arrive unsynced, so nothing
              reaches Jira until you press Sync.
            </li>
            <li>
              <strong>Delete</strong> removes the selection. More than one asks first
              and says how many are already in Jira — you can leave those worklogs alone
              or remove them too. Time logged in the Jira web UI is never deleted: it is
              not Joggl’s to remove.
            </li>
          </ul>
        </div>
```

- [ ] **Step 3: Update the help checks**

In `scripts/ui-check.mjs`, in `help()`, the row-count check names the totals. `SHORTCUTS` now has **8 groups and 33 rows** (24 + the 9 above). Update it:

```js
      // Every binding the app actually has must appear, or the help is a lie. Exact
      // counts, not a floor: a floor still passes if an entire group is deleted, as
      // long as what's left clears the bar — see SHORTCUTS in help.js for the 8
      // groups / 33 rows this counts.
      const wanted = ['Ctrl + L', 'Ctrl + Enter', 'F1', 'T', '[ or ]', 'Page Up / Page Down'];
      return d.groups.length === 8 && d.rows === 33 &&
```

Run `npm run uicheck:fast` and read what that check reports if it fails — the numbers above are what the list should produce, and a mismatch means a row was added or dropped somewhere else, not that the count is wrong.

Then add one check so the group cannot quietly go away:

```js
  await check(
    'help: selecting and copying has its own bindings',
    `H.q('#help-btn').click(); await H.sleep(200);
     const groups = H.all('#help-shortcuts .help-keys-group th').map(t => t.textContent);
     const keys = H.all('#help-shortcuts kbd').map(k => k.textContent);
     const text = H.q('#help-overlay').textContent;
     H.q('#close-help').click(); await H.sleep(150);
     return JSON.stringify({ hasGroup: groups.includes('Selecting and copying'),
                             hasKeys: ['Ctrl + A', 'Ctrl + C', 'Ctrl + V', 'Delete'].every(k => keys.includes(k)),
                             saysEnclose: /encloses it/.test(text) })`,
    (v) => {
      const d = JSON.parse(v);
      return d.hasGroup && d.hasKeys && d.saysEnclose;
    },
  );
```

- [ ] **Step 4: Add the checklist rows**

In `test-and-issues.md`, add a section after **Week view**:

```markdown
### Selecting and copying

| Do this | Correct result |
|---|---|
| Click a block, then Ctrl+click another | Both are outlined, in the day view's list as well as on the grid. Ctrl+click one again and it drops out. |
| Drag a box on empty grid across three blocks, clipping a fourth | The three it encloses are selected; the one it merely crosses is not. No quick-entry popup opens. |
| Start a drag on a block | It moves the block, as it always did. No band is drawn. |
| Press Ctrl+A | Everything on screen is selected — every column of the week, or the day's rows and blocks. Escape puts it all down. |
| Select two blocks on one day, Ctrl+C, click another column head, Ctrl+V | Both arrive on that day at the same times on the clock, ● pending, carrying no worklog. The originals are untouched. |
| Select a block on Monday and one on Wednesday, copy, mark Tuesday, paste | They land on Tuesday and Thursday. The gap between them is kept, not collapsed. |
| Select a whole week with Ctrl+A, step forward a week, paste onto its Monday | The week is reproduced, day for day. |
| Copy a **Manual Jira entry** and paste it | It arrives as an ordinary Joggl entry, ● pending — a copy of a Jira record is Joggl's own new entry. |
| In the **day view**: select two entries, Ctrl+C, press `[` to step back a day, Ctrl+V | Both arrive on that day at the same times. Both gestures work here too — the paste target is whichever day is shown. |
| Ctrl+drag a block to another day | A copy lands there; the original stays where it was. |
| Select two entries and press Delete | It asks, naming how many are unsynced and how many are already synced, and across how many days. Cancel leaves everything. |
| Do it again with a synced entry in the selection, and choose **Remove here only** | They go from Joggl. Nothing is deleted from Jira, and the day's Jira-side rows are still there. |
| Do it again and choose **Delete in Jira too** | The worklogs go from Jira as well. Anything that fails **stays here**, carrying the error, with a summary and **Retry failed** — the time is really logged there and hiding the row would lose it. |
| Include a **Manual Jira entry** in a selection you delete | It is left alone, and a message says how many were skipped. |
| Delete the entry a timer is running on | The timer stops first, as it does for a single delete. |
```

and correct the two stale numbers in the file's header, which have been wrong since 0.17.0 — `283` tests and `85` checks in the opening paragraphs and in *Running it*, and the *Last full pass* line:

```markdown
**Last full pass: 2026-08-07, 115 checks.** Against the live Jira and against fixtures,
both **115 passed, 0 failed**. Both report the same total, which is the only thing
keeping `main/jira/fake.js` honest.
```

Replace the counts in *Running it* and in *The script* with `npm test # 371 tests` and `115 checks`. Read the numbers off the runs in step 6 rather than trusting these.

- [ ] **Step 5: Update CLAUDE.md**

Four edits.

**a.** In the *Working* table, add a row after `Week view`:

```markdown
| Selecting | Several entries at once — Ctrl+click, a rubber band, Ctrl+A — then copy, paste onto another day keeping every offset, or delete together |
```

**b.** In the same table, update the counts to what the runs report:

```markdown
| Tests | 371 passing, `npm test`; 115 UI checks, `npm run uicheck` (or `:fast`) |
```

**c.** In *Clicking*, extend the opening so it is not left saying there is one selection:

```markdown
**Selection is not focus, and it is a set.** `state.selectedEntryIds` marks entries in
*both* panels at once, which is the point: with overlap columns it is otherwise unclear
which block is which row. A plain click selects one, Ctrl+click adds or removes one, a
band on empty grid takes what it encloses, Ctrl+A takes everything on screen. Focus is
per-panel, invisible in the other one, and moves away the moment you type; the selection
stays until Escape, a click on empty space, a day change, or the entries being deleted.
```

**d.** Add a section after *The week*:

```markdown
## Selecting, copying, deleting

**Enclosure, not intersection.** A block spans the whole width of its column, so a band
drawn down a column crosses every block it passes; catching what it merely touched would
mean a short drag selected the day. The band also refuses to start on a block — a press
there is already a move gesture, and the two would fight over one mousedown — and the
click a finished band produces is suppressed, or the grid's own click would clear the
selection a frame after the band made it.

**One rule covers every paste.** The earliest day in the selection is anchored onto the
target day and every offset is kept, in days as well as on the clock. So one day's blocks
pasted onto another arrive at the same times; Tuesday and Thursday pasted onto Wednesday
arrive on Wednesday and Friday; a whole week pasted onto a Monday reproduces the week. The
target is `state.selectedDate` — there is one answer in this app to "which day is this
about". Times are rebased through `copiedToDay`, as an offset from local midnight, and the
day arithmetic is `Math.round`, never a floor: one of the days in between can be 25 hours
long.

**A copy carries no worklog.** `duplicateOf` is the one rule, whether the copy came from
Ctrl+V, Ctrl+drag, *Duplicate* or *Copy previous day* — carrying the original's id across
would make the next Sync rewrite that one worklog with the copy's times, overwriting the
original's record and never giving the copy one of its own. A copy of a Jira-side row
becomes an ordinary entry of Joggl's own.

**A failed Jira delete leaves the entry here.** The batch delete offers to remove the
worklogs too, one at a time, and an entry whose DELETE failed **stays**, carrying the
error, with a summary and **Retry failed**. It still stands for time that is really logged
in Jira, and removing the row would hide it — the exact failure the single delete's modal
exists to prevent. A Jira-side row is never deleted at all: it may be selected and copied,
but it is not Joggl's record.

**An entry action finds the day the entry is on.** `findEntry` searches every day loaded,
because a gesture in the week view is routinely about a day that is not the marked one —
and until 0.18.1 every action looked its entry up in the selected day and silently did
nothing anywhere else.
```

**e.** In *Keyboard*, add the new bindings to the table, after the `↑ ↓ Home End` row:

```markdown
| `Ctrl+click` | a row or block | Add it to the selection, or take it out |
| Drag on empty grid | either grid | A rubber band. It catches a block when the box encloses it, not when it crosses it |
| `Ctrl+A` | anywhere, not while typing | Select everything on screen |
| `Ctrl+C` `Ctrl+V` | anywhere, not while typing | Copy the selection; paste onto the marked day, keeping every offset |
| `Ctrl+drag` | a block | Copy it rather than move it |
| `Delete` | anywhere, not while typing | Delete the selection. More than one asks first |
| `←` `→` | either grid | Move between columns; `↑` `↓` move within one, in time order |
```

**f.** In *Next, roughly in order*, item 1 (Month view) gains what phase 4 leaves ready:

```markdown
1. **Month view** — the last phase of the sidebar work. A calendar grid with hours logged
   per day, and the day view beside it showing whichever day was clicked. Everything it
   needs is now in: the range data layer, the shared timeline geometry, the column map,
   the view registry with its `onDayChange` hook, and the selection model — a month is
   where "select a week and paste it onto the next one" is most useful.
```

- [ ] **Step 6: Bump the version**

```bash
npm run bump
```

Expected: `0.18.1` → `0.19.0`. A change bumps the minor; this is the one commit of the phase that carries it.

- [ ] **Step 7: Verify everything**

Run: `npm test`
Expected: PASS — 371.

Run: `npm run uicheck:fast`
Expected: PASS — 115 of 115. **Record the number it reports** and make sure `CLAUDE.md` and `test-and-issues.md` say that number and not a stale one.

Run: `npm run uicheck`
Expected: the same number, passing. This is the merge gate — the live and fixture runs reporting the same counts is the only thing keeping `main/jira/fake.js` honest. If it fails at startup with *401 from Jira — your email or API token is wrong or expired*, that is the development token, not this branch: report it and stop rather than merging on the fast run alone.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Select, copy and delete several entries at once (0.19.0)"
```

---

## Self-review notes for the controller

Read before dispatching Task 1. Four things in this plan are deliberate and will look like defects to a reviewer seeing only one task's diff.

1. **Task 1 is a bug fix with its own version bump, inside a feature plan.** It is here because nothing later can work without it — a selection spanning days cannot be deleted by actions that only ever look at one — and it is bumped separately because it corrects behaviour already shipped in 0.18.0. If the branch has to be split, task 1 is the clean cut.

2. **Task 4 changes the day view's arrow order, and the task promises no user-visible change beyond the week.** DOM order in the day view is `visibleEntriesFor`'s — local entries then Jira-side rows — so `↓` already did not mean "the next one down". Time order is what it looked like it meant all along. An existing keyboard check may name an id that changes; step 8 says to read it rather than to force it.

3. **`selectedIds()` filters on every read instead of pruning at each delete.** Six paths can remove an entry and a seventh will be added; one of them forgetting to prune would leave Ctrl+C copying a ghost. The cost is a walk over the loaded days per read, which happens on a keypress, not on a render.

4. **`plural` moves to `util.js`, and task 6 edits `copy-day.js` to say so.** That file is
   otherwise untouched by task 6, so the edit will look stray in the diff. One line
   duplicated across two modules is the moment it belongs in `util.js` with the other
   formatters, and leaving a second copy behind is the thing a reviewer would rightly
   flag.

5. **One UI check the spec asks for is deliberately not here.** The spec lists "copy a
   week, step forward, paste" among its checks. `test/paste.test.js` proves that exact
   case as arithmetic, and the manual checklist carries it; a scripted version would add
   a week's worth of seeding, two week-steps and their Jira reads — the most expensive
   shape there is in this suite — to re-prove a pure function. The two-day check that *is*
   scripted covers what only the DOM can break, which is that the day offsets survive the
   round trip through the clipboard at all.

Three things a reviewer should look for, and this plan may have got wrong:

- **Ctrl+drag drags the original's element to place a copy.** There is no second element to drag until the commit, so the original appears to move and springs back. `.copying` makes it dashed, which is the best available signal. If it reads badly in use, the fix is to clone the element into the target column at gesture start, not to re-render mid-drag.
- **The band reads every block's box on mouseup.** A week at 3× zoom with a busy fortnight is a few hundred `getBoundingClientRect` calls in one frame, once per gesture. That is almost certainly nothing; if it is not, the answer is to read the boxes once at gesture start, which is only wrong if the grid scrolls mid-band.
- **Nothing suppresses `Ctrl+A` inside the rubber band's own gesture**, or a `Delete` pressed while a drag is running. Both are reachable and both would be strange, and neither is guarded. If a reviewer flags it, the honest fix is a single "a gesture is running" flag in `shell.js` beside `setDragging`, not three separate guards.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-06-week-view-phase-4-selecting-and-copying.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration, and a whole-branch review at the end.
2. **Inline Execution** — the tasks run in this session, with checkpoints for review.
