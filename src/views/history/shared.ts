import { formatDuration } from '../../lib/format';

/** Workout duration from start/end (ms). */
export function workoutDuration(startedAt: number, endedAt: number): string {
  return formatDuration((endedAt - startedAt) / 1000);
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
