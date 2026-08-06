// Boot and wiring. Everything stateful lives in its own module; this file only
// connects the DOM to it.

import { hideContextMenu, setContextActions } from './context-menu.js';
import { clearDay, copyPreviousDay } from './copy-day.js';
import { pickDate } from './date-picker.js';
import { wireDayViewDrag } from './drag-drop.js';
import {
  deleteEntry,
  duplicateEntry,
  editEntryComment,
  editEntryTask,
  renderEntryList,
  splitEntry,
  wireEntryList,
  updateTotal,
} from './entries.js';
import { closeHelp, toggleHelp, wireHelp } from './help.js';
import { PLAY_ICON, STOP_ICON, ZOOM_ICON } from './icons.js';
import { createRowNav } from './keynav.js';
import { isPinned, renderPins, togglePin } from './pins.js';
import { registerRenderer, renderAll } from './render.js';
import { clearSelection } from './selection.js';
import { hasView, notifyDayChange, registerView, setActiveView, wireShell } from './shell.js';
import {
  appVersion,
  externalPending,
  invalidateExternal,
  isToday,
  jiraReads,
  loadDay,
  loadPins,
  loadSettings,
  loadTimer,
  loadUi,
  logToFile,
  persistTimer,
  refreshExternal,
  saveUi,
  setEntriesFor,
  state,
  ZOOM_LEVELS,
} from './state.js';
import {
  applyFontSize,
  applyTheme,
  applyWeekendTint,
  closeSettings,
  needsSetup,
  openSetup,
  wireSettings,
  wireSetup,
} from './settings-ui.js';
import { finishDay, updateFinishButton } from './sync.js';
import { createIssueLookup, loadIssues, renderTaskList, searchIssues } from './tasks.js';
import {
  hideQuickEntry,
  onGridClick,
  renderTimeline,
  scrollToNow,
  updateNowMarkers,
} from './timeline.js';
import {
  getPendingStartTs,
  onTick,
  restoreTimer,
  setPendingStartTs,
  startTimer,
  stopTimer,
} from './timer.js';
import { toastWarn } from './toast.js';
import {
  addDays,
  debounce,
  esc,
  extractIssueKey,
  formatDateLabel,
  hhmmToTs,
  stripTrailingKey,
  todayKey,
  tsToHHMM,
} from './util.js';
import { registerWeekView, renderWeek, updateWeekLive, wireWeekControls } from './week-view.js';

const $ = (id) => document.getElementById(id);

/** At or below this many results, summaries are shown in full instead of clipped. */
const EXPAND_TITLES_AT = 2;

// A picked issue survives further typing in the box; typing again clears it.
let pickedIssue = null;

async function boot() {
  await Promise.all([loadSettings(), loadUi(), loadPins()]);

  applyTheme(state.ui.theme);
  applyFontSize(state.ui.fontSize);
  $('right-panel').style.width = `${state.ui.panelWidth}px`;
  updateZoomLabel();

  wireShell();
  registerView('day', {
    mount() {
      $('view-day').hidden = false;
    },
    unmount() {
      $('view-day').hidden = true;
    },
    // Time booked straight into Jira belongs in this day's total too. Fired after
    // the first paint, and never allowed to break the local view if Jira is down.
    onDayChange(date) {
      return refreshExternal(date);
    },
  });
  registerWeekView({ selectDate });
  // Restored now that there is more than one view to restore. Month is still not
  // registered, and a stored preference naming it would leave a blank app.
  setActiveView(hasView(state.ui.activeView) ? state.ui.activeView : 'day');

  registerRenderer(renderEntryList);
  registerRenderer(renderTimeline);
  registerRenderer(renderWeek);
  registerRenderer(renderTaskList);
  registerRenderer(renderPins);
  registerRenderer(updateTotal);
  registerRenderer(updateTimerUi);
  registerRenderer(updateFinishButton);

  setContextActions({
    editTask: (entry) => editEntryTask(entry.id),
    editComment: (entry) => editEntryComment(entry.id),
    restart: (entry) =>
      startTimer({ issueKey: entry.issueKey, issueId: entry.issueId, title: entry.title }),
    duplicate: (entry) => duplicateEntry(entry.id),
    split: (entry) => splitEntry(entry.id),
    remove: (entry) => deleteEntry(entry.id),
  });

  wireSetup();
  wireSettings();
  wireOmnibar();
  wireDayPanel();
  wireDayNav();
  wireDayView();
  wireWeekControls({ onZoom: (step) => changeZoom(step) });
  wireDayViewDrag();
  wireEntryList();
  wireHelp();
  wirePinPicker();
  wireGlobal();
  installTestHook();

  await selectDate(todayKey());
  await restoreTimer(await loadTimer());

  onTick(() => {
    updateTotal();
    updateWeekLive();
    updateNowMarkers();
  });

  renderAll();
  setTimeout(scrollToNow, 150);

  appVersion()
    .then(({ version, electron, logPath }) => {
      $('version-label').textContent = `Joggl ${version} · Electron ${electron}`;
      $('log-path-hint').textContent = logPath
        ? `Joggl writes a log to ${logPath}. Send it along when reporting a problem — ` +
          'credentials are stripped out before anything is written.'
        : 'No log file is being written.';
    })
    .catch(() => {});

  if (needsSetup()) openSetup();
  else await loadIssues();
}

/**
 * A handle for `npm run uicheck`, and for nothing else.
 *
 * The harness drives the app through `webContents.executeJavaScript`, and with no
 * signal for "the work finished", every wait it made was a fixed sleep sized for the
 * worst case — which is where five and a half minutes of a twenty-minute run went.
 *
 * Four fields, no IPC and no preload change: this is renderer-local, and the harness
 * already runs arbitrary JS here, so the narrow allowlist in `CLAUDE.md` is untouched.
 */
function installTestHook() {
  window.__jogglTest = {
    /** Bumped on every repaint, for the checks that care that one happened. */
    renders: 0,

    /** Settles exactly when the Jira read in flight lands, or at once if none is. */
    whenIdle: () => externalPending ?? Promise.resolve(),

    /**
     * Re-read the day log and repaint, **without** touching Jira.
     *
     * Deliberately not `selectDate`. That is a day *change*: it clears the selection
     * and asks for the day's Jira-side rows, and while the per-day cache usually
     * answers that without a request, "usually" is not a property a harness called a
     * hundred times a run should rest on. This never touches Jira by construction.
     * Nothing in a run writes to Jira, so the rows already on screen are still true.
     */
    async reloadDay() {
      const key = state.selectedDate;
      const day = await window.joggl.days.get(key);
      setEntriesFor(key, day.entries);
      renderAll();
    },

    /**
     * How many live `rangeWorklogs` requests `loadExternalWorklogs` has made, total.
     *
     * A getter rather than a copied number: `jiraReads` is a live import binding from
     * `state.js`, and a plain property here would have frozen it at zero. It is what
     * lets a check prove a day's Jira-side rows came back from cache on a return
     * visit rather than merely arriving fast — counting is the only way to tell the
     * two apart, since both look the same on screen.
     */
    get jiraReads() {
      return jiraReads;
    },
  };
  registerRenderer(() => {
    window.__jogglTest.renders++;
  });
}

// ── Day selection ──────────────────────────────────────────────────────────

async function selectDate(date) {
  // The selected entry belongs to the day being left, and its id would otherwise
  // sit in state waiting to match something on a day it was never on.
  clearSelection();
  await loadDay(date);

  $('current-date-label').textContent = formatDateLabel(date);
  $('next-day').disabled = date >= todayKey();

  const today = isToday();
  $('task-input').disabled = !today;
  $('start-time-input').disabled = !today;
  $('start-stop-btn').disabled = !today;

  // A property of the day now on screen, so it belongs here rather than in a render.
  applyWeekendTint();

  renderAll();

  // Which days have to be read depends on the view: one for the day view, the whole
  // week for the week view. Asked of the view rather than branched on here, so this
  // function does not learn about a view every time one is added.
  notifyDayChange(date);
}

/**
 * "On this day" collapses like the issue sources do, and stays that way across
 * restarts — someone who works from the day view alone should not have to close
 * it every morning.
 */
function wireDayPanel() {
  const header = $('day-panel-hdr');
  const list = $('entry-list');

  const apply = (collapsed) => {
    list.hidden = collapsed;
    $('day-panel-chevron').innerHTML = collapsed ? '&#9654;' : '&#9660;';
    header.setAttribute('aria-expanded', String(!collapsed));
  };

  apply(Boolean(state.ui.dayPanelCollapsed));

  const toggle = async () => {
    const collapsed = !list.hidden;
    apply(collapsed);
    await saveUi({ dayPanelCollapsed: collapsed });
  };

  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });

  // Both actions live inside a header that is itself a toggle, so their clicks and
  // their Enter have to stop there — otherwise copying a day also collapses the
  // panel showing what was copied.
  for (const [id, run] of [
    ['copy-day-btn', copyPreviousDay],
    ['clear-day-btn', clearDay],
  ]) {
    const button = $(id);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      run();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
  }
}

function wireDayNav() {
  $('prev-day').addEventListener('click', () => selectDate(addDays(state.selectedDate, -1)));
  $('next-day').addEventListener('click', () => {
    if (state.selectedDate < todayKey()) selectDate(addDays(state.selectedDate, 1));
  });
  $('today-btn').addEventListener('click', () => selectDate(todayKey()));
  $('current-date-label').addEventListener('click', async () => {
    const picked = await pickDate(state.selectedDate);
    if (picked && picked !== state.selectedDate) selectDate(picked);
  });
  $('finish-day-btn').addEventListener('click', async () => {
    // Read before the await, not after. A sync takes seconds, nothing suppresses the
    // bare `[` and `]` day shortcuts while it runs, and re-reading afterwards would
    // invalidate whichever day the user had stepped to — leaving the day that was
    // actually synced holding its pre-sync cache.
    const day = state.selectedDate;
    await finishDay();
    // Newly created worklogs are now claimed by local entries; re-reading keeps
    // the two views from disagreeing about what is in Jira. The cached rows are
    // stale by definition here — Finish Day is the one thing that changes them.
    invalidateExternal(day);
    await refreshExternal(day);
  });
  $('refresh-tasks-btn').addEventListener('click', async () => {
    // Pressing ↻ Refresh is the user saying "I know something changed", which is the
    // one thing the per-day cache cannot know. Without dropping the day first,
    // `refreshExternal` answers from that cache and the only button labelled
    // "Reload from Jira" never reaches Jira at all — leaving time booked in the web
    // UI invisible until a restart.
    invalidateExternal(state.selectedDate);
    await Promise.allSettled([loadIssues(), refreshExternal()]);
  });
}

// ── Omnibar ────────────────────────────────────────────────────────────────

function updateTimerUi() {
  const input = $('task-input');
  const startInput = $('start-time-input');
  const button = $('start-stop-btn');
  const display = $('timer-display');
  const running = Boolean(state.timer);

  button.innerHTML = running ? `${STOP_ICON}Stop` : `${PLAY_ICON}Start`;
  // btn-stop only recolours. Swapping btn-primary out with it stripped the
  // radius, padding and weight, leaving a small sharp-edged red button.
  button.classList.add('btn-primary');
  button.classList.toggle('btn-stop', running);
  display.classList.toggle('running', running);

  if (running) {
    input.value = state.timer.title + (state.timer.issueKey ? ` (${state.timer.issueKey})` : '');
    startInput.value = tsToHHMM(state.timer.startTs);
  } else if (document.activeElement !== input) {
    input.value = '';
    startInput.value = getPendingStartTs() ? tsToHHMM(getPendingStartTs()) : '';
  }

  $('conn-label').textContent = state.settings.tokenConfigured
    ? state.settings.baseUrl.replace(/^https?:\/\//, '')
    : 'Not connected to Jira';
}

function wireOmnibar() {
  const input = $('task-input');
  const dropdown = $('task-dropdown');

  // Results from Jira for a query that is still on screen.
  const nav = createRowNav({ container: () => dropdown, rowSelector: '.task-dd-item' });

  let remote = { query: '', issues: [] };
  const lookupRemote = createIssueLookup((query, issues) => {
    remote = { query, issues };
    if (document.activeElement === input) showDropdown();
  });

  const pick = (issue) => {
    pickedIssue = issue;
    input.value = `${issue.title} (${issue.issueKey})`;
    dropdown.classList.add('hidden');
  };

  const issueRow = (issue, expanded) => {
    const item = document.createElement('div');
    item.className = 'task-dd-item';
    item.dataset.issue = JSON.stringify(issue);
    item.innerHTML =
      `<span class="jira-chip">${esc(issue.issueKey)}</span>` +
      `<span class="task-dd-title">${esc(issue.title)}</span>` +
      (expanded && issue.status ? `<span class="task-dd-meta">${esc(issue.status)}</span>` : '');
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      pick(issue);
    });
    return item;
  };

  // Renders only. Asking Jira from in here is what closed the loop that blew the
  // stack — the lookup's callback re-enters this function.
  const showDropdown = () => {
    const query = input.value.trim();
    const local = searchIssues(input.value);
    const fromJira = remote.query === query ? remote.issues : [];

    // Once the list is down to a couple of candidates there is room to show the
    // whole summary. Truncating "Axiom Water Bottle Mechanical De…" is only
    // tolerable while it is one of fifteen rows being scanned at a glance.
    const expanded = local.length + fromJira.length <= EXPAND_TITLES_AT;
    dropdown.classList.toggle('expanded', expanded);

    const children = local.map((issue) => issueRow(issue, expanded));

    if (fromJira.length > 0) {
      const separator = document.createElement('div');
      separator.className = 'task-dd-sep';
      separator.textContent = 'Elsewhere in Jira';
      children.push(separator, ...fromJira.map((issue) => issueRow(issue, expanded)));
    }

    if (children.length === 0) {
      // Say what Enter will do rather than just vanishing.
      if (!query) {
        dropdown.classList.add('hidden');
        return;
      }
      const key = extractIssueKey(query);
      const hint = document.createElement('div');
      hint.className = 'task-dd-empty';
      hint.textContent = key
        ? `No issue found for ${key}. Enter starts a timer on it anyway.`
        : `Nothing matches “${query}”. Enter tracks it as a local entry, which counts ` +
          'towards the day but never syncs to Jira.';
      children.push(hint);
    }

    dropdown.replaceChildren(...children);
    dropdown.classList.remove('hidden');
    nav.reset();
  };

  // The one place a lookup is started: from what the user did, not from a render.
  const refreshDropdown = () => {
    lookupRemote(input.value.trim(), searchIssues(input.value).length);
    showDropdown();
  };

  input.addEventListener('input', () => {
    pickedIssue = null;
    refreshDropdown();
  });
  input.addEventListener('focus', () => {
    if (!state.timer) refreshDropdown();
  });
  input.addEventListener('keydown', (event) => {
    // Arrow keys walk the results instead of the caret walking the text.
    if (!dropdown.classList.contains('hidden') && nav.handleKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      // An arrow-key row is a choice; Enter then starts the timer on it directly
      // rather than filling the box and making the user press Enter again.
      const chosen = nav.activate();
      if (chosen) {
        event.preventDefault();
        pick(JSON.parse(chosen.dataset.issue));
        $('start-stop-btn').click();
        return;
      }
      dropdown.classList.add('hidden');
      $('start-stop-btn').click();
    }
    if (event.key === 'Escape') dropdown.classList.add('hidden');
  });

  const startInput = $('start-time-input');
  startInput.addEventListener('blur', async () => {
    const ts = hhmmToTs(startInput.value, state.selectedDate);
    if (state.timer) {
      if (ts !== null && ts <= Date.now()) {
        state.timer.startTs = ts;
        // CLAUDE.md: a crash must never cost more than the current minute. Without
        // this, a corrected start only lived in memory — a crash right after would
        // restore the timer at its original start, and the entry written on stop
        // would over-book. mergeNotAfterTs is deliberately left untouched here; it
        // is fixed at the moment the timer started so editing the start afterwards
        // cannot change what stop is allowed to absorb — see merge.js.
        await persistTimer();
        renderAll();
      } else {
        startInput.value = tsToHHMM(state.timer.startTs);
        if (ts !== null) toastWarn('Start time cannot be in the future.');
      }
      return;
    }
    if (ts === null) {
      startInput.value = '';
      setPendingStartTs(null);
    } else if (ts > Date.now()) {
      startInput.value = '';
      setPendingStartTs(null);
      toastWarn('Start time cannot be in the future.');
    } else {
      setPendingStartTs(ts);
    }
  });
  startInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startInput.blur();
    if (event.key === 'Escape') {
      startInput.value = state.timer ? tsToHHMM(state.timer.startTs) : '';
      startInput.blur();
    }
  });

  $('start-stop-btn').addEventListener('click', async () => {
    if (state.timer) {
      await stopTimer();
      return;
    }
    if (!isToday()) return;

    if (pickedIssue) {
      await startTimer({
        issueKey: pickedIssue.issueKey,
        issueId: pickedIssue.issueId,
        title: pickedIssue.title,
      });
      pickedIssue = null;
      return;
    }

    const raw = input.value.trim();
    if (!raw) {
      toastWarn('Type an issue or a name for the entry first.');
      return;
    }
    // Free text: a trailing (PROJ-123) makes it a Jira entry, anything else is local.
    const issueKey = extractIssueKey(raw);
    await startTimer({
      issueKey,
      issueId: null,
      title: issueKey ? stripTrailingKey(raw) || issueKey : raw,
    });
  });
}

// ── Day view controls ──────────────────────────────────────────────────────

function updateZoomLabel() {
  const label = `${ZOOM_LEVELS[state.ui.zoomIdx] ?? 1}×`;
  $('zoom-lbl').textContent = label;
  $('week-zoom-lbl').textContent = label;
}

/** One zoom for both views: the week is as tall as the day at the same setting. */
async function changeZoom(step) {
  const next = state.ui.zoomIdx + step;
  if (next < 0 || next > ZOOM_LEVELS.length - 1) return;
  await saveUi({ zoomIdx: next });
  updateZoomLabel();
  renderAll();
}

function wireDayView() {
  $('zoom-icon').innerHTML = ZOOM_ICON;
  $('week-zoom-icon').innerHTML = ZOOM_ICON;

  $('zoom-in').addEventListener('click', () => changeZoom(1));
  $('zoom-out').addEventListener('click', () => changeZoom(-1));

  $('schedule-grid').addEventListener('click', onGridClick);

  const handle = $('sched-resize-handle');
  const panel = $('right-panel');
  const persistWidth = debounce((width) => saveUi({ panelWidth: width }), 300);

  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.offsetWidth;
    handle.classList.add('resizing');

    const onMouseMove = (move) => {
      const width = Math.max(200, Math.min(640, startWidth - (move.clientX - startX)));
      panel.style.width = `${width}px`;
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      handle.classList.remove('resizing');
      persistWidth(panel.offsetWidth);
      renderTimeline();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// ── Pin picker ─────────────────────────────────────────────────────────────

function wirePinPicker() {
  const overlay = $('pin-overlay');
  const input = $('pin-search-input');
  const results = $('pin-results');
  const nav = createRowNav({ container: () => results, rowSelector: '.task-dd-item' });

  const render = () => {
    // Every render replaces the rows, so a highlight held over from the last one
    // would point at a node that is gone.
    nav.reset();
    const matches = searchIssues(input.value);
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-note';
      empty.textContent = state.issues.length
        ? 'No issues matched.'
        : 'No issues loaded yet — check your task sources in Settings.';
      results.replaceChildren(empty);
      return;
    }
    results.replaceChildren(
      ...matches.map((issue) => {
        const row = document.createElement('div');
        row.className = 'task-dd-item';
        row.innerHTML =
          `<span class="jira-chip">${esc(issue.issueKey)}</span>` +
          `<span class="task-dd-title">${esc(issue.title)}</span>`;

        const button = document.createElement('button');
        button.className = 'btn-outline';
        button.textContent = isPinned(issue.issueKey) ? 'Unpin' : 'Pin';
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          await togglePin(issue);
          render();
          renderPins();
        });
        row.appendChild(button);
        return row;
      }),
    );
  };

  $('add-pin-btn').addEventListener('click', () => {
    input.value = '';
    render();
    overlay.classList.remove('hidden');
    input.focus();
  });
  $('close-pin').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.classList.add('hidden');
  });
  input.addEventListener('input', render);

  input.addEventListener('keydown', (event) => {
    if (nav.handleKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter') return;
    // Enter pins the highlighted row through its own button, so pinning and
    // unpinning stay one code path however they were reached.
    const row = nav.activate();
    if (!row) return;
    event.preventDefault();
    row.querySelector('button')?.click();
  });
}

/**
 * What Ctrl+Enter does.
 *
 * Running: stop, which needs no target. Idle with something typed or picked: the
 * button already knows what to do. Idle with an empty box: resume the day's most
 * recent entry, because "start the last thing again" is the whole point of a
 * keyboard shortcut for a timer — otherwise it would only ever be able to stop.
 */
function resumeOrToggleTimer() {
  const input = $('task-input');
  if (state.timer || input.value.trim() || !isToday()) {
    $('start-stop-btn').click();
    return;
  }

  const last = [...state.entries]
    .filter((e) => !e.external && e.endTs !== null)
    .sort((a, b) => b.endTs - a.endTs)[0];

  if (!last) {
    toastWarn('Nothing to resume yet. Ctrl+L to search for an issue.');
    return;
  }
  startTimer({ issueKey: last.issueKey, issueId: last.issueId, title: last.title });
}

// ── Global ─────────────────────────────────────────────────────────────────

function wireGlobal() {
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.task-search-wrap')) $('task-dropdown').classList.add('hidden');
    if (!event.target.closest('.ctx-menu')) hideContextMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'F1') {
      event.preventDefault();
      toggleHelp();
      return;
    }

    if (event.key === 'Escape') {
      // Read before closing anything: one Escape closes whatever is open, and only
      // a second one puts the selection down. Doing both at once would clear a
      // selection the user was only dismissing a menu over.
      //
      // The setup wizard is deliberately not in this list: on a first run there is
      // no app behind it to go back to.
      const somethingOpen = !!document.querySelector(
        '.ctx-menu:not(.hidden), .sched-quick-entry, #modal-overlay:not(.hidden), ' +
          '#help-overlay:not(.hidden), #settings-overlay:not(.hidden), #pin-overlay:not(.hidden)',
      );
      hideContextMenu();
      hideQuickEntry();
      closeHelp();
      closeSettings();
      $('pin-overlay').classList.add('hidden');
      if (!somethingOpen) clearSelection();
      return;
    }

    // Shortcuts are suppressed while a modal is up — it owns the keyboard, and
    // starting a timer from behind a dialog would be a surprise.
    if (!$('modal-overlay').classList.contains('hidden')) return;

    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');

    // Ctrl+L for the omnibar, the same key every address bar uses.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      const input = $('task-input');
      if (!input.disabled) {
        input.focus();
        input.select();
      }
      return;
    }

    // Ctrl+Enter starts or stops the timer from anywhere, so a day can be tracked
    // without reaching for the mouse. Plain Enter is left alone: it belongs to
    // whatever has focus.
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      resumeOrToggleTimer();
      return;
    }

    // Bare keys only when not typing, or they would land in the text.
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'PageUp' || event.key === 'PageDown') {
      // A week, since [ and ] already do a day and the date label does a month.
      event.preventDefault();
      const target = addDays(state.selectedDate, event.key === 'PageUp' ? -7 : 7);
      // Forward past today lands on today rather than doing nothing — the same
      // clamp the calendar applies, for the same reason.
      selectDate(target > todayKey() ? todayKey() : target);
    } else if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      $('today-btn').click();
    } else if (event.key === '[') {
      event.preventDefault();
      $('prev-day').click();
    } else if (event.key === ']') {
      event.preventDefault();
      if (!$('next-day').disabled) $('next-day').click();
    }
  });

  // The day rolls over while the app sits open overnight.
  setInterval(() => {
    if (state.selectedDate !== todayKey() && !state.timer) return;
    if (state.selectedDate < todayKey() && state.timer) selectDate(todayKey());
  }, 60_000);

  window.addEventListener('error', (event) => {
    const err = event.error ?? event.message;
    console.error('Uncaught renderer error:', err);
    logToFile('error', `Uncaught: ${err?.stack ?? err}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    console.error('Unhandled rejection:', reason);
    logToFile('error', `Unhandled rejection: ${reason?.stack ?? reason?.message ?? reason}`);
  });
}

boot().catch((err) => {
  console.error('Joggl failed to start:', err);
  document.body.textContent = `Joggl failed to start: ${err.message}`;
});
