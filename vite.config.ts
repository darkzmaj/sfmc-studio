/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Dev only: serve VPKs from a local TF2 install (TF2_ROOT) with HTTP Range support so the
// app can be tested without the folder picker. Never part of production builds.
function devTf2(): Plugin {
  const root = process.env.TF2_ROOT ?? 'D:/SteamLibrary/steamapps/common/Team Fortress 2';
  return {
    name: 'sfmc-dev-tf2',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev-tf2/', (req, res) => {
        const rel = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
        if (!/^(tf|hl2)\/[\w]+\.vpk$/.test(rel)) { res.statusCode = 400; return res.end(); }
        const file = join(root, rel);
        if (!existsSync(file)) { res.statusCode = 404; return res.end(); }
        const size = statSync(file).size;
        const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range ?? '');
        if (req.method === 'HEAD' || !m) { res.setHeader('Content-Length', size); res.setHeader('Accept-Ranges', 'bytes'); return res.end(); }
        const start = Number(m[1]), end = m[2] ? Number(m[2]) : size - 1;
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        createReadStream(file, { start, end }).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devTf2()],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
