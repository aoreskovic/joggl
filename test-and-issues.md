# Testing and known issues

What to test by hand, how to test it, and what is known to be broken.

Joggl has 117 unit tests (`npm test`) covering the things where a silent failure loses
time data: the worklog timestamp formatter, merge decisions at the 30-minute boundary,
Finish Day's partial-failure transitions, and the day-log round trip. Everything else —
the whole UI — is verified by hand, because the project deliberately has no DOM test
harness and adding one would break the short-dependency rule in `CLAUDE.md`.

That makes this file the other half of the test suite. Keep it current.

---

## Running it

```
npm start      # the app
npm test       # 117 tests, must be 0 failures
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

### Dragging an issue onto the day view

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

None open right now. The two found in the 2026-07-29 review — the quick-entry popup
positioning itself against an empty result list, and auto-scroll's edge test being
unreachable from outside the panel — are fixed; see git history for `renderer/js/timeline.js`
and `renderer/js/drag-issue.js` around that date.

### Known, deliberately not fixed

**1. Cosmetic leftovers.** Dead `.icon-square` CSS, about twenty lines describing no
element. `renderer/js/state.js:28`'s inline UI defaults do not list `sidebarCollapsed` or
`activeView`, so the two default sets read as out of sync even though only the main-process
one is ever used. `<nav id="sidebar">` has no `aria-label`. The `#view-day` block in
`renderer/index.html` was left at its old indentation when the wrapper was added around it.

---

## Automating the manual half

Everything above the "Open issues" line is done by hand today. Both confirmed bugs fixed on
2026-07-29 illustrate why that is thin cover: a full review pass caught the reasoning behind
each but neither was provably fixed without opening the window, since no reviewer could.

Electron can be driven without adding a single dependency. Launching it with
`--remote-debugging-port` exposes the Chrome DevTools Protocol on the renderer, and a plain
Node script can then dispatch real mouse events, read the DOM, and take screenshots over a
WebSocket. `Input.dispatchMouseEvent` is enough to press a task row, move in steps, and
release on the grid — which is exactly the gesture that is hardest to check by hand and
easiest to get wrong.

That would turn most of the drag-and-drop and sidebar tables above into a script, and both
of the bugs just fixed are the kind it would have caught before a human had to: one is "does
this element's box fit inside the window", the other is "does the panel's scrollTop change".
Neither needs a framework.

Worth doing before the week and month views, which multiply the surface this file has to
cover by seven and then by thirty.
