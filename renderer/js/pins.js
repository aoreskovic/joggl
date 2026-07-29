// Pinned issues — a local list of issue keys in the store, not a Jira filter.

import { isToday, savePins, state } from './state.js';
import { startTimer } from './timer.js';
import { toastWarn } from './toast.js';
import { esc, pinLabelParts } from './util.js';

const MAX_PINS = 12;

export function isPinned(issueKey) {
  return state.pins.some((p) => p.issueKey === issueKey);
}

export async function togglePin(issue) {
  if (isPinned(issue.issueKey)) {
    await savePins(state.pins.filter((p) => p.issueKey !== issue.issueKey));
    return;
  }
  if (state.pins.length >= MAX_PINS) {
    toastWarn(`Maximum ${MAX_PINS} pinned issues. Unpin one first.`);
    return;
  }
  await savePins([...state.pins, { issueKey: issue.issueKey, title: issue.title }]);
}

export function renderPins() {
  const container = document.getElementById('pin-chips');
  if (!container) return;

  container.replaceChildren(
    ...state.pins.map((pin) => {
      const active = state.timer?.issueKey === pin.issueKey;
      const chip = document.createElement('div');
      chip.className = `pin-chip${active ? ' active' : ''}`;
      // How the drag gesture identifies which pin was grabbed.
      chip.dataset.key = pin.issueKey;
      chip.title = `${pin.issueKey} — ${pin.title}\nClick to start a timer, or drag onto the day view`;

      // The label is a setting because a key alone does not say what a pin is, and
      // a title alone does not say which issue it is — on this kind of instance
      // there is a `Meetings` issue per project.
      const label = pinLabelParts(pin, state.ui.pinLabel);
      chip.innerHTML =
        (label.key ? `<span class="pin-chip-key">${esc(label.key)}</span>` : '') +
        (label.title ? `<span class="pin-chip-title">${esc(label.title)}</span>` : '');

      const remove = document.createElement('button');
      remove.className = 'pin-remove';
      remove.textContent = '×';
      remove.title = 'Unpin';
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        await savePins(state.pins.filter((p) => p.issueKey !== pin.issueKey));
        renderPins();
      });
      chip.appendChild(remove);

      chip.addEventListener('click', async () => {
        if (!isToday()) {
          toastWarn('The timer only runs on today.');
          return;
        }
        // issueId is not stored with the pin; the worklog POST accepts the key.
        await startTimer({ issueKey: pin.issueKey, issueId: null, title: pin.title });
      });

      return chip;
    }),
  );
}
