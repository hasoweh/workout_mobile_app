import { Chart } from 'chart.js';
import { db, MUSCLES, type Exercise, type Muscle, type Workout, type WorkoutSet } from '../../db';
import { groupBy, muscleShares, startOfDay, startOfWeek, summarizeSession, type ExerciseSession } from '../../lib/analytics';
import { h } from '../../lib/dom';
import { formatDate, formatDuration, toDisplayWeight } from '../../lib/format';
import { getSettings, type Units } from '../../lib/settings';
import { fmtNum, muscleColor, shortDate, theme, track, type Theme } from './charts';

const HEATMAP_WEEKS = 17;
const BAR_WEEKS = 8;

export async function renderOverview(root: HTMLElement): Promise<void> {
  const [allWorkouts, allSets, exercises, settings] = await Promise.all([
    db.workouts.toArray(),
    db.sets.toArray(),
    db.exercises.toArray(),
    getSettings(),
  ]);
  const workouts = allWorkouts.filter((w) => w.endedAt !== undefined);
  root.append(h('h1', {}, 'Progress'));

  if (workouts.length === 0) {
    root.append(
      h('div', { class: 'card empty' },
        h('p', {}, 'No finished workouts yet.'),
        h('p', { class: 'small' }, 'Finish a workout and your stats, streaks and charts will show up here.'),
        h('a', { class: 'progress-link-btn', href: '#/log' }, 'Start a workout'),
      ),
    );
    return;
  }

  const workoutById = new Map(workouts.map((w) => [w.id, w]));
  const sets = allSets.filter((s) => workoutById.has(s.workoutId));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const t = theme();

  root.append(
    h('div', { class: 'stack' },
      statTiles(workouts),
      heatmap(workouts, sets),
      muscleSection(sets, workoutById, exerciseById, t),
      exerciseList(sets, workoutById, exerciseById, settings.units),
    ),
  );
}

/* ---------- Stat tiles ---------- */

function statTiles(workouts: Workout[]): HTMLElement {
  const now = Date.now();
  const weekStart = startOfWeek(now);
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const thisWeek = workouts.filter((w) => w.startedAt >= weekStart).length;
  const thisMonth = workouts.filter((w) => w.startedAt >= monthStart).length;
  const { current, longest } = weeklyStreaks(workouts, now);

  const tile = (value: string | number, label: string) =>
    h('div', { class: 'progress-tile' }, h('div', { class: 'progress-tile-value' }, value), h('div', { class: 'progress-tile-label' }, label));
  return h('div', { class: 'progress-tiles' },
    tile(thisWeek, 'This week'),
    tile(thisMonth, 'This month'),
    tile(`${current} wk`, 'Current streak'),
    tile(`${longest} wk`, 'Longest streak'),
  );
}

/** Monday of the previous week (stepping 1 ms back keeps this DST-safe). */
const prevWeek = (weekStart: number) => startOfWeek(weekStart - 1);

/**
 * Streaks of consecutive weeks with ≥1 workout. The current week extends the streak if it has a workout,
 * but an empty current week doesn't break it yet (the week isn't over).
 */
function weeklyStreaks(workouts: Workout[], now: number): { current: number; longest: number } {
  const weeks = new Set(workouts.map((w) => startOfWeek(w.startedAt)));
  let current = 0;
  let w = startOfWeek(now);
  if (!weeks.has(w)) w = prevWeek(w);
  while (weeks.has(w)) {
    current++;
    w = prevWeek(w);
  }
  let longest = 0, run = 0, prev: number | undefined;
  for (const week of [...weeks].sort((a, b) => a - b)) {
    run = prev !== undefined && prevWeek(week) === prev ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = week;
  }
  return { current, longest };
}

/* ---------- Calendar heatmap ---------- */

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });

function heatmap(workouts: Workout[], sets: WorkoutSet[]): HTMLElement {
  const today = startOfDay(Date.now());
  const first = addDays(startOfWeek(today), -7 * (HEATMAP_WEEKS - 1));

  // Per-day totals (by the workout's start date).
  const setsPerWorkout = new Map<number, number>();
  for (const s of sets) setsPerWorkout.set(s.workoutId, (setsPerWorkout.get(s.workoutId) ?? 0) + 1);
  const days = new Map<number, { workouts: Workout[]; sets: number }>();
  for (const w of workouts) {
    const day = startOfDay(w.startedAt);
    if (day < first) continue;
    const entry = days.get(day) ?? { workouts: [], sets: 0 };
    entry.workouts.push(w);
    entry.sets += setsPerWorkout.get(w.id) ?? 0;
    days.set(day, entry);
  }
  const max = Math.max(1, ...[...days.values()].map((d) => d.sets));
  const level = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.ceil((4 * n) / max)));

  const caption = h('div', { class: 'progress-hm-caption small muted' }, 'Tap a day for details.');
  const showDay = (day: number) => {
    const entry = days.get(day);
    if (!entry) {
      caption.replaceChildren(`${formatDate(day)}: rest day`);
      return;
    }
    const n = entry.workouts.length;
    caption.replaceChildren(
      `${formatDate(day)}: ${n} workout${n === 1 ? '' : 's'}, ${entry.sets} set${entry.sets === 1 ? '' : 's'} `,
      ...entry.workouts.map((w, i) => h('a', { href: `#/history/${w.id}` }, n === 1 ? 'View' : `View #${i + 1}`)),
    );
  };

  const grid = h('div', { class: 'progress-hm-grid', style: `--weeks: ${HEATMAP_WEEKS}` });
  // Month labels (row 1), placed over the first week column whose Monday starts a new month.
  let lastMonth = -1;
  for (let col = 0; col < HEATMAP_WEEKS; col++) {
    const monday = new Date(addDays(first, col * 7));
    if (monday.getMonth() !== lastMonth) {
      lastMonth = monday.getMonth();
      // Skip a label on the first column if the next month starts too close to fit both.
      if (col === 0 && new Date(addDays(first, 14)).getMonth() !== lastMonth) continue;
      grid.append(h('span', { class: 'progress-hm-month', style: `grid-column: ${col + 2} / span 3; grid-row: 1` }, monthFmt.format(monday)));
    }
  }
  // Weekday labels.
  ['M', '', 'W', '', 'F', '', ''].forEach((label, i) => {
    if (label) grid.append(h('span', { class: 'progress-hm-day', style: `grid-column: 1; grid-row: ${i + 2}` }, label));
  });
  // Day cells.
  for (let col = 0; col < HEATMAP_WEEKS; col++) {
    for (let row = 0; row < 7; row++) {
      const day = addDays(first, col * 7 + row);
      const style = `grid-column: ${col + 2}; grid-row: ${row + 2}`;
      if (day > today) {
        grid.append(h('span', { class: 'progress-hm-cell future', style }));
        continue;
      }
      const entry = days.get(day);
      const lvl = level(entry ? Math.max(1, entry.sets) : 0);
      const label = entry ? `${formatDate(day)}: ${entry.workouts.length} workout(s), ${entry.sets} sets` : `${formatDate(day)}: rest`;
      grid.append(
        h('button', {
          class: `progress-hm-cell l${lvl}${day === today ? ' today' : ''}`,
          style,
          title: label,
          'aria-label': label,
          onclick: () => showDay(day),
        }),
      );
    }
  }

  const legend = h('div', { class: 'progress-hm-legend small muted' },
    'Less', ...[0, 1, 2, 3, 4].map((l) => h('span', { class: `progress-hm-cell l${l}` })), 'More',
  );
  return h('section', { class: 'card stack' },
    h('div', { class: 'spread' }, h('h2', { class: 'progress-h2' }, 'Consistency'), h('span', { class: 'small muted' }, `Last ${HEATMAP_WEEKS} weeks`)),
    grid,
    h('div', { class: 'spread' }, caption, legend),
  );
}

/** Adds calendar days (DST-safe), returning local midnight. */
function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ---------- Weekly sets per muscle group ---------- */

function muscleSection(
  sets: WorkoutSet[],
  workoutById: Map<number, Workout>,
  exerciseById: Map<number, Exercise>,
  t: Theme,
): HTMLElement {
  const thisWeek = startOfWeek(Date.now());
  const weeks: number[] = [thisWeek];
  while (weeks.length < BAR_WEEKS) weeks.unshift(prevWeek(weeks[0]));
  const weekIndex = new Map(weeks.map((w, i) => [w, i]));

  // counts[muscle][weekIdx]; secondary muscles get half a set (see muscleShares).
  const counts = new Map<Muscle, number[]>();
  for (const s of sets) {
    const workout = workoutById.get(s.workoutId);
    const ex = exerciseById.get(s.exerciseId);
    if (!workout || !ex) continue;
    const i = weekIndex.get(startOfWeek(workout.startedAt));
    if (i === undefined) continue;
    for (const [muscle, share] of muscleShares(ex)) {
      const row = counts.get(muscle) ?? new Array<number>(BAR_WEEKS).fill(0);
      row[i] += share;
      counts.set(muscle, row);
    }
  }
  const groups = MUSCLES.filter((g) => counts.has(g));

  const section = h('section', { class: 'card stack' },
    h('div', { class: 'spread' }, h('h2', { class: 'progress-h2' }, 'Sets per muscle'), h('span', { class: 'small muted' }, `Last ${BAR_WEEKS} weeks`)),
  );
  if (groups.length === 0) {
    section.append(h('p', { class: 'muted small' }, `No sets in the last ${BAR_WEEKS} weeks.`));
    return section;
  }

  const canvas = h('canvas', { 'aria-label': 'Stacked bar chart of weekly sets per muscle', role: 'img' });
  section.append(h('div', { class: 'progress-chart' }, canvas));
  track(
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: weeks.map((w) => shortDate(w)),
        datasets: groups.map((g) => ({
          label: g,
          data: counts.get(g)!,
          backgroundColor: muscleColor(g, t.dark),
          borderColor: t.surface,
          borderWidth: 1,
          borderRadius: 2,
          maxBarThickness: 28,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 4 } },
          y: { stacked: true, beginAtZero: true, ticks: { maxTicksLimit: 5 }, grid: { color: t.border } },
        },
        plugins: {
          tooltip: {
            filter: (item) => Number(item.raw) > 0,
            callbacks: { title: (items) => `Week of ${items[0]?.label ?? ''}` },
          },
        },
      },
    }),
  );

  // HTML legend doubles as "this week vs last week" list.
  const cur = (g: Muscle) => counts.get(g)![BAR_WEEKS - 1];
  const last = (g: Muscle) => counts.get(g)![BAR_WEEKS - 2];
  const sorted = [...groups].sort((a, b) => cur(b) - cur(a) || last(b) - last(a));
  section.append(
    h('div', { class: 'spread small muted' }, h('span', {}, 'Muscle'), h('span', {}, 'This week · last week')),
    h('ul', { class: 'list progress-muscle-list' },
      ...sorted.map((g) =>
        h('li', { class: 'spread' },
          h('span', { class: 'row' }, h('span', { class: 'progress-swatch', style: `background: ${muscleColor(g, t.dark)}` }), g),
          h('span', {}, h('strong', {}, fmtNum(cur(g))), h('span', { class: 'muted' }, ` · ${fmtNum(last(g))}`)),
        ),
      ),
    ),

    h('p', { class: 'muted small' }, 'Each set counts fully for the primary muscle and ½ for each secondary muscle.'),
  );
  return section;
}

/* ---------- Exercise list ---------- */

function exerciseList(
  sets: WorkoutSet[],
  workoutById: Map<number, Workout>,
  exerciseById: Map<number, Exercise>,
  units: Units,
): HTMLElement {
  const rows: Array<{ ex: Exercise; last: number; count: number; best: string; bestLabel: string }> = [];
  for (const [exerciseId, exSets] of groupBy(sets, (s) => s.exerciseId)) {
    const ex = exerciseById.get(exerciseId);
    if (!ex) continue;
    const sessions: ExerciseSession[] = [...groupBy(exSets, (s) => s.workoutId)].map(([wid, ss]) =>
      summarizeSession(wid, workoutById.get(wid)!.startedAt, ss),
    );
    const lastDate = Math.max(...sessions.map((s) => s.date));
    const [best, bestLabel] = bestOf(ex, sessions, units);
    rows.push({ ex, last: lastDate, count: sessions.length, best, bestLabel });
  }
  rows.sort((a, b) => b.last - a.last);

  return h('section', { class: 'card stack' },
    h('h2', { class: 'progress-h2' }, 'Exercises'),
    h('ul', { class: 'list progress-ex-list' },
      ...rows.map((r) =>
        h('li', {},
          h('a', { class: 'progress-ex-row', href: `#/progress/${r.ex.id}` },
            h('span', { class: 'grow' },
              h('span', { class: 'progress-ex-name' }, r.ex.name),
              h('span', { class: 'small muted' }, `${formatDate(r.last)} · ${r.count} session${r.count === 1 ? '' : 's'}`),
            ),
            h('span', { class: 'progress-ex-best' }, h('strong', {}, r.best), h('span', { class: 'small muted' }, r.bestLabel)),
            h('span', { class: 'progress-chevron', 'aria-hidden': 'true' }, '›'),
          ),
        ),
      ),
    ),
  );
}

/** Headline best for the list: est. 1RM, most reps (bodyweight), or longest distance/duration (cardio). */
function bestOf(ex: Exercise, sessions: ExerciseSession[], units: Units): [string, string] {
  if (ex.type === 'cardio') {
    const dist = Math.max(0, ...sessions.map((s) => s.distance));
    if (dist > 0) return [`${fmtNum(dist, 2)} km`, 'longest'];
    const dur = Math.max(0, ...sessions.map((s) => s.duration));
    return dur > 0 ? [formatDuration(dur), 'longest'] : ['–', ''];
  }
  const e1 = Math.max(0, ...sessions.map((s) => s.bestE1rm));
  if (sessions.some((s) => s.topWeight > 0) && e1 > 0) return [`${toDisplayWeight(e1, units)} ${units}`, 'est. 1RM'];
  const reps = Math.max(0, ...sessions.flatMap((s) => s.sets.map((x) => x.reps ?? 0)));
  if (reps > 0) return [`${reps} reps`, 'best set'];
  const dur = Math.max(0, ...sessions.flatMap((s) => s.sets.map((x) => x.duration ?? 0)));
  return dur > 0 ? [formatDuration(dur), 'longest'] : ['–', ''];
}
