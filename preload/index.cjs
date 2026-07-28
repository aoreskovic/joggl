// contextBridge only. CommonJS on purpose: a sandboxed preload cannot be ESM.
//
// `ipcRenderer` itself is never exposed. The renderer gets a fixed set of named
// functions, each bound to one channel — the allowlist is this file, spelled out
// rather than derived from main, so it can be audited on its own.

const { contextBridge, ipcRenderer } = require('electron');

// Unwraps the { ok, data } / { ok, error } envelope from main so callers can use
// plain try/catch and still get Jira's actionable message.
async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (res && res.ok) return res.data;
  const err = new Error(res?.error?.message ?? `IPC call ${channel} failed`);
  err.status = res?.error?.status ?? null;
  err.name = res?.error?.name ?? 'Error';
  throw err;
}

contextBridge.exposeInMainWorld('joggl', {
  app: {
    version: () => call('app:version'),
    openLogFolder: () => call('app:openLogFolder'),
    log: (level, message) => call('app:log', { level, message }),
  },

  settings: {
    get: () => call('settings:get'),
    /** @param {{baseUrl?, email?, taskSources?, token?}} patch — token is write-only. */
    save: (patch) => call('settings:save', patch),
    clearToken: () => call('settings:clearToken'),
    testConnection: (creds) => call('settings:test', creds),
  },

  jira: {
    search: (jql, maxResults) => call('jira:search', { jql, maxResults }),
    lookup: (query, limit) => call('jira:lookup', { query, limit }),
    submitWorklog: (issueIdOrKey, startTs, endTs) =>
      call('jira:submitWorklog', { issueIdOrKey, startTs, endTs }),
    updateWorklog: (issueIdOrKey, worklogId, startTs, endTs) =>
      call('jira:updateWorklog', { issueIdOrKey, worklogId, startTs, endTs }),
    deleteWorklog: (issueIdOrKey, worklogId) =>
      call('jira:deleteWorklog', { issueIdOrKey, worklogId }),
    dayWorklogs: (date, dayStartTs, dayEndTs) =>
      call('jira:dayWorklogs', { date, dayStartTs, dayEndTs }),
  },

  days: {
    get: (date) => call('day:get', { date }),
    save: (date, entries) => call('day:save', { date, entries }),
  },

  timer: {
    get: () => call('timer:get'),
    save: (timer) => call('timer:save', { timer }),
  },

  pins: {
    get: () => call('pins:get'),
    save: (pins) => call('pins:save', { pins }),
  },

  ui: {
    get: () => call('ui:get'),
    save: (prefs) => call('ui:save', { prefs }),
  },
});
