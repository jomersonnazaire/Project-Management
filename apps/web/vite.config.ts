import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { brandPlugin } from './brandPlugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), brandPlugin()],
    css: {
      preprocessorOptions: {
        scss: {
          loadPaths: [fileURLToPath(new URL('../../node_modules', import.meta.url))],
          // Sneat 3.0 and Bootstrap 5.3 still use @import and global functions.
          quietDeps: true,
          silenceDeprecations: [
            'import',
            'global-builtin',
            'color-functions',
            'mixed-decls',
            'if-function',
          ],
        },
      },
    },
    server: {
      port: 5173,
      // Local dev: the browser talks to Vite, which proxies /api to the API, so the
      // session cookie is first-party and works over plain http.
      proxy: {
        '/api': { target: env.VITE_DEV_API_PROXY ?? 'http://localhost:4000', changeOrigin: false },
      },
    },
    build: { sourcemap: true },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      css: false,
    },
  };
});
