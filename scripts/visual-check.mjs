#!/usr/bin/env node
// Headless visual verification for the running local vault.
// - Launches headless Chromium: no windows, no focus steal, safe to run
//   while working on this machine.
// - Reads the owner key from the local key file (never printed) and stores
//   it in the page's localStorage, exactly like the vault gate does.
// - Captures gallery / quick-look / missing-works screenshots plus a JSON
//   report (image counts, broken images, console errors, slow requests).
// - Exits non-zero when a surface regresses (broken images, console errors,
//   or a stuck loader), so schedulers and CI can gate on it.
// NOTE: loading the gallery touches the foreground heartbeat, which yields
// background pipelines for ~5 minutes. Keep scheduled runs infrequent.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = new Map(
  process.argv.slice(2).map(a => {
    const i = a.indexOf('=');
    return i < 0 ? [a, true] : [a.slice(0, i), a.slice(i + 1)];
  }),
);
const baseUrl = args.get('--url') ?? 'http://127.0.0.1:3000';
const keyFile = args.get('--key-file') ?? '.convex/local-owner-key';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = args.get('--out') ?? join('.convex', 'services', 'visual-checks', stamp);

const SLOW_MS = 15000;
const report = { url: baseUrl, startedAt: new Date().toISOString(), surfaces: {}, consoleErrors: [], slowRequests: [] };

const browser = await chromium.launch({ headless: true });
try {
  const key = (await readFile(keyFile, 'utf8')).trim();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', msg => {
    if (msg.type() === 'error') report.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('requestfailed', req => {
    report.consoleErrors.push(`requestfailed: ${req.url().slice(0, 160)} ${req.failure()?.errorText ?? ''}`);
  });
  page.on('response', res => {
    const ms = res.request().timing()?.responseEnd ?? 0;
    if (ms > SLOW_MS) report.slowRequests.push(`${res.url().split('?')[0].slice(-80)} ${Math.round(ms)}ms`);
  });

  await page.addInitScript(k => localStorage.setItem('ourchivalOwnerAccessKey', k), key);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // Gallery: wait out the vault gate, then cards render or try-again settles.
  await page.waitForFunction(
    () => !/opening your vault/i.test(document.body.innerText),
    { timeout: 30000 },
  ).catch(() => {});
  await page.waitForFunction(
    () => document.querySelector('[data-reference-id]') || /try again|reconnecting|could not load/i.test(document.body.innerText),
    { timeout: 90000 },
  ).catch(() => {});
  const gallery = await page.evaluate(() => {
    const imgs = [...document.images];
    return {
      cards: document.querySelectorAll('[data-reference-id]').length,
      images: imgs.length,
      loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      stuckLoader: /loading saved references/i.test(document.body.innerText),
      tryAgain: /try again/i.test(document.body.innerText),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  report.surfaces.gallery = gallery;
  await mkdir(outDir, { recursive: true });
  // Let lazy images decode so the screenshot shows the actual archive.
  await page.waitForFunction(
    () => [...document.images].filter(i => i.complete && i.naturalWidth > 0).length >= 10,
    { timeout: 30000 },
  ).catch(() => {});
  await page.screenshot({ path: join(outDir, 'gallery.png') });

  // Quick Look: open the first card's image, then close with Escape.
  if (gallery.cards > 0) {
    await page.locator('[data-reference-id] .thumb-wrap').first().click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const quicklook = await page.evaluate(() => ({
      open: Boolean(document.querySelector('[role="dialog"] .quick-look-header')),
      images: document.images.length,
      broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
    }));
    report.surfaces.quicklook = quicklook;
    await page.screenshot({ path: join(outDir, 'quicklook.png') });
    await page.keyboard.press('Escape');
  }

  // Missing works queue: wait for the first batch to settle (items listed
  // or the batch-exhausted empty state), not the mid-scan placeholder.
  await page.goto(new URL('/missing', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('section[aria-label="Missing image queue"] button[aria-pressed]')
      || [...document.querySelectorAll('section[aria-label="Missing image queue"] button')]
        .some(b => !b.disabled && /check next/i.test(b.innerText))
      || /no missing images in this batch|could not load/i.test(document.body.innerText),
    { timeout: 180000 },
  ).catch(() => {});
  report.surfaces.missing = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.innerText ?? null,
    items: document.querySelectorAll('section[aria-label="Missing image queue"] button[aria-pressed]').length,
    queueText: document.querySelector('main')?.innerText.slice(0, 220) ?? null,
  }));
  await page.screenshot({ path: join(outDir, 'missing.png') });
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));

const failures = [
  ...Object.entries(report.surfaces).flatMap(([name, s]) =>
    (s.broken ?? 0) > 0 ? [`${name}: ${s.broken} broken images`] : []),
  ...(report.surfaces.gallery?.cards === 0 ? ['gallery: no cards rendered'] : []),
  ...(report.surfaces.gallery?.cards > 0 && report.surfaces.quicklook && !report.surfaces.quicklook.open
    ? ['quicklook: dialog did not open'] : []),
  ...(report.surfaces.gallery?.stuckLoader ? ['gallery: loader stuck'] : []),
  ...(report.surfaces.gallery?.overflowX ? ['gallery: horizontal overflow'] : []),
  ...report.consoleErrors.slice(0, 5).map(e => `console: ${e}`),
];
console.log(JSON.stringify({ outDir, failures, surfaces: report.surfaces }, null, 2));
process.exit(failures.length ? 1 : 0);
