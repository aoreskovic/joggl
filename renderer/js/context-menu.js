// The right-click menu, shared by the entry list and the day view so both answer
// a right-click the same way.
//
// The actions are registered from app.js rather than imported here. Importing
// them would close a cycle — entries.js builds the cards that open this menu —
// and this way the wiring stays in the one file that does wiring.

import { esc } from './util.js';

let actions = null;

/**
 * @param {{editTask: fn, restart: fn, duplicate: fn, split: fn, remove: fn}} handlers
 *        each called with the entry the menu was opened on
 */
export function setContextActions(handlers) {
  actions = handlers;
}

export function hideContextMenu() {
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.replaceChildren();
}

export function showContextMenu(event, entry) {
  hideContextMenu();
  const menu = document.getElementById('ctx-menu');
  if (!menu || !actions) return;

  const items = [
    { icon: '✎', label: 'Edit task', run: () => actions.editTask(entry) },
    { icon: '⏵', label: 'Restart timer', run: () => actions.restart(entry) },
    { icon: '⧉', label: 'Duplicate', run: () => actions.duplicate(entry) },
    { icon: '✂', label: 'Split at midpoint', run: () => actions.split(entry) },
    { icon: '🗑', label: 'Delete', danger: true, run: () => actions.remove(entry) },
  ];

  for (const item of items) {
    const el = document.createElement('div');
    el.className = `ctx-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = `<span class="ctx-icon">${esc(item.icon)}</span><span>${esc(item.label)}</span>`;
    el.addEventListener('click', () => {
      hideContextMenu();
      Promise.resolve(item.run()).catch((err) => console.error(err));
    });
    menu.appendChild(el);
  }

  menu.classList.remove('hidden');

  // Measured once it is in the DOM, so it can be pulled back inside the window.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - rect.height - 4))}px`;
}
