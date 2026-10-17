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
