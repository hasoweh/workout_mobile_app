import { db, ensureDefaultExercise, type Workout } from '../db';
import { getActiveWorkout, startWorkout } from './workouts';

export interface ProgramExercise {
  /** Name of a default exercise in db.ts (matched ignoring case). */
  name: string;
  /** Display name on the Program tab when it differs from the exercise name. */
  label?: string;
  sets: number;
  /** Rep target, e.g. "8–12". */
  reps: string;
  /** Extra hint shown after the target, e.g. "each leg". */
  note?: string;
}

export interface ProgramDay {
  key: string;
  exercises: ProgramExercise[];
}

export interface Program {
  id: string;
  name: string;
  description: string;
  days: ProgramDay[];
}

const ex = (name: string, sets: number, reps: string, extra: Partial<ProgramExercise> = {}): ProgramExercise =>
  ({ name, sets, reps, ...extra });

export const PROGRAMS: Program[] = [
  {
    id: 'full-body-3',
    name: 'Full Body · 3 days',
    description: 'Three full-body days on machines and dumbbells, e.g. Mon / Wed / Fri, rotating A → B → C.',
    days: [
      {
        key: 'A',
        exercises: [
          ex('Leg Press', 3, '8–12'),
          ex('Dumbbell Bench Press', 3, '8–12'),
          ex('Lat Pulldown', 3, '8–12'),
          ex('Leg Curl', 3, '10–15'),
          ex('Chest Fly (Machine)', 3, '12–15'),
          ex('Triceps Pushdown', 3, '10–15'),
          ex('Lateral Raise', 3, '12–15', { label: 'Dumbbell Lateral Raise' }),
        ],
      },
      {
        key: 'B',
        exercises: [
          ex('Dumbbell Romanian Deadlift', 3, '8–12'),
          ex('Machine Shoulder Press', 3, '8–12'),
          ex('Dumbbell Row', 3, '8–12', { note: 'each arm' }),
          ex('Leg Extension', 3, '10–15'),
          ex('Rear Delt Fly', 3, '12–15'),
          ex('Hammer Curl', 3, '10–15'),
          ex('Calf Raise', 3, '12–15'),
        ],
      },
      {
        key: 'C',
        exercises: [
          ex('Bulgarian Split Squat', 3, '8–12', { note: 'each leg' }),
          ex('Incline Dumbbell Press', 3, '8–12'),
          ex('Seated Cable Row', 3, '8–12'),
          ex('Leg Curl', 3, '10–15'),
          ex('Chest Fly (Machine)', 3, '12–15'),
          ex('Dumbbell Curl', 3, '10–15'),
          ex('Triceps Press Machine', 3, '10–15'),
        ],
      },
    ],
  },
];

export const getProgram = (id: string | null | undefined): Program | undefined => PROGRAMS.find((p) => p.id === id);

/** "3 × 8–12 each leg". */
export const formatTarget = (e: ProgramExercise): string => `${e.sets} × ${e.reps}${e.note ? ` ${e.note}` : ''}`;

export const dayTitle = (program: Program, day: ProgramDay): string => `${program.name.split(' · ')[0]} · Day ${day.key}`;

/** Finished workouts of this program, newest first. */
export async function programHistory(programId: string): Promise<Workout[]> {
  return db.workouts.orderBy('startedAt').reverse()
    .filter((w) => w.programId === programId && w.endedAt !== undefined).toArray();
}

/** The day after the most recently finished one, wrapping around; the first day if none yet. */
export function nextDay(program: Program, history: Workout[]): ProgramDay {
  const lastKey = history[0]?.programDay;
  const i = program.days.findIndex((d) => d.key === lastKey);
  return program.days[(i + 1) % program.days.length];
}

/** Monday 00:00 local time of the current week. */
export function startOfWeek(now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Starts a workout pre-filled with a program day's exercises (unless one is already in progress). */
export async function startProgramDay(program: Program, day: ProgramDay): Promise<void> {
  if (await getActiveWorkout()) return;
  const ids: number[] = [];
  for (const e of day.exercises) {
    const found = await ensureDefaultExercise(e.name);
    if (found && !ids.includes(found.id)) ids.push(found.id);
  }
  await startWorkout(ids, dayTitle(program, day), { programId: program.id, programDay: day.key });
}

/** Targets for a program workout, keyed by exercise name (lowercase). Empty for non-program workouts. */
export function workoutTargets(w: Workout): Map<string, ProgramExercise> {
  const day = getProgram(w.programId)?.days.find((d) => d.key === w.programDay);
  return new Map((day?.exercises ?? []).map((e) => [e.name.toLowerCase(), e]));
}
