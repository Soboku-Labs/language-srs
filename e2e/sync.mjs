/**
 * Two browsers, one account, one server.
 *
 * Study on the laptop; expect the phone to know, and expect neither side's
 * reviews to be lost when both have studied from the same revision.
 *
 * This runs in a real browser because the bug it was written for could not be
 * seen anywhere else. Signing in changes which slice of storage the engine
 * reads, and the engine for the new slice is built asynchronously — so for one
 * commit the sync provider held the new account and the previous engine. It
 * pushed the old engine's state while recording the revision against the new
 * account's storage, after which that account's empty deck agreed with the
 * server's revision and overwrote it. Five reviews became zero, silently, on
 * the second device anyone signed in on.
 *
 * No unit test would have caught it: every individual piece was correct, and
 * the fault was in the order two providers' effects flush. Hence a browser, two
 * contexts, and assertions on the numbers rather than on the code.
 *
 * Usage — needs a server and a built web app pointed at it:
 *
 *   PORT=4060 DATA_DIR=memory npm run server &
 *   VITE_API_URL=http://127.0.0.1:4060 npm run web:vite:build
 *   npm run preview --workspace @language-srs/web -- --port 4200 &
 *   npm run e2e:sync
 *
 * `DATA_DIR=memory` keeps the accounts this test registers out of a real
 * `.data` directory; it registers a fresh one on every run.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';
const API = process.argv[3] ?? 'http://127.0.0.1:4060';
const EMAIL = `web-${Date.now()}@example.com`;
const PASSWORD = 'a-long-enough-password';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];

async function device(label) {
  // A separate context is a separate localStorage, which is what makes these two
  // genuinely different browsers rather than two tabs.
  const page = await browser.newContext().then((c) => c.newPage());
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    // A 409 is this design working: the server refusing a write from a device
    // that has fallen behind, so the client merges instead of overwriting.
    // Chromium logs every one as a failed resource whatever the app does with
    // it, so counting those as problems would hide the real ones.
    const expected = m.text().includes('409');
    if (m.type() === 'error' && !expected) problems.push(`[${label}] console: ${m.text()}`);
  });
  return page;
}

async function signIn(page, { register }) {
  /*
   * The route says which of the two this is.
   *
   * This used to open `/sign-in` and then click "I already have an account",
   * because the screen opened on Create an account however you arrived —
   * which was the bug: the "Sign in" button in the bar led to a sign-up form.
   * Now `?new=1` means make one and a bare `/sign-in` means sign in, so the
   * toggle is no longer part of the path either test takes.
   */
  await page.goto(`${BASE}/sign-in${register ? '?new=1' : ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  if (register) await page.locator('input[autocomplete="name"]').fill('Vish');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: register ? 'Create account' : 'Sign in' }).click();
  await page.waitForTimeout(3000);
  return page.url();
}

/** Study `n` cards, whatever each one asks for. */
async function study(page, n) {
  await page.goto(`${BASE}/review`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  let graded = 0;
  for (let i = 0; i < n * 4 && graded < n; i += 1) {
    const good = page.getByText(/^Good/).first();
    if (await good.count()) { await good.click(); graded += 1; await page.waitForTimeout(260); continue; }
    const options = page.locator('button.option:not([disabled])');
    if (await options.count()) { await options.nth(0).click(); await page.waitForTimeout(260); continue; }
    const carryOn = page.locator('button.button:not([disabled])');
    if (await carryOn.count() && !(await page.locator('.says').count())) {
      await carryOn.first().click(); graded += 1; await page.waitForTimeout(260); continue;
    }
    break;
  }
  return graded;
}

/**
 * The review log this browser holds, per storage slice.
 *
 * Every key ending `:logs`, not the first one found — the bug this test caught
 * was reviews landing in the pre-sign-in slice while the account's own slice
 * stayed empty, and a reader that stops at the first match cannot see that.
 */
const localReviews = (page) =>
  page.evaluate(() => {
    const slices = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.endsWith(':logs')) {
        slices[key] = JSON.parse(localStorage.getItem(key) ?? '[]').length;
      }
    }
    return slices;
  });

/** The account's own slice, which is the one that must hold the reviews. */
const accountReviews = async (page) => {
  const slices = await localReviews(page);
  const owned = Object.entries(slices).find(([key]) => key.startsWith('acct:'));
  return owned ? owned[1] : 0;
};

const serverReviews = async (token) => {
  const response = await fetch(`${API}/state`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  const raw = body.values?.['srs:v1:logs'];
  return { revision: body.revision, reviews: raw ? JSON.parse(raw).length : 0 };
};

const tokenOf = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('srs:v1:account');
    return raw ? JSON.parse(raw).token : undefined;
  });

// ------------------------------------------------------------------ laptop

const laptop = await device('laptop');
console.log('laptop lands on:', await signIn(laptop, { register: true }));

const laptopGraded = await study(laptop, 5);
console.log(`laptop studied ${laptopGraded} cards`);
// The debounced push is 4s.
await laptop.waitForTimeout(7000);

const token = await tokenOf(laptop);
console.log('laptop slices     :', JSON.stringify(await localReviews(laptop)));
console.log('on the server      :', JSON.stringify(await serverReviews(token)));

// ------------------------------------------------------------------- phone

const phone = await device('phone');
console.log('\nphone lands on:', await signIn(phone, { register: false }));
await phone.waitForTimeout(4000);

console.log('phone slices after signing in:', JSON.stringify(await localReviews(phone)));

// -------------------------------------------------- both study, then merge

const phoneGraded = await study(phone, 3);
console.log(`\nphone studied ${phoneGraded} more`);
console.log('  phone account slice immediately :', await accountReviews(phone));
await phone.waitForTimeout(7000);
console.log('  phone slices after its push     :', JSON.stringify(await localReviews(phone)));
console.log('  server after its push         :', JSON.stringify(await serverReviews(token)));

// The laptop studies again from its now-stale revision, forcing a conflict.
const laptopMore = await study(laptop, 3);
await laptop.waitForTimeout(8000);
console.log(`laptop studied ${laptopMore} more from a stale revision`);

const final = await serverReviews(token);
console.log('server after the conflict:', JSON.stringify(final));

const expected = laptopGraded + phoneGraded + laptopMore;
const phoneOwn = await accountReviews(phone);
const laptopOwn = await accountReviews(laptop);
const strayPhone = Object.keys(await localReviews(phone)).filter((key) => !key.startsWith('acct:'));

console.log('\n================ VERDICT ================');
console.log('reviews studied across both browsers:', expected);
console.log('reviews on the server               :', final.reviews);
console.log("phone's own account slice           :", phoneOwn);
console.log("laptop's own account slice          :", laptopOwn);

const failures = [];
if (laptopGraded === 0 || phoneGraded === 0) failures.push('a browser graded nothing — the test proved nothing');
if (final.reviews < expected) failures.push(`the server has ${final.reviews} of ${expected} reviews — reviews were lost`);
// The phone's own slice must hold everything it studied. If it does not, the
// account's storage is not where its reviews went, which is the failure mode
// this test exists for.
if (phoneOwn < phoneGraded) failures.push(`the phone's account slice holds ${phoneOwn} but it studied ${phoneGraded}`);
if (laptopOwn < laptopGraded + laptopMore) {
  failures.push(`the laptop's account slice holds ${laptopOwn} but it studied ${laptopGraded + laptopMore}`);
}
// Reviews in an unprefixed slice after signing in mean they were written for
// nobody: no account owns them and no sync will ever carry them.
if (strayPhone.length > 0) failures.push(`reviews outside the account's slice: ${strayPhone.join(', ')}`);
// The unsaved-work warning is the loudest thing in the app. It appearing during
// an ordinary session would be crying wolf, which costs more than it is worth.
for (const [label, device] of [['laptop', laptop], ['phone', phone]]) {
  if ((await device.locator('.alert').count()) > 0) {
    failures.push(`the ${label} is showing the storage warning during a normal session`);
  }
}
if (problems.length > 0) failures.push(`page errors:\n  ${problems.join('\n  ')}`);

console.log(failures.length === 0 ? '\nPASS' : `\nFAIL\n- ${failures.join('\n- ')}`);

await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
