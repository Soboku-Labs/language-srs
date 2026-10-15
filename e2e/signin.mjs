/**
 * The sign-in screen says what it is, and does what it says.
 *
 * The bug this was written for: pressing "Sign in" in the bar opened a page
 * headed "Create an account", with a name field and a Create account button.
 * The only way to actually sign in was to notice a line of small text
 * underneath. The authentication underneath was real the whole time — a wrong
 * password was always rejected — which is why nothing caught it: every unit
 * test of the auth passed, and the screen was still lying about where the
 * button went.
 *
 * So the assertions here are mostly about *words on screen matching the words
 * that were pressed*, which is only checkable in a browser.
 *
 * Usage — needs a server and a built web app pointed at it:
 *
 *   PORT=4060 DATA_DIR=memory npm run server &
 *   VITE_API_URL=http://127.0.0.1:4060 npm run web:vite:build
 *   npm run preview --workspace @language-srs/web -- --port 4200 &
 *   npm run e2e:signin
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';
const EMAIL = `signin-${Date.now()}@example.com`;
const PASSWORD = 'a-long-enough-password';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];
const failures = [];

async function device(label) {
  // A separate context each time, so "a browser that has never signed in" is
  // actually that rather than one carrying the last test's token.
  const page = await browser.newContext().then((c) => c.newPage());
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    /*
     * A 401 here is the system working.
     *
     * This file deliberately signs in with the wrong password twice, and
     * Chromium logs every rejected request as a console error whatever the
     * app does with it. Counting those would mean the suite failed precisely
     * because authentication worked. A 409 is the sync layer's conflict,
     * expected for the same reason.
     */
    const expected = m.text().includes('401') || m.text().includes('409');
    if (m.type() === 'error' && !expected) {
      problems.push(`[${label}] console: ${m.text()}`);
    }
  });
  return page;
}

const heading = (page) => page.locator('.section__title').first().innerText();
const hasToken = (page) => page.evaluate(() => Boolean(localStorage.getItem('srs:v1:account')));

// ------------------------------------------------ the bar says "Sign in"

const bar = await device('bar');
await bar.goto(BASE, { waitUntil: 'networkidle' });
await bar.waitForTimeout(700);
await bar.locator('.topbar__account').click();
await bar.waitForTimeout(600);

const barHeading = await heading(bar);
const barButton = await bar.locator('.button').first().innerText();
const barHasName = (await bar.locator('input[name="displayName"]').count()) > 0;
console.log(`bar "Sign in" -> "${barHeading}" / button "${barButton}" / name field: ${barHasName}`);

if (!/sign in/i.test(barHeading)) {
  failures.push(`pressing "Sign in" opened "${barHeading}" instead of a sign-in form`);
}
if (!/sign in/i.test(barButton)) {
  failures.push(`pressing "Sign in" offered a "${barButton}" button`);
}
if (barHasName) {
  failures.push('the sign-in form is asking for a name, which only a new account needs');
}

/*
 * Stop here if the entry point is wrong.
 *
 * Everything below assumes the screen opens in sign-in mode — it fills a
 * sign-in form, presses a Sign in button, and reads the error under it. If
 * that assumption is already broken there is nothing useful left to measure,
 * and carrying on produces a missing-selector crash instead of the verdict
 * that says which assertion failed.
 */
if (failures.length > 0) {
  console.log('\n================ VERDICT ================');
  console.log('FAILED');
  for (const failure of failures) console.log(' -', failure);
  await browser.close();
  process.exit(1);
}

/*
 * Make the account the rest of the run uses.
 *
 * The toggle is only there when the screen opened in sign-in mode, which is
 * the thing being asserted above. Clicking it unconditionally meant that when
 * the bug came back the suite died on a missing selector instead of printing
 * which assertion failed — a regression test that crashes tells you less than
 * one that reports.
 */
const toggle = bar.getByText('Create an account instead');
if (await toggle.count()) {
  await toggle.click();
  await bar.waitForTimeout(300);
}
const nameField = bar.locator('input[name="displayName"]');
if (await nameField.count()) await nameField.fill('Vish');
await bar.locator('input[name="email"]').fill(EMAIL);
await bar.locator('input[name="password"]').fill(PASSWORD);
await bar.getByRole('button', { name: 'Create account' }).click();
await bar.waitForTimeout(3000);
if (!(await hasToken(bar))) failures.push('creating an account through the toggle did not sign anybody in');

// -------------------------------- a locked feature offers to create one

const locked = await device('locked');
await locked.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
await locked.waitForTimeout(700);
await locked.locator('.locked').first().getByText('Create an account').click();
await locked.waitForTimeout(600);

const lockedHeading = await heading(locked);
console.log(`locked feature -> "${lockedHeading}" at ${locked.url().replace(BASE, '')}`);
if (!/create/i.test(lockedHeading)) {
  failures.push(`"Create an account" opened "${lockedHeading}" instead of a sign-up form`);
}

// And it must put you back where you were, not at the front door.
await locked.getByText('I already have an account').click();
await locked.waitForTimeout(300);
await locked.locator('input[name="email"]').fill(EMAIL);
await locked.locator('input[name="password"]').fill(PASSWORD);
await locked.getByRole('button', { name: 'Sign in' }).click();
await locked.waitForTimeout(3500);

const returnedTo = locked.url().replace(BASE, '');
const importUsable = (await locked.locator('textarea').count()) > 0;
console.log(`after signing in from /import -> ${returnedTo}, import usable: ${importUsable}`);
if (!returnedTo.startsWith('/import')) {
  failures.push(`signing in from /import returned to ${returnedTo} rather than to /import`);
}
if (!importUsable) failures.push('the feature is still locked after signing in');

// ------------------------------------------- the password actually matters

const wrong = await device('wrong');
await wrong.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await wrong.waitForTimeout(400);
await wrong.locator('input[name="email"]').fill(EMAIL);
await wrong.locator('input[name="password"]').fill('not-the-right-password');
await wrong.getByRole('button', { name: 'Sign in' }).click();
await wrong.waitForTimeout(2500);

const shown = (await wrong.locator('.form-error').count())
  ? await wrong.locator('.form-error').innerText()
  : '';
const letIn = await hasToken(wrong);
console.log(`wrong password -> "${shown || 'no message'}", signed in: ${letIn}`);
if (letIn) failures.push('a wrong password signed somebody in');
if (!shown) failures.push('a wrong password was rejected silently');

// An unknown email must not be distinguishable from a wrong password, or the
// form becomes a way to find out who has an account here.
await wrong.locator('input[name="email"]').fill(`nobody-${Date.now()}@example.com`);
await wrong.locator('input[name="password"]').fill(PASSWORD);
await wrong.getByRole('button', { name: 'Sign in' }).click();
await wrong.waitForTimeout(2500);
const unknown = (await wrong.locator('.form-error').count())
  ? await wrong.locator('.form-error').innerText()
  : '';
console.log(`unknown email  -> "${unknown || 'no message'}"`);
if (unknown !== shown) {
  failures.push(`an unknown email says "${unknown}" but a wrong password says "${shown}" — the form tells a stranger which emails are registered`);
}

// -------------------------------------------------------------- verdict

console.log('\n================ VERDICT ================');
if (problems.length > 0) failures.push(`page errors:\n  ${problems.join('\n  ')}`);

if (failures.length > 0) {
  console.log('FAILED');
  for (const failure of failures) console.log(' -', failure);
} else {
  console.log('PASSED — the buttons go where they say, and the password matters.');
}

await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
