// First-run wizard and the settings panel.
//
// The API token is write-only from here: it is sent to main and never read back,
// so this screen can only ever say whether one is stored.

import { renderAll } from './render.js';
import {
  loadSettings,
  openLogFolder,
  saveSettings,
  saveUi,
  state,
  testConnection,
} from './state.js';
import { loadIssues } from './tasks.js';
import { toastErr, toastOk } from './toast.js';

import { esc } from './util.js';

const DEFAULT_SOURCES = [
  {
    id: 'assigned',
    name: 'Assigned to me',
    jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
  },
  { id: 'recent', name: 'Recent', jql: 'issuekey IN recentIssues()' },
];

let draftSources = [];

// ── Theme ──────────────────────────────────────────────────────────────────

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function applyFontSize(px) {
  document.documentElement.style.setProperty('--sched-font-size', `${px}px`);
}

// ── First-run wizard ───────────────────────────────────────────────────────

export function needsSetup() {
  return !state.settings.baseUrl || !state.settings.email || !state.settings.tokenConfigured;
}

export function openSetup() {
  document.getElementById('setup-url').value = state.settings.baseUrl ?? '';
  document.getElementById('setup-email').value = state.settings.email ?? '';
  document.getElementById('setup-token').value = '';
  setStatus('setup-status', '', '');
  document.getElementById('setup-overlay').classList.remove('hidden');
  document.getElementById('setup-url').focus();
}

function closeSetup() {
  document.getElementById('setup-overlay').classList.add('hidden');
}

function setupValues() {
  return {
    baseUrl: document.getElementById('setup-url').value.trim(),
    email: document.getElementById('setup-email').value.trim(),
    token: document.getElementById('setup-token').value.trim(),
  };
}

export function wireSetup() {
  document.getElementById('setup-test-btn').addEventListener('click', async (event) => {
    await runTest(setupValues(), 'setup-status', event.currentTarget);
  });

  document.getElementById('setup-save-btn').addEventListener('click', async (event) => {
    const values = setupValues();
    if (!values.baseUrl || !values.email || !values.token) {
      setStatus('setup-status', 'Fill in all three fields first.', 'err');
      return;
    }
    const ok = await runTest(values, 'setup-status', event.currentTarget);
    if (!ok) return;

    await saveSettings(values);
    await loadSettings();
    closeSetup();
    toastOk('Jira connected.');
    await loadIssues();
    renderAll();
  });
}

// ── Settings panel ─────────────────────────────────────────────────────────

export function openSettings() {
  document.getElementById('cfg-url').value = state.settings.baseUrl ?? '';
  document.getElementById('cfg-email').value = state.settings.email ?? '';
  document.getElementById('cfg-token').value = '';
  document.getElementById('cfg-token-hint').textContent = state.settings.tokenConfigured
    ? 'A token is stored and encrypted. Leave this blank unless you want to replace it.'
    : 'No token stored yet — Joggl cannot reach Jira until you add one.';

  document.getElementById('cfg-theme').value = state.ui.theme ?? 'system';
  document.getElementById('cfg-fontsize').value = String(state.ui.fontSize ?? 9);

  draftSources = state.settings.taskSources.map((s) => ({ ...s }));
  renderSourceEditor();

  setStatus('cfg-status', '', '');
  document.getElementById('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

function renderSourceEditor() {
  const host = document.getElementById('source-list');
  host.replaceChildren(
    ...draftSources.map((source, index) => {
      const row = document.createElement('div');
      row.className = 'source-row';
      row.innerHTML =
        `<div class="form-row"><label>Name</label>` +
        `<input data-k="name" type="text" value="${esc(source.name)}"></div>` +
        `<div class="form-row"><label>JQL</label>` +
        `<textarea data-k="jql" rows="2">${esc(source.jql)}</textarea></div>`;

      row.querySelector('[data-k="name"]').addEventListener('input', (e) => {
        draftSources[index].name = e.target.value;
      });
      row.querySelector('[data-k="jql"]').addEventListener('input', (e) => {
        draftSources[index].jql = e.target.value;
      });

      const buttons = document.createElement('div');
      buttons.className = 'row-btns';
      const remove = document.createElement('button');
      remove.className = 'btn-outline';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        draftSources.splice(index, 1);
        renderSourceEditor();
      });
      buttons.appendChild(remove);
      row.appendChild(buttons);

      return row;
    }),
  );
}

export function wireSettings() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', (event) => {
    if (event.target.id === 'settings-overlay') closeSettings();
  });

  document.getElementById('cfg-test-btn').addEventListener('click', async (event) => {
    await runTest(
      {
        baseUrl: document.getElementById('cfg-url').value.trim(),
        email: document.getElementById('cfg-email').value.trim(),
        // Blank means "use the stored token" — main falls back to it.
        token: document.getElementById('cfg-token').value.trim(),
      },
      'cfg-status',
      event.currentTarget,
    );
  });

  document.getElementById('cfg-save-btn').addEventListener('click', async () => {
    const patch = {
      baseUrl: document.getElementById('cfg-url').value.trim(),
      email: document.getElementById('cfg-email').value.trim(),
      taskSources: draftSources.filter((s) => s.jql.trim()),
    };
    const token = document.getElementById('cfg-token').value.trim();
    if (token) patch.token = token;

    try {
      await saveSettings(patch);
      await loadSettings();
      setStatus('cfg-status', 'Saved.', 'ok');
      toastOk('Settings saved.');
      await loadIssues();
      renderAll();
    } catch (err) {
      setStatus('cfg-status', err.message, 'err');
    }
  });

  document.getElementById('add-source-btn').addEventListener('click', () => {
    draftSources.push({
      id: `source-${Date.now()}`,
      name: 'New source',
      jql: 'project = ABC AND statusCategory != Done ORDER BY updated DESC',
    });
    renderSourceEditor();
  });

  document.getElementById('reset-sources-btn').addEventListener('click', () => {
    draftSources = DEFAULT_SOURCES.map((s) => ({ ...s }));
    renderSourceEditor();
  });

  document.getElementById('open-log-btn').addEventListener('click', () => {
    openLogFolder().catch((err) => toastErr(err.message));
  });

  document.getElementById('cfg-theme').addEventListener('change', async (event) => {
    applyTheme(event.target.value);
    await saveUi({ theme: event.target.value });
  });

  document.getElementById('cfg-fontsize').addEventListener('change', async (event) => {
    const size = Number(event.target.value);
    applyFontSize(size);
    await saveUi({ fontSize: size });
  });
}

// ── Shared ─────────────────────────────────────────────────────────────────

async function runTest(creds, statusId, button) {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Testing…';
  }
  setStatus(statusId, 'Contacting Jira…', 'busy');

  try {
    const me = await testConnection(creds);
    setStatus(statusId, `Connected as ${me.displayName}.`, 'ok');
    return true;
  } catch (err) {
    setStatus(statusId, err.message, 'err');
    toastErr(err.message);
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

function setStatus(id, message, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `inline-status${kind ? ` ${kind}` : ''}`;
}
