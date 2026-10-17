import type { Exercise, WorkoutSet } from '../../db';
import { fmtNum, formatDate, formatSet, isCardio, toDisplayWeight } from '../../lib/format';
import type { Units } from '../../lib/settings';

/** Parses a user-typed number (accepts "," as decimal separator). Null when blank/invalid. */
export function parseNum(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "80 kg × 8" / "12 reps" / "5.0 km · 25:00". */
export function describeSet(s: WorkoutSet, ex: Exercise | undefined, units: Units): string {
  return formatSet(s, isCardio(ex, [s]), units);
}

/** "Last: 80 kg × 8, 8, 6 · Sat 10 Oct" summary of a previous session. */
export function describeLastSession(sets: WorkoutSet[], ex: Exercise, units: Units): string | null {
  if (sets.length === 0) return null;
  const date = formatDate(sets[0].createdAt);
  if (ex.type === 'cardio') return `Last: ${sets.map((s) => describeSet(s, ex, units)).join(', ')} · ${date}`;
  const weights = sets.map((s) => (s.weight ? toDisplayWeight(s.weight, units) : 0));
  const sameWeight = weights.every((w) => w === weights[0]);
  let body: string;
  if (sameWeight) {
    const reps = sets.map((s) => s.reps ?? 0).join(', ');
    body = weights[0] > 0 ? `${fmtNum(weights[0])} ${units} × ${reps}` : `${reps} reps`;
  } else {
    body = sets.map((s, i) => `${fmtNum(weights[i])}×${s.reps ?? 0}`).join(', ') + ` ${units}`;
  }
  return `Last: ${body} · ${date}`;
}
