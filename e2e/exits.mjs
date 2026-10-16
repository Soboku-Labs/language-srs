/**
 * Every screen has a way out.
 *
 * `/write` did not. It was never added to the route-title table — the edit
 * that was supposed to add it targeted a one-line row that had already been
 * reformatted, so it silently did nothing — and with no entry there is no
 * header, which means no title and no back arrow. Nothing else on that screen
 * offered an exit either, so the writing app was a page you could reach and
 * not leave except by the browser's own back button.
 *
 * Reading the table does not catch that; the table looked fine, because what
 * was wrong with it was an absence. So this walks the routes and asserts that
 * each one puts something on screen that leads somewhere else.
 *
 * Usage — needs a server and a built web app pointed at it:
 *
 *   PORT=4060 DATA_DIR=memory npm run server &
 *   VITE_API_URL=http://127.0.0.1:4060 npm run web:vite:build
 *   npm run preview --workspace @language-srs/web -- --port 4200 &
 *   npm run e2e:exits
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';

/**
 * The routes a learner reaches, and what counts as the way out of each.
 *
 * `/` is the door and has nowhere above it. `/review` is the loop and ends
 * itself. Everything else is somewhere you went *into* and must be able to
 * come back out of.
 */
const ROUTES = [
  '/home',
  '/review',
  '/learn',
  '/words',
  '/stats',
  '/settings',
  '/import',
  '/write',
  '/upcoming',
  '/start',
];

/** Words that mean "leave". `‹` is the chrome's back arrow. */
const WAY_OUT = /^(‹|all languages|back|done|home|leave|skip|choose a different)/i;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];
const failures = [];

const page = await browser.newContext({ viewport: { width: 1000, height: 900 } }).then((c) => c.newPage());
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/40[19]/.test(m.text())) problems.push(`console: ${m.text()}`);
});

// The demo, so every screen renders with real content rather than as a lock.
await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByText('Look around with a demo first').click();
await page.waitForFunction(
  () => {
    const raw = localStorage.getItem('srs:v1:account');
    return raw && JSON.parse(raw).demo === true;
  },
  { timeout: 30_000 },
);
await page.waitForTimeout(1200);

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const labels = (await page.locator('button, a').allInnerTexts())
    .map((text) => text.trim().split('\n')[0].trim())
    .filter(Boolean);
  const exits = labels.filter((label) => WAY_OUT.test(label));

  console.log(`${route.padEnd(11)} ${exits.length ? exits.join(' / ') : 'NO WAY OUT'}`);
  if (exits.length === 0) {
    failures.push(`${route} has nothing on it that leads anywhere else — it can be reached and not left`);
  }
}

console.log('\n================ VERDICT ================');
if (problems.length > 0) failures.push(`page errors:\n  ${problems.join('\n  ')}`);

if (failures.length > 0) {
  console.log('FAILED');
  for (const failure of failures) console.log(' -', failure);
} else {
  console.log('PASSED — every screen can be left.');
}

await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
