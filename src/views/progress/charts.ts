import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, BarController, BarElement, Tooltip } from 'chart.js';
import { MUSCLES, type Muscle } from '../../db';

// Tree-shaken Chart.js: only what the Progress tab uses.
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, BarController, BarElement, Tooltip);

/** Charts created by the current Progress render. */
let live: Chart[] = [];

export function track<T extends Chart>(chart: T): T {
  live.push(chart);
  return chart;
}

export function untrack(chart: Chart): void {
  live = live.filter((c) => c !== chart);
  chart.destroy();
}

/** Hands over all tracked charts (and forgets them), e.g. before a re-render. */
export function takeCharts(): Chart[] {
  const old = live;
  live = [];
  return old;
}

/**
 * Destroys charts once their canvas has left the document. The router builds the new view off-screen and swaps it
 * in afterwards, so destroying immediately would blank the old charts while the next view loads.
 */
export function destroyWhenDetached(charts: Chart[]): void {
  const pending = charts.filter((c) => {
    if (c.canvas?.isConnected) return true;
    c.destroy();
    return false;
  });
  if (pending.length) setTimeout(() => destroyWhenDetached(pending), 500);
}

export interface Theme {
  accent: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
  dark: boolean;
}

/** Current theme colors from the CSS variables in styles.css (so charts follow light/dark mode). */
export function theme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = v('--bg', '#f6f7f9');
  const t: Theme = {
    accent: v('--accent', '#16a34a'),
    text: v('--text', '#15171c'),
    muted: v('--muted', '#6b7280'),
    border: v('--border', '#e5e7eb'),
    surface: v('--surface', '#ffffff'),
    dark: luminance(bg) < 0.4,
  };
  Chart.defaults.color = t.muted;
  Chart.defaults.borderColor = t.border;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily || 'system-ui';
  return t;
}

// Fixed categorical palette, one slot per muscle in MUSCLES order.
const PALETTE_LIGHT = ['#2a78d6', '#eb6834', '#8b5a2b', '#1baf7a', '#eda100', '#e87ba4', '#0f8b8d', '#008300', '#6250d6', '#e34948', '#6b7280'];
const PALETTE_DARK = ['#3987e5', '#d95926', '#b07a45', '#199e70', '#c98500', '#d55181', '#22a5a7', '#2e9e2e', '#9085e9', '#e66767', '#9ca3af'];

export function muscleColor(group: Muscle, dark: boolean): string {
  const i = Math.max(0, MUSCLES.indexOf(group));
  return (dark ? PALETTE_DARK : PALETTE_LIGHT)[i % PALETTE_LIGHT.length];
}

/** Relative brightness 0..1 of a #rgb / #rrggbb color (0.5 if unparseable). */
function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function parseHex(color: string): [number, number, number] | null {
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const shortDateYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: '2-digit' });

/** "17 Oct" (adds a 2-digit year if not the current year). */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return d.getFullYear() === new Date().getFullYear() ? shortDateFmt.format(d) : shortDateYearFmt.format(d);
}

/** Number with up to `digits` decimals, trailing zeros trimmed. */
export function fmtNum(v: number, digits = 1): string {
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}
