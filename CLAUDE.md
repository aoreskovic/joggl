# CLAUDE.md

Electron desktop time tracker, Toggl-like timeline, logs worklogs to Jira Cloud.
Single user per installation, own credentials, no shared state. Port of a Super
Productivity plugin; `legacy/` holds the old source — read-only reference, git-ignored,
never edited, never shipped.

Status: done and running against live Jira. 377 unit tests, 121 UI checks, version in
`package.json` (0.19.2).

---

## Layout

```
main/          Node. Jira HTTP, safeStorage, store, tray, window lifecycle.
preload/       contextBridge only. Named channels, explicit allowlist.
renderer/      UI. No Node APIs, no direct network.
test/          node --test
scripts/       ui-check.mjs, launch.ps1, make-icon.mjs
docs/          Joggl's own docs; docs/superpowers/{plans,specs}
```

Non-negotiable: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
Renderer never calls Jira and never sees the API token (settings gets back a boolean).
Never expose `ipcRenderer`.

### main/

| File | Holds |
|---|---|
| `index.js` | Window, tray, `--uicheck` (temp `userData`, `focus()`), `--uicheck-fast` |
| `ipc.js` | `CHANNELS`, `registerIpc`; picks `jira/client.js` or `jira/fake.js` in one line |
| `store.js` | Atomic writer (temp + rename), **one file per key** — `initStore/get/set/del` |
| `days.js` | `getDay/saveDay/getDays/getRunningTimer/saveRunningTimer`, `MAX_RANGE_DAYS` |
| `settings.js` | `DEFAULT_TASK_SOURCES`, settings / pins / UI prefs |
| `credentials.js` | `safeStorage` token: `saveToken/loadToken/hasToken/clearToken`, `assertEncryptionAvailable` |
| `dev-credentials.js` | `.joggl-dev.json` for dev runs |
| `log.js` | `logs/joggl.log`, `redact`, `info/warn/error` |
| `jira/client.js` | All network. `testConnection`, `searchIssues`, `lookupIssues`, `toSummaryTerm`, `buildLookupJql`, `submit/update/deleteWorklog`, `buildWorklogRangeJql`, `fetchRangeWorklogs` |
| `jira/fake.js` | Same exports, fixtures. Books 2 worklogs on today, none elsewhere |
| `jira/time.js` | `formatWorklogStarted`, `worklogSeconds`, `localDayKey` |
| `jira/adf.js` | `toAdfComment`, `emptyAdfComment`, `adfToText` |
| `jira/paging.js` | `collectPaged`, `DEFAULT_PAGE_LIMIT` |

### preload — `window.joggl`

`app.{version,openLogFolder,log}` · `settings.{get,save,clearToken,testConnection}` ·
`jira.{search,lookup,submitWorklog,updateWorklog,deleteWorklog,rangeWorklogs}` ·
`days.{get,save,getRange}` · `timer.{get,save}` · `pins.{get,save}` · `ui.{get,save}`.
Main answers `{ok,data}` / `{ok,error}`; preload unwraps to a thrown `Error` with
`status`/`name`.

### renderer/js/

| File | Holds |
|---|---|
| `app.js` | Wiring, boot, `window.__jogglTest` |
| `state.js` | `state`, day load/persist, IPC wrappers, `entriesFor/setEntriesFor/findEntry/visibleEntriesFor`, `invalidateExternal`, `loadDays`, `refreshExternal/refreshRange`, zoom levels |
| `day-range.js` | `installDayAccessors` (`state.entries` as live view), `eachDay`, `bucketByDay`, `externalToEntries`, `missingDays`, `locateEntry` |
| `day-writes.js` | `createDayWriter` — 500 ms debounce, day captured at edit time |
| `day-search.js` | `findLastDayWithEntries`, `MAX_LOOKBACK_DAYS` (30) |
| `timeline.js` | `renderTimeline`, `paintDayColumn`, `computeColumns`, quick entry, drop placeholder, now markers |
| `timeline-geometry.js` | `grid` (`startHour`), `rangeStartMs(day)`, `offsetPxOf(ts,day)`, `tsAtOffsetPx(px,day)`, `computeRange` |
| `timeline-columns.js` | `GUTTER_PX`, per-column registry, `placeBlock`, `columnAt` |
| `timeline-drag.js` | `onMoveBlock`, `onResize`, `isClickSuppressed` |
| `week-view.js` / `week-range.js` | Week view; ISO weeks, `weekStart/weekDays/isoWeek/weekLabel/visibleWeekDays` |
| `cross-day.js` / `cross-day-commit.js` | Drag between days |
| `entries.js` | "On this day" list, `deleteEntry/deleteSelection/duplicateEntry/editEntryTask/editEntryComment/splitEntry` |
| `entry-ops.js` | Pure entry maths: `duplicateOf`, `copiedToDay`, `sameTimes`, `movedEntry`, `dropEntryFor`, `flaggedOverlaps`, `planDeletion`, `canRetarget` |
| `merge.js` | `MERGE_GAP_MS`, `taskKeyOf`, `mergeableEntries`, `decideMerge`, `applyMerge` |
| `timer.js` | `startTimer/stopTimer/restoreTimer`, pending start ts |
| `finish-day.js` | `planFinishDay`, `runFinishDay`, `syncLabel`, `syncTooltip`, `nothingToSync`, `resetFailedForRetry` |
| `sync.js` | Button state, `finishDay`, `syncWeek` |
| `selection.js` / `selection-model.js` / `rubber-band.js` | Selection set, `applySelection`, band enclosure |
| `clipboard.js` | `clipboardFrom`, `pastePlan`, `daysBetween` |
| `copy-day.js` | `copyPreviousDay`, `clearDay`, `clearWeek`, `copySelection`, `pasteClipboard` |
| `keynav.js` | `createRowNav` (highlight in a search list), `wireRovingList` (roving tabindex) |
| `block-nav.js`, `click-actions.js`, `context-menu.js`, `modal.js`, `toast.js`, `date-picker.js`, `issue-picker.js`, `remote-lookup.js`, `drag-drop.js`, `pins.js`, `tasks.js`, `render.js`, `shell.js`, `settings-ui.js`, `help.js`, `icons.js`, `util.js` | As named |

`render.js` = `registerRenderer`/`renderAll`. `shell.js` = sidebar + view registry
(`registerView`, `setActiveView`, `notifyDayChange`). `help.js` = `SHORTCUTS` data +
panel. `icons.js` = SVG constants; **no emoji as icons** (only `📌` on an issue row).

---

## Domain model

```jsonc
// store key: "day:2026-07-28"
{
  "date": "2026-07-28",
  "entries": [{
    "id": "uuid",
    "issueKey": "PROJ-123",   // null for local-only
    "issueId": "10042",
    "title": "Meetings",
    "startTs": 1753689600000, // epoch ms
    "endTs": 1753693200000,   // null while running
    "status": "pending",      // pending | synced | error | local
    "worklogId": null,        // idempotency guard
    "comment": null,          // Work Description, plain text; ADF at the boundary
    "errorMsg": null
  }]
}
```

- One store key per day. Never all history in one key.
- `worklogId` is the guard: **never POST an entry that has one** — `PUT .../worklog/{id}`.
- `status: "local"` — no issueKey, never syncs, still counts toward the daily total.
- Persist on: stop, inline edit (500 ms debounce), merge, drag/resize commit.

### External worklogs

Time booked in the Jira web UI, read per day, **never persisted** — `state.external`
per-day session cache, merged at render via `state.externalEntries`. Read-only: no drag,
edit or delete; Finish Day ignores them. A Jira worklog whose id is on a local entry is
dropped. Anything that changes Jira for a day calls `invalidateExternal(dayKey)` first.
Drawn dashed/unfilled in `--external` cyan, labelled **Manual Jira entry**. They take
part in overlap layout but are never flagged.

---

## Domain rules

### Merge (repeated task activation)

- Gap ≤ 30 min → merge silently (`start` = earliest, `end` = current).
- Gap > 30 min → prompt `[Merge into one]` / `[Keep separate]`. Merging spans the gap.
- An entry **starting after the timer's start is never a candidate**, whatever the gap.
- The bound is fixed at start, carried on the timer as `mergeNotAfterTs` beside
  `mergeChoice`; never recomputed at stop (fall back to the entry's start if absent).
- Merging never absorbs a synced entry. Merging is always local.

### Sync

Button is **Sync** on today, **Re-sync** elsewhere. Module/functions keep the names
`finish-day` / `planFinishDay` / `runFinishDay`.

- Stopping a timer submits nothing — it writes a `pending` entry.
- Sync submits the selected day's `pending` entries sequentially; one with a `worklogId`
  is rewritten with `PUT`.
- No `issueKey` → marked `local`, does not block.
- Partial failure: successes keep `synced` + `worklogId`, failures get `error` + message.
  **No automatic retry** — summary with `Retry failed`.
- The label states the work: `Sync · 3 entries, 2h 15m`, or `Nothing to sync` (disabled).
  `syncLabel` counts **only what reaches Jira**; `syncTooltip` carries rewrites, already-
  synced and the excluded running timer.
- The timer runs only on the current day.

### Validation

- Overlaps allowed, rendered in columns, flagged (`flaggedOverlaps`, one counted line
  above the list). Jira-side rows take part but are never flagged.
- A **running timer's** start may not be in the future (constraint lives on the omnibar
  field). Hand-drawn entries may be in the future.
- `end < start` rejected inline, never via modal.
- A timer stopped inside 10 s is discarded.

### Selecting, copying, deleting

- Selection is a set, `state.selectedEntryIds`, marking both panels; not focus.
  Cleared by Escape, a click on empty space, a day change, or deletion.
- Band is **enclosure, not intersection**; refuses to start on a block; the click it
  produces is suppressed.
- Paste: earliest day in the selection is anchored on `state.selectedDate`, every offset
  kept in days and on the clock. Rebased via `copiedToDay` from local midnight; day
  arithmetic is `Math.round` (a day can be 25 h).
- **A click on empty grid marks the day; the popup is on the double click.** That single
  click is the only mouse way to say "paste here", and a popup on it swallowed the
  Ctrl+V that followed. `onGridClick` / `onGridDblClick`, day change injected via
  `registerGridDaySelect`. The marked column wears `is-anchor-day` — never `is-selected`,
  which means "this entry is selected" wherever it is queried.
- **Ctrl+drag drags ghosts, not the originals.** `ghostFor` clones each block at gesture
  start, the clone takes an id matching no entry plus `.ghost`, and no original moves —
  dragging the original told a move's story until the drop. Letting Ctrl go mid-drag
  cancels the whole gesture (read off `keyup`: a held-still drag must not wait for the
  next pixel). Ghosts are excluded from Ctrl+A, the band and the roving lists.
- **Ctrl+drag carries the whole selection** when the dragged block is in it, one ghost
  each. The dragged block is the anchor; the rest keep their offset from it in days and
  on the clock (`dragCopyPlacement`, the same rule as paste). Grabbing an unselected
  block copies that one alone and leaves the selection alone.
- **A Ctrl+drag that never moved is a Ctrl+click.** Committing a copy anyway — what it
  did before — meant the documented way to add a block to the selection duplicated it
  instead, the copy's re-render swallowing the click that would have toggled it. So
  `copyDrag` commits only when `moved`, and only then suppresses the click.
- `onMoveBlock` is a two-way switch: `moveDrag` or `copyDrag`, decided on Ctrl before
  the `locked` check — `locked` stops a *move*, and a copy never touches the original.
  A drag's copies are written like a paste: **every target day is read before it is
  merged into**, or an unloaded day gets overwritten with only the copies.
- **A copy carries no worklogId** — `duplicateOf` is the single rule for Ctrl+V,
  Ctrl+drag, Duplicate and Copy previous day. A copy of a Jira-side row becomes a normal
  entry.
- Batch delete offers to remove worklogs one at a time; an entry whose DELETE failed
  **stays**, carrying the error, with **Retry failed**. Jira-side rows are never deleted.
- `findEntry` searches every loaded day, not just the selected one.
- Retargeting and splitting a **synced** entry are refused (worklogId is only valid on
  its issue). Dragging a synced entry to another day is allowed → back to `pending`, `PUT`.

### Week view

- Five (Mon–Fri) or seven columns, each painted by `paintDayColumn`.
- Shared: one hour range (`computeRange` over all visible days), one zoom, one gutter
  **outside** the columns (week columns register gutter 0; day view uses `GUTTER_PX` 40).
- Not shared: `computeColumns` runs per day.
- ISO 8601 weeks; label shows the year only when the week-year differs.
- Five-day mode hides an **empty** weekend only — a Saturday holding any time, local or
  Jira-side, is drawn.
- The week shown is the week containing `state.selectedDate`; the stepper is
  `selectDate(addWeeks(anchor, ±1))`.
- The omnibar and pin bar are **moved** into `#week-topbar` on mount and put back on
  unmount — never copied (listeners are bound by id).

---

## Jira

Cloud only. Basic auth: email + API token, base64. All calls in the main process via
global `fetch`.

| Purpose | Endpoint |
|---|---|
| Connection test | `GET /rest/api/3/myself` |
| Issue search / free-text | `POST /rest/api/3/search/jql` (`summary ~ "term*"`) |
| Exact key | `GET /rest/api/3/issue/{key}` |
| Projects | `GET /rest/api/3/project/search` |
| Submit worklog | `POST /rest/api/3/issue/{idOrKey}/worklog` |
| Rewrite worklog | `PUT /rest/api/3/issue/{idOrKey}/worklog/{id}` |
| Delete worklog | `DELETE /rest/api/3/issue/{idOrKey}/worklog/{id}` |
| Read a day's worklogs | `GET /rest/api/3/issue/{key}/worklog?startedAfter=&startedBefore=` |

**Never use `/rest/api/3/issue/picker`** — it returns plausible garbage over an API token.

### Gotchas

1. `/rest/api/3/search` is **removed** (HTTP 410). Use `/rest/api/3/search/jql`.
2. `search/jql` defaults `fields` to `id` only — request
   `["summary","status","issuetype","project"]` explicitly.
3. Pagination is `nextPageToken`, not `startAt`. No reliable `total`
   (`POST /rest/api/3/search/approximate-count` if ever needed).
4. Worklog `started` must be `yyyy-MM-dd'T'HH:mm:ss.SSSZ`, numeric offset, no colon:
   `2026-07-28T09:00:00.000+0200` ✅ · `…Z` ❌ · `…+02:00` ❌. `toISOString()` is rejected.
   Use `formatWorklogStarted`.
5. Worklog `comment` is ADF, not a string (`main/jira/adf.js`; API v2 is not used).
   Joggl writes plain text — one paragraph, `hardBreak` between lines. `adfToText` walks
   the tree and ignores what it does not know. Omitted on **create** when empty, always
   sent on **update**.
6. `summary ~` takes a **Lucene** query — strip every operator character
   (`toSummaryTerm`); a hyphen is negation, an unbalanced bracket 400s the request.
7. Reading a day's worklogs is two steps: JQL
   (`worklogAuthor = currentUser() AND worklogDate = "…"`) then per-issue worklogs,
   bounded with `startedAfter`/`startedBefore` and filtered by `author.accountId`.

### Task sources

User-configurable in settings; **never hardcode project keys or filter IDs**. Defaults:

```
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC
worklogAuthor = currentUser() AND worklogDate >= -30d ORDER BY updated DESC
```

`recentIssues()` returns 0 issues over REST — do not use it. Pins are a local list of
issue keys in the store, not a Jira filter. Once local matches drop to ≤ 2 or the query
names a key, the search box also asks Jira and shows hits under **Elsewhere in Jira**
(debounced; a late answer for a superseded query is discarded). From two words up, a word
that is a project key becomes a project filter, not title text; project list cached per
base URL for the session.

### Credentials

`safeStorage.encryptString()`, buffer in the store. Never plaintext, never in the repo.
Only available after `app.whenReady()` — check `isEncryptionAvailable()` and fail loudly.
Base URL and email may be stored unencrypted.

---

## Keyboard

| Key | Where | What |
|---|---|---|
| `Ctrl+L` | anywhere | Focus the omnibar, select its text |
| `Ctrl+Enter` | anywhere | Start highlighted/typed issue; empty box resumes the day's last entry; while running, stop |
| `T` `[` `]` | not while typing | Today, previous day, next day |
| `PageUp/Down` | not while typing | A week; forward past today lands on today |
| `PageUp/Down` | in the calendar | A month |
| `↑` `↓` `Home` `End` | any list | Move the highlight, wrapping |
| `Ctrl+click` | row or block | Add to / remove from the selection |
| Drag on empty grid | either grid | Rubber band (enclosure) |
| `Ctrl+A` | not while typing | Select everything on screen except the running timer's block |
| `Ctrl+C` `Ctrl+V` | not while typing | Copy; paste onto the marked day keeping offsets |
| `Ctrl+drag` | a block | Copy rather than move — the whole selection if the block is in it |
| `Delete` | not while typing | Delete the selection; more than one asks first |
| `←` `→` | either grid | Between columns; `↑` `↓` within one, in time order |
| `Enter` | any list | Run the highlighted row, else that list's own Enter |
| `Enter`, `Shift+F10`, Menu | focused row | Its context menu (`anchorFor` anchors when the event has no coordinates) |
| `F1` | anywhere | Toggle Help |
| `Escape` | menu/dialog/panel | Close, restore focus; again drops the selection. Setup wizard excluded |
| `Tab` | in a dialog | Trapped by `modal.js` |

Bare-key shortcuts are suppressed while a modal is open and while the caret is in a field.
**Nothing is active until an arrow key is pressed** — `activate()` returns `null` until
then and callers fall back to what Enter already meant.
**A new binding means a new row in `SHORTCUTS`** (`renderer/js/help.js`); prose lives in
`index.html`.

## Clicking

| Where | Click | Double click |
|---|---|---|
| Issues row, pin chip | Start the timer | — |
| Either grid, empty hour | Mark that day (the paste target), selection cleared | Quick-entry popup |
| Day view, a block | Select | Work description |
| "On this day", task name or key | Select | Edit task |
| "On this day", elsewhere on the row | Select | Work description |
| Time fields, ▶, delete icon | Their own | Their own |
| Manual Jira entry | Select | Its refusal |

`click-actions.js` holds the one rule for which editor a double click opens.

- **Selecting must not re-render** — `selection.js` sets the class on the two elements
  directly; `applySelection()` runs at the end of both renders.
- **A completed move is not a click** — `onMoveBlock` records whether the start changed
  and suppresses the following click (module-level flag, because the commit re-renders).
  Its `preventDefault` on mousedown is why the click must call `focus()` itself.
- **Starting the timer on the task already running is a no-op** — guard compares
  `taskKeyOf`.

---

## Conventions

- Epoch ms internally; convert to local wall clock only at render and Jira boundaries.
- All network in one main-process module. Keep the main process thin.
- Errors inline or via toast. Modals are for decisions only.
- **Bump the version on every commit**: `npm run bump` (minor) for a change,
  `npm run bump:fix` (patch) for a fix to a change.
- **Touching an entry is not editing it** — compare times first (`sameTimes`) before
  marking an entry as needing re-sync.
- **A render must never start a lookup** — trigger from the event that changed state;
  `createRemoteLookup` never calls back synchronously.
- **A write names its day; a render reads the day on screen.** Capture
  `const day = state.selectedDate` before the first `await`, then use
  `entriesFor(day)` / `setEntriesFor(day, …)` / `persistDayNow(day)`. Same rule in
  `day-writes.js`. Every day read (`loadDay`, `readDay`, `loadDays`) flushes the write
  queue first; a failed flush is reported and let go, never propagated.
- **A day's bounds are `addDays`**, never `+ 86_400_000` — a day can be 25 hours.
- Day keys are **local** dates (`dateKey`), never `toISOString().slice(0,10)`.
- Snapping is to the **clock** (from local midnight), not to the drag offset.
- The calendar only looks backwards; future cells are disabled and cursor moves clamped.
- An empty state names the gesture; a day holding only Jira rows is not empty.
- Day view text: `FONT_SIZES` 10/12/14/16, default 12; a stored size snaps via
  `nearestFontSize`. Hour gutter follows one step behind, capped at 12 px (gutter is
  40 px, pinned in `GUTTER_PX` and `left: 40px`).
- Context-menu items carry `icon` (text glyph, escaped) or `svg` (our constant, not
  escaped) — separate fields on purpose.

---

## Tests

```bash
npm test           # node --test, test/**/*.test.js
npm run uicheck    # live Jira — must pass before a commit
npm run uicheck:fast   # main/jira/fake.js, no network, no credentials
```

Both modes **must report the same counts**. `scripts/ui-check.mjs` walks every table in
`test-and-issues.md` and exits non-zero on failure; `main/index.js` loads it only under
`--uicheck`, which redirects `userData` to a temp dir keyed on pid + timestamp.
**Add a check whenever a UI bug is fixed.**

Must-have unit coverage: worklog timestamp formatter, merge at the 30-minute boundary,
Finish Day partial failure, day log persist/reload round trip.

### The hook

`renderer/js/app.js` installs `window.__jogglTest` (renderer-local, no IPC, no preload
change): `whenIdle()` settles when the in-flight Jira read lands; `reloadDay()` re-reads
the day log and repaints **without touching Jira**; `renders` is a counter.
`H.goToday()` costs a Jira read; `H.goDay()` waits for the label to change first;
`H.until` polls on a timer, never rAF.

### Traps

1. A timer stopped inside 10 s is discarded — back-date the start.
2. Jira-side worklogs render as `.entry-card` too — scope to `.entry-card:not(.external)`.
3. Externals take part in overlap layout — two entries can legitimately make 3 columns.
4. At 0.5× zoom a quarter hour is 11 px — assert against the preview, not a hard-coded hour.
5. Selecting a day starts an async Jira read that replaces every row — wait for the row
   count to hold still (one stable sample arrives too early).
6. A node grabbed before an `await` may be detached — re-find by `data-key` / `data-id`.
7. A zoom change re-renders behind an `await` — re-measure.
8. The window must be foreground (occluded = frozen compositor, broken transitions and
   `:focus`); prefer `document.activeElement`.
9. An empty-state check cannot use today — `H.findEmptyDay()`, which remembers how far
   back it went.
10. The render counter is not "the drop committed" — the sleeps after a drop are
    load-bearing.

Out of reach for scripts: anything crossing a process restart, and anything that writes
to Jira — **never run Finish Day against a live site from a script**.
`timeout … electron .` does not kill the app; it keeps the single-instance lock and every
later launch exits silently. Kill stray processes before concluding a start failed.

---

## Environment

Windows 11, PowerShell + Git Bash. Root `F:\Code\Joggl`, repo
`git@github.com:aoreskovic/joggl.git`. Node 22+, npm, Git on PATH — **do not probe**.
**Not installed and not needed: Python, Rust, MSVC / C++ build tools** — never propose a
dependency needing `node-gyp`.

Dependencies: `electron`, `electron-builder`. No `electron-store` (own atomic writer).
Keep the list short.

**Shell policy:** file tools (Read/Write/Edit/Glob/Grep) for all file work. Shell is for
`npm` and `git` only. Never run detection commands, never install anything.

Distribution: `run.cmd` → `scripts/launch.ps1` (portable Node into `.node\`, SHA-256
checked, no admin rights); `npm run dist` builds the NSIS installer. First-run setup
wizard with `Test connection`. Actionable error messages. **No baked-in configuration** —
no URLs, project keys or filters.

---

## Next

1. **Month view** — calendar grid with hours per day, day view beside it.
2. **Tray icon states** — show whether a timer is running.
3. **Global start/stop shortcut** — needs a main↔renderer signal that does not exist.
4. **Working-week setting** — weekend tint is hardcoded to Sat/Sun.
5. Splitting / retargeting a synced entry (both currently refused).
6. macOS build (GitHub Actions, macOS runner, no code changes).
7. Auto-update — not worth it for ~10 users.

## Out of scope

Do not build without being asked: multi-account or multi-instance, any shared/server-side
state, sync between machines, Pomodoro, calendar sync, CSV export, weekly summaries,
colour coding, entry notes, idle detection, any Super Productivity integration.
