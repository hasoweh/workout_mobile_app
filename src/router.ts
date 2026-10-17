export type View = (root: HTMLElement) => void | Promise<void>;

/** Minimal hash router: #/log, #/history, ... Hash routing works on any static host without rewrites. */
export function startRouter(root: HTMLElement, routes: Record<string, View>, fallback: string): void {
  const render = async () => {
    const name = location.hash.replace(/^#\/?/, '').split('/')[0] || fallback;
    const view = routes[name] ?? routes[fallback];
    document.querySelectorAll<HTMLAnchorElement>('.tabbar a').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === name);
    });
    root.replaceChildren();
    await view(root);
  };
  window.addEventListener('hashchange', render);
  void render();
}
