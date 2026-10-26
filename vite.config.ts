/**
 * The web app (src/web/): `npm run web:dev` serves it locally, `npm run web:build` builds
 * it into web-dist/ (published on GitHub Pages by .github/workflows/ci.yml), and
 * `npm run web:preview` serves the build. The tests run the TypeScript sources directly,
 * without Vite.
 */
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/**
 * The built page may load only its own files, and Google Fonts' stylesheet and font files,
 * and may not connect anywhere: the exports are read and processed in the browser, and
 * this makes the browser enforce that nothing is sent (the font requests carry no data of
 * the player's). Styles allow inline `style` attributes, which the wiki view writes. Only
 * in the build: the dev server needs inline scripts and a WebSocket.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ command }) => ({
  root: 'src/web',
  // The build of the page, with which the worker saves its results: those of another
  // build are built again. A release's version; under the dev server, a new value at
  // each start, as the code may have changed with the same version.
  define: {
    __BUILD__: JSON.stringify(command === 'build' ? version : `${version}+dev.${Date.now()}`),
  },
  // Relative URLs: the page works from any folder, as GitHub Pages serves it under the
  // repository's name.
  base: './',
  build: {
    outDir: '../../web-dist',
    emptyOutDir: true,
    // No polyfill: it would fetch the preloaded modules, which the policy forbids.
    modulePreload: { polyfill: false },
  },
  worker: { format: 'es' },
  plugins: [contentSecurityPolicy()],
}));
