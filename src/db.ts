import Dexie, { type EntityTable } from 'dexie';

export type ExerciseType = 'strength' | 'cardio';

export interface Exercise {
  id: number;
  name: string;
  muscleGroup: string;
  type: ExerciseType;
  archived: boolean;
  createdAt: number;
}

export interface Workout {
  id: number;
  startedAt: number;
  /** Unset while the workout is in progress. */
  endedAt?: number;
  notes?: string;
}

/** One logged set. Strength sets use reps/weight; cardio uses distance/duration. */
export interface WorkoutSet {
  id: number;
  workoutId: number;
  exerciseId: number;
  /** Position within the workout, for display order. */
  order: number;
  reps?: number;
  /** Kilograms. */
  weight?: number;
  /** Kilometres. */
  distance?: number;
  /** Seconds. */
  duration?: number;
  notes?: string;
  createdAt: number;
}

export const db = new Dexie('workout-tracker') as Dexie & {
  exercises: EntityTable<Exercise, 'id'>;
  workouts: EntityTable<Workout, 'id'>;
  sets: EntityTable<WorkoutSet, 'id'>;
};

// Only indexed fields are listed. Bump the version and add a new stores() call for schema changes.
db.version(1).stores({
  exercises: '++id, &name, muscleGroup, type',
  workouts: '++id, startedAt',
  sets: '++id, workoutId, exerciseId, [exerciseId+createdAt]',
});

const DEFAULT_EXERCISES: Array<Pick<Exercise, 'name' | 'muscleGroup' | 'type'>> = [
  { name: 'Bench Press', muscleGroup: 'Chest', type: 'strength' },
  { name: 'Squat', muscleGroup: 'Legs', type: 'strength' },
  { name: 'Deadlift', muscleGroup: 'Back', type: 'strength' },
  { name: 'Overhead Press', muscleGroup: 'Shoulders', type: 'strength' },
  { name: 'Barbell Row', muscleGroup: 'Back', type: 'strength' },
  { name: 'Pull-up', muscleGroup: 'Back', type: 'strength' },
  { name: 'Bicep Curl', muscleGroup: 'Arms', type: 'strength' },
  { name: 'Running', muscleGroup: 'Cardio', type: 'cardio' },
  { name: 'Cycling', muscleGroup: 'Cardio', type: 'cardio' },
];

db.on('populate', (tx) => {
  const now = Date.now();
  tx.table('exercises').bulkAdd(DEFAULT_EXERCISES.map((e) => ({ ...e, archived: false, createdAt: now })));
});

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
