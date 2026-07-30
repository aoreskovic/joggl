// Drives the manual checklist in test-and-issues.md as a script.
//
//   npm run uicheck
//
// Loaded by main/index.js only when the app is started with `--uicheck`, which
// also points userData at a throwaway directory — nothing here touches a real
// day log. It still reads the real Jira, because the credential preset applies
// to any profile; it never writes to Jira.
//
// No dependency and no DevTools Protocol. The main process already holds
// `webContents.executeJavaScript`, which is enough to dispatch real MouseEvents,
// read computed styles and element boxes, and drive the whole app.
//
// ── Nine traps, all of which made checks pass or fail for the wrong reason ──
//
// 1. A timer stopped inside ten seconds is discarded on purpose (MIN_ENTRY_MS in
//    timer.js). Back-date the start with H.backdateStart() or the check measures
//    nothing at all.
// 2. Jira-side worklogs render as `.entry-card` too. Anything counting entries
//    must scope to `.entry-card:not(.external)`, or every "nothing was created"
//    assertion reads as a failure.
// 3. Externals take part in overlap layout by design, so a two-entry overlap can
//    legitimately produce three columns.
// 4. At 0.5x zoom a quarter hour is 11px. Clicking a few pixels below an hour
//    label lands in the next quarter — so a drop check asserts the entry landed
//    where the *preview* said, which is what the checklist asks anyway.
// 5. HH:MM resolves against the *selected day*. "Five minutes ago" just after
//    midnight is 23:55 yesterday, which reads as tonight, is refused as a future
//    start, and leaves a timer that runs for milliseconds. H.backdateStart clamps
//    into today; anything computing a time from `Date.now()` must do the same.
// 6. The visible hour range grows to cover the current hour, so on an empty day
//    just after midnight it starts at 00:00 and the afternoon is far below the
//    fold. Never aim at an hour where it happens to sit — H.showHour scrolls it
//    to the middle first, clear of the window edge and of the auto-scroll band.
// 7. Selecting a day starts an async read of that day's Jira worklogs, and the
//    re-render when it lands replaces every row. H.settle() waits for that, and it
//    wants sustained stillness: one stable sample arrives before the request has
//    even answered. A row grabbed before the render and pressed after it is
//    detached, and a press on a detached node never reaches the delegated listener
//    — the drag simply never starts. H.dragToHour re-finds its row for that reason.
// 8. The window must be the foreground one. A background or occluded window has
//    its compositor frozen, so a CSS transition stays stuck half way and `:focus`
//    stops matching — sidebar widths read as nonsense and key presses land
//    nowhere. main/index.js takes focus at startup; prefer document.activeElement
//    over `:focus` anyway, and do not click away during a run.
// 9. An empty-state check cannot use today. Time booked in the Jira web UI puts
//    rows on the day whatever the store says, so H.findEmptyDay() steps back until
//    it finds a day with none.
//
// ── What this cannot reach ──
//
// Anything crossing a process restart (the persistence rows), and anything that
// writes to Jira (Finish Day, and the synced-entry rewrite). Those stay manual.
//
// ── Adding a check ──
//
// check(name, pageScript, expectation). The script runs in the page wrapped in an
// async IIFE, so `await` works and the last `return` is the value. It must return
// something structured-cloneable — a string or a number, so JSON.stringify what
// you collect. Start and end with `await H.resetDay()`.

const results = [];
let win = null;

const run = (js) => win.webContents.executeJavaScript(js);

/**
 * How long a single check may take before it is called hung.
 *
 * A page script that wedges the renderer — an accidental loop, a promise nothing
 * resolves — leaves `executeJavaScript` pending for ever, and since the summary is
 * only printed at the end, a run like that reports nothing at all. Failing the one
 * check and carrying on says which one it was.
 *
 * Generous on purpose. Every day change fires a Jira read, and a check that steps
 * through a week of them waits on the network far longer than it waits on the DOM;
 * a tighter bound failed five checks that were merely slow. A genuine wedge never
 * answers, so it is caught whatever the number.
 */
const CHECK_TIMEOUT_MS = 120000;

async function check(name, js, expectation) {
  // Named as it starts, not as it finishes, so a hang names itself in the terminal.
  process.stdout.write(`  … ${name}\n`);
  try {
    const raw = await Promise.race([
      run(`(async () => { ${js} })()`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`no answer in ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS),
      ),
    ]);
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    results.push({ name, ok: expectation(raw), value });
  } catch (err) {
    results.push({ name, ok: false, value: `THREW ${err.message}` });
  }
}

const eq = (want) => (got) => JSON.stringify(got) === JSON.stringify(want);

// ── Page-side helpers, installed once ──────────────────────────────────────

const HELPERS = `
window.H = {
  q: (s) => document.querySelector(s),
  all: (s) => [...document.querySelectorAll(s)],
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  todayKey() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  /**
   * Scroll an hour line to the middle of the panel and return its viewport y.
   *
   * Aiming at wherever an hour happens to sit is not safe. The visible range grows
   * to cover the current hour, so on an empty day just after midnight it starts at
   * 00:00 and every afternoon hour is far below the fold — a click there lands
   * outside the window, and a drag ending near the panel edge trips the auto-scroll
   * band and drifts to a different quarter. Centring puts the target clear of both.
   */
  async showHour(hhmm) {
    const find = () => H.all('.sched-hour-label').find((e) => e.textContent === hhmm);
    if (!find()) return null;
    const panel = H.q('#right-panel');
    const grid = H.q('#schedule-grid');
    const offset = find().getBoundingClientRect().top - grid.getBoundingClientRect().top;
    panel.scrollTop = Math.max(0, offset - panel.clientHeight / 2);
    await H.sleep(150);
    const el = find();
    return el ? Math.round(el.getBoundingClientRect().top + 3) : null;
  },
  gridX() {
    const r = H.q('#schedule-grid').getBoundingClientRect();
    return Math.round(r.left + r.width * 0.6);
  },
  mouse(el, type, x, y, buttons) {
    (el || document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons, clientX: x, clientY: y,
    }));
  },
  // Press on el, move in steps to (tx,ty), release there.
  drag(el, tx, ty, steps = 5) {
    const r = el.getBoundingClientRect();
    const sx = Math.round(r.left + 14), sy = Math.round(r.top + r.height / 2);
    H.mouse(el, 'mousedown', sx, sy, 1);
    for (let i = 1; i <= steps; i++) {
      H.mouse(document, 'mousemove', Math.round(sx + (tx - sx) * i / steps),
                                     Math.round(sy + (ty - sy) * i / steps), 1);
    }
    H.mouse(document, 'mouseup', tx, ty, 0);
  },
  /**
   * Re-find a row that a render replaced while we were looking away.
   *
   * showHour scrolls and awaits, so a caller that grabbed its row first can be
   * holding a detached node by the time the press goes out — and a press on a
   * detached node never reaches the delegated listener on #task-list, so the
   * drag silently never starts and the check reports "nothing was created".
   */
  relocate(el) {
    if (el.isConnected) return el;
    // Plain concatenation: this whole block is a template string, so a nested
    // backtick would end it early.
    const d = el.dataset || {};
    const found = d.id ? H.q('[data-id="' + d.id + '"]')
      : d.key ? H.q('[data-key="' + d.key + '"]') : null;
    if (!found) throw new Error('the drag source was replaced and could not be found again');
    return found;
  },
  async dragToHour(el, hhmm) {
    const y = await H.showHour(hhmm);
    H.drag(H.relocate(el), H.gridX(), y);
  },
  click(el) {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    H.mouse(el, 'mousedown', x, y, 1);
    H.mouse(el, 'mouseup', x, y, 0);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  },
  entries() {
    return H.all('.entry-card:not(.external)').map(c => ({
      key: c.querySelector('.entry-jira')?.textContent ?? null,
      range: H.all('.time-ie', c).length ? [...c.querySelectorAll('.time-ie')].map(i => i.value).join('-') : null,
      status: c.querySelector('.status-badge')?.textContent ?? null,
      external: c.classList.contains('external'),
      overlapping: c.classList.contains('overlapping'),
    }));
  },
  /**
   * Selecting a day kicks off an async read of that day's Jira-side worklogs,
   * and the re-render when it lands will replace every row. A gesture started
   * before that settles gets its element pulled out from under it, which shows
   * up as a drag that never begins. So: wait until the row count stops moving.
   */
  async settle(timeoutMs = 6000) {
    const count = () => H.all('.entry-card').length + H.all('.task-item').length;
    // One stable sample is not enough. The Jira read takes about a second, so the
    // count sits still at 250ms and 500ms and then everything is replaced mid-drag,
    // which shows up as a gesture that never starts. Require sustained stillness,
    // and a floor on the total wait so a fast machine cannot outrun the request.
    const NEEDED = 3;
    const floor = Date.now() + 1200;
    const until = Date.now() + timeoutMs;
    let last = -1;
    let stable = 0;

    while (Date.now() < until) {
      const now = count();
      stable = now === last ? stable + 1 : 0;
      last = now;
      if (stable >= NEEDED && now > 0 && Date.now() >= floor) return;
      await H.sleep(250);
    }
  },
  async resetDay() {
    if (H.q('#modal-overlay') && !H.q('#modal-overlay').classList.contains('hidden')) {
      H.all('#modal-buttons button').at(-1)?.click();
      await H.sleep(150);
    }
    H.all('.toast').forEach(t => t.remove());
    await window.joggl.timer.save(null);
    await window.joggl.days.save(H.todayKey(), []);
    H.q('#today-btn').click();
    await H.sleep(300);
    await H.settle();
  },
  firstTask() { return H.q('.task-item'); },
  /**
   * Select a day with nothing on it at all, and return its label.
   *
   * An empty-state check cannot just clear today: time booked in the Jira web UI
   * renders as .entry-card too (trap 2), so "today, cleared" is usually not an
   * empty day. Step back until a day has no rows of either kind. Under --uicheck
   * the store is a temp directory, so only Jira-side rows can be in the way.
   */
  async findEmptyDay(maxBack = 21) {
    // Remembered across checks: every step back is a Jira read for that day, and
    // searching twice for the same answer floods the request the rest of the run is
    // waiting on. Stepping is only ever backwards, so what was empty stays empty.
    const steps = H._emptyDaySteps ?? null;
    H.q('#today-btn').click();
    await H.sleep(300);
    await H.settle();

    if (steps !== null) {
      for (let i = 0; i < steps; i++) {
        H.q('#prev-day').click();
        await H.sleep(300);
      }
      await H.settle();
      return H.q('#current-date-label').textContent;
    }

    for (let i = 0; i <= maxBack; i++) {
      if (H.all('.entry-card').length === 0) {
        H._emptyDaySteps = i;
        return H.q('#current-date-label').textContent;
      }
      H.q('#prev-day').click();
      await H.sleep(300);
      await H.settle();
    }
    return null;
  },
  /** The running timer's issue key, read off the omnibar — state is not exposed. */
  runningKey() {
    return (H.q('#task-input').value.match(/\\(([A-Z][A-Z0-9_]*-\\d+)\\)\\s*$/) ?? [])[1] ?? null;
  },
  /**
   * Unpin everything through the × on each chip.
   *
   * Not window.joggl.pins.save([]) — that writes the store but leaves state.pins
   * as it was, so the chips stay on screen and the next check counts them.
   */
  async clearPins() {
    let guard = 0;
    while (H.q('.pin-remove') && guard++ < 20) {
      H.q('.pin-remove').click();
      await H.sleep(120);
    }
  },
  // A timer stopped under ten seconds old is discarded on purpose; back-date it.
  //
  // Clamped into today, because the field resolves HH:MM against the *selected
  // day*: just after midnight, "five minutes ago" is 23:55 yesterday, which reads
  // as 23:55 tonight, gets refused as a future start, and the timer then runs for
  // milliseconds and is discarded. Between 00:00 and 00:00:10 there is genuinely
  // no back-date that gives a ten-second timer, and the checks that need one will
  // say so rather than quietly passing.
  backdateStart(minutes) {
    const p = (n) => String(n).padStart(2, '0');
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const t = new Date(Math.max(Date.now() - minutes * 60000, midnight.getTime()));
    const inp = H.q('#start-time-input');
    inp.value = p(t.getHours()) + ':' + p(t.getMinutes());
    inp.dispatchEvent(new FocusEvent('blur'));
    return inp.value;
  },
};
'installed'`;

// ── The checklist ──────────────────────────────────────────────────────────

async function sidebar() {
  await check(
    'sidebar: brand, three tabs, settings, day active',
    `return JSON.stringify({
       brand: H.q('.sidebar-brand-name')?.textContent,
       tabs: H.all('.sidebar-item[data-view]').map(b => b.dataset.view),
       settings: !!H.q('#settings-btn'),
       active: H.q('.sidebar-item.is-active')?.dataset.view,
     })`,
    (v) => {
      const d = JSON.parse(v);
      return d.brand === 'Joggl' && d.settings && d.active === 'day' &&
        JSON.stringify(d.tabs) === JSON.stringify(['day', 'week', 'month']);
    },
  );

  await check(
    'sidebar: week and month disabled, "Not built yet"',
    `return JSON.stringify(H.all('.sidebar-item[data-view]')
       .filter(b => b.dataset.view !== 'day')
       .map(b => ({ v: b.dataset.view, disabled: b.disabled, title: b.title })))`,
    (v) => JSON.parse(v).every((b) => b.disabled && b.title === 'Not built yet'),
  );

  await check(
    'sidebar: clicking Week does nothing',
    `H.q('.sidebar-item[data-view="week"]').click(); await H.sleep(200);
     return H.q('.sidebar-item.is-active')?.dataset.view`,
    eq('day'),
  );

  await check(
    'settings: opens from the sidebar, closes, no gear in day header',
    `H.q('#settings-btn').click(); await H.sleep(250);
     const opened = !H.q('#settings-overlay').classList.contains('hidden');
     H.q('#close-settings').click(); await H.sleep(250);
     const closed = H.q('#settings-overlay').classList.contains('hidden');
     const gear = !!H.q('.day-header #settings-btn, .day-header .icon-square');
     return JSON.stringify({ opened, closed, gear })`,
    (v) => {
      const d = JSON.parse(v);
      return d.opened && d.closed && !d.gear;
    },
  );

  await check(
    'sidebar: toggle collapses and expands, content does not jump',
    `const s = H.q('#sidebar'), host = H.q('#view-day');
     const before = Math.round(host.getBoundingClientRect().left);
     H.q('#sidebar-toggle').click(); await H.sleep(350);
     const collapsed = s.classList.contains('collapsed');
     const collapsedLeft = Math.round(host.getBoundingClientRect().left);
     H.q('#sidebar-toggle').click(); await H.sleep(350);
     return JSON.stringify({ collapsed, expanded: !s.classList.contains('collapsed'),
                             before, collapsedLeft,
                             after: Math.round(host.getBoundingClientRect().left) })`,
    (v) => {
      const d = JSON.parse(v);
      return d.collapsed && d.expanded && d.after === d.before && d.collapsedLeft < d.before;
    },
  );

  await check(
    'sidebar: peek opens on rest, and floats over rather than pushing',
    `const s = H.q('#sidebar'), host = H.q('#view-day');
     H.q('#sidebar-toggle').click(); await H.sleep(300);
     const leftBefore = Math.round(host.getBoundingClientRect().left);
     s.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
     await H.sleep(400);
     const peeked = s.classList.contains('peek');
     const leftDuring = Math.round(host.getBoundingClientRect().left);
     s.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
     await H.sleep(200);
     H.q('#sidebar-toggle').click(); await H.sleep(300);
     return JSON.stringify({ peeked, leftBefore, leftDuring })`,
    (v) => {
      const d = JSON.parse(v);
      return d.peeked && d.leftDuring === d.leftBefore;
    },
  );

  await check(
    'sidebar: a quick sweep across does not open the peek',
    `const s = H.q('#sidebar');
     H.q('#sidebar-toggle').click(); await H.sleep(300);
     s.dispatchEvent(new MouseEvent('mouseenter'));
     await H.sleep(80);
     s.dispatchEvent(new MouseEvent('mouseleave'));
     await H.sleep(300);
     const peeked = s.classList.contains('peek');
     H.q('#sidebar-toggle').click(); await H.sleep(300);
     return String(peeked)`,
    eq('false'),
  );
}

async function dragging() {
  await check(
    'click a task row: timer starts, no entry created',
    `await H.resetDay();
     H.click(H.firstTask()); await H.sleep(600);
     const running = H.q('#start-stop-btn').classList.contains('btn-stop');
     const n = H.entries().length;
     H.click(H.q('#start-stop-btn')); await H.sleep(500);
     await H.resetDay();
     return JSON.stringify({ running, n })`,
    (v) => {
      const d = JSON.parse(v);
      return d.running === true && d.n === 0;
    },
  );

  await check(
    'four sloppy clicks on task rows: every one starts a timer, none creates an entry',
    `await H.resetDay();
     let started = 0, created = 0;
     for (let i = 0; i < 4; i++) {
       const row = H.all('.task-item')[i];
       const r = row.getBoundingClientRect();
       const x = Math.round(r.left + 30), y = Math.round(r.top + r.height / 2);
       H.mouse(row, 'mousedown', x, y, 1);
       H.mouse(document, 'mousemove', x + 3, y + 2, 1);   // under the 6px threshold
       H.mouse(document, 'mouseup', x + 3, y + 2, 0);
       row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x + 3, clientY: y + 2 }));
       await H.sleep(400);
       if (H.q('#start-stop-btn').classList.contains('btn-stop')) started++;
       created = Math.max(created, H.entries().length);
     }
     H.click(H.q('#start-stop-btn')); await H.sleep(400);
     await H.resetDay();
     return JSON.stringify({ started, created })`,
    (v) => {
      const d = JSON.parse(v);
      return d.started === 4 && d.created === 0;
    },
  );

  await check(
    'press a task, move sideways only, release off the grid: nothing created',
    `await H.resetDay();
     const row = H.firstTask(); const r = row.getBoundingClientRect();
     const x = Math.round(r.left + 30), y = Math.round(r.top + r.height / 2);
     H.mouse(row, 'mousedown', x, y, 1);
     for (const dx of [20, 60, 120]) H.mouse(document, 'mousemove', x + dx, y, 1);
     H.mouse(document, 'mouseup', x + 120, y, 0);
     await H.sleep(500);
     const n = H.entries().length;
     const toasts = H.all('.toast').length;
     await H.resetDay();
     return JSON.stringify({ n, toasts })`,
    (v) => {
      const d = JSON.parse(v);
      return d.n === 0 && d.toasts === 0;
    },
  );

  await check(
    'drag a task onto the timeline: ghost follows, dashed preview shows a quarter-hour range',
    `await H.resetDay();
     const row = H.firstTask(); const r = row.getBoundingClientRect();
     const sx = Math.round(r.left + 20), sy = Math.round(r.top + r.height / 2);
     const tx = H.gridX(), ty = await H.showHour('11:00');
     H.mouse(row, 'mousedown', sx, sy, 1);
     let preview = '', dashed = '';
     for (let i = 1; i <= 5; i++) {
       H.mouse(document, 'mousemove', Math.round(sx + (tx - sx) * i / 5), Math.round(sy + (ty - sy) * i / 5), 1);
       await H.sleep(60);
       const el = H.q('.sched-drop-preview');
       if (el) { preview = el.textContent; dashed = getComputedStyle(el).borderStyle; }
     }
     const ghost = !!H.q('.drag-ghost');
     const ghostText = H.q('.drag-ghost')?.textContent ?? '';
     H.mouse(document, 'mouseup', tx, ty, 0);
     await H.sleep(500);
     const entries = H.entries();
     await H.resetDay();
     return JSON.stringify({ ghost, ghostText, preview, dashed, entries })`,
    (v) => {
      const d = JSON.parse(v);
      return d.ghost && /^\d\d:\d\d – \d\d:\d\d$/.test(d.preview) && d.dashed === 'dashed' &&
        d.entries.length === 1 && d.entries[0].range === '11:00-11:30' &&
        d.entries[0].status.includes('pending');
    },
  );

  await check(
    'drop lands where the preview said, at 0.5x / 1x / 2x / 3x zoom',
    `const out = [];
     for (const idx of [0, 2, 4, 5]) {
       // Set zoom by clicking the buttons until the label matches the level.
       const levels = [0.5, 0.75, 1, 1.5, 2, 3];
       let guard = 0;
       while (H.q('#zoom-lbl').textContent !== levels[idx] + '×' && guard++ < 12) {
         const cur = levels.indexOf(parseFloat(H.q('#zoom-lbl').textContent));
         H.q(cur < idx ? '#zoom-in' : '#zoom-out').click();
         await H.sleep(120);
       }
       await H.resetDay();
       // The zoom change re-renders the grid behind an await, so wait for the
       // hour line to stop moving before measuring where to drop.
       let ty = null, prev = null;
       for (let w = 0; w < 12; w++) {
         await H.sleep(150);
         ty = await H.showHour('14:00');
         if (ty !== null && ty === prev) break;
         prev = ty;
       }
       const row = H.firstTask();
       if (ty === null) { out.push({ zoom: levels[idx], skipped: 'no 14:00 label' }); continue; }
       // Drag by hand so the preview can be read mid-gesture: the checklist asks
       // that the entry land where the preview said, not at a hour picked here.
       const rr = row.getBoundingClientRect();
       const sx = Math.round(rr.left + 20), sy = Math.round(rr.top + rr.height / 2);
       const tx = H.gridX();
       H.mouse(row, 'mousedown', sx, sy, 1);
       let preview = '';
       for (let i = 1; i <= 5; i++) {
         H.mouse(document, 'mousemove', Math.round(sx + (tx - sx) * i / 5), Math.round(sy + (ty - sy) * i / 5), 1);
         await H.sleep(90);
         preview = H.q('.sched-drop-preview')?.textContent ?? preview;
       }
       H.mouse(document, 'mouseup', tx, ty, 0);
       await H.sleep(500);
       out.push({ zoom: levels[idx], preview, entries: H.entries().map(e => e.range) });
     }
     await H.resetDay();
     return JSON.stringify(out)`,
    (v) => JSON.parse(v).every((r) => r.skipped ||
      (r.entries.length === 1 && r.preview.replace(/\s*–\s*/, '-') === r.entries[0])),
  );

  await check(
    'Escape mid-drag: ghost and preview vanish, nothing created',
    `await H.resetDay();
     const row = H.firstTask(); const r = row.getBoundingClientRect();
     const sx = Math.round(r.left + 20), sy = Math.round(r.top + r.height / 2);
     const tx = H.gridX(), ty = await H.showHour('12:00');
     H.mouse(row, 'mousedown', sx, sy, 1);
     for (let i = 1; i <= 4; i++)
       H.mouse(document, 'mousemove', Math.round(sx + (tx - sx) * i / 4), Math.round(sy + (ty - sy) * i / 4), 1);
     await H.sleep(100);
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
     await H.sleep(150);
     const gone = !H.q('.drag-ghost') && !H.q('.sched-drop-preview');
     H.mouse(document, 'mouseup', tx, ty, 0);
     await H.sleep(400);
     const n = H.entries().length;
     await H.resetDay();
     return JSON.stringify({ gone, n })`,
    (v) => {
      const d = JSON.parse(v);
      return d.gone && d.n === 0;
    },
  );

  await check(
    'the same issue dropped twice an hour apart: two entries, no merge prompt',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(500);
     await H.dragToHour(H.firstTask(), '10:00'); await H.sleep(500);
     const modal = !H.q('#modal-overlay').classList.contains('hidden');
     const ranges = H.entries().map(e => e.range);
     await H.resetDay();
     return JSON.stringify({ modal, ranges })`,
    (v) => {
      const d = JSON.parse(v);
      return d.modal === false && JSON.stringify(d.ranges) === JSON.stringify(['09:00-09:30', '10:00-10:30']);
    },
  );

  await check(
    'dropping on top of an existing entry: both flagged, timeline splits into columns',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(500);
     await H.dragToHour(H.all('.task-item')[1], '09:00'); await H.sleep(500);
     const flagged = H.entries().filter(e => e.overlapping).length;
     const ids = new Set(H.all('.entry-card:not(.external)').map(c => c.dataset.id));
     const widths = H.all('.sched-entry-block').filter(b => ids.has(b.dataset.id)).map(b => b.style.width || 'full');
     await H.resetDay();
     return JSON.stringify({ flagged, widths })`,
    (v) => {
      const d = JSON.parse(v);
      return d.flagged === 2 && d.widths.length === 2 && d.widths.every((w) => w !== 'full');
    },
  );

  await check(
    'dragging across the collapsed rail does not open the peek',
    `await H.resetDay();
     H.q('#sidebar-toggle').click(); await H.sleep(300);
     const row = H.firstTask(); const r = row.getBoundingClientRect();
     const sx = Math.round(r.left + 20), sy = Math.round(r.top + r.height / 2);
     H.mouse(row, 'mousedown', sx, sy, 1);
     H.mouse(document, 'mousemove', sx - 40, sy, 1);
     H.q('#sidebar').dispatchEvent(new MouseEvent('mouseenter'));
     H.mouse(document, 'mousemove', 20, sy, 1);
     await H.sleep(400);
     const peeked = H.q('#sidebar').classList.contains('peek');
     H.mouse(document, 'mouseup', 20, sy, 0);
     await H.sleep(300);
     H.q('#sidebar-toggle').click(); await H.sleep(300);
     await H.resetDay();
     return String(peeked)`,
    eq('false'),
  );

  await check(
    'a drop on a past day stays on that day',
    `await H.resetDay();
     H.q('#prev-day').click(); await H.sleep(600);
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     const onPast = H.entries().length;
     H.q('#today-btn').click(); await H.sleep(600);
     const onToday = H.entries().length;
     H.q('#prev-day').click(); await H.sleep(600);
     const stillThere = H.entries().length;
     // Clean the past day up.
     const d = new Date(); d.setDate(d.getDate() - 1);
     const p = (n) => String(n).padStart(2, '0');
     await window.joggl.days.save(d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()), []);
     H.q('#today-btn').click(); await H.sleep(400);
     return JSON.stringify({ onPast, onToday, stillThere })`,
    (v) => {
      const d = JSON.parse(v);
      return d.onPast === 1 && d.onToday === 0 && d.stillThere === 1;
    },
  );
}

async function timeSafety() {
  await check(
    'a block booked ahead is never absorbed by a timer started now',
    `await H.resetDay();
     const key = H.all('.task-item')[0].dataset.key;
     const now = Date.now();
     const at = new Date(now); at.setHours(at.getHours() + 2, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'booked', issueKey: key, issueId: null, title: 'Booked ahead',
       startTs: at.getTime(), endTs: at.getTime() + 1800000,
       status: 'pending', worklogId: null, errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(500);
     H.backdateStart(5); H.click(H.firstTask()); await H.sleep(700);
     const prompted = !H.q('#modal-overlay').classList.contains('hidden');
     if (prompted) H.all('#modal-buttons button')[0].click();
     await H.sleep(300);
     H.click(H.q('#start-stop-btn')); await H.sleep(800);
     const n = H.entries().length;
     await H.resetDay();
     return JSON.stringify({ prompted, n })`,
    (v) => {
      const d = JSON.parse(v);
      return d.prompted === false && d.n === 2;
    },
  );

  await check(
    'a past entry under 30 minutes old merges silently',
    `await H.resetDay();
     const key = H.all('.task-item')[0].dataset.key;
     const end = Date.now() - 10 * 60000;
     await window.joggl.days.save(H.todayKey(), [{
       id: 'recent', issueKey: key, issueId: null, title: 'Earlier',
       startTs: end - 1800000, endTs: end,
       status: 'pending', worklogId: null, errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(500);
     H.backdateStart(5); H.click(H.firstTask()); await H.sleep(700);
     const prompted = !H.q('#modal-overlay').classList.contains('hidden');
     if (prompted) H.all('#modal-buttons button').at(-1).click();
     await H.sleep(200);
     H.click(H.q('#start-stop-btn')); await H.sleep(800);
     const n = H.entries().length;
     await H.resetDay();
     return JSON.stringify({ prompted, n })`,
    (v) => {
      const d = JSON.parse(v);
      return d.prompted === false && d.n === 1;
    },
  );

  await check(
    'a gap over 30 minutes asks instead of merging',
    `await H.resetDay();
     const key = H.all('.task-item')[0].dataset.key;
     const end = Date.now() - 90 * 60000;
     await window.joggl.days.save(H.todayKey(), [{
       id: 'older', issueKey: key, issueId: null, title: 'Much earlier',
       startTs: end - 1800000, endTs: end,
       status: 'pending', worklogId: null, errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(500);
     H.click(H.firstTask()); await H.sleep(900);
     const prompted = !H.q('#modal-overlay').classList.contains('hidden');
     const labels = H.all('#modal-buttons button').map(b => b.textContent);
     if (prompted) H.all('#modal-buttons button')[0].click();
     await H.sleep(300);
     if (H.q('#start-stop-btn').classList.contains('btn-stop')) { H.click(H.q('#start-stop-btn')); await H.sleep(600); }
     await H.resetDay();
     return JSON.stringify({ prompted, labels })`,
    (v) => {
      const d = JSON.parse(v);
      return d.prompted === true && d.labels.includes('Merge into one') && d.labels.includes('Keep separate');
    },
  );

  await check(
    'a running timer refuses a start time in the future',
    `await H.resetDay();
     H.backdateStart(5); H.click(H.firstTask()); await H.sleep(700);
     const inp = H.q('#start-time-input');
     const p = (n) => String(n).padStart(2, '0');
     // A time later *today*. "now + 3h" wraps past midnight late in the evening,
     // and the field resolves HH:MM against the selected day — so 02:00 would be
     // this morning, legitimately in the past, and the check would test nothing.
     const nowH = new Date().getHours();
     if (nowH >= 23) {
       H.click(H.q('#start-stop-btn')); await H.sleep(600);
       await H.resetDay();
       return 'SKIP no future hour left in the day';
     }
     const targetH = Math.min(nowH + 3, 23);
     inp.value = p(targetH) + ':00';
     inp.dispatchEvent(new Event('input'));
     inp.dispatchEvent(new FocusEvent('blur'));
     await H.sleep(400);
     const warned = H.all('.toast').some(t => /future/i.test(t.textContent));
     const reverted = inp.value !== p(targetH) + ':00';
     H.click(H.q('#start-stop-btn')); await H.sleep(600);
     await H.resetDay();
     return JSON.stringify({ warned, reverted })`,
    (v) => {
      if (typeof v === 'string' && v.startsWith('SKIP')) return 'skipped';
      const d = JSON.parse(v);
      return d.warned && d.reverted;
    },
  );

  await check(
    'a hand-drawn entry in the future can still have its start edited',
    `await H.resetDay();
     const at = new Date(); at.setHours(at.getHours() + 3, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'ahead', issueKey: 'X-1', issueId: null, title: 'Leave',
       startTs: at.getTime(), endTs: at.getTime() + 1800000,
       status: 'pending', worklogId: null, errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(500);
     const card = H.q('.entry-card[data-id="ahead"]');
     const start = card.querySelector('[data-f="start"]');
     const disabled = start.disabled;
     const p = (n) => String(n).padStart(2, '0');
     const want = p((at.getHours() + 23) % 24) + ':00';
     start.value = want;
     start.dispatchEvent(new FocusEvent('blur'));
     await H.sleep(400);
     const now = H.q('.entry-card[data-id="ahead"] [data-f="start"]').value;
     await H.resetDay();
     return JSON.stringify({ disabled, want, now })`,
    (v) => {
      const d = JSON.parse(v);
      return d.disabled === false && d.now === d.want;
    },
  );

  await check(
    'entries dragged from the day list move; Jira-side rows do not',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(500);
     const before = H.entries()[0].range;
     await H.dragToHour(H.q('.entry-card'), '15:00'); await H.sleep(600);
     const after = H.entries()[0].range;
     await H.resetDay();
     return JSON.stringify({ before, after })`,
    (v) => {
      const d = JSON.parse(v);
      return d.before === '09:00-09:30' && d.after === '15:00-15:30';
    },
  );

  await check(
    'a pinned issue can be dragged onto the day view',
    `await H.resetDay();
     await H.clearPins();
     H.q('#add-pin-btn').click(); await H.sleep(250);
     const inp = H.q('#pin-search-input');
     inp.value = H.all('.task-item')[0].querySelector('.task-dd-title').textContent.slice(0, 12);
     inp.dispatchEvent(new Event('input')); await H.sleep(350);
     const btn = H.all('#pin-results button').find(b => b.textContent === 'Pin');
     if (btn) btn.click();
     await H.sleep(350);
     H.q('#close-pin').click(); await H.sleep(250);
     const chips = H.all('.pin-chip').length;
     if (chips) { await H.dragToHour(H.q('.pin-chip'), '16:00'); await H.sleep(600); }
     const ranges = H.entries().map(e => e.range);
     await H.clearPins();
     await H.resetDay();
     return JSON.stringify({ chips, ranges })`,
    (v) => {
      const d = JSON.parse(v);
      return d.chips === 1 && JSON.stringify(d.ranges) === JSON.stringify(['16:00-16:30']);
    },
  );
}

async function quickEntry() {
  await check(
    'clicking the grid opens a visible, focused quick entry at the clicked hour',
    `await H.resetDay();
     const y = await H.showHour('13:00');
     H.q('#schedule-grid').dispatchEvent(new MouseEvent('click', {
       bubbles: true, cancelable: true, clientX: H.gridX(), clientY: y }));
     await H.sleep(500);
     const el = H.q('.sched-quick-entry');
     const out = { time: H.q('.sched-quick-entry-time')?.textContent ?? 'NONE',
                   visible: el ? getComputedStyle(el).visibility : 'none',
                   focused: document.activeElement?.tagName,
                   inWindow: el ? (el.getBoundingClientRect().right <= window.innerWidth &&
                                   el.getBoundingClientRect().bottom <= window.innerHeight) : false };
     document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
     await H.sleep(200);
     return JSON.stringify(out)`,
    (v) => {
      const d = JSON.parse(v);
      return d.time === '13:00 – 13:30' && d.visible === 'visible' && d.focused === 'INPUT' && d.inWindow;
    },
  );

  await check(
    'the omnibar search does not recurse and finds issues beyond the loaded list',
    `const i = H.q('#task-input');
     i.focus(); i.value = 'meeting'; i.dispatchEvent(new Event('input'));
     await H.sleep(1800);
     const rows = H.all('#task-dropdown .task-dd-item').length;
     const sep = !!H.q('#task-dropdown .task-dd-sep');
     i.value = ''; i.dispatchEvent(new Event('input')); i.blur();
     await H.sleep(200);
     return JSON.stringify({ rows, sep })`,
    (v) => {
      const d = JSON.parse(v);
      return d.rows > 0 && d.sep === true;
    },
  );
}

async function dayPanel() {
  await check(
    '"On this day" is a titled panel, open by default, counting the day\'s entries',
    `await H.resetDay();
     const hdr = H.q('#day-panel-hdr');
     const openAtStart = !H.q('#entry-list').hidden;
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     // The count is every row the panel shows, Jira-side worklogs included —
     // it answers "is there anything in this day", not "how many are mine".
     const count = H.q('#day-count').textContent;
     const rows = H.all('.entry-card').length;
     await H.resetDay();
     return JSON.stringify({
       title: hdr.querySelector('span').textContent.replace(/[▼▶]/g, '').trim(),
       openAtStart, count, rows,
       expanded: hdr.getAttribute('aria-expanded'),
     })`,
    (v) => {
      const d = JSON.parse(v);
      return d.title === 'On this day' && d.openAtStart === true &&
        d.count === String(d.rows) && d.rows >= 1 && d.expanded === 'true';
    },
  );

  await check(
    '"On this day" collapses and reopens, and the count survives the collapse',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     const hdr = H.q('#day-panel-hdr'), list = H.q('#entry-list');
     const rows = H.all('.entry-card').length;
     hdr.click(); await H.sleep(250);
     const collapsed = list.hidden;
     const countWhileShut = H.q('#day-count').textContent;
     const ariaShut = hdr.getAttribute('aria-expanded');
     hdr.click(); await H.sleep(250);
     const reopened = !list.hidden;
     await H.resetDay();
     return JSON.stringify({ collapsed, countWhileShut, ariaShut, reopened, rows })`,
    (v) => {
      const d = JSON.parse(v);
      return d.collapsed === true && d.countWhileShut === String(d.rows) &&
        d.ariaShut === 'false' && d.reopened === true;
    },
  );

  await check(
    'the collapsed state is remembered across a day change',
    `await H.resetDay();
     H.q('#day-panel-hdr').click(); await H.sleep(300);
     H.q('#prev-day').click(); await H.sleep(700);
     const stillShut = H.q('#entry-list').hidden;
     H.q('#today-btn').click(); await H.sleep(700);
     const stillShutToday = H.q('#entry-list').hidden;
     H.q('#day-panel-hdr').click(); await H.sleep(300);
     await H.resetDay();
     return JSON.stringify({ stillShut, stillShutToday })`,
    (v) => {
      const d = JSON.parse(v);
      return d.stillShut === true && d.stillShutToday === true;
    },
  );
}

async function editTask() {
  await check(
    'Edit task is the first item on a day-view block\'s menu',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     H.q('.sched-entry-block').dispatchEvent(new MouseEvent('contextmenu', {
       bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
     await H.sleep(250);
     const items = H.all('.ctx-item').map(i => i.textContent.replace(/^\\W+/, ''));
     document.body.click(); await H.sleep(150);
     await H.resetDay();
     return JSON.stringify(items)`,
    (v) => JSON.parse(v)[0] === 'Edit task',
  );

  await check(
    'Edit task swaps the issue and leaves the times exactly as they were',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     const before = H.entries()[0];
     H.q('.sched-entry-block').dispatchEvent(new MouseEvent('contextmenu', {
       bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
     await H.sleep(250);
     H.all('.ctx-item').find(i => i.textContent.includes('Edit task')).click();
     await H.sleep(400);
     const opened = !H.q('#modal-overlay').classList.contains('hidden');
     const focused = document.activeElement?.tagName;
     // Pick a different issue than the one dropped.
     const rows = H.all('.issue-picker-results .task-dd-item');
     const pick = rows.find(r => r.querySelector('.jira-chip').textContent !== before.key);
     const wanted = pick?.querySelector('.jira-chip').textContent ?? null;
     pick?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
     await H.sleep(600);
     const after = H.entries()[0];
     await H.resetDay();
     return JSON.stringify({ opened, focused, wanted, before, after })`,
    (v) => {
      const d = JSON.parse(v);
      return d.opened && d.focused === 'INPUT' && d.wanted &&
        d.after.key === d.wanted && d.after.key !== d.before.key &&
        d.after.range === d.before.range;
    },
  );

  await check(
    'Edit task is refused on an entry already logged in Jira',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'synced1', issueKey: 'X-1', issueId: null, title: 'Already logged',
       startTs: at.getTime(), endTs: at.getTime() + 1800000,
       status: 'synced', worklogId: '99999', errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(600);
     H.q('.sched-entry-block[data-id="synced1"]').dispatchEvent(new MouseEvent('contextmenu', {
       bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
     await H.sleep(250);
     H.all('.ctx-item').find(i => i.textContent.includes('Edit task')).click();
     await H.sleep(400);
     const modalOpen = !H.q('#modal-overlay').classList.contains('hidden');
     const warned = H.all('.toast').some(t => /cannot be moved to another issue/i.test(t.textContent));
     const unchanged = H.entries()[0]?.key;
     await H.resetDay();
     return JSON.stringify({ modalOpen, warned, unchanged })`,
    (v) => {
      const d = JSON.parse(v);
      return d.modalOpen === false && d.warned === true && d.unchanged === 'X-1';
    },
  );
}

async function keyboard() {
  const press = (sel, key, mods = {}) => `
     H.q(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', {
       key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)} }));`;

  await check(
    'arrow keys walk the omnibar results and Enter starts the highlighted one',
    `await H.resetDay();
     const i = H.q('#task-input');
     i.focus(); i.value = 'e'; i.dispatchEvent(new Event('input'));
     await H.sleep(600);
     const rows = H.all('#task-dropdown .task-dd-item').length;
     ${press('#task-input', 'ArrowDown')}
     ${press('#task-input', 'ArrowDown')}
     await H.sleep(150);
     const marked = H.all('#task-dropdown .is-keynav-active').length;
     const secondRow = H.all('#task-dropdown .task-dd-item')[1];
     const wanted = JSON.parse(secondRow.dataset.issue).issueKey;
     const isSecond = secondRow.classList.contains('is-keynav-active');
     ${press('#task-input', 'Enter')}
     await H.sleep(800);
     const started = H.q('#start-stop-btn').classList.contains('btn-stop');
     const onIssue = H.runningKey();
     H.click(H.q('#start-stop-btn')); await H.sleep(500);
     await H.resetDay();
     return JSON.stringify({ rows, marked, isSecond, wanted, started, onIssue })`,
    (v) => {
      const d = JSON.parse(v);
      return d.rows > 1 && d.marked === 1 && d.isSecond && d.started && d.onIssue === d.wanted;
    },
  );

  await check(
    'nothing is highlighted until an arrow key, so Enter keeps its old meaning',
    `await H.resetDay();
     const i = H.q('#task-input');
     i.focus(); i.value = 'a local thing that matches nothing';
     i.dispatchEvent(new Event('input'));
     await H.sleep(700);
     const marked = H.all('#task-dropdown .is-keynav-active').length;
     ${press('#task-input', 'Enter')}
     await H.sleep(800);
     // Enter with no highlighted row still starts the free text as a local entry.
     const started = H.q('#start-stop-btn').classList.contains('btn-stop');
     const label = H.q('#task-input').value;
     H.click(H.q('#start-stop-btn')); await H.sleep(500);
     await H.resetDay();
     return JSON.stringify({ marked, started, label })`,
    (v) => {
      const d = JSON.parse(v);
      return d.marked === 0 && d.started && d.label.includes('a local thing');
    },
  );

  await check(
    'the pin picker takes arrows too, and Enter pins the highlighted issue',
    `await H.resetDay();
     await H.clearPins();
     H.q('#add-pin-btn').click(); await H.sleep(400);
     ${press('#pin-search-input', 'ArrowDown')}
     ${press('#pin-search-input', 'ArrowDown')}
     await H.sleep(150);
     const rows = H.all('#pin-results .task-dd-item');
     const marked = H.all('#pin-results .is-keynav-active').length;
     const isSecond = rows[1].classList.contains('is-keynav-active');
     const wanted = rows[1].querySelector('.jira-chip').textContent;
     ${press('#pin-search-input', 'Enter')}
     await H.sleep(400);
     // Pinning re-renders the list, so rows[1] is detached by now — find it again.
     const label = H.all('#pin-results .task-dd-item')
       .find(r => r.querySelector('.jira-chip').textContent === wanted)
       ?.querySelector('button').textContent ?? null;
     H.q('#close-pin').click(); await H.sleep(200);
     const pinned = H.all('.pin-chip').map(c => c.dataset.key);
     await H.clearPins();
     return JSON.stringify({ count: rows.length, marked, isSecond, wanted, label, pinned })`,
    (v) => {
      const d = JSON.parse(v);
      return d.count > 1 && d.marked === 1 && d.isSecond &&
        d.label === 'Unpin' && JSON.stringify(d.pinned) === JSON.stringify([d.wanted]);
    },
  );

  await check(
    'Ctrl+L reaches the omnibar and Ctrl+Enter resumes the last entry',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     const wanted = H.entries()[0].key;
     document.body.focus();
     ${press('body', 'l', { ctrlKey: true })}
     await H.sleep(200);
     const focused = document.activeElement?.id;
     H.q('#task-input').blur(); H.q('#task-input').value = '';
     document.body.focus();
     ${press('body', 'Enter', { ctrlKey: true })}
     await H.sleep(900);
     // Resuming an issue already booked earlier today is a merge decision, and
     // the prompt is the correct answer to it — the timer starts once it is
     // answered. Keep them separate, so nothing swallows the dropped block.
     const prompted = !H.q('#modal-overlay').classList.contains('hidden');
     if (prompted) {
       H.all('#modal-buttons button').find(b => /keep separate/i.test(b.textContent))?.click();
       await H.sleep(600);
     }
     const running = H.q('#start-stop-btn').classList.contains('btn-stop');
     const onIssue = H.runningKey();
     H.click(H.q('#start-stop-btn')); await H.sleep(600);
     await H.resetDay();
     return JSON.stringify({ focused, prompted, running, onIssue, wanted })`,
    (v) => {
      const d = JSON.parse(v);
      return d.focused === 'task-input' && d.running && d.onIssue === d.wanted;
    },
  );

  await check(
    'the day can be stepped with [ ] and T, but not while typing',
    `await H.resetDay();
     const label = () => H.q('#current-date-label').textContent;
     const start = label();
     ${press('body', '[')}
     await H.sleep(700);
     const back = label();
     ${press('body', 'T')}
     await H.sleep(700);
     const home = label();
     // The same key inside the omnibar must reach the text, not the day.
     const i = H.q('#task-input'); i.focus(); i.value = '';
     ${press('#task-input', '[')}
     await H.sleep(400);
     const unmoved = label();
     i.blur();
     await H.resetDay();
     return JSON.stringify({ start, back, home, unmoved })`,
    (v) => {
      const d = JSON.parse(v);
      return d.back !== d.start && d.home === d.start && d.unmoved === d.start;
    },
  );

  await check(
    'the entry list is one tab stop, and arrows move focus inside it',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(500);
     await H.dragToHour(H.all('.task-item')[1], '11:00'); await H.sleep(600);
     const cards = H.all('.entry-card');
     const stops = cards.filter(c => c.tabIndex === 0).length;
     cards[0].focus();
     // On the focused row, not on the list: a real key event targets whatever has
     // focus and bubbles up, and dispatching on the container instead makes
     // event.target the container, which the handler correctly ignores.
     //
     // document.activeElement rather than H.q(':focus') — the pseudo-class stops
     // matching the moment the window is not the foreground one, which would make
     // this check pass or throw depending on where the user clicked last.
     document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
       key: 'ArrowDown', bubbles: true, cancelable: true }));
     await H.sleep(150);
     const movedTo = H.all('.entry-card').indexOf(document.activeElement);
     await H.resetDay();
     return JSON.stringify({ count: cards.length, stops, movedTo })`,
    (v) => {
      const d = JSON.parse(v);
      return d.count >= 2 && d.stops === 1 && d.movedTo === 1;
    },
  );

  await check(
    'Enter on a focused row opens the menu, arrows walk it, Escape returns focus',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     const card = H.q('.entry-card');
     card.focus();
     ${press('.entry-card', 'Enter')}
     await H.sleep(300);
     const opened = !H.q('#ctx-menu').classList.contains('hidden');
     const menuFocused = document.activeElement?.id === 'ctx-menu';
     const role = H.q('#ctx-menu').getAttribute('role');
     ${press('#ctx-menu', 'ArrowDown')}
     ${press('#ctx-menu', 'ArrowDown')}
     await H.sleep(150);
     const active = H.q('#ctx-menu .is-keynav-active')?.textContent ?? null;
     ${press('#ctx-menu', 'Escape')}
     await H.sleep(250);
     const closed = H.q('#ctx-menu').classList.contains('hidden');
     const backOnRow = document.activeElement?.classList.contains('entry-card');
     await H.resetDay();
     return JSON.stringify({ opened, menuFocused, role, active, closed, backOnRow })`,
    (v) => {
      const d = JSON.parse(v);
      return d.opened && d.menuFocused && d.role === 'menu' &&
        d.active?.includes('Work description') && d.closed && d.backOnRow;
    },
  );

  await check(
    'Enter in the menu runs the highlighted item',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     H.q('.entry-card').focus();
     ${press('.entry-card', 'Enter')}
     await H.sleep(300);
     // Second item is Work description; open it from the keyboard alone.
     ${press('#ctx-menu', 'ArrowDown')}
     ${press('#ctx-menu', 'ArrowDown')}
     ${press('#ctx-menu', 'Enter')}
     await H.sleep(500);
     const dialog = H.q('#modal-title')?.textContent ?? '';
     const focused = document.activeElement?.tagName;
     const role = H.q('#modal-overlay .panel')?.getAttribute('role');
     H.all('#modal-buttons button')[0].click();
     await H.sleep(300);
     const backOnRow = document.activeElement?.classList.contains('entry-card');
     await H.resetDay();
     return JSON.stringify({ dialog, focused, role, backOnRow })`,
    (v) => {
      const d = JSON.parse(v);
      return d.dialog.startsWith('Work description') && d.focused === 'TEXTAREA' &&
        d.role === 'dialog' && d.backOnRow;
    },
  );

  await check(
    'Tab cannot walk out of an open modal',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     H.q('.entry-card').focus();
     ${press('.entry-card', 'Enter')}
     await H.sleep(250);
     ${press('#ctx-menu', 'ArrowDown')}
     ${press('#ctx-menu', 'ArrowDown')}
     ${press('#ctx-menu', 'Enter')}
     await H.sleep(500);
     const overlay = H.q('#modal-overlay');
     // Walk further than there are stops; focus must still be inside.
     let inside = true;
     for (let n = 0; n < 8; n++) {
       document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
       await H.sleep(60);
       if (!overlay.contains(document.activeElement)) inside = false;
     }
     H.all('#modal-buttons button')[0].click();
     await H.sleep(300);
     await H.resetDay();
     return String(inside)`,
    eq('true'),
  );
}

async function dateJump() {
  // On the focused element, not on a selector: a calendar cell is replaced on every
  // cursor move, and `:focus` stops matching when the window is not foreground.
  const press = (key) => `
     document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
       key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));`;
  /** dd.mm.yyyy, the form the day header writes. */
  const asLabel = (key) => {
    const [y, m, d] = key.split('-');
    return `${d}.${m}.${y}`;
  };
  const shift = (key, days) => {
    const [y, m, d] = key.split('-').map(Number);
    const at = new Date(y, m - 1, d);
    at.setDate(at.getDate() + days);
    const p = (n) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
  };

  await check(
    'the date label opens a calendar, and clicking a day jumps to it',
    `await H.resetDay();
     const before = H.q('#current-date-label').textContent;
     H.click(H.q('#current-date-label')); await H.sleep(400);
     const opened = !H.q('#modal-overlay').classList.contains('hidden');
     const month = H.q('.date-picker-month')?.textContent ?? null;
     const cells = H.all('.date-cell').length;
     const onCell = document.activeElement?.classList.contains('date-cell') ?? false;
     const marks = { today: H.all('.date-cell.is-today').length,
                     selected: H.all('.date-cell.is-selected').length };
     // One tab stop for forty-two cells, or Tab inside the dialog is unusable.
     const tabStops = H.all('.date-cell').filter(c => c.tabIndex === 0).length;
     const key = H.todayKey();
     const blocked = H.all('.date-cell').filter(c => c.disabled).map(c => c.dataset.key);
     const onlyFutureBlocked = blocked.length > 0 && blocked.every(k => k > key);
     const first = H.all('.date-cell:not(.outside)')[0];
     const wanted = first.dataset.key;
     H.click(first); await H.sleep(800);
     const closed = H.q('#modal-overlay').classList.contains('hidden');
     const label = H.q('#current-date-label').textContent;
     await H.resetDay();
     return JSON.stringify({ before, opened, month, cells, onCell, marks, tabStops,
                             onlyFutureBlocked, wanted, closed, label })`,
    (v) => {
      const d = JSON.parse(v);
      return d.opened && /\s\d{4}$/.test(d.month) && d.cells === 42 && d.onCell &&
        d.marks.today === 1 && d.marks.selected === 1 && d.tabStops === 1 &&
        d.onlyFutureBlocked && d.closed && d.label.includes(asLabel(d.wanted));
    },
  );

  await check(
    'arrows move the calendar a day and a week, Page Up a month, Enter takes it',
    `await H.resetDay();
     H.click(H.q('#current-date-label')); await H.sleep(400);
     const cursor = () => H.q('.date-cell[tabindex="0"]').dataset.key;
     const start = cursor();
     const startMonth = H.q('.date-picker-month').textContent;
     ${press('ArrowLeft')}
     await H.sleep(150);
     const left = cursor();
     ${press('ArrowUp')}
     await H.sleep(150);
     const up = cursor();
     ${press('PageUp')}
     await H.sleep(200);
     const month = H.q('.date-picker-month').textContent;
     const stillOnCell = document.activeElement?.classList.contains('date-cell') ?? false;
     const chosen = cursor();
     document.activeElement.click();
     await H.sleep(800);
     const label = H.q('#current-date-label').textContent;
     await H.resetDay();
     return JSON.stringify({ start, left, up, startMonth, month, stillOnCell, chosen, label })`,
    (v) => {
      const d = JSON.parse(v);
      return d.left === shift(d.start, -1) && d.up === shift(d.left, -7) &&
        d.month !== d.startMonth && d.stillOnCell && d.label.includes(asLabel(d.chosen));
    },
  );

  await check(
    'Page Up and Page Down step a week, stop at today, and stay out of the text',
    `await H.resetDay();
     const label = () => H.q('#current-date-label').textContent;
     const start = label();
     document.body.focus();
     ${press('PageUp')}
     await H.sleep(900);
     const back = label();
     ${press('PageDown')}
     await H.sleep(900);
     const forward = label();
     // Already on today: a week forward has to land on today, not tomorrow.
     ${press('PageDown')}
     await H.sleep(900);
     const clamped = label();
     const nextDisabled = H.q('#next-day').disabled;
     const i = H.q('#task-input'); i.value = ''; i.focus();
     ${press('PageUp')}
     await H.sleep(600);
     const whileTyping = label();
     i.blur();
     await H.resetDay();
     return JSON.stringify({ start, back, forward, clamped, nextDisabled, whileTyping })`,
    (v) => {
      const d = JSON.parse(v);
      return d.back !== d.start && d.forward === d.start && d.clamped === d.start &&
        d.nextDisabled && d.whileTyping === d.start;
    },
  );
}

async function clicks() {
  /** Two entries an hour apart, so a click can pick one and leave the other. */
  const twoEntries = `
     const at = new Date(); at.setHours(9, 0, 0, 0);
     const e = (id, fromMin, toMin) => ({
       id, issueKey: 'X-' + id, issueId: null, title: 'Task ' + id,
       startTs: at.getTime() + fromMin * 60000, endTs: at.getTime() + toMin * 60000,
       status: 'pending', worklogId: null, comment: null, errorMsg: null });
     await window.joggl.days.save(H.todayKey(), [e('one', 0, 30), e('two', 60, 90)]);
     H.q('#today-btn').click(); await H.sleep(300); await H.settle();`;
  const marked = `H.all('.is-selected').map(el =>
       (el.classList.contains('entry-card') ? 'row:' : 'block:') + el.dataset.id).sort()`;

  await check(
    'a click on a block marks it and its row, and only that entry',
    `${twoEntries}
     H.click(H.q('.sched-entry-block[data-id="one"]'));
     await H.sleep(300);
     const selected = ${marked};
     const focused = document.activeElement?.dataset?.id ?? null;
     // A second click on the other one moves the selection rather than adding to it.
     H.click(H.q('.sched-entry-block[data-id="two"]'));
     await H.sleep(300);
     const moved = ${marked};
     await H.resetDay();
     return JSON.stringify({ selected, focused, moved })`,
    (v) => {
      const d = JSON.parse(v);
      return JSON.stringify(d.selected) === JSON.stringify(['block:one', 'row:one']) &&
        d.focused === 'one' &&
        JSON.stringify(d.moved) === JSON.stringify(['block:two', 'row:two']);
    },
  );

  await check(
    'a click on a row marks its block, and empty space puts the selection down',
    `${twoEntries}
     H.click(H.q('.entry-card[data-id="two"] .entry-title'));
     await H.sleep(300);
     const selected = ${marked};
     // The blank space below the rows, and the grid away from every block.
     H.q('#entry-list').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
     await H.sleep(200);
     const afterList = H.all('.is-selected').length;
     H.click(H.q('.entry-card[data-id="two"]'));
     await H.sleep(250);
     const again = H.all('.is-selected').length;
     const y = await H.showHour('16:00');
     H.q('#schedule-grid').dispatchEvent(new MouseEvent('click', {
       bubbles: true, cancelable: true, clientX: H.gridX(), clientY: y }));
     await H.sleep(300);
     const afterGrid = H.all('.is-selected').length;
     document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
     await H.sleep(200);
     await H.resetDay();
     return JSON.stringify({ selected, afterList, again, afterGrid })`,
    (v) => {
      const d = JSON.parse(v);
      return JSON.stringify(d.selected) === JSON.stringify(['block:two', 'row:two']) &&
        d.afterList === 0 && d.again === 2 && d.afterGrid === 0;
    },
  );

  await check(
    'the selection survives a re-render, and a day change puts it down',
    `${twoEntries}
     H.click(H.q('.entry-card[data-id="one"]'));
     await H.sleep(250);
     // Zooming re-renders the whole grid and rebuilds every block.
     H.q('#zoom-in').click(); await H.sleep(400);
     const afterZoom = ${marked};
     H.q('#zoom-out').click(); await H.sleep(400);
     H.q('#prev-day').click(); await H.sleep(400); await H.settle();
     H.q('#today-btn').click(); await H.sleep(400); await H.settle();
     const afterDayChange = H.all('.is-selected').length;
     await H.resetDay();
     return JSON.stringify({ afterZoom, afterDayChange })`,
    (v) => {
      const d = JSON.parse(v);
      return JSON.stringify(d.afterZoom) === JSON.stringify(['block:one', 'row:one']) &&
        d.afterDayChange === 0;
    },
  );

  await check(
    'arrow keys carry the selection with them, so keyboard and mouse agree',
    `${twoEntries}
     const rows = H.all('.entry-card');
     const from = rows.findIndex(r => r.dataset.id === 'one');
     // The next row, whatever it is: a Jira-side worklog can sit between the two
     // entries this check created, and it is a row like any other to the arrows.
     const wanted = rows[from + 1]?.dataset.id ?? null;
     rows[from].focus();
     document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
       key: 'ArrowDown', bubbles: true, cancelable: true }));
     await H.sleep(250);
     const selected = H.all('.is-selected').map(el => el.dataset.id);
     await H.resetDay();
     return JSON.stringify({ wanted, selected })`,
    (v) => {
      const d = JSON.parse(v);
      // One mark if that row has no block on the grid, two if it does — either way
      // every mark must be on the row the arrow landed on.
      return d.wanted !== null && d.selected.length >= 1 &&
        d.selected.every((id) => id === d.wanted);
    },
  );

  await check(
    'a double click on the task name opens Edit task, elsewhere the description',
    `${twoEntries}
     const dbl = (sel) => H.q(sel).dispatchEvent(new MouseEvent('dblclick', {
       bubbles: true, cancelable: true }));
     dbl('.entry-card[data-id="one"] .entry-title');
     await H.sleep(500);
     const onName = H.q('#modal-title')?.textContent ?? null;
     H.all('#modal-buttons button').at(-1)?.click(); await H.sleep(300);
     dbl('.entry-card[data-id="one"] .status-badge');
     await H.sleep(500);
     const elsewhere = H.q('#modal-title')?.textContent ?? null;
     H.all('#modal-buttons button').at(-1)?.click(); await H.sleep(300);
     // A block carries no separate title region, so it always means the description.
     dbl('.sched-entry-block[data-id="one"]');
     await H.sleep(500);
     const onBlock = H.q('#modal-title')?.textContent ?? null;
     H.all('#modal-buttons button').at(-1)?.click(); await H.sleep(300);
     await H.resetDay();
     return JSON.stringify({ onName, elsewhere, onBlock })`,
    (v) => {
      const d = JSON.parse(v);
      return /edit task/i.test(d.onName) && /work description/i.test(d.elsewhere) &&
        /work description/i.test(d.onBlock);
    },
  );

  await check(
    'a double click in a time field is left alone, and never opens a dialog',
    `${twoEntries}
     H.q('.entry-card[data-id="one"] [data-f="start"]').dispatchEvent(
       new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
     await H.sleep(500);
     const opened = !H.q('#modal-overlay').classList.contains('hidden');
     const still = H.entries().map(e => e.range);
     await H.resetDay();
     return JSON.stringify({ opened, still })`,
    (v) => {
      const d = JSON.parse(v);
      return d.opened === false && JSON.stringify(d.still) === JSON.stringify(['09:00-09:30', '10:00-10:30']);
    },
  );

  await check(
    'a Jira-side row can be selected, but a double click on it only warns',
    `H.q('#today-btn').click(); await H.sleep(300); await H.settle();
     const ext = H.q('.entry-card.external');
     if (!ext) return JSON.stringify({ skip: true });
     H.click(ext); await H.sleep(250);
     const selected = H.all('.is-selected').length;
     H.all('.toast').forEach(t => t.remove());
     H.q('.entry-card.external').dispatchEvent(new MouseEvent('dblclick', {
       bubbles: true, cancelable: true }));
     await H.sleep(500);
     const opened = !H.q('#modal-overlay').classList.contains('hidden');
     const warned = H.all('.toast').some(t => /in jira/i.test(t.textContent));
     await H.resetDay();
     return JSON.stringify({ selected, opened, warned })`,
    (v) => {
      const d = JSON.parse(v);
      if (d.skip) return 'skipped';
      // Two marks when the row also has a block on the grid, one when it is off it.
      return d.selected >= 1 && d.opened === false && d.warned === true;
    },
  );

  await check(
    'a double click on the running task does not restart its timer',
    `await H.resetDay();
     const row = H.firstTask();
     H.click(row); await H.sleep(600);
     const running = H.q('#start-stop-btn').classList.contains('btn-stop');
     // Back-dated so a reset is unmistakable: twenty minutes cannot be mistaken for
     // a timer that merely carried on.
     H.backdateStart(20);
     // Past a tick: the display is repainted once a second, so a shorter wait reads
     // the 00:00:00 it held before the back-date and proves nothing either way.
     await H.sleep(1300);
     const before = H.q('#timer-display').textContent;
     // The second click of a double click used to stop and restart, and a fragment
     // under ten seconds old is discarded — the elapsed time simply vanished.
     H.click(H.firstTask()); await H.sleep(700);
     const stillRunning = H.q('#start-stop-btn').classList.contains('btn-stop');
     const after = H.q('#timer-display').textContent;
     const created = H.entries().length;
     H.click(H.q('#start-stop-btn')); await H.sleep(700);
     await H.resetDay();
     return JSON.stringify({ running, before, stillRunning, after, created })`,
    (v) => {
      const d = JSON.parse(v);
      // Zero-padded HH:MM:SS compares as text.
      return d.running && d.before > '00:15:00' && d.stillRunning &&
        d.after > '00:15:00' && d.created === 0;
    },
  );
}

async function overlapNotice() {
  await check(
    'overlaps are counted once above the list, not repeated on every row',
    `const at = new Date(); at.setHours(9, 0, 0, 0);
     const e = (id, fromMin, toMin) => ({
       id, issueKey: 'X-' + id, issueId: null, title: 'Entry ' + id,
       startTs: at.getTime() + fromMin * 60000, endTs: at.getTime() + toMin * 60000,
       status: 'pending', worklogId: null, comment: null, errorMsg: null });
     await window.joggl.days.save(H.todayKey(), [e('a', 0, 60), e('b', 30, 90), e('clear', 180, 210)]);
     H.q('#today-btn').click(); await H.sleep(300); await H.settle();
     const warn = H.all('.entry-list-warn').map(w => w.textContent);
     const flagged = H.all('.entry-card.overlapping').map(c => c.dataset.id).sort();
     // The sentence that used to sit on every clashing row.
     const perRow = H.all('.entry-card .entry-err-row')
       .filter(r => /overlap/i.test(r.textContent)).length;
     // Above the rows it counts, not under them.
     const first = H.q('#entry-list').firstElementChild?.className ?? null;
     await H.resetDay();
     return JSON.stringify({ warn, flagged, perRow, first })`,
    (v) => {
      const d = JSON.parse(v);
      return d.warn.length === 1 && /^⚠ 2 entries overlap$/.test(d.warn[0]) &&
        JSON.stringify(d.flagged) === JSON.stringify(['a', 'b']) && d.perRow === 0 &&
        d.first === 'entry-list-warn';
    },
  );

  await check(
    'a clash with a Jira-side row counts once, and only the row that can be fixed is outlined',
    `H.q('#today-btn').click(); await H.sleep(300); await H.settle();
     const ext = H.q('.entry-card.external');
     if (!ext) return JSON.stringify({ skip: true });
     const extId = ext.dataset.id;
     const [h, m] = ext.querySelector('[data-f="start"]').value.split(':').map(Number);
     const at = new Date(); at.setHours(h, m, 0, 0);
     // Straddling its start overlaps it whatever its length turns out to be.
     await window.joggl.days.save(H.todayKey(), [{
       id: 'clash', issueKey: 'X-9', issueId: null, title: 'Mine',
       startTs: at.getTime() - 600000, endTs: at.getTime() + 600000,
       status: 'pending', worklogId: null, comment: null, errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(300); await H.settle();
     const warn = H.all('.entry-list-warn').map(w => w.textContent);
     const mine = H.q('.entry-card[data-id="clash"]')?.classList.contains('overlapping') ?? null;
     const jira = H.q('.entry-card[data-id="' + extId + '"]')?.classList.contains('overlapping') ?? null;
     await H.resetDay();
     return JSON.stringify({ warn, mine, jira })`,
    (v) => {
      const d = JSON.parse(v);
      if (d.skip) return 'skipped';
      return d.warn.length === 1 && /overlap/.test(d.warn[0]) && d.mine === true &&
        d.jira === false;
    },
  );
}

async function emptyStates() {
  await check(
    'an empty day says how to add time in both places, and the hint takes no clicks',
    `const day = await H.findEmptyDay();
     if (!day) return JSON.stringify({ skip: true });
     const panel = H.q('#entry-list').textContent;
     const grid = H.q('.sched-empty-hint')?.textContent ?? null;
     const swallows = grid === null ? null
       : getComputedStyle(H.q('.sched-empty-hint')).pointerEvents;
     // With the hint on screen, a click on the grid must still open the popup —
     // pointer-events: none is what makes that true.
     const y = await H.showHour('13:00');
     H.q('#schedule-grid').dispatchEvent(new MouseEvent('click', {
       bubbles: true, cancelable: true, clientX: H.gridX(), clientY: y }));
     await H.sleep(500);
     const popup = H.q('.sched-quick-entry-time')?.textContent ?? 'NONE';
     document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
     await H.sleep(200);
     await H.resetDay();
     return JSON.stringify({ day, panel, grid, swallows, popup })`,
    (v) => {
      const d = JSON.parse(v);
      if (d.skip) return 'skipped';
      return /drag an issue/i.test(d.panel) && /click an hour/i.test(d.panel) &&
        d.grid && /click an hour/i.test(d.grid) && d.swallows === 'none' &&
        d.popup === '13:00 – 13:30';
    },
  );

  await check(
    'the hint goes as soon as the day has anything, and comes back when it is emptied',
    `const day = await H.findEmptyDay();
     if (!day) return JSON.stringify({ skip: true });
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(700);
     const gone = H.q('.sched-empty-hint') === null;
     const panelClean = !/drag an issue/i.test(H.q('#entry-list').textContent);
     // Deleting the last entry has to bring the hint back, or the day goes quiet
     // again with nothing to say how to fill it. A pending entry deletes outright.
     H.q('.entry-card:not(.external) [data-a="delete"]').click();
     await H.sleep(700);
     const back = H.q('.sched-empty-hint') !== null;
     const panelBack = /drag an issue/i.test(H.q('#entry-list').textContent);
     await H.resetDay();
     return JSON.stringify({ day, gone, panelClean, back, panelBack })`,
    (v) => {
      const d = JSON.parse(v);
      if (d.skip) return 'skipped';
      return d.gone && d.panelClean && d.back && d.panelBack;
    },
  );
}

async function workDescription() {
  const openMenuOn = (selector) => `
     H.q(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu', {
       bubbles: true, cancelable: true, clientX: 420, clientY: 300 }));
     await H.sleep(250);`;

  await check(
    'Work description sits second on the menu, from a block and from a row',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     ${openMenuOn('.sched-entry-block')}
     const fromBlock = H.all('.ctx-item').map(i => i.textContent.replace(/^\\W+/, ''));
     document.body.click(); await H.sleep(150);
     ${openMenuOn('.entry-card')}
     const fromRow = H.all('.ctx-item').map(i => i.textContent.replace(/^\\W+/, ''));
     document.body.click(); await H.sleep(150);
     await H.resetDay();
     return JSON.stringify({ fromBlock, fromRow })`,
    (v) => {
      const d = JSON.parse(v);
      return d.fromBlock[1] === 'Work description' && d.fromRow[1] === 'Work description';
    },
  );

  await check(
    'the dialog opens focused, and saving shows the text after the task name',
    `await H.resetDay();
     await H.dragToHour(H.firstTask(), '09:00'); await H.sleep(600);
     ${openMenuOn('.sched-entry-block')}
     H.all('.ctx-item').find(i => i.textContent.includes('Work description')).click();
     await H.sleep(400);
     const focused = document.activeElement?.tagName;
     const field = H.q('.comment-field');
     const wasEmpty = field?.value === '';
     field.value = 'reviewed the power section';
     H.q('#modal-buttons .btn-primary').click();
     await H.sleep(600);
     const card = H.q('.entry-card:not(.external)');
     const shown = card.querySelector('.entry-comment')?.textContent ?? null;
     const afterTitle = card.querySelector('.entry-title')?.compareDocumentPosition(
       card.querySelector('.entry-comment')) & Node.DOCUMENT_POSITION_FOLLOWING;
     const sep = !!card.querySelector('.entry-comment-sep');
     const status = card.querySelector('.status-badge').textContent;
     await H.resetDay();
     return JSON.stringify({ focused, wasEmpty, shown, afterTitle: !!afterTitle, sep, status })`,
    (v) => {
      const d = JSON.parse(v);
      return d.focused === 'TEXTAREA' && d.wasEmpty && d.shown === 'reviewed the power section' &&
        d.afterTitle && d.sep && d.status.includes('pending');
    },
  );

  await check(
    'the description is greyer than the task name, and not just a different colour',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'c1', issueKey: 'X-1', issueId: null, title: 'Some task',
       startTs: at.getTime(), endTs: at.getTime() + 1800000,
       status: 'pending', worklogId: null, comment: 'what I did', errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(300); await H.settle();
     const card = H.q('.entry-card[data-id="c1"]');
     const t = getComputedStyle(card.querySelector('.entry-title'));
     const c = getComputedStyle(card.querySelector('.entry-comment'));
     // Copied to plain strings *before* resetDay. A CSSStyleDeclaration is live:
     // read it after the element is detached and every property comes back "".
     const out = { titleColor: t.color, commentColor: c.color,
                   titleStyle: t.fontStyle, commentStyle: c.fontStyle };
     await H.resetDay();
     return JSON.stringify(out)`,
    (v) => {
      const d = JSON.parse(v);
      // Colour alone would not survive greyscale, so italics has to differ too.
      return d.titleColor !== d.commentColor && d.commentStyle === 'italic' &&
        d.titleStyle === 'normal';
    },
  );

  await check(
    'a long description clips with an ellipsis before it reaches the times',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'c2', issueKey: 'X-1', issueId: null, title: 'Some task',
       startTs: at.getTime(), endTs: at.getTime() + 1800000,
       status: 'pending', worklogId: null,
       comment: 'a deliberately very long work description that goes on well past the '
              + 'width of the row and must be clipped rather than pushing the times about',
       errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(600);
     const card = H.q('.entry-card[data-id="c2"]');
     const el = card.querySelector('.entry-comment');
     const times = card.querySelector('.time-range');
     const r = el.getBoundingClientRect(), tr = times.getBoundingClientRect();
     const out = { clipped: el.scrollWidth > el.clientWidth,
                   ellipsis: getComputedStyle(el).textOverflow,
                   endsBeforeTimes: Math.round(r.right) <= Math.round(tr.left),
                   titleIntact: card.querySelector('.entry-title').textContent === 'Some task',
                   timesVisible: tr.width > 0 };
     await H.resetDay();
     return JSON.stringify(out)`,
    (v) => {
      const d = JSON.parse(v);
      return d.clipped && d.ellipsis === 'ellipsis' && d.endsBeforeTimes && d.titleIntact &&
        d.timesVisible;
    },
  );

  await check(
    'changing only the description marks a synced entry for re-sync',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'c3', issueKey: 'X-1', issueId: null, title: 'Already logged',
       startTs: at.getTime(), endTs: at.getTime() + 1800000,
       status: 'synced', worklogId: '99999', comment: 'first go', errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(600);
     ${openMenuOn('.entry-card[data-id="c3"]')}
     H.all('.ctx-item').find(i => i.textContent.includes('Work description')).click();
     await H.sleep(400);
     H.q('.comment-field').value = 'second go';
     H.q('#modal-buttons .btn-primary').click();
     await H.sleep(600);
     const card = H.q('.entry-card[data-id="c3"]');
     const out = { status: card.querySelector('.status-badge').textContent,
                   shown: card.querySelector('.entry-comment')?.textContent };
     await H.resetDay();
     return JSON.stringify(out)`,
    (v) => {
      const d = JSON.parse(v);
      // The times did not move, so only the comment guard can have caught this.
      return d.status.includes('pending') && d.shown === 'second go';
    },
  );

  await check(
    'opening the dialog and closing it unchanged leaves a synced entry alone',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'c4', issueKey: 'X-1', issueId: null, title: 'Already logged',
       startTs: at.getTime(), endTs: at.getTime() + 1800000,
       status: 'synced', worklogId: '99999', comment: 'unchanged', errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(600);
     ${openMenuOn('.entry-card[data-id="c4"]')}
     H.all('.ctx-item').find(i => i.textContent.includes('Work description')).click();
     await H.sleep(400);
     const prefilled = H.q('.comment-field').value;
     H.q('#modal-buttons .btn-primary').click();
     await H.sleep(500);
     const status = H.q('.entry-card[data-id="c4"] .status-badge').textContent;
     await H.resetDay();
     return JSON.stringify({ prefilled, status })`,
    (v) => {
      const d = JSON.parse(v);
      return d.prefilled === 'unchanged' && d.status.includes('synced');
    },
  );

  await check(
    'a Jira-side worklog refuses, and says where to change it',
    `await H.resetDay();
     H.q('#refresh-tasks-btn').click(); await H.sleep(4000);
     const ext = H.q('.entry-card.external');
     if (!ext) return 'SKIP no Jira-side worklog today';
     ext.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
       clientX: 420, clientY: 300 }));
     await H.sleep(250);
     H.all('.ctx-item').find(i => i.textContent.includes('Work description')).click();
     await H.sleep(400);
     const opened = !H.q('#modal-overlay').classList.contains('hidden');
     const warned = H.all('.toast').some(t => /made in Jira/i.test(t.textContent));
     await H.resetDay();
     return JSON.stringify({ opened, warned })`,
    (v) => {
      if (typeof v === 'string' && v.startsWith('SKIP')) return 'skipped';
      const d = JSON.parse(v);
      return d.opened === false && d.warned === true;
    },
  );
}

async function noOpEdits() {
  await check(
    'clicking a synced block leaves it synced — no re-sync offered',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'sync1', issueKey: 'X-1', issueId: null, title: 'Already logged',
       startTs: at.getTime(), endTs: at.getTime() + 3600000,
       status: 'synced', worklogId: '60711', errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(600);
     const before = H.entries()[0];
     // Press and release on the block without moving: the full move gesture.
     const b = H.q('.sched-entry-block[data-id="sync1"]');
     const r = b.getBoundingClientRect();
     const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
     H.mouse(b, 'mousedown', x, y, 1);
     H.mouse(document, 'mouseup', x, y, 0);
     await H.sleep(500);
     const after = H.entries()[0];
     await H.resetDay();
     return JSON.stringify({ before, after })`,
    (v) => {
      const d = JSON.parse(v);
      return d.after.status === d.before.status && d.after.status.includes('synced') &&
        d.after.range === d.before.range;
    },
  );

  await check(
    'focusing a time field and leaving it untouched leaves the entry synced',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'sync2', issueKey: 'X-1', issueId: null, title: 'Already logged',
       startTs: at.getTime(), endTs: at.getTime() + 3600000,
       status: 'synced', worklogId: '60712', errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(600);
     const before = H.entries()[0];
     const field = H.q('.entry-card[data-id="sync2"] [data-f="start"]');
     field.focus(); field.select();
     field.dispatchEvent(new FocusEvent('blur'));
     await H.sleep(500);
     const after = H.entries()[0];
     await H.resetDay();
     return JSON.stringify({ before, after })`,
    (v) => {
      const d = JSON.parse(v);
      return d.after.status === d.before.status && d.after.status.includes('synced');
    },
  );

  await check(
    'a real edit still marks it pending, so the guard has not disabled editing',
    `await H.resetDay();
     const at = new Date(); at.setHours(9, 0, 0, 0);
     await window.joggl.days.save(H.todayKey(), [{
       id: 'sync3', issueKey: 'X-1', issueId: null, title: 'Already logged',
       startTs: at.getTime(), endTs: at.getTime() + 3600000,
       status: 'synced', worklogId: '60713', errorMsg: null }]);
     H.q('#today-btn').click(); await H.sleep(600);
     const field = H.q('.entry-card[data-id="sync3"] [data-f="end"]');
     field.value = '11:00';
     field.dispatchEvent(new FocusEvent('blur'));
     await H.sleep(500);
     const after = H.entries()[0];
     await H.resetDay();
     return JSON.stringify(after)`,
    (v) => {
      const d = JSON.parse(v);
      return d.status.includes('pending') && d.range === '09:00-11:00';
    },
  );
}

async function displayPrefs() {
  await check(
    'the day view is tinted on a Saturday and plain on a weekday',
    `await H.resetDay();
     const readTint = () => H.q('#right-panel').classList.contains('is-weekend');
     const onWeekday = readTint();
     // Step back to the most recent Saturday.
     let guard = 0, label = '';
     while (guard++ < 8) {
       H.q('#prev-day').click(); await H.sleep(500);
       label = H.q('#current-date-label').textContent;
       if (label.startsWith('Sat')) break;
     }
     const onSaturday = readTint();
     const tinted = getComputedStyle(H.q('#right-panel')).backgroundImage;
     H.q('#today-btn').click(); await H.sleep(500);
     return JSON.stringify({ onWeekday, onSaturday, label, tinted })`,
    (v) => {
      const d = JSON.parse(v);
      // The run itself may fall on a weekend, so assert the Saturday and the
      // gradient rather than assuming today is a working day.
      return d.label.startsWith('Sat') && d.onSaturday === true && d.tinted.includes('gradient');
    },
  );

  await check(
    'turning the weekend tint off clears it, and it comes back',
    `H.q('#settings-btn').click(); await H.sleep(300);
     const box = H.q('#cfg-weekend-tint');
     const defaultOn = box.checked;
     box.checked = false; box.dispatchEvent(new Event('change'));
     await H.sleep(350);
     H.q('#close-settings').click(); await H.sleep(200);
     let guard = 0, label = '';
     while (guard++ < 8) {
       H.q('#prev-day').click(); await H.sleep(450);
       label = H.q('#current-date-label').textContent;
       if (label.startsWith('Sat')) break;
     }
     const offOnSaturday = H.q('#right-panel').classList.contains('is-weekend');
     H.q('#settings-btn').click(); await H.sleep(300);
     H.q('#cfg-weekend-tint').checked = true;
     H.q('#cfg-weekend-tint').dispatchEvent(new Event('change'));
     await H.sleep(350);
     H.q('#close-settings').click(); await H.sleep(200);
     const backOn = H.q('#right-panel').classList.contains('is-weekend');
     H.q('#today-btn').click(); await H.sleep(500);
     return JSON.stringify({ defaultOn, label, offOnSaturday, backOn })`,
    (v) => {
      const d = JSON.parse(v);
      return d.defaultOn === true && d.label.startsWith('Sat') &&
        d.offOnSaturday === false && d.backOn === true;
    },
  );

  await check(
    'a pin shows its key and full title, and the setting switches that',
    `await H.resetDay();
     H.q('#add-pin-btn').click(); await H.sleep(250);
     const inp = H.q('#pin-search-input');
     const wanted = H.all('.task-item')[0].querySelector('.task-dd-title').textContent;
     inp.value = wanted.slice(0, 12); inp.dispatchEvent(new Event('input'));
     await H.sleep(400);
     H.all('#pin-results button').find(b => b.textContent === 'Pin')?.click();
     await H.sleep(350);
     H.q('#close-pin').click(); await H.sleep(250);

     const read = () => ({
       key: H.q('.pin-chip .pin-chip-key')?.textContent ?? null,
       title: H.q('.pin-chip .pin-chip-title')?.textContent ?? null,
     });
     const asDefault = read();

     const set = async (mode) => {
       H.q('#settings-btn').click(); await H.sleep(250);
       const sel = H.q('#cfg-pin-label');
       sel.value = mode; sel.dispatchEvent(new Event('change'));
       await H.sleep(350);
       H.q('#close-settings').click(); await H.sleep(200);
     };
     await set('name');  const asName = read();
     await set('key');   const asKey = read();
     await set('keyname');

     await H.clearPins();
     await H.resetDay();
     return JSON.stringify({ wanted, asDefault, asName, asKey })`,
    (v) => {
      const d = JSON.parse(v);
      return d.asDefault.key && d.asDefault.title === d.wanted &&
        d.asName.key === null && d.asName.title === d.wanted &&
        d.asKey.key && d.asKey.title === null;
    },
  );
}

async function externals() {
  await check(
    'Jira-side worklogs read back dashed, labelled and read-only',
    `await H.resetDay();
     H.q('#refresh-tasks-btn').click();
     await H.sleep(4000);
     const ext = H.all('.entry-card.external');
     return JSON.stringify({
       count: ext.length,
       label: ext[0]?.querySelector('.entry-sub')?.textContent ?? null,
       inputsDisabled: ext.length ? [...ext[0].querySelectorAll('.ie')].every(i => i.disabled) : null,
       hasDelete: ext.length ? !!ext[0].querySelector('[data-a="delete"]') : null,
     })`,
    (v) => {
      const d = JSON.parse(v);
      if (d.count === 0) return 'skipped';
      return d.label === 'Manual Jira entry' && d.inputsDisabled === true && d.hasDelete === false;
    },
  );
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runChecks(mainWindow, app) {
  win = mainWindow;
  try {
    await run(HELPERS);
    await sidebar();
    await quickEntry();
    await dayPanel();
    await dragging();
    await editTask();
    await keyboard();
    await dateJump();
    await clicks();
    await overlapNotice();
    await emptyStates();
    await workDescription();
    await noOpEdits();
    await displayPrefs();
    await timeSafety();
    await externals();
  } catch (err) {
    results.push({ name: '(harness)', ok: false, value: `THREW ${err.stack}` });
  }

  const pass = results.filter((r) => r.ok === true).length;
  const skip = results.filter((r) => r.ok === 'skipped').length;
  const fail = results.filter((r) => r.ok !== true && r.ok !== 'skipped');

  console.log('\n─── ui-check ────────────────────────────────────');
  for (const r of results) {
    const mark = r.ok === true ? 'PASS' : r.ok === 'skipped' ? 'SKIP' : 'FAIL';
    console.log(`${mark}  ${r.name}`);
    // The observed value, only when it did not pass — that is the whole diagnosis.
    if (mark !== 'PASS') console.log(`      ${r.value}`);
  }
  console.log(`───  ${pass} passed, ${fail.length} failed, ${skip} skipped\n`);

  // Non-zero on failure, so this can gate a release without anyone reading it.
  app.exit(fail.length === 0 ? 0 : 1);
}
