# Joggl

A standalone Electron desktop time tracker with a Toggl-like timeline, which logs
worklogs directly to Jira Cloud.

Built because company policy requires worklog time on Jira tasks — including shared,
unassigned, never-"done" tasks such as a permanent `Meetings` issue. Tools that only
submit a worklog when a task is completed cannot cover that case.

Joggl is a single-user desktop app. Each person installs their own copy and configures
their own Jira credentials. There is no server and no shared state.

> **Status: in development.** This is a port of a working Super Productivity plugin
> into a standalone Electron app. Nothing is released yet.

---

## What it does

- **Live timer** with task search over configurable JQL queries
- **Day timeline** — hour grid, drag to move (15-minute snap), drag handles to resize
  with snapping to adjacent entries, overlapping entries laid out in side-by-side columns
- **Inline editing** of start / end / duration / title with bidirectional recalculation
- **Pinned tasks** — a local list of issue keys for one-click start
- **Finish Day** — stopping a timer never touches Jira; one explicit action submits the
  day's pending entries as worklogs, with a per-entry retry on partial failure

## What it deliberately does not do

No multi-account or multi-instance support, no sync between machines, no Pomodoro,
no calendar sync, no CSV export, no idle detection. Feature parity with the original
plugin plus reliability — nothing more, until it has been used for a while.

---

## Requirements

- Windows 11 (macOS builds are possible later but not set up)
- A Jira **Cloud** instance and an Atlassian API token

**Node does not need to be installed.** The launcher fetches a portable copy if it
does not find one. No Python, Rust, or C++ build toolchain is required either, and no
dependency that needs one will be added.

## Running it

Double-click **`run.cmd`**. On a machine with nothing set up it will:

1. use Node from `PATH` if there is one new enough, otherwise download a portable
   Node into `.node\` — a 30 MB download, verified against the SHA-256 published by
   nodejs.org, needing no administrator rights and touching nothing outside this
   folder;
2. `npm install` the dependencies, once;
3. start the app.

Closing that console window quits Joggl. Deleting `.node\` and `node_modules\` undoes
everything step 1 and 2 did.

From a terminal, once Node is available, the same thing:

```bash
npm start
```

Either way the window can be toggled with **Ctrl+Shift+J**, and closing the window
hides Joggl to the tray rather than quitting it — use **Quit** in the tray menu to
exit properly, so a running timer is not lost to a stray Alt+F4.

### Handing it to someone else

`run.cmd` is the low-ceremony route: no prerequisites, but it leaves a console window
open and costs about 400 MB of Node and dependencies per machine.

The better answer for colleagues is a real installer — one file, a Start-menu entry, no
console, no Node:

```bash
npm run dist
```

## Development

```bash
npm install
```

```bash
npm test
```

The tray and window icon is generated rather than committed as binary art:

```bash
npm run icon
```

### Skipping the setup wizard while developing

Copy `.joggl-dev.example.json` to `.joggl-dev.json`, fill in your own Jira site,
email and API token, and Joggl will seed them on every start instead of showing the
wizard. The file is git-ignored, is read **only** when the app is unpackaged, and its
token is immediately re-stored through `safeStorage` — the plaintext copy never leaves
your working directory. Point `JOGGL_DEV_CREDENTIALS` at another path to override it.

### Logs

Joggl writes a rolling log — `logs/joggl.log` next to the project in development,
`<userData>/logs/joggl.log` in an installed build. It captures startup details,
main-process errors, failed IPC calls, and renderer errors and warnings. API tokens
and auth headers are stripped before anything is written, so the file is safe to
send when reporting a problem. **Settings → Diagnostics → Open log folder**, or the
same entry in the tray menu, will find it. Set `JOGGL_LOG_DIR` to write elsewhere.

## Configuration

On first run a setup wizard asks for:

| Field | Notes |
|---|---|
| Base URL | e.g. `https://yourcompany.atlassian.net` |
| Email | your Atlassian account email |
| API token | create one at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

The API token is encrypted with Electron's `safeStorage` (DPAPI on Windows) and is never
exposed to the renderer process — not even on the settings screen. Task-source JQL
queries are configurable; nothing about any particular Jira instance is baked into the app.

## Architecture

```
main/       Node context — Jira HTTP, safeStorage, store, tray, window lifecycle
preload/    contextBridge only, explicit allowlist of IPC channels
renderer/   UI. No Node APIs, no direct network access.
```

The renderer never calls Jira. All Jira traffic goes through IPC to the main process,
which is also what keeps CORS out of the picture.

## License

[MIT](LICENSE)
