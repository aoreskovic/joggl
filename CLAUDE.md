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
  by the entry list and the day view
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
| Jira client | `myself`, `search/jql` with `nextPageToken`, worklog create / update / delete / read |
| Setup wizard | First run, with a working `Test connection` |
| Timer, merge, day view | Ported, including overlap columns, drag, resize, split |
| Finish Day | Confirmed against real Jira — worklog `60504` on `EHW-70` |
| Jira-side worklogs | Time logged in the Jira web UI is read back and counted |
| Logging | `logs/joggl.log`, credential-redacted |
| Tests | 65 passing, `npm test` |

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

3. **No worklog `comment`.** The plugin sent `comment: title` as a string, which v3
   rejects — it wants ADF. Nothing is sent, per gotcha 5.

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

### Next, roughly in order

1. **Tray icon states** — the icon should show at a glance whether a timer is running.
   Right now the only signal is opening the window.
2. **Keyboard-first start/stop** — a global shortcut exists for showing the window;
   starting the last task without touching the mouse is the obvious next one.
3. **Pagination for busy issues** — `fetchDayWorklogs` asks for `maxResults=200` per
   issue and does not follow `startAt`. Fine at present volumes, wrong eventually.
4. **Splitting a synced entry** — currently refused. It needs one worklog updated and
   one created, with a partial-failure story; worth doing only if it is actually missed.
5. **macOS build** — a GitHub Actions job with a macOS runner, no code changes.
6. **Auto-update** — still not worth it for ten users. Revisit if handing out installers
   becomes the annoying part.

Deliberately **not** planned: everything under *Out of scope* at the end of this file.
The discipline the 100 KB limit used to impose now has to come from that list.

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
live only in `state.externalEntries` and are merged in at render time, so a stale copy
can never end up in a day log. They are read-only: no drag, no edit, no delete, and
Finish Day does not see them. A Jira worklog whose id already appears on a local entry
is dropped, so Joggl's own synced entries are not shown twice.

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

Merging is always local. Nothing reaches Jira until Finish Day.

### Finish Day

- Stopping a timer **never** submits anything. It writes a `pending` entry locally.
- **Finish Day** submits all `pending` entries for the selected day, sequentially.
  An entry that carries a `worklogId` is an edit of something already synced, and is
  rewritten in place rather than posted again.
- Entries without an `issueKey` are marked `local` and do not block the day from finishing.
- On partial failure: successful entries keep `synced` and their `worklogId`; failures get `error` plus a message. **No automatic retry.** Show a summary with a `Retry failed` button.
- Past days: the button becomes **Re-sync Day**, submitting only non-synced entries.
- The timer runs only on the current day.

### Validation

- Overlapping entries are permitted (the timeline renders them in overlap columns) but flagged visually — usually a mistake.
- Start time may not be in the future.
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

**5. Worklog `comment` in API v3 is Atlassian Document Format, not a string.** Not needed for v1. If comments are added later, either build ADF or use `/rest/api/2/` for that one call, which accepts plain text.

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
| Node.js LTS + npm | Node 22 |
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

### Tests

Full UI coverage is not the goal. These four need real tests, because a silent failure means lost and unrecoverable time data:

1. Worklog timestamp formatter (gotcha 4)
2. Merge decision logic at the 30-minute boundary
3. Finish Day partial-failure state transitions
4. Day log persist / reload round trip

---

## Out of scope

Do not build these without being asked, even where they seem natural:

- Multi-account, multi-Jira-instance, or any shared/server-side state
- Sync between machines
- Pomodoro, calendar sync, CSV export, weekly summaries, colour coding, entry notes
- Idle detection (`powerMonitor.getSystemIdleTime()` exists — resist it for now)
- Any Super Productivity integration whatsoever

The old 100 KB plugin limit imposed useful discipline. Removing it is not permission to grow the feature set. The target is feature parity with the plugin, minus SP coupling, plus reliability and shareability. **Ship that, use it for a month, then decide what is actually missing.**
