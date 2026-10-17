import { h } from '../lib/dom';
import { refresh } from '../router';
import { destroyWhenDetached, takeCharts } from './progress/charts';
import { renderDetail } from './progress/detail';
import { renderOverview } from './progress/overview';
import './progress.css';

/** #/progress → overview; #/progress/<exerciseId> → exercise detail. */
export async function progressView(root: HTMLElement, params: string[] = []): Promise<void> {
  // Charts from the previous render are destroyed once the router has swapped them out.
  const old = takeCharts();
  root.classList.add('progress-view');
  try {
    if (params[0] !== undefined) await renderDetail(root, params[0]);
    else await renderOverview(root);
  } catch (err) {
    console.error(err);
    root.replaceChildren(
      h('h1', {}, 'Progress'),
      h('div', { class: 'card empty' }, h('p', {}, 'Could not load your progress data.'), h('p', { class: 'small' }, String(err))),
    );
  } finally {
    destroyWhenDetached(old);
  }
}

const onProgress = () => /^#\/progress(\/|$)/.test(location.hash);

// Leaving the tab: free chart instances once their canvases are gone.
window.addEventListener('hashchange', () => {
  if (!onProgress()) destroyWhenDetached(takeCharts());
});

// Chart colors are read from CSS variables at render time, so re-render when the OS theme flips.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (onProgress()) refresh();
});
