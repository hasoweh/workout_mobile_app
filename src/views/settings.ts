import { db, requestPersistentStorage } from '../db';
import { importBackup, saveBackup, saveCSV, validateBackup } from '../lib/backup';
import { h } from '../lib/dom';
import { formatDate } from '../lib/format';
import { getSettings, isBackupDue, setSetting, type Units } from '../lib/settings';
import { confirmDialog, openSheet, toast } from '../lib/ui';
import { refresh } from '../router';
import { exercisesSection } from './settings/exercises';
import './settings.css';

const STEP_OPTIONS: Record<Units, number[]> = { kg: [1, 1.25, 2.5, 5], lb: [2.5, 5, 10] };
const DEFAULT_STEP: Record<Units, number> = { kg: 2.5, lb: 5 };

export async function settingsView(root: HTMLElement): Promise<void> {
  const [backup, units, exercises, storage] = await Promise.all([
    backupSection(), unitsSection(), exercisesSection(), storageSection(),
  ]);
  root.append(h('div', { class: 'stack settings' }, h('h1', {}, 'Settings'), backup, units, exercises, storage, aboutSection()));
}

/** Re-renders a section in place (keeps scroll position, unlike a full route refresh). */
async function replace(el: HTMLElement, build: () => Promise<HTMLElement>): Promise<void> {
  el.replaceWith(await build());
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---- Backup & restore ----

function relativeDays(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

async function backupSection(): Promise<HTMLElement> {
  const [{ lastBackupAt }, due] = await Promise.all([getSettings(), isBackupDue()]);
  const card = h('section', { class: 'card stack' });
  const rerender = () => replace(card, backupSection);

  const busy = async (btn: HTMLButtonElement, task: () => Promise<void>) => {
    btn.disabled = true;
    try {
      await task();
    } catch (err) {
      toast(`Failed: ${errMsg(err)}`, 4000);
    } finally {
      btn.disabled = false;
    }
  };

  const exportBtn: HTMLButtonElement = h('button', {
    class: 'btn-block btn-lg',
    onclick: () => void busy(exportBtn, async () => {
      const result = await saveBackup();
      if (result === 'cancelled') return;
      toast(result === 'shared' ? 'Backup shared' : 'Backup downloaded');
      await rerender();
    }),
  }, 'Export backup (JSON)');

  const csvBtn: HTMLButtonElement = h('button', {
    class: 'btn-secondary grow',
    onclick: () => void busy(csvBtn, async () => {
      const result = await saveCSV();
      if (result !== 'cancelled') toast(result === 'shared' ? 'CSV shared' : 'CSV downloaded');
    }),
  }, 'Export CSV');

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: () => {
      const file = fileInput.files?.[0];
      fileInput.value = ''; // allow picking the same file again
      if (file) void handleImport(file);
    },
  });

  card.append(
    h('h2', { class: 'settings-h2' }, 'Backup & restore'),
    h('p', { class: `settings-last-backup${due ? ' settings-due' : ''}` },
      'Last backup: ',
      h('strong', {}, lastBackupAt === null ? 'Never' : `${relativeDays(lastBackupAt)} (${formatDate(lastBackupAt)})`),
    ),
    exportBtn,
    h('div', { class: 'row' },
      csvBtn,
      h('button', { class: 'btn-secondary grow', onclick: () => fileInput.click() }, 'Import backup'),
    ),
    fileInput,
    h('p', { class: 'muted small' }, 'On Android, Export opens the share sheet when supported, so you can save to Google Drive. Otherwise the file goes to Downloads.'),
  );
  return card;
}

async function handleImport(file: File): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showImportError(`"${file.name}" is not a valid JSON file.`);
    return;
  }
  const result = validateBackup(parsed);
  if (!result.ok) {
    showImportError(result.error);
    return;
  }
  const s = result.summary;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const range = s.firstDate !== null && s.lastDate !== null ? `, from ${formatDate(s.firstDate)} to ${formatDate(s.lastDate)}` : '';
  const ok = await confirmDialog(
    `${plural(s.workouts, 'workout')}, ${plural(s.sets, 'set')}, ${plural(s.exercises, 'exercise')}${range}. ` +
      'This will REPLACE all data on this phone.',
    { confirmLabel: 'Replace all data', danger: true },
  );
  if (!ok) return;
  try {
    await importBackup(result.data);
  } catch (err) {
    showImportError(`Import failed, nothing was changed: ${errMsg(err)}`);
    return;
  }
  toast('Backup imported');
  // Every section (units, exercises, counts) may have changed: re-render the whole tab.
  refresh();
}

function showImportError(message: string): void {
  const close = openSheet(
    h('div', { class: 'stack' },
      h('p', { class: 'settings-error' }, message),
      h('button', { class: 'btn-secondary btn-block', onclick: () => close() }, 'OK'),
    ),
    { title: "Can't import" },
  );
}

// ---- Units ----

async function unitsSection(): Promise<HTMLElement> {
  const { units, weightStep } = await getSettings();
  const card = h('section', { class: 'card stack' });
  const rerender = () => replace(card, unitsSection);

  const chip = (label: string, active: boolean, onclick: () => Promise<void>) =>
    h('button', {
      class: `chip settings-chip${active ? ' active' : ''}`, 'aria-pressed': String(active),
      onclick: () => void onclick().then(rerender).catch((err: unknown) => toast(`Failed: ${errMsg(err)}`)),
    }, label);

  card.append(
    h('h2', { class: 'settings-h2' }, 'Units'),
    h('div', {},
      h('label', {}, 'Weight unit'),
      h('div', { class: 'chips' }, ...(['kg', 'lb'] as const).map((u) =>
        chip(u, u === units, async () => {
          if (u === units) return;
          await setSetting('units', u);
          await setSetting('weightStep', DEFAULT_STEP[u]);
        }))),
    ),
    h('div', {},
      h('label', {}, `Weight step (+/− buttons), ${units}`),
      h('div', { class: 'chips' }, ...STEP_OPTIONS[units].map((step) =>
        chip(String(step), step === weightStep, () => setSetting('weightStep', step)))),
    ),
    h('p', { class: 'muted small' }, 'Weights are stored in kg, so switching units never changes your data.'),
  );
  return card;
}

// ---- Storage ----

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

async function storageSection(): Promise<HTMLElement> {
  const storage = navigator.storage as StorageManager | undefined;
  const [persisted, estimate, workouts, sets, exercises] = await Promise.all([
    storage?.persisted?.().catch(() => false) ?? Promise.resolve(false),
    storage?.estimate?.().catch(() => null) ?? Promise.resolve(null),
    db.workouts.count(),
    db.sets.count(),
    db.exercises.count(),
  ]);
  const card = h('section', { class: 'card stack' });

  const request: HTMLButtonElement = h('button', {
    class: 'btn-secondary btn-block',
    onclick: async () => {
      request.disabled = true;
      const granted = await requestPersistentStorage().catch(() => false);
      toast(granted ? 'Storage is now persistent' : 'The browser declined. Installing the app to the home screen usually helps.', 4000);
      await replace(card, storageSection).catch(() => { request.disabled = false; });
    },
  }, 'Request persistent storage');

  const stat = (label: string, value: string | Node) => h('div', { class: 'spread settings-stat' }, h('span', { class: 'muted' }, label), h('span', {}, value));

  card.append(...[
    h('h2', { class: 'settings-h2' }, 'Storage'),
    stat('Persistent', persisted
      ? h('span', { class: 'settings-ok' }, 'Yes')
      : h('span', { class: 'settings-due' }, 'No (may be cleared by the browser)')),
    persisted || !storage?.persist ? null : request,
    estimate && estimate.usage !== undefined
      ? stat('Used', `${formatBytes(estimate.usage)}${estimate.quota ? ` of ${formatBytes(estimate.quota)}` : ''}`)
      : null,
    stat('Workouts', String(workouts)),
    stat('Sets', String(sets)),
    stat('Exercises', String(exercises)),
  ].filter((el) => el !== null));
  return card;
}

// ---- About ----

function aboutSection(): HTMLElement {
  return h('section', { class: 'card stack' },
    h('h2', { class: 'settings-h2' }, 'About'),
    h('p', {}, h('strong', {}, 'Workout Tracker')),
    h('p', { class: 'muted' }, 'All data stays on this phone. Back up regularly.'),
    h('button', { class: 'btn-danger btn-block', onclick: () => void deleteAll() }, 'Delete all data'),
  );
}

async function deleteAll(): Promise<void> {
  const first = await confirmDialog('Delete ALL workouts, sets, exercises and settings from this phone? Export a backup first if you might want them back.', {
    confirmLabel: 'Continue', danger: true,
  });
  if (!first) return;

  const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Type DELETE to confirm' });
  const confirmBtn: HTMLButtonElement = h('button', {
    class: 'btn-danger btn-block', disabled: true,
    onclick: async () => {
      confirmBtn.disabled = true;
      try {
        // Deleting the database and reloading re-creates it with the default exercises (db 'populate').
        await db.delete();
        location.reload();
      } catch (err) {
        toast(`Failed: ${errMsg(err)}`, 4000);
        confirmBtn.disabled = false;
      }
    },
  }, 'Delete everything');
  input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim() !== 'DELETE'; });

  openSheet(
    h('div', { class: 'stack' },
      h('p', {}, 'This cannot be undone. Type ', h('strong', {}, 'DELETE'), ' to confirm.'),
      input,
      confirmBtn,
    ),
    { title: 'Delete all data' },
  );
  input.focus();
}
