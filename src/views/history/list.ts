import { db, type Workout, type WorkoutSet } from '../../db';
import { startOfWeek, groupBy } from '../../lib/analytics';
import { h } from '../../lib/dom';
import { go } from '../../lib/ui';
import { formatDate, formatTime } from '../../lib/format';
import { getSettings, type Units } from '../../lib/settings';
import { formatDistance, formatVolume, safe, setsDistance, setsVolume, workoutDuration } from './shared';

const PAGE_SIZE = 30;
const weekFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const weekYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function weekLabel(weekStart: number): string {
  const thisWeek = startOfWeek(Date.now());
  if (weekStart === thisWeek) return 'This week';
  if (weekStart === startOfWeek(thisWeek - 1)) return 'Last week';
  const d = new Date(weekStart);
  return `Week of ${(d.getFullYear() === new Date().getFullYear() ? weekFmt : weekYearFmt).format(d)}`;
}

/** "Bench Press, Squat +2 more". */
function exerciseSummary(names: string[]): string {
  if (names.length === 0) return 'No exercises';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export async function renderList(root: HTMLElement): Promise<void> {
  const [settings, all, exercises] = await Promise.all([
    getSettings(),
    db.workouts.orderBy('startedAt').reverse().toArray(),
    db.exercises.toArray(),
  ]);
  const names = new Map(exercises.map((e) => [e.id, e.name]));
  const inProgress = all.find((w) => w.endedAt === undefined);
  const finished = all.filter((w) => w.endedAt !== undefined);

  root.append(h('h1', {}, 'History'));

  if (inProgress) {
    root.append(
      h('a', { class: 'card history-resume', href: '#/log' },
        h('div', {},
          h('strong', {}, 'Workout in progress'),
          h('div', { class: 'muted small' }, `Started ${formatTime(inProgress.startedAt)}`),
        ),
        h('span', { class: 'history-resume-cta' }, 'Resume →'),
      ),
    );
  }

  if (finished.length === 0) {
    root.append(
      h('div', { class: 'empty stack' },
        h('p', {}, 'No workouts yet'),
        h('button', { class: 'btn-lg', onclick: () => go('log') }, 'Start a workout'),
      ),
    );
    return;
  }

  const listEl = h('div', { class: 'history-list' });
  root.append(listEl);
  const moreBtn = h('button', { class: 'btn-secondary btn-block history-more' }, 'Load more');
  let shown = 0;
  let lastWeek: number | null = null;

  const loadPage = async () => {
    const page = finished.slice(shown, shown + PAGE_SIZE);
    shown += page.length;
    const sets = await db.sets.where('workoutId').anyOf(page.map((w) => w.id)).toArray();
    const byWorkout = groupBy(sets, (s) => s.workoutId);
    for (const w of page) {
      const week = startOfWeek(w.startedAt);
      if (week !== lastWeek) {
        listEl.append(h('h2', { class: 'history-week' }, weekLabel(week)));
        lastWeek = week;
      }
      listEl.append(workoutRow(w, byWorkout.get(w.id) ?? [], names, settings.units));
    }
    if (shown >= finished.length) moreBtn.remove();
  };

  moreBtn.addEventListener('click', safe(async () => {
    moreBtn.disabled = true;
    try { await loadPage(); } finally { moreBtn.disabled = false; }
  }));
  await loadPage();
  if (shown < finished.length) root.append(moreBtn);
}

function workoutRow(w: Workout, sets: WorkoutSet[], names: Map<number, string>, units: Units): HTMLElement {
  // Exercises in workout order, then any others that have sets; fall back to planned ones if nothing was logged.
  const withSets = new Set(sets.map((s) => s.exerciseId));
  const ids = [...w.exerciseIds.filter((id) => withSets.has(id)), ...[...withSets].filter((id) => !w.exerciseIds.includes(id))];
  const exNames = (ids.length ? ids : w.exerciseIds).map((id) => names.get(id) ?? 'Unknown exercise');
  const volume = setsVolume(sets);
  const distance = setsDistance(sets);

  const stats = [`${sets.length} set${sets.length === 1 ? '' : 's'}`];
  if (volume > 0) stats.push(formatVolume(volume, units));
  if (distance > 0) stats.push(formatDistance(distance));

  return h('a', { class: 'card history-row', href: `#/history/${w.id}` },
    h('div', { class: 'spread' },
      h('strong', {}, w.name ?? `${formatDate(w.startedAt)} · ${formatTime(w.startedAt)}`),
      h('span', { class: 'muted small' }, workoutDuration(w.startedAt, w.endedAt!)),
    ),
    w.name ? h('div', { class: 'muted small' }, `${formatDate(w.startedAt)} · ${formatTime(w.startedAt)}`) : null,
    h('div', { class: 'history-row-exercises' }, exerciseSummary(exNames)),
    h('div', { class: 'muted small' }, stats.join(' · ')),
  );
}
