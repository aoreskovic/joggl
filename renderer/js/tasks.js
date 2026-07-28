// Issues from the configured JQL sources, and the list they are rendered into.
// Replaces the plugin's Super Productivity task sections; there is no hardcoded
// project, filter or query anywhere.

import { PLAY_ICON } from './icons.js';
import { isPinned, togglePin } from './pins.js';
import { renderAll } from './render.js';
import { isToday, lookupJira, searchJira, state } from './state.js';
import { startTimer } from './timer.js';
import { toastErr, toastWarn } from './toast.js';

import { esc, shouldLookupRemote } from './util.js';

const collapsed = new Set();
let loading = false;
let lastError = null;

/** Every loaded issue, de-duplicated across sources, in source order. */
export function allIssues() {
  return state.issues;
}

export function searchIssues(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return state.issues.slice(0, 20);
  return state.issues
    .filter(
      (i) =>
        i.title.toLowerCase().includes(q) || i.issueKey.toLowerCase().includes(q),
    )
    .slice(0, 20);
}

// ── Looking beyond the loaded issues ───────────────────────────────────────

/**
 * A debounced remote lookup that only ever reports results for the query the
 * user is still looking at — an earlier, slower answer arriving late would
 * otherwise repopulate the list under them.
 *
 * @param {(query: string, issues: object[]) => void} onResults
 * @returns {(query: string, localCount: number) => void}
 */
export function createRemoteLookup(onResults) {
  let timer = null;
  let latest = '';

  return (rawQuery, localCount) => {
    const query = String(rawQuery ?? '').trim();
    latest = query;
    clearTimeout(timer);

    if (!shouldLookupRemote(query, localCount) || !state.settings.tokenConfigured) {
      onResults(query, []);
      return;
    }

    timer = setTimeout(async () => {
      try {
        const issues = await lookupJira(query);
        if (query !== latest) return;
        // Anything already in the local list is not worth repeating.
        const known = new Set(searchIssues(query).map((i) => i.issueKey));
        onResults(
          query,
          issues.filter((i) => !known.has(i.issueKey)),
        );
      } catch (err) {
        if (query !== latest) return;
        onResults(query, []);
        toastErr(`Jira lookup failed — ${err.message}`);
      }
    }, 300);
  };
}

export async function loadIssues() {
  if (!state.settings.baseUrl || !state.settings.tokenConfigured) {
    state.issues = [];
    state.issuesBySource = new Map();
    lastError = 'Jira is not configured yet.';
    renderTaskList();
    return;
  }

  loading = true;
  lastError = null;
  renderTaskList();

  const bySource = new Map();
  const seen = new Set();
  const merged = [];
  const failures = [];

  for (const source of state.settings.taskSources) {
    try {
      const issues = await searchJira(source.jql);
      bySource.set(source.id, issues);
      for (const issue of issues) {
        if (seen.has(issue.issueKey)) continue;
        seen.add(issue.issueKey);
        merged.push(issue);
      }
    } catch (err) {
      // One broken JQL should not blank out the other sources.
      bySource.set(source.id, []);
      failures.push(`${source.name}: ${err.message}`);
    }
  }

  state.issues = merged;
  state.issuesBySource = bySource;
  loading = false;
  lastError = failures.length ? failures.join('\n') : null;

  if (failures.length) toastErr(failures.join('\n'));
  renderAll();
}

export function renderTaskList() {
  const list = document.getElementById('task-list');
  const count = document.getElementById('task-count');
  if (!list) return;

  if (count) count.textContent = loading ? '…' : String(state.issues.length);

  if (loading) {
    list.replaceChildren(note('Loading issues from Jira…'));
    return;
  }
  if (!state.settings.baseUrl || !state.settings.tokenConfigured) {
    list.replaceChildren(note('Connect Joggl to Jira in Settings to see your issues.'));
    return;
  }
  if (state.issues.length === 0) {
    list.replaceChildren(
      note(lastError ?? 'No issues matched your task sources. Check the JQL in Settings.'),
    );
    return;
  }

  const children = [];
  for (const source of state.settings.taskSources) {
    const issues = state.issuesBySource.get(source.id) ?? [];
    children.push(sectionHeader(source, issues.length));
    if (!collapsed.has(source.id)) {
      for (const issue of issues) children.push(issueRow(issue));
    }
  }
  list.replaceChildren(...children);
}

function note(text) {
  const el = document.createElement('div');
  el.className = 'list-note';
  el.textContent = text;
  return el;
}

function sectionHeader(source, total) {
  const isCollapsed = collapsed.has(source.id);
  const header = document.createElement('div');
  header.className = 'tt-section';
  header.innerHTML =
    `<span class="tt-chevron">${isCollapsed ? '&#9654;' : '&#9660;'}</span>` +
    esc(source.name) +
    `<span class="tt-section-count">${total}</span>`;
  header.addEventListener('click', () => {
    if (isCollapsed) collapsed.delete(source.id);
    else collapsed.add(source.id);
    renderTaskList();
  });
  return header;
}

function issueRow(issue) {
  const active = state.timer?.issueKey === issue.issueKey;
  const row = document.createElement('div');
  row.className = `task-item${active ? ' is-active' : ''}`;
  row.title = `${issue.issueKey} — ${issue.title}${issue.status ? ` (${issue.status})` : ''}`;
  row.innerHTML =
    `<span class="tt-play">${PLAY_ICON}</span>` +
    `<span class="jira-chip">${esc(issue.issueKey)}</span>` +
    `<span class="task-dd-title">${esc(issue.title)}</span>`;

  const pin = document.createElement('button');
  pin.className = `tt-pin${isPinned(issue.issueKey) ? ' pinned' : ''}`;
  pin.textContent = '📌';
  pin.title = isPinned(issue.issueKey) ? 'Unpin' : 'Pin for one-click start';
  pin.addEventListener('click', async (event) => {
    event.stopPropagation();
    await togglePin(issue);
    renderAll();
  });
  row.appendChild(pin);

  row.addEventListener('click', async () => {
    if (!isToday()) {
      toastWarn('The timer only runs on today.');
      return;
    }
    await startTimer({ issueKey: issue.issueKey, issueId: issue.issueId, title: issue.title });
  });

  return row;
}
