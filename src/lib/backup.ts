import { db, legacyMuscles, MUSCLES, type Exercise, type Muscle, type SettingRow, type Workout, type WorkoutSet } from '../db';
import { sortSets } from './analytics';
import { getSettings, setSetting, type Settings } from './settings';

/** Settings that travel with a backup. lastBackupAt is device-local and never exported/imported. */
export type BackupSettings = Partial<Omit<Settings, 'lastBackupAt'>>;

export interface BackupFile {
  app: 'workout-tracker';
  schemaVersion: number;
  exportedAt: string;
  exercises: Exercise[];
  workouts: Workout[];
  sets: WorkoutSet[];
  settings: BackupSettings;
}

export interface BackupSummary {
  workouts: number;
  sets: number;
  exercises: number;
  /** startedAt of the oldest / newest workout, or null when there are none. */
  firstDate: number | null;
  lastDate: number | null;
}

export type ValidationResult = { ok: true; data: BackupFile; summary: BackupSummary } | { ok: false; error: string };

// ---- Export ----

export async function exportJSON(): Promise<BackupFile> {
  return db.transaction('r', db.exercises, db.workouts, db.sets, db.settings, async () => {
    const [exercises, workouts, sets, settings] = await Promise.all([
      db.exercises.toArray(),
      db.workouts.toArray(),
      db.sets.toArray(),
      getSettings(),
    ]);
    const { lastBackupAt: _omit, ...exported } = settings;
    void _omit;
    return {
      app: 'workout-tracker' as const,
      schemaVersion: db.verno,
      exportedAt: new Date().toISOString(),
      exercises,
      workouts,
      sets,
      settings: exported,
    };
  });
}

const CSV_HEADER = [
  'date', 'start_time', 'workout_id', 'exercise', 'muscles', 'type',
  'set_number', 'weight_kg', 'reps', 'distance_km', 'duration_s', 'notes',
];

/** Quotes a CSV field when it contains a quote, comma or line break. */
export function csvField(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(fields: Array<string | number | undefined | null>): string {
  return fields.map(csvField).join(',');
}

/** "2026-10-17" in local time. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** One row per set of finished workouts, oldest first. */
export async function exportCSV(): Promise<string> {
  const [exercises, workouts, sets] = await Promise.all([db.exercises.toArray(), db.workouts.toArray(), db.sets.toArray()]);
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const setsByWorkout = new Map<number, WorkoutSet[]>();
  for (const s of sets) {
    const list = setsByWorkout.get(s.workoutId);
    if (list) list.push(s);
    else setsByWorkout.set(s.workoutId, [s]);
  }

  const lines = [csvRow(CSV_HEADER)];
  const finished = workouts.filter((w) => w.endedAt !== undefined).sort((a, b) => a.startedAt - b.startedAt);
  for (const w of finished) {
    const setNumbers = new Map<number, number>();
    for (const s of sortSets(setsByWorkout.get(w.id) ?? [])) {
      const n = (setNumbers.get(s.exerciseId) ?? 0) + 1;
      setNumbers.set(s.exerciseId, n);
      const ex = exById.get(s.exerciseId);
      lines.push(csvRow([
        localDate(w.startedAt), localTime(w.startedAt), w.id,
        ex?.name ?? `#${s.exerciseId}`, ex?.muscles.join('; '), ex?.type,
        n, s.weight, s.reps, s.distance, s.duration, s.notes,
      ]));
    }
  }
  // BOM so Excel detects UTF-8; CRLF per RFC 4180.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---- Delivery ----

export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hands a file to the user: the Android share sheet (→ Google Drive etc.) when the browser can share
 * this file type, otherwise a regular download.
 */
export async function deliverFile(filename: string, content: string, mime: string): Promise<DeliveryResult> {
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], filename, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Other failures (e.g. NotAllowedError when user activation expired): fall back to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** Exports and delivers a JSON backup. Records lastBackupAt unless the user cancelled. */
export async function saveBackup(): Promise<DeliveryResult> {
  const data = await exportJSON();
  const result = await deliverFile(`workout-backup-${localDate(Date.now())}.json`, JSON.stringify(data), 'application/json');
  if (result !== 'cancelled') await setSetting('lastBackupAt', Date.now());
  return result;
}

export async function saveCSV(): Promise<DeliveryResult> {
  return deliverFile(`workouts-${localDate(Date.now())}.csv`, await exportCSV(), 'text/csv');
}

// ---- Validation ----

class InvalidBackup extends Error {}

function fail(msg: string): never {
  throw new InvalidBackup(msg);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function optNumber(obj: Record<string, unknown>, key: string, where: string): number | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (!isFiniteNum(v) || v < 0) fail(`${where}: "${key}" must be a non-negative number.`);
  return v;
}

function optString(obj: Record<string, unknown>, key: string, where: string): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') fail(`${where}: "${key}" must be text.`);
  return v;
}

function reqTimestamp(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (!isFiniteNum(v) || v < 0) fail(`${where}: "${key}" must be a timestamp.`);
  return v;
}

function reqArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) fail(`"${key}" is missing or not a list.`);
  return v;
}

function checkUniqueId(seen: Set<number>, id: unknown, where: string): number {
  if (!isPosInt(id)) fail(`${where}: "id" must be a positive whole number.`);
  if (seen.has(id)) fail(`${where}: duplicate id ${id}.`);
  seen.add(id);
  return id;
}

function parseExercise(raw: unknown, i: number, ids: Set<number>, names: Set<string>): Exercise {
  let where = `Exercise ${i + 1}`;
  if (!isObj(raw)) fail(`${where} is not an object.`);
  const id = checkUniqueId(ids, raw.id, where);
  if (typeof raw.name !== 'string' || !raw.name.trim()) fail(`${where}: "name" must be non-empty text.`);
  const name = raw.name;
  where = `Exercise "${name}"`;
  const key = name.trim().toLowerCase();
  if (names.has(key)) fail(`${where}: duplicate exercise name (names must be unique, ignoring case).`);
  names.add(key);
  let muscles: Muscle[];
  if (raw.muscles !== undefined) {
    const list = raw.muscles;
    if (!Array.isArray(list) || list.length === 0) fail(`${where}: "muscles" must be a non-empty list.`);
    for (const m of list) {
      if (!MUSCLES.includes(m as Muscle)) fail(`${where}: unknown muscle ${JSON.stringify(m)}. Expected one of ${MUSCLES.join(', ')}.`);
    }
    if (new Set(list).size !== list.length) fail(`${where}: "muscles" lists the same muscle twice.`);
    muscles = list as Muscle[];
  } else {
    // Pre-v3 backups have a single muscleGroup (with the old "Arms"/"Back" groups).
    const legacy = typeof raw.muscleGroup === 'string' ? legacyMuscles(name, raw.muscleGroup) : null;
    if (!legacy) fail(`${where}: unknown muscle group ${JSON.stringify(raw.muscleGroup)}.`);
    muscles = legacy;
  }
  if (raw.type !== 'strength' && raw.type !== 'cardio') fail(`${where}: "type" must be "strength" or "cardio".`);
  if (raw.archived !== undefined && typeof raw.archived !== 'boolean') fail(`${where}: "archived" must be true or false.`);
  return {
    id,
    name,
    muscles,
    type: raw.type,
    archived: raw.archived ?? false,
    createdAt: reqTimestamp(raw, 'createdAt', where),
  };
}

function parseWorkout(raw: unknown, i: number, ids: Set<number>, exerciseIds: Set<number>, version: number): Workout {
  const where = `Workout ${i + 1}`;
  if (!isObj(raw)) fail(`${where} is not an object.`);
  const id = checkUniqueId(ids, raw.id, where);
  const startedAt = reqTimestamp(raw, 'startedAt', where);
  const endedAt = raw.endedAt === undefined || raw.endedAt === null ? undefined : reqTimestamp(raw, 'endedAt', where);
  let exIds: number[] = [];
  if (raw.exerciseIds !== undefined || version >= 2) {
    if (!Array.isArray(raw.exerciseIds) || !raw.exerciseIds.every(isPosInt)) {
      fail(`${where}: "exerciseIds" must be a list of exercise ids.`);
    }
    // Drop ids of exercises that no longer exist (harmless leftovers) rather than rejecting the file.
    exIds = [...new Set(raw.exerciseIds)].filter((x) => exerciseIds.has(x));
  }
  const w: Workout = { id, startedAt, exerciseIds: exIds };
  if (endedAt !== undefined) w.endedAt = endedAt;
  const notes = optString(raw, 'notes', where);
  if (notes !== undefined) w.notes = notes;
  return w;
}

function parseSet(raw: unknown, i: number, ids: Set<number>, workoutIds: Set<number>, exerciseIds: Set<number>): WorkoutSet {
  const where = `Set ${i + 1}`;
  if (!isObj(raw)) fail(`${where} is not an object.`);
  const id = checkUniqueId(ids, raw.id, where);
  if (!isPosInt(raw.workoutId) || !workoutIds.has(raw.workoutId)) fail(`${where}: refers to workout ${JSON.stringify(raw.workoutId)}, which is not in the file.`);
  if (!isPosInt(raw.exerciseId) || !exerciseIds.has(raw.exerciseId)) fail(`${where}: refers to exercise ${JSON.stringify(raw.exerciseId)}, which is not in the file.`);
  if (!isFiniteNum(raw.order)) fail(`${where}: "order" must be a number.`);
  const s: WorkoutSet = {
    id,
    workoutId: raw.workoutId,
    exerciseId: raw.exerciseId,
    order: raw.order,
    createdAt: reqTimestamp(raw, 'createdAt', where),
  };
  // Only copy fields that are present, so the stored objects match what the app writes.
  for (const key of ['reps', 'weight', 'distance', 'duration'] as const) {
    const v = optNumber(raw, key, where);
    if (v !== undefined) s[key] = v;
  }
  const notes = optString(raw, 'notes', where);
  if (notes !== undefined) s.notes = notes;
  return s;
}

function parseSettings(raw: unknown): BackupSettings {
  if (raw === undefined || raw === null) return {};
  // Accept either { key: value } or Dexie-style [{ key, value }] rows.
  let obj: Record<string, unknown>;
  if (Array.isArray(raw)) {
    obj = {};
    for (const row of raw) {
      if (!isObj(row) || typeof row.key !== 'string') fail('"settings" rows must have a "key".');
      obj[row.key] = row.value;
    }
  } else if (isObj(raw)) {
    obj = raw;
  } else {
    fail('"settings" must be an object.');
  }
  const out: BackupSettings = {};
  if (obj.units !== undefined) {
    if (obj.units !== 'kg' && obj.units !== 'lb') fail('Settings: "units" must be "kg" or "lb".');
    out.units = obj.units;
  }
  if (obj.weightStep !== undefined) {
    if (!isFiniteNum(obj.weightStep) || obj.weightStep <= 0) fail('Settings: "weightStep" must be a positive number.');
    out.weightStep = obj.weightStep;
  }
  return out;
}

/** Runtime validation of a parsed import file. Never throws. */
export function validateBackup(data: unknown): ValidationResult {
  try {
    if (!isObj(data)) fail('This is not a workout backup file.');
    if (data.app !== 'workout-tracker') fail('This file was not exported by this app.');
    const version = data.schemaVersion;
    if (version !== 1 && version !== 2) {
      fail(isFiniteNum(version) && version > 2
        ? `This backup is from a newer app version (schema ${version}). Update the app first.`
        : 'Unknown or missing backup schema version.');
    }

    const exerciseIds = new Set<number>();
    const names = new Set<string>();
    const exercises = reqArray(data, 'exercises').map((e, i) => parseExercise(e, i, exerciseIds, names));

    const workoutIds = new Set<number>();
    const workouts = reqArray(data, 'workouts').map((w, i) => parseWorkout(w, i, workoutIds, exerciseIds, version));
    if (workouts.filter((w) => w.endedAt === undefined).length > 1) fail('More than one workout is marked as in progress.');

    const setIds = new Set<number>();
    const sets = reqArray(data, 'sets').map((s, i) => parseSet(s, i, setIds, workoutIds, exerciseIds));

    // Schema 1 had no exerciseIds: derive them from the logged sets, in set order.
    if (version === 1) {
      const byWorkout = new Map<number, WorkoutSet[]>();
      for (const s of sets) byWorkout.set(s.workoutId, [...(byWorkout.get(s.workoutId) ?? []), s]);
      for (const w of workouts) {
        if (w.exerciseIds.length === 0) w.exerciseIds = [...new Set(sortSets(byWorkout.get(w.id) ?? []).map((s) => s.exerciseId))];
      }
    }

    const settings = parseSettings(data.settings);
    const starts = workouts.map((w) => w.startedAt);
    return {
      ok: true,
      data: {
        app: 'workout-tracker',
        schemaVersion: version,
        exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
        exercises, workouts, sets, settings,
      },
      summary: {
        workouts: workouts.length,
        sets: sets.length,
        exercises: exercises.length,
        firstDate: starts.length ? Math.min(...starts) : null,
        lastDate: starts.length ? Math.max(...starts) : null,
      },
    };
  } catch (err) {
    if (err instanceof InvalidBackup) return { ok: false, error: err.message };
    return { ok: false, error: `Could not read the backup: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---- Import ----

/** Replaces ALL data with a validated backup, preserving ids. Keeps this device's lastBackupAt. */
export async function importBackup(data: BackupFile): Promise<void> {
  await db.transaction('rw', db.exercises, db.workouts, db.sets, db.settings, async () => {
    const lastBackupAt = (await db.settings.get('lastBackupAt'))?.value ?? null;
    await Promise.all([db.sets.clear(), db.workouts.clear(), db.exercises.clear(), db.settings.clear()]);
    await db.exercises.bulkAdd(data.exercises);
    await db.workouts.bulkAdd(data.workouts);
    await db.sets.bulkAdd(data.sets);
    const rows: SettingRow[] = Object.entries(data.settings).map(([key, value]) => ({ key, value }));
    rows.push({ key: 'lastBackupAt', value: lastBackupAt });
    await db.settings.bulkAdd(rows);
  });
}
