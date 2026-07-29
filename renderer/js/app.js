// Boot and wiring. Everything stateful lives in its own module; this file only
// connects the DOM to it.

import { hideContextMenu, setContextActions } from './context-menu.js';
import { wireDayViewDrag } from './drag-drop.js';
import {
  deleteEntry,
  duplicateEntry,
  editEntryTask,
  renderEntryList,
  splitEntry,
  updateTotal,
} from './entries.js';
import { PLAY_ICON, STOP_ICON, ZOOM_ICON } from './icons.js';
import { isPinned, renderPins, togglePin } from './pins.js';
import { registerRenderer, renderAll } from './render.js';
import { registerView, setActiveView, wireShell } from './shell.js';
import {
  appVersion,
  isToday,
  loadDay,
  loadExternalWorklogs,
  loadPins,
  loadSettings,
  loadTimer,
  loadUi,
  logToFile,
  persistTimer,
  saveUi,
  state,
  ZOOM_LEVELS,
} from './state.js';
import {
  applyFontSize,
  applyTheme,
  applyWeekendTint,
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
  });
  // Hardcoded rather than restored from state.ui.activeView: week and month do not
  // exist yet, and restoring a view that is not registered would leave a blank app.
  setActiveView('day');

  registerRenderer(renderEntryList);
  registerRenderer(renderTimeline);
  registerRenderer(renderTaskList);
  registerRenderer(renderPins);
  registerRenderer(updateTotal);
  registerRenderer(updateTimerUi);
  registerRenderer(updateFinishButton);

  setContextActions({
    editTask: (entry) => editEntryTask(entry.id),
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
  wireDayViewDrag();
  wirePinPicker();
  wireGlobal();

  await selectDate(todayKey());
  await restoreTimer(await loadTimer());

  onTick(() => {
    updateTotal();
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

// ── Day selection ──────────────────────────────────────────────────────────

async function selectDate(date) {
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

  // Time booked straight into Jira belongs in this day's total too. Fetched after
  // the first paint, and never allowed to break the local view if Jira is down.
  refreshExternal(date);
}

function refreshExternal(date = state.selectedDate) {
  return loadExternalWorklogs(date)
    .then(() => renderAll())
    .catch(() => renderAll());
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
}

function wireDayNav() {
  $('prev-day').addEventListener('click', () => selectDate(addDays(state.selectedDate, -1)));
  $('next-day').addEventListener('click', () => {
    if (state.selectedDate < todayKey()) selectDate(addDays(state.selectedDate, 1));
  });
  $('today-btn').addEventListener('click', () => selectDate(todayKey()));
  $('finish-day-btn').addEventListener('click', async () => {
    await finishDay();
    // Newly created worklogs are now claimed by local entries; re-reading keeps
    // the two views from disagreeing about what is in Jira.
    await refreshExternal();
  });
  $('refresh-tasks-btn').addEventListener('click', async () => {
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
    if (event.key === 'Enter') {
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
  $('zoom-lbl').textContent = `${ZOOM_LEVELS[state.ui.zoomIdx] ?? 1}×`;
}

function wireDayView() {
  $('zoom-icon').innerHTML = ZOOM_ICON;

  $('zoom-in').addEventListener('click', async () => {
    if (state.ui.zoomIdx >= ZOOM_LEVELS.length - 1) return;
    await saveUi({ zoomIdx: state.ui.zoomIdx + 1 });
    updateZoomLabel();
    renderTimeline();
  });
  $('zoom-out').addEventListener('click', async () => {
    if (state.ui.zoomIdx <= 0) return;
    await saveUi({ zoomIdx: state.ui.zoomIdx - 1 });
    updateZoomLabel();
    renderTimeline();
  });

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

  const render = () => {
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
}

// ── Global ─────────────────────────────────────────────────────────────────

function wireGlobal() {
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.task-search-wrap')) $('task-dropdown').classList.add('hidden');
    if (!event.target.closest('.ctx-menu')) hideContextMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideContextMenu();
      hideQuickEntry();
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
