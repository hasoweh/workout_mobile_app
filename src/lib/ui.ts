import { h } from './dom';

/** Opens a bottom sheet with `content`. Returns a close function. Tapping the backdrop closes it. */
export function openSheet(content: Node, opts: { title?: string; onClose?: () => void } = {}): () => void {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  // Only the topmost sheet reacts to Escape, so a confirm over a sheet doesn't close both.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && [...document.querySelectorAll('.sheet-backdrop')].at(-1) === backdrop) close();
  };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    opts.title ? h('div', { class: 'sheet-header' }, h('h2', {}, opts.title), h('button', { class: 'btn-icon', 'aria-label': 'Close', onclick: () => close() }, '✕')) : null,
    content,
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e: Event) => e.target === backdrop && close() }, sheet);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  return close;
}

/** Confirmation sheet. Resolves true if confirmed. */
export function confirmDialog(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const close = openSheet(
      h('div', { class: 'stack' },
        h('p', {}, message),
        h('div', { class: 'row' },
          h('button', { class: 'btn-secondary grow', onclick: () => close() }, 'Cancel'),
          h('button', { class: `${opts.danger ? 'btn-danger' : ''} grow`, onclick: () => { result = true; close(); } }, opts.confirmLabel ?? 'OK'),
        ),
      ),
      { onClose: () => resolve(result) },
    );
  });
}

/** Brief message at the bottom of the screen. */
export function toast(message: string, ms = 2500): void {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

/** Navigate to a route, e.g. go('history', 12) → #/history/12. */
export function go(...parts: Array<string | number>): void {
  location.hash = '#/' + parts.join('/');
}
