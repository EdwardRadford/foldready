// Drives the localhost site like a user and saves screenshots to out/ui-*.png
import { webkit } from 'playwright';

const base = 'http://localhost:3000';
const target = process.argv[2] || 'https://www.yowzer.co.uk';

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + '/');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('server never came up');
}

await waitForServer();
const browser = await webkit.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
page.on('pageerror', (e) => console.log('page error:', e.message));

await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'out/ui-landing.png', fullPage: true });

const input = page.locator('input[type=url], input[type=text], input').first();
await input.fill(target);
await Promise.all([page.waitForURL(/\/r\//, { timeout: 15000 }), input.press('Enter')]);
console.log('results url:', page.url());
await page.waitForTimeout(1500);
await page.screenshot({ path: 'out/ui-progress.png', fullPage: false });

// wait until the job is done: findings list or error text appears
const started = Date.now();
while (Date.now() - started < 120000) {
  const html = await page.content();
  if (/Unfold|could not|too long|not a web page/i.test(html) && !/Rendering|Loading|Checking|Queued|Comparing|Saving/i.test(html)) break;
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: 'out/ui-results.png', fullPage: true });

const unfold = page.getByRole('button', { name: /unfold/i }).first();
if (await unfold.count()) {
  await unfold.click();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'out/ui-unfolded.png', fullPage: false });
} else {
  console.log('no Unfold button found');
}
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'out/ui-results-phone.png', fullPage: true });
await browser.close();
console.log('done');
