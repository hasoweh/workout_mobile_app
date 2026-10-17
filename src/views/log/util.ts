import { db, type Exercise, type Workout, type WorkoutSet } from '../../db';
import { formatDate, formatDuration, toDisplayWeight } from '../../lib/format';
import type { Units } from '../../lib/settings';
import { toast } from '../../lib/ui';

/** Number → short string without float noise ("82.5", "80"). */
export function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Parses a user-typed number (accepts "," as decimal separator). Null when blank/invalid. */
export function parseNum(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "80 kg × 8" / "12 reps" / "5 km · 25:00". */
export function describeSet(s: WorkoutSet, ex: Exercise | undefined, units: Units): string {
  if (ex?.type === 'cardio' || (s.reps === undefined && (s.distance !== undefined || s.duration !== undefined))) {
    const parts: string[] = [];
    if (s.distance !== undefined) parts.push(`${fmtNum(s.distance)} km`);
    if (s.duration !== undefined) parts.push(formatDuration(s.duration));
    return parts.join(' · ') || '—';
  }
  const reps = s.reps ?? 0;
  return s.weight !== undefined && s.weight > 0
    ? `${fmtNum(toDisplayWeight(s.weight, units))} ${units} × ${reps}`
    : `${reps} reps`;
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

/** The in-progress workout, if any (newest wins if there are somehow several). */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const open = await db.workouts.filter((w) => w.endedAt === undefined).toArray();
  return open.sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Exercise order for a workout; falls back to set order for workouts saved before exerciseIds existed. */
export async function workoutExerciseIds(w: Workout, sets?: WorkoutSet[]): Promise<number[]> {
  const ids = [...(w.exerciseIds ?? [])];
  const all = sets ?? (await db.sets.where('workoutId').equals(w.id).toArray());
  for (const s of [...all].sort((a, b) => a.order - b.order)) if (!ids.includes(s.exerciseId)) ids.push(s.exerciseId);
  return ids;
}

/** Deletes a workout and all of its sets. */
export async function deleteWorkout(workoutId: number): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    await db.sets.where('workoutId').equals(workoutId).delete();
    await db.workouts.delete(workoutId);
  });
}

/** Wraps an async handler so failures surface as a toast instead of an unhandled rejection. */
export function safe<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): (...args: A) => void {
  return (...args: A) => {
    fn(...args).catch((err: unknown) => {
      console.error(err);
      toast('Something went wrong — please try again');
    });
  };
}
