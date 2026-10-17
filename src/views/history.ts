import { h } from '../lib/dom';
import { renderDetail } from './history/detail';
import { renderList } from './history/list';
import './history.css';

/** #/history → list of finished workouts; #/history/<id> → detail/edit view. */
export async function historyView(root: HTMLElement, params: string[]): Promise<void> {
  try {
    if (params[0]) await renderDetail(root, params[0]);
    else await renderList(root);
  } catch (err) {
    console.error(err);
    root.replaceChildren(
      h('div', { class: 'empty stack' },
        h('p', {}, 'Could not load history.'),
        h('a', { class: 'history-link', href: '#/history' }, '← Back to history'),
      ),
    );
  }
}
