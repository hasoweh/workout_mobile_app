import { h } from '../lib/dom';
import { dayTitle, formatTarget, getProgram, nextDay, programHistory, PROGRAMS, startOfWeek, startProgramDay, type Program, type ProgramDay } from '../lib/programs';
import { getSettings, setSetting } from '../lib/settings';
import { go, openSheet, safe } from '../lib/ui';
import { getActiveWorkout } from '../lib/workouts';
import { refresh } from '../router';
import './program.css';

/** Program tab: pick a program, see this week's days and start the next one. */
export async function programView(root: HTMLElement, _params: string[]): Promise<void> {
  root.classList.add('program', 'stack');
  try {
    const [settings, active] = await Promise.all([getSettings(), getActiveWorkout()]);
    const program = getProgram(settings.programId);
    root.replaceChildren(h('h1', {}, 'Program'), ...(program ? await buildFollowing(program, !!active) : buildPicker()));
  } catch (err) {
    console.error(err);
    root.replaceChildren(h('h1', {}, 'Program'), h('div', { class: 'card empty' }, h('p', {}, 'Could not load programs.')));
  }
}

const follow = (id: string | null) => safe(async () => {
  await setSetting('programId', id);
  refresh();
});

function buildPicker(): Node[] {
  return [
    h('p', { class: 'muted program-intro' }, 'Pick a program to follow. Each day starts a workout with its exercises already added.'),
    ...PROGRAMS.map((p) => h('section', { class: 'card stack program-pick' },
      h('h2', {}, p.name),
      h('p', { class: 'muted small' }, p.description),
      h('ul', { class: 'small program-pick-days' }, ...p.days.map((d) =>
        h('li', {}, h('strong', {}, `Day ${d.key}: `), d.exercises.map((e) => e.label ?? e.name).join(', ')))),
      h('button', { type: 'button', class: 'btn-go btn-block btn-lg', onclick: follow(p.id) }, 'Follow this program'),
    )),
  ];
}

async function buildFollowing(program: Program, hasActive: boolean): Promise<Node[]> {
  const history = await programHistory(program.id);
  const next = nextDay(program, history);
  const weekStart = startOfWeek();
  const doneThisWeek = new Set(history.filter((w) => w.startedAt >= weekStart).map((w) => w.programDay));
  const doneCount = program.days.filter((d) => doneThisWeek.has(d.key)).length;

  const start = (day: ProgramDay) => safe(async () => {
    await startProgramDay(program, day);
    go('log');
  });

  return [
    h('section', { class: 'card stack program-head' },
      h('div', { class: 'spread' },
        h('h2', {}, program.name),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => changeProgram(program) }, 'Change')),
      h('div', { class: 'program-week' },
        h('span', { class: 'muted small' }, `This week: ${doneCount} of ${program.days.length}`),
        h('div', { class: 'program-week-days' }, ...program.days.map((d) =>
          h('span', { class: `program-week-day${doneThisWeek.has(d.key) ? ' done' : ''}${d === next ? ' next' : ''}` },
            doneThisWeek.has(d.key) ? `${d.key} ✓` : d.key)))),
    ),
    hasActive
      ? h('a', { class: 'banner program-banner', href: '#/log' }, 'Workout in progress — tap to resume it before starting another')
      : null,
    ...program.days.map((d) => dayCard(program, d, d === next, doneThisWeek.has(d.key), hasActive, start(d))),
  ].filter((n): n is HTMLElement => n !== null);
}

function dayCard(program: Program, day: ProgramDay, isNext: boolean, done: boolean, hasActive: boolean, onStart: () => void): HTMLElement {
  return h('details', { class: `card program-day${isNext ? ' next' : ''}`, open: isNext },
    h('summary', { class: 'program-day-summary' },
      h('span', { class: 'program-day-title' }, `Day ${day.key}`),
      isNext ? h('span', { class: 'program-badge' }, 'Up next') : null,
      done ? h('span', { class: 'program-badge done' }, 'Done this week') : null,
      h('span', { class: 'muted small program-day-count' }, `${day.exercises.length} exercises`)),
    h('ol', { class: 'list program-ex-list' }, ...day.exercises.map((e) =>
      h('li', { class: 'spread program-ex' },
        h('span', { class: 'program-ex-name' }, e.label ?? e.name),
        h('span', { class: 'muted small program-ex-target' }, formatTarget(e))))),
    h('button', {
      type: 'button', class: `${isNext ? 'btn-go' : 'btn-secondary'} btn-block btn-lg`, disabled: hasActive, onclick: onStart,
      'aria-label': `Start ${dayTitle(program, day)}`,
    }, `Start Day ${day.key}`),
  );
}

function changeProgram(current: Program): void {
  const pick = (id: string | null) => () => { close(); follow(id)(); };
  const close = openSheet(
    h('div', { class: 'stack' },
      ...PROGRAMS.map((p) => h('button', {
        type: 'button', class: `${p.id === current.id ? 'btn-go' : 'btn-secondary'} btn-block`, onclick: pick(p.id),
      }, p.name)),
      h('button', { type: 'button', class: 'btn-ghost btn-block', onclick: pick(null) }, 'Stop following a program'),
    ),
    { title: 'Program' },
  );
}
