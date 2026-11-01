// Production (pm2): the game server listens locally only; Apache serves client/dist and relays
// /socket.io (deploy/loupgarou.imgnlab.dev.conf).
module.exports = {
  apps: [
    {
      name: 'loupgarou',
      script: 'server/src/main.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: 3110, LOG_LEVEL: 'info' },
      max_memory_restart: '300M',
    },
  ],
};
