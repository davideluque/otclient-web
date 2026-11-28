/** Startup exceptions are reported by the classic handler in jamera.html. */
export function startTVLogs(proxy: string): void {
  const endpoint = proxy.replace(/^ws/, 'http') + '/tv/log';
  const post = (event: Record<string, string | number>) => {
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event) }).catch(() => {});
  };
  post({ kind: 'boot' });
  window.addEventListener('tv-world-ready', () => post({ kind:'renderer-ready' }));
  window.addEventListener('tv-render-error', (e) => {
    const { message, stack } = (e as CustomEvent<{message:string; stack?:string}>).detail;
    post({kind:'renderer-error',message:message.slice(0,1000),stack:(stack || '').slice(0,4000)});
  });
  document.addEventListener('visibilitychange', () => post({ kind: document.visibilityState }));
}
