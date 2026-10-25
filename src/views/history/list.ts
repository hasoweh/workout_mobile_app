import { db, type Workout, type WorkoutSet } from '../../db';
import { groupBy, setsDistance, setsVolume, startOfWeek } from '../../lib/analytics';
import { h } from '../../lib/dom';
import { formatDate, formatDistance, formatTime, formatVolume } from '../../lib/format';
import { getSettings, type Units } from '../../lib/settings';
import { safe } from '../../lib/ui';
import { workoutExerciseIds } from '../../lib/workouts';
import { workoutDuration } from './shared';

const PAGE_SIZE = 30;
const weekFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const weekYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Called with a finished workout and its exercise order when its row's Repeat button is tapped. */
export type OnRepeat = (w: Workout, exerciseIds: number[]) => void;

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

/**
 * Finished workouts, newest first, grouped by week and paged. Rows open the workout (#/log/<id>);
 * with `onRepeat` each row also gets a Repeat button. Null when there are no finished workouts.
 */
export async function buildHistoryList(onRepeat?: OnRepeat): Promise<HTMLElement | null> {
  const [settings, all, exercises] = await Promise.all([
    getSettings(),
    db.workouts.orderBy('startedAt').reverse().toArray(),
    db.exercises.toArray(),
  ]);
  const names = new Map(exercises.map((e) => [e.id, e.name]));
  const finished = all.filter((w) => w.endedAt !== undefined);
  if (finished.length === 0) return null;

  const listEl = h('div', { class: 'history-list' });
  const moreBtn = h('button', { class: 'btn-secondary btn-block history-more' }, 'Load more');
  let shown = 0;
  let lastWeek: number | null = null;

  const loadPage = async () => {
    const page = finished.slice(shown, shown + PAGE_SIZE);
    shown += page.length;
    const sets = await db.sets.where('workoutId').anyOf(page.map((w) => w.id)).toArray();
    const byWorkout = groupBy(sets, (s) => s.workoutId);
    const rows = await Promise.all(page.map(async (w) => {
      const wSets = byWorkout.get(w.id) ?? [];
      return workoutRow(w, wSets, await workoutExerciseIds(w, wSets), names, settings.units, onRepeat);
    }));
    page.forEach((w, i) => {
      const week = startOfWeek(w.startedAt);
      if (week !== lastWeek) {
        listEl.append(h('h2', { class: 'history-week' }, weekLabel(week)));
        lastWeek = week;
      }
      listEl.append(rows[i]);
    });
    if (shown >= finished.length) moreBtn.remove();
  };

  moreBtn.addEventListener('click', safe(async () => {
    moreBtn.disabled = true;
    try { await loadPage(); } finally { moreBtn.disabled = false; }
  }));
  await loadPage();
  return h('div', {}, listEl, shown < finished.length ? moreBtn : null);
}

function workoutRow(w: Workout, sets: WorkoutSet[], ids: number[], names: Map<number, string>, units: Units, onRepeat?: OnRepeat): HTMLElement {
  // Exercises in workout order, then any others that have sets; fall back to planned ones if nothing was logged.
  const withSets = new Set(sets.map((s) => s.exerciseId));
  const logged = ids.filter((id) => withSets.has(id));
  const exNames = (logged.length ? logged : ids).map((id) => names.get(id) ?? 'Unknown exercise');
  const volume = setsVolume(sets);
  const distance = setsDistance(sets);

  const stats = [`${sets.length} set${sets.length === 1 ? '' : 's'}`];
  if (volume > 0) stats.push(formatVolume(volume, units));
  if (distance > 0) stats.push(formatDistance(distance));

  return h('div', { class: 'card history-row' },
    h('a', { class: 'history-row-link', href: `#/log/${w.id}` },
      h('div', { class: 'spread' },
        h('strong', {}, w.name ?? `${formatDate(w.startedAt)} · ${formatTime(w.startedAt)}`),
        h('span', { class: 'muted small' }, workoutDuration(w.startedAt, w.endedAt!)),
      ),
      w.name ? h('div', { class: 'muted small' }, `${formatDate(w.startedAt)} · ${formatTime(w.startedAt)}`) : null,
      h('div', { class: 'history-row-exercises' }, exerciseSummary(exNames)),
      h('div', { class: 'muted small' }, stats.join(' · ')),
    ),
    onRepeat
      ? h('button', { type: 'button', class: 'btn-ghost history-repeat', disabled: ids.length === 0, onclick: () => onRepeat(w, ids) }, 'Repeat')
      : null,
  );
}
