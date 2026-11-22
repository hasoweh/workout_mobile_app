import { musclesLabel } from '../../components/muscle-chips';
import { Chart, type Plugin } from 'chart.js';
import { db, type WorkoutSet } from '../../db';
import { computePRs, exerciseHistory, startOfDay, type ExerciseSession } from '../../lib/analytics';
import { h } from '../../lib/dom';
import { fmtNum, formatDate, formatDuration, formatPace, toDisplayWeight } from '../../lib/format';
import { getSettings, type Units } from '../../lib/settings';
import { shortDate, theme, track, untrack } from './charts';
import { fitTrend, hasData, kindOf, metricsFor, MIN_TREND_POINTS, type Kind, type Metric, type Trend } from './metrics';

type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'All';

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

function rangeStart(months: number): number {
  if (!months) return 0;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return startOfDay(d.getTime());
}

/* ---------- Trend chart ---------- */

function chartCard(kind: Kind, sessions: ExerciseSession[], units: Units): HTMLElement {
  const metrics = metricsFor(kind, units);
  const withData = (m: Metric) => hasData(m, sessions);
  let metric = metrics.find((m) => m.key === lastMetric[kind] && withData(m)) ?? metrics.find(withData) ?? metrics[0];
  let range = RANGES.find((r) => r.key === lastRange) ?? RANGES[1];

  const summary = h('div', { class: 'progress-summary' });
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Trend chart, one point per session, with a dashed trend line' });
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
    const trend = fitTrend(points, metric.lowerIsBetter);

    if (chart) untrack(chart);
    chart = undefined;
    summary.replaceChildren(...summaryText(metric, range, inRange, trend));
    chartBox.hidden = points.length === 0;
    emptyMsg.hidden = points.length > 0;
    if (points.length === 0) return;

    const t = theme();
    const minX = points[0].x, maxX = points[points.length - 1].x;
    const pad = Math.max((maxX - minX) * 0.04, 86_400_000);
    const trendColor = trend?.direction === 'better' ? t.accent : t.muted;
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
        // Trend line drawn behind the data (a plugin rather than a dataset, so it never steals taps or tooltips).
        plugins: trend ? [trendLinePlugin(trend, minX, maxX, trendColor)] : [],
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
    if (!withData(m)) continue;
    metricChips.append(h('button', { class: 'chip', 'data-key': m.key, onclick: () => { metric = m; lastMetric[kind] = m.key; draw(); } }, m.label));
  }
  for (const r of RANGES) {
    rangeChips.append(h('button', { class: 'chip', 'data-key': r.key, onclick: () => { range = r; lastRange = r.key; draw(); } }, r.key));
  }
  draw();

  return h('section', { class: 'card stack' }, metricChips, rangeChips, summary, chartBox, emptyMsg, detail);
}

function trendLinePlugin(trend: Trend, fromX: number, toX: number, color: string): Plugin<'line'> {
  return {
    id: 'trendLine',
    beforeDatasetsDraw(c) {
      const { ctx, chartArea, scales } = c;
      const x = scales.x, y = scales.y;
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
      ctx.clip();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(x.getPixelForValue(fromX), y.getPixelForValue(trend.at(fromX)));
      ctx.lineTo(x.getPixelForValue(toX), y.getPixelForValue(trend.at(toX)));
      ctx.stroke();
      ctx.restore();
    },
  };
}

/**
 * Headline verdict from the fitted trend ("▲ Trending up +8% over 3 months"), plus the rate and the
 * first → last values underneath.
 */
function summaryText(metric: Metric, range: (typeof RANGES)[number], inRange: ExerciseSession[], trend: Trend | null): Array<Node | string> {
  if (inRange.length === 0) return [];
  const first = metric.value(inRange[0])!, last = metric.value(inRange[inRange.length - 1])!;
  const n = inRange.length;
  const words = range.words || `since ${shortDate(inRange[0].date)}`;
  const sessionsWord = `${n} session${n === 1 ? '' : 's'}`;
  const sub = (...parts: string[]) => h('div', { class: 'small muted progress-summary-sub' }, parts.join(' · '));

  if (!trend) {
    return [
      h('div', {}, n === 1 ? `1 session in this range: ${metric.fmt(last)}` : `${metric.fmt(first)} → ${metric.fmt(last)} ${words}`),
      sub(`Log ${MIN_TREND_POINTS - n > 0 ? `${MIN_TREND_POINTS - n} more session${MIN_TREND_POINTS - n === 1 ? '' : 's'}` : 'sessions on different days'} in this range to see a trend`),
    ];
  }

  const span = `${metric.fmt(first)} → ${metric.fmt(last)}`;
  if (trend.direction === 'flat') {
    return [
      h('div', {}, h('span', { class: 'muted' }, '●'), ` Holding steady ${words}`),
      sub(sessionsWord, span),
    ];
  }

  const better = trend.direction === 'better';
  const arrow = h('span', { class: better ? 'progress-up' : 'progress-down' }, better ? '▲' : '▼');
  const pct = `${Math.abs(trend.pct) >= 10 ? Math.round(Math.abs(trend.pct)) : fmtNum(Math.abs(trend.pct), 1)}%`;
  // Rate per week for short spans, per month otherwise.
  const spanDays = (inRange[n - 1].date - inRange[0].date) / 86_400_000;
  const [perDays, perWord] = spanDays < 42 ? [7, 'week'] : [30.44, 'month'];
  const rate = Math.abs(trend.perDay * perDays);
  let headline: string, rateText: string;
  if (metric.lowerIsBetter) {
    headline = `${better ? 'Getting faster' : 'Getting slower'} ${pct} ${words}`;
    rateText = `≈ ${metric.fmt(rate)} ${better ? 'faster' : 'slower'} per ${perWord}`;
  } else {
    headline = `Trending ${trend.end > trend.start ? 'up' : 'down'} ${trend.end > trend.start ? '+' : '−'}${pct} ${words}`;
    rateText = `≈ ${trend.perDay > 0 ? '+' : '−'}${metric.fmt(rate)} per ${perWord}`;
  }
  return [h('div', {}, arrow, ` ${headline}`), sub(rateText, sessionsWord, span)];
}

function showSession(box: HTMLElement, session: ExerciseSession, kind: Kind, units: Units): void {
  box.replaceChildren(
    h('div', { class: 'spread' },
      h('strong', {}, formatDate(session.date)),
      h('a', { class: 'small', href: `#/log/${session.workoutId}` }, 'Open workout ›'),
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
            h('td', {}, h('a', { href: `#/log/${s.workoutId}` }, shortDate(s.date))),
            h('td', {}, setsSummary(s.sets, kind, units)),
            h('td', {}, ...best(s)),
          ),
        ),
      ),
    ),
  );
}
