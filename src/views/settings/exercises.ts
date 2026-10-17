import { db, MUSCLES, type Exercise, type ExerciseType, type Muscle } from '../../db';
import { muscleChips } from '../../components/muscle-chips';
import { h } from '../../lib/dom';
import { confirmDialog, openSheet, toast } from '../../lib/ui';

/** "Exercises" settings card: searchable list grouped by primary muscle, tap to edit. */
export async function exercisesSection(): Promise<HTMLElement> {
  const card = h('section', { class: 'card stack' });
  let query = '';

  const listEl = h('div', { class: 'settings-ex-groups' });
  const render = async () => {
    const exercises = await db.exercises.orderBy('name').toArray();
    renderList(listEl, exercises, query, (ex) => void openEditor(ex, render));
  };

  const search = h('input', {
    type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises',
    oninput: () => { query = search.value.trim().toLowerCase(); void render(); },
  });

  card.append(
    h('div', { class: 'spread' },
      h('h2', { class: 'settings-h2' }, 'Exercises'),
      h('button', { class: 'btn-secondary', onclick: () => void openEditor(null, render) }, '+ New exercise'),
    ),
    search,
    listEl,
  );
  await render();
  return card;
}

function renderList(el: HTMLElement, exercises: Exercise[], query: string, onPick: (ex: Exercise) => void): void {
  const matches = exercises.filter((e) => !query || e.name.toLowerCase().includes(query) || e.muscles.some((m) => m.toLowerCase().includes(query)));
  const item = (ex: Exercise) =>
    h('li', {},
      h('button', { class: 'settings-ex-item', onclick: () => onPick(ex) },
        h('span', { class: 'grow' }, ex.name,
          ex.muscles.length > 1 ? h('span', { class: 'muted small settings-block' }, `also ${ex.muscles.slice(1).join(', ')}`) : null),
        ex.type === 'cardio' && ex.muscles[0] !== 'Cardio' ? h('span', { class: 'muted small' }, 'cardio') : null,
        h('span', { class: 'muted', 'aria-hidden': 'true' }, '›'),
      ),
    );

  const groups: HTMLElement[] = [];
  for (const group of MUSCLES) {
    const inGroup = matches.filter((e) => !e.archived && e.muscles[0] === group);
    if (inGroup.length === 0) continue;
    groups.push(h('div', {},
      h('h3', { class: 'settings-ex-group' }, group),
      h('ul', { class: 'list' }, ...inGroup.map(item)),
    ));
  }
  const archived = matches.filter((e) => e.archived);
  if (archived.length > 0) {
    // Expanded while searching so matches aren't hidden.
    groups.push(h('details', { class: 'settings-archived', open: !!query },
      h('summary', {}, `Archived (${archived.length})`),
      h('ul', { class: 'list' }, ...archived.map(item)),
    ));
  }
  el.replaceChildren(...(groups.length ? groups : [h('p', { class: 'muted' }, 'No exercises match.')]));
}

/** Edit sheet for an exercise, or a "new exercise" sheet when `ex` is null. */
async function openEditor(ex: Exercise | null, onChange: () => Promise<void>): Promise<void> {
  const setCount = ex ? await db.sets.where('exerciseId').equals(ex.id).count() : 0;
  let muscles: Muscle[] = ex?.muscles ?? [];
  let type: ExerciseType = ex?.type ?? 'strength';
  let archived = ex?.archived ?? false;

  const name = h('input', { type: 'text', value: ex?.name ?? '', maxlength: 80, autocomplete: 'off', id: 'settings-ex-name' });
  const error = h('p', { class: 'settings-error', hidden: true });
  const showError = (msg: string) => { error.textContent = msg; error.hidden = false; };

  const chipRow = <T extends string>(options: readonly T[], get: () => T | null, set: (v: T) => void) => {
    const row = h('div', { class: 'chips' });
    const draw = () => row.replaceChildren(...options.map((o) =>
      h('button', { class: `chip${get() === o ? ' active' : ''}`, 'aria-pressed': String(get() === o), onclick: () => { set(o); draw(); } }, o)));
    draw();
    return row;
  };

  const archiveToggle = h('label', { class: 'settings-toggle' },
    h('input', { type: 'checkbox', checked: archived, onchange: (e: Event) => { archived = (e.target as HTMLInputElement).checked; } }),
    h('span', {}, 'Archived', h('span', { class: 'muted small settings-block' }, 'Hidden from the exercise picker. History and charts are kept.')),
  );

  const save = async () => {
    const trimmed = name.value.trim().replace(/\s+/g, ' ');
    if (!trimmed) return showError('Enter a name.');
    if (muscles.length === 0) return showError('Pick a primary muscle.');
    const clash = (await db.exercises.toArray()).find((e) => e.id !== ex?.id && e.name.toLowerCase() === trimmed.toLowerCase());
    if (clash) return showError(`"${clash.name}" already exists${clash.archived ? ' (archived)' : ''}.`);
    try {
      if (ex) await db.exercises.update(ex.id, { name: trimmed, muscles, type, archived });
      else await db.exercises.add({ name: trimmed, muscles, type, archived, createdAt: Date.now() } as Exercise);
    } catch (err) {
      if (err instanceof Error && err.name === 'ConstraintError') return showError('An exercise with that name already exists.');
      return showError(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
    close();
    toast(ex ? 'Exercise saved' : 'Exercise added');
    await onChange();
  };

  const remove = async () => {
    if (!ex) return;
    if (!(await confirmDialog(`Delete "${ex.name}"? This can't be undone.`, { confirmLabel: 'Delete', danger: true }))) return;
    try {
      await db.transaction('rw', db.exercises, db.sets, db.workouts, async () => {
        // Re-check inside the transaction in case a set was logged meanwhile.
        if ((await db.sets.where('exerciseId').equals(ex.id).count()) > 0) throw new Error('This exercise has logged sets.');
        // Drop it from any workout's exercise list (e.g. added to a workout but never logged).
        await db.workouts.toCollection().modify((w) => { w.exerciseIds = w.exerciseIds.filter((id) => id !== ex.id); });
        await db.exercises.delete(ex.id);
      });
    } catch (err) {
      toast(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    close();
    toast('Exercise deleted');
    await onChange();
  };

  const content = h('div', { class: 'stack' },
    h('div', {}, h('label', { for: 'settings-ex-name' }, 'Name'), name),
    muscleChips(muscles, (m) => { muscles = m; }),
    h('div', {}, h('label', {}, 'Type'), chipRow(['strength', 'cardio'] as const, () => type, (v) => { type = v; })),
    ex ? archiveToggle : null,
    ex ? h('p', { class: 'muted small' }, setCount === 1 ? '1 set logged.' : `${setCount} sets logged.`) : null,
    error,
    h('button', { class: 'btn-block btn-lg', onclick: () => void save() }, ex ? 'Save' : 'Add exercise'),
    ex && setCount === 0 ? h('button', { class: 'btn-danger btn-block', onclick: () => void remove() }, 'Delete exercise') : null,
    ex && setCount > 0 && !ex.archived
      ? h('p', { class: 'muted small' }, 'Exercises with logged sets can\'t be deleted. Archive it instead to hide it while keeping its history.')
      : null,
  );
  const close = openSheet(content, { title: ex ? 'Edit exercise' : 'New exercise' });
  if (!ex) name.focus();
}
