import { MUSCLES, type Muscle } from '../db';
import { h } from '../lib/dom';

/**
 * Muscle selector: a single-select "Primary" chip row plus a multi-select "Also works" row.
 * `onChange` receives the muscles primary-first (empty until a primary is picked).
 */
export function muscleChips(initial: Muscle[], onChange: (muscles: Muscle[]) => void): HTMLElement {
  let primary: Muscle | null = initial[0] ?? null;
  const secondary = new Set<Muscle>(initial.slice(1));
  const primaryRow = h('div', { class: 'chips' });
  const secondaryRow = h('div', { class: 'chips' });
  const secondaryWrap = h('div', {}, h('label', {}, 'Also works (optional)'), secondaryRow);

  const chip = (m: Muscle, active: boolean, onclick: () => void) =>
    h('button', { type: 'button', class: `chip${active ? ' active' : ''}`, 'aria-pressed': String(active), onclick }, m);

  const paint = () => {
    primaryRow.replaceChildren(...MUSCLES.map((m) => chip(m, m === primary, () => {
      primary = m;
      secondary.delete(m);
      changed();
    })));
    // Cardio has no meaningful secondaries; hide the row until a primary is chosen.
    secondaryWrap.hidden = primary === null || primary === 'Cardio';
    secondaryRow.replaceChildren(...MUSCLES.filter((m) => m !== primary && m !== 'Cardio').map((m) => chip(m, secondary.has(m), () => {
      if (secondary.has(m)) secondary.delete(m);
      else secondary.add(m);
      changed();
    })));
  };
  const changed = () => {
    paint();
    // Keep secondaries in canonical MUSCLES order for consistent display.
    onChange(primary ? [primary, ...MUSCLES.filter((m) => secondary.has(m))] : []);
  };

  paint();
  return h('div', { class: 'stack' }, h('div', {}, h('label', {}, 'Primary muscle'), primaryRow), secondaryWrap);
}

/** "Chest · Triceps, Shoulders" — primary, then secondaries. */
export function musclesLabel(muscles: Muscle[]): string {
  const [primary, ...rest] = muscles;
  return rest.length ? `${primary} · ${rest.join(', ')}` : primary ?? '';
}
