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
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('.gate__panel').first().click();
  await page.waitForTimeout(400);

  const flags = [];
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const vw = window.innerWidth;
      // Anything actually sticking out past the viewport?
      let worst = null;
      for (const el of document.querySelectorAll('.screen *')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        if (b.right > vw + 1 || b.left < -1) {
          const over = Math.round(Math.max(b.right - vw, -b.left));
          if (!worst || over > worst.over) worst = { over, cls: el.className?.toString().slice(0,34) || el.tagName };
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
