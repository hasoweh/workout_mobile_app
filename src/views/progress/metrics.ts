import type { Exercise } from '../../db';
import type { ExerciseSession } from '../../lib/analytics';
import { fmtNum, formatDuration, formatPace, toDisplayWeight } from '../../lib/format';
import type { Units } from '../../lib/settings';

export type Kind = 'weighted' | 'reps' | 'cardio';

export interface Metric {
  key: string;
  label: string;
  /** Value for a session in display units, or null if the session has no data for it. */
  value: (s: ExerciseSession) => number | null;
  fmt: (v: number) => string;
  /** Pace: a smaller number is better. */
  lowerIsBetter?: boolean;
}

export function kindOf(ex: Exercise, sessions: ExerciseSession[]): Kind {
  if (ex.type === 'cardio') return 'cardio';
  return sessions.some((s) => s.topWeight > 0) ? 'weighted' : 'reps';
}

/** Chartable metrics per kind; the first one with data is the headline metric. */
export function metricsFor(kind: Kind, units: Units): Metric[] {
  const w = (v: number) => `${fmtNum(v, 1)} ${units}`;
  const nz = (v: number) => (v > 0 ? v : null);
  const reps = (v: number) => `${fmtNum(v, 0)} reps`;
  switch (kind) {
    case 'weighted':
      return [
        { key: 'e1rm', label: 'Est. 1RM', value: (s) => (s.bestE1rm > 0 ? toDisplayWeight(s.bestE1rm, units) : null), fmt: w },
        { key: 'top', label: 'Top weight', value: (s) => (s.topWeight > 0 ? toDisplayWeight(s.topWeight, units) : null), fmt: w },
        { key: 'volume', label: 'Volume', value: (s) => (s.volume > 0 ? Math.round(toDisplayWeight(s.volume, units)) : null), fmt: (v) => `${Math.round(v).toLocaleString()} ${units}` },
        { key: 'totalReps', label: 'Total reps', value: (s) => nz(s.totalReps), fmt: reps },
      ];
    case 'reps':
      return [
        { key: 'maxReps', label: 'Best set', value: (s) => nz(Math.max(0, ...s.sets.map((x) => x.reps ?? 0))), fmt: reps },
        { key: 'totalReps', label: 'Total reps', value: (s) => nz(s.totalReps), fmt: reps },
      ];
    case 'cardio':
      return [
        { key: 'distance', label: 'Distance', value: (s) => nz(s.distance), fmt: (v) => `${fmtNum(v, 2)} km` },
        { key: 'duration', label: 'Duration', value: (s) => nz(s.duration), fmt: formatDuration },
        { key: 'pace', label: 'Pace', value: (s) => (s.distance > 0 && s.duration > 0 ? s.duration / s.distance : null), fmt: formatPace, lowerIsBetter: true },
      ];
  }
}

export function hasData(metric: Metric, sessions: ExerciseSession[]): boolean {
  return sessions.some((s) => metric.value(s) !== null);
}

/** Fewest sessions a trend is fitted to; with fewer, one good or bad day dominates. */
export const MIN_TREND_POINTS = 3;
/** A fitted change smaller than this fraction of the average counts as "holding steady". */
const FLAT_FRACTION = 0.02;
const DAY = 86_400_000;

export interface Trend {
  /** Fitted value at a timestamp (ms). */
  at: (x: number) => number;
  /** Fitted values at the first and last session. */
  start: number;
  end: number;
  /** Change per day, in metric units. */
  perDay: number;
  /** Fitted change as a percentage of the starting value. */
  pct: number;
  /** Direction in terms of the athlete (pace going down is "better"). */
  direction: 'better' | 'worse' | 'flat';
}

/**
 * Least-squares straight line through one point per session. Much less noisy than comparing the first and
 * last session, so a single off day (or a deload) doesn't flip the verdict.
 */
export function fitTrend(points: Array<{ x: number; y: number }>, lowerIsBetter = false): Trend | null {
  if (points.length < MIN_TREND_POINTS) return null;
  const x0 = points[0].x;
  const xs = points.map((p) => (p.x - x0) / DAY);
  const ys = points.map((p) => p.y);
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null; // All on one day.
  const perDay = sxy / sxx;
  const at = (x: number) => my + perDay * ((x - x0) / DAY - mx);
  const start = at(points[0].x);
  const end = at(points[n - 1].x);
  const base = start > 0 ? start : my;
  const pct = base > 0 ? ((end - start) / base) * 100 : 0;
  const flat = my === 0 || Math.abs(end - start) < Math.abs(my) * FLAT_FRACTION;
  const up = end > start;
  return { at, start, end, perDay, pct, direction: flat ? 'flat' : up !== lowerIsBetter ? 'better' : 'worse' };
}

export function sessionPoints(metric: Metric, sessions: ExerciseSession[]): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const s of sessions) {
    const y = metric.value(s);
    if (y !== null) points.push({ x: s.date, y });
  }
  return points;
}
