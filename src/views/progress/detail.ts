import { musclesLabel } from '../../components/muscle-chips';
import { Chart } from 'chart.js';
import { db, type Exercise, type WorkoutSet } from '../../db';
import { computePRs, exerciseHistory, startOfDay, type ExerciseSession } from '../../lib/analytics';
import { h } from '../../lib/dom';
import { formatDate, formatDuration, formatPace, toDisplayWeight } from '../../lib/format';
import { getSettings, type Units } from '../../lib/settings';
import { fmtNum, shortDate, theme, track, untrack } from './charts';

type Kind = 'weighted' | 'reps' | 'cardio';
type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'All';

interface Metric {
  key: string;
  label: string;
  /** Value for a session in display units, or null if the session has no data for it. */
  value: (s: ExerciseSession) => number | null;
  fmt: (v: number) => string;
  /** Pace: a smaller number is better. */
  lowerIsBetter?: boolean;
}

const RANGES: Array<{ key: RangeKey; months: number; words: string }> = [
  { key: '1M', months: 1, words: 'over 1 month' },
  { key: '3M', months: 3, words: 'over 3 months' },
  { key: '6M', months: 6, words: 'over 6 months' },
  { key: '1Y', months: 12, words: 'over 1 year' },
  { key: 'All', months: 0, words: '' },
];

// Remembered across visits (module-level, not persisted).
let lastRange: RangeKey = '3M';
const lastMetric: Partial<Record<Kind, string>> = {};

export async function renderDetail(root: HTMLElement, idParam: string): Promise<void> {
  const id = Number(idParam);
  const exercise = Number.isInteger(id) ? await db.exercises.get(id) : undefined;
  const back = h('a', { class: 'progress-back', href: '#/progress' }, '‹ Progress');
  if (!exercise) {
    root.append(back, h('div', { class: 'card empty' }, h('p', {}, 'Exercise not found.'), h('a', { href: '#/progress' }, 'Back to Progress')));
    return;
  }
  const [sessions, { units }] = await Promise.all([exerciseHistory(id), getSettings()]);

  root.append(
    back,
    h('h1', { class: 'progress-title' }, exercise.name),
    h('p', { class: 'muted progress-subtitle' }, `${musclesLabel(exercise.muscles)} · ${exercise.type === 'cardio' ? 'Cardio' : 'Strength'}`),
  );
  if (sessions.length === 0) {
    root.append(
      h('div', { class: 'card empty' },
        h('p', {}, `No finished sessions of ${exercise.name} yet.`),
        h('a', { class: 'progress-link-btn', href: '#/log' }, 'Log a workout'),
      ),
    );
    return;
  }

  const kind = kindOf(exercise, sessions);
  root.append(h('div', { class: 'stack' }, chartCard(kind, sessions, units), prCard(kind, sessions, units), recentCard(kind, sessions, units)));
}

function kindOf(ex: Exercise, sessions: ExerciseSession[]): Kind {
  if (ex.type === 'cardio') return 'cardio';
  return sessions.some((s) => s.topWeight > 0) ? 'weighted' : 'reps';
}

function metricsFor(kind: Kind, units: Units): Metric[] {
  const w = (v: number) => `${fmtNum(v)} ${units}`;
  const nz = (v: number) => (v > 0 ? v : null);
  switch (kind) {
    case 'weighted':
      return [
        { key: 'top', label: 'Top weight', value: (s) => (s.topWeight > 0 ? toDisplayWeight(s.topWeight, units) : null), fmt: w },
        { key: 'e1rm', label: 'Est. 1RM', value: (s) => (s.bestE1rm > 0 ? toDisplayWeight(s.bestE1rm, units) : null), fmt: w },
        { key: 'volume', label: 'Volume', value: (s) => (s.volume > 0 ? Math.round(toDisplayWeight(s.volume, units)) : null), fmt: (v) => `${Math.round(v).toLocaleString()} ${units}` },
      ];
    case 'reps':
      return [
        { key: 'maxReps', label: 'Best set', value: (s) => nz(Math.max(0, ...s.sets.map((x) => x.reps ?? 0))), fmt: (v) => `${fmtNum(v, 0)} reps` },
        { key: 'totalReps', label: 'Total reps', value: (s) => nz(s.totalReps), fmt: (v) => `${fmtNum(v, 0)} reps` },
      ];
    case 'cardio':
      return [
        { key: 'distance', label: 'Distance', value: (s) => nz(s.distance), fmt: (v) => `${fmtNum(v, 2)} km` },
        { key: 'duration', label: 'Duration', value: (s) => nz(s.duration), fmt: formatDuration },
        { key: 'pace', label: 'Pace', value: (s) => (s.distance > 0 && s.duration > 0 ? s.duration / s.distance : null), fmt: formatPace, lowerIsBetter: true },
      ];
  }
}

function rangeStart(months: number): number {
  if (!months) return 0;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return startOfDay(d.getTime());
}

/* ---------- Trend chart ---------- */

function chartCard(kind: Kind, sessions: ExerciseSession[], units: Units): HTMLElement {
  const metrics = metricsFor(kind, units);
  const hasData = (m: Metric) => sessions.some((s) => m.value(s) !== null);
  let metric = metrics.find((m) => m.key === lastMetric[kind] && hasData(m)) ?? metrics.find(hasData) ?? metrics[0];
  let range = RANGES.find((r) => r.key === lastRange) ?? RANGES[1];

  const summary = h('p', { class: 'progress-summary' });
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Trend chart, one point per session' });
  const chartBox = h('div', { class: 'progress-chart' }, canvas);
  const emptyMsg = h('p', { class: 'muted small progress-range-empty' }, 'No sessions in this range.');
  const detail = h('div', { class: 'progress-session' }, h('p', { class: 'small muted' }, 'Tap a point to see that session’s sets.'));
  let chart: Chart<'line'> | undefined;

  const metricChips = h('div', { class: 'chips progress-chips', role: 'group', 'aria-label': 'Metric' });
  const rangeChips = h('div', { class: 'chips progress-chips', role: 'group', 'aria-label': 'Range' });

  const draw = () => {
    metricChips.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.key === metric.key));
    rangeChips.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.key === range.key));
    const since = rangeStart(range.months);
    const inRange = sessions.filter((s) => s.date >= since && metric.value(s) !== null);
    const points = inRange.map((s) => ({ x: s.date, y: metric.value(s)! }));

    if (chart) untrack(chart);
    chart = undefined;
    summary.replaceChildren(...summaryText(metric, range, inRange));
    chartBox.hidden = points.length === 0;
    emptyMsg.hidden = points.length > 0;
    if (points.length === 0) return;

    const t = theme();
    const minX = points[0].x, maxX = points[points.length - 1].x;
    const pad = Math.max((maxX - minX) * 0.04, 86_400_000);
    chart = track(
      new Chart(canvas, {
        type: 'line',
        data: {
          datasets: [{
            label: metric.label,
            data: points,
            borderColor: t.accent,
            backgroundColor: t.accent,
            borderWidth: 2,
            pointRadius: points.length > 60 ? 2 : 4,
            pointHoverRadius: 7,
            pointHitRadius: 16,
            pointBorderColor: t.surface,
            pointBorderWidth: 1,
            tension: 0.2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'nearest', intersect: false, axis: 'x' },
          scales: {
            x: {
              type: 'linear',
              min: minX - pad,
              max: maxX + pad,
              grid: { display: false },
              ticks: { maxTicksLimit: 4, maxRotation: 0, callback: (v) => shortDate(Number(v)) },
            },
            y: {
              type: 'linear',
              reverse: !!metric.lowerIsBetter,
              grace: '10%',
              grid: { color: t.border },
              ticks: { maxTicksLimit: 5, callback: (v) => metric.fmt(Number(v)) },
            },
          },
          plugins: {
            tooltip: {
              displayColors: false,
              callbacks: {
                title: (items) => formatDate(Number(items[0]?.parsed.x ?? 0)),
                label: (item) => metric.fmt(Number(item.parsed.y)),
              },
            },
          },
          onClick: (event, _elements, c) => {
            if (!event.native) return;
            const [hit] = c.getElementsAtEventForMode(event.native, 'nearest', { intersect: false }, true);
            if (hit) showSession(detail, inRange[hit.index], kind, units);
          },
        },
      }),
    );
  };

  for (const m of metrics) {
    metricChips.append(h('button', { class: 'chip', 'data-key': m.key, onclick: () => { metric = m; lastMetric[kind] = m.key; draw(); } }, m.label));
  }
  for (const r of RANGES) {
    rangeChips.append(h('button', { class: 'chip', 'data-key': r.key, onclick: () => { range = r; lastRange = r.key; draw(); } }, r.key));
  }
  draw();

  return h('section', { class: 'card stack' }, metricChips, rangeChips, summary, chartBox, emptyMsg, detail);
}

/** "▲ +7.5 kg over 3 months (92.5 → 100 kg)" etc. */
function summaryText(metric: Metric, range: (typeof RANGES)[number], inRange: ExerciseSession[]): Array<Node | string> {
  if (inRange.length === 0) return [];
  const first = metric.value(inRange[0])!, last = metric.value(inRange[inRange.length - 1])!;
  if (inRange.length === 1) return [`1 session in this range: ${metric.fmt(last)}`];
  const words = range.words || `since ${shortDate(inRange[0].date)}`;
  const span = ` ${words} (${metric.fmt(first)} → ${metric.fmt(last)})`;
  const delta = last - first;
  if (Math.abs(delta) < 1e-9) return [h('span', { class: 'muted' }, '●'), ` No change${span}`];
  const improved = metric.lowerIsBetter ? delta < 0 : delta > 0;
  const arrow = h('span', { class: improved ? 'progress-up' : 'progress-down' }, improved ? '▲' : '▼');
  if (metric.lowerIsBetter) {
    // Pace: talk about faster/slower rather than a signed number.
    return [arrow, ` ${metric.fmt(Math.abs(delta))} ${improved ? 'faster' : 'slower'}${span}`];
  }
  const amount = metric.fmt(Math.abs(delta));
  return [arrow, ` ${delta > 0 ? '+' : '−'}${amount}${span}`];
}

function showSession(box: HTMLElement, session: ExerciseSession, kind: Kind, units: Units): void {
  box.replaceChildren(
    h('div', { class: 'spread' },
      h('strong', {}, formatDate(session.date)),
      h('a', { class: 'small', href: `#/history/${session.workoutId}` }, 'Open workout ›'),
    ),
    h('ol', { class: 'progress-set-list' },
      ...session.sets.map((s) => h('li', {}, formatSet(s, kind, units), s.notes ? h('span', { class: 'muted small' }, ` — ${s.notes}`) : null)),
    ),
  );
}

/* ---------- Formatting ---------- */

function formatSet(s: WorkoutSet, kind: Kind, units: Units): string {
  if (kind === 'cardio' || ((s.distance || s.duration) && !s.reps)) {
    const parts: string[] = [];
    if (s.distance) parts.push(`${fmtNum(s.distance, 2)} km`);
    if (s.duration) parts.push(formatDuration(s.duration));
    if (s.distance && s.duration) parts.push(formatPace(s.duration / s.distance));
    return parts.join(' · ') || '–';
  }
  if (s.weight) return `${toDisplayWeight(s.weight, units)} ${units} × ${s.reps ?? 0}`;
  return `${s.reps ?? 0} reps`;
}

/** Compact "80×8, 80×8, 77.5×6". */
function setsSummary(sets: WorkoutSet[], kind: Kind, units: Units): string {
  return sets
    .map((s) => {
      if (kind === 'cardio') return formatSet(s, kind, units).split(' · ').slice(0, 2).join(' in ');
      return s.weight ? `${toDisplayWeight(s.weight, units)}×${s.reps ?? 0}` : `${s.reps ?? 0}`;
    })
    .join(', ');
}

/* ---------- Personal records ---------- */

function prCard(kind: Kind, sessions: ExerciseSession[], units: Units): HTMLElement {
  const prs = computePRs(sessions);
  const w = (kg: number) => `${toDisplayWeight(kg, units)} ${units}`;
  const tile = (label: string, value: string, sub: string) =>
    h('div', { class: 'progress-pr' }, h('div', { class: 'small muted' }, label), h('div', { class: 'progress-pr-value' }, value), h('div', { class: 'small muted' }, sub));
  const section = h('section', { class: 'card stack' }, h('h2', { class: 'progress-h2' }, 'Personal records'));
  const tiles = h('div', { class: 'progress-pr-grid' });
  section.append(tiles);

  if (kind === 'weighted') {
    if (prs.bestWeight) tiles.append(tile('Heaviest weight', w(prs.bestWeight.weight), `× ${prs.bestWeight.reps} · ${shortDate(prs.bestWeight.date)}`));
    if (prs.bestE1rm)
      tiles.append(tile('Best est. 1RM', w(prs.bestE1rm.value), `${w(prs.bestE1rm.weight)} × ${prs.bestE1rm.reps} · ${shortDate(prs.bestE1rm.date)}`));
    const weights = [...prs.repsAtWeight.entries()].sort((a, b) => b[0] - a[0]).slice(0, 8);
    if (weights.length) {
      section.append(
        h('h3', { class: 'progress-h3' }, 'Rep records'),
        h('table', { class: 'progress-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Weight'), h('th', {}, 'Most reps'), h('th', {}, 'Date'))),
          h('tbody', {}, ...weights.map(([kg, r]) => h('tr', {}, h('td', {}, w(kg)), h('td', {}, r.reps), h('td', { class: 'muted' }, shortDate(r.date))))),
        ),
      );
    }
  } else if (kind === 'reps') {
    let bestSet: { reps: number; date: number } | undefined;
    let bestTotal: { reps: number; date: number } | undefined;
    for (const s of sessions) {
      for (const set of s.sets) if ((set.reps ?? 0) > (bestSet?.reps ?? 0)) bestSet = { reps: set.reps!, date: s.date };
      if (s.totalReps > (bestTotal?.reps ?? 0)) bestTotal = { reps: s.totalReps, date: s.date };
    }
    if (bestSet) tiles.append(tile('Most reps in a set', `${bestSet.reps}`, shortDate(bestSet.date)));
    if (bestTotal) tiles.append(tile('Most reps in a session', `${bestTotal.reps}`, shortDate(bestTotal.date)));
  } else {
    if (prs.longestDistance) tiles.append(tile('Longest distance', `${fmtNum(prs.longestDistance.distance, 2)} km`, shortDate(prs.longestDistance.date)));
    if (prs.longestDuration) tiles.append(tile('Longest duration', formatDuration(prs.longestDuration.duration), shortDate(prs.longestDuration.date)));
    let bestPace: { pace: number; date: number } | undefined;
    for (const s of sessions) {
      if (s.distance > 0 && s.duration > 0) {
        const pace = s.duration / s.distance;
        if (!bestPace || pace < bestPace.pace) bestPace = { pace, date: s.date };
      }
    }
    if (bestPace) tiles.append(tile('Best pace', formatPace(bestPace.pace), shortDate(bestPace.date)));
  }
  if (!tiles.childElementCount) tiles.replaceWith(h('p', { class: 'muted small' }, 'No records yet.'));
  return section;
}

/* ---------- Recent sessions ---------- */

function recentCard(kind: Kind, sessions: ExerciseSession[], units: Units): HTMLElement {
  const recent = sessions.slice(-10).reverse();
  const best = (s: ExerciseSession): Array<Node | string> => {
    if (kind === 'weighted')
      return [`${toDisplayWeight(s.topWeight, units)} ${units}`, h('div', { class: 'small muted' }, `1RM ${toDisplayWeight(s.bestE1rm, units)}`)];
    if (kind === 'reps') return [`${s.totalReps} reps`];
    return [s.distance > 0 ? `${fmtNum(s.distance, 2)} km` : '', h('div', { class: 'small muted' }, s.duration > 0 ? formatDuration(s.duration) : '')];
  };
  return h('section', { class: 'card stack' },
    h('h2', { class: 'progress-h2' }, 'Recent sessions'),
    h('table', { class: 'progress-table progress-recent' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Sets'), h('th', {}, kind === 'cardio' ? 'Total' : 'Best'))),
      h('tbody', {},
        ...recent.map((s) =>
          h('tr', {},
            h('td', {}, h('a', { href: `#/history/${s.workoutId}` }, shortDate(s.date))),
            h('td', {}, setsSummary(s.sets, kind, units)),
            h('td', {}, ...best(s)),
          ),
        ),
      ),
    ),
  );
}
