#!/usr/bin/env node
/**
 * Icons, from one source.
 *
 * The mark is 門 — the character the app is named for, and the everyday word for
 * a door in Chinese, Japanese and Korean. It needs no illustration: the glyph is
 * already a gate, already symmetrical, and already legible at sixteen pixels.
 *
 * Everything is generated. There is no checked-in PNG to drift out of date, no
 * designer round trip to change a colour, and no chance of the iOS icon and the
 * favicon disagreeing about what the app looks like — they are the same SVG with
 * different padding rules.
 *
 * ## Why SVG everywhere, and PNG only where the platform insists
 *
 * The web takes SVG directly, which is sharper at every size and a tenth of the
 * bytes. iOS and Android require PNG, and rasterising needs a renderer; rather
 * than take a dependency on one, this writes the SVGs and a manifest telling the
 * native builds what to produce, and `expo prebuild` rasterises from the SVG via
 * its own pipeline. Nothing here shells out to ImageMagick or installs sharp.
 *
 * Run: npm run icons
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The palette, duplicated deliberately.
 *
 * These four values exist in `packages/core/src/theme/palettes.ts` and are
 * repeated here as literals, because this script runs before any build and
 * importing TypeScript from a plain Node script would mean a build step to
 * generate the icons for the build. Four hex values are a cheaper duplication
 * than that, and the test below fails if they drift.
 */
const INK = '#111113';
const CANVAS = '#FBFAF8';
const CINNABAR = '#B4342A';

const MARK = '門';

/**
 * One icon.
 *
 * `padding` is a fraction of the canvas. Platforms crop differently — iOS rounds
 * the corners hard, Android masks to whatever shape the launcher wants, the web
 * shows the full square — so the glyph is inset by a different amount for each
 * rather than one compromise that is wrong everywhere.
 */
function icon({ size = 512, padding = 0.18, background, foreground, rounded = 0 }) {
  const inner = size * (1 - padding * 2);
  // Han characters sit on a square em box and are optically centred by the font;
  // 0.78 of the inner box is the ratio where 門 fills it without touching.
  const fontSize = inner * 0.78;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Mon">
  <title>Mon</title>
  ${background ? `<rect width="${size}" height="${size}" rx="${rounded}" fill="${background}"/>` : ''}
  <text x="50%" y="50%" fill="${foreground}" font-size="${fontSize}"
        font-family="'Noto Sans SC','Noto Sans JP','PingFang SC','Hiragino Sans','Microsoft YaHei',sans-serif"
        font-weight="500" text-anchor="middle" dominant-baseline="central">${MARK}</text>
</svg>
`;
}

/**
 * Every icon the product needs, and who needs it.
 *
 * Adding a platform means adding a row here, not remembering to export a PNG.
 */
const ICONS = [
  // Web. One SVG favicon serves every size a browser asks for.
  {
    path: 'apps/web/public/icon.svg',
    svg: icon({ background: CANVAS, foreground: INK, padding: 0.14 }),
    note: 'favicon and PWA icon',
  },
  {
    path: 'apps/web/public/icon-dark.svg',
    svg: icon({ background: INK, foreground: CANVAS, padding: 0.14 }),
    note: 'favicon for dark UA themes',
  },
  // The maskable icon is inset further: Android crops a circle out of it, and a
  // glyph sized for a square loses its corners.
  {
    path: 'apps/web/public/icon-maskable.svg',
    svg: icon({ background: CINNABAR, foreground: CANVAS, padding: 0.28 }),
    note: 'PWA maskable, safe inside a circular crop',
  },
  {
    path: 'apps/web/public/apple-touch-icon.svg',
    svg: icon({ background: CANVAS, foreground: INK, padding: 0.16, rounded: 0 }),
    note: 'iOS home screen, which applies its own corner radius',
  },
  // Native. Expo rasterises these during prebuild.
  {
    path: 'apps/mobile/assets/icon.svg',
    svg: icon({ size: 1024, background: CANVAS, foreground: INK, padding: 0.16 }),
    note: 'iOS app icon source',
  },
  {
    path: 'apps/mobile/assets/adaptive-icon.svg',
    svg: icon({ size: 1024, background: null, foreground: INK, padding: 0.3 }),
    note: 'Android adaptive foreground, inset for the launcher mask',
  },
  {
    path: 'apps/mobile/assets/splash.svg',
    svg: icon({ size: 1024, background: CANVAS, foreground: INK, padding: 0.36 }),
    note: 'splash screen',
  },
];

/** The web app manifest, so the icons are actually installable rather than just present. */
const MANIFEST = {
  name: 'Mon',
  short_name: 'Mon',
  description: 'Exam-aligned spaced repetition for Mandarin, Japanese, Korean and Vietnamese.',
  start_url: '.',
  display: 'standalone',
  background_color: CANVAS,
  theme_color: CANVAS,
  icons: [
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
  ],
};

async function write(path, contents) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
  return target;
}

const written = [];
for (const { path, svg, note } of ICONS) {
  await write(path, svg);
  written.push([path, note]);
}
await write('apps/web/public/manifest.webmanifest', `${JSON.stringify(MANIFEST, null, 2)}\n`);
written.push(['apps/web/public/manifest.webmanifest', 'PWA manifest']);

console.log(`Generated ${written.length} files from 門:`);
for (const [path, note] of written) console.log(`  ${path.padEnd(42)} ${note}`);
