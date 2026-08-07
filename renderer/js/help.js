// The help panel: how the app works, and every shortcut it has.
//
// The prose lives in index.html beside the other panels. The shortcut table is
// built from the list below rather than written out there, so there is one list of
// bindings instead of a copy that quietly falls behind the code. Nothing enforces
// that — adding a binding means adding a row here, and the UI check counts them.

import { esc } from './util.js';

/**
 * Every binding the app has, grouped the way someone reading them would look.
 *
 * @type {{group: string, keys: [string, string][]}[]}
 */
export const SHORTCUTS = [
  {
    group: 'Anywhere',
    keys: [
      ['Ctrl + L', 'Jump to the search box and select what is in it'],
      ['Ctrl + Enter', 'Start the highlighted or typed issue. With the box empty, resume the day’s last entry. While a timer runs, stop it'],
      ['F1', 'Open and close this help'],
      ['Escape', 'Close whatever is open. Again to clear the selection'],
    ],
  },
  {
    group: 'Moving between days',
    keys: [
      ['T', 'Today'],
      ['[ or ]', 'Previous day, next day'],
      ['Page Up / Page Down', 'A week back, a week forward. Forward stops at today'],
      ['Click the date', 'Open a calendar and jump anywhere'],
    ],
  },
  {
    group: 'In the week view',
    keys: [
      ['‹ ›', 'A week back and forward. Page Up and Page Down do the same'],
      ['[ or ]', 'A day — which moves the marked column, and steps the week at its ends'],
      ['5 | 7', 'Monday to Friday, or the whole week. A weekend with time on it is shown either way'],
      ['Drag a block sideways', 'Move it to another day. A synced one goes back to pending and is rewritten, never logged twice'],
    ],
  },
  {
    group: 'Selecting and copying',
    keys: [
      ['Click', 'Select one entry — marked in every panel it appears in'],
      ['Ctrl + click', 'Add one to the selection, or take it out again'],
      ['Drag on empty grid', 'A rubber band. It catches a block when the box encloses it, not when it merely crosses it'],
      ['Ctrl + A', 'Select everything on screen — the week, or the day'],
      ['Ctrl + C', 'Copy the selection'],
      ['Ctrl + V', 'Paste onto the marked day, keeping every offset — in days as well as on the clock'],
      ['Ctrl + drag', 'Copy a block instead of moving it'],
      ['Delete', 'Delete the selection. More than one asks first, and says what is already in Jira'],
      ['← →', 'Move between columns; ↑ ↓ move within one'],
    ],
  },
  {
    group: 'In any list',
    keys: [
      ['↑ ↓', 'Move the highlight, wrapping at both ends'],
      ['Home / End', 'First and last'],
      ['Enter', 'Take the highlighted row'],
      ['Tab', 'A list is one stop — arrows move inside it'],
    ],
  },
  {
    group: 'On a selected entry',
    keys: [
      ['Enter', 'Open its menu'],
      ['Shift + F10', 'The same menu. The Menu key, on a keyboard that has one, does it too'],
    ],
  },
  {
    group: 'In the calendar',
    keys: [
      ['← →', 'A day'],
      ['↑ ↓', 'A week'],
      ['Page Up / Page Down', 'A month'],
      ['Home / End', 'The ends of the month shown'],
    ],
  },
  {
    group: 'In a dialog',
    keys: [
      ['Tab', 'Cycles inside it — the page behind is out of reach'],
      ['Escape', 'Close, and put focus back where it came from'],
    ],
  },
];

export function wireHelp() {
  renderShortcuts();
  document.getElementById('help-btn')?.addEventListener('click', toggleHelp);
  document.getElementById('close-help')?.addEventListener('click', closeHelp);
  document.getElementById('help-overlay')?.addEventListener('click', (event) => {
    if (event.target.id === 'help-overlay') closeHelp();
  });
}

export function helpIsOpen() {
  return document.getElementById('help-overlay')?.classList.contains('hidden') === false;
}

export function closeHelp() {
  document.getElementById('help-overlay')?.classList.add('hidden');
}

/** F1 both opens and closes, which is what every other F1 in the world does. */
export function toggleHelp() {
  const overlay = document.getElementById('help-overlay');
  if (!overlay) return;
  const opening = overlay.classList.contains('hidden');
  overlay.classList.toggle('hidden', !opening);
  if (opening) document.getElementById('close-help')?.focus();
}

function renderShortcuts() {
  const table = document.getElementById('help-shortcuts');
  if (!table) return;
  // The column widths come from here, not from the first row: `table-layout: fixed`
  // reads row one, and row one is a group heading spanning both columns, so without
  // this the table splits 50/50 and strands the descriptions half a panel away.
  table.innerHTML = '<colgroup><col class="help-keys-col" /><col /></colgroup>' + SHORTCUTS.map(
    ({ group, keys }) =>
      `<tr class="help-keys-group"><th colspan="2">${esc(group)}</th></tr>` +
      keys
        .map(([key, what]) => `<tr><td><kbd>${esc(key)}</kbd></td><td>${esc(what)}</td></tr>`)
        .join(''),
  ).join('');
}
