// Transient messages. Modals are for decisions; anything informational lands here.

import { logToFile } from './state.js';

const AUTO_DISMISS_MS = { ok: 3500, info: 4000, warn: 6000, err: 12000 };

export function toast(message, kind = 'info') {
  // A toast the user dismissed before reading is otherwise gone for good.
  if (kind === 'err' || kind === 'warn') logToFile(kind === 'err' ? 'error' : 'warn', message);

  const stack = document.getElementById('toast-stack');
  if (!stack) return;

  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.title = 'Click to dismiss';

  const remove = () => el.remove();
  el.addEventListener('click', remove);
  // Errors linger: they usually carry the one line that says what to fix.
  setTimeout(remove, AUTO_DISMISS_MS[kind] ?? 4000);

  stack.appendChild(el);
}

export const toastOk = (m) => toast(m, 'ok');
export const toastWarn = (m) => toast(m, 'warn');
export const toastErr = (m) => toast(m, 'err');
