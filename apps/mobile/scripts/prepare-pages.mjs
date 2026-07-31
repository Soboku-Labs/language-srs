#!/usr/bin/env node
/**
 * Post-process the static export for GitHub Pages.
 *
 * Two things Pages needs that a plain static export does not provide:
 *
 * 1. **`.nojekyll`.** Pages runs everything through Jekyll by default, and Jekyll
 *    silently drops files and directories whose names begin with an underscore.
 *    Expo puts the entire JavaScript bundle under `_expo/`, so without this file
 *    the HTML loads, the bundle 404s, and the site renders as a blank page with
 *    no error that points at the cause. This is the single most common way an
 *    Expo or Next export dies on Pages.
 *
 * 2. **`404.html`.** Expo's static export emits a real HTML file per route, and
 *    Pages resolves `/review` to `review.html`, so direct links work. But a URL
 *    that matches no file — a stale bookmark, a typo, a route added client-side —
 *    would hit Pages' default 404 page and lose the app entirely. Copying the
 *    app's own not-found page there keeps the user inside the app, where the nav
 *    can take them somewhere useful.
 *
 * Kept as a build step rather than committed files because `dist/` is generated
 * and not in version control.
 */
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distDir = process.argv[2] ?? 'dist';

if (!existsSync(distDir)) {
  console.error(`prepare-pages: "${distDir}" does not exist — run the export first.`);
  process.exit(1);
}

writeFileSync(join(distDir, '.nojekyll'), '');

// Expo Router emits `+not-found.html` for its catch-all route. Prefer it, and
// fall back to the index so there is always something to serve.
const fallbackSource = ['+not-found.html', 'index.html'].find((name) =>
  existsSync(join(distDir, name)),
);

if (!fallbackSource) {
  console.error(`prepare-pages: no index.html or +not-found.html in "${distDir}".`);
  process.exit(1);
}

copyFileSync(join(distDir, fallbackSource), join(distDir, '404.html'));

// A blank page on Pages is usually a missing bundle, so confirm it is there and
// say so plainly — this check has caught a broken export more than once.
const hasBundle = existsSync(join(distDir, '_expo'));
const routes = readdirSync(distDir).filter((name) => name.endsWith('.html'));

console.log(`prepare-pages: ${distDir}`);
console.log(`  .nojekyll written (Jekyll would otherwise drop _expo/)`);
console.log(`  404.html  from ${fallbackSource}`);
console.log(`  bundle    ${hasBundle ? 'present at _expo/' : 'MISSING — the site will render blank'}`);
console.log(`  routes    ${routes.length} (${routes.join(', ')})`);

if (!hasBundle) process.exit(1);
