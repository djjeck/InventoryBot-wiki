/**
 * The web app (src/web/), served locally by `npm run web:dev`. The tests run the
 * TypeScript sources directly, without Vite.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  // Relative URLs: the page works from any folder, as GitHub Pages serves it under the
  // repository's name.
  base: './',
  worker: { format: 'es' },
});
