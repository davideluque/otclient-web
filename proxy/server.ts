// WebSocket ↔ TCP bridge for the OT server. Deployment posture: this is a
// development/self-hosted tool with no authentication — it must sit on
// localhost or behind a TLS-terminating, access-controlled front (and the
// page must then use wss://). For anything reachable from other machines,
// set WS_ALLOWED_ORIGINS so arbitrary websites can't drive the bridge from
// a visitor's browser.
import { WebSocketServer, WebSocket } from 'ws';
import * as net from 'node:net';

const WS_PORT = parseInt(process.env['WS_PORT'] ?? '8090', 10);
const OT_HOST = process.env['OT_HOST'] ?? '127.0.0.1';
const OT_LOGIN_PORT = parseInt(process.env['OT_LOGIN_PORT'] ?? '7171', 10);
const OT_GAME_PORT = parseInt(process.env['OT_GAME_PORT'] ?? '7172', 10);

// One OT frame is a U16 length prefix + up to 0xffff payload bytes, so the
// largest legitimate WS message is exactly 2 + 0xffff. Anything bigger is
// not OT traffic; cap it instead of buffering it.
const MAX_PAYLOAD_BYTES = 2 + 0xffff;

// In-game clients ping every few seconds, so a quiet socket this long is
// dead weight — likely an abandoned tab or a probe holding a TCP slot open.
const IDLE_TIMEOUT_MS = parseInt(process.env['WS_IDLE_TIMEOUT_MS'] ?? `${5 * 60_000}`, 10);

// Comma-separated Origin allowlist. Empty = allow all (local development).
const ALLOWED_ORIGINS = (process.env['WS_ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const TARGET_PORTS: Record<string, number> = {
  '/login': OT_LOGIN_PORT,
  '/game': OT_GAME_PORT,
};

const wss = new WebSocketServer({ port: WS_PORT, maxPayload: MAX_PAYLOAD_BYTES });

console.log(`WebSocket proxy listening on ws://0.0.0.0:${WS_PORT}`);
console.log(`Forwarding to OT server at ${OT_HOST}:${OT_LOGIN_PORT} (login) / ${OT_GAME_PORT} (game)`);
if (ALLOWED_ORIGINS.length) console.log(`Origin allowlist: ${ALLOWED_ORIGINS.join(', ')}`);

wss.on('connection', (ws: WebSocket, req) => {
  // Exact-path routing only. The old `path.includes('game')` heuristic
  // silently mapped any unknown path to the login port — refuse instead.
  const path = (req.url ?? '').split('?')[0];
  const targetPort = TARGET_PORTS[path];
  if (targetPort === undefined) {
    console.warn(`Rejected connection: unknown path ${req.url}`);
    ws.close(1008, 'unknown path');
    return;
  }

  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length && (!origin || !ALLOWED_ORIGINS.includes(origin))) {
    console.warn(`Rejected connection: origin ${origin ?? '<none>'} not in allowlist`);
    ws.close(1008, 'origin not allowed');
    return;
  }

  console.log(`New connection → ${OT_HOST}:${targetPort} (${path})`);

  const tcp = net.createConnection({ host: OT_HOST, port: targetPort });

  // Drop sockets with no traffic in either direction for IDLE_TIMEOUT_MS.
  let idleTimer: NodeJS.Timeout | undefined;
  const bumpIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.log(`Idle timeout (${path}) — closing`);
      ws.close(1001, 'idle timeout');
      tcp.destroy();
    }, IDLE_TIMEOUT_MS);
  };
  bumpIdle();

  tcp.on('connect', () => {
    console.log(`TCP connected to ${OT_HOST}:${targetPort}`);
  });

  // Forward TCP → WebSocket
  tcp.on('data', (data: Buffer) => {
    bumpIdle();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Forward WebSocket → TCP
  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    bumpIdle();
    if (tcp.writable) {
      if (data instanceof ArrayBuffer) {
        tcp.write(Buffer.from(data));
      } else if (Array.isArray(data)) {
        tcp.write(Buffer.concat(data));
      } else {
        tcp.write(data);
      }
    }
  });

  // Cleanup on close
  tcp.on('close', () => {
    console.log('TCP connection closed');
    ws.close();
  });

  tcp.on('error', (err: Error) => {
    console.error('TCP error:', err.message);
    ws.close();
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    clearTimeout(idleTimer);
    tcp.destroy();
  });

  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err.message);
    clearTimeout(idleTimer);
    tcp.destroy();
  });
});
