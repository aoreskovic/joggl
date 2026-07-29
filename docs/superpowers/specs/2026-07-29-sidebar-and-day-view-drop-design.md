# Sidebar shell and drag-to-day-view — design

Date: 2026-07-29
Status: approved, ready for an implementation plan
Scope: phase 1 of three

## Why

Joggl has one screen. Adding a week view and a month view means the app needs
navigation, and navigation needs somewhere to live. This phase builds that place —
a collapsible sidebar — and moves the settings button into it. It also adds the one
day-view feature that does not depend on any of it: dragging an issue out of the task
list onto the timeline to book a block of time without running a timer.

The week and month views are phases 2 and 3, each with its own spec. They are
sketched at the end of this document so the sidebar is built for the navigation it
will actually carry, but nothing about them is designed here.

## Roadmap

| Phase | Delivers |
|---|---|
| 1 (this spec) | Sidebar shell, settings moved into it, drag an issue onto the day view |
| 2 | Week view: day columns, work-week / 7-day toggle, week stepper, drag between days |
| 3 | Month view: calendar grid with hours logged per day, day view beside it |

The timeline refactor that phases 2 and 3 need — the module-level `view` singleton in
`timeline.js` currently ties the renderer and every drag handler to one column for
`state.selectedDate` — is **deliberately not** in phase 1. Parameterising it without a
consumer means guessing the abstraction while touching the one part of the codebase
`CLAUDE.md` says was settled by use rather than design, for no benefit in this phase.
Phase 2 does that refactor with week view as its real consumer.

---

## Part 1 — Sidebar shell

### Layout

`renderer/index.html` gains a `<div class="shell">` wrapper with two children: a
`<nav id="sidebar">` and the existing `.app-layout`, which becomes the view host. The
inside of `.app-layout` is untouched except that `#settings-btn` leaves
`.day-header-right`.

The Day View tab keeps today's layout exactly: omnibar, day header, pins bar, entry
list and task list on the left; the timeline as a resizable right panel. The sidebar
only takes width from the left. Week and month views will define their own wider
layouts in their own phases.

```
collapsed                        expanded
┌──┬───────────────────────┐     ┌──────────┬─────────────────┐
│» │                       │     │ « Joggl  │                 │
│▣ │  omnibar / timer      │     │ ▣ Day    │ omnibar / timer │
│▦ │  entry cards          │     │ ▦ Week   │ entry cards     │
│▤ │  Issues ──▶ drop      │     │ ▤ Month  │ Issues ──▶ drop │
│⚙ │                       │     │ ⚙ Settings                │
└──┴───────────────────────┘     └──────────┴─────────────────┘
```

### Contents, top to bottom

| Region | Contents |
|---|---|
| Brand row | "Joggl" plus the collapse toggle (`«` / `»`). The word is hidden when collapsed. |
| Tabs | Day View, Week View, Month View |
| Spacer | |
| Bottom | Settings, opening the existing `#settings-overlay` |

Tabs are real `<button>` elements so Tab and Enter work. The active tab carries
`aria-current="page"` and a left accent bar; clicking it again does nothing. Week and
Month are `disabled` with `aria-disabled="true"` and `title="Not built yet"`; disabled
tabs never route.

Icons go in `renderer/js/icons.js` as inline SVG alongside `PLAY_ICON` and
`STOP_ICON`. The renderer's CSP is `default-src 'none'`, so inline SVG is the only
option, and it is what that module already does so glyphs follow `currentColor`.

### Collapse and peek

Expanded width 168 px, collapsed 44 px, with a width transition. The toggle writes
`state.ui.sidebarCollapsed`; the active tab is `state.ui.activeView`. Both are new
keys in the `ui` prefs and need no main-process change — `saveUiPrefs` in
`main/settings.js` merges the patch without a whitelist.

While collapsed, hovering the rail for 180 ms adds a `peek` class that floats the
sidebar over the content at full width with a shadow. Content does not reflow.
Leaving removes it. Peek never takes focus, and it is suppressed outright while a
drag is in progress, so it cannot open under the cursor and swallow the drop target.

### New module

`renderer/js/shell.js` owns the sidebar and is the only module that knows about it:

```js
registerView(id, { mount(), unmount() });
setActiveView(id);
setDragging(bool);   // suppresses hover peek
```

The day view registers a `mount`/`unmount` pair that only clears and sets `hidden` on
the existing DOM, so no working day-view code moves. Week and month register in their
own phases.

### Unchanged

The tray, the global shortcut, the right panel's `panelWidth` resize, and every
renderer already in the `render.js` registry.

---

## Part 2 — Drag an issue onto the day view

A new module, `renderer/js/drag-issue.js`, owns the whole gesture.

### The gesture

A single delegated `mousedown` on `#task-list` starts it — not one listener per row,
because `renderTaskList` replaces all its children on every `renderAll`. Movement
under 4 px does nothing and the `mouseup` falls through to the existing row `click`
handler, so single-click-to-start-a-timer is unchanged. Past 4 px the drag begins and
a one-shot capture `click` listener swallows the click that would otherwise start a
timer.

During the drag: a `div.drag-ghost` on `<body>` follows the cursor showing the issue
key and title; `shell.setDragging(true)` suppresses hover peek; over the grid a
`div.sched-drop-preview` shows a dashed full-width outline labelled `09:00 – 09:30`
that steps by quarter hours. Escape cancels. A `mouseup` that is not over a point the
grid can resolve to a time — outside the grid, or above its first hour — cancels
silently, with no toast.

### What a drop creates

An entry of the same shape the quick-entry popup commits, 30 minutes long, starting at
the dropped quarter hour:

```jsonc
{
  "id": "<uuid>",
  "issueKey": "PROJ-123",
  "issueId": "10042",
  "title": "<issue summary>",
  "startTs": "<snapped>",
  "endTs": "<startTs + 30 min>",
  "status": "pending",
  "worklogId": null,
  "errorMsg": null
}
```

Issues in the task list always have a key, so the status is always `pending`. The drop
is followed by `persistDayNow()` and `renderAll()`.

Adjust the length afterwards with the existing resize handles or the inline duration
field. There is no drag-to-size in this gesture and no configurable default length.

### Rules

**Snapping** uses `snapToQuarter(t, state.selectedDate)`, so the resulting wall-clock
time is snapped as measured from local midnight, per deviation 5 in `CLAUDE.md`.

**Midnight** clamps: if `startTs + 30 min` would cross local midnight, the start is
pulled back so the block ends at midnight. This is the clamp the move drag already
applies.

**Overlaps** are allowed and only flagged visually, per the validation rules. Dropping
onto an occupied slot is fine.

**No merging.** A drop on an issue that already has entries today creates a separate
entry exactly where it was dropped. The 30-minute merge rule is timer behaviour: a
drop names a position in the day, and moving the block away from that position to fold
it into another would contradict the gesture. Merge two blocks by extending one with
its resize handle.

**Past days work.** The timer is restricted to today, but entries are not —
`onGridClick` already creates entries on whatever day is selected, and the drop
follows.

**Future starts are allowed.** Booking time you know is coming — annual leave, out of
office, a scheduled meeting — is a real use, so a drop at 18:00 while it is 14:00
creates the entry. Finish Day submits it like any other pending entry, which is the
point: the leave gets booked. The day total includes it.

This narrows a documented rule, so `CLAUDE.md` is amended in this phase: under
*Validation*, "Start time may not be in the future" becomes "A **running timer's**
start may not be in the future" — the constraint stays on the omnibar start-time
field, where a future start would make the timer measure negative elapsed time.
Manually created entries, from a drop or from quick entry, may be in the future. The
existing quick-entry popup therefore needs no change; it already permits this.

### Auto-scroll

The grid is often taller than the panel, so an hour scrolled out of view is
unreachable from the task list at the bottom left. While a drag is running, a cursor
within 24 px of the top or bottom edge of `#right-panel` scrolls it by 8 px per
animation frame, and the drop preview keeps tracking the cursor as it does.

### One cleanup

`gridTimeAt(clientY)` is extracted from `onGridClick`, which currently inlines the
arithmetic converting a cursor position into a timestamp, and `onGridClick` is changed
to call it. That calculation is where the bug lived that made a click at 16:00 land
around 21:00 — its comment in `timeline.js` records it — and it must not exist in two
copies. Alongside it, `showDropPlaceholder` and `hideDropPlaceholder`. These three
exports are the only change to `timeline.js`; the existing render and drag paths are
not touched.

---

## Testing

`dropEntryFor(issue, startTs, dayStartTs, durationMs)` is a pure function in
`renderer/js/entry-ops.js`, which already has a test file. Cases:

1. A dropped issue yields a `pending` entry of exactly 30 minutes at the given start
2. A drop near midnight is pulled back so the block ends at midnight, keeping its
   30-minute length
3. A start later than the current time still produces an entry — nothing is rejected

The function requires an issue key, because everything in the task list has one; there
is no keyless path into it and therefore no `local` case to test. Snapping the start is
the caller's job and is already covered by `test/snap.test.js`.

`gridTimeAt` is DOM-bound and gets no unit test; extracting it removes the duplicate
of a calculation that has already caused one bug, which is the point of the change.

### Manual verification in the running app

Some of this cannot be covered by a test and a silent failure here costs time data:

- collapse state survives quitting and restarting
- peek does not open while dragging an issue across the sidebar
- a single click on a task still starts a timer and creates no entry
- a drop lands on the hour aimed at, checked **at every zoom level** and with the grid
  scrolled — this is exactly where the 16:00-landing-at-21:00 bug lived
- a drop on a past day persists and is still there after a restart
- a drop over an existing entry is flagged as overlapping and the overlap columns
  still lay out correctly
- a future-dated entry syncs on Finish Day and comes back as a real Jira worklog

## Out of scope for this phase

No new Jira calls of any kind. Nothing changes in how worklogs are submitted, how
Finish Day behaves, or how a day is written to disk — so the sync path cannot regress.
No dragging between days. No week or month view. No drag-to-size, no configurable
default entry length, no dragging from the pins bar.

---

## Appendix — phases 2 and 3, as agreed

Recorded so the sidebar is built for the right navigation. Neither is designed here;
each gets its own spec.

**Week view.** Days as columns, same functionality as the day view within each column,
plus dragging entries between days. A work-week / 7-day toggle, defaulting to Monday
to Friday. A stepper for moving between weeks that also states which week of the month
is shown.

**Month view.** The same work-week / 7-day choice. A calendar grid in the style of
Google Calendar, with hours logged shown on each day. A day view to the right, showing
whichever day was clicked.

Both need the multi-day state and the generalised timeline column that phase 1
deliberately leaves alone.
