import { db, type Exercise, type Workout } from '../db';
import { h } from '../lib/dom';
import { formatDate, formatDuration, formatTime } from '../lib/format';
import { getSettings, isBackupDue } from '../lib/settings';
import { go, safe, toast } from '../lib/ui';
import { buildActive, type RenderOpts } from './log/active';
import { getActiveWorkout, startWorkout, workoutExerciseIds } from '../lib/workouts';
import './log.css';

const RECENT_WORKOUTS = 5;

/** Log tab: resumes an in-progress workout, otherwise shows the start screen. */
export async function logView(root: HTMLElement, _params: string[]): Promise<void> {
  await renderLog(root);
}

/** Latest render id per root, so overlapping re-renders can't apply out of order. */
const renderIds = new WeakMap<HTMLElement, number>();

/** (Re)renders the log view in place, keeping the scroll position. */
async function renderLog(root: HTMLElement, opts: RenderOpts = {}): Promise<void> {
  const id = (renderIds.get(root) ?? 0) + 1;
  renderIds.set(root, id);
  const scrollY = root.isConnected ? window.scrollY : 0;
  const rerender = (o?: RenderOpts) => renderLog(root, o);

  let content: Node;
  try {
    const [settings, active] = await Promise.all([getSettings(), getActiveWorkout()]);
    content = active ? await buildActive(active, settings, rerender) : await buildIdle(rerender);
  } catch (err) {
    console.error(err);
    content = h('div', { class: 'empty' },
      h('p', {}, 'Could not load your workout data.'),
      h('button', { type: 'button', class: 'btn-secondary', onclick: () => void rerender() }, 'Retry'));
  }
  if (renderIds.get(root) !== id) return;
  root.replaceChildren(content);

  if (opts.scrollToExercise !== undefined) {
    root.querySelector(`[data-exercise-id="${opts.scrollToExercise}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (scrollY) {
    window.scrollTo(0, scrollY);
  }
}

async function buildIdle(rerender: (o?: RenderOpts) => Promise<void>): Promise<HTMLElement> {
  const [backupDue, recent, exercises] = await Promise.all([
    isBackupDue(),
    db.workouts.orderBy('startedAt').reverse().filter((w) => w.endedAt !== undefined).limit(RECENT_WORKOUTS).toArray(),
    db.exercises.toArray(),
  ]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const recentIds = await Promise.all(recent.map((w) => workoutExerciseIds(w)));

  const start = (ids: number[], name?: string) => safe(async () => {
    // Another tab/session may already have started one: just resume it.
    if (!(await getActiveWorkout())) {
      const usable = ids.filter((id) => { const ex = byId.get(id); return ex && !ex.archived; });
      if (ids.length && usable.length < ids.length) toast('Skipped archived or deleted exercises');
      await startWorkout(usable, name);
    }
    await rerender();
  });

  return h('div', { class: 'log-idle stack' },
    h('h1', {}, 'Log'),
    backupDue
      ? h('a', { class: 'banner log-banner', href: '#/settings', onclick: (e: Event) => { e.preventDefault(); go('settings'); } },
          '💾 No backup in a while — tap to export')
      : null,
    h('button', { type: 'button', class: 'btn-go btn-block log-start', onclick: start([]) }, 'Start workout'),
    recent.length
      ? h('button', { type: 'button', class: 'btn-secondary btn-block btn-lg', onclick: start(recentIds[0], recent[0].name) },
          '↻ Repeat last workout')
      : null,
    recent.length
      ? h('section', { class: 'stack log-recent' },
          h('h2', { class: 'log-section-title' }, 'Recent workouts'),
          h('ul', { class: 'list card log-recent-list' }, ...recent.map((w, i) =>
            recentRow(w, recentIds[i], byId, start(recentIds[i], w.name)))))
      : h('p', { class: 'empty' }, 'No workouts yet. Tap “Start workout” and add your first exercise.'),
  );
}

function recentRow(w: Workout, ids: number[], byId: Map<number, Exercise>, onRepeat: () => void): HTMLElement {
  const names = ids.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);
  const summary = names.length === 0 ? 'No exercises'
    : names.length <= 3 ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
  const duration = w.endedAt !== undefined ? formatDuration((w.endedAt - w.startedAt) / 1000) : '';
  return h('li', { class: 'log-recent-row' },
    h('div', { class: 'grow log-recent-info' },
      w.name ? h('div', { class: 'log-recent-date' }, w.name) : null,
      h('div', { class: w.name ? 'muted small' : 'log-recent-date' }, `${formatDate(w.startedAt)} · ${formatTime(w.startedAt)}`),
      h('div', { class: 'muted small' }, summary),
      duration ? h('div', { class: 'muted small' }, duration) : null),
    h('button', { type: 'button', class: 'btn-ghost log-repeat', disabled: ids.length === 0, onclick: onRepeat }, 'Repeat'),
  );
}
