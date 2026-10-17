import type { Exercise, WorkoutSet } from '../db';
import type { Units } from './settings';

const KG_PER_LB = 0.45359237;

/** kg (storage) → display units, rounded to 0.1. */
export function toDisplayWeight(kg: number, units: Units): number {
  const v = units === 'kg' ? kg : kg / KG_PER_LB;
  return Math.round(v * 10) / 10;
}

/** Display units → kg (storage). */
export function fromDisplayWeight(value: number, units: Units): number {
  return units === 'kg' ? value : value * KG_PER_LB;
}

export function formatWeight(kg: number, units: Units): string {
  return `${toDisplayWeight(kg, units)} ${units}`;
}

/** Seconds → "m:ss" or "h:mm:ss". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Parses "m:ss", "h:mm:ss" or plain minutes ("25") into seconds; null if invalid. */
export function parseDuration(input: string): number | null {
  const parts = input.trim().split(':').map(Number);
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 1) return Math.round(parts[0] * 60);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** Seconds per km → "m:ss /km". */
export function formatPace(secondsPerKm: number): string {
  return `${formatDuration(secondsPerKm)} /km`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dateYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Sat 17 Oct" (adds the year if not the current year). */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateYearFmt.format(d);
}

export function formatTime(ms: number): string {
  return timeFmt.format(new Date(ms));
}

/** Number → short string without float noise ("82.5", "81.25", "80"). */
export function fmtNum(n: number, digits = 2): string {
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

/** Volume (kg) in display units, rounded to a whole number: "12,340 kg". */
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

/** One set as text: "80 kg × 8", "12 reps" or "5.0 km · 25:00 · 5:00 /km". */
export function formatSet(s: WorkoutSet, cardio: boolean, units: Units): string {
  if (cardio) {
    const parts: string[] = [];
    if (s.distance) parts.push(formatDistance(s.distance));
    if (s.duration) parts.push(formatDuration(s.duration));
    if (s.distance && s.duration) parts.push(formatPace(s.duration / s.distance));
    return parts.join(' · ') || '—';
  }
  const w = s.weight ? `${fmtNum(toDisplayWeight(s.weight, units))} ${units}` : '';
  const r = s.reps ?? 0;
  if (w) return `${w} × ${r}`;
  return `${r} rep${r === 1 ? '' : 's'}`;
}
