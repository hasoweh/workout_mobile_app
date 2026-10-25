import { db } from '../db';
import { h } from '../lib/dom';
import { getSettings, isBackupDue } from '../lib/settings';
import { go, safe, toast } from '../lib/ui';
import { buildActive, type RenderOpts } from './log/active';
import { renderDetail } from './history/detail';
import { buildHistoryList } from './history/list';
import { getActiveWorkout, startWorkout, workoutExerciseIds } from '../lib/workouts';
import './log.css';
import './history.css';

/**
 * Log tab, which also holds workout history:
 * #/log → the in-progress workout, or the start screen with past workouts below it;
 * #/log/history → past workouts on their own (reachable mid-workout); #/log/<id> → one workout's detail/edit view.
 */
export async function logView(root: HTMLElement, params: string[]): Promise<void> {
  if (!params[0]) return renderLog(root);
  try {
    if (params[0] === 'history') await renderPast(root);
    else await renderDetail(root, params[0]);
  } catch (err) {
    console.error(err);
    root.replaceChildren(
      h('div', { class: 'empty stack' },
        h('p', {}, 'Could not load history.'),
        h('a', { class: 'history-link', href: '#/log' }, '← Back'),
      ),
    );
  }
}

/** Past workouts without the start screen, for browsing during a workout. */
async function renderPast(root: HTMLElement): Promise<void> {
  const [active, list] = await Promise.all([getActiveWorkout(), buildHistoryList()]);
  root.replaceChildren(h('div', {},
    active ? h('a', { class: 'history-link history-back', href: '#/log' }, '← Current workout') : null,
    h('h1', {}, 'Past workouts'),
    list ?? h('p', { class: 'empty' }, 'No finished workouts yet.'),
  ));
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
  const [backupDue, last, exercises] = await Promise.all([
    isBackupDue(),
    db.workouts.orderBy('startedAt').reverse().filter((w) => w.endedAt !== undefined).first(),
    db.exercises.toArray(),
  ]);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const lastIds = last ? await workoutExerciseIds(last) : [];

  const start = (ids: number[], name?: string) => safe(async () => {
    // Another tab/session may already have started one: just resume it.
    if (!(await getActiveWorkout())) {
      const usable = ids.filter((id) => { const ex = byId.get(id); return ex && !ex.archived; });
      if (ids.length && usable.length < ids.length) toast('Skipped archived or deleted exercises');
      await startWorkout(usable, name);
    }
    await rerender();
  });
  const history = await buildHistoryList((w, ids) => start(ids, w.name)());

  return h('div', { class: 'log-idle stack' },
    h('h1', {}, 'Log'),
    backupDue
      ? h('a', { class: 'banner log-banner', href: '#/settings', onclick: (e: Event) => { e.preventDefault(); go('settings'); } },
          '💾 No backup in a while — tap to export')
      : null,
    h('button', { type: 'button', class: 'btn-go btn-block log-start', onclick: start([]) }, 'Start workout'),
    last
      ? h('button', { type: 'button', class: 'btn-secondary btn-block btn-lg', onclick: start(lastIds, last.name) },
          '↻ Repeat last workout')
      : null,
    history
      ? h('section', { class: 'stack' }, h('h2', { class: 'log-section-title' }, 'History'), history)
      : h('p', { class: 'empty' }, 'No workouts yet. Tap “Start workout” and add your first exercise.'),
  );
}
