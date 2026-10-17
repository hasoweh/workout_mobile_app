import { h } from '../lib/dom';
import { formatDuration } from '../lib/format';
import './rest-timer.css';

/**
 * Rest timer between sets: a bar above the tab bar that counts down, then vibrates.
 * Mounted once (see main.ts) so it keeps running across tabs. The end time is kept in
 * localStorage, so a reload or reopening the app mid-rest picks it back up.
 */

interface RestState {
  endsAt: number;
  /** Seconds the rest was set to (after +/- adjustments); drives the progress fill. */
  total: number;
}

const STORAGE_KEY = 'rest-timer';
const DONE_DISPLAY_MS = 4000;
const listeners = new Set<() => void>();
let state: RestState | null = load();

export function startRest(seconds: number): void {
  if (seconds <= 0) return;
  state = { endsAt: Date.now() + seconds * 1000, total: seconds };
  changed();
}

export function stopRest(): void {
  state = null;
  changed();
}

function adjustRest(deltaSeconds: number): void {
  if (!state) return;
  const endsAt = Math.max(Date.now() + 1000, state.endsAt + deltaSeconds * 1000);
  state = { endsAt, total: Math.max(1, state.total + deltaSeconds) };
  changed();
}

function changed(): void {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable: timer still works for this session */ }
  listeners.forEach((fn) => fn());
}

function load(): RestState | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as RestState | null;
    // A rest that ended while the app was closed is stale; don't buzz for it.
    return s && typeof s.endsAt === 'number' && s.endsAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/** Creates the timer bar and appends it to <body>. Call once at startup. */
export function mountRestTimer(): void {
  const time = h('span', { class: 'rest-time', 'aria-live': 'off' });
  const label = h('span', { class: 'rest-label' }, 'Rest');
  const fill = h('div', { class: 'rest-fill' });
  const controls = h('div', { class: 'rest-controls' },
    h('button', { type: 'button', class: 'btn-secondary rest-btn', 'aria-label': 'Subtract 15 seconds', onclick: () => adjustRest(-15) }, '−15'),
    h('button', { type: 'button', class: 'btn-secondary rest-btn', 'aria-label': 'Add 15 seconds', onclick: () => adjustRest(15) }, '+15'),
    h('button', { type: 'button', class: 'btn-secondary rest-btn', onclick: () => stopRest() }, 'Skip'),
  );
  const bar = h('div', { class: 'rest-timer', role: 'timer', hidden: true },
    fill, h('div', { class: 'rest-inner' }, h('div', { class: 'rest-text' }, label, time), controls));
  document.body.append(bar);

  let doneUntil = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const render = () => {
    const now = Date.now();
    if (state && now >= state.endsAt) {
      // Rest finished: buzz once and show "Rest over" briefly.
      state = null;
      changed();
      doneUntil = now + DONE_DISPLAY_MS;
      navigator.vibrate?.([300, 150, 300, 150, 300]);
    }
    const done = !state && now < doneUntil;
    bar.hidden = !state && !done;
    bar.classList.toggle('rest-done', done);
    controls.hidden = done;
    if (state) {
      const remaining = Math.ceil((state.endsAt - now) / 1000);
      label.textContent = 'Rest';
      time.textContent = formatDuration(remaining);
      fill.style.width = `${Math.min(100, (1 - (state.endsAt - now) / (state.total * 1000)) * 100)}%`;
    } else if (done) {
      label.textContent = 'Rest over';
      time.textContent = '— next set 💪';
      fill.style.width = '100%';
    }
    // Only tick while something is showing.
    if (bar.hidden) { clearInterval(timer); timer = undefined; }
    else if (!timer) timer = setInterval(render, 250);
  };

  listeners.add(render);
  // Timers are throttled in the background; catch up as soon as the app is visible again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  render();
}
