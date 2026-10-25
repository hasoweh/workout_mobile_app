import { startRest, stopRest } from '../../components/rest-timer';
import { workoutNameInput } from '../../components/workout-name';
import { pickExercise } from '../../components/exercise-picker';
import { db, type Exercise, type Workout, type WorkoutSet } from '../../db';
import { lastSessionSets, sortSets } from '../../lib/analytics';
import { formatTarget, workoutTargets, type ProgramExercise } from '../../lib/programs';
import { h } from '../../lib/dom';
import { fmtNum, formatDate, formatDuration, formatTime, fromDisplayWeight, parseDuration, toDisplayWeight } from '../../lib/format';
import type { Settings } from '../../lib/settings';
import { confirmDialog, openSheet, safe, toast } from '../../lib/ui';
import { deleteWorkout, workoutExerciseIds } from '../../lib/workouts';
import { editSetSheet, showSummary } from './sheets';
import { describeLastSession, describeSet, parseNum } from './util';

export interface RenderOpts { scrollToExercise?: number }
export type Rerender = (opts?: RenderOpts) => Promise<void>;

/** Unsent entry-row values per workout/exercise, so re-renders don't lose what was typed. */
interface Draft { a: string; b: string }
const drafts = new Map<string, Draft>();
/** Exercises whose "add set" entry row is expanded, keyed by workout/exercise. Collapsed by default. */
const openEntries = new Set<string>();
const entryKey = (ctx: Ctx, exerciseId: number) => `${ctx.workout.id}:${exerciseId}`;
/** Previous-session sets don't change during a workout; cache them per workout/exercise. */
const lastCache = new Map<string, WorkoutSet[]>();

interface Ctx {
  workout: Workout;
  settings: Settings;
  exercises: Map<number, Exercise>;
  /** Program targets by lowercase exercise name; empty for non-program workouts. */
  targets: Map<string, ProgramExercise>;
  rerender: Rerender;
}

export async function buildActive(workout: Workout, settings: Settings, rerender: Rerender): Promise<HTMLElement> {
  const [allExercises, rawSets] = await Promise.all([
    db.exercises.toArray(),
    db.sets.where('workoutId').equals(workout.id).toArray(),
  ]);
  const sets = sortSets(rawSets);
  const exercises = new Map(allExercises.map((e) => [e.id, e]));
  const ids = await workoutExerciseIds(workout, sets);
  const ctx: Ctx = { workout, settings, exercises, targets: workoutTargets(workout), rerender };

  const lasts = await Promise.all(ids.map(async (id) => {
    const key = `${workout.id}:${id}`;
    let last = lastCache.get(key);
    if (!last) {
      last = await lastSessionSets(id, workout.id);
      lastCache.set(key, last);
    }
    return last;
  }));

  const cards = ids.map((id, i) =>
    exerciseCard(ctx, id, sets.filter((s) => s.exerciseId === id), lasts[i], i, ids));

  return h('div', { class: 'log-active' },
    header(workout),
    cards.length
      ? h('div', { class: 'stack' }, ...cards)
      : h('div', { class: 'empty log-empty' }, 'Add your first exercise to start logging.'),
    h('button', {
      type: 'button', class: 'btn-secondary btn-block btn-lg log-add',
      onclick: safe(() => addExercise(ctx, ids)),
    }, '+ Add exercise'),
    h('a', { class: 'history-link log-past', href: '#/log/history' }, 'View past workouts ›'),
    finishBar(ctx, sets.length, ids),
  );
}

function header(workout: Workout): HTMLElement {
  const elapsed = () => formatDuration((Date.now() - workout.startedAt) / 1000);
  const timer = h('span', { class: 'log-timer', 'aria-label': 'Elapsed time' }, elapsed());
  // Tick every second; stop once this element has been replaced (or never got attached).
  const born = Date.now();
  let seen = false;
  const iv = setInterval(() => {
    if (!timer.isConnected) {
      if (seen || Date.now() - born > 10_000) clearInterval(iv);
      return;
    }
    seen = true;
    timer.textContent = elapsed();
  }, 1000);

  return h('header', { class: 'log-header' },
    h('div', { class: 'grow' },
      workoutNameInput(workout, { placeholder: 'Name this workout' }),
      h('div', { class: 'muted small' }, `Started ${formatDate(workout.startedAt)}, ${formatTime(workout.startedAt)}`)),
    timer,
  );
}

function exerciseCard(ctx: Ctx, exerciseId: number, sets: WorkoutSet[], last: WorkoutSet[], index: number, ids: number[]): HTMLElement {
  const { settings } = ctx;
  const ex = ctx.exercises.get(exerciseId);
  const lastText = ex ? describeLastSession(last, ex, settings.units) : null;
  const target = ex ? ctx.targets.get(ex.name.toLowerCase()) : undefined;

  const setList = sets.length
    ? h('ol', { class: 'log-sets' }, ...sets.map((s, i) => h('li', {},
        h('button', {
          type: 'button', class: 'log-set',
          onclick: safe(async () => { if (await editSetSheet(s, ex, i, settings)) await ctx.rerender(); }),
        },
          h('span', { class: 'log-set-num' }, String(i + 1)),
          h('span', { class: 'log-set-val' }, describeSet(s, ex, settings.units)),
          s.notes ? h('span', { class: 'log-set-notes' }, s.notes) : null,
        ))))
    : null;

  return h('section', { class: 'card log-card', 'data-exercise-id': exerciseId },
    h('div', { class: 'spread log-card-head' },
      h('div', { class: 'log-card-title' },
        h('h2', {}, ex?.name ?? 'Unknown exercise'),
        target
          ? h('div', { class: `small log-target${sets.length >= target.sets ? ' met' : ''}` },
              `Target ${formatTarget(target)}${sets.length >= target.sets ? ' ✓' : ` · ${sets.length}/${target.sets} sets`}`)
          : null,
        lastText ? h('div', { class: 'muted small' }, lastText) : h('div', { class: 'muted small' }, 'First time — no history yet')),
      h('button', {
        type: 'button', class: 'btn-icon', 'aria-label': 'Exercise options',
        onclick: () => cardMenu(ctx, exerciseId, ex, sets.length, index, ids),
      }, '⋯'),
    ),
    setList,
    entrySlot(ctx, exerciseId, ex, sets, last),
  );
}

/** "+ Add set" button that expands into the entry row (and collapses again on Cancel or after logging). */
function entrySlot(ctx: Ctx, exerciseId: number, ex: Exercise | undefined, sets: WorkoutSet[], last: WorkoutSet[]): HTMLElement {
  const key = entryKey(ctx, exerciseId);
  const slot = h('div', { class: 'log-entry-slot' });
  const paint = () => {
    if (openEntries.has(key)) {
      slot.replaceChildren(
        ex?.type === 'cardio' ? cardioEntry(ctx, exerciseId, sets, last) : strengthEntry(ctx, exerciseId, ex, sets, last),
        h('button', { type: 'button', class: 'btn-ghost btn-block', onclick: () => { openEntries.delete(key); paint(); } }, 'Cancel'),
      );
    } else {
      slot.replaceChildren(h('button', {
        type: 'button', class: 'btn-secondary btn-block log-add-set',
        onclick: () => { openEntries.add(key); paint(); },
      }, h('span', { class: 'log-add-set-plus', 'aria-hidden': 'true' }, '+'), sets.length ? ` Set ${sets.length + 1}` : ' Add set'));
    }
  };
  paint();
  return slot;
}

function draftFor(ctx: Ctx, exerciseId: number, init: () => Draft): Draft {
  const key = `${ctx.workout.id}:${exerciseId}:${ctx.settings.units}`;
  let d = drafts.get(key);
  if (!d) drafts.set(key, (d = init()));
  return d;
}

/** Big number input: selects on focus so typing replaces the value. */
function numInput(value: string, mode: 'decimal' | 'numeric' | 'text', label: string, placeholder: string, onInput: (v: string) => void): HTMLInputElement {
  return h('input', {
    type: 'text', inputmode: mode, class: 'log-num', value, placeholder, autocomplete: 'off', 'aria-label': label,
    oninput: (e: Event) => onInput((e.target as HTMLInputElement).value),
    onfocus: (e: Event) => (e.target as HTMLInputElement).select(),
  });
}

/** [−][input][+] stepper. */
function stepper(input: HTMLInputElement, step: number, label: string): HTMLElement {
  const bump = (dir: 1 | -1) => () => {
    const cur = parseNum(input.value) ?? 0;
    const next = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
    input.value = fmtNum(next);
    input.dispatchEvent(new Event('input'));
  };
  return h('div', { class: 'log-stepper' },
    h('button', { type: 'button', class: 'log-step', 'aria-label': `Decrease ${label}`, onclick: bump(-1) }, '−'),
    input,
    h('button', { type: 'button', class: 'log-step', 'aria-label': `Increase ${label}`, onclick: bump(1) }, '+'),
  );
}

function strengthEntry(ctx: Ctx, exerciseId: number, ex: Exercise | undefined, sets: WorkoutSet[], last: WorkoutSet[]): HTMLElement {
  const { units, weightStep } = ctx.settings;
  const draft = draftFor(ctx, exerciseId, () => {
    const src = sets.at(-1) ?? last[0];
    return {
      a: src?.weight !== undefined ? fmtNum(toDisplayWeight(src.weight, units)) : '',
      b: src?.reps !== undefined ? String(src.reps) : '',
    };
  });
  const wIn = numInput(draft.a, 'decimal', `Weight in ${units}`, units, (v) => (draft.a = v));
  const rIn = numInput(draft.b, 'numeric', 'Reps', 'reps', (v) => (draft.b = v));

  const btn = h('button', { type: 'button', class: 'btn-block btn-lg log-submit' }, '✓ Log set');
  btn.addEventListener('click', safe(async () => {
    const w = parseNum(wIn.value);
    const r = parseNum(rIn.value);
    if (w === null || w < 0) { toast(`Enter a weight (${units}) — 0 for bodyweight`); wIn.focus(); return; }
    if (r === null || r <= 0 || !Number.isInteger(r)) { toast('Enter reps'); rIn.focus(); return; }
    btn.disabled = true;
    try {
      await addSet(ctx, exerciseId, { weight: fromDisplayWeight(w, units), reps: r });
      openEntries.delete(entryKey(ctx, exerciseId));
      startRest(ctx.settings.restSeconds);
    } finally {
      btn.disabled = false;
    }
    draft.a = fmtNum(w);
    draft.b = String(r);
    await ctx.rerender();
  }));

  return h('div', { class: 'log-entry' },
    h('div', { class: 'log-entry-fields' },
      h('div', { class: 'log-field' }, h('span', { class: 'log-field-label' }, units), stepper(wIn, weightStep, 'weight')),
      h('div', { class: 'log-field' }, h('span', { class: 'log-field-label' }, 'reps'), stepper(rIn, 1, 'reps')),
    ),
    btn,
    ex ? null : h('p', { class: 'muted small' }, 'This exercise was deleted.'),
  );
}

function cardioEntry(ctx: Ctx, exerciseId: number, sets: WorkoutSet[], last: WorkoutSet[]): HTMLElement {
  const draft = draftFor(ctx, exerciseId, () => {
    const src = sets.at(-1) ?? last[0];
    return {
      a: src?.distance !== undefined ? fmtNum(src.distance) : '',
      b: src?.duration !== undefined ? formatDuration(src.duration) : '',
    };
  });
  const distIn = numInput(draft.a, 'decimal', 'Distance in km', 'km', (v) => (draft.a = v));
  const durIn = numInput(draft.b, 'text', 'Duration (mm:ss)', 'mm:ss', (v) => (draft.b = v));

  const btn = h('button', { type: 'button', class: 'btn-block btn-lg log-submit' }, '✓ Log');
  btn.addEventListener('click', safe(async () => {
    const hasDist = distIn.value.trim() !== '';
    const hasDur = durIn.value.trim() !== '';
    const distance = hasDist ? parseNum(distIn.value) : null;
    const duration = hasDur ? parseDuration(durIn.value) : null;
    if (hasDist && (distance === null || distance < 0)) { toast('Invalid distance'); distIn.focus(); return; }
    if (hasDur && duration === null) { toast('Duration as mm:ss (or minutes)'); durIn.focus(); return; }
    if (!distance && !duration) { toast('Enter distance or duration'); distIn.focus(); return; }
    btn.disabled = true;
    try {
      await addSet(ctx, exerciseId, { distance: distance || undefined, duration: duration || undefined });
      openEntries.delete(entryKey(ctx, exerciseId));
    } finally {
      btn.disabled = false;
    }
    await ctx.rerender();
  }));

  return h('div', { class: 'log-entry' },
    h('div', { class: 'log-entry-fields' },
      h('div', { class: 'log-field' }, h('span', { class: 'log-field-label' }, 'distance (km)'), distIn),
      h('div', { class: 'log-field' }, h('span', { class: 'log-field-label' }, 'duration'), durIn),
    ),
    btn,
  );
}

/** Saves a set immediately, at the next order position in the workout. */
async function addSet(ctx: Ctx, exerciseId: number, values: Partial<WorkoutSet>): Promise<void> {
  const workoutId = ctx.workout.id;
  await db.transaction('rw', db.sets, db.workouts, async () => {
    const existing = await db.sets.where('workoutId').equals(workoutId).toArray();
    const order = existing.reduce((m, s) => Math.max(m, s.order), -1) + 1;
    await db.sets.add({ workoutId, exerciseId, order, createdAt: Date.now(), ...values });
    // Keep exerciseIds consistent even if the exercise only came from sets.
    const w = await db.workouts.get(workoutId);
    if (w && !w.exerciseIds.includes(exerciseId)) await db.workouts.update(workoutId, { exerciseIds: [...w.exerciseIds, exerciseId] });
  });
  navigator.vibrate?.(30);
}

async function addExercise(ctx: Ctx, ids: number[]): Promise<void> {
  const ex = await pickExercise({ exclude: ids });
  if (!ex) return;
  if (!ids.includes(ex.id)) {
    await db.transaction('rw', db.workouts, async () => {
      const w = await db.workouts.get(ctx.workout.id);
      if (w && !w.exerciseIds.includes(ex.id)) await db.workouts.update(w.id, { exerciseIds: [...w.exerciseIds, ex.id] });
    });
    // A just-added exercise has nothing logged yet: open its entry row straight away.
    openEntries.add(entryKey(ctx, ex.id));
  } else {
    toast('Already in this workout');
  }
  await ctx.rerender({ scrollToExercise: ex.id });
}

function cardMenu(ctx: Ctx, exerciseId: number, ex: Exercise | undefined, setCount: number, index: number, ids: number[]): void {
  const move = (dir: -1 | 1) => safe(async () => {
    close();
    const next = [...ids];
    const j = index + dir;
    [next[index], next[j]] = [next[j], next[index]];
    await db.workouts.update(ctx.workout.id, { exerciseIds: next });
    await ctx.rerender({ scrollToExercise: exerciseId });
  });

  const remove = safe(async () => {
    close();
    if (setCount > 0 && !(await confirmDialog(
      `Remove ${ex?.name ?? 'this exercise'} and its ${setCount} logged set${setCount === 1 ? '' : 's'}?`,
      { confirmLabel: 'Remove', danger: true },
    ))) return;
    await db.transaction('rw', db.workouts, db.sets, async () => {
      await db.sets.where('workoutId').equals(ctx.workout.id).filter((s) => s.exerciseId === exerciseId).delete();
      const w = await db.workouts.get(ctx.workout.id);
      if (w) await db.workouts.update(w.id, { exerciseIds: w.exerciseIds.filter((id) => id !== exerciseId) });
    });
    await ctx.rerender();
  });

  const close = openSheet(
    h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn-secondary btn-block', disabled: index === 0, onclick: move(-1) }, '↑ Move up'),
      h('button', { type: 'button', class: 'btn-secondary btn-block', disabled: index === ids.length - 1, onclick: move(1) }, '↓ Move down'),
      h('button', { type: 'button', class: 'btn-danger btn-block', onclick: remove }, 'Remove from workout'),
    ),
    { title: ex?.name ?? 'Exercise' },
  );
}

function finishBar(ctx: Ctx, setCount: number, ids: number[]): HTMLElement {
  const discard = safe(async () => {
    if (!(await confirmDialog('Discard this workout and all its sets? This cannot be undone.', { confirmLabel: 'Discard', danger: true }))) return;
    await deleteWorkout(ctx.workout.id);
    stopRest();
    toast('Workout discarded');
    await ctx.rerender();
  });

  const finish = safe(async () => {
    if (setCount === 0) {
      if (await confirmDialog('No sets logged yet. Discard this workout?', { confirmLabel: 'Discard', danger: true })) {
        await deleteWorkout(ctx.workout.id);
        stopRest();
        await ctx.rerender();
      }
      return;
    }
    if (!(await confirmDialog('Finish this workout?', { confirmLabel: 'Finish' }))) return;
    await db.workouts.update(ctx.workout.id, { endedAt: Date.now() });
    stopRest();
    for (const key of [...drafts.keys(), ...lastCache.keys(), ...openEntries]) {
      if (key.startsWith(`${ctx.workout.id}:`)) { drafts.delete(key); lastCache.delete(key); openEntries.delete(key); }
    }
    const names = new Map(ids.map((id) => [id, ctx.exercises.get(id)?.name ?? 'Unknown exercise']));
    // Show idle state behind the summary sheet.
    await ctx.rerender();
    await showSummary(ctx.workout.id, ctx.settings, names);
  });

  return h('div', { class: 'log-finish-bar' },
    h('div', { class: 'log-finish-inner' },
      h('button', { type: 'button', class: 'btn-secondary log-discard', onclick: discard }, 'Discard'),
      h('button', { type: 'button', class: 'btn-go grow btn-lg', onclick: finish }, 'Finish workout'),
    ),
  );
}
