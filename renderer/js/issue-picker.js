// A search box that finds an issue: the loaded ones first, then anything else in
// Jira under a separator.
//
// The same reach as the omnibar, because the loaded issues are only what the
// configured JQL sources returned — an issue that is Done, or assigned to someone
// else, is simply not in them.

import { createIssueLookup, searchIssues } from './tasks.js';
import { esc } from './util.js';

/** At or below this many results there is room for the whole summary. */
const EXPAND_TITLES_AT = 2;

/**
 * @param {{onPick: (issue: object) => void, placeholder?: string}} options
 * @returns {{el: HTMLElement, focus: () => void}}
 */
export function createIssuePicker({ onPick, placeholder = 'Search an issue…' }) {
  const el = document.createElement('div');
  el.className = 'issue-picker';

  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = placeholder;
  el.appendChild(input);

  const results = document.createElement('div');
  results.className = 'issue-picker-results';
  el.appendChild(results);

  let remote = { query: '', issues: [] };
  const lookupRemote = createIssueLookup((query, issues) => {
    remote = { query, issues };
    render();
  });

  const row = (issue, expanded) => {
    const item = document.createElement('div');
    item.className = 'task-dd-item';
    item.innerHTML =
      `<span class="jira-chip">${esc(issue.issueKey)}</span>` +
      `<span class="task-dd-title">${esc(issue.title)}</span>` +
      (expanded && issue.status ? `<span class="task-dd-meta">${esc(issue.status)}</span>` : '');
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      onPick(issue);
    });
    return item;
  };

  // Renders only. Starting a lookup from in here is the re-entrancy that once
  // blew the stack — see remote-lookup.js.
  function render() {
    const query = input.value.trim();
    const local = searchIssues(input.value).slice(0, 10);
    const fromJira = remote.query === query ? remote.issues : [];

    const expanded = local.length + fromJira.length <= EXPAND_TITLES_AT;
    results.classList.toggle('expanded', expanded);

    const children = local.map((issue) => row(issue, expanded));
    if (fromJira.length > 0) {
      const separator = document.createElement('div');
      separator.className = 'task-dd-sep';
      separator.textContent = 'Elsewhere in Jira';
      children.push(separator, ...fromJira.map((issue) => row(issue, expanded)));
    }

    if (children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'task-dd-empty';
      empty.textContent = query ? `Nothing matches “${query}”.` : 'No issues loaded.';
      children.push(empty);
    }

    results.replaceChildren(...children);
  }

  const refresh = () => {
    lookupRemote(input.value.trim(), searchIssues(input.value).length);
    render();
  };

  input.addEventListener('input', refresh);
  // Enter picks the only candidate; with a list still on screen it would be a guess.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const query = input.value.trim();
    const candidates = [
      ...searchIssues(input.value),
      ...(remote.query === query ? remote.issues : []),
    ];
    if (candidates.length === 1) onPick(candidates[0]);
  });

  refresh();

  return { el, focus: () => input.focus() };
}
