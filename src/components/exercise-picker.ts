import { db, MUSCLE_GROUPS, type Exercise, type ExerciseType, type MuscleGroup } from '../db';
import { h } from '../lib/dom';
import { openSheet, toast } from '../lib/ui';
import './exercise-picker.css';

const RECENT_LIMIT = 8;

/**
 * Bottom-sheet exercise picker with search, recents, grouping and inline "create".
 * Resolves with the chosen (or newly created) exercise, or null if dismissed.
 */
export function pickExercise(opts: { exclude?: number[]; title?: string } = {}): Promise<Exercise | null> {
  return new Promise((resolve) => {
    const exclude = new Set(opts.exclude ?? []);
    let picked: Exercise | null = null;
    let all: Exercise[] = [];
    let recent: Exercise[] = [];
    let loaded = false;
    let creating = false;

    const search = h('input', {
      type: 'search', class: 'picker-search', placeholder: 'Search or create exercise',
      autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search exercises',
    });
    const body = h('div', { class: 'picker-body' });
    const close = openSheet(
      h('div', { class: 'picker' }, h('div', { class: 'picker-search-wrap' }, search), body),
      { title: opts.title ?? 'Add exercise', onClose: () => resolve(picked) },
    );
    const choose = (ex: Exercise) => { picked = ex; close(); };

    const row = (ex: Exercise, showGroup: boolean) =>
      h('button', { type: 'button', class: 'picker-row', onclick: () => choose(ex) },
        h('span', { class: 'picker-row-name' }, ex.name),
        showGroup || ex.type === 'cardio'
          ? h('span', { class: 'picker-row-meta' }, showGroup ? `${ex.muscleGroup}${ex.type === 'cardio' ? ' · cardio' : ''}` : 'cardio')
          : null,
      );

    const section = (title: string, items: Exercise[], showGroup = false) =>
      items.length === 0 ? null : h('section', { class: 'picker-section' },
        h('h3', { class: 'picker-section-title' }, title),
        h('div', { class: 'picker-rows' }, ...items.map((ex) => row(ex, showGroup))),
      );

    const matches = (q: string) => {
      const lq = q.toLowerCase();
      return all.filter((e) => e.name.toLowerCase().includes(lq))
        .sort((a, b) => rank(a.name, lq) - rank(b.name, lq) || a.name.localeCompare(b.name));
    };

    const renderBody = () => {
      if (!loaded) { body.replaceChildren(h('p', { class: 'muted picker-hint' }, 'Loading…')); return; }
      const q = search.value.trim().replace(/\s+/g, ' ');
      if (!q) {
        body.replaceChildren(...[
          section('Recent', recent),
          ...MUSCLE_GROUPS.map((g) => section(g, all.filter((e) => e.muscleGroup === g))),
        ].filter((s): s is HTMLElement => s !== null));
        if (all.length === 0) body.append(h('p', { class: 'empty' }, 'No exercises yet. Type a name to create one.'));
        return;
      }
      const found = matches(q);
      const exact = found.some((e) => e.name.toLowerCase() === q.toLowerCase());
      const children: Array<Node | null> = [];
      if (!exact) children.push(creating ? createForm(q) : h('button', {
        type: 'button', class: 'picker-row picker-create',
        onclick: () => { creating = true; renderBody(); },
      }, `+ Create "${q}"`));
      if (found.length) children.push(h('div', { class: 'picker-rows' }, ...found.map((ex) => row(ex, true))));
      else if (exact) children.push(h('p', { class: 'muted picker-hint' }, 'No matches.'));
      body.replaceChildren(...children.filter((c): c is Node => c !== null));
    };

    // Inline "new exercise" form: muscle group (required) and type.
    const createForm = (initialName: string): HTMLElement => {
      let group: MuscleGroup | null = null;
      let type: ExerciseType = 'strength';
      let typeTouched = false;
      const nameIn = h('input', { type: 'text', value: initialName, autocomplete: 'off', 'aria-label': 'Exercise name' });
      const groupChips = h('div', { class: 'chips' });
      const typeChips = h('div', { class: 'chips' });
      const saveBtn = h('button', { type: 'button', class: 'btn-block btn-lg', disabled: true }, 'Save & add');

      const paint = () => {
        groupChips.replaceChildren(...MUSCLE_GROUPS.map((g) => h('button', {
          type: 'button', class: `chip${g === group ? ' active' : ''}`,
          onclick: () => {
            group = g;
            if (!typeTouched) type = g === 'Cardio' ? 'cardio' : 'strength';
            paint();
          },
        }, g)));
        typeChips.replaceChildren(...(['strength', 'cardio'] as const).map((t) => h('button', {
          type: 'button', class: `chip${t === type ? ' active' : ''}`,
          onclick: () => { type = t; typeTouched = true; paint(); },
        }, t === 'strength' ? 'Strength' : 'Cardio')));
        saveBtn.disabled = group === null;
      };

      saveBtn.addEventListener('click', () => {
        const name = nameIn.value.trim().replace(/\s+/g, ' ');
        if (!name) { toast('Enter a name'); return; }
        if (!group) { toast('Pick a muscle group'); return; }
        saveBtn.disabled = true;
        createExercise(name, group, type)
          .then((ex) => { if (ex) choose(ex); else saveBtn.disabled = false; })
          .catch((err: unknown) => { console.error(err); toast('Could not save exercise'); saveBtn.disabled = false; });
      });

      paint();
      return h('div', { class: 'card stack picker-form' },
        h('div', {}, h('label', {}, 'Name'), nameIn),
        h('div', {}, h('label', {}, 'Muscle group'), groupChips),
        h('div', {}, h('label', {}, 'Type'), typeChips),
        saveBtn,
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => { creating = false; renderBody(); } }, 'Cancel'),
      );
    };

    search.addEventListener('input', () => { creating = false; renderBody(); });
    search.addEventListener('keydown', (e) => {
      // Enter picks the top match.
      if (e.key !== 'Enter' || creating) return;
      const q = search.value.trim();
      const first = q ? matches(q)[0] : undefined;
      if (first) { e.preventDefault(); choose(first); }
    });

    renderBody();
    search.focus();

    loadData(exclude)
      .then((data) => { ({ all, recent } = data); loaded = true; renderBody(); })
      .catch((err: unknown) => { console.error(err); body.replaceChildren(h('p', { class: 'empty' }, 'Could not load exercises.')); });
  });
}

/** Lower is better: prefix matches before word-start matches before substring matches. */
function rank(name: string, lq: string): number {
  const ln = name.toLowerCase();
  if (ln.startsWith(lq)) return 0;
  if (ln.includes(' ' + lq)) return 1;
  return 2;
}

async function loadData(exclude: Set<number>): Promise<{ all: Exercise[]; recent: Exercise[] }> {
  const all = (await db.exercises.toArray())
    .filter((e) => !e.archived && !exclude.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(all.map((e) => [e.id, e]));

  // Exercises from the most recent finished workouts, newest first.
  const workouts = await db.workouts.orderBy('startedAt').reverse()
    .filter((w) => w.endedAt !== undefined).limit(10).toArray();
  const recent: Exercise[] = [];
  const seen = new Set<number>();
  for (const w of workouts) {
    let ids = w.exerciseIds ?? [];
    if (ids.length === 0) ids = [...new Set((await db.sets.where('workoutId').equals(w.id).sortBy('order')).map((s) => s.exerciseId))];
    for (const id of ids) {
      const ex = byId.get(id);
      if (ex && !seen.has(id)) { seen.add(id); recent.push(ex); }
      if (recent.length >= RECENT_LIMIT) return { all, recent };
    }
  }
  return { all, recent };
}

/** Creates an exercise, or reuses (and un-archives) an existing one with the same name. */
async function createExercise(name: string, muscleGroup: MuscleGroup, type: ExerciseType): Promise<Exercise | null> {
  const lower = name.toLowerCase();
  const existing = await db.exercises.filter((e) => e.name.toLowerCase() === lower).first();
  if (existing) {
    if (existing.archived) await db.exercises.update(existing.id, { archived: false });
    toast(`Using existing "${existing.name}"`);
    return { ...existing, archived: false };
  }
  try {
    const id = await db.exercises.add({ name, muscleGroup, type, archived: false, createdAt: Date.now() });
    return (await db.exercises.get(id)) ?? null;
  } catch (err) {
    if (err instanceof Error && err.name === 'ConstraintError') {
      toast('An exercise with that name already exists');
      return null;
    }
    throw err;
  }
}
