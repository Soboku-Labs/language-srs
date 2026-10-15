/**
 * Study first, sign in afterwards. Does the work come with you?
 *
 * Nothing stands between a visitor and studying, so the ordinary path is to
 * try the app and sign in once it is worth keeping. An account reads its deck
 * from its own storage prefix, which means without deliberate handling that
 * earlier studying simply stops being visible the moment somebody signs in —
 * still on disk, under a prefix nothing looks at, which to the person who did
 * the studying is indistinguishable from having been deleted by signing in.
 *
 * Measured before the fix: four cards studied, zero in the account.
 *
 * Usage — needs a server and a built web app pointed at it:
 *
 *   PORT=4060 DATA_DIR=memory npm run server &
 *   VITE_API_URL=http://127.0.0.1:4060 npm run web:vite:build
 *   npm run preview --workspace @language-srs/web -- --port 4200 &
 *   npm run e2e:adopt
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';
const API = process.argv[3] ?? 'http://127.0.0.1:4060';
const EMAIL = `adopt-${Date.now()}@example.com`;
const PASSWORD = 'a-long-enough-password';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newContext().then((c) => c.newPage());
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('409')) problems.push(`console: ${m.text().slice(0, 120)}`);
});

/** Review logs per storage slice, so it is clear *where* the work ended up. */
const slices = () =>
  page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.endsWith(':logs')) out[key] = JSON.parse(localStorage.getItem(key) || '[]').length;
    }
    return out;
  });

const accountReviews = async () => {
  const found = Object.entries(await slices()).find(([key]) => key.startsWith('acct:'));
  return found ? found[1] : 0;
};

// ------------------------------------------------- study without an account

await page.goto(BASE, { waitUntil: 'load' });
await page.locator('.place').first().click();
await page.waitForTimeout(500);
await page.goto(`${BASE}/review`, { waitUntil: 'load' });

let graded = 0;
for (let i = 0; i < 4; i += 1) {
  const options = page.locator('button.option:not([disabled])');
  if ((await options.count()) === 0) break;
  await options.nth(0).click();
  await page.waitForTimeout(220);
  // A wrong answer offers "Got it"; a correct one offers the rating row.
  const commit = page.locator('button.button, button.grade').first();
  if ((await commit.count()) === 0) break;
  await commit.click();
  graded += 1;
  await page.waitForTimeout(250);
}
console.log(`studied ${graded} cards without an account`);
console.log('slices before signing in:', JSON.stringify(await slices()));

// ------------------------------------------------------------- then sign in

await page.goto(`${BASE}/sign-in`, { waitUntil: 'load' });
await page.locator('input[autocomplete="name"]').fill('Vish');
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForTimeout(5000);

const inAccount = await accountReviews();
console.log('slices after signing in :', JSON.stringify(await slices()));

// The browser keeping it is half the promise; the account keeping it is the
// other half, and only the server can answer that.
await page.waitForTimeout(6000);
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('srs:v1:account') || '{}').token);
const response = await fetch(`${API}/state`, { headers: { Authorization: `Bearer ${token}` } });
const body = await response.json();
const onServer = body.values?.['srs:v1:logs'] ? JSON.parse(body.values['srs:v1:logs']).length : 0;

console.log('\n================ VERDICT ================');
console.log('studied before signing in :', graded);
console.log("in the account's own slice:", inAccount);
console.log('on the server             :', onServer);

const failures = [];
if (graded === 0) failures.push('nothing was studied — the test proved nothing');
if (inAccount < graded) failures.push(`the account holds ${inAccount} of ${graded} — signing in lost work`);
if (onServer < graded) failures.push(`the server holds ${onServer} of ${graded} — it never left the browser`);
if (problems.length > 0) failures.push(`page errors:\n  ${problems.join('\n  ')}`);

console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n- ${failures.join('\n- ')}`);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
