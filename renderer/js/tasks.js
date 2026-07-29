// Issues from the configured JQL sources, and the list they are rendered into.
// Replaces the plugin's Super Productivity task sections; there is no hardcoded
// project, filter or query anywhere.

import { PLAY_ICON } from './icons.js';
import { isPinned, togglePin } from './pins.js';
import { createRemoteLookup } from './remote-lookup.js';
import { renderAll } from './render.js';
import { isToday, lookupJira, searchJira, state } from './state.js';
import { startTimer } from './timer.js';
import { toastErr, toastWarn } from './toast.js';

import { esc } from './util.js';

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
 * The app's remote lookup, wired to the real bridge. See remote-lookup.js for
 * the behaviour, and for why it must never call back synchronously.
 *
 * @param {(query: string, issues: object[]) => void} onResults
 * @returns {(query: string, localCount: number) => void}
 */
export function createIssueLookup(onResults) {
  return createRemoteLookup({
    lookup: (query) => lookupJira(query),
    onResults,
    isEnabled: () => Boolean(state.settings.tokenConfigured),
    // Anything already in the local list is not worth repeating.
    knownKeys: (query) => new Set(searchIssues(query).map((i) => i.issueKey)),
    onError: (message) => toastErr(`Jira lookup failed — ${message}`),
  });
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
  row.dataset.key = issue.issueKey;
  // The drag is otherwise invisible — nothing on the row hints at it, and this
  // ships to colleagues nobody can talk through it. The cursor stays a pointer:
  // clicking to start a timer is still the primary action.
  row.title =
    `${issue.issueKey} — ${issue.title}${issue.status ? ` (${issue.status})` : ''}\n` +
    `Click to start a timer, or drag onto the day view to book time.`;
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
