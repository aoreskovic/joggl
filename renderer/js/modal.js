// One modal, used only where the user has to decide something: the merge prompt
// and the Finish Day retry summary.

let activeResolve = null;

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

  overlay.classList.remove('hidden');
  if (focusBody) bodyEl.querySelector('input, textarea, select')?.focus();
  else btnsEl.querySelector('button')?.focus();

  return new Promise((resolve) => {
    activeResolve = resolve;
  });
}

function close(value) {
  const overlay = document.getElementById('modal-overlay');
  overlay?.classList.add('hidden');
  const resolve = activeResolve;
  activeResolve = null;
  resolve?.(value);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeResolve) close(null);
});
