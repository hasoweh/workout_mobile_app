/** A view renders into `root`. `params` are the path segments after the route name (#/history/12 → ['12']). */
export type View = (root: HTMLElement, params: string[]) => void | Promise<void>;

/** Minimal hash router: #/log, #/history/12, ... Hash routing works on any static host without rewrites. */
export function startRouter(root: HTMLElement, routes: Record<string, View>, fallback: string): void {
  let renderId = 0;
  const render = async () => {
    const [name = '', ...params] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const route = name in routes ? name : fallback;
    document.querySelectorAll<HTMLAnchorElement>('.tabbar a').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === route);
    });
    const id = ++renderId;
    const container = document.createElement('div');
    await routes[route](container, params);
    // Ignore stale renders if the user navigated again while this one was loading.
    if (id === renderId) {
      root.replaceChildren(container);
      window.scrollTo(0, 0);
    }
  };
  window.addEventListener('hashchange', render);
  void render();
}

/** Re-render the current route (e.g. after data changes). */
export function refresh(): void {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
