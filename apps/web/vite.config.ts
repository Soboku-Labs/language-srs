import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Where this build will actually be served from.
 *
 * Canonical links, Open Graph URLs and the sitemap all have to be absolute —
 * a relative `og:image` is ignored, and a canonical pointing at the wrong
 * origin is worse than none. None of that can be derived at runtime, because
 * the crawler reading it may never run the script.
 *
 * Defaults to the GitHub Pages address rather than to a placeholder, so a
 * build with nothing configured is still correct for the deployment that
 * actually exists.
 */
const SITE_URL = (process.env.WEB_SITE_URL ?? 'https://soboku-labs.github.io/language-srs/').replace(
  /\/*$/,
  '/',
);

/**
 * Substitute `%SITE_URL%` in the HTML.
 *
 * Vite only replaces `%BASE_URL%` and `%VITE_*%` from the environment, and a
 * `%VITE_SITE_URL%` that nobody set ships to production as that literal string
 * inside a canonical tag. Doing it here means the fallback above applies and
 * the output always contains a real URL.
 */
function siteUrl(): Plugin {
  return {
    name: 'site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
  };
}

/**
 * The web app's build.
 *
 * `base` is set from the environment for the same reason the Expo build did:
 * GitHub Pages serves a project site from `/<repo>/`, not the domain root, so
 * every asset URL has to carry the prefix — and baking it in would break local
 * development and any other host.
 */
export default defineConfig({
  plugins: [react(), siteUrl()],
  base: process.env.WEB_BASE_URL ?? '/',
  build: {
    target: 'es2022',
    // One small app; a vendor split would cost a round trip to save nothing.
    cssCodeSplit: false,
    reportCompressedSize: true,
  },
});
