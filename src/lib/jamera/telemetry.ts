/**
 * Client → proxy telemetry stream for the walk-fluidity investigation:
 * the client batches timestamped events (walk sends/confirms, repaint
 * costs, fps, errors) and POSTs them to the proxy's /telemetry sink,
 * which appends JSONL for offline aggregation. Dev tooling — wired only
 * on dev builds, ?telemetry=0 opts out.
 *
 * Design: fire-and-forget. Telemetry must never affect gameplay — the
 * buffer is capped, flush failures are swallowed (one console.warn),
 * and when disabled every call is a no-op.
 */

interface TelemetryEvent {
  /** Client wall-clock ms (Date.now). */
  t: number;
  /** Client monotonic ms (performance.now) for interval math. */
  pt: number;
  name: string;
  data?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 2500;
const FLUSH_AT_EVENTS = 60;
const BUFFER_HARD_CAP = 500;

let endpoint: string | null = null;
let sessionId = '';
let buffer: TelemetryEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let warned = false;

export function telemetry(name: string, data?: Record<string, unknown>): void {
  if (!endpoint) return;
  if (buffer.length >= BUFFER_HARD_CAP) buffer.shift();
  buffer.push({ t: Date.now(), pt: Math.round(performance.now()), name, data });
  if (buffer.length >= FLUSH_AT_EVENTS) flush();
}

function flush(): void {
  if (!endpoint || buffer.length === 0) return;
  const batch = buffer.map((e) => ({ session: sessionId, ...e }));
  buffer = [];
  // keepalive lets the final batch survive page unload.
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch((err) => {
    if (!warned) {
      warned = true;
      console.warn('[telemetry] flush failed (suppressing further warnings):', err?.message ?? err);
    }
  });
}

/**
 * Start streaming. `proxyUrl` is the game proxy WS url — the sink lives
 * on the same host/port over HTTP.
 */
export function initTelemetry(proxyUrl: string): void {
  if (endpoint) return; // page-lifetime singleton
  try {
    const u = new URL(proxyUrl);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/telemetry';
    u.search = '';
    endpoint = u.toString();
  } catch {
    return; // unparseable proxy url — telemetry just stays off
  }
  sessionId = Math.random().toString(36).slice(2, 10);

  timer = setInterval(flush, FLUSH_INTERVAL_MS);
  window.addEventListener('pagehide', flush);
  window.addEventListener('error', (e) => {
    telemetry('error', { message: String(e.message).slice(0, 300) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    telemetry('unhandledrejection', { reason: String(e.reason).slice(0, 300) });
  });

  // A 1s fps sampler of our own so fps lands in the stream without the
  // metrics overlay being open.
  let frames = 0;
  let windowStart = performance.now();
  const tick = (): void => {
    frames++;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      telemetry('fps', { fps: Math.round((frames * 1000) / (now - windowStart)) });
      frames = 0;
      windowStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  telemetry('init', {
    ua: navigator.userAgent.slice(0, 120),
    dpr: window.devicePixelRatio,
    screen: `${window.innerWidth}x${window.innerHeight}`,
  });
  console.info(`[telemetry] streaming to ${endpoint} (session ${sessionId})`);
}

/** Test hook: tear the singleton down. */
export function resetTelemetry(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  endpoint = null;
  buffer = [];
  warned = false;
}
