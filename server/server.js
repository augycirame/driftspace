// Driftspace game server: serves the client, runs the shared world over WebSockets, and
// persists only what players have changed on top of the procedural universe.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from './world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'world.json');
const SEED = Number(process.env.SEED) || 1337;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  let base = path.join(ROOT, 'client');
  if (rel.startsWith('/shared/')) { base = path.join(ROOT, 'shared'); rel = rel.slice('/shared'.length); }
  else if (rel.startsWith('/cc0/')) { base = path.join(ROOT, 'node_modules', '@pmndrs', 'assets'); rel = rel.slice('/cc0'.length); }
  else if (rel.startsWith('/vendor/addons/')) { base = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm'); rel = rel.slice('/vendor/addons'.length); }
  else if (rel.startsWith('/vendor/')) { base = path.join(ROOT, 'node_modules', 'three', 'build'); rel = rel.slice('/vendor'.length); }
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(base, '.' + rel);
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

export function startServer({ port = PORT, dataFile = DATA_FILE, seed = SEED, log = console.log } = {}) {
  const world = new World({ seed, dataFile, log });
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

  wss.on('connection', (ws) => {
    const conn = world.connect((msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    }, () => ws.close());
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg && typeof msg.t === 'string') world.handle(conn, msg);
    });
    ws.on('close', () => world.disconnect(conn));
  });

  world.start();
  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      log(`Driftspace running at http://localhost:${actual} (seed ${seed})`);
      resolve({
        port: actual, world,
        close: () => new Promise((r) => {
          world.stop();
          for (const c of wss.clients) c.terminate();
          wss.close();
          server.close(() => r());
          server.closeAllConnections();
        }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const handle = await startServer();
  const shutdown = async () => { await handle.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
