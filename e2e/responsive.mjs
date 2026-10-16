/**
 * Every screen, at every width the app will actually meet.
 *
 * The stylesheet had exactly one media query, and it was for reduced motion:
 * the app was a 480px column at every size, which is 38% of a laptop screen
 * and 29% of a wide monitor. Widening it is easy to do and easy to break, and
 * the ways it breaks — a card pushed past the right edge, a grid swallowing
 * its own heading — are invisible unless somebody looks at that exact size.
 *
 * So this looks. It walks every route at eight widths and fails on anything
 * that escapes the viewport, which is the failure that matters: a learner who
 * has to scroll sideways to reach a button.
 *
 * Usage — needs a built web app being served:
 *
 *   VITE_API_URL=http://127.0.0.1:4060 npm run web:vite:build
 *   npm run preview --workspace @language-srs/web -- --port 4200 &
 *   npm run e2e:responsive
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';
const SIZES = [[320,568,'xs'],[360,640,'small'],[390,664,'phone'],[480,800,'big-phone'],[768,1024,'tablet'],[1024,768,'small-laptop'],[1280,800,'laptop'],[1680,1050,'wide']];
const ROUTES = ['/','/home','/review','/learn','/learn/zh-shi','/practice/zh-shi','/words','/stats','/settings','/import'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const bad = [];
const failures = [];

for (const [w,h,name] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => bad.push(`${name}: pageerror ${e.message.slice(0,80)}`));
  /*
   * In through the demo.
   *
   * Studying needs an account now, so a signed-out visitor is redirected
   * before any of these screens renders — and this suite is about layout at
   * eight widths, not about authentication. The demo is the one way in that
   * needs no server round trip and no account.
   */
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.getByText('Look around with a demo first').click();
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('srs:v1:account');
      return raw && JSON.parse(raw).demo === true;
    },
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);

  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('[data-language]').first().click();
  // Wait for the app to arrive, rather than guessing how long travelling takes.
  // Choosing a place runs a short animation and then navigates; a fixed sleep
  // races it, and the pending navigation lands *after* the next goto — which
  // leaves the test on the day screen looking for review options that are not
  // there. This is also what a learner does: they arrive, then they study.
  // A language nobody has set up now opens the setup interview first, so
  // arriving means landing on either, and completing the interview if it is
  // the one that came up. Written as "whichever comes" rather than always
  // expecting setup, so this keeps working for a language already set up.
  await page.waitForURL(/\/(home|start)$/, { timeout: 15_000 });
  if (page.url().endsWith('/start')) {
    await page.getByRole('button', { name: 'Start learning' }).click();
    await page.waitForURL('**/home', { timeout: 15_000 });
  }

  const flags = [];
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const vw = window.innerWidth;

      /*
       * Clipped is not escaped.
       *
       * Some artwork is deliberately larger than its frame and cropped by it —
       * that is how a scene reads as a view rather than a picture. What matters
       * is content a learner would have to scroll sideways to reach, so an
       * element any ancestor hides the overflow of does not count.
       */
      const clipped = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p);
          if (o.overflowX === 'hidden' || o.overflowX === 'clip') return true;
        }
        return false;
      };

      let worst = null;
      for (const el of document.querySelectorAll('.screen *')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        if (b.right > vw + 1 || b.left < -1) {
          if (clipped(el)) continue;
          const over = Math.round(Math.max(b.right - vw, -b.left));
          const name = typeof el.className === 'string' ? el.className : el.tagName;
          if (!worst || over > worst.over) worst = { over, cls: name.slice(0, 34) };
        }
      }
      return { hScroll: docW - vw, worst };
    });
    if (r.hScroll > 0) flags.push(`${route} h-scroll ${r.hScroll}px`);
    if (r.worst) flags.push(`${route} "${r.worst.cls}" over ${r.worst.over}px`);
  }
  if (flags.length > 0) failures.push(`${name} ${w}x${h}: ${flags.join('; ')}`);
  console.log(`${name.padEnd(13)} ${String(w).padStart(4)}x${h}  ${flags.length ? '⚠ ' + flags.join('; ') : 'ok'}`);
  await ctx.close();
}
console.log('\npage errors:', bad.length ? bad.join('\n  ') : 'none');
console.log(failures.length === 0 && bad.length === 0 ? '\nPASS' : `\nFAIL\n- ${[...failures, ...bad].join('\n- ')}`);
await browser.close();
process.exit(failures.length === 0 && bad.length === 0 ? 0 : 1);
