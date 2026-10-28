import Dexie, { type EntityTable } from 'dexie';

export type ExerciseType = 'strength' | 'cardio';

export const MUSCLES = [
  'Chest', 'Upper Back', 'Lower Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Legs', 'Glutes', 'Core', 'Cardio',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export interface Exercise {
  id: number;
  name: string;
  /** Muscles worked, primary first (at least one). The primary decides grouping in lists. */
  muscles: Muscle[];
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
  /** Optional user-given name, e.g. "Push day". */
  name?: string;
  notes?: string;
  /** Set when started from a program day (see lib/programs), e.g. 'full-body-3' / 'A'. */
  programId?: string;
  programDay?: string;
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

// v3: single `muscleGroup` → `muscles` list; "Arms" split into Biceps/Triceps/Forearms, "Back" into Upper/Lower Back.
db.version(3)
  .stores({ exercises: '++id, &name, *muscles, type' })
  .upgrade(async (tx) => {
    await tx.table('exercises').toCollection().modify((e: Exercise & { muscleGroup?: string }) => {
      e.muscles = defaultMuscles(e.name) ?? legacyMuscles(e.name, e.muscleGroup ?? '') ?? ['Core'];
      delete e.muscleGroup;
    });
    await addMissingDefaults(tx.table('exercises'));
  });

// v4: new default exercises used by the built-in programs.
db.version(4)
  .stores({})
  .upgrade((tx) => addMissingDefaults(tx.table('exercises')));

// v5: Machine Row for the full-body program.
db.version(5)
  .stores({})
  .upgrade((tx) => addMissingDefaults(tx.table('exercises')));

db.on('populate', (tx) => addMissingDefaults(tx.table('exercises')));

async function addMissingDefaults(table: Dexie.Table<Exercise, number>): Promise<void> {
  const existing = new Set((await table.toArray()).map((e) => e.name.toLowerCase()));
  const now = Date.now();
  const missing = DEFAULT_EXERCISES.filter(([name]) => !existing.has(name.toLowerCase()));
  await table.bulkAdd(
    missing.map(([name, muscles, type]) => ({ name, muscles, type, archived: false, createdAt: now }) as Exercise),
  );
}

/** Finds an exercise by name (ignoring case), re-adding it from the defaults if the user deleted it. */
export async function ensureDefaultExercise(name: string): Promise<Exercise | undefined> {
  const lower = name.toLowerCase();
  const found = await db.exercises.filter((e) => e.name.toLowerCase() === lower).first();
  if (found) return found;
  const def = DEFAULT_EXERCISES.find(([n]) => n.toLowerCase() === lower);
  if (!def) return undefined;
  const ex = { name: def[0], muscles: def[1], type: def[2], archived: false, createdAt: Date.now() } as Exercise;
  ex.id = await db.exercises.add(ex);
  return ex;
}

function defaultMuscles(name: string): Muscle[] | undefined {
  const lower = name.toLowerCase();
  return DEFAULT_EXERCISES.find(([n]) => n.toLowerCase() === lower)?.[1];
}

/** Maps a pre-v3 single muscle group to the new muscles. Null if the group is unknown. */
export function legacyMuscles(name: string, group: string): Muscle[] | null {
  if (group === 'Arms') {
    if (/tricep|skull|pushdown|push-down|close.grip|kickback|extension|dip/i.test(name)) return ['Triceps'];
    if (/wrist|forearm|grip|farmer/i.test(name)) return ['Forearms'];
    return ['Biceps'];
  }
  if (group === 'Back') {
    return /deadlift|back extension|hyperextension|good morning|superman/i.test(name) ? ['Lower Back'] : ['Upper Back'];
  }
  return (MUSCLES as readonly string[]).includes(group) ? [group as Muscle] : null;
}

const DEFAULT_EXERCISES: Array<[string, Muscle[], ExerciseType]> = [
  ['Bench Press', ['Chest', 'Triceps', 'Shoulders'], 'strength'],
  ['Incline Bench Press', ['Chest', 'Shoulders', 'Triceps'], 'strength'],
  ['Dumbbell Bench Press', ['Chest', 'Triceps', 'Shoulders'], 'strength'],
  ['Incline Dumbbell Press', ['Chest', 'Shoulders', 'Triceps'], 'strength'],
  ['Chest Fly (Machine)', ['Chest'], 'strength'],
  ['Cable Crossover', ['Chest'], 'strength'],
  ['Push-up', ['Chest', 'Triceps', 'Shoulders'], 'strength'],
  ['Dip', ['Chest', 'Triceps', 'Shoulders'], 'strength'],
  ['Deadlift', ['Lower Back', 'Glutes', 'Legs', 'Upper Back', 'Forearms'], 'strength'],
  ['Back Extension', ['Lower Back', 'Glutes'], 'strength'],
  ['Barbell Row', ['Upper Back', 'Biceps', 'Lower Back'], 'strength'],
  ['Dumbbell Row', ['Upper Back', 'Biceps'], 'strength'],
  ['Pull-up', ['Upper Back', 'Biceps'], 'strength'],
  ['Chin-up', ['Upper Back', 'Biceps'], 'strength'],
  ['Lat Pulldown', ['Upper Back', 'Biceps'], 'strength'],
  ['Seated Cable Row', ['Upper Back', 'Biceps'], 'strength'],
  ['Machine Row', ['Upper Back', 'Biceps'], 'strength'],
  ['T-Bar Row', ['Upper Back', 'Biceps', 'Lower Back'], 'strength'],
  ['Shrug', ['Upper Back', 'Forearms'], 'strength'],
  ['Squat', ['Legs', 'Glutes', 'Lower Back'], 'strength'],
  ['Front Squat', ['Legs', 'Glutes', 'Core'], 'strength'],
  ['Leg Press', ['Legs', 'Glutes'], 'strength'],
  ['Bulgarian Split Squat', ['Legs', 'Glutes'], 'strength'],
  ['Lunge', ['Legs', 'Glutes'], 'strength'],
  ['Leg Extension', ['Legs'], 'strength'],
  ['Leg Curl', ['Legs'], 'strength'],
  ['Romanian Deadlift', ['Legs', 'Glutes', 'Lower Back'], 'strength'],
  ['Dumbbell Romanian Deadlift', ['Legs', 'Glutes', 'Lower Back'], 'strength'],
  ['Calf Raise', ['Legs'], 'strength'],
  ['Hip Thrust', ['Glutes', 'Legs'], 'strength'],
  ['Glute Bridge', ['Glutes'], 'strength'],
  ['Hip Abduction (Machine)', ['Glutes'], 'strength'],
  ['Overhead Press', ['Shoulders', 'Triceps'], 'strength'],
  ['Dumbbell Shoulder Press', ['Shoulders', 'Triceps'], 'strength'],
  ['Machine Shoulder Press', ['Shoulders', 'Triceps'], 'strength'],
  ['Lateral Raise', ['Shoulders'], 'strength'],
  ['Rear Delt Fly', ['Shoulders', 'Upper Back'], 'strength'],
  ['Face Pull', ['Shoulders', 'Upper Back'], 'strength'],
  ['Barbell Curl', ['Biceps', 'Forearms'], 'strength'],
  ['Dumbbell Curl', ['Biceps', 'Forearms'], 'strength'],
  ['Hammer Curl', ['Biceps', 'Forearms'], 'strength'],
  ['Triceps Pushdown', ['Triceps'], 'strength'],
  ['Overhead Triceps Extension', ['Triceps'], 'strength'],
  ['Skull Crusher', ['Triceps'], 'strength'],
  ['Close-Grip Bench Press', ['Triceps', 'Chest'], 'strength'],
  ['Triceps Press Machine', ['Triceps', 'Chest'], 'strength'],
  ['Wrist Curl', ['Forearms'], 'strength'],
  ["Farmer's Carry", ['Forearms', 'Upper Back', 'Core'], 'strength'],
  ['Plank', ['Core'], 'strength'],
  ['Hanging Leg Raise', ['Core', 'Forearms'], 'strength'],
  ['Cable Crunch', ['Core'], 'strength'],
  ['Ab Wheel Rollout', ['Core'], 'strength'],
  ['Running', ['Cardio'], 'cardio'],
  ['Treadmill', ['Cardio'], 'cardio'],
  ['Cycling', ['Cardio'], 'cardio'],
  ['Rowing Machine', ['Cardio'], 'cardio'],
  ['Elliptical', ['Cardio'], 'cardio'],
  ['Stair Climber', ['Cardio'], 'cardio'],
  ['Walking', ['Cardio'], 'cardio'],
];

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
