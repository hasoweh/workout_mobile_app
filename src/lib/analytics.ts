import { db, type Exercise, type Workout, type WorkoutSet } from '../db';

/** Epley estimated one-rep max. Returns the weight itself for single reps. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** Aggregates of one exercise within one finished workout. Weights are kg. */
export interface ExerciseSession {
  workoutId: number;
  date: number;
  sets: WorkoutSet[];
  topWeight: number;
  bestE1rm: number;
  /** Sum of weight × reps. */
  volume: number;
  totalReps: number;
  /** Cardio totals. */
  distance: number;
  duration: number;
}

export function summarizeSession(workoutId: number, date: number, sets: WorkoutSet[]): ExerciseSession {
  let topWeight = 0, bestE1rm = 0, volume = 0, totalReps = 0, distance = 0, duration = 0;
  for (const s of sets) {
    const w = s.weight ?? 0, r = s.reps ?? 0;
    topWeight = Math.max(topWeight, w);
    bestE1rm = Math.max(bestE1rm, e1rm(w, r));
    volume += w * r;
    totalReps += r;
    distance += s.distance ?? 0;
    duration += s.duration ?? 0;
  }
  return { workoutId, date, sets, topWeight, bestE1rm, volume, totalReps, distance, duration };
}

/** All finished sessions of an exercise, oldest first. Optionally only those since `sinceMs`. */
export async function exerciseHistory(exerciseId: number, sinceMs = 0): Promise<ExerciseSession[]> {
  const sets = await db.sets
    .where('[exerciseId+createdAt]')
    .between([exerciseId, sinceMs], [exerciseId, Infinity])
    .toArray();
  const byWorkout = groupBy(sets, (s) => s.workoutId);
  const workouts = await db.workouts.bulkGet([...byWorkout.keys()]);
  return workouts
    .filter((w): w is Workout => !!w && w.endedAt !== undefined)
    .map((w) => summarizeSession(w.id, w.startedAt, sortSets(byWorkout.get(w.id)!)))
    .sort((a, b) => a.date - b.date);
}

/** Sets from the most recent finished workout containing this exercise, excluding `excludeWorkoutId`. */
export async function lastSessionSets(exerciseId: number, excludeWorkoutId?: number): Promise<WorkoutSet[]> {
  const recent = await db.sets.where('[exerciseId+createdAt]').between([exerciseId, 0], [exerciseId, Infinity]).reverse().toArray();
  for (const s of recent) {
    if (s.workoutId === excludeWorkoutId) continue;
    const w = await db.workouts.get(s.workoutId);
    if (w?.endedAt !== undefined) return sortSets(recent.filter((x) => x.workoutId === s.workoutId));
  }
  return [];
}

export interface PersonalRecords {
  bestWeight?: { weight: number; reps: number; date: number };
  bestE1rm?: { value: number; weight: number; reps: number; date: number };
  /** Most reps achieved at each weight (kg), keyed by weight. */
  repsAtWeight: Map<number, { reps: number; date: number }>;
  longestDistance?: { distance: number; date: number };
  longestDuration?: { duration: number; date: number };
}

export function computePRs(sessions: ExerciseSession[]): PersonalRecords {
  const prs: PersonalRecords = { repsAtWeight: new Map() };
  for (const sess of sessions) {
    for (const s of sess.sets) {
      const w = s.weight ?? 0, r = s.reps ?? 0;
      if (r > 0 && w > 0) {
        if (!prs.bestWeight || w > prs.bestWeight.weight) prs.bestWeight = { weight: w, reps: r, date: sess.date };
        const est = e1rm(w, r);
        if (!prs.bestE1rm || est > prs.bestE1rm.value) prs.bestE1rm = { value: est, weight: w, reps: r, date: sess.date };
        const prev = prs.repsAtWeight.get(w);
        if (!prev || r > prev.reps) prs.repsAtWeight.set(w, { reps: r, date: sess.date });
      }
    }
    if (sess.distance > 0 && (!prs.longestDistance || sess.distance > prs.longestDistance.distance))
      prs.longestDistance = { distance: sess.distance, date: sess.date };
    if (sess.duration > 0 && (!prs.longestDuration || sess.duration > prs.longestDuration.duration))
      prs.longestDuration = { duration: sess.duration, date: sess.date };
  }
  return prs;
}

export interface NewPR {
  exercise: Exercise;
  kind: 'weight' | 'e1rm' | 'reps' | 'distance' | 'duration';
  label: string;
}

/**
 * PRs set in `workoutId` compared to all earlier finished workouts.
 * Only reports exercises with prior history (a first-ever session isn't a "PR").
 * Weights in labels are kg; callers re-format if needed via the `kind`.
 */
export async function newPRsInWorkout(workoutId: number): Promise<Array<NewPR & { value: number; reps?: number }>> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return [];
  const sets = await db.sets.where('workoutId').equals(workoutId).toArray();
  const result: Array<NewPR & { value: number; reps?: number }> = [];
  for (const [exerciseId, exSets] of groupBy(sets, (s) => s.exerciseId)) {
    const exercise = await db.exercises.get(exerciseId);
    if (!exercise) continue;
    const prior = (await exerciseHistory(exerciseId)).filter((s) => s.workoutId !== workoutId && s.date < workout.startedAt);
    if (prior.length === 0) continue;
    const before = computePRs(prior);
    const now = computePRs([summarizeSession(workoutId, workout.startedAt, exSets)]);
    if (now.bestWeight && before.bestWeight && now.bestWeight.weight > before.bestWeight.weight)
      result.push({ exercise, kind: 'weight', label: 'Heaviest weight', value: now.bestWeight.weight, reps: now.bestWeight.reps });
    if (now.bestE1rm && before.bestE1rm && now.bestE1rm.value > before.bestE1rm.value + 1e-9)
      result.push({ exercise, kind: 'e1rm', label: 'Best est. 1RM', value: now.bestE1rm.value });
    for (const [w, { reps }] of now.repsAtWeight) {
      const prev = before.repsAtWeight.get(w);
      if (prev && reps > prev.reps) result.push({ exercise, kind: 'reps', label: 'Most reps at weight', value: w, reps });
    }
    if (now.longestDistance && before.longestDistance && now.longestDistance.distance > before.longestDistance.distance)
      result.push({ exercise, kind: 'distance', label: 'Longest distance', value: now.longestDistance.distance });
    if (now.longestDuration && before.longestDuration && now.longestDuration.duration > before.longestDuration.duration)
      result.push({ exercise, kind: 'duration', label: 'Longest duration', value: now.longestDuration.duration });
  }
  return result;
}

/** Monday 00:00 local time of the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sortSets(sets: WorkoutSet[]): WorkoutSet[] {
  return [...sets].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
