# CLAUDE.md

## Project

A standalone Electron desktop time tracker with a Toggl-like interface that logs worklogs directly to Jira Cloud.

**The problem it solves:** company policy requires worklog time on Jira tasks, including shared unassigned tasks (e.g. a permanent `Meetings` task). Tracking these across multiple boards is tedious, and such tasks are never "done" — so any tool that only submits worklogs on task completion is useless.

Each user runs their own installation with their own Jira credentials. This is **not** a multi-user application — it is a single-user application distributed to several people.

---

## Migration context — READ THIS FIRST

This is a **port of an existing, working Super Productivity plugin**, not a greenfield build.

The old version ran as a sandboxed iframe plugin inside Super Productivity (SP). It was abandoned because SP enforced a ~100 KB plugin size limit (already reached), it read Jira credentials out of SP's internal IndexedDB (`SUP_OPS → state_cache`, an undocumented internal), and the sandbox forced everything inline in one file with no build step and no tests.

**The old source lives in `legacy/`. Read it before writing anything.** It is read-only reference material: port from it, never edit it, never ship it. The UI layer is good and battle-tested — port it, do not redesign it.

### Carries over unchanged

Pure frontend logic, no SP coupling. Port as-is; refactor into modules only where it aids testability. Do **not** rewrite this into a framework — the drag/resize edge cases are already solved and a rewrite will silently lose them.

- Day view timeline rendering (hour grid, auto-expanding range)
- **Overlap column layout** — concurrent entries split side by side, Toggl-style
- Drag-to-move entry blocks (15-minute snap)
- Drag top/bottom handles to resize, snapping to adjacent entry boundaries
- Live in-progress block that grows in real time and participates in overlap layout
- Entry split-at-midpoint, restart, duplicate, delete — from a right-click menu shared
  by the entry list and the day view. **Edit task** sits first on it: a searchable
  picker that books the same block against a different issue, times untouched.
  **Work description** sits second: Jira's own name for the worklog comment, plain
  text, shown after the task name in grey italics and clipped before the times.
- The day's entries live in a collapsible **On this day** panel above the issue list,
  open by default, its state remembered like the sidebar's
- **Copy previous day** and **Clear day** sit in that panel's header, and Copy is
  offered again in the empty state where it is most wanted. Copy finds the most recent
  day with anything on it — **checking Jira as well as the day log for each day**,
  since a day worked entirely in the Jira web UI has no local entries at all — and
  brings it over at the same times on the clock. Capped at 30 days, after which the
  honest answer is that there is nothing to copy. Copies arrive unsynced and carry no
  `worklogId`, so Sync logs them as new worklogs rather than rewriting the originals.
  Clear day is **local only**: it never issues a DELETE to Jira, offers to spare the
  synced entries, and cannot touch Jira-side rows because they are not `state.entries`
- Settings for the two things people read differently: pin labels (key and title by
  default, since a title alone does not identify a `Meetings` issue when every project
  has one) and a faint tint on Saturday and Sunday in the day view
- **Day view text is 10 / 12 / 14 / 16 px, defaulting to 12.** The ported range was
  8–12, which is unreadable on a high-DPI screen even at the top of it. A size stored
  under the old range snaps to the nearest one still offered — `nearestFontSize` in
  `util.js` — because a `<select>` whose value matches no option renders blank. The
  hour gutter follows the same setting but a step behind and capped at 12 px: the
  gutter is 40 px wide and that width is pinned in the drag maths (`GUTTER_PX` in
  `timeline.js`, `left: 40px` in the CSS), so the label may not outgrow it
- **No emoji as icons.** They arrive at whatever size and weight the system font
  chooses. `🗑` was the last one on an entry, and its ribs collapsed into grey mush —
  `DELETE_ICON` is drawn instead, at the weight of the play triangle beside it. A
  context-menu item carries either `icon` (a text glyph, escaped) or `svg` (one of our
  own constants, not escaped); the two are separate fields so the escaping rule stays
  obvious. `📌` on an issue row is the one emoji left
- Inline editing of start / end / duration / title with bidirectional recalculation
- Merge prompt logic
- Zoom controls, resizable panel width, configurable font size

### Gets rewritten

| Old (SP plugin) | New |
|---|---|
| `persistDataSynced` / `loadSyncedData` | `electron-store` (JSON in `app.getPath('userData')`) |
| Jira creds from SP IndexedDB | Electron `safeStorage` (DPAPI on Windows) |
| `fetch()` from sandboxed iframe | `fetch` in the **main process** |
| SP theme CSS variables | Own token set, light/dark |

### Deleted outright

- `manifest.json`, `plugin.js`, the whole SP plugin scaffold
- All `PluginAPI` calls: `getTasks()`, `getCurrentContextTasks()`, `dispatchAction()`
- Native SP timer bidirectional sync
- `CURRENT_TASK_CHANGE` / `ACTION` hook handlers
- Task sections sourced from SP ("Today" from SP schedule, "Other Tasks" inbox/overdue) — replaced by JQL
- The SP API debug panel
- Single-file inline structure: use real modules

---

## Status — where the port actually is

The port is **done and running against a live Jira Cloud site**. Everything below has
been exercised end to end, not just written.

### Working

| Area | Notes |
|---|---|
| Process split | `main` / `preload` / `renderer` as specified, `sandbox: true` |
| Store | Own atomic writer, one file per key (see deviations) |
| Credentials | `safeStorage`, token never crosses into the renderer |
| Jira client | `myself`, `search/jql` with `nextPageToken`, worklog create / update / delete / read; `fetchRangeWorklogs` reads a whole span in one JQL and pages each issue's worklogs to the end |
| Setup wizard | First run, with a working `Test connection` |
| Timer, merge, day view | Ported, including overlap columns, drag, resize, split |
| Finish Day | Confirmed against real Jira — worklog `60504` on `EHW-70` |
| Jira-side worklogs | Time logged in the Jira web UI is read back and counted |
| Logging | `logs/joggl.log`, credential-redacted |
| Tests | 283 passing, `npm test`; 85 UI checks, `npm run uicheck` (or `:fast`) |
| Shell | Collapsible sidebar with a view registry; week and month tabs present but disabled |
| Drag to day view | An issue dragged from the task list becomes a 30-minute pending entry |
| Keyboard | Every list arrow-navigable, every menu and dialog reachable — see below |
| Help | A panel above Settings: what the app is for, and every shortcut, built from one list |

### Deviations from this document, and why

Each of these was a deliberate choice made while building. Change them back only with
a reason.

1. **No `electron-store`.** Own ~90-line atomic writer, **one file per key** rather than
   one file for everything. A crash mid-write can then only cost the day being written,
   not the whole history. The spec's key names (`day:2026-07-28`) are kept.

2. **Merging never absorbs a synced entry.** Folding a block that already has a
   `worklogId` into a larger one would either log its minutes twice on the next Finish
   Day or discard the id that prevents exactly that. Synced entries are frozen against
   merging, though not against editing — see below.

3. **Worklog comments are Jira's Work Description, built as ADF.** The plugin sent
   `comment: title` as a string, which v3 rejects. `main/jira/adf.js` builds the
   minimal document instead and flattens what comes back, so a description written in
   the Jira UI is visible here and one written here is visible there. Plain text only
   — see gotcha 5.

4. **Editing a synced entry rewrites its worklog.** The entry keeps its `worklogId` and
   returns to `pending`; Finish Day then issues `PUT .../worklog/{id}` instead of a
   second `POST`. "Never POST an entry that already has one" still holds exactly.
   Worklogs Joggl did **not** create are read-only — it has no record of them beyond
   what Jira just said.

5. **Snapping is to the clock, not to the drag.** Rounding the drag *offset* to 15
   minutes left an entry that began at 09:07 landing on :07, :22, :37, with a minimum
   length that depended on the minute the timer was stopped. Both edges and the block
   move now snap the resulting wall-clock time, measured from local midnight.

6. **`recentIssues()` replaced.** See the task sources section — it returns nothing
   over REST.

7. **Day keys are local dates.** The plugin used `toISOString().slice(0,10)`, which is
   UTC and hands anyone east of Greenwich tomorrow's key late in the evening.

8. **A day's entries live in a Map, and `state.entries` is a view onto it.**
   Week view needs several days at once, and `state.entries` is read in about forty
   places that all mean "the day on screen". Rewriting them to take a day argument
   would be a large change for no user-visible gain, so the storage moved to
   `state.days` and the name stayed — `installDayAccessors` in `day-range.js`
   defines it as a live getter/setter over the selected day. Jira-side rows are
   cached the same way, per day, so stepping back to a day just visited no longer
   blanks and refetches it.

### Next, roughly in order

1. **Week view** — phase 2 of the sidebar work. Day columns, a work-week / 7-day
   toggle, a week stepper that names the week of the month, and dragging entries
   between days. Needs the multi-day state and the generalised timeline column that
   phase 1 deliberately left alone: the `view` singleton in `timeline.js` still ties
   every drag handler to one column. The range data layer it needs — a multi-day
   store, a single range read for a span of Jira worklogs, and the per-day cache —
   landed in 0.16.0.
2. **Month view** — phase 3. A calendar grid with hours logged per day, and the day
   view beside it showing whichever day was clicked.
3. **Tray icon states** — the icon should show at a glance whether a timer is running.
   Right now the only signal is opening the window.
4. **A global start/stop shortcut** — Ctrl+Enter starts and stops from inside the
   window (see *Keyboard*), but reaching it still means giving Joggl focus first. A
   `globalShortcut` that resumes the last task with the window hidden is what would
   make it keyboard-first, and it needs a main↔renderer signal it does not have.
5. **Which days are not worked is a toggle, not a schedule.** The weekend tint is
   hardcoded to Saturday and Sunday; anyone whose week runs otherwise switches it off.
   A per-day working-week setting is the obvious next step if that is not enough.
6. **Splitting a synced entry, and repointing one at another issue** — both refused,
   for the same reason: a worklogId is only valid on the issue it was created against,
   so either needs a delete plus a create with its own partial-failure story. Until
   someone actually misses them, deleting the entry (which offers to remove the Jira
   worklog too) and re-adding it is the honest path, and both messages say so.
7. **macOS build** — a GitHub Actions job with a macOS runner, no code changes.
8. **Auto-update** — still not worth it for ten users. Revisit if handing out installers
   becomes the annoying part.

Deliberately **not** planned: everything under *Out of scope* at the end of this file.
The discipline the 100 KB limit used to impose now has to come from that list.

---

## Keyboard

Five lists are arrow-navigable and they all share **one** helper, `renderer/js/keynav.js`.
Three copies of "which row is active" would rot apart, which is the whole reason it is a
module and has its own tests.

Two shapes, because the lists are two different things:

- `createRowNav` — a **highlight** inside a search result list, driven from the text field
  the user is still typing in. Focus never leaves the input. Used by the omnibar
  dropdown, the quick-entry popup, `issue-picker.js` (Edit task), the pin picker, and the
  context menu.
- `wireRovingList` — a **roving tabindex** over rows that are themselves focusable, so the
  list is one tab stop and arrows move within it. Used by "On this day" and the day view's
  blocks.

**Nothing is active until an arrow key is pressed.** `activate()` answers `null` until
then, and every caller falls back to what Enter already meant — start the typed text, take
the only match, commit free text. Pre-selecting the first row would silently change all
three, which is why the rule is enforced in the helper and not left to each caller.

| Key | Where | What |
|---|---|---|
| `Ctrl+L` | anywhere | Focus the omnibar and select its text |
| `Ctrl+Enter` | anywhere | Start the highlighted or typed issue; with an empty box, resume the day's most recent entry; while running, stop |
| `T` `[` `]` | anywhere, not while typing | Today, previous day, next day |
| `PageUp` `PageDown` | anywhere, not while typing | A week back or forward. Forward past today lands on today |
| `PageUp` `PageDown` | inside the calendar | A month, since `↑` `↓` already move a week and nothing else there changes the month |
| `↑` `↓` `Home` `End` | any list | Move the highlight, wrapping at both ends |
| `Enter` | any list | Run the highlighted row, or fall back to that list's own Enter |
| `Enter`, `Shift+F10`, Menu key | a focused row | Open its context menu. Shift+F10 needs no code — the browser dispatches `contextmenu` on the focused element, so `anchorFor` only has to notice the event carries no coordinates and anchor to the row instead |
| `F1` | anywhere | Open and close Help |
| `Escape` | menu, dialog or panel | Close it, and put focus back where it came from. Again to put the selection down. The setup wizard is deliberately excluded — on a first run there is no app behind it |
| `Tab` | inside a dialog | Cycles within it; `modal.js` traps it, so the page behind is unreachable |

Bare-key shortcuts are suppressed while a modal is open and while the caret is in a field —
otherwise `[` would step the day instead of reaching the text.

**Help lists every one of these, in the app.** `renderer/js/help.js` holds the bindings
as data and builds the table from it, so the panel cannot show a list the code does not
have — but nothing stops the reverse, so **a new binding means a new row in
`SHORTCUTS`**. The UI check counts the rows and asserts the ones that exist, which is
the only pressure there is. The prose beside it lives in `index.html` with the other
panels.

---

## Clicking

Everything an entry can do used to sit on the right-click menu, and a left click on a
block or a row did nothing at all.

| Where | Click | Double click |
|---|---|---|
| Issues row, pin chip | Start the timer | Nothing extra — the second click is ignored |
| Day view, empty hour | Quick-entry popup, and the selection goes down | Same |
| Day view, a block | Select it | Work description |
| "On this day", the task name or key | Select it | Edit task |
| "On this day", anywhere else on the row | Select it | Work description |
| Time fields, ▶, 🗑 | Their own | Their own — a double click selects the text |
| A **Manual Jira entry** | Select it | The refusal it already gives |

**Selection is not focus.** `state.selectedEntryId` marks one entry in *both* panels at
once, which is the point: with overlap columns it is otherwise unclear which block is
which row. Focus is per-panel, invisible in the other one, and moves away the moment
you type; the selection stays until Escape, a click on empty space, a day change, or
the entry being deleted. The arrow keys carry it, so keyboard and mouse agree.

Three things shape the implementation, and each of them was a bug first:

1. **Selecting must not re-render.** If the first click of a double click ran
   `renderAll()`, the element would be replaced and the second click would land on a
   new node, so the `dblclick` would never fire. `selection.js` puts the class
   straight onto the two elements, the same reason `liveUpdate` mirrors a drag by
   hand. `applySelection()` then runs at the end of both renders, because the id in
   state is the truth and the class is only its shadow.
2. **A completed move is not a click.** `onMoveBlock` calls `preventDefault()` on
   *mousedown*, which suppresses focus and text selection but **not** the click — so
   every finished drag would also read as "select this". It records whether the start
   ever actually changed and suppresses the click that follows. That flag is module
   level, not per-gesture, because the commit re-renders and the click lands on the
   *new* block. The same `preventDefault` is why the click has to call `focus()`
   itself.
3. **Starting the timer on the task it is already running is a no-op.** `startTimer`
   opened with `if (state.timer) await stopTimer()`, so a double click on a task row
   stopped the timer the first click started — and a fragment under ten seconds old is
   discarded on purpose, so the elapsed time vanished. The guard compares
   `taskKeyOf`, merge.js's definition of "the same task", so the timer and the merge
   cannot disagree about it.

`click-actions.js` holds the one rule for which editor a double click opens, so the
two panels cannot drift apart about what a region means. A day-view block resolves to
the description whatever part of it was hit: the block is all label, so there is no
"anywhere else" to aim at, and the description is the dominant need there — every one
of the 391 real worklogs sampled on this site had one, while repointing a block at
another issue is a rare correction that stays first on its right-click menu.

---

## Stack

Electron, chosen because the existing frontend is already JavaScript and Electron keeps the entire codebase in one language. No Rust, no Python, no native modules, therefore **no C++ build toolchain required**.

| Dependency | Purpose |
|---|---|
| `electron` | Shell, tray, global shortcuts, `safeStorage` |
| `electron-store` | Day logs, pins, settings |
| `electron-builder` | NSIS installer for Windows |

Keep the dependency list short. Every native module added reintroduces the build-toolchain requirement this stack was chosen to avoid — if a dependency needs `node-gyp`, find another way.

> `electron-store` has shipped ESM-only in recent majors. Verify CJS/ESM compatibility against the Electron version at install time and pin accordingly. If it causes friction, a ~40-line atomic JSON writer over `app.getPath('userData')` is an acceptable substitute — atomic writes (temp file + rename) are the non-negotiable part, not the library.

---

## Process architecture

This is the main structural difference from the plugin version. Get it right up front.

```
main/          Node context. Jira HTTP, safeStorage, tray, globalShortcut,
               electron-store, window lifecycle.
preload/       contextBridge only. Narrow, explicit IPC surface.
renderer/      The ported UI. No Node APIs. No direct network access.
```

Rules:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Non-negotiable.
- The renderer **never** calls Jira directly. All Jira traffic goes through IPC to main. This is what removes CORS from the picture — the same outcome the SP Electron shell was accidentally providing before.
- The preload surface is an explicit allowlist of named channels. Do not expose `ipcRenderer` itself.
- The renderer never sees the API token. Not once, not even on the settings screen. Settings sends the token to main for storage and receives back only a boolean "configured / not configured".

---

## Domain model

```jsonc
// electron-store key: "day:2026-07-28"
{
  "date": "2026-07-28",
  "entries": [
    {
      "id": "uuid",
      "issueKey": "PROJ-123",      // null for local-only entries
      "issueId": "10042",          // Jira numeric id, used for worklog POST
      "title": "Meetings",
      "startTs": 1753689600000,    // epoch ms
      "endTs": 1753693200000,      // null while running
      "status": "pending",         // pending | synced | error | local
      "worklogId": null,           // set after successful POST; guards re-submit
      "comment": null,             // Jira Work Description, plain text; ADF at the boundary
      "errorMsg": null
    }
  ]
}
```

- `status: "local"` — no `issueKey`, will never sync, still counts toward the daily total
- `worklogId` is the idempotency guard. **Never POST an entry that already has one.**
  An entry that has one and is back to `pending` was edited after syncing: it is
  rewritten with `PUT .../worklog/{id}`, never posted again.
- One store key per day. Never put all history in a single key.

### External worklogs

Time booked straight into the Jira web UI is read back per day and shown alongside the
local entries, so the daily total is not a lie. These are **never persisted** — they
live only in `state.external`, a per-day session cache (see deviation 8) merged in at
render time via `state.externalEntries`, so a stale copy can never end up in a day log.
They are read-only: no drag, no edit, no delete, and Finish Day does not see them. A
Jira worklog whose id already appears on a local entry is dropped, so Joggl's own
synced entries are not shown twice.

Anything that changes what Jira holds for a day calls `invalidateExternal(dayKey)`
first, so the next read is a real one instead of answering from the cache. Finish Day
does this after a successful sync, and deleting a worklog does it too — without that,
a per-day cache would otherwise leave a deleted worklog sitting on screen as a phantom
**Manual Jira entry** for the rest of the session, since nothing would ever ask Jira
about that day again.

They are drawn dashed and unfilled in the `--external` cyan, labelled **Manual Jira
entry** beneath the issue title. Cyan because it has to sit clearly apart from the
indigo of a pending entry and the green of a synced one — the distinction that matters
is *whose record is this*, not *has it been sent*. They take part in overlap detection,
so a local entry clashing with one is still flagged, but the warning is not repeated on
the Jira row itself: it invites a fix, and there is nothing there to fix.

Persist on: stop, every inline edit (500 ms debounce), every merge, every drag/resize commit. A crash must never cost more than the current minute.

---

## Domain rules

### Merge on repeated task activation

Starting a timer on a task that already has entries today:

- Gap since that task's last entry **≤ 30 min** → merge silently into one entry (`start` = earliest start, `end` = current end)
- Gap **> 30 min** → prompt `[Merge into one]` / `[Keep separate]`
  - Merging extends the block across the gap. This is intentional and correct for `Meetings`.

An entry that **starts after the timer's start is never a merge candidate**, whatever
the gap. The 30-minute rule is a *resumption* heuristic, and a block that has not
happened yet cannot be resumed — a block dropped onto 14:00 is leave, or a meeting
already in the diary. Folding one in would book the whole span between: drop
`Meetings` on 14:00, time the 10:30 standup for half an hour, and the negative gap
reads as an overlap, producing one 10:30–14:30 entry that Finish Day submits as four
hours. The bound is threaded through `mergeableEntries` so the decision taken at
start and the merge applied at stop cannot disagree about the candidate set.

**That bound is fixed when the timer starts and carried on the timer** as
`mergeNotAfterTs`, alongside `mergeChoice` — the two are decided together and mean
nothing apart. It is not recomputed at stop, because the omnibar edits a *running*
timer's start in place and does not retake the merge decision. Deriving the bound
from the edited start instead let the stop absorb a block the start had excluded:
worked 09:50–09:55, `Meetings` booked ahead on 10:30–11:00, timer started at 10:00
and later corrected to 11:00, and stopping produced one 09:50–11:35 entry that ate
the half hour booked ahead. A timer persisted by an older build has no such field,
so the stop falls back to the entry's start.

Merging is always local. Nothing reaches Jira until Finish Day.

### Sync

The button is **Sync** on today and **Re-sync** on any other day. The module and its
functions are still called `finish-day` / `planFinishDay` / `runFinishDay`: renaming
them would churn every test and every UI check for no behaviour, and finishing a day
is still what the operation is.

- Stopping a timer **never** submits anything. It writes a `pending` entry locally.
- **Sync** submits all `pending` entries for the selected day, sequentially.
  An entry that carries a `worklogId` is an edit of something already synced, and is
  rewritten in place rather than posted again.
- Entries without an `issueKey` are marked `local` and do not block the day from finishing.
- On partial failure: successful entries keep `synced` and their `worklogId`; failures get `error` plus a message. **No automatic retry.** Show a summary with a `Retry failed` button.
- Past days: the button becomes **Re-sync**, submitting only non-synced entries.
- The timer runs only on the current day.
- **The button says what it will do before it does it** — `Sync · 3 entries, 2h 15m`,
  and `Nothing to sync`, disabled, when there is neither a worklog to write nor an
  entry to mark. Pressing the one control that writes to Jira was otherwise a blind
  action, worst on a day where most of what is on screen is read-only Jira rows going
  nowhere. `syncLabel` counts **only what reaches Jira**: entries with no issue key
  are merely marked `local`, so folding their minutes in would overstate it, and they
  get their own phrasing when they are all there is. `syncTooltip` carries the rest —
  what is a rewrite rather than a fresh log, what is already there, and that the
  running timer is excluded.

### Validation

- Overlapping entries are permitted (the timeline renders them in overlap columns) but flagged visually — usually a mistake.
- A **running timer's** start may not be in the future — it would measure negative
  elapsed time. Entries drawn by hand may be: dropping an issue at 18:00 while it is
  14:00 books leave, an out-of-office block, or a meeting already in the diary, and
  Finish Day submits it like any other pending entry. The constraint therefore lives
  on the omnibar start-time field, not on entry creation.
- An edit producing `end < start` is rejected inline, never via modal.

---

## Jira integration

Jira **Cloud**. Basic auth: account email + API token, base64. Base URL like `https://company.atlassian.net`.

All calls originate in the main process using Node's global `fetch`.

| Purpose | Endpoint |
|---|---|
| Connection test | `GET /rest/api/3/myself` |
| Issue search | `POST /rest/api/3/search/jql` |
| Submit worklog | `POST /rest/api/3/issue/{issueIdOrKey}/worklog` |
| Rewrite worklog | `PUT /rest/api/3/issue/{issueIdOrKey}/worklog/{id}` |
| Delete worklog | `DELETE /rest/api/3/issue/{issueIdOrKey}/worklog/{id}` |
| Read a day's worklogs | `GET /rest/api/3/issue/{key}/worklog?startedAfter=&startedBefore=` |
| Free-text lookup | `POST /rest/api/3/search/jql` with `summary ~ "term*"` |
| Exact-key lookup | `GET /rest/api/3/issue/{key}` |

**Do not use `/rest/api/3/issue/picker`.** It is the obvious choice — Jira's own
autocomplete — and it does not work over an API token. On the test site it returns
only an `hs` (browsing-history) section, which such a request has none of:
`meeting` finds nothing at all, `GEN-100` finds nothing, `GEN-1` returns `GEN-147`,
and `Meeting - Protostar` returns nineteen unrelated issues. It fails by returning
plausible garbage rather than an error, which is the worst way to fail.

`summary ~ "term*"` does the job properly: matches titles, ignores status, and
prefix-matches so results appear while still being typed. The right-hand side of `~`
is a **Lucene query**, so every operator character must be stripped from whatever the
user typed — an unbalanced bracket 400s the whole request and the search box silently
goes dead. A hyphen is Lucene negation, which is why `Meeting - Protostar` has to
become `Meeting Protostar*`. See `toSummaryTerm` and its tests.

An exact key still gets its own `GET /issue/{key}` on top, which is definitive where a
title search is not, and that hit is listed first.

**A word that is a project key becomes a filter, not title text.** `meeting gen` and
`gen meeting` both mean *issues in GEN whose title mentions meeting* — something a
title search cannot express, since the key never appears in the title. Applied from two
words up only: plenty of keys here are short, common English words (`IN`, `ON`, `IP`,
`EC`, `AL`), so a single word has to keep meaning "search the titles". The project list
comes from `GET /rest/api/3/project/search`, cached per base URL for the session; if
that call fails, the title search still runs.

**Reading back a day's worklogs takes two steps.** There is no "my worklogs on date X"
endpoint. JQL (`worklogAuthor = currentUser() AND worklogDate = "…"`) narrows the whole
instance to the issues carrying such a worklog; each of those is then asked for its
worklogs, bounded server-side with `startedAfter`/`startedBefore` and filtered by
`author.accountId`. The bounds matter: a shared issue can hold hundreds of other
people's entries — one on this site has 660.

### Gotchas — these will cost hours if ignored

**1. `/rest/api/3/search` is removed, not merely deprecated.** It returns HTTP 410. Use `/rest/api/3/search/jql`.

**2. The new search endpoint defaults `fields` to `id` only.** The old one defaulted to `*navigable`. Request fields explicitly:

```jsonc
{
  "jql": "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
  "fields": ["summary", "status", "issuetype", "project"],
  "maxResults": 100
}
```

**3. Pagination is `nextPageToken`, not `startAt`.** Loop until the token is absent. There is no reliable `total`; use `POST /rest/api/3/search/approximate-count` if a count is ever needed.

**4. Worklog `started` must be `yyyy-MM-dd'T'HH:mm:ss.SSSZ` — numeric offset, no colon:**

```
2026-07-28T09:00:00.000+0200   ✅
2026-07-28T07:00:00.000Z       ❌ rejected
2026-07-28T09:00:00+02:00      ❌ rejected
```

`Date.prototype.toISOString()` produces the rejected form. Write a dedicated formatter and unit-test it. **This is the single most likely cause of a silent Finish Day failure.**

**5. Worklog `comment` in API v3 is Atlassian Document Format, not a string.** This is
Jira's **Work Description**, and colleagues fill it in: of 391 real comments sampled on
this site, every worklog had one. So it is built rather than skipped, in
`main/jira/adf.js`, and `/rest/api/2/` is deliberately *not* used for the one call —
mixing API versions for a single field is worse than twelve lines of ADF.

Joggl writes plain text only, as one paragraph with `hardBreak` between lines. The
reader has to cope with what the Jira UI produces, and those same 391 comments say what
that is: `paragraph`/`text` almost always, plus `hardBreak`, a `link` mark, and a
handful of multi-paragraph docs. So `adfToText` walks the tree collecting text and
ignores what it does not know, rather than matching on an expected shape — formatting
Joggl cannot offer still shows its words instead of vanishing.

On **create** the field is omitted when there is no text; on **update** it is always
sent, because omitting it would leave a description the user has just deleted sitting in
Jira with nothing on screen to account for it.

### Task sources

Replaces SP's task sections. **Queries must be user-configurable in settings — never hardcode project keys or filter IDs.** Ship these as defaults:

```
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC
worklogAuthor = currentUser() AND worklogDate >= -30d ORDER BY updated DESC
```

> The second default was originally `issuekey IN recentIssues()`. Verified against a
> live site: it returns **0 issues** over the REST API, because `recentIssues()`
> resolves against the browser's view history, which an API-token request does not
> have. Worklog authorship answers the question a time tracker actually cares about —
> the issues you keep booking time against, shared ones like `Meetings` included.

Pinned tasks are a **local list of issue keys** in the store, not a Jira filter.

The task sources decide what the issue list shows, but they must not decide what is
*findable*. An issue that is Done, or assigned to a colleague, is not in any of them —
so once the local matches thin out to two or fewer, or the query names a key, the
search box also asks Jira directly and shows those results under **Elsewhere in Jira**.
Debounced, and a late answer for a query the user has already moved past is discarded.

### Credentials

- The API token is written via `safeStorage.encryptString()` and stored as the resulting buffer. Never plaintext, never in the store as-is, never in the repo.
- `safeStorage` is only available after `app.whenReady()`. Check `isEncryptionAvailable()` and fail loudly with an actionable message if it returns false.
- Base URL and email may live in `electron-store` unencrypted.

---

## Distribution

The app is shared with colleagues internally. Each installs their own copy and configures their own credentials.

This is why the following are **in** scope despite being unnecessary for a solo tool:

- **No prerequisites to run it.** `run.cmd` → `scripts/launch.ps1` uses a Node on PATH if
  there is one new enough, and otherwise fetches a **portable** Node into `.node\`,
  checked against the SHA-256 nodejs.org publishes. No administrator rights, nothing
  outside the project folder, and deleting `.node\` undoes it. A managed laptop that
  will not grant an MSI install is the case this exists for.

  It is still the low-ceremony route rather than the good one: it leaves a console
  window open and costs ~400 MB per machine. `npm run dist` builds a proper NSIS
  installer, which is what colleagues should eventually get.
- **First-run setup wizard** — Jira base URL, email, API token, with a link to `id.atlassian.com/manage-profile/security/api-tokens` and a working `Test connection` button. Do not assume the user knows where to get a token.
- **Actionable error messages.** You cannot debug over ten people's shoulders. "401 from Jira — check your API token in Settings" beats a stack trace.
- **Configurable JQL** (see above). Colleagues work on different projects.
- **No baked-in configuration of any kind.** No URLs, no project keys, no personal filters.

Not in scope for v1:

- **Auto-update.** For roughly ten users, handing out a new installer is cheaper than standing up updater infrastructure. Show a version string in the UI so people can report what they are running, and leave it at that.
- **macOS builds.** Electron cannot cross-compile a macOS build from Windows. When needed this is a GitHub Actions job with a macOS runner and no code changes. Do not restructure anything for it now.

---

## Environment

Windows 11, PowerShell + Git Bash. Project root: `F:\Code\Joggl`.
Repo: `git@github.com:aoreskovic/joggl.git`.

`legacy/` holds the old Super Productivity plugin (`legacy/spoggl/`) and its docs
(`legacy/docs/`). It is git-ignored on purpose: read-only reference, never shipped.
`docs/` is for Joggl's own documentation, written as the port progresses.

Installed and on PATH — **do not probe for these**:

| Tool | Notes |
|---|---|
| Node.js LTS + npm | Node 22+. Not a prerequisite for *users* — see Distribution. |
| Git | |
| GNU coreutils | shadowed by PowerShell aliases; irrelevant under Git Bash |

**Not installed and not needed: Python, Rust, MSVC / C++ build tools.** Do not use them, and do not propose dependencies that require them.

### Shell policy

Use file tools (Read / Write / Edit / Glob / Grep) for all file operations. Do **not** shell out for reading, writing, listing, or searching files.

Shell is for exactly two things: `npm` and `git`.

Never probe the environment. If something above appears missing, say so and stop — do not run detection commands and do not attempt to install anything.

---

## Conventions

- Timestamps are epoch ms internally. Convert to local wall clock only at the render and Jira-serialisation boundaries.
- All network calls live in one main-process Jira client module. One place to mock, one place to debug.
- Errors surface inline or via toast. Modals are for decisions (merge prompt, retry summary), never for information.
- Keep the main process thin. If logic can live in the renderer without needing Node, it lives in the renderer.
- **Bump the version on every commit.** The version shows in the footer, so "which
  build are you on" has an answer without asking anyone to check a commit hash.
  - **A change bumps the minor** — `npm run bump`, `0.15.0` → `0.16.0`.
  - **A fix to a change bumps the patch** — `npm run bump:fix`, `0.16.0` → `0.16.1`.
    Review findings, follow-ups and anything else that corrects a version already cut
    belong here. Spending a minor on them makes the minor stop meaning "something new",
    which is the only thing it is for.
- **Touching an entry is not editing it.** Every path that can mark an entry as
  needing a re-sync compares the times first — `sameTimes` in `entry-ops.js`. A click
  on a day-view block runs the whole move gesture and lands where it started;
  focusing a time field and clicking away re-parses the value it already held. Both
  used to flip a `synced` entry to `pending`, so Finish Day offered to rewrite a
  worklog that was already correct.
- **A render must never start a lookup.** Search boxes render from state and trigger
  the remote lookup from the event that changed it. Doing it inside the render put
  `render → lookup → callback → render` into a loop that blew the stack, and because
  the quick-entry popup revealed itself *after* rendering its results, the whole day
  view looked dead. `createRemoteLookup` therefore never calls back synchronously.
- **A warning is worth saying once.** Every clashing row used to carry a sentence
  saying it overlapped; with three of them the list was mostly warning text repeating
  what each row's coloured outline already said. One line above the list counts them,
  and `flaggedOverlaps` is the single source both read — the outline and the count
  cannot disagree about how many there are. A Jira-side row takes part in the
  detection but is never flagged: the flag invites a fix and there is nothing there
  to fix.
- **The calendar only looks backwards.** The timer runs on today and `next-day` stops
  there, so a future day is not one this app has anything to say about. Those cells
  are disabled rather than missing, because a month with holes in it reads as broken,
  and every cursor move is clamped so focus can never land on one.
- **An empty state names the gesture.** Both ways of putting time on a day — dragging a
  row from the issue list, clicking an hour on the grid — leave no trace in the UI, so an
  empty day says so in both places. The grid's hint is `pointer-events: none`, or it would
  sit over the hours it is telling people to click. A day holding only read-only Jira rows
  is **not** empty: the hint keys off what is rendered, not off what the store holds.
- **A day's bounds are `addDays`, not a fixed 86,400,000 ms.** `loadDays` and
  `loadExternalWorklogs` both compute the end of a range as `startOfDayMs(addDays(day,
  1))`, never `startOfDayMs(day) + DAY`. A day is not always 24 hours — the autumn
  clock change makes one 25 — and adding a constant would cut that day's last hour off
  the range a moment before midnight actually arrives.

### Tests

Full UI coverage is not the goal. These four need real tests, because a silent failure means lost and unrecoverable time data:

1. Worklog timestamp formatter (gotcha 4)
2. Merge decision logic at the 30-minute boundary
3. Finish Day partial-failure state transitions
4. Day log persist / reload round trip

```bash
npm test
```

### Driving the UI — read this before deciding something cannot be verified

The UI is not untestable, and it needs no dependency, no framework and no DevTools
Protocol. The main process already holds `webContents.executeJavaScript`, which is
enough to dispatch real `MouseEvent`s, read computed styles and element boxes, and drive
the whole app end to end.

```bash
npm run uicheck
```

There are two modes. `npm run uicheck` drives the app against the **live** Jira and is
the one that must pass before a commit. `npm run uicheck:fast` swaps the whole Jira
client for `main/jira/fake.js` — same exports, same post-parse shapes, fixtures instead
of `fetch` — so it needs no network and no credentials, which is what makes it runnable
after every edit. `main/ipc.js` picks the module in one line, which is the payoff for
the rule that every network call lives in one place.

**The two must report the same counts.** That is the only thing keeping the fake
honest; a fixture that has drifted shows up as a check that passes in one and fails in
the other. The fake also books two worklogs on today and none on any other day, so the
checks that need a Jira-side row always run and `findEmptyDay` always succeeds — against
a live site both depend on what happened to be booked that week.

A run takes about two minutes. It used to take ten to twenty, and the difference was
almost entirely waiting: `H.settle` had a 1.2-second floor, and `H.resetDay` clicked
**Today** even when today was already selected, so each of some hundred and fifteen
calls fired a fresh live read of that day's worklogs. Both are gone — see *the hook*
below.

That runs `scripts/ui-check.mjs`, which walks every table in `test-and-issues.md` and
exits non-zero on failure. `main/index.js` loads it only under `--uicheck`, which also
redirects `userData` to a temp directory — a run can never touch a real day log, and it
can run while the app is open. **Add a check there whenever a UI bug is fixed.**

For one-off investigation, the same mechanism inline is often faster than reasoning about
what the DOM probably does: a temporary env-gated block in `createWindow` that calls
`executeJavaScript`, reports what it found, and calls `app.exit(0)`. Remove it before
committing. `webContents.capturePage()` gives a screenshot, which is the quickest way to
settle a question about layout or colour.

Nine traps make checks pass or fail for the wrong reason. Every one cost real time before
it was understood, and all nine are restated in `scripts/ui-check.mjs`. The first four
produce wrong results:

1. **A timer stopped inside ten seconds is discarded on purpose.** Back-date the start
   first, or a merge check measures nothing at all and passes.
2. **Jira-side worklogs render as `.entry-card` too.** Scope to
   `.entry-card:not(.external)`, or every "nothing was created" assertion fails.
3. **Externals take part in overlap layout**, so a two-entry overlap can legitimately
   produce three columns.
4. **At 0.5× zoom a quarter hour is 11 px.** Assert that a drop landed where the *preview*
   said, not at an hour hard-coded in the test.

Five more, learned from flakes rather than from wrong results:

- **Selecting a day starts an async read of that day's Jira worklogs**, and the re-render
  when it lands replaces every row. A gesture begun before that settles has its element
  pulled out from under it and simply never starts. Wait for the row count to stop moving —
  and wait for it to hold still, because **one** stable sample arrives before the request
  has even answered. That single missing sample produced eight failures in one run and a
  different six in the next, all of them reading as "nothing was created".
- **A row grabbed before an `await` and pressed after it may be detached**, and a press on
  a detached node never reaches the delegated listener. `H.dragToHour` re-finds its row by
  `data-key` / `data-id` for exactly this reason.
- **A zoom change re-renders the grid behind an `await`.** Re-measure the hour line
  afterwards rather than trusting a coordinate read before the click.
- **The window has to be the foreground one.** A background or occluded window has its
  compositor frozen: a CSS transition stops half way, so a sidebar width reads as a number
  from nowhere, and `:focus` stops matching, so a key press dispatched at `:focus` throws.
  `main/index.js` calls `focus()` under `--uicheck`; prefer `document.activeElement` over
  `:focus` regardless, and do not click away mid-run.
- **The throwaway profile is keyed on the pid *and* a timestamp.** Windows recycles
  process ids and nothing deletes those directories, so a run could open one another
  run had left behind and inherit its settings — which is exactly how a check asserting
  the day-view text default failed against a profile still holding the previous
  default. A run that does not start from nothing is not repeatable.
- **An empty-state check cannot use today.** Clearing the store does not clear the day —
  time booked in the Jira web UI still renders. `H.findEmptyDay()` steps back until it
  finds a day with no rows of either kind, and skips rather than lying if there is none.
- **Every day change fires a Jira read**, so a check that steps through a week waits on
  the network far longer than on the DOM. `check()` names each check as it *starts* and
  gives it two minutes — a run that only prints at the end tells you nothing about where
  it wedged, and a tighter bound fails checks that are merely slow. `findEmptyDay`
  remembers how far back it went, because searching twice floods the request everything
  after it is queued behind.

### The hook, and why there are no sleeps left in the waiting

`webContents.executeJavaScript` returns a promise, so the page can hand back a promise
that settles when the work is actually done. `renderer/js/app.js` installs
`window.__jogglTest` for exactly that — three fields, renderer-local, **no IPC channel
and no preload change**, so the narrow allowlist is untouched:

| | |
|---|---|
| `whenIdle()` | settles when the Jira read in flight lands, at once if none is. `H.settle()` is one await of it, where it used to poll the DOM for 1.2 seconds minimum |
| `reloadDay()` | re-read the day log and repaint **without touching Jira** |
| `renders` | a counter, for the checks that care a repaint happened |

`reloadDay` exists because `loadDay` clears `state.externalEntries` on purpose — they
belong to the day being left. Reloading through the day picker would therefore wipe
every Jira-side row, and the checks that need one would lose their premise. Nothing in
a run writes to Jira, so the rows already on screen are still true.

Three things learned dragging this out of the harness:

1. **`reloadDay` is not `goToday`.** A blanket replacement of the old Today click
   silently measured the wrong day in three checks, because some of those clicks meant
   *navigate home* rather than *repaint*. `H.goToday()` is the one that costs a Jira
   read; `H.goDay()` waits for the label to actually change first, because `selectDate`
   reads the day log over IPC before it starts the fetch, so `whenIdle` alone can settle
   before there is anything in flight.
2. **`H.until` polls on a timer, not `requestAnimationFrame`.** rAF is driven by the
   compositor, which stops dead when the window is occluded or the display sleeps — so
   an rAF poll does not slow down, it hangs until its timeout. Trap 8 in another hat.
3. **The render counter cannot stand in for "the drop committed".** Returning from
   `dragToHour` on it was tried and reverted: the counter moves for any repaint at all,
   so a drop could be called done before it had. It saved five seconds of a hundred and
   cost ten checks. The sleeps after a drop are load-bearing.

What this cannot reach, and what therefore stays manual: anything crossing a process
restart, and anything that writes to Jira — **never run Finish Day against a live site
from a script.**

Timing out an Electron run does not kill it. `timeout … electron .` reaps the launcher,
leaves the app holding the single-instance lock, and every later launch then exits
silently. Stop stray processes before concluding anything about a failed start.

---

## Out of scope

Do not build these without being asked, even where they seem natural:

- Multi-account, multi-Jira-instance, or any shared/server-side state
- Sync between machines
- Pomodoro, calendar sync, CSV export, weekly summaries, colour coding, entry notes
- Idle detection (`powerMonitor.getSystemIdleTime()` exists — resist it for now)
- Any Super Productivity integration whatsoever

The old 100 KB plugin limit imposed useful discipline. Removing it is not permission to grow the feature set. The target is feature parity with the plugin, minus SP coupling, plus reliability and shareability. **Ship that, use it for a month, then decide what is actually missing.**
