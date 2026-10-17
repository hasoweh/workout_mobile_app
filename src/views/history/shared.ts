import type { Exercise, WorkoutSet } from '../../db';
import type { Units } from '../../lib/settings';
import { formatDuration, formatPace, toDisplayWeight } from '../../lib/format';
import { toast } from '../../lib/ui';

/** Sum of weight × reps, in kg. */
export function setsVolume(sets: WorkoutSet[]): number {
  let v = 0;
  for (const s of sets) v += (s.weight ?? 0) * (s.reps ?? 0);
  return v;
}

export function setsDistance(sets: WorkoutSet[]): number {
  let d = 0;
  for (const s of sets) d += s.distance ?? 0;
  return d;
}

/** Volume in display units, rounded to a whole number: "12,340 kg". */
export function formatVolume(kg: number, units: Units): string {
  return `${Math.round(toDisplayWeight(kg, units)).toLocaleString()} ${units}`;
}

/** "5.0 km", "5.25 km". */
export function formatDistance(km: number): string {
  const r = Math.round(km * 100) / 100;
  return `${Number.isInteger(r * 10) ? r.toFixed(1) : String(r)} km`;
}

/** True if the exercise is cardio, or (if unknown) the sets look like cardio. */
export function isCardio(exercise: Exercise | undefined, sets: WorkoutSet[]): boolean {
  if (exercise) return exercise.type === 'cardio';
  return sets.some((s) => s.distance !== undefined || s.duration !== undefined);
}

/** One set as text: "80 kg × 8" or "5.0 km · 25:00 · 5:00 /km". */
export function formatSet(s: WorkoutSet, cardio: boolean, units: Units): string {
  if (cardio) {
    const parts: string[] = [];
    if (s.distance) parts.push(formatDistance(s.distance));
    if (s.duration) parts.push(formatDuration(s.duration));
    if (s.distance && s.duration) parts.push(formatPace(s.duration / s.distance));
    return parts.join(' · ') || '—';
  }
  const w = s.weight ? `${toDisplayWeight(s.weight, units)} ${units}` : '';
  const r = s.reps ?? 0;
  if (w) return `${w} × ${r}`;
  return `${r} rep${r === 1 ? '' : 's'}`;
}

/** Workout duration from start/end (ms). */
export function workoutDuration(startedAt: number, endedAt: number): string {
  return formatDuration((endedAt - startedAt) / 1000);
}

/** Wraps an async handler so failures show a toast instead of an unhandled rejection. */
export function safe<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
  return (...args: A) => {
    fn(...args).catch((err: unknown) => {
      console.error(err);
      toast('Something went wrong');
    });
  };
}

/** ms → value for <input type="datetime-local"> (local time, minute precision). */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Parses a datetime-local value as local time; null if invalid. */
export function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
