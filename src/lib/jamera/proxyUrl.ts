const ALLOWED_PROXY_PROTOCOLS = new Set(['ws:', 'wss:']);

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
