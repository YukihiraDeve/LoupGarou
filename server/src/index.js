// Entry point: HTTP server (static client/dist + /healthz) and socket.io game server.
// Env: PORT (3001), HOST (0.0.0.0), SPEED (timer multiplier, e.g. 0.2 for quick tests),
//      STATIC_DIR (default ../client/dist), LOG_LEVEL (debug|info|warn|error|silent).
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { PROTOCOL_VERSION } from '../../shared/protocol.js';
import { RoomManager } from './net/rooms.js';
import { createStaticHandler } from './net/static.js';
import { logger, setLogLevel } from './log.js';

const log = logger('server');
const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATIC_DIR = path.resolve(here, '../../client/dist');

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>Loup-Garou</title>
<body style="font-family:system-ui;background:#1b1410;color:#f3e6d0;padding:2rem">
<h1>Serveur Loup-Garou en marche</h1>
<p>Le client n'est pas construit : lancez <code>npm run build</code> dans <code>client/</code>,
ou utilisez le serveur de développement Vite (port 5180).</p></body>`;

/**
 * Start the game server. Resolves to { port, host, url, io, httpServer, manager, close() }.
 * @param {{port?:number, host?:string, speed?:number, staticDir?:string|null, logLevel?:string,
 *          rooms?:object}} opts  rooms: RoomManager options (ttl, grace delays...)
 */
export async function startServer(opts = {}) {
  if (opts.logLevel) setLogLevel(opts.logLevel);
  const port = opts.port ?? 3001;
  const host = opts.host ?? '0.0.0.0';
  const speed = opts.speed > 0 ? opts.speed : 1;
  const staticDir = opts.staticDir === undefined ? DEFAULT_STATIC_DIR : opts.staticDir;
  const serveStatic = staticDir && existsSync(staticDir) ? createStaticHandler(staticDir) : null;
  const manager = new RoomManager({ speedFactor: speed, ...(opts.rooms || {}) });
  const startedAt = Date.now();

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      if (url === '/healthz' || url.startsWith('/healthz?')) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: true, v: PROTOCOL_VERSION, rooms: manager.rooms.size, uptime: Math.round((Date.now() - startedAt) / 1000) }));
        return;
      }
      if (serveStatic && await serveStatic(req, res)) return;
      if (!serveStatic && (url === '/' || url.startsWith('/?'))) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(NOT_BUILT);
        return;
      }
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Introuvable');
    } catch (err) {
      log.error('http:', err);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  });

  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 32 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  manager.attachIo(io);

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => { httpServer.off('error', reject); resolve(); });
  });
  const actual = httpServer.address().port;
  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    manager.close();
    await new Promise((resolve) => io.close(() => resolve()));
    httpServer.closeAllConnections?.();
  }

  return { port: actual, host, url: `http://${shownHost}:${actual}`, io, httpServer, manager, close, speed, staticDir: serveStatic ? staticDir : null };
}

// CLI ---------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('uncaughtException', (err) => log.error('exception non attrapée :', err));
  process.on('unhandledRejection', (err) => log.error('promesse rejetée :', err));
  const port = Number(process.env.PORT) || 3001;
  const host = process.env.HOST || '0.0.0.0';
  const speed = Number(process.env.SPEED) || 1;
  const staticDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : undefined;
  startServer({ port, host, speed, staticDir }).then((srv) => {
    log.info(`Loup-Garou prêt sur ${srv.url} (écoute ${host}:${srv.port}, vitesse x${speed}, client : ${srv.staticDir ?? 'non construit'})`);
    const stop = (sig) => {
      log.info(`${sig} reçu, arrêt…`);
      srv.close().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  }).catch((err) => {
    log.error('démarrage impossible :', err);
    process.exit(1);
  });
}
