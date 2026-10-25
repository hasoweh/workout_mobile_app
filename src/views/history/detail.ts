import { workoutNameInput } from '../../components/workout-name';
import { musclesLabel } from '../../components/muscle-chips';
import { db, type Exercise, type Workout, type WorkoutSet } from '../../db';
import { groupBy, lastSessionSets, setsDistance, setsVolume, sortSets } from '../../lib/analytics';
import { h } from '../../lib/dom';
import {
  formatDate, formatDistance, formatDuration, formatSet, formatTime, formatVolume, fromDisplayWeight, isCardio, parseDuration, toDisplayWeight,
} from '../../lib/format';
import { getSettings, type Settings } from '../../lib/settings';
import { confirmDialog, go, openSheet, safe, toast } from '../../lib/ui';
import { deleteWorkout as removeWorkout, getActiveWorkout, startWorkout } from '../../lib/workouts';
import { fromLocalInputValue, toLocalInputValue, workoutDuration } from './shared';

interface Section {
  exerciseId: number;
  exercise: Exercise | undefined;
  cardio: boolean;
  sets: WorkoutSet[];
}

/** Everything the detail view needs, loaded fresh on each (re)render. */
interface DetailData {
  workout: Workout;
  sets: WorkoutSet[];
  sections: Section[];
  settings: Settings;
}

async function loadDetail(id: number): Promise<DetailData | null> {
  const workout = await db.workouts.get(id);
  if (!workout) return null;
  const [sets, settings] = await Promise.all([db.sets.where('workoutId').equals(id).toArray(), getSettings()]);
  const byExercise = groupBy(sets, (s) => s.exerciseId);
  // Workout order first, then any exercises that have sets but aren't in exerciseIds.
  const ids = [...new Set([...workout.exerciseIds, ...byExercise.keys()])];
  const exercises = await db.exercises.bulkGet(ids);
  const sections = ids.map((exerciseId, i) => {
    const exSets = sortSets(byExercise.get(exerciseId) ?? []);
    return { exerciseId, exercise: exercises[i], cardio: isCardio(exercises[i], exSets), sets: exSets };
  });
  return { workout, sets, sections, settings };
}

function notFound(root: HTMLElement, message = 'Workout not found'): void {
  root.replaceChildren(
    h('div', { class: 'empty stack' },
      h('p', {}, message),
      h('a', { class: 'history-link', href: '#/log' }, '← Back'),
    ),
  );
}

export async function renderDetail(root: HTMLElement, idParam: string): Promise<void> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return notFound(root);
  const data = await loadDetail(id);
  if (!data) return notFound(root);
  if (data.workout.endedAt === undefined) {
    root.replaceChildren(
      h('div', { class: 'empty stack' },
        h('p', {}, 'This workout is still in progress.'),
        h('button', { class: 'btn-lg', onclick: () => go('log') }, 'Resume workout'),
      ),
    );
    return;
  }
  // Back to the start screen's list, or to the standalone list when a workout is in progress (the start screen isn't shown then).
  const back = (await getActiveWorkout()) ? 'log/history' : 'log';
  // Re-render in place after edits (keeps scroll position, unlike a route refresh).
  const reload = () => renderDetail(root, idParam);
  root.replaceChildren(...buildDetail(data, back, reload));
}

function buildDetail(data: DetailData, back: string, reload: () => Promise<void>): Node[] {
  const { workout, sets, sections, settings } = data;
  const endedAt = workout.endedAt!;
  const volume = setsVolume(sets);
  const distance = setsDistance(sets);

  const stats = [`${sets.length} set${sets.length === 1 ? '' : 's'}`];
  if (volume > 0) stats.push(`${formatVolume(volume, settings.units)} volume`);
  if (distance > 0) stats.push(formatDistance(distance));

  const header = h('div', { class: 'card stack history-detail-header' },
    h('div', { class: 'spread' },
      h('div', { class: 'grow' }, workoutNameInput(workout, { placeholder: 'Add a name' })),
      h('button', { class: 'btn-secondary', onclick: () => editTimeSheet(workout, reload) }, 'Edit time'),
    ),
    h('div', { class: 'muted' },
      `${formatDate(workout.startedAt)} · ${formatTime(workout.startedAt)} – ${formatTime(endedAt)} · ${workoutDuration(workout.startedAt, endedAt)}`),
    h('div', { class: 'history-stats' }, stats.join(' · ')),
  );

  const notes = h('textarea', { id: 'history-notes', placeholder: 'How did it go?', rows: 3 });
  notes.value = workout.notes ?? '';
  notes.addEventListener('change', safe(async () => {
    const value = notes.value.trim();
    await db.workouts.update(workout.id, { notes: value || undefined });
    toast('Notes saved', 1500);
  }));
  const notesCard = h('div', { class: 'card' }, h('label', { for: 'history-notes' }, 'Notes'), notes);

  const sectionEls = sections.map((sec) =>
    h('section', { class: 'card history-exercise' },
      h('div', { class: 'spread' },
        h('div', {},
          h('h2', {}, sec.exercise?.name ?? 'Unknown exercise'),
          sec.exercise ? h('div', { class: 'muted small' }, musclesLabel(sec.exercise.muscles)) : null,
        ),
        h('button', { class: 'btn-ghost', onclick: () => void openSetSheet(data, sec, null, reload) }, '+ Add set'),
      ),
      sec.sets.length === 0
        ? h('p', { class: 'muted small' }, 'No sets logged')
        : h('ol', { class: 'list history-sets' },
          ...sec.sets.map((s, i) =>
            h('li', {},
              h('button', { class: 'history-set', onclick: () => void openSetSheet(data, sec, s, reload) },
                h('span', { class: 'history-set-num' }, String(i + 1)),
                h('span', { class: 'history-set-main' },
                  h('span', {}, formatSet(s, sec.cardio, settings.units)),
                  s.notes ? h('span', { class: 'muted small history-set-notes' }, s.notes) : null,
                ),
                h('span', { class: 'muted', 'aria-hidden': 'true' }, '›'),
              ),
            ),
          ),
        ),
    ),
  );

  const actions = h('div', { class: 'stack history-actions' },
    h('button', { class: 'btn-lg btn-block', onclick: safe(() => repeatWorkout(sections.map((s) => s.exerciseId), workout.name)) },
      'Repeat this workout'),
    h('button', { class: 'btn-danger btn-block', onclick: safe(() => deleteWorkout(workout.id, back)) }, 'Delete workout'),
  );

  return [
    h('a', { class: 'history-link history-back', href: `#/${back}` }, '← History'),
    h('div', { class: 'stack' },
      header,
      notesCard,
      ...(sectionEls.length ? sectionEls : [h('p', { class: 'empty' }, 'No exercises in this workout')]),
      actions,
    ),
  ];
}

// ---- Workout-level actions ----

async function repeatWorkout(exerciseIds: number[], name?: string): Promise<void> {
  if (await getActiveWorkout()) {
    if (await confirmDialog('A workout is already in progress. Finish it before repeating this one.', { confirmLabel: 'Go to workout' }))
      go('log');
    return;
  }
  await startWorkout(exerciseIds, name);
  toast('Workout started');
  go('log');
}

async function deleteWorkout(id: number, back: string): Promise<void> {
  if (!(await confirmDialog('Delete this workout and all its sets? This cannot be undone.', { confirmLabel: 'Delete', danger: true })))
    return;
  await removeWorkout(id);
  toast('Workout deleted');
  go(back);
}

function editTimeSheet(workout: Workout, reload: () => Promise<void>): void {
  const endedAt = workout.endedAt!;
  const start = h('input', { id: 'history-start', type: 'datetime-local', value: toLocalInputValue(workout.startedAt) });
  const minutes = h('input', {
    id: 'history-minutes', type: 'number', inputmode: 'numeric', min: 0, step: 1,
    value: Math.round((endedAt - workout.startedAt) / 60_000),
  });

  const save = safe(async () => {
    const newStart = fromLocalInputValue(start.value);
    const mins = Number(minutes.value);
    if (newStart === null) return toast('Enter a valid start date and time');
    if (minutes.value === '' || !Number.isFinite(mins) || mins < 0) return toast('Enter a valid duration');
    const newEnd = newStart + Math.round(mins * 60_000);
    const shift = newStart - workout.startedAt;
    // Shift set timestamps too, so per-exercise history (indexed by createdAt) stays in the right place.
    await db.transaction('rw', db.workouts, db.sets, async () => {
      await db.workouts.update(workout.id, { startedAt: newStart, endedAt: newEnd });
      if (shift !== 0) await db.sets.where('workoutId').equals(workout.id).modify((s) => { s.createdAt += shift; });
    });
    close();
    toast('Time updated');
    await reload();
  });

  const close = openSheet(
    h('div', { class: 'stack' },
      h('div', {}, h('label', { for: 'history-start' }, 'Start'), start),
      h('div', {}, h('label', { for: 'history-minutes' }, 'Duration (minutes)'), minutes),
      h('button', { class: 'btn-lg btn-block', onclick: save }, 'Save'),
    ),
    { title: 'Edit time' },
  );
}

// ---- Set editing ----

function numInput(id: string, value: number | undefined, inputmode: 'decimal' | 'numeric'): HTMLInputElement {
  return h('input', {
    id, type: 'number', inputmode, min: 0, step: 'any',
    value: value === undefined ? '' : value,
  });
}

/** Parses an optional non-negative number; undefined if blank, null if invalid. */
function readNum(input: HTMLInputElement): number | undefined | null {
  if (input.value.trim() === '') return undefined;
  const n = Number(input.value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Input with large − / + buttons either side. */
function stepper(input: HTMLInputElement, step: number, decimals: number): HTMLElement {
  const bump = (dir: number) => {
    const cur = Number(input.value) || 0;
    const next = Math.max(0, cur + dir * step);
    input.value = String(Number(next.toFixed(decimals)));
  };
  return h('div', { class: 'row history-stepper' },
    h('button', { class: 'btn-secondary', type: 'button', 'aria-label': 'Decrease', onclick: () => bump(-1) }, '−'),
    input,
    h('button', { class: 'btn-secondary', type: 'button', 'aria-label': 'Increase', onclick: () => bump(1) }, '+'),
  );
}

/** Edit an existing set (`set`) or add a new one (`set` null) to `sec` in the workout. */
async function openSetSheet(data: DetailData, sec: Section, set: WorkoutSet | null, reload: () => Promise<void>): Promise<void> {
  const { units, weightStep } = data.settings;
  // Prefill a new set from the last set of this exercise in this workout, else from the last session.
  let template: WorkoutSet | undefined = set ?? sec.sets.at(-1);
  if (!template) {
    try { template = (await lastSessionSets(sec.exerciseId, data.workout.id)).at(-1); } catch { /* prefill is optional */ }
  }

  const fields: HTMLElement[] = [];
  let read: () => Partial<WorkoutSet> | string;

  if (sec.cardio) {
    const dist = numInput('history-dist', template?.distance, 'decimal');
    const dur = h('input', { id: 'history-dur', type: 'text', inputmode: 'numeric', placeholder: 'mm:ss', value: template?.duration ? formatDuration(template.duration) : '' });
    fields.push(
      h('div', {}, h('label', { for: 'history-dist' }, 'Distance (km)'), dist),
      h('div', {}, h('label', { for: 'history-dur' }, 'Duration (mm:ss or minutes)'), dur),
    );
    read = () => {
      const distance = readNum(dist);
      if (distance === null) return 'Enter a valid distance';
      let duration: number | undefined;
      if (dur.value.trim()) {
        const parsed = parseDuration(dur.value);
        if (parsed === null) return 'Enter duration as mm:ss or minutes';
        duration = parsed;
      }
      if (!distance && !duration) return 'Enter a distance or duration';
      return { distance: distance || undefined, duration: duration || undefined };
    };
  } else {
    const weight = numInput('history-weight', template?.weight !== undefined ? toDisplayWeight(template.weight, units) : undefined, 'decimal');
    const reps = numInput('history-reps', template?.reps, 'numeric');
    reps.step = '1';
    fields.push(
      h('div', {}, h('label', { for: 'history-weight' }, `Weight (${units})`), stepper(weight, weightStep, 2)),
      h('div', {}, h('label', { for: 'history-reps' }, 'Reps'), stepper(reps, 1, 0)),
    );
    read = () => {
      const w = readNum(weight);
      const r = readNum(reps);
      if (w === null) return 'Enter a valid weight';
      if (r === null || (r !== undefined && !Number.isInteger(r))) return 'Enter a whole number of reps';
      if (!r) return 'Enter at least 1 rep';
      return { weight: w ? fromDisplayWeight(w, units) : undefined, reps: r };
    };
  }

  const notes = h('input', { id: 'history-set-notes', type: 'text', placeholder: 'Optional', value: set?.notes ?? '' });
  fields.push(h('div', {}, h('label', { for: 'history-set-notes' }, 'Notes'), notes));

  const save = safe(async () => {
    const values = read();
    if (typeof values === 'string') return toast(values);
    const note = notes.value.trim() || undefined;
    if (set) {
      const next: WorkoutSet = { ...set, ...values, notes: note };
      // Drop cleared fields rather than storing explicit undefined.
      for (const k of ['weight', 'reps', 'distance', 'duration', 'notes'] as const) if (next[k] === undefined) delete next[k];
      await db.sets.put(next);
    } else {
      const all = data.sets;
      const order = all.reduce((m, s) => Math.max(m, s.order), -1) + 1;
      // Keep createdAt inside the workout so history queries place it correctly.
      const createdAt = all.length ? all.reduce((m, s) => Math.max(m, s.createdAt), 0) + 1 : data.workout.endedAt ?? data.workout.startedAt;
      const fresh: Omit<WorkoutSet, 'id'> = { workoutId: data.workout.id, exerciseId: sec.exerciseId, order, createdAt, ...values };
      if (note) fresh.notes = note;
      for (const k of ['weight', 'reps', 'distance', 'duration'] as const) if (fresh[k] === undefined) delete fresh[k];
      await db.sets.add(fresh);
    }
    close();
    toast(set ? 'Set updated' : 'Set added');
    await reload();
  });

  const remove = safe(async () => {
    if (!set) return;
    if (!(await confirmDialog('Delete this set?', { confirmLabel: 'Delete', danger: true }))) return;
    await db.sets.delete(set.id);
    close();
    toast('Set deleted');
    await reload();
  });

  const close = openSheet(
    h('div', { class: 'stack' },
      ...fields,
      h('div', { class: 'row' },
        set ? h('button', { class: 'btn-danger grow', onclick: remove }, 'Delete') : null,
        h('button', { class: 'grow', onclick: save }, set ? 'Save' : 'Add set'),
      ),
    ),
    { title: `${set ? 'Edit set' : 'Add set'} · ${sec.exercise?.name ?? 'Unknown exercise'}` },
  );
}
