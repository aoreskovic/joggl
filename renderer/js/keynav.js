// Arrow-key navigation over a list of rows.
//
// One helper for four lists — the omnibar dropdown, the quick-entry results, the
// issue picker inside a modal, and the right-click menu. They differ only in the
// container, the row class, and where the keys arrive from (an input above the
// list, or the list itself). Writing it four times would leave four subtly
// different notions of what Enter does.
//
// Nothing is active until an arrow key is pressed, deliberately. Enter with no
// active row has to keep doing what it already did — start a timer on the typed
// text, commit free text, pick the only match — so `activate()` answers null and
// the caller falls back to its existing behaviour. Pre-selecting the first row
// would quietly change what Enter means in three places.

const ACTIVE = 'is-keynav-active';

/**
 * Roving tabindex over a list of focusable rows.
 *
 * Making every row a tab stop is the naive way to make a list reachable, and on a
 * busy day it puts twenty stops between the omnibar and the issue list. So the
 * list holds exactly one: the first row is tabbable, the rest are not, and the
 * arrow keys move real focus between them. That is what a list is meant to do,
 * and it is what makes the Menu key useful — it fires on whatever has focus.
 *
 * `refresh()` has to run after every render, because each render replaces the rows.
 *
 * @param {{container: () => Element|null, rowSelector: string}} options
 */
/**
 * @param {object} spec
 * @param {() => Element|null} spec.container
 * @param {string} spec.rowSelector
 * @param {(row: Element) => void} [spec.onMove] the row the arrows just landed on,
 *        so the selection can follow the keyboard as it follows the mouse
 */
export function wireRovingList({ container, rowSelector, onMove }) {
  const rows = () => {
    const host = container();
    return host ? [...host.querySelectorAll(rowSelector)] : [];
  };

  const refresh = () => {
    const all = rows();
    // Keep whichever row already has focus as the tab stop, so a re-render during
    // keyboard use does not throw focus back to the top of the list.
    const focused = all.indexOf(document.activeElement);
    const stop = focused >= 0 ? focused : 0;
    for (const [i, row] of all.entries()) row.tabIndex = i === stop ? 0 : -1;
  };

  const host = container();
  if (host) {
    host.addEventListener('keydown', (event) => {
      const all = rows();
      const from = all.indexOf(event.target);
      if (from < 0) return; // a keypress inside an input, not on a row

      let to = null;
      if (event.key === 'ArrowDown') to = Math.min(from + 1, all.length - 1);
      else if (event.key === 'ArrowUp') to = Math.max(from - 1, 0);
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = all.length - 1;
      if (to === null) return;

      event.preventDefault();
      all[from].tabIndex = -1;
      all[to].tabIndex = 0;
      all[to].focus();
      onMove?.(all[to]);
    });
  }

  return { refresh };
}

/**
 * @param {object} options
 * @param {() => Element|null} options.container resolved each time, because every
 *        render replaces the list wholesale
 * @param {string} options.rowSelector
 * @returns {{rows: () => Element[], active: () => Element|null, reset: () => void,
 *           handleKey: (event: KeyboardEvent) => boolean, activate: () => Element|null,
 *           focusFirst: () => void}}
 */
export function createRowNav({ container, rowSelector }) {
  // An index rather than an element: the rows are new objects after every render,
  // so a held reference would point at something detached.
  let index = -1;

  const rows = () => {
    const host = container();
    return host ? [...host.querySelectorAll(rowSelector)] : [];
  };

  const paint = () => {
    const all = rows();
    for (const [i, row] of all.entries()) {
      const on = i === index;
      row.classList.toggle(ACTIVE, on);
      if (on) row.scrollIntoView({ block: 'nearest' });
    }
  };

  const moveTo = (next) => {
    const count = rows().length;
    if (count === 0) {
      index = -1;
      return;
    }
    // Wraps, so holding ArrowDown at the bottom returns to the top rather than
    // sticking — the lists are short and wrapping is what a menu does.
    index = ((next % count) + count) % count;
    paint();
  };

  return {
    rows,
    active: () => rows()[index] ?? null,

    /** Call after a re-render: the row that was active may no longer exist. */
    reset() {
      index = -1;
    },

    focusFirst() {
      moveTo(0);
    },

    /** @returns {boolean} whether the key was consumed and should not bubble. */
    handleKey(event) {
      switch (event.key) {
        case 'ArrowDown':
          moveTo(index + 1);
          return true;
        case 'ArrowUp':
          // From nothing, Up enters at the bottom — the same gesture a menu gives.
          moveTo(index === -1 ? -1 : index - 1);
          return true;
        case 'Home':
          moveTo(0);
          return true;
        case 'End':
          moveTo(rows().length - 1);
          return true;
        default:
          return false;
      }
    },

    activate() {
      return rows()[index] ?? null;
    },
  };
}
