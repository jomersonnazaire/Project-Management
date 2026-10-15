import type { Plugin } from 'vite';
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '../../packages/shared/src/brand';

/**
 * Branding at build time: the browser tab title and the web manifest take the app name from
 * packages/shared/src/brand.ts, so the rename stays a one-line change there.
 */
export function manifestJson() {
  return JSON.stringify(
    {
      name: APP_NAME,
      short_name: APP_SHORT_NAME,
      description: `${APP_NAME} ${APP_TAGLINE}`,
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#5355e0',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    null,
    2,
  );
}

export function brandPlugin(): Plugin {
  return {
    name: 'xc8-brand',
    transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifestJson());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifestJson() });
    },
  };
}
