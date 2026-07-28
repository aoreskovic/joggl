// Non-secret settings: Jira base URL, account email, task-source JQL, UI prefs.
// The API token is not here — see credentials.js.
//
// Nothing about any particular Jira instance is baked in. Every colleague works
// on different projects, so the task sources are plain user-editable JQL with
// only these two as starting defaults.

import * as store from './store.js';

export const DEFAULT_TASK_SOURCES = [
  {
    id: 'assigned',
    name: 'Assigned to me',
    jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
  },
  {
    id: 'recent',
    name: 'Recent',
    jql: 'issuekey IN recentIssues()',
  },
];

const DEFAULTS = {
  baseUrl: '',
  email: '',
  taskSources: DEFAULT_TASK_SOURCES,
};

export async function getSettings() {
  const saved = (await store.get('settings')) ?? {};
  const taskSources = Array.isArray(saved.taskSources) && saved.taskSources.length
    ? saved.taskSources
    : DEFAULT_TASK_SOURCES;
  return { ...DEFAULTS, ...saved, taskSources };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current };

  if (typeof patch.baseUrl === 'string') next.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '');
  if (typeof patch.email === 'string') next.email = patch.email.trim();
  if (Array.isArray(patch.taskSources)) {
    next.taskSources = patch.taskSources
      .filter((s) => s && typeof s.jql === 'string' && s.jql.trim())
      .map((s, i) => ({
        id: String(s.id ?? `source-${i}`),
        name: String(s.name ?? `Source ${i + 1}`).slice(0, 60),
        jql: s.jql.trim(),
      }));
  }

  await store.set('settings', next);
  return next;
}

export async function getPins() {
  const pins = await store.get('pins');
  return Array.isArray(pins) ? pins : [];
}

export async function savePins(pins) {
  const clean = (Array.isArray(pins) ? pins : [])
    .filter((p) => p && typeof p.issueKey === 'string')
    .slice(0, 12)
    .map((p) => ({ issueKey: p.issueKey, title: String(p.title ?? p.issueKey) }));
  await store.set('pins', clean);
  return clean;
}

const UI_DEFAULTS = {
  zoomIdx: 2,
  fontSize: 9,
  panelWidth: 320,
  theme: 'system', // system | light | dark
};

export async function getUiPrefs() {
  return { ...UI_DEFAULTS, ...((await store.get('ui')) ?? {}) };
}

export async function saveUiPrefs(patch) {
  const next = { ...(await getUiPrefs()), ...patch };
  await store.set('ui', next);
  return next;
}
