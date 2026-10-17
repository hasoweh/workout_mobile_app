import Dexie, { type EntityTable } from 'dexie';

export type ExerciseType = 'strength' | 'cardio';

export const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Glutes', 'Shoulders', 'Arms', 'Core', 'Cardio'] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface Exercise {
  id: number;
  name: string;
  muscleGroup: MuscleGroup;
  type: ExerciseType;
  archived: boolean;
  createdAt: number;
}

export interface Workout {
  id: number;
  startedAt: number;
  /** Unset while the workout is in progress. At most one workout is in progress at a time. */
  endedAt?: number;
  /** Exercises in display order, including ones added but not yet logged. */
  exerciseIds: number[];
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
  /** Always stored in kilograms; converted for display via lib/units. */
  weight?: number;
  /** Kilometres. */
  distance?: number;
  /** Seconds. */
  duration?: number;
  notes?: string;
  createdAt: number;
}

/** Key/value app settings. See lib/settings for keys and defaults. */
export interface SettingRow {
  key: string;
  value: unknown;
}

export const db = new Dexie('workout-tracker') as Dexie & {
  exercises: EntityTable<Exercise, 'id'>;
  workouts: EntityTable<Workout, 'id'>;
  sets: EntityTable<WorkoutSet, 'id'>;
  settings: EntityTable<SettingRow, 'key'>;
};

// Only indexed fields are listed. Bump the version and add a new stores() call for schema changes.
db.version(1).stores({
  exercises: '++id, &name, muscleGroup, type',
  workouts: '++id, startedAt',
  sets: '++id, workoutId, exerciseId, [exerciseId+createdAt]',
});

db.version(2)
  .stores({ settings: '&key' })
  .upgrade(async (tx) => {
    await tx.table('workouts').toCollection().modify((w: Workout) => {
      w.exerciseIds ??= [];
    });
    await addMissingDefaults(tx.table('exercises'));
  });

db.on('populate', (tx) => addMissingDefaults(tx.table('exercises')));

async function addMissingDefaults(table: Dexie.Table<Exercise, number>): Promise<void> {
  const existing = new Set((await table.toArray()).map((e) => e.name.toLowerCase()));
  const now = Date.now();
  const missing = DEFAULT_EXERCISES.filter(([name]) => !existing.has(name.toLowerCase()));
  await table.bulkAdd(
    missing.map(([name, muscleGroup, type]) => ({ name, muscleGroup, type, archived: false, createdAt: now }) as Exercise),
  );
}

const DEFAULT_EXERCISES: Array<[string, MuscleGroup, ExerciseType]> = [
  ['Bench Press', 'Chest', 'strength'],
  ['Incline Bench Press', 'Chest', 'strength'],
  ['Dumbbell Bench Press', 'Chest', 'strength'],
  ['Incline Dumbbell Press', 'Chest', 'strength'],
  ['Chest Fly (Machine)', 'Chest', 'strength'],
  ['Cable Crossover', 'Chest', 'strength'],
  ['Push-up', 'Chest', 'strength'],
  ['Dip', 'Chest', 'strength'],
  ['Deadlift', 'Back', 'strength'],
  ['Barbell Row', 'Back', 'strength'],
  ['Dumbbell Row', 'Back', 'strength'],
  ['Pull-up', 'Back', 'strength'],
  ['Chin-up', 'Back', 'strength'],
  ['Lat Pulldown', 'Back', 'strength'],
  ['Seated Cable Row', 'Back', 'strength'],
  ['T-Bar Row', 'Back', 'strength'],
  ['Squat', 'Legs', 'strength'],
  ['Front Squat', 'Legs', 'strength'],
  ['Leg Press', 'Legs', 'strength'],
  ['Bulgarian Split Squat', 'Legs', 'strength'],
  ['Lunge', 'Legs', 'strength'],
  ['Leg Extension', 'Legs', 'strength'],
  ['Leg Curl', 'Legs', 'strength'],
  ['Romanian Deadlift', 'Legs', 'strength'],
  ['Calf Raise', 'Legs', 'strength'],
  ['Hip Thrust', 'Glutes', 'strength'],
  ['Glute Bridge', 'Glutes', 'strength'],
  ['Hip Abduction (Machine)', 'Glutes', 'strength'],
  ['Overhead Press', 'Shoulders', 'strength'],
  ['Dumbbell Shoulder Press', 'Shoulders', 'strength'],
  ['Lateral Raise', 'Shoulders', 'strength'],
  ['Rear Delt Fly', 'Shoulders', 'strength'],
  ['Face Pull', 'Shoulders', 'strength'],
  ['Shrug', 'Shoulders', 'strength'],
  ['Barbell Curl', 'Arms', 'strength'],
  ['Dumbbell Curl', 'Arms', 'strength'],
  ['Hammer Curl', 'Arms', 'strength'],
  ['Triceps Pushdown', 'Arms', 'strength'],
  ['Overhead Triceps Extension', 'Arms', 'strength'],
  ['Skull Crusher', 'Arms', 'strength'],
  ['Close-Grip Bench Press', 'Arms', 'strength'],
  ['Plank', 'Core', 'strength'],
  ['Hanging Leg Raise', 'Core', 'strength'],
  ['Cable Crunch', 'Core', 'strength'],
  ['Ab Wheel Rollout', 'Core', 'strength'],
  ['Running', 'Cardio', 'cardio'],
  ['Treadmill', 'Cardio', 'cardio'],
  ['Cycling', 'Cardio', 'cardio'],
  ['Rowing Machine', 'Cardio', 'cardio'],
  ['Elliptical', 'Cardio', 'cardio'],
  ['Stair Climber', 'Cardio', 'cardio'],
  ['Walking', 'Cardio', 'cardio'],
];

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
