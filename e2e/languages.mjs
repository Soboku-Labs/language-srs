/**
 * Each language keeps its own settings, and all of them follow the account.
 *
 * The split itself was already right: the server stores user settings and
 * language settings as two resources, and the language one is keyed by
 * language code, so HSK 3 in June and a dabble at N5 are genuinely separate
 * rows. What was missing is the half that makes the split worth having — the
 * app only ever reconciled *the language that happened to be active at the
 * moment of signing in*.
 *
 * This file was written expecting to find three bugs there and found one. The
 * other two were already covered, by a mechanism easy to overlook: the sync
 * blob carries the engine's whole meta, profiles included, so two browsers
 * agree about every language without the server reading a word of it — and
 * `updateLanguage` writes to each language's own resource as it is edited, so
 * the server does hold them readably. The assertions for those two stayed, as
 * the record that they work rather than as the record of a fix.
 *
 * The one that was real: **the setup interview ran twice**. `setUpAt` is on
 * the server precisely so "have you been asked" travels with the person
 * rather than the browser. The web app never sent it and never read it, so
 * picking a language up on one device and opening it on another stopped its
 * owner to ask what they wanted out of a language they were already studying.
 *
 * The lesson is in the order of those two paragraphs. Four of the five things
 * asserted here passed on the unfixed build, and had this file been written
 * after the change instead of before it, all five would have looked like
 * proof of work that only one of them did.
 *
 * Usage — needs a server and a built web app pointed at it:
 *
 *   PORT=4060 DATA_DIR=memory npm run server &
 *   VITE_API_URL=http://127.0.0.1:4060 npm run web:vite:build
 *   npm run preview --workspace @language-srs/web -- --port 4200 &
 *   npm run e2e:languages
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';
const API = process.argv[3] ?? 'http://127.0.0.1:4060';
const EMAIL = `languages-${Date.now()}@example.com`;
const PASSWORD = 'a-long-enough-password';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];
const failures = [];

async function device(label) {
  const page = await browser.newContext().then((c) => c.newPage());
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    // 409 is the sync layer's conflict, which two devices on one account
    // produce by existing. Counting it would fail the suite for working.
    if (m.type() === 'error' && !m.text().includes('409')) {
      problems.push(`[${label}] console: ${m.text()}`);
    }
  });
  return page;
}

function check(what, actual, expected) {
  if (actual === expected) {
    console.log(`  ok    ${what}: ${actual}`);
  } else {
    failures.push(`${what}: expected ${expected}, got ${actual}`);
    console.log(`  FAIL  ${what}: expected ${expected}, got ${actual}`);
  }
}

async function signIn(page, { register }) {
  await page.goto(`${BASE}/sign-in${register ? '?new=1' : ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  if (register) await page.locator('input[name="displayName"]').fill('Vish');
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: register ? 'Create account' : 'Sign in' }).click();
  await page.waitForTimeout(3500);
}

/** Open a language through the door, the way a person does. */
async function enter(page, code) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator(`[data-language="${code}"]`).click();
  await page.waitForTimeout(2200);
  return new URL(page.url()).pathname;
}

/**
 * Open a language and answer the setup interview if it is asked.
 *
 * Pressing "Start learning" is what sets `setUpAt`, and an earlier version of
 * this file navigated straight out of `/start` instead — then asserted that a
 * second device did not ask. It did ask, correctly, because nobody had ever
 * answered. The test was wrong and said the app was.
 */
async function enterAndSetUp(page, code) {
  const landed = await enter(page, code);
  if (landed === '/start') {
    await page.getByRole('button', { name: 'Start learning' }).click();
    await page.waitForTimeout(1800);
  }
}

/**
 * What the server itself holds for this account, as a second client would see.
 *
 * The blob the sync layer carries between devices contains the engine's whole
 * meta, profiles included, so two browsers can agree about a language without
 * the server ever being able to read a word of it. That is the distinction
 * this asks about: not "did the phone end up right" but "can the server
 * answer for this language", which is what a widget, a second client or
 * anything acting server-side actually needs.
 */
async function serverLanguages(page) {
  return page.evaluate(async (api) => {
    const raw = localStorage.getItem('srs:v1:account');
    const token = raw ? JSON.parse(raw).token : undefined;
    if (!token) return { error: 'no token' };
    const response = await fetch(`${api}/settings/languages`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { error: `${response.status}` };
    const body = await response.json();
    return Object.fromEntries(
      body.languages.map((row) => [
        row.languageCode,
        {
          level: row.targetLevelId,
          newPerDay: row.dailyNewLimit,
          reviewsPerDay: row.dailyReviewLimit,
          setUp: Boolean(row.setUpAt),
        },
      ]),
    );
  }, API);
}

/** Which level chip is pressed on the settings screen, for the open language. */
async function selectedLevel(page) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const pressed = page.locator('.choice[aria-pressed="true"]');
  const labels = await pressed.allInnerTexts();
  // The exam chips come first where a language has more than one track, so the
  // level is the last pressed chip above the date shortcuts (which are never
  // pressed). Reading them all and taking the level-shaped one keeps this
  // honest whether or not the language has two tracks.
  return labels.find((text) => /\d/.test(text)) ?? labels.join(',');
}

/**
 * A stepper's value by its label, e.g. "New cards".
 *
 * Navigates there itself. Reading it off whatever page happened to be open was
 * fine only because another helper had already gone to the settings screen,
 * which made one assertion fail for want of a `goto` rather than for the
 * reason it was written.
 */
async function stepper(page, label) {
  if (new URL(page.url()).pathname !== '/settings') {
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
  }
  const row = page.locator('.stepper', { has: page.locator('.stepper__label', { hasText: label }) });
  const value = row.first().locator('.stepper__value');
  // Reported rather than thrown. A missing stepper means the screen is not the
  // settings screen, which is a result this suite wants to print next to the
  // check that explains it — not a stack trace that hides the four checks
  // after it.
  if ((await value.count()) === 0) return `(no ${label} control on ${new URL(page.url()).pathname})`;
  return (await value.innerText()).trim();
}

// ----------------------------------------------------------------- the laptop

console.log('laptop: register, then set up two languages differently');
const laptop = await device('laptop');
await signIn(laptop, { register: true });

// Mandarin: HSK 3, a faster pace than the default 15.
await enterAndSetUp(laptop, 'zh');
await laptop.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await laptop.waitForTimeout(700);
await laptop.getByRole('button', { name: 'HSK 3', exact: true }).click();
await laptop.waitForTimeout(400);
for (let i = 0; i < 5; i += 1) {
  await laptop.getByRole('button', { name: 'Increase New cards' }).click();
  await laptop.waitForTimeout(120);
}
const laptopZhLevel = await selectedLevel(laptop);
const laptopZhNew = await stepper(laptop, 'New cards');
console.log(`  laptop zh: ${laptopZhLevel}, ${laptopZhNew} new/day`);

// Japanese: a different level and a slower pace. This is the one that was
// never reaching the server.
await enterAndSetUp(laptop, 'ja');
await laptop.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await laptop.waitForTimeout(700);
await laptop.getByRole('button', { name: 'N4', exact: true }).click();
await laptop.waitForTimeout(400);
for (let i = 0; i < 2; i += 1) {
  await laptop.getByRole('button', { name: 'Decrease New cards' }).click();
  await laptop.waitForTimeout(120);
}
const laptopJaLevel = await selectedLevel(laptop);
const laptopJaNew = await stepper(laptop, 'New cards');
console.log(`  laptop ja: ${laptopJaLevel}, ${laptopJaNew} new/day`);

await laptop.waitForTimeout(1500);

/*
 * What the server can actually answer for.
 *
 * Asserted here rather than only on the phone because the phone can be right
 * for the wrong reason: the sync blob carries the engine's whole meta, so two
 * browsers agree about every language whether or not the server understood
 * any of it. This is the half the split was for.
 */
console.log('\nserver: both languages, readable, not inside a blob');
const stored = await serverLanguages(laptop);
console.log(`  ${JSON.stringify(stored)}`);
check('server knows Mandarin', stored.zh?.newPerDay, Number(laptopZhNew));
check('server knows Japanese', stored.ja?.newPerDay, Number(laptopJaNew));
check('server has Mandarin level', stored.zh?.level, 'hsk3-3');
check('server has Japanese level', stored.ja?.level, 'jlpt-n4');
check('server knows Mandarin was set up', stored.zh?.setUp, true);
check('server knows Japanese was set up', stored.ja?.setUp, true);

// ------------------------------------------------------------------ the phone

console.log('\nphone: sign into the same account, having been told nothing');
const phone = await device('phone');
await signIn(phone, { register: false });
await phone.waitForTimeout(2000);

// 1. The language that was active at sign-in time on the laptop.
await enter(phone, 'zh');
check('phone Mandarin level', await selectedLevel(phone), laptopZhLevel);
check('phone Mandarin new/day', await stepper(phone, 'New cards'), laptopZhNew);

// 2. The second language, which is the one the old reconciliation skipped.
await enter(phone, 'ja');
check('phone Japanese level', await selectedLevel(phone), laptopJaLevel);
check('phone Japanese new/day', await stepper(phone, 'New cards'), laptopJaNew);

// 3. And the two must genuinely differ, or the assertions above would pass
//    on an app that kept one set of settings for everything.
check(
  'the two languages disagree',
  laptopZhNew !== laptopJaNew && laptopZhLevel !== laptopJaLevel,
  true,
);

// 4. Having been asked travels with the person. Both languages were set up on
//    the laptop, so neither may stop this device to ask again.
console.log('\nphone: no second setup interview');
check('entering Mandarin', await enter(phone, 'zh'), '/home');
check('entering Japanese', await enter(phone, 'ja'), '/home');

// 5. A language picked up on the laptop *after* the phone signed in still
//    reaches it, because settings are pulled when a language is opened.
console.log('\nlaptop: start Korean after the phone has already signed in');
await enterAndSetUp(laptop, 'ko');
await laptop.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await laptop.waitForTimeout(700);
await laptop.getByRole('button', { name: 'TOPIK II', exact: true }).click().catch(() => {});
await laptop.waitForTimeout(400);
for (let i = 0; i < 3; i += 1) {
  await laptop.getByRole('button', { name: 'Increase Reviews' }).click();
  await laptop.waitForTimeout(120);
}
const laptopKoReviews = await stepper(laptop, 'Reviews');
console.log(`  laptop ko: ${laptopKoReviews} reviews/day`);
await laptop.waitForTimeout(1500);

/*
 * This is the one that was broken, and — measured against the unfixed build —
 * the only one.
 *
 * Everything above already passed before the fix, for two reasons worth
 * writing down because they are not obvious. The values travel in the sync
 * blob, which carries the engine's whole meta and so agrees about every
 * language whether or not the server understands any of it; and
 * `updateLanguage` pushes to each language's own resource as it is edited, so
 * every language touched on a device does reach the server readably.
 *
 * What did not travel was `setUpAt` — the record that somebody answered the
 * setup questions for this language. Sign-in reconciled only whichever
 * language happened to be active, and nothing reconciled a language the first
 * time it was opened, so a language picked up elsewhere stopped its owner on
 * another device to ask what they wanted out of a language they were already
 * studying. Reverting the fix puts that failure back, twice out of two.
 */
check('entering Korean', await enter(phone, 'ko'), '/home');
check('phone Korean reviews/day', await stepper(phone, 'Reviews'), laptopKoReviews);

// ------------------------------------------------- the screen says which is which

/*
 * The split, visible.
 *
 * Correct storage that the screen does not explain is a split only the code
 * knows about: every section used to sit in one flat list under one sentence
 * saying that some of it was per-language and some of it was not, leaving the
 * reader to work out which was which, nine sections running. Asserted here
 * because headings are exactly the sort of thing a later edit removes without
 * anything failing.
 */
console.log('\nthe settings screen names both subjects');
await enter(phone, 'ja');
await phone.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await phone.waitForTimeout(900);

const groups = await phone.locator('.settings__group-name').allInnerTexts();
check('two groups', groups.length, 2);
check('the person is the second', groups[1], 'You');

/*
 * Whichever language is open, not the one that was asked for.
 *
 * The active language travels inside the sync blob, so the laptop — last seen
 * on Korean — can move the phone off Japanese between the click and the read.
 * That is the sync layer's behaviour and predates this change; pinning the
 * name here would make this suite fail for it. What is being asserted is the
 * shape: three studied languages, one of them heading the screen and the
 * other two named underneath as keeping their own.
 */
const STUDIED = ['Mandarin Chinese', 'Japanese', 'Korean'];
const open = groups[0];
check('the open language heads the screen', STUDIED.includes(open), true);

const note = await phone.locator('.settings__group-note').first().innerText();
console.log(`  open: ${open} · note: ${note}`);
const others = STUDIED.filter((name) => name !== open);
check(
  'the other two are named',
  others.every((name) => note.includes(name)),
  true,
);
// Two of them, so the verb is plural. The first version of this line read
// "Japanese keep their own", which is why the agreement is asserted at all.
check('the verb agrees', note.includes('keep their own'), true);
check('and the open one is not named among them', note.includes(`${open} keep`), false);

// ------------------------------------------------------------------- the word

await browser.close();

if (problems.length) {
  console.log('\nbrowser problems:');
  for (const problem of problems) console.log(`  ${problem}`);
}

if (failures.length || problems.length) {
  console.log(`\n${failures.length} failed, ${problems.length} browser problems`);
  process.exit(1);
}
console.log('\nall good');
