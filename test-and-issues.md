# Testing and known issues

What to test by hand, how to test it, and what is known to be broken.

Joggl has 209 unit tests (`npm test`) covering the things where a silent failure loses
time data: the worklog timestamp formatter, merge decisions at the 30-minute boundary,
Finish Day's partial-failure transitions, the day-log round trip, quarter-hour snapping,
what a duplicate, a moved and a repointed entry inherit,
when a touch counts as an edit, weekend detection, pin labelling, the ADF a worklog
comment becomes and back again, the search box's remote-lookup loop, arrow-key
navigation over a list of results, the calendar grid behind "Jump to a date", and which
editor a double click opens.
Everything else — the whole UI — is verified against the checklist below, because the
project deliberately has no DOM test harness and adding one would break the
short-dependency rule in `CLAUDE.md`.

That makes this file the other half of the test suite. Keep it current.

**Last full pass: 2026-07-30, all 70 checklist items green**, driven by dispatching real
mouse events into the renderer from the main process against a throwaway
`--user-data-dir`. See *The script* at the end for how, and for what it does not cover.

---

## Running it

```
npm start      # the app
npm test       # 177 tests, must be 0 failures
npm run uicheck # the checklist below, driven as a script — 46 checks, must be 0 failures
```

The log is at `logs/joggl.log`, credential-redacted. Send it along with any bug report.

---

## Manual test checklist

Grouped by area. Each item says what to do and what correct looks like.

### Starting it on a bare machine

Not scripted — it needs a machine without Node, or at least a shell without it on PATH.

| Do this | Correct result |
|---|---|
| On a machine with no Node, double-click `run.cmd` | It says it is fetching a portable Node, verifies the checksum, installs dependencies, and starts the app. No administrator prompt. |
| Check what it touched | Only `.node\` and `node_modules\` inside the project. Nothing in Program Files, nothing on the system PATH. |
| Delete `.node\` and run again | It fetches Node again and works. |
| Run it on a machine that already has Node 20+ | No download; it goes straight to starting the app. |
| Run it with Node 18 on PATH | It says the version is too old and fetches the portable one rather than failing. |
| Break the network mid-download | It stops with a plain message and leaves no half-extracted `.node\`. |

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

### On this day

| Do this | Correct result |
|---|---|
| Look above the Issues list | A panel headed **On this day**, open, with a count of the day's rows on the right. |
| Click the header | It collapses to the header alone. The count stays readable — collapsed, it is the only thing saying the day has anything in it. |
| Click it again | It reopens. |
| Collapse it, change day, quit and restart | Still collapsed. |
| Collapse it, then check the entries are not gone | Reopen and the rows are all still there — collapsing hides, it does not clear. |

### Editing which task a block belongs to

| Do this | Correct result |
|---|---|
| Right-click a block on the day view | **Edit task** is the first item on the menu. |
| Click it | A dialog opens with the block's times in the title, a search box already focused, and the issue list below it. |
| Type part of a title that is not in the loaded issues | Matches appear under **Elsewhere in Jira**, same reach as the omnibar. |
| Pick a different issue | The block is now on that issue. **Start and end are unchanged** — check both, on the card and on the timeline. |
| Pick the issue it is already on, or press Cancel or Escape | Nothing changes. |
| Do it to an entry that has already synced | Refused, with a message saying to delete it — which offers to remove the Jira worklog — and add it again. A worklog cannot be moved between issues. |
| Do it to a **Manual Jira entry** | Refused. Not Joggl's record to repoint. |

### Work description

Jira's own name for the worklog comment. Plain text by design — offering bold without
offering the rest would promise something the field cannot keep.

| Do this | Correct result |
|---|---|
| Right-click a block, or an "On this day" row | **Work description** is the second item, under Edit task. |
| Click it | A dialog opens with the block's times in the title and a textarea already focused, pre-filled with whatever is there. |
| Type something and Save | It appears after the task name, separated by `·`, in grey italics. The task name keeps its own tone. |
| Press Ctrl+Enter instead of clicking Save | Same thing. Plain Enter must insert a newline, not save. |
| Write a very long description | It clips with `…` **before** the start–stop times. The times never move and the task name stays readable. |
| Write two lines, then look at the row | Shown on one line; the tooltip and the dialog keep the line break. |
| Add a description to an already-synced entry | It turns `● pending`. Finish Day then rewrites that one worklog. |
| Open the dialog and close it without typing | Still `✓ synced` — opening it is not an edit. |
| Clear the text of a synced entry and Save | It turns `● pending`, and the next Finish Day removes the description in Jira. |
| Right-click a **Manual Jira entry** | Refused, saying to change it in Jira. |
| Log a description in the Jira UI, then Refresh in Joggl | It shows on that read-only row, same grey italics. |

### Touching an entry without changing it

The point of these is that **nothing** should end up offered for a re-sync.

| Do this | Correct result |
|---|---|
| Click a synced block on the day view, without moving it | It stays `✓ synced`. Finish Day says everything is already in Jira. |
| Click into a synced entry's start field and click away without typing | Still `✓ synced`. |
| Type `9:0` into a start field that already reads `09:00` and blur | Tidies to `09:00`, still `✓ synced` — normalising the text is not an edit. |
| Drag a synced block and drop it back on its own start | Still `✓ synced`. |
| Now change something for real — drag it an hour, or type a new end | Back to `● pending`, and Finish Day rewrites that one worklog. |

### Display settings

| Do this | Correct result |
|---|---|
| Look at the pins | Each shows its key **and** the full issue title, the title ellipsised if the bar is narrow. |
| Settings → Pin labels → Title only, then Key only | The chips change immediately, and the choice survives a restart. |
| Step to a Saturday or Sunday | The day view column is faintly reddish. The rest of the window is unchanged, and hour labels stay legible. |
| Step to a weekday | No tint. |
| Settings → untick Tint weekends, go back to a Saturday | No tint. Tick it again and it returns. |

### The day view's own click

| Do this | Correct result |
|---|---|
| Scroll the timeline, then click an empty hour | A quick-entry popup opens **visibly**, focused, titled with that hour and the half hour after it, and sitting fully inside the window. |
| Type in it, then press Escape | It closes and nothing is created. |
| Click an empty hour, then click elsewhere | It closes. A second click on the grid opens it again — a popup that closed itself must not eat the next click. |

### Clicking

Before this, a left click on a block or a row did nothing at all, and `dblclick`
appeared nowhere in the renderer.

| Do this | Correct result |
|---|---|
| Click a block on the day view | It and its row in "On this day" both get a ring. Nothing else does. |
| Click a different block | The ring moves. Only ever one entry is selected. |
| Click a row instead | Its block gets the ring too — the pairing works both ways. |
| Arrow down the rows or the blocks | The ring follows the keyboard, not just the mouse. |
| Zoom, or let a Jira read land | The ring survives the re-render. |
| Click the empty space below the rows, or the grid away from every block | The ring goes. |
| Press Escape with a menu or dialog open | It closes and the ring stays. A second Escape puts the ring down. |
| Step to another day and back | Nothing is selected. |
| Drag a block and let go | It is **not** selected — a finished move is not a click. |
| Double-click the task name in a row | **Edit task** opens. |
| Double-click anywhere else on a row, or anywhere on a block | **Work description** opens. |
| Double-click a time or duration field | The text is selected, as any field does. No dialog. |
| Double-click a **Manual Jira entry** | Only the usual refusal, no dialog. It can still be selected. |
| Double-click the issue row the timer is already running | The timer keeps its elapsed time and no entry is created. Before, the second click stopped and restarted it, and a fragment under ten seconds old was discarded. |
| Double-click a different issue row | Starts on that one, exactly as a single click does. |

### Jumping to a date

Stepping a day at a time is fine for yesterday and useless for last month — June from
July was about fifty clicks.

| Do this | Correct result |
|---|---|
| Click the date in the day header | A month grid opens, the shown day highlighted and already focused. |
| Look at the grid | Always six weeks, so stepping months never resizes it. Monday first. Days either side of the month are greyed, not blank. |
| Look for tomorrow | Every day after today is disabled — the timer runs on today and `next-day` stops there. |
| Click a day | The dialog closes and the day header, entry list and day view all move to it. |
| Press `‹` or `›`, or Page Up and Page Down | A month at a time. `›` is disabled once the next month has not started. |
| Arrow around the grid | Left and right a day, up and down a week, Home and End the ends of the month. Moving past the edge of the month brings the next one into view. |
| Tab inside the dialog | One stop for the whole grid, not forty-two. |
| Press Escape | Closes, day unchanged, focus back on the date label. |
| Press Page Up and Page Down with the dialog closed | A week back and forward. Forward past today lands on today. |
| Press Page Up with the caret in the omnibar | The day does not move. |
| Step back a month from the 31st | Lands on the last day of the shorter month, never back in the month it started from. |

### Counting overlaps

| Do this | Correct result |
|---|---|
| Make two entries overlap | **One** line above the list: `⚠ 2 entries overlap`. Both rows keep their outline. Neither carries a sentence of its own. |
| Overlap a **Manual Jira entry** with one of yours | `⚠ 1 entry overlaps another`. Only your row is outlined — the Jira one is not yours to fix. |
| Separate them again | The line goes. |
| Give an entry a sync error while it also overlaps | The error still shows on its own row. That one is specific to it. |

### The keyboard

Everything here used to need the mouse. The rule that shapes it: **nothing is highlighted
until an arrow key is pressed**, because Enter already means something in three of these
four lists — start the typed text, commit free text, take the only match — and
pre-selecting the first row would quietly change all three.

| Do this | Correct result |
|---|---|
| Type in the omnibar, then press ↓ twice | The second result is highlighted, and only it. ↑ walks back, Home and End jump to the ends, and both ends wrap. |
| Press Enter | The highlighted issue starts, not the typed text. |
| Type something that matches nothing, press Enter | Nothing was highlighted, so it starts as a local entry — the old behaviour, unchanged. |
| Same arrows in the quick-entry popup, the pin picker and Edit task's search | Same behaviour in all three. They share one helper; three copies would rot apart. |
| Press Ctrl+L from anywhere | The omnibar takes focus and its text is selected. |
| Press Ctrl+Enter with the omnibar empty | The day's most recent entry resumes. Resuming an issue already booked earlier today is a merge decision, so the prompt appearing is correct. |
| Press Ctrl+Enter with a timer running | It stops, exactly as the button does. |
| Press `[`, `]`, `T` | Previous day, next day, today. `]` does nothing on today, since the button is disabled. |
| Press `[` with the caret in the omnibar | A `[` appears in the text. The day does not move. |
| Press `[` with a modal open | Nothing. An open dialog owns the keyboard. |
| Tab into "On this day" | The list is **one** tab stop. ↓ and ↑ then move between rows inside it, and Tab leaves. |
| Press Enter on a focused row, or Shift+F10 | The context menu opens beside that row, first item highlighted. |
| Arrow down the menu and press Enter | That item runs. Escape closes it and puts focus back on the row it came from. |
| Tab repeatedly inside any dialog | Focus cycles within it and never reaches the page behind. Escape closes it and returns focus to where it started. |
| Tab into the day view, then ↓ | The blocks rove the same way as the rows. A running block is skipped — it has no menu. |

### An empty day

The two ways to put time on a day — dragging an issue in, clicking an hour — are both
invisible. A colleague opening Joggl for the first time has no reason to try either.

| Do this | Correct result |
|---|---|
| Open a day with nothing on it | The panel says what to drag and what to click; the day view says the same on the grid. |
| Click an hour while that hint is on screen | The quick-entry popup opens as usual. The hint must not swallow the click. |
| Drop anything on the day | Both hints disappear at once. |
| Delete the last entry again | Both come back. |
| Look at a day holding only **Manual Jira entry** rows | No hint. The day is not empty, whatever the local store says. |

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

Fixed on 2026-07-30:

- **Merely touching an entry offered a re-sync.** A click on a day-view block runs the
  whole move gesture — mousedown, no movement, mouseup — and committed unconditionally;
  focusing a time field and clicking away re-parsed the value it already held and did the
  same. Both flipped a `synced` entry to `pending`, so Finish Day offered to rewrite a
  worklog that was already correct. Every such path now compares the times first
  (`sameTimes` in `renderer/js/entry-ops.js`).

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

46 checks, exits non-zero on failure. It needs **no dependency and no DevTools Protocol** —
the main process already holds `webContents.executeJavaScript`, which is enough to
dispatch real `MouseEvent`s, read computed styles and element boxes, and drive the app end
to end. `main/index.js` loads it only under `--uicheck`, which also redirects `userData` to
a temp directory, so a run cannot touch a real day log and can run while the app is open.

The traps that make checks pass or fail for the wrong reason are documented at the top of
the script and in `CLAUDE.md`. The short version: back-date a timer's start or it is
discarded before it counts; scope entry counts to `.entry-card:not(.external)`; expect
externals in the overlap layout; assert a drop landed where the preview said rather than
at a hard-coded hour; clamp any computed time into the selected day, because HH:MM
resolves against it; and scroll a target hour into view with `H.showHour` rather than
aiming where it happens to sit.

Two of those were learned by running the suite either side of midnight, which is worth
doing deliberately: the visible hour range grows to cover the current hour, so an empty
day at 00:05 starts at 00:00 and every hour a check aims at moves.

**Add a check whenever a UI bug is fixed.** That is the whole point — of the three bugs
found on 2026-07-29, two were "does this element's box fit in the window" and "did the
panel's scrollTop change", which no amount of reading catches and this catches in seconds.

### Still manual

| Why | What |
|---|---|
| Crosses a process restart | the three Persistence rows |
| Writes to Jira | Finish Day on a future block; rewriting a synced entry's worklog |
| Needs a bare machine | the whole *Starting it on a bare machine* section |

Never run Finish Day against a live site from a script.

The Work Description round trip **was** checked by hand on 2026-07-30, on one disposable
worklog on `GEN-149` that was deleted afterwards: created with two lines, Jira stored
exactly the document Joggl builds and it flattened back identically; clearing it stored
`content: []`, which reads back as no description; setting it again worked. Repeat that
if the ADF ever changes — it is the only way to prove Jira accepts the document, which
no unit test can.
