import { db } from '../db';

export type Units = 'kg' | 'lb';

export interface Settings {
  units: Units;
  /** Weight +/- step, in the display unit. */
  weightStep: number;
  /** Rest timer length after logging a strength set, in seconds; 0 turns it off. */
  restSeconds: number;
  /** Epoch ms of the last successful export, or null if never. */
  lastBackupAt: number | null;
}

export const DEFAULT_SETTINGS: Settings = { units: 'kg', weightStep: 2.5, restSeconds: 90, lastBackupAt: null };

/** Remind the user to back up when the last export is older than this. */
export const BACKUP_REMINDER_DAYS = 14;

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db.settings.put({ key, value });
}

/** True when there is data worth backing up and no export in the last BACKUP_REMINDER_DAYS. */
export async function isBackupDue(): Promise<boolean> {
  const { lastBackupAt } = await getSettings();
  if ((await db.workouts.count()) === 0) return false;
  return lastBackupAt === null || Date.now() - lastBackupAt > BACKUP_REMINDER_DAYS * 86_400_000;
}
