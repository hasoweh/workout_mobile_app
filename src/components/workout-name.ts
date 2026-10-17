import { db, type Workout } from '../db';
import { h } from '../lib/dom';
import { toast } from '../lib/ui';
import './workout-name.css';

let listSeq = 0;

/**
 * Heading-style input for a workout's name. Saves as you type (debounced) and on blur; empty clears the name.
 * Suggests names used on previous workouts.
 */
export function workoutNameInput(workout: Workout, opts: { placeholder?: string } = {}): HTMLElement {
  const listId = `workout-names-${++listSeq}`;
  const datalist = h('datalist', { id: listId });
  const input = h('input', {
    type: 'text', class: 'workout-name', list: listId, maxlength: 60, autocomplete: 'off', enterkeyhint: 'done',
    placeholder: opts.placeholder ?? 'Name this workout', 'aria-label': 'Workout name', value: workout.name ?? '',
  });

  let saved = workout.name ?? '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (name === saved) return;
    saved = name;
    workout.name = name || undefined;
    db.workouts.update(workout.id, { name: name || undefined })
      .catch((err: unknown) => { console.error(err); toast('Could not save name'); });
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 600); });
  input.addEventListener('change', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  void pastNames(workout.id).then((names) => datalist.replaceChildren(...names.map((n) => h('option', { value: n }))));
  return h('div', {}, input, datalist);
}

/** Distinct names of other workouts, most recently used first. */
async function pastNames(excludeId: number): Promise<string[]> {
  const workouts = await db.workouts.orderBy('startedAt').reverse().toArray();
  const seen = new Map<string, string>();
  for (const w of workouts) {
    const n = w.name?.trim();
    if (w.id !== excludeId && n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  }
  return [...seen.values()].slice(0, 20);
}
