/** Send only lifecycle labels and error locations. Never serialize console args, events or user data. */
export function startTVLogs(proxy: string): void {
  const endpoint = proxy.replace(/^ws/, 'http') + '/tv/log';
  const post = (event: Record<string, string | number>) => {
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event) }).catch(() => {});
  };
  post({ kind: 'boot' });
  window.addEventListener('tv-world-ready', () => post({ kind:'renderer-ready' }));
  window.addEventListener('tv-render-error', (e) => post({kind:'renderer-error', message:String((e as CustomEvent).detail).slice(0,500)}));
  window.addEventListener('error', (e) => post({ kind: 'error', line: e.lineno, column: e.colno,
    source: e.filename.split('/').pop()?.split(/[?#]/)[0] ?? '', type: e.error?.name ?? 'Error' }));
  window.addEventListener('unhandledrejection', () => post({ kind: 'unhandledrejection' }));
  document.addEventListener('visibilitychange', () => post({ kind: document.visibilityState }));
}
