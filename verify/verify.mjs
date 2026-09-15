#!/usr/bin/env node
// Browser verification with Playwright (Chromium).
//
//   node verify/verify.mjs [--gpu] [--quick]
//
// Serves the project on a random port, loads the page in deterministic screenshot mode
// for every preset, debug view, and quality profile, and in interactive mode for the
// hotkey / persistence / context-loss / determinism checks. For each case it asserts:
//   - the page reached ready (body[data-ready="1"]) within the timeout
//   - zero console errors and zero uncaught page errors
//   - the rendered frame is not black
// PNGs and verify/results/report.{json,md} are written for inspection.
//
// Playwright resolution: local `playwright` or `playwright-core`, then the copies that
// ship with the global `@playwright/cli`. If none are found, run `npm i -D playwright`.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, listen } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(HERE, 'results');
const args = new Set(process.argv.slice(2));
const USE_GPU = args.has('--gpu');
const QUICK = args.has('--quick');

async function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return await import(name); } catch { /* next */ }
  }
  let globalRoot = '';
  try { globalRoot = execFileSync('npm', ['root', '-g'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* ignore */ }
  const candidates = [
    path.join(globalRoot, 'playwright', 'index.mjs'),
    path.join(globalRoot, 'playwright-core', 'index.mjs'),
    path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright-core', 'index.mjs'),
    path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright', 'index.mjs'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return import(pathToFileURL(c).href);
  throw new Error('Playwright not found. Run: npm i -D playwright && npx playwright install chromium');
}

const PIXEL_STATS = () => {
  const c = document.getElementById('view');
  // Interactive mode has no preserveDrawingBuffer: re-render synchronously so the
  // drawing buffer is intact when we read it back in the same task.
  if (!document.body.classList.contains('shot') && window.__gargantua && window.__gargantua.renderOnce) {
    window.__gargantua.renderOnce();
  }
  const cv = document.createElement('canvas');
  cv.width = c.width; cv.height = c.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(c, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let sum = 0, nonBlack = 0, hash = 2166136261 >>> 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += l;
    if (l > 6) nonBlack++;
    hash ^= d[i]; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= d[i + 1]; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= d[i + 2]; hash = Math.imul(hash, 16777619) >>> 0;
  }
  const g = window.__gargantua || {};
  return {
    width: c.width, height: c.height, meanLuma: sum / n, nonBlackFrac: nonBlack / n,
    hash: hash.toString(16), ready: !!g.ready, error: g.error || null, hdrType: g.hdrType || null,
    stats: g.stats ? g.stats() : null, state: g.state ? g.state() : null,
    overlayHidden: document.getElementById('overlay').hidden,
  };
};

function fmt(n, d = 2) { return typeof n === 'number' ? n.toFixed(d) : String(n); }

async function main() {
  const pw = await loadPlaywright();
  fs.mkdirSync(OUT, { recursive: true });
  const server = createServer(ROOT);
  const port = await listen(server, 0);
  const base = `http://127.0.0.1:${port}/`;

  const launchArgs = USE_GPU
    ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await pw.chromium.launch({ headless: true, args: launchArgs });
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });

  const report = { date: new Date().toISOString(), renderer: USE_GPU ? 'gpu' : 'swiftshader', cases: [] };
  let failures = 0;

  async function runCase(name, query, { timeout = 240000, minNonBlack = 0.02, interactive = false, after = null, keepPage = false } = {}) {
    const page = await context.newPage();
    const consoleErrors = [];
    const consoleWarnings = [];
    const pageErrors = [];
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error') consoleErrors.push(text.slice(0, 500));
      else if (m.type() === 'warning' && !/GL Driver Message|ReadPixels/.test(text)) consoleWarnings.push(text.slice(0, 300));
    });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 500)));
    const url = base + query;
    const t0 = Date.now();
    const entry = { name, url: query, ok: false, ms: 0, consoleErrors, consoleWarnings, pageErrors };
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('body[data-ready="1"]', { timeout });
      if (interactive) await page.waitForTimeout(400);
      let extra = {};
      if (after) extra = (await after(page)) || {};
      const px = await page.evaluate(PIXEL_STATS);
      entry.ms = Date.now() - t0;
      Object.assign(entry, {
        width: px.width, height: px.height, meanLuma: px.meanLuma, nonBlackFrac: px.nonBlackFrac, hash: px.hash,
        hdrType: px.hdrType, overlayHidden: px.overlayHidden, fps: px.stats ? px.stats.fps : null,
        frameMs: px.stats ? px.stats.frameMs : null, state: px.state, ...extra,
      });
      const file = path.join(OUT, name.replace(/[^a-z0-9_-]+/gi, '_') + '.png');
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: Math.min(px.width, 960), height: Math.min(px.height, 540) } });
      entry.png = path.relative(ROOT, file);
      const problems = [];
      if (!px.ready) problems.push('not ready');
      if (px.error) problems.push('app error: ' + px.error);
      if (!px.overlayHidden) problems.push('overlay still visible');
      if (consoleErrors.length) problems.push(`${consoleErrors.length} console error(s)`);
      if (pageErrors.length) problems.push(`${pageErrors.length} page error(s)`);
      if (px.nonBlackFrac < minNonBlack) problems.push(`frame is black (non-black ${fmt(px.nonBlackFrac * 100)}%)`);
      if (extra.problems) problems.push(...extra.problems);
      entry.problems = problems;
      entry.ok = problems.length === 0;
    } catch (err) {
      entry.ms = Date.now() - t0;
      entry.problems = ['exception: ' + String(err.message || err).slice(0, 300)];
      entry.ok = false;
      try { await page.screenshot({ path: path.join(OUT, name.replace(/[^a-z0-9_-]+/gi, '_') + '_FAIL.png') }); } catch { /* ignore */ }
    }
    if (!entry.ok) failures++;
    report.cases.push(entry);
    console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${String(entry.ms).padStart(6)} ms  luma ${fmt(entry.meanLuma, 1).padStart(5)}  non-black ${fmt((entry.nonBlackFrac || 0) * 100, 1).padStart(5)}%${entry.problems && entry.problems.length ? '  ← ' + entry.problems.join('; ') : ''}`);
    if (!keepPage) await page.close();
    return { entry, page };
  }

  const W = QUICK ? 480 : 640, H = QUICK ? 270 : 360;
  const shot = (extra) => `?shot=1&w=${W}&h=${H}&seed=7&t=12.5&${extra}`;

  console.log(`\nGARGANTUA browser verification — ${report.renderer}, ${W}x${H}\n`);

  // Presets
  for (const preset of ['interstellar', 'quasar', 'ember', 'lensing']) {
    await runCase(`preset-${preset}`, shot(`preset=${preset}&quality=medium`));
  }
  // Debug views
  for (let d = 0; d <= 9; d++) {
    await runCase(`debug-${d}`, shot(`preset=interstellar&quality=${QUICK ? 'low' : 'medium'}&debug=${d}`));
  }
  // Quality profiles
  for (const q of ['low', 'medium', 'high']) {
    await runCase(`quality-${q}`, shot(`preset=interstellar&quality=${q}`));
  }
  // Explicit camera + parameter overrides
  await runCase('camera-override', shot('preset=interstellar&quality=medium&cam=0,9,4&look=0,0,0&fov=70&exposure=1.4&diskTemperature=12000'));
  await runCase('path-plunge-t30', shot('preset=ember&quality=medium&path=plunge&t=30'));

  // Determinism: same URL twice must hash identically.
  {
    const q = shot('preset=quasar&quality=medium');
    const a = await runCase('determinism-a', q);
    const b = await runCase('determinism-b', q);
    const same = a.entry.hash && a.entry.hash === b.entry.hash;
    const entry = { name: 'determinism', ok: !!same, hashA: a.entry.hash, hashB: b.entry.hash, problems: same ? [] : ['frame hashes differ'] };
    if (!same) failures++;
    report.cases.push(entry);
    console.log(`${same ? 'PASS' : 'FAIL'}  ${'determinism'.padEnd(34)} hashes ${a.entry.hash} / ${b.entry.hash}`);
  }

  // Interactive: hotkeys + persistence
  await runCase('interactive-hotkeys', '?quality=low', {
    interactive: true,
    after: async (page) => {
      const problems = [];
      await page.keyboard.press('5');
      await page.keyboard.press(']');
      await page.keyboard.press('Space');
      await page.keyboard.press('q');
      await page.waitForTimeout(700);
      const s = await page.evaluate(() => window.__gargantua.state());
      if (s.debug !== 5) problems.push(`hotkey 5 → debug ${s.debug}`);
      if (s.preset !== 'quasar') problems.push(`hotkey ] → preset ${s.preset}`);
      if (!s.paused) problems.push('Space did not pause');
      if (s.quality !== 'medium') problems.push(`q → quality ${s.quality}`);
      await page.keyboard.press('0');
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
      return { problems, stateAfterKeys: s };
    },
  });
  await runCase('interactive-persistence', '?', {
    interactive: true,
    after: async (page) => {
      const problems = [];
      await page.keyboard.press('3');
      await page.keyboard.press('[');   // quasar -> interstellar (state persisted from previous case)
      await page.waitForTimeout(600);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('body[data-ready="1"]', { timeout: 120000 });
      await page.waitForTimeout(300);
      const s = await page.evaluate(() => window.__gargantua.state());
      if (s.debug !== 3) problems.push(`debug not persisted (${s.debug})`);
      if (s.preset !== 'interstellar') problems.push(`preset not persisted (${s.preset})`);
      await page.keyboard.press('0');
      await page.waitForTimeout(500);
      return { problems, persisted: s };
    },
  });

  // Interactive: WebGL context loss and recovery
  await runCase('interactive-context-recovery', '?quality=low&preset=interstellar', {
    interactive: true,
    after: async (page) => {
      const problems = [];
      const before = await page.evaluate(() => window.__gargantua.app.frameIndex);
      const started = await page.evaluate(() => window.__gargantua.simulateContextLoss());
      if (!started) problems.push('WEBGL_lose_context unavailable');
      try {
        await page.waitForFunction(() => !document.getElementById('overlay').hidden, null, { timeout: 5000 });
      } catch { problems.push('overlay did not appear on context loss'); }
      const lostTitle = await page.evaluate(() => document.getElementById('overlay-title').textContent);
      try {
        await page.waitForFunction((b) => document.getElementById('overlay').hidden && window.__gargantua.app.frameIndex > b + 2, before, { timeout: 30000 });
      } catch { problems.push('did not resume rendering after restore'); }
      const after = await page.evaluate(() => window.__gargantua.app.frameIndex);
      await page.waitForTimeout(300);
      return { problems, framesBefore: before, framesAfter: after, lostTitle };
    },
  });

  // Interactive: default page (no query) renders and the GUI/HUD exist
  await runCase('interactive-default', '', {
    interactive: true,
    after: async (page) => {
      const problems = [];
      const ui = await page.evaluate(() => ({
        gui: !!document.querySelector('#gui .lil-gui'),
        hudRows: document.querySelectorAll('#hud .hud-panel tr').length,
        sliders: document.querySelectorAll('#gui .lil-gui .controller.number').length,
      }));
      if (!ui.gui) problems.push('lil-gui panel missing');
      if (ui.hudRows < 10) problems.push('HUD rows missing');
      if (ui.sliders < 21) problems.push(`expected 21 parameter sliders, found ${ui.sliders}`);
      return { problems, ui };
    },
  });

  await browser.close();
  server.close();

  report.failures = failures;
  report.total = report.cases.length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  const lines = [
    `# Browser verification report`,
    ``,
    `Date: ${report.date}  ·  Renderer: ${report.renderer}  ·  Cases: ${report.total}  ·  Failures: ${failures}`,
    ``,
    `| Case | Result | Time | Mean luma | Non-black | Console errors | Notes |`,
    `| --- | --- | ---: | ---: | ---: | ---: | --- |`,
  ];
  for (const c of report.cases) {
    lines.push(`| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.ms ? c.ms + ' ms' : ''} | ${c.meanLuma !== undefined ? fmt(c.meanLuma, 1) : ''} | ${c.nonBlackFrac !== undefined ? fmt(c.nonBlackFrac * 100, 1) + '%' : ''} | ${c.consoleErrors ? c.consoleErrors.length : ''} | ${(c.problems || []).join('; ')} |`);
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');

  console.log(`\n${report.total - failures}/${report.total} cases passed. Report: verify/results/report.md`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
