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

/*
 * robots.txt and sitemap.xml, written here rather than checked into `public/`.
 *
 * Both have to name the real origin, and the origin is only known at build
 * time — a checked-in sitemap would be wrong for every deployment but one, and
 * a sitemap listing URLs that 404 is worse for a site than no sitemap at all.
 *
 * Only the routes worth indexing. The app has screens for reviewing, for one
 * word and for settings; none of those means anything to somebody arriving
 * from a search, and several need an account, so listing them would invite
 * crawlers to spend the site's budget on soft-404s.
 */
const siteUrl = (process.env.WEB_SITE_URL ?? 'https://soboku-labs.github.io/language-srs/').replace(/\/*$/, '/');
const ROUTES = [
  { path: '', changefreq: 'weekly', priority: '1.0' },
  { path: 'upcoming', changefreq: 'weekly', priority: '0.5' },
];
const today = new Date().toISOString().slice(0, 10);

writeFileSync(
  join(distDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`,
);
console.log('  robots.txt written');

writeFileSync(
  join(distDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ROUTES.map(
      (route) =>
        `  <url>\n` +
        `    <loc>${siteUrl}${route.path}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${route.changefreq}</changefreq>\n` +
        `    <priority>${route.priority}</priority>\n` +
        `  </url>\n`,
    ).join('') +
    `</urlset>\n`,
);
console.log(`  sitemap.xml ${ROUTES.length} routes at ${siteUrl}`);

const assets = join(distDir, 'assets');
console.log(`  assets    ${existsSync(assets) ? `${readdirSync(assets).length} files` : 'MISSING'}`);
