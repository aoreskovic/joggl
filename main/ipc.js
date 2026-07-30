// The complete IPC surface. Every channel the renderer can reach is registered
// here and nowhere else; preload exposes exactly this list and nothing more.
//
// Handlers answer with an envelope — { ok: true, data } or { ok: false, error } —
// so an actionable Jira message survives the bridge instead of being mangled
// into "Error invoking remote method".

import { app, ipcMain, shell } from 'electron';

import * as credentials from './credentials.js';
import * as days from './days.js';
import * as jira from './jira/client.js';
import * as log from './log.js';
import * as settings from './settings.js';

/** Resolve the credentials a Jira call needs, preferring values passed in by a
 *  settings screen that has not saved yet. */
async function resolveCreds(override = {}) {
  const saved = await settings.getSettings();
  return {
    baseUrl: override.baseUrl?.trim() || saved.baseUrl,
    email: override.email?.trim() || saved.email,
    token: override.token?.trim() || (await credentials.loadToken()),
  };
}

async function settingsView() {
  const s = await settings.getSettings();
  return {
    baseUrl: s.baseUrl,
    email: s.email,
    taskSources: s.taskSources,
    // The renderer never sees the token. Only whether one exists.
    tokenConfigured: await credentials.hasToken(),
    encryptionAvailable: credentials.isEncryptionAvailable(),
  };
}

const handlers = {
  'app:version': () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    logPath: log.getLogPath(),
  }),

  'app:openLogFolder': () => {
    const file = log.getLogPath();
    if (file) shell.showItemInFolder(file);
    return { logPath: file };
  },

  // Renderer-side failures worth keeping: a Finish Day error the user closed
  // before reading it is otherwise gone.
  'app:log': ({ level = 'info', message = '' } = {}) => {
    log.log(level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', `[ui] ${message}`);
    return true;
  },

  'settings:get': () => settingsView(),

  'settings:save': async (payload = {}) => {
    await settings.saveSettings(payload);
    if (typeof payload.token === 'string' && payload.token.trim()) {
      await credentials.saveToken(payload.token);
    }
    return settingsView();
  },

  'settings:clearToken': async () => {
    await credentials.clearToken();
    return settingsView();
  },

  'settings:test': async (payload = {}) => jira.testConnection(await resolveCreds(payload)),

  'jira:search': async ({ jql, maxResults } = {}) =>
    jira.searchIssues(await resolveCreds(), jql, { maxResults }),

  // Free-text and exact-key lookup across the whole instance, for issues the
  // configured task sources do not cover.
  'jira:lookup': async ({ query, limit } = {}) =>
    jira.lookupIssues(await resolveCreds(), query, { limit }),

  // One worklog per call. The Finish Day loop, its ordering and its partial-failure
  // bookkeeping live in the renderer, where they need no Node APIs.
  'jira:submitWorklog': async ({ issueIdOrKey, startTs, endTs, comment } = {}) =>
    jira.submitWorklog(await resolveCreds(), { issueIdOrKey, startTs, endTs, comment }),

  'jira:updateWorklog': async ({ issueIdOrKey, worklogId, startTs, endTs, comment } = {}) =>
    jira.updateWorklog(await resolveCreds(), { issueIdOrKey, worklogId, startTs, endTs, comment }),

  'jira:deleteWorklog': async ({ issueIdOrKey, worklogId } = {}) =>
    jira.deleteWorklog(await resolveCreds(), { issueIdOrKey, worklogId }),

  // Everything this account logged on a day, including time entered straight into
  // the Jira web UI, which Joggl otherwise cannot see.
  'jira:dayWorklogs': async ({ date, dayStartTs, dayEndTs } = {}) =>
    jira.fetchDayWorklogs(await resolveCreds(), { date, dayStartTs, dayEndTs }),

  'day:get': ({ date } = {}) => days.getDay(date),
  'day:save': ({ date, entries } = {}) => days.saveDay(date, entries),

  'timer:get': () => days.getRunningTimer(),
  'timer:save': ({ timer } = {}) => days.saveRunningTimer(timer ?? null),

  'pins:get': () => settings.getPins(),
  'pins:save': ({ pins } = {}) => settings.savePins(pins),

  'ui:get': () => settings.getUiPrefs(),
  'ui:save': ({ prefs } = {}) => settings.saveUiPrefs(prefs ?? {}),
};

export const CHANNELS = Object.keys(handlers);

export function registerIpc() {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return { ok: true, data: await handler(payload) };
      } catch (err) {
        if (channel !== 'app:log') log.error(`IPC ${channel} failed:`, err);
        return {
          ok: false,
          error: {
            message: err?.message ?? String(err),
            status: err?.status ?? null,
            name: err?.name ?? 'Error',
          },
        };
      }
    });
  }
}
