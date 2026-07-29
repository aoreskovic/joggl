# Testing and known issues

What to test by hand, how to test it, and what is known to be broken.

Joggl has 131 unit tests (`npm test`) covering the things where a silent failure loses
time data: the worklog timestamp formatter, merge decisions at the 30-minute boundary,
Finish Day's partial-failure transitions, the day-log round trip, quarter-hour snapping,
what a duplicate and a moved entry inherit, and the search box's remote-lookup loop.
Everything else — the whole UI — is verified against the checklist below, because the
project deliberately has no DOM test harness and adding one would break the
short-dependency rule in `CLAUDE.md`.

That makes this file the other half of the test suite. Keep it current.

**Last full pass: 2026-07-29, all 27 checklist items green**, driven by dispatching real
mouse events into the renderer from the main process against a throwaway
`--user-data-dir`. See *Automating the manual half* at the end for what that took and
what it did not cover.

---

## Running it

```
npm start      # the app
npm test       # 131 tests, must be 0 failures
npm run uicheck # the checklist below, driven as a script — 27 checks, must be 0 failures
```

The log is at `logs/joggl.log`, credential-redacted. Send it along with any bug report.

---

## Manual test checklist

Grouped by area. Each item says what to do and what correct looks like.

### Sidebar

| Do this | Correct result |
|---|---|
| Look at the sidebar | Joggl, three tabs, Settings at the bottom. Day View highlighted with a left accent bar. |
| Click Week View or Month View | Nothing happens. Both are dimmed and say "Not built yet" on hover. |
| Click Settings | The settings overlay opens. Close still closes it. There is no ⚙ button in the day header any more. |
| Click the toggle | The rail collapses to icons and the chevron flips. Click again to expand. |
| Collapse, quit the app entirely, start it again | It comes back collapsed. Expand, quit, restart — comes back expanded. |
| Collapse, then rest the mouse on the rail | After a beat it floats open **over** the content. The content underneath must not move. |
| Sweep the mouse quickly across the rail on the way to the entry list | The peek does not open. |

### The day view's own click

| Do this | Correct result |
|---|---|
| Scroll the timeline, then click an empty hour | A quick-entry popup opens **visibly**, focused, titled with that hour and the half hour after it, and sitting fully inside the window. |
| Type in it, then press Escape | It closes and nothing is created. |
| Click an empty hour, then click elsewhere | It closes. A second click on the grid opens it again — a popup that closed itself must not eat the next click. |

### Dragging onto the day view

Three sources, one gesture. Task rows and pins create a half-hour block; a row in the
day's own entry list moves the block it already stands for.

| Do this | Correct result |
|---|---|
| Click a task in the Issues list | The timer starts. No entry appears on the timeline. |
| Make three or four deliberately sloppy clicks on task rows | Every one starts a timer. **None** creates an entry. |
| Press a task row, move only sideways, release over the entry list or the omnibar | Nothing is created, no toast. |
| Press a task, drag onto the timeline | A ghost with the key and title follows the cursor; a dashed preview snaps to quarter hours showing `HH:MM – HH:MM`. |
| Release on the timeline | A 30-minute pending entry appears there, in both the timeline and the entry list. |
| Repeat the drop at 0.5×, 1×, 2× and 3× zoom, with the timeline scrolled | The entry lands on the quarter hour the preview showed. This is where a bug once put a click at 16:00 near 21:00. |
| Drag and hold the cursor near the top edge of the timeline, then the bottom | It auto-scrolls and the preview keeps up. |
| Drag and press Escape mid-drag | Ghost and preview vanish, nothing is created. |
| Drop the same issue twice an hour apart on an issue that already has an entry today | Two separate entries, each where it was dropped. No merge prompt. |
| Drop an issue on top of an existing entry | Both flagged as overlapping, timeline splits them into side-by-side columns. |
| Drag an issue slowly across the collapsed sidebar | The peek does not open. |
| Step back a day with `‹` and drop a task | It lands, and it is still there after quitting and restarting. |
| Drag a **pin** onto the timeline | Same as a task row: a 30-minute pending entry. A plain click on the pin still starts a timer. |
| Drag a row from the day's **entry list** onto a different hour | The entry **moves** there and keeps its length. No second entry appears — that is what Duplicate is for. |
| Drag a synced entry's row to a new hour | It moves and returns to `pending`, so Finish Day rewrites its worklog rather than posting a second one. |
| Try to drag a **Manual Jira entry** row | Nothing moves. The row is not Joggl's to change. |
| Press on an entry row's time field and drag | The field takes the press; no drag starts. |

### Time safety — the things that cost real money if wrong

These are the ones worth being slow and careful about. Everything here ends in a worklog
on Jira.

| Do this | Correct result |
|---|---|
| Drop a block two hours in the future, then click the same issue to start a timer, then stop after a minute | **Two entries.** The timed one, and the booked-ahead block untouched. If you get one entry spanning from now to the end of the future block, stop and do not press Finish Day on that day. |
| Same, but after starting the timer, correct its start time forward in the omnibar, then stop | Still two entries. The booked-ahead block is never absorbed, whatever the start is edited to. |
| Start a timer on an issue that has a *past* entry from under 30 minutes ago | Silently merges into one block. This is deliberate. |
| Same, but with a gap over 30 minutes | Asks: Merge into one / Keep separate. |
| Drop a block in the future, then edit its start time on the entry card | It lets you. A future start is allowed on a hand-drawn entry — that is how leave and out-of-office get booked. |
| Set a **running timer's** start to a future time in the omnibar | Refused with a warning. A running timer with a future start measures negative time. |
| Drop a block in the future, press Finish Day | It syncs and comes back as a real Jira worklog. |
| Log time in the Jira web UI for today, then refresh in Joggl | It appears dashed in cyan, labelled "Manual Jira entry", read-only, and counted in the day total. |
| Edit an already-synced entry, press Finish Day | The existing worklog is rewritten. A second worklog must **not** appear on the issue. |

### Persistence

| Do this | Correct result |
|---|---|
| Create entries, quit, restart | All still there, on the right days. |
| Drop on a past day, restart | Still on that past day, not moved to today. |
| Start a timer, quit while it runs, restart | The timer is still running with its original start. |

---

## Open issues

### Confirmed bugs

None open right now.

Fixed on 2026-07-29, in the order found:

- The quick-entry popup positioned itself against an empty result list, and auto-scroll's
  edge test was unreachable from outside the panel. See git history for
  `renderer/js/timeline.js` and `renderer/js/drag-drop.js` (then `drag-issue.js`).
- **Clicking the day view did nothing at all.** The popup renders its results and *then*
  reveals itself, and the render threw, so it never got past `visibility: hidden`. What
  threw was unbounded recursion: the remote lookup reported "no results" synchronously
  when there was nothing to look up, and callers re-rendered from that callback. Fixed by
  making a render never start a lookup, and the lookup never call back synchronously —
  `renderer/js/remote-lookup.js`, with the loop covered by tests.
- The Stop button dropped `btn-primary` instead of adding `btn-stop` to it, so it lost its
  radius, padding and weight the moment a timer started.

### Known, deliberately not fixed

Nothing. The cosmetic leftovers listed here previously — dead `.icon-square` CSS, the
renderer's duplicate UI defaults drifting from the main-process ones, `<nav id="sidebar">`
without an `aria-label`, and the `#view-day` block left at its old indentation — were all
cleared on 2026-07-29.

---

## The script

Every table above except the persistence rows is executed by `scripts/ui-check.mjs`:

```
npm run uicheck
```

27 checks, exits non-zero on failure. It needs **no dependency and no DevTools Protocol** —
the main process already holds `webContents.executeJavaScript`, which is enough to
dispatch real `MouseEvent`s, read computed styles and element boxes, and drive the app end
to end. `main/index.js` loads it only under `--uicheck`, which also redirects `userData` to
a temp directory, so a run cannot touch a real day log and can run while the app is open.

The traps that make checks pass or fail for the wrong reason are documented at the top of
the script and in `CLAUDE.md`. The short version: back-date a timer's start or it is
discarded before it counts; scope entry counts to `.entry-card:not(.external)`; expect
externals in the overlap layout; and assert a drop landed where the preview said rather
than at a hard-coded hour.

**Add a check whenever a UI bug is fixed.** That is the whole point — of the three bugs
found on 2026-07-29, two were "does this element's box fit in the window" and "did the
panel's scrollTop change", which no amount of reading catches and this catches in seconds.

### Still manual

| Why | What |
|---|---|
| Crosses a process restart | the three Persistence rows |
| Writes to Jira | Finish Day on a future block; rewriting a synced entry's worklog |

Never run Finish Day against a live site from a script.
