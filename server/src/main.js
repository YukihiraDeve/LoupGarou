// CLI entry point (npm start, pm2): always starts the server. Kept apart from index.js so that
// importing startServer (tests) never listens, without relying on process.argv[1] (pm2 wraps it).
import path from 'node:path';
import { startServer } from './index.js';
import { logger } from './log.js';

const log = logger('server');

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
