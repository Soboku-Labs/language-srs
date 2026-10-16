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
/**
 * Whether this browser holds an account record of any kind.
 *
 * Not the same as holding a bearer token: a device profile and the demo both
 * store a record and neither has one. This was called `hasToken`, which is
 * what it looked like it meant, and the demo assertion below read it as "has
 * credentials" and failed on a correct implementation.
 */
const hasAccountRecord = (page) =>
  page.evaluate(() => Boolean(localStorage.getItem('srs:v1:account')));

/** Whether there is an actual bearer token — i.e. an account on a server. */
const hasBearerToken = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('srs:v1:account');
    return raw ? Boolean(JSON.parse(raw).token) : false;
  });

// ------------------------------------------------ the bar says "Sign in"

const bar = await device('bar');
await bar.goto(BASE, { waitUntil: 'networkidle' });
await bar.waitForTimeout(700);
// The bar offers both now, and each must open its own form. One control
// serving both meant whichever it opened was wrong for half the people
// pressing it.
const barControls = (await bar.locator('.topbar__controls button').allInnerTexts()).map((t) =>
  t.trim(),
);
if (!barControls.includes('Sign in')) failures.push('the bar does not offer "Sign in"');
if (!barControls.includes('Sign up')) failures.push('the bar does not offer "Sign up"');

await bar.getByRole('button', { name: 'Sign in', exact: true }).click();
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
 * And the other door opens the other form.
 *
 * The bar names both now. A single control had to serve somebody returning
 * and somebody who has never been here, and whichever form it opened was
 * wrong for half the people pressing it.
 */
await bar.goto(BASE, { waitUntil: 'networkidle' });
await bar.waitForTimeout(600);
await bar.getByRole('button', { name: 'Sign up', exact: true }).click();
await bar.waitForTimeout(600);
const signUpHeading = await heading(bar);
console.log(`bar "Sign up" -> "${signUpHeading}"`);
if (!/create/i.test(signUpHeading)) {
  failures.push(`pressing "Sign up" opened "${signUpHeading}" instead of a sign-up form`);
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
if (!(await hasAccountRecord(bar))) failures.push('creating an account through the toggle did not sign anybody in');

// ------------------------------- a study route asks for an account, and returns you

/*
 * Studying needs an account, so this is a redirect rather than a lock.
 *
 * There used to be a lock panel on `/import` offering to make one. Now a
 * signed-out visitor never reaches that screen at all — they are sent to the
 * sign-up form before it renders. What has to stay true is the second half:
 * whatever they were going to do, they end up doing it, rather than being
 * dropped at the front door to find their own way back.
 */
const sent = await device('sent');
await sent.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
await sent.waitForTimeout(900);

const sentTo = sent.url().replace(BASE, '');
const sentHeading = await heading(sent);
console.log(`/import signed out -> ${sentTo} "${sentHeading}"`);

if (!sentTo.startsWith('/sign-in')) {
  failures.push(`/import was reachable without an account — it went to ${sentTo}`);
}
if (!sentTo.includes('from=')) {
  failures.push('the redirect did not record where the learner was going, so they cannot be returned to it');
}
if (!/create/i.test(sentHeading)) {
  failures.push(`being asked for an account opened "${sentHeading}" rather than a sign-up form`);
}

// And signing in from there puts them back on the thing they wanted.
await sent.getByText('I already have an account').click();
await sent.waitForTimeout(300);
await sent.locator('input[name="email"]').fill(EMAIL);
await sent.locator('input[name="password"]').fill(PASSWORD);
await sent.getByRole('button', { name: 'Sign in' }).click();
await sent.waitForTimeout(3500);

const returnedTo = sent.url().replace(BASE, '');
const importUsable = (await sent.locator('textarea').count()) > 0;
console.log(`after signing in -> ${returnedTo}, import usable: ${importUsable}`);
if (!returnedTo.startsWith('/import')) {
  failures.push(`signing in returned to ${returnedTo} rather than to /import`);
}
if (!importUsable) failures.push('the feature is still not usable after signing in');

// The door itself must stay open, or nobody can find out what this is before
// being asked for an email.
const doorOpen = await device('door');
await doorOpen.goto(BASE, { waitUntil: 'networkidle' });
await doorOpen.waitForTimeout(800);
const doorLanguages = await doorOpen.locator('[data-language]').count();
console.log(`door signed out -> ${doorLanguages} languages`);
if (doorLanguages === 0) {
  failures.push('the front door is behind the account requirement, so nobody can see what this is first');
}

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
const letIn = await hasAccountRecord(wrong);
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

// --------------------------------------- the test credential signs you in

/*
 * Something to type, for a build with no server.
 *
 * The deployed site has no API, so the form had nothing to accept and was
 * hidden entirely — which is why there appeared to be no sign-in page at all.
 * `test` / `test` is something it can accept. It authenticates nothing: it
 * lands in the same local demo the button opens, with no token, so it cannot
 * reach a server resource because it never obtains anything to reach one
 * with.
 *
 * Asserted through the form rather than by calling the helper, because what
 * matters is that typing them and pressing Sign in works.
 */
const tester = await device('test-credential');
await tester.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await tester.waitForTimeout(700);

const panel = tester.locator('.testcreds');
if ((await panel.count()) === 0) {
  failures.push('the sign-in form does not offer the test credential, so there is nothing to type');
} else {
  await panel.click();
  await tester.waitForTimeout(400);
  const typed = [
    await tester.locator('input[name="email"]').inputValue(),
    await tester.locator('input[name="password"]').inputValue(),
  ];
  await tester.getByRole('button', { name: 'Sign in', exact: true }).click();
  await tester.waitForTimeout(3500);

  const record = await tester.evaluate(() => {
    const raw = localStorage.getItem('srs:v1:account');
    return raw ? JSON.parse(raw) : null;
  });
  console.log(`test credential ${typed.join(' / ')} -> demo=${record?.demo === true} token=${Boolean(record?.token)}`);

  if (record?.demo !== true) failures.push('the test credential did not sign anybody in');
  if (record?.token) {
    failures.push('the test credential produced a token — it is meant to authenticate nothing');
  }
}

// ------------------------------------------- the demo opens what it claims

/*
 * Two states remain, not four.
 *
 * This used to check no-account, device-profile, demo and real account
 * together, because the gate keyed on "has a local profile" and let a device
 * profile through. Both of those states are gone: studying needs an account,
 * so "Use this device" is not offered where there is a server to make one on,
 * and somebody with no account is redirected before any screen renders —
 * which the section above asserts.
 *
 * What is left is the demo, which is the one thing that deliberately opens
 * everything without an account, and has to say so.
 */
async function openness(label, setup) {
  const page = await device(label);
  if (setup) await setup(page);
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  return {
    locked: (await page.locator('.locked').count()) > 0,
    usable: (await page.locator('textarea').count()) > 0,
    banner: (await page.locator('.demo').count()) > 0,
    token: await hasBearerToken(page),
    page,
  };
}

const demo = await openness('demo', async (page) => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.getByText('Look around with a demo first').click();
  await page.waitForTimeout(2500);
});
console.log(`demo           locked=${demo.locked} usable=${demo.usable} banner=${demo.banner} token=${demo.token}`);
if (demo.locked || !demo.usable) failures.push('the demo does not open the features it exists to show');
if (!demo.banner) failures.push('the demo does not say it is a demo, so somebody could think their work is being kept');
if (demo.token) failures.push('the demo holds a token — it is supposed to be local only, with no account anywhere');

/*
 * And it has to have something in it.
 *
 * Four of the five features the demo opens work fine empty. Progress does
 * not: retention per skill, the fortnight ahead and the streak are all views
 * of a review history, and with none they are a screen of zeroes — which
 * opens the feature while demonstrating nothing.
 *
 * Asserted on the streak rather than on the seeding, because the streak is
 * computed by the ordinary engine from the ordinary log. If it is there, the
 * history is real.
 */
await demo.page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
await demo.page.waitForTimeout(1200);
/*
 * Read the section headings, not the whole body.
 *
 * `body.innerText()` did not contain "BY SKILL" even when the section was on
 * screen — the headings are uppercased in CSS and the rolled-up body text did
 * not reflect it. Querying the headings themselves is both more reliable and
 * a better statement of what is being asserted.
 */
const sections = (await demo.page.locator('.section__title').allInnerTexts()).map((t) =>
  t.trim().toUpperCase(),
);
const languages = await demo.page.locator('.lang').count();
const reviews = await demo.page.evaluate(
  () => JSON.parse(localStorage.getItem('acct:demo:srs:v1:logs') ?? '[]').length,
);
console.log(`demo history   reviews=${reviews} languages=${languages} sections=${sections.length}`);

if (reviews === 0) failures.push('the demo has no review history, so its progress screens show nothing');
if (languages < 2) {
  failures.push('the demo studies one language, so the per-language row has nothing to compare');
}
if (!sections.includes('BY SKILL')) {
  failures.push(
    `the demo has no per-skill retention, which is one of the things an account is for — sections were: ${sections.join(', ')}`,
  );
}
if (!sections.includes('NEXT TWO WEEKS')) {
  failures.push('the demo has no forecast, so the fortnight ahead is empty');
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
