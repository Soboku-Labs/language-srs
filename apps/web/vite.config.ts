import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The web app's build.
 *
 * `base` is set from the environment for the same reason the Expo build did:
 * GitHub Pages serves a project site from `/<repo>/`, not the domain root, so
 * every asset URL has to carry the prefix — and baking it in would break local
 * development and any other host.
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.WEB_BASE_URL ?? '/',
  build: {
    target: 'es2022',
    // One small app; a vendor split would cost a round trip to save nothing.
    cssCodeSplit: false,
    reportCompressedSize: true,
  },
});
