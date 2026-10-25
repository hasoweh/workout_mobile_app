import { db, type Workout, type WorkoutSet } from '../db';

/** The in-progress workout, if any (newest wins if there are somehow several). */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const open = await db.workouts.filter((w) => w.endedAt === undefined).toArray();
  return open.sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Starts a new workout now with the given exercises (and optional name/program fields). Returns its id. */
export async function startWorkout(exerciseIds: number[], name?: string, extra: Partial<Workout> = {}): Promise<number> {
  return db.workouts.add({ startedAt: Date.now(), exerciseIds, ...(name ? { name } : {}), ...extra } as Workout);
}

/** Exercise order for a workout; falls back to set order for workouts saved before exerciseIds existed. */
export async function workoutExerciseIds(w: Workout, sets?: WorkoutSet[]): Promise<number[]> {
  const ids = [...(w.exerciseIds ?? [])];
  const all = sets ?? (await db.sets.where('workoutId').equals(w.id).toArray());
  for (const s of [...all].sort((a, b) => a.order - b.order)) if (!ids.includes(s.exerciseId)) ids.push(s.exerciseId);
  return ids;
}

/** Deletes a workout and all of its sets. */
export async function deleteWorkout(workoutId: number): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    await db.sets.where('workoutId').equals(workoutId).delete();
    await db.workouts.delete(workoutId);
  });
}
