import { db, type Exercise, type WorkoutSet } from '../../db';
import { newPRsInWorkout, sortSets } from '../../lib/analytics';
import { h } from '../../lib/dom';
import { formatDate, formatDuration, formatTime, fromDisplayWeight, parseDuration, toDisplayWeight } from '../../lib/format';
import type { Settings } from '../../lib/settings';
import { confirmDialog, openSheet, toast } from '../../lib/ui';
import { fmtNum, parseNum, safe } from './util';

/** Edit or delete one logged set. Resolves true if anything changed. */
export function editSetSheet(set: WorkoutSet, ex: Exercise | undefined, index: number, settings: Settings): Promise<boolean> {
  return new Promise((resolve) => {
    let changed = false;
    const { units } = settings;
    const cardio = ex?.type === 'cardio';
    const notesIn = h('textarea', { placeholder: 'Notes (optional)', 'aria-label': 'Notes' });
    notesIn.value = set.notes ?? '';

    const numInput = (value: string, mode: 'decimal' | 'numeric', label: string, placeholder = '') =>
      h('input', { type: 'text', inputmode: mode, class: 'log-sheet-num', value, 'aria-label': label, placeholder, autocomplete: 'off' });

    let fields: HTMLElement;
    let read: () => Partial<WorkoutSet> | string;
    if (cardio) {
      const distIn = numInput(set.distance !== undefined ? fmtNum(set.distance) : '', 'decimal', 'Distance (km)');
      const durIn = h('input', { type: 'text', class: 'log-sheet-num', value: set.duration !== undefined ? formatDuration(set.duration) : '', placeholder: 'mm:ss', 'aria-label': 'Duration', autocomplete: 'off' });
      fields = h('div', { class: 'log-sheet-fields' },
        h('div', {}, h('label', {}, 'Distance (km)'), distIn),
        h('div', {}, h('label', {}, 'Duration (mm:ss)'), durIn));
      read = () => {
        const distance = parseNum(distIn.value);
        const duration = durIn.value.trim() ? parseDuration(durIn.value) : null;
        if (distIn.value.trim() && (distance === null || distance < 0)) return 'Invalid distance';
        if (durIn.value.trim() && duration === null) return 'Invalid duration (use mm:ss)';
        if (!distance && !duration) return 'Enter distance or duration';
        return { distance: distance || undefined, duration: duration || undefined };
      };
    } else {
      const wIn = numInput(set.weight !== undefined ? fmtNum(toDisplayWeight(set.weight, units)) : '', 'decimal', `Weight (${units})`, '0');
      const rIn = numInput(set.reps !== undefined ? String(set.reps) : '', 'numeric', 'Reps');
      fields = h('div', { class: 'log-sheet-fields' },
        h('div', {}, h('label', {}, `Weight (${units})`), wIn),
        h('div', {}, h('label', {}, 'Reps'), rIn));
      read = () => {
        const w = wIn.value.trim() ? parseNum(wIn.value) : 0;
        const r = parseNum(rIn.value);
        if (w === null || w < 0) return 'Invalid weight';
        if (r === null || r <= 0 || !Number.isInteger(r)) return 'Reps must be a whole number';
        return { weight: fromDisplayWeight(w, units), reps: r };
      };
    }

    const save = safe(async () => {
      const values = read();
      if (typeof values === 'string') { toast(values); return; }
      const notes = notesIn.value.trim();
      // Dexie update with undefined values removes those keys.
      await db.sets.update(set.id, { ...values, notes: notes || undefined });
      changed = true;
      close();
    });

    const remove = safe(async () => {
      if (!(await confirmDialog('Delete this set?', { confirmLabel: 'Delete', danger: true }))) return;
      await db.sets.delete(set.id);
      changed = true;
      close();
    });

    const close = openSheet(
      h('div', { class: 'stack' },
        ex ? h('p', { class: 'muted small log-sheet-sub' }, ex.name) : null,
        fields,
        notesIn,
        h('button', { type: 'button', class: 'btn-block btn-lg', onclick: save }, 'Save'),
        h('button', { type: 'button', class: 'btn-danger btn-block', onclick: remove }, 'Delete set'),
      ),
      { title: `Set ${index + 1}`, onClose: () => resolve(changed) },
    );
  });
}

/** Post-workout summary: duration, counts, volume and new PRs. */
export async function showSummary(workoutId: number, settings: Settings, names: Map<number, string>): Promise<void> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return;
  const sets = sortSets(await db.sets.where('workoutId').equals(workoutId).toArray());
  const prs = await newPRsInWorkout(workoutId).catch((err: unknown) => { console.error(err); return []; });
  const { units } = settings;
  const disp = (kg: number) => `${fmtNum(toDisplayWeight(kg, units))} ${units}`;

  const exerciseCount = new Set(sets.map((s) => s.exerciseId)).size;
  const volumeKg = sets.reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
  const duration = ((workout.endedAt ?? Date.now()) - workout.startedAt) / 1000;

  const stat = (label: string, value: string) =>
    h('div', { class: 'log-stat' }, h('div', { class: 'log-stat-value' }, value), h('div', { class: 'log-stat-label' }, label));

  const prLabel = (pr: (typeof prs)[number]): string => {
    switch (pr.kind) {
      case 'weight': return `${pr.label}: ${disp(pr.value)}${pr.reps ? ` × ${pr.reps}` : ''}`;
      case 'e1rm': return `${pr.label}: ${disp(pr.value)}`;
      case 'reps': return `${pr.label}: ${pr.reps} reps @ ${disp(pr.value)}`;
      case 'distance': return `${pr.label}: ${fmtNum(pr.value)} km`;
      case 'duration': return `${pr.label}: ${formatDuration(pr.value)}`;
    }
  };

  // Exercises in workout order with set counts.
  const perExercise = new Map<number, number>();
  for (const s of sets) perExercise.set(s.exerciseId, (perExercise.get(s.exerciseId) ?? 0) + 1);

  await new Promise<void>((resolve) => {
    const close = openSheet(
      h('div', { class: 'stack log-summary' },
        h('p', { class: 'muted' }, `${formatDate(workout.startedAt)}, ${formatTime(workout.startedAt)}`),
        h('div', { class: 'log-stats' },
          stat('Duration', formatDuration(duration)),
          stat('Exercises', String(exerciseCount)),
          stat('Sets', String(sets.length)),
          stat('Volume', volumeKg > 0 ? `${Math.round(toDisplayWeight(volumeKg, units)).toLocaleString()} ${units}` : '—'),
        ),
        prs.length
          ? h('div', { class: 'log-prs' },
              h('h3', {}, `🏆 ${prs.length} new PR${prs.length === 1 ? '' : 's'}`),
              h('ul', { class: 'list' }, ...prs.map((pr) =>
                h('li', { class: 'log-pr' }, h('span', { class: 'log-pr-icon' }, '🏆'),
                  h('div', {}, h('div', { class: 'log-pr-ex' }, pr.exercise.name), h('div', { class: 'small muted' }, prLabel(pr))))))
            )
          : null,
        h('ul', { class: 'list small' }, ...[...perExercise].map(([id, n]) =>
          h('li', { class: 'spread' }, h('span', {}, names.get(id) ?? 'Unknown exercise'), h('span', { class: 'muted' }, `${n} set${n === 1 ? '' : 's'}`)))),
        h('button', { type: 'button', class: 'btn-block btn-lg', onclick: () => close() }, 'Done'),
      ),
      { title: 'Workout complete 💪', onClose: resolve },
    );
  });
}
