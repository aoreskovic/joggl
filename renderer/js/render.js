// A tiny render registry so entries, the day view and the task list can ask for
// a repaint without importing each other in a cycle. app.js registers them all.

const renderers = new Set();

export function registerRenderer(fn) {
  renderers.add(fn);
  return fn;
}

export function renderAll() {
  for (const render of renderers) {
    try {
      render();
    } catch (err) {
      console.error('Render failed:', err);
    }
  }
}
