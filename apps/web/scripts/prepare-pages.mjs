#!/usr/bin/env node
/**
 * Post-process the Vite build for GitHub Pages.
 *
 * The router uses real paths rather than hashes, so a direct link to `/stats`
 * asks Pages for a file that does not exist. Pages has no rewrite rules, but it
 * does serve `404.html` for anything unmatched — so copying the app's own
 * `index.html` there makes every deep link boot the app, which then reads the
 * path and renders the right screen.
 *
 * `.nojekyll` is belt and braces. Vite emits `assets/`, which Jekyll leaves
 * alone, but a future asset directory beginning with an underscore would be
 * silently dropped and the failure looks like a blank page with no cause.
 */
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distDir = process.argv[2] ?? 'dist';

if (!existsSync(distDir)) {
  console.error(`prepare-pages: "${distDir}" does not exist — run the build first.`);
  process.exit(1);
}

const index = join(distDir, 'index.html');
if (!existsSync(index)) {
  console.error(`prepare-pages: no index.html in "${distDir}".`);
  process.exit(1);
}

console.log(`prepare-pages: ${distDir}`);

writeFileSync(join(distDir, '.nojekyll'), '');
console.log('  .nojekyll written');

copyFileSync(index, join(distDir, '404.html'));
console.log('  404.html  from index.html, so deep links boot the app');

const assets = join(distDir, 'assets');
console.log(`  assets    ${existsSync(assets) ? `${readdirSync(assets).length} files` : 'MISSING'}`);
