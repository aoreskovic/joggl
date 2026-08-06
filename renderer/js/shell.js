// The app shell: the sidebar, which view is showing, and whether the rail is
// collapsed.
//
// Views register a mount/unmount pair instead of being switched on by name here, so
// the week and month views can be added without this module learning anything about
// them. The day view's pair only toggles `hidden` on markup that already exists —
// nothing about the working day view moves into a builder function.

import { CHEVRON_ICON, DAY_ICON, HELP_ICON, MONTH_ICON, SETTINGS_ICON, WEEK_ICON } from './icons.js';
import { saveUi, state } from './state.js';

/** Long enough that crossing the rail on the way somewhere else does not open it. */
const PEEK_DELAY_MS = 180;

const views = new Map();
let activeId = null;
let peekTimer = null;
let dragging = false;

export function registerView(id, view) {
  views.set(id, view);
}

/** Which view is mounted. Renders use it so two views cannot both draw at once. */
export function activeView() {
  return activeId;
}

/** Whether a view has been registered — a stored preference may name one that has not. */
export function hasView(id) {
  return views.has(id);
}

export function setActiveView(id) {
  if (id === activeId) return;
  const next = views.get(id);
  if (!next) return;

  views.get(activeId)?.unmount();
  activeId = id;
  next.mount();

  for (const button of document.querySelectorAll('.sidebar-item[data-view]')) {
    const isActive = button.dataset.view === id;
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  if (state.ui.activeView !== id) saveUi({ activeView: id }).catch(() => {});
}

/**
 * Called by the drag gesture. A peek opening under the cursor mid-drag would slide
 * over the day view and swallow the drop target, so while a drag is running the rail
 * stays a rail.
 */
export function setDragging(value) {
  dragging = value;
  if (!value) return;
  clearTimeout(peekTimer);
  document.getElementById('sidebar')?.classList.remove('peek');
}

function applyCollapsed(collapsed) {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed', collapsed);
  if (!collapsed) sidebar.classList.remove('peek');

  const toggle = document.getElementById('sidebar-toggle');
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
}

/** Call once at boot, after loadUi() has resolved — the collapse state comes from it. */
export function wireShell() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');

  toggle.innerHTML = CHEVRON_ICON;

  const icons = { day: DAY_ICON, week: WEEK_ICON, month: MONTH_ICON };
  for (const button of sidebar.querySelectorAll('.sidebar-item[data-view]')) {
    button.querySelector('.sidebar-icon').innerHTML = icons[button.dataset.view] ?? '';
    button.addEventListener('click', () => setActiveView(button.dataset.view));
  }
  document.querySelector('#help-btn .sidebar-icon').innerHTML = HELP_ICON;
  document.querySelector('#settings-btn .sidebar-icon').innerHTML = SETTINGS_ICON;

  applyCollapsed(Boolean(state.ui.sidebarCollapsed));

  toggle.addEventListener('click', async () => {
    const collapsed = !sidebar.classList.contains('collapsed');
    applyCollapsed(collapsed);
    await saveUi({ sidebarCollapsed: collapsed });
  });

  sidebar.addEventListener('mouseenter', () => {
    if (dragging || !sidebar.classList.contains('collapsed')) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      if (!dragging) sidebar.classList.add('peek');
    }, PEEK_DELAY_MS);
  });

  sidebar.addEventListener('mouseleave', () => {
    clearTimeout(peekTimer);
    sidebar.classList.remove('peek');
  });
}
