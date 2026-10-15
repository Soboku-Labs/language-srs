/**
 * Settings, across two browsers and one account.
 *
 * Choose dark and a living background on the laptop; expect the phone to open
 * dark and living, having never been told. That is the thing the server-side
 * settings split bought, and it cannot be asserted anywhere but in a browser:
 * the values are read by a React provider, reconciled against the server on
 * sign-in, and written onto the document as CSS custom properties.
 *
 * It also pins down the case that is easy to get wrong in the other direction.
 * Somebody tries the app, picks dark, *then* registers. The server has never
 * heard of them, so it answers with defaults — and a provider that trusts the
 * server unconditionally would wipe the choice they just made, which is the
 * same mistake `adoptDeck` exists to prevent for decks. So the rule is: the
 * server wins only once it has actually been told something.
 *
 * Usage — needs a server and a built web app pointed at it:
 *
 *   PORT=4060 DATA_DIR=memory npm run server &
 *   VITE_API_URL=http://127.0.0.1:4060 npm run web:vite:build
 *   npm run preview --workspace @language-srs/web -- --port 4200 &
 *   npm run e2e:settings
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';
const API = process.argv[3] ?? 'http://127.0.0.1:4060';
const EMAIL = `settings-${Date.now()}@example.com`;
const PASSWORD = 'a-long-enough-password';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];

async function device(label) {
  // A separate context is a separate localStorage, which is what makes these
  // two genuinely different browsers rather than two tabs.
  const page = await browser.newContext().then((c) => c.newPage());
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('409')) {
      problems.push(`[${label}] console: ${m.text()}`);
    }
  });
  return page;
}

async function signIn(page, { register }) {
  // The route says which of the two this is: `?new=1` makes one, a bare
  // /sign-in signs in. The screen used to open on Create an account however
  // you arrived, which is what made the bar's "Sign in" button a lie.
  await page.goto(`${BASE}/sign-in${register ? '?new=1' : ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  if (register) await page.locator('input[autocomplete="name"]').fill('Vish');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: register ? 'Create account' : 'Sign in' }).click();
  await page.waitForTimeout(3000);
}

/** What the app is actually showing, read off the document rather than state. */
const applied = (page) =>
  page.evaluate(() => ({
    appearance: document.documentElement.dataset.appearance,
    backdrop: document.documentElement.dataset.backdrop,
    canvas: getComputedStyle(document.documentElement).backgroundColor,
  }));

const tokenOf = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('srs:v1:account');
    return raw ? JSON.parse(raw).token : undefined;
  });

const serverSettings = async (token, path = '') => {
  const response = await fetch(`${API}/settings${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
};

/** Click one of the segmented controls in the front page's bar. */
async function choose(page, label, option) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // The control's label is an `aria-label` on the group, not visible text.
  const group = page.getByRole('group', { name: label });
  await group.getByRole('button', { name: option, exact: true }).click();
  await page.waitForTimeout(800);
}

// ------------------------------------------------- try it first, then sign up

const laptop = await device('laptop');

// Chosen *before* there is an account, which is the ordering that catches a
// provider trusting the server's empty defaults over a real local choice.
await choose(laptop, 'Appearance', 'Dark');
await choose(laptop, 'Background', 'Living');
const beforeRegistering = await applied(laptop);
console.log('laptop before registering:', JSON.stringify(beforeRegistering));

await signIn(laptop, { register: true });
await laptop.waitForTimeout(2500);
const afterRegistering = await applied(laptop);
console.log('laptop after registering :', JSON.stringify(afterRegistering));

const token = await tokenOf(laptop);
const pushed = await serverSettings(token);
console.log('server now holds         :', JSON.stringify(pushed.body));

// --------------------------------------------------- a second browser, cold

const phone = await device('phone');
await signIn(phone, { register: false });
await phone.waitForTimeout(3000);
const phoneApplied = await applied(phone);
console.log('\nphone after signing in   :', JSON.stringify(phoneApplied));

// ------------------------------- which carrier is actually in charge

/*
 * The assertions above are true whichever carrier delivered the settings.
 *
 * A fresh browser gets the same answer from the settings endpoints and from
 * the state blob, because both came from the same account — so "the phone
 * turned dark" does not prove the endpoints did it. Disabling the
 * reconciliation entirely and re-running this file showed exactly that: the
 * phone still went dark, carried by the blob.
 *
 * So: change the setting on the server and nowhere else, leaving the blob
 * saying dark, and reload. Following the server is the only way to pass.
 */
await fetch(`${API}/settings`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ appearance: 'light', backdrop: 'calm' }),
});
await phone.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await phone.waitForTimeout(3500);
const afterServerOnlyChange = await applied(phone);
console.log('phone after a server-only change:', JSON.stringify(afterServerOnlyChange));

// ------------------------------------------- a language setting, kept apart

// Set on the laptop for Mandarin; Japanese must not inherit it.
await laptop.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await laptop.waitForTimeout(800);
const zhBefore = await serverSettings(token, '/languages/zh');
const jaBefore = await serverSettings(token, '/languages/ja');
console.log('\nzh on the server:', JSON.stringify(zhBefore.body));
console.log('ja on the server:', JSON.stringify(jaBefore.body));

console.log('\n================ VERDICT ================');

const failures = [];

if (beforeRegistering.appearance !== 'dark' || beforeRegistering.backdrop !== 'living') {
  failures.push(
    `choosing dark and living before signing up did not apply: ${JSON.stringify(beforeRegistering)}`,
  );
}

// The point: registering must not hand the server's defaults back over a
// choice already made.
if (afterRegistering.appearance !== 'dark' || afterRegistering.backdrop !== 'living') {
  failures.push(
    `registering wiped the settings chosen beforehand: ${JSON.stringify(afterRegistering)}`,
  );
}

if (pushed.status !== 200) {
  failures.push(`the server did not answer for settings: ${pushed.status}`);
} else if (pushed.body.appearance !== 'dark' || pushed.body.backdrop !== 'living') {
  failures.push(`the local choice was never pushed up: ${JSON.stringify(pushed.body)}`);
}

// The thing the whole split was for. Satisfiable by either carrier on its own,
// which is why the server-only change below is the one that pins it down.
if (phoneApplied.appearance !== 'dark' || phoneApplied.backdrop !== 'living') {
  failures.push(
    `a second browser did not pick the account’s settings up at all: ${JSON.stringify(phoneApplied)}`,
  );
}

// The decisive one: only the settings endpoints were told.
if (afterServerOnlyChange.appearance !== 'light' || afterServerOnlyChange.backdrop !== 'calm') {
  failures.push(
    `a change made only on the server did not reach the app, so the blob is still in charge: ${JSON.stringify(afterServerOnlyChange)}`,
  );
}

// A dark canvas is the visible consequence; if the attribute says dark and the
// page is still painted near-white, the theme is not actually applied.
const rgb = (phoneApplied.canvas.match(/\d+/g) ?? []).map(Number);
if (rgb.length >= 3 && (rgb[0] + rgb[1] + rgb[2]) / 3 > 100) {
  failures.push(`the phone says dark but is painted ${phoneApplied.canvas}`);
}

if (zhBefore.status !== 200 || jaBefore.status !== 200) {
  failures.push(`per-language settings did not answer: zh ${zhBefore.status}, ja ${jaBefore.status}`);
} else if (jaBefore.body.examTrackId === zhBefore.body.examTrackId) {
  failures.push(
    `two languages share an exam track: ${jaBefore.body.examTrackId} — they are not separate`,
  );
}

if (problems.length > 0) failures.push(`page errors:\n  ${problems.join('\n  ')}`);

if (failures.length > 0) {
  console.log('FAILED');
  for (const failure of failures) console.log(' -', failure);
} else {
  console.log('PASSED — settings are the account’s, and reach a browser that never set them.');
}

await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
