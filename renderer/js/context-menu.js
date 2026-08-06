// The right-click menu, shared by the entry list and the day view so both answer
// a right-click the same way.
//
// The actions are registered from app.js rather than imported here. Importing
// them would close a cycle — entries.js builds the cards that open this menu —
// and this way the wiring stays in the one file that does wiring.
//
// Reachable without a mouse. Nothing extra is needed to *open* it: the Menu key
// and Shift+F10 already dispatch `contextmenu` on the focused element, so making
// the rows focusable is enough — see `.entry-card` and `.sched-entry-block`. Such
// an event carries no useful coordinates, which is what `anchorFor` is for.

import { DELETE_ICON } from './icons.js';
import { createRowNav } from './keynav.js';
import { esc } from './util.js';

let actions = null;
/** Where focus goes when the menu closes — the row it was opened on. */
let opener = null;

const nav = createRowNav({
  container: () => document.getElementById('ctx-menu'),
  rowSelector: '.ctx-item',
});

/**
 * @param {{editTask: fn, editComment: fn, restart: fn, duplicate: fn, split: fn,
 *          remove: fn}} handlers
 *        each called with the entry the menu was opened on
 */
export function setContextActions(handlers) {
  actions = handlers;
}

export function hideContextMenu({ restoreFocus = false } = {}) {
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.replaceChildren();
  nav.reset();

  // Only when the menu had focus. Yanking focus back after a plain click
  // elsewhere would fight whatever the user just clicked on.
  const row = opener;
  opener = null;
  if (restoreFocus && row?.isConnected) row.focus();
}

/**
 * Where to put the menu. A mouse event gives coordinates; a keyboard-initiated
 * `contextmenu` reports 0,0, so the row itself becomes the anchor and the menu
 * appears where the eye already is.
 */
function anchorFor(event) {
  const fromKeyboard = event.clientX === 0 && event.clientY === 0;
  if (!fromKeyboard) return { x: event.clientX, y: event.clientY };

  const rect = event.currentTarget?.getBoundingClientRect?.() ??
    event.target?.getBoundingClientRect?.();
  if (!rect) return { x: 40, y: 40 };
  return { x: Math.round(rect.left + 24), y: Math.round(rect.bottom - 4) };
}

/**
 * Raise the shared menu with whatever rows the caller wants.
 *
 * Extracted from `showContextMenu` so a column head can raise a menu that is not
 * about an entry. Everything about *behaviour* — the arrow keys, Enter, Escape, Tab,
 * the focus that goes back to the opener, being pulled inside the window — is here
 * and so cannot come to differ between the two.
 *
 * @param {MouseEvent|{clientX, clientY, currentTarget, target, preventDefault}} event
 * @param {{icon?: string, svg?: string, label: string, danger?: boolean, run: Function}[]} items
 */
export function showMenu(event, items) {
  hideContextMenu();
  const menu = document.getElementById('ctx-menu');
  if (!menu || items.length === 0) return;

  const choose = (item) => {
    // Focus goes back to the row before the action runs, so a dialog opening from
    // here has somewhere sensible to return focus to when it closes.
    hideContextMenu({ restoreFocus: true });
    Promise.resolve(item.run()).catch((err) => console.error(err));
  };

  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;

  for (const item of items) {
    const el = document.createElement('div');
    el.className = `ctx-item${item.danger ? ' danger' : ''}`;
    el.setAttribute('role', 'menuitem');
    // `item.svg` is only ever one of our own constants from icons.js — never
    // anything that came from Jira or from the user — so it goes in unescaped.
    // Everything else still does, which is why they are separate fields.
    const glyph = item.svg ?? esc(item.icon);
    el.innerHTML = `<span class="ctx-icon">${glyph}</span><span>${esc(item.label)}</span>`;
    el.addEventListener('click', () => choose(item));
    menu.appendChild(el);
  }

  menu.classList.remove('hidden');

  // Measured once it is in the DOM, so it can be pulled back inside the window.
  const { x, y } = anchorFor(event);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;

  opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

  // Focused so the arrow keys reach it. The rows themselves are never focused —
  // the active row is tracked by keynav, which keeps mouse hover and keyboard
  // selection from fighting over what Enter means.
  menu.focus();
  menu.onkeydown = (keyEvent) => {
    if (nav.handleKey(keyEvent)) {
      keyEvent.preventDefault();
      return;
    }
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      keyEvent.preventDefault();
      const row = nav.activate();
      const index = nav.rows().indexOf(row);
      if (index >= 0) choose(items[index]);
      return;
    }
    // Escape and Tab both mean "I am done here"; Tab must not walk out of an open
    // menu and leave it hanging over the content.
    if (keyEvent.key === 'Escape' || keyEvent.key === 'Tab') {
      keyEvent.preventDefault();
      hideContextMenu({ restoreFocus: true });
    }
  };
}

export function showContextMenu(event, entry) {
  if (!actions) return;
  showMenu(event, [
    { icon: '✎', label: 'Edit task', run: () => actions.editTask(entry) },
    // Jira's own name for the field, so it is recognisable to anyone who fills it
    // in through the Jira UI — which, on this site, is everyone.
    { icon: '≡', label: 'Work description', run: () => actions.editComment(entry) },
    { icon: '⏵', label: 'Restart timer', run: () => actions.restart(entry) },
    { icon: '⧉', label: 'Duplicate', run: () => actions.duplicate(entry) },
    { icon: '✂', label: 'Split at midpoint', run: () => actions.split(entry) },
    // Drawn rather than 🗑, for the reason given over DELETE_ICON: the emoji's ribs
    // turn to mush at this size. The others are geometric glyphs, which do not.
    { svg: DELETE_ICON, label: 'Delete', danger: true, run: () => actions.remove(entry) },
  ]);
}
