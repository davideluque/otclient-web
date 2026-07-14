const ALLOWED_PROXY_PROTOCOLS = new Set(['ws:', 'wss:']);

/**
 * Default WebSocket bridge URL when no `?proxy=` override is given.
 *
 * Dev builds talk to a bridge on :8090 of the page's own host — localhost on
 * your machine, or the LAN IP when a phone loads the Vite `--host` server, so
 * LAN testing needs no `?proxy=` override. Production defaults to the SAME
 * ORIGIN as the page (wss:// on an https page) so no deployment host is ever
 * baked into the shipped bundle — the reverse proxy in front of the page
 * forwards `/login` and `/game` on the same host. `isDev` is a parameter (not
 * read inline) so the behaviour is unit-testable.
 */
export function defaultProxyUrl(
  pageLocation: Pick<Location, 'protocol' | 'host' | 'hostname'> = window.location,
  isDev: boolean = import.meta.env.DEV,
): string {
  if (isDev) return `ws://${urlHost(pageLocation.hostname)}:8090`;
  const scheme = pageLocation.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${pageLocation.host}`;
}

/** URL.host requires IPv6 literals to retain their square brackets. */
function urlHost(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname;
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

/**
 * Query-string proxy overrides are useful for local/manual testing, but a
 * remote override would silently send account passwords through an
 * attacker-controlled WebSocket bridge. Only trust loopback proxies or a
 * proxy hosted on the same hostname as the page itself.
 */
export function resolveProxyOverride(
  raw: string | null,
  pageLocation: Pick<Location, 'hostname'> = window.location,
): string | undefined {
  if (raw === null || raw.trim() === '') return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    warnRejected(raw, 'not a valid URL');
    return undefined;
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(url.protocol)) {
    warnRejected(raw, 'only ws:// and wss:// proxies are allowed');
    return undefined;
  }
  if (isLoopbackHost(url.hostname) || isSamePageHost(url.hostname, pageLocation.hostname)) {
    return url.href.replace(/\/$/, '');
  }
  warnRejected(raw, 'host must be loopback or match the page hostname');
  return undefined;
}

// Loud fallback: a dev with a typo'd ?proxy= should learn why they're
// suddenly talking to the default proxy instead of their own.
function warnRejected(raw: string, reason: string): void {
  console.warn(`Ignoring ?proxy=${raw} (${reason}); using the default proxy.`);
}

function isSamePageHost(proxyHost: string, pageHost: string): boolean {
  return pageHost !== '' && proxyHost.toLowerCase() === pageHost.toLowerCase();
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]' || host === '::1') return true;
  const octets = host.split('.');
  if (octets.length !== 4) return false;
  const [first, ...rest] = octets;
  return first === '127' && rest.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
