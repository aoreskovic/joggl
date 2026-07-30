// One modal, used only where the user has to decide something: the merge prompt
// and the Finish Day retry summary.

let activeResolve = null;
/** Where focus goes when the modal closes — whatever opened it. */
let returnFocusTo = null;

/**
 * @param {object} spec
 * @param {string} spec.title
 * @param {Node|string|((resolve: (value: any) => void) => Node)} spec.body
 *        A function is called with `resolve`, so a body that is itself the choice —
 *        a list of issues to pick from — can settle the modal without a button.
 * @param {{label: string, value: any, primary?: boolean}[]} spec.buttons
 * @param {any} [spec.dismissValue]
 * @param {boolean} [spec.focusBody] focus the body's first input rather than a button
 * @returns {Promise<any>} the chosen button's `value`, or whatever the body resolved with
 */
export function askModal({ title, body, buttons, dismissValue = null, focusBody = false }) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const btnsEl = document.getElementById('modal-buttons');

  close(dismissValue);

  titleEl.textContent = title;
  const rendered =
    typeof body === 'function'
      ? body(close)
      : typeof body === 'string'
        ? document.createTextNode(body)
        : body;
  bodyEl.replaceChildren(rendered);
  btnsEl.replaceChildren();

  for (const button of buttons) {
    const el = document.createElement('button');
    el.className = button.primary ? 'btn-primary' : 'btn-outline';
    el.textContent = button.label;
    el.addEventListener('click', () => close(button.value));
    btnsEl.appendChild(el);
  }

  // Announced as a dialog, so a screen reader says what it is and stops reading the
  // day behind it.
  const panel = overlay.querySelector('.panel');
  panel?.setAttribute('role', 'dialog');
  panel?.setAttribute('aria-modal', 'true');
  panel?.setAttribute('aria-labelledby', 'modal-title');

  overlay.classList.remove('hidden');

  // What had focus before, so it can be given back. Otherwise focus lands on
  // <body> when the modal closes and the next Tab starts from the top of the app.
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // `[data-autofocus]` first: a body whose own content is the choice — a calendar
  // grid — has no input to land on, and the cell that should take focus is the one
  // it marked, not the first of forty-two.
  if (focusBody) bodyEl.querySelector('[data-autofocus], input, textarea, select')?.focus();
  else btnsEl.querySelector('button')?.focus();

  return new Promise((resolve) => {
    activeResolve = resolve;
  });
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside the modal.
 *
 * Without this, Tab walks out of a modal that is covering the app and lands on the
 * entry rows behind it — which are now focusable and would take a Menu key press
 * for a menu the user cannot see.
 */
function trapTab(event) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  // `tabIndex >= 0` as well as visible: a roving list sets every row but one to -1,
  // and `button:not([disabled])` would otherwise make all of them Tab stops — the
  // calendar grid alone would be forty-two presses of Tab.
  const stops = [...overlay.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null && el.tabIndex >= 0,
  );
  if (stops.length === 0) return;

  const first = stops[0];
  const last = stops[stops.length - 1];
  const onFirst = document.activeElement === first;
  const onLast = document.activeElement === last;

  if (event.shiftKey && (onFirst || !overlay.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (onLast || !overlay.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function close(value) {
  const overlay = document.getElementById('modal-overlay');
  const wasOpen = overlay && !overlay.classList.contains('hidden');
  overlay?.classList.add('hidden');

  const resolve = activeResolve;
  activeResolve = null;

  const back = returnFocusTo;
  returnFocusTo = null;
  if (wasOpen && back?.isConnected) back.focus();

  resolve?.(value);
}

document.addEventListener('keydown', (event) => {
  if (!activeResolve) return;
  if (event.key === 'Escape') close(null);
  else if (event.key === 'Tab') trapTab(event);
});
