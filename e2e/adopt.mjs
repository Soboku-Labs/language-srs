/**
 * A device profile's deck comes with you when you make an account.
 *
 * An account reads its deck from its own storage prefix, so without
 * deliberate handling earlier studying stops being visible the moment
 * somebody signs in — still on disk, under a prefix nothing looks at, which
 * to the person who did the studying is indistinguishable from having been
 * deleted by signing in. Measured before the fix: four cards studied, zero in
 * the account.
 *
 * The route in has changed. Studying now needs an account, so nobody can
 * study first and sign in later on a build with a server — but a device
 * profile can still exist: made on a build published without an API, and
 * still in the browser when one is configured. That learner is sent to the
 * sign-up form, and what they did must survive it.
 *
 * So the profile and its deck are planted directly rather than studied in the
 * browser, because the sequence that used to create them is gone. What is
 * being tested is `adoptDeck`, which is unchanged and still the only thing
 * standing between that learner and a deck that looks deleted.
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

// ------------------------------- a device profile, from before there was an API

/*
 * Planted rather than studied.
 *
 * The sequence that used to produce this — open the app, pick a language,
 * study, sign in later — cannot happen on a build with a server any more, so
 * reproducing it through the UI is impossible. What can still happen is
 * arriving with one of these already in the browser, which is exactly what
 * this writes: an account record with no token, and a deck under its prefix.
 */
const PLANTED = 4;

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(600);

await page.evaluate((count) => {
  const id = 'device-from-before';
  localStorage.setItem(
    'srs:v1:account',
    JSON.stringify({ id, displayName: 'This device', createdAt: new Date().toISOString() }),
  );

  // Enough of a deck to be worth not losing: logs are what the assertions
  // count, and cards are what `adoptDeck` checks before deciding the target
  // is empty.
  const logs = Array.from({ length: count }, (_, index) => ({
    id: `log-${index}`,
    cardId: `zh-nihao:recognition`,
    reviewedAt: new Date().toISOString(),
    rating: 3,
    stateBefore: 'new',
    stateAfter: 'learning',
    source: 'app',
  }));
  localStorage.setItem(`acct:${id}:srs:v1:logs`, JSON.stringify(logs));
  localStorage.setItem(
    `acct:${id}:srs:v1:cards`,
    JSON.stringify([{ id: 'zh-nihao:recognition', entryId: 'zh-nihao', kind: 'recognition', levelId: 'hsk3-1', reps: 1 }]),
  );
}, PLANTED);

const graded = PLANTED;
console.log(`planted a device profile holding ${graded} reviews`);
console.log('slices before signing up:', JSON.stringify(await slices()));

// ------------------------------------------------------------- then sign in

// `?new=1`: this test creates an account, and a bare /sign-in is now the
// sign-in form rather than the sign-up one.
await page.goto(`${BASE}/sign-in?new=1`, { waitUntil: 'load' });
await page.locator('input[name="displayName"]').fill('Vish');
await page.locator('input[name="email"]').fill(EMAIL);
await page.locator('input[name="password"]').fill(PASSWORD);
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
