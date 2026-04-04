import { WebSocketServer, WebSocket } from 'ws';
import * as net from 'node:net';

const WS_PORT = parseInt(process.env['WS_PORT'] ?? '8090', 10);
const OT_HOST = process.env['OT_HOST'] ?? '127.0.0.1';
const OT_LOGIN_PORT = parseInt(process.env['OT_LOGIN_PORT'] ?? '7171', 10);
const OT_GAME_PORT = parseInt(process.env['OT_GAME_PORT'] ?? '7172', 10);

const wss = new WebSocketServer({ port: WS_PORT });

console.log(`WebSocket proxy listening on ws://0.0.0.0:${WS_PORT}`);
console.log(`Forwarding to OT server at ${OT_HOST}:${OT_LOGIN_PORT} (login) / ${OT_GAME_PORT} (game)`);

wss.on('connection', (ws: WebSocket, req) => {
  // Determine target port from URL path: /login or /game
  const path = req.url ?? '/login';
  const targetPort = path.includes('game') ? OT_GAME_PORT : OT_LOGIN_PORT;

  console.log(`New connection → ${OT_HOST}:${targetPort} (${path})`);

  const tcp = net.createConnection({ host: OT_HOST, port: targetPort });

  tcp.on('connect', () => {
    console.log(`TCP connected to ${OT_HOST}:${targetPort}`);
  });

  // Forward TCP → WebSocket
  tcp.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Forward WebSocket → TCP
  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
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
    tcp.destroy();
  });

  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err.message);
    tcp.destroy();
  });
});
