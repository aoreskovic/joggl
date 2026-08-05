# Week view — design

**Date:** 2026-08-05
**Versions:** 0.16.0 → 0.19.0, four commits
**Status:** approved

Phase 2 of the sidebar work. The week and month tabs have been sitting disabled in the
rail since 0.11.0; this builds the first of them, and the two phases of plumbing it
needs. Month view reuses all four phases and gets its own spec.

---

## Why this is four commits and not one

Three things stand between the app and a week view, and only one of them is the view:

1. **`state.entries` is one day.** `loadDay` replaces it wholesale and clears
   `state.externalEntries` on the way past. Nothing in the renderer can hold two days
   at once, and a drag between days needs to write two day logs in one commit.
2. **The timeline is a singleton.** `const view = { rangeStartMs, pxPerMin,
   totalMinutes }` at `renderer/js/timeline.js:38` is read by every drag handler,
   `gridTimeAt`, `placeBlock`, `liveUpdate`, `updateNowMarkers` and `scrollToNow`.
   Five columns need five of something it only has one of.
3. **Jira is read a day at a time.** `day:get` and `jira:dayWorklogs` take a single
   date, and *Copy previous day* walks back through them one at a time.

Each phase is a commit with its own version bump, and the first ships something useful
on its own so the plumbing is not carried on faith.

---

## Phase 1 — Range data layer (0.16.0)

*Ships on its own: **Copy previous day** stops crawling.*

### Reading a range of days from Jira

`fetchDayWorklogs` becomes one case of `fetchRangeWorklogs(creds, { from, to,
rangeStartTs, rangeEndTs })`:

- one JQL — `worklogAuthor = currentUser() AND worklogDate >= "A" AND worklogDate <= "B"`
  — for the whole range, rather than one per day;
- one worklog `GET` per distinct issue the JQL returned, bounded server-side by
  `startedAfter` / `startedBefore` across the whole range;
- each worklog bucketed by the **local** day key of its start, so a 23:30 entry files
  under the day it began on and not under UTC's idea of it.

Day view calls it with `from === to`. One implementation, so the two views cannot come
to disagree about what a day holds.

Today's *Copy previous day* costs, per day looked back, one JQL plus one `GET` per issue
that JQL found — thirty sequential batches in the worst case. This is one JQL plus one
`GET` per distinct issue in the whole month.

### Pagination stops being optional

`/rest/api/3/issue/{key}/worklog` is the old-style `startAt` / `maxResults` / `total`
endpoint. `fetchDayWorklogs` asks for `maxResults=200` and ignores `startAt`, which is
open issue #5 in CLAUDE.md. Fine for one day; over thirty days on a shared issue that
already holds 660 worklogs on this site it silently truncates, and a truncated read
shows a day as emptier than it is. The range read follows `startAt` until
`startAt + worklogs.length >= total`, capped at 20 pages so a pathological issue cannot
hang the app.

This closes issue #5.

### Two new channels

`day:getRange` and `jira:rangeWorklogs`, added to the handler table in `main/ipc.js`,
to the preload allowlist, and to `main/jira/fake.js` with the same post-parse shapes as
the real client. `day:getRange` is bounded — 62 days — so no caller can ask for a
payload nobody wants.

### Multi-day state in the renderer

`state.entries` is read in roughly forty places across eleven modules. Rewriting all of
them for no user-visible gain is how a refactor eats a week, so the storage moves and
the name stays:

```js
state.days     = new Map();  // dateKey -> Entry[]   the real storage
state.external = new Map();  // dateKey -> Entry[]   Jira-side, session cache

// A view onto the selected day, so every existing caller keeps working and none of
// them can reach another day by accident.
Object.defineProperty(state, 'entries', {
  get: () => state.days.get(state.selectedDate) ?? [],
  set: (v) => state.days.set(state.selectedDate, v),
});
```

`state.externalEntries` gets the same treatment over `state.external`.

Alongside them: `entriesFor(key)` and `visibleEntriesFor(key)` for week view,
`loadDays(from, to)`, and `persistDay(key)` taking an explicit day — a drag across
midnight writes two logs.

`visibleEntriesFor` applies the rule `copyableEntries` already holds: a synced entry
and the Jira worklog it created are one stretch of time seen twice.

### The external cache

`state.external` is a session cache and never persisted — the existing rule that a
stale Jira row must not end up in a day log is unchanged, and a Map in memory keeps it.
Invalidated per-day when anything writes to that day, and for every day a sync touched.
`loadDays` fetches only the days not already held.

`window.__jogglTest.whenIdle()` must settle on the range fetch as well as the day
fetch, or every week-view UI check races it.

### Copy previous day on the new layer

`findLastDayWithEntries` and `test/copy-day.test.js` are **untouched**. Only what sits
behind the `readLocal` / `readJira` arguments changes: one prefetched 30-day window
instead of thirty round trips, so the loop becomes pure and returns without waiting.
The `onProgress` callback and the `Looking… 12d` button text lose their purpose and go;
the button gets a plain busy state instead.

### Tests

- `test/range-worklogs.test.js` — the range JQL as built; the pagination loop following
  `startAt` past 200 and stopping at `total`; the 20-page cap; a worklog at 23:45
  bucketed to the day it started on; a worklog outside the range dropped.
- `test/day-store.test.js` — the `state.entries` accessor round trip against
  `state.days`; `entriesFor` on an unfetched day answering `[]` and not `undefined`;
  `loadDays` filling both maps; per-day cache invalidation.
- `test/copy-day.test.js` — unchanged, and must stay passing unchanged.

---

## Phase 2 — Timeline generalisation (0.17.0)

*No user-visible change whatsoever.*

The singleton splits in two, along the line the week view actually needs:

- **`grid`** — geometry shared by everything rendered: `rangeStartMs`, `pxPerMin`,
  `totalMinutes`. One per render, week or day. Every column must share one hour range
  or the rows do not line up across the week, and the hour gutter is drawn once for all
  of them.
- **`columns`** — `dateKey → element`. A column owns nothing but its day and its box.

The shared range forces one piece of arithmetic out of the render and into the open:

```js
computeRange(entriesByDay, { today, timerStartTs }) -> { startHour, endHour }
```

Day view passes one day, week view five or seven. The rules are the ones inlined at
`timeline.js:93-106` today: 07–20 at minimum, widened to cover everything logged, and
widened to the current hour when today is among the days shown.

`gridTimeAt(x, y)` becomes `columnAt(x, y) -> { dateKey, ts } | null`. The drag handlers
stop asking *what time* and start asking *which day, and what time* — which is
cross-day drag, and is why this phase exists. With one column it degenerates to exactly
today's behaviour. The full-rect bound stays: `gridTimeAt` returns null outside the
grid horizontally as well as vertically, and the reason (a press on a task row, a few
pixels sideways, booking a phantom entry) has not gone away.

The drag, resize and move handlers move to `renderer/js/timeline-drag.js` and take a
column resolver rather than reading a module-level object. `computeColumns`, the
overlap solver, is already pure and per-day and is not touched — it is called once per
day column.

`timeline.js` keeps its exact public surface — `renderTimeline`, `onGridClick`,
`showDropPlaceholder`, `hideDropPlaceholder`, `hideQuickEntry`, `updateNowMarkers`,
`scrollToNow`, `computeColumns`, `gridTimeAt` — so `app.js`, `drag-drop.js`,
`render.js` and `selection.js` do not change in this phase.

### Acceptance

**All 251 unit tests and all 82 UI checks pass, unchanged.** No new UI checks. The drag
and snap edge cases here were settled by use rather than by design, and that suite is
the only thing that will notice if one is lost.

### Tests

`test/timeline-geometry.test.js` — `computeRange` with no entries falling back to
07–20; a 06:30 block on one day of a week widening *every* column; a 21:00 block
widening the bottom; today's current hour widening the range only when today is among
the days passed; a running timer counted.

---

## Phase 3 — Week view (0.18.0)

### Layout

The omnibar and the pin chips become a strip across the top; the week grid fills
everything below it. The issue list and the **On this day** panel do not appear in this
view.

```
┌──┬────────────────────────────────────────────────────────────────┐
│  │ [ Search an issue… ]  (GEN-12 Meetings) (EHW-70 Platform) (+)   │
│ D├────────────────────────────────────────────────────────────────┤
│ W│ ‹ 27 Jul – 2 Aug · week 31 ›        [5|7]  Sync week · 12, 34h  │
│ M│      Mon 27   Tue 28   Wed 29   Thu 30   Fri 31                 │
│  │      7h 30m   8h 00m   6h 45m   8h 00m   4h 00m                 │
│  │ 08 │        │        │        │        │        │               │
│  │ 09 │████████│  ████  │███│████│████████│        │               │
│  │ 10 │        │╌╌╌╌╌╌╌╌│███│████│████████│████████│               │
└──┴────────────────────────────────────────────────────────────────┘
```

A day column at a 1400 px window is roughly 186 px wide in 7-day mode — enough that two
overlapping blocks still get 90 px each and show a key plus a word of title. Keeping
the current left panel would have made it 146 px, and 70 px per block when two overlap,
which is a key and an ellipsis. The view exists for busy weeks, so it must not read
worst on them.

**Getting an issue onto a day**, now that the issue list is not on screen:

- drag a pin chip down onto a column;
- type in the omnibar and drag a result row down — the omnibar's result rows become
  draggable, which is the one thing it gains;
- click an empty hour, which opens the quick-entry popup that already searches Jira.

The omnibar otherwise keeps its current meaning exactly. `Enter` and `Ctrl+Enter` start
a timer; the timer only ever runs on today, so it starts on today's column.

### The header

`‹  27 Jul – 2 Aug  ·  week 31  ›`, a `5 | 7` toggle, the week's total, and the Sync
button.

**Weeks start on Monday**, everywhere, as `WEEKDAY_INITIALS` and `monthGrid` already
assume.

### Week numbering — ISO 8601

**Week 1 of a year is the week containing the first Thursday of January** — equivalently,
the week containing 4 January, equivalently the first week with most of its days in the
new year. Weeks run Monday to Sunday and a year has 52 or 53 of them. This is ISO 8601,
which is what every colleague's calendar, every Jira report and every other tool will
say, so Joggl agreeing with them is worth more than any rule of our own.

Two consequences that will look like bugs to anyone who has not read this:

- **A week has an ISO week-year, and it is not always the calendar year.** All seven days
  of a week share one, so late December can fall in week 1 of the following year, and
  early January in week 52 or 53 of the previous one.
- **1 January is not always in week 1.** When it falls on a Friday, Saturday or Sunday it
  belongs to the last week of the outgoing year.

| Week | ISO |
|---|---|
| Mon 29 Dec 2025 – Sun 4 Jan 2026 | week 1 of **2026** |
| Mon 27 Jul 2026 – Sun 2 Aug 2026 | week 31 of 2026 |
| Mon 28 Dec 2026 – Sun 3 Jan 2027 | week 53 of **2026** |
| Mon 4 Jan 2027 – Sun 10 Jan 2027 | week 1 of 2027 |

2026 has 53 weeks because it starts on a Thursday; 2027 begins on a Friday, so its first
three days belong to 2026's last week.

`isoWeek(key) -> { week, weekYear }` is written here rather than pulled in — the
short-dependency rule in CLAUDE.md, and it is about a dozen lines — and tested against
the table above.

A week whose ISO week-year differs from the calendar year of its Monday is labelled with
the year, `week 1 of 2026` for the first row, and plain `week 31` otherwise: saying the
year on every one of the other fifty-one would be noise.

An earlier draft of this design numbered weeks within their month. That is dropped: two
adjacent weeks could both call themselves "week 1", which is exactly the confusion the
label exists to remove.

### Columns

Weekday name, date, and that day's total in each header. Today's column is marked.

**Mon–Fri by default**, remembered in UI prefs like the sidebar's collapse state. The
`5 | 7` toggle switches to Mon–Sun.

**A weekend day holding any time — local or Jira-side — is shown even in 5-day mode.**
Time that cannot be seen is time that does not get synced, and hiding it is the one
thing this view must never do. So 5-day mode means "hide Saturday and Sunday when they
are empty", and a week with Saturday worked renders six columns.

Everything the day view can do, every column does, because they are the same code after
phase 2: click an empty hour for the quick-entry popup, drag and resize blocks,
right-click for the context menu, double-click for the work description, single-click
to select. Jira-side rows still draw dashed and unfilled in cyan, are still labelled
**Manual Jira entry**, still take part in overlap detection, and still refuse to be
moved.

Each column header carries a menu holding **Copy previous day** and **Clear day** for
that column, plus **Clear week**. That is where the two buttons in the *On this day*
header go in this view; the day view keeps its own.

### Dragging between days

A block dragged from one column to another moves to that day: it leaves one day log and
joins another, in one commit.

A **synced** entry may cross days. Its `worklogId` stays valid because the issue has not
changed — only when the work started — so it returns to `pending` and the next Sync
rewrites the worklog with `PUT`, exactly as a move within a day does now. This is not
the case retargeting refuses; that one changes the issue, and a worklog id is only valid
on the issue it was created against.

An **external** entry refuses, with the message it already gives.

The existing rules survive the crossing unchanged: `sameTimes` still decides whether a
gesture counts as an edit, so a drag that ends in the column it started in and at the
time it started at does not flip a synced entry to pending; the quarter-hour snap is
still measured from the **target** day's local midnight, which matters when the two days
sit on opposite sides of a clock change.

### The timer

Runs only on today, as now. Its live block grows in today's column and takes part in
that column's overlap layout. Starting a timer while a past week is on screen moves the
view to this week, so the block that just started is visible.

### Sync

One button in the week header: `Sync week · 12 entries, 34h 15m`, and `Nothing to sync`,
disabled, when there is neither a worklog to write nor an entry to mark. The counting
rules are `syncLabel`'s, unchanged — only what reaches Jira is counted, entries with no
issue key get their own phrasing, and the tooltip says what is a rewrite rather than a
fresh log and that the running timer is excluded.

It runs the existing per-day sync sequentially over the visible days, so nothing about
the partial-failure bookkeeping changes: successes keep `synced` and their `worklogId`,
failures get `error` and a message, no automatic retry, one summary at the end with
**Retry failed**.

### Empty states

An empty week names the gesture, the same rule the empty day already follows, and keys
off what is rendered rather than what the store holds — a week showing only read-only
Jira rows is not empty.

### Tests

- `test/week-number.test.js` — the boundary table above; 1 January falling on each of the
  seven weekdays, so the three where it lands in the outgoing year's last week are all
  covered; 2026 having 53 weeks and 2027 having 52; the label carrying the year only when
  the ISO week-year differs from the calendar year of the Monday.
- `test/week-range.test.js` — the Monday and Sunday for a given day; which columns 5-day
  mode shows, including the auto-revealed weekend; stepping forward and back across a
  year boundary.
- `test/cross-day-move.test.js` — an entry moving between day logs leaves one and joins
  the other; a synced entry keeps its `worklogId` and returns to `pending`; an external
  entry refuses; the snap measured from the target day's midnight across a clock change.
- UI checks, in `scripts/ui-check.mjs` and `test-and-issues.md`: the week tab enabling
  and mounting; the 5 | 7 toggle and its persistence; a weekend day with time showing in
  5-day mode; the stepper and its label; a block dragged from one column to another
  landing where the preview said; the quick-entry popup on a non-today column; the week
  Sync button's label and its disabled state; the empty-week hint.

---

## Phase 4 — Selecting and copying (0.19.0)

### Selecting

`state.selectedEntryId` becomes `state.selectedEntryIds`, a Set. The existing promise
holds: selection is not focus, it marks entries in every panel at once, and it survives
until Escape, a click on empty space, or the entries being deleted. Selecting must
still not re-render — `selection.js` puts the class straight onto the elements, and
`applySelection()` runs at the end of every render because the ids in state are the
truth and the classes are their shadow.

- **Click** — select one, replacing the selection.
- **Ctrl+click** — add or remove one.
- **Drag on empty space** — a rubber-band rectangle. A block is selected when it is
  **fully enclosed** by the rectangle, not merely touched. Enclosure is the rule
  because a rectangle drawn across a column of full-width blocks would otherwise sweep
  up every one it crossed.
- **Ctrl+A** — the whole visible week (or day).
- **Escape** — put it all down.

The rubber-band must not start on a block: a press on a block is already a move
gesture, and the two would fight. It starts on empty grid only.

### Copying

`Ctrl+C` copies the selection. `Ctrl+V` pastes onto the day last clicked.

**One rule covers every case.** The earliest day in the selection is anchored onto the
target day, and every offset is preserved — both the offset in days and the time on the
clock. So:

- one day's blocks pasted onto another day arrive at the same times;
- Tuesday and Thursday pasted onto Wednesday arrive on Wednesday and Friday;
- the whole week selected with Ctrl+A, stepped forward, pasted onto Monday, reproduces
  the week.

`Ctrl+drag` copies rather than moves, for when the target is already on screen.

Copies arrive **unsynced and carrying no `worklogId`**, exactly as *Copy previous day*
already produces them — `duplicateOf` is the one rule, so the next Sync logs them as new
worklogs rather than rewriting the originals, and a copy of a Jira-side row becomes an
ordinary entry of Joggl's own. Times are rebased with `copiedToDay`'s reasoning: as an
offset from local midnight, never as a fixed number of milliseconds, so a copy across a
clock change does not quietly claim the work happened an hour earlier.

Both gestures work in day view too — copy here, change day, paste.

### Deleting

`Delete` removes the selection. With more than one block selected it asks first. It is
local only and never issues a `DELETE` to Jira, the same promise *Clear day* makes; the
single-entry delete keeps its existing offer to remove the Jira worklog too.

### Keyboard

| Key | What |
|---|---|
| `←` `→` | Move between columns |
| `↑` `↓` | Move within a column |
| `Ctrl+click` | Add or remove one block from the selection |
| `Ctrl+A` | Select the visible week |
| `Ctrl+C` `Ctrl+V` | Copy the selection, paste onto the last-clicked day |
| `Delete` | Delete the selection |
| `PageUp` `PageDown` | A week back or forward, as now |
| `[` `]` | A day back or forward, as now |

Every one of these gets a row in `SHORTCUTS` in `renderer/js/help.js`, and the UI check
that counts those rows is updated. Bare-key shortcuts stay suppressed while a modal is
open and while the caret is in a field.

### Tests

- `test/selection.test.js` — the Set replacing the scalar; click, Ctrl+click, Ctrl+A,
  Escape; an entry being deleted leaving the selection.
- `test/rubber-band.test.js` — enclosure and not intersection, against a fixed set of
  boxes; a rectangle drawn in either direction; a band starting on a block not starting
  at all.
- `test/paste.test.js` — the anchor rule for one day, two non-adjacent days, and a whole
  week; copies carrying no `worklogId` and arriving `pending`; a keyless entry arriving
  `local`; a paste across a clock change keeping its clock times.
- UI checks: rubber-band selecting three blocks and not a fourth it merely crosses;
  copy and paste onto another day within the week; copy a week, step forward, paste;
  Ctrl+drag copying; Delete asking before removing more than one.

---

## What is not in this spec

- **Month view.** It reuses all four phases — the range data layer, the generalised
  timeline, the week-column rendering, and the selection model. Its own spec, once this
  is in use.
- **Tray icon states, a global start/stop shortcut, macOS builds, auto-update.**
  Unrelated items on the CLAUDE.md list.
- **A per-day working-week setting.** The `5 | 7` toggle and the weekend tint are both
  hardcoded to Saturday and Sunday. Anyone whose week runs otherwise switches the tint
  off and uses 7-day mode. A configurable working week is the next step if that is not
  enough, and it is not this spec.
- Everything under *Out of scope* in CLAUDE.md.

---

## Documentation obligations, per commit

Each of the four commits:

1. bumps the minor version — `npm run bump`;
2. records what it built in `CLAUDE.md`, moving the relevant line out of *Next, roughly
   in order* and updating the *Working* table and test counts;
3. adds its manual-checklist rows to `test-and-issues.md`, and records any bug found on
   the way under *Open issues*;
4. leaves `npm test` and `npm run uicheck` both green, with the live and fast runs
   reporting the same counts — the only thing keeping `main/jira/fake.js` honest.

Phase 1 additionally closes open issue #5 (worklog pagination) in CLAUDE.md. Phase 3
enables the week tab in the sidebar, so the *Sidebar* rows in `test-and-issues.md` that
assert both tabs are dimmed and say "Not built yet" are rewritten rather than removed.
