// One modal, used only where the user has to decide something: the merge prompt
// and the Finish Day retry summary.

let activeResolve = null;

/**
 * @param {{title: string, body: Node|string, buttons: {label: string, value: any, primary?: boolean}[],
 *          dismissValue?: any}} spec
 * @returns {Promise<any>} the chosen button's `value`
 */
export function askModal({ title, body, buttons, dismissValue = null }) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const btnsEl = document.getElementById('modal-buttons');

  close(dismissValue);

  titleEl.textContent = title;
  bodyEl.replaceChildren(typeof body === 'string' ? document.createTextNode(body) : body);
  btnsEl.replaceChildren();

  for (const button of buttons) {
    const el = document.createElement('button');
    el.className = button.primary ? 'btn-primary' : 'btn-outline';
    el.textContent = button.label;
    el.addEventListener('click', () => close(button.value));
    btnsEl.appendChild(el);
  }

  overlay.classList.remove('hidden');
  btnsEl.querySelector('button')?.focus();

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
