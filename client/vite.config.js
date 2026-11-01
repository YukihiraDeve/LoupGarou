import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const shared = fileURLToPath(new URL('../shared', import.meta.url));
const assetsDir = fileURLToPath(new URL('./public/assets', import.meta.url));

/** Files present in public/assets (relative paths), so the client never probes missing files. */
function listAssets() {
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(assetsDir, '');
  return out.sort();
}

// Serves assets/index.json live in dev (assets appear while the game runs: reload and they are used),
// and writes it into dist/ at build time.
function assetIndex() {
  return {
    name: 'lg-asset-index',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !/\/assets\/index\.json(\?|$)/.test(req.url)) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify({ files: listAssets(), generated: Date.now() }));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'assets/index.json', source: JSON.stringify({ files: listAssets(), generated: Date.now() }) });
    },
  };
}

export default defineConfig({
  base: './', // relative URLs: dist/ can be served from any folder (the game server serves it at /)
  appType: 'mpa', // no SPA fallback: a missing asset is a real 404
  resolve: { alias: { '@shared': shared } },
  plugins: [assetIndex()],
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), shared] },
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
    },
  },
  preview: { port: 5181, strictPort: true, host: true, proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true } } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined) },
    },
  },
});
