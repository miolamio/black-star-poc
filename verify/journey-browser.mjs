#!/usr/bin/env node
// Browser lifecycle and deterministic GPU captures using generated WAV fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, listen } from './serve.mjs';
import { RECORDING_DURATION, DEFAULT_ANCHORS } from '../js/journey.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'verify/results/journey');
async function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return await import(name); } catch { /* global CLI fallback */ }
  }
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  for (const name of ['playwright', 'playwright-core', '@playwright/cli/node_modules/playwright-core']) {
    const file = path.join(globalRoot, name, 'index.mjs');
    if (fs.existsSync(file)) return import(pathToFileURL(file).href);
  }
  throw new Error('Install Playwright: npm install && npx playwright install chromium');
}

function wav(duration) {
  const rate = 8000, length = Math.floor(duration * rate), buffer = Buffer.alloc(44 + length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / rate) * 100), 44 + i * 2);
  return buffer;
}

function pixels() {
  const app = window.__gargantua;
  app.renderOnce();
  const source = document.getElementById('view'), canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let max = 0, lit = 0, sum = 0, hash = 2166136261 >>> 0;
  for (let i = 0; i < data.length; i += 4) {
    const light = Math.max(data[i], data[i + 1], data[i + 2]);
    max = Math.max(max, light); if (light > 6) lit++;
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    for (let c = 0; c < 3; c++) { hash ^= data[i + c]; hash = Math.imul(hash, 16777619) >>> 0; }
  }
  return { max, litFraction: lit / (data.length / 4), mean: sum / (data.length / 4), hash, scene: app.journey.state().scene };
}

const pw = await loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const server = createServer(ROOT), port = await listen(server, 0);
let browser;
try {
  browser = await pw.chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const base = `http://127.0.0.1:${port}/`;
  await page.goto(`${base}?quality=low`);
  await page.waitForFunction(() => window.__gargantua?.ready);
  let lab = await page.evaluate(() => {
    const g = window.__gargantua; g.app.setPaused(true); g.setPath('free');
    return { params: g.params(), state: g.state(), position: g.app.camera.position.toArray(), fov: g.app.camera.fov };
  });
  await page.waitForTimeout(400);
  let persisted = await page.evaluate(() => localStorage.getItem('gargantua.v1'));
  await page.locator('#journey-toggle').click();
  // Exercise the real synth, not a disabled no-op path.
  await page.evaluate(() => window.__gargantua.app.setAudio(true));
  await page.waitForFunction(() => {
    const audio = window.__gargantua.app.audio;
    return audio.enabled && audio.ctx.state === 'running' && audio.n.master.gain.value > 0.1;
  });
  await page.locator('#journey-file').setInputFiles({ name: 'synthetic.wav', mimeType: 'audio/wav', buffer: wav(RECORDING_DURATION) });
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.loaded);
  const duration = await page.evaluate(() => window.__gargantua.journey.state().transport.duration);
  assert.ok(Math.abs(duration - RECORDING_DURATION) < 0.001);
  // A rejected media play must exit the just-entered performance, preserve the
  // retryable source, and leave both transport and scene stopped.
  const failedStart = await page.evaluate(async () => {
    const g = window.__gargantua, audio = g.app.music.audio, original = audio.play;
    audio.play = () => Promise.reject(new Error('Synthetic gesture rejection'));
    const ok = await g.journey.start();
    audio.play = original;
    return { ok, state: g.journey.state() };
  });
  assert.equal(failedStart.ok, false); assert.equal(failedStart.state.active, false);
  assert.equal(failedStart.state.transport.loaded, true); assert.equal(failedStart.state.transport.time, 0);
  await page.waitForFunction(() => window.__gargantua.app.audio.enabled && window.__gargantua.app.audio.ctx.state === 'running');

  // Native SUMMARY and initial Start BUTTON Space activation must not toggle
  // laboratory pause; the same controls retain native activation in performance.
  const summary = page.locator('#journey-cues summary');
  await summary.focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#journey-cues').evaluate((element) => element.open), true);
  assert.equal(await page.evaluate(() => window.__gargantua.state().paused), true);
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#journey-cues').evaluate((element) => element.open), false);
  await page.locator('#journey-start').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.playing);
  assert.equal(await page.evaluate(() => window.__gargantua.state().paused), true);
  await page.evaluate(() => { window.__gargantua.journey.stop(); window.__gargantua.app.journeyUI.show(); });
  await page.waitForFunction(() => window.__gargantua.app.audio.enabled && window.__gargantua.app.audio.ctx.state === 'running');

  // Edit and enter in the same task, before the deferred laboratory save can fire.
  const entry = await page.evaluate(() => {
    const g = window.__gargantua;
    g.app.params.exposure = 1.23; g.app.onParamChanged();
    const pending = !!g.app.saveTimer;
    const lab = { params: g.params(), state: g.state(), position: g.app.camera.position.toArray(), fov: g.app.camera.fov };
    const input = document.getElementById('journey-timeline');
    input.value = '52'; input.dispatchEvent(new Event('input', { bubbles: true }));
    return { pending, lab, persisted: localStorage.getItem('gargantua.v1') };
  });
  assert.equal(entry.pending, true); assert.equal(JSON.parse(entry.persisted).params.exposure, 1.23);
  lab = entry.lab; persisted = entry.persisted;
  // AudioParam.value reports the audio thread's last rendered value. Read it
  // after immediate suspension completes, not before the next audio quantum.
  await page.waitForFunction(() => window.__gargantua.app.audio.ctx.state === 'suspended', null, { polling: 10, timeout: 1000 });
  assert.equal(await page.evaluate(() => window.__gargantua.app.audio.n.master.gain.value), 0, 'synth must already be silent on suspension');
  const scrubbed = await page.evaluate(() => window.__gargantua.journey.state());
  assert.equal(scrubbed.active, true); assert.equal(scrubbed.transport.playing, false);
  assert.equal(scrubbed.scene.time, 52); assert.equal(scrubbed.scene.phase, 'approach');
  await page.locator('#journey-start').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.playing);
  assert.equal(await page.locator('#journey-panel').isVisible(), false);
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.playing), false);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.playing);
  await page.keyboard.press('q');
  assert.equal(await page.evaluate(() => window.__gargantua.state().quality), 'medium');
  assert.equal(await page.evaluate(() => window.__gargantua.app.audio.ctx.state), 'suspended');
  await page.evaluate(() => window.__gargantua.app.journeyUI.show());
  await summary.focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#journey-cues').evaluate((element) => element.open), true);
  assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.playing), true);
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#journey-cues').evaluate((element) => element.open), false);

  // A focused, idle range must keep following playback.
  await page.locator('#journey-timeline').focus();
  const thumb = Number(await page.locator('#journey-timeline').inputValue());
  await page.waitForFunction((before) => Number(document.getElementById('journey-timeline').value) > before + 0.05, thumb);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'journey-timeline');

  // Reconcile a real native media-element pause with the existing transport UI.
  await page.evaluate(() => window.__gargantua.app.music.audio.pause());
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.status === 'paused');
  assert.equal(await page.locator('#journey-start').isEnabled(), true);
  const nativePauseTime = await page.evaluate(() => window.__gargantua.journey.state().transport.time);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.time), nativePauseTime);
  await page.locator('#journey-start').click();
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.playing && !window.__gargantua.app.music.audio.paused);
  await page.evaluate(() => window.__gargantua.journey.pause());
  const pausedTime = await page.evaluate(() => window.__gargantua.journey.state().transport.time);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.time), pausedTime);
  const sync = await page.evaluate(() => {
    const g = window.__gargantua; g.renderOnce();
    return { sample: g.journey.state().scene.time, media: g.app.music.audio.currentTime };
  });
  assert.ok(Math.abs(sync.sample - sync.media) < 0.001);
  await page.evaluate(() => window.__gargantua.journey.seek(59.96));
  assert.match(await page.locator('#journey-clock').textContent(), /^1:00\.0 /);
  await page.evaluate(() => window.__gargantua.journey.seek(52));

  const invalid = await page.evaluate(() => {
    const j = window.__gargantua.journey, before = j.state(); let rejected = 0;
    for (const value of [NaN, Infinity, -1, before.transport.duration + 1]) { try { j.seek(value); } catch { rejected++; } }
    try { j.setAnchors({ ...before.anchors, crossing: 1 }); } catch { rejected++; }
    return { before, after: j.state(), rejected };
  });
  assert.equal(invalid.rejected, 5);
  assert.deepEqual(invalid.after.anchors, invalid.before.anchors);
  assert.equal(invalid.after.transport.time, invalid.before.transport.time);
  await page.mouse.click(600, 260);
  await page.keyboard.press('c'); await page.keyboard.press(']'); await page.keyboard.press('5');
  assert.deepEqual(await page.evaluate(() => window.__gargantua.params()), lab.params);
  assert.equal(await page.evaluate(() => window.__gargantua.state().path), 'free');
  assert.equal(await page.evaluate(() => window.__gargantua.state().debug), lab.state.debug);

  await page.evaluate(() => window.__gargantua.journey.seek(222));
  await page.setViewportSize({ width: 720, height: 480 });
  await page.waitForFunction(() => window.__gargantua.app.interior.material.uniforms.uAspect.value === 1.5);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.waitForFunction(() => Math.abs(window.__gargantua.app.interior.material.uniforms.uAspect.value - 640 / 360) < 0.001);
  const first = await page.evaluate(pixels);
  await page.evaluate(() => window.__gargantua.journey.seek(52));
  await page.evaluate(() => window.__gargantua.journey.seek(222));
  const second = await page.evaluate(pixels);
  assert.equal(first.hash, second.hash);
  assert.ok(first.max >= 35 && first.max < 170, `interior highlight max ${first.max}`);
  assert.ok(first.mean < 3 && first.litFraction < 0.06, `interior must stay dark: ${JSON.stringify(first)}`);

  await page.evaluate(() => window.__gargantua.journey.start());
  assert.equal(await page.evaluate(() => window.__gargantua.simulateContextLoss()), true);
  await page.waitForFunction(() => window.__gargantua.app.contextLost);
  const lost = await page.evaluate(() => window.__gargantua.journey.state().transport.time);
  await page.waitForFunction(() => !window.__gargantua.app.contextLost && document.getElementById('overlay').hidden, null, { timeout: 30000 });
  const restored = await page.evaluate(() => { window.__gargantua.renderOnce(); return window.__gargantua.journey.state(); });
  assert.equal(restored.transport.playing, false); assert.equal(restored.transport.time, lost);
  assert.equal(restored.scene.time, lost);

  // Natural ended event, then advance only the monotonic tail source by 120 s.
  await page.evaluate((seconds) => window.__gargantua.journey.seek(seconds), duration - 0.12);
  await page.evaluate(() => window.__gargantua.journey.start());
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.tail, null, { timeout: 10000 });
  const tail = await page.evaluate(() => {
    const g = window.__gargantua, music = g.app.music, original = music.now;
    music.now = () => original() + 120;
    g.renderOnce();
    return { state: g.journey.state(), audio: { paused: music.audio.paused, loop: music.audio.loop, time: music.audio.currentTime } };
  });
  assert.ok(tail.state.transport.time >= duration + 120);
  assert.equal(tail.state.scene.particleCount, 3);
  assert.equal(tail.audio.paused, true); assert.equal(tail.audio.loop, false);
  assert.ok(Math.abs(tail.audio.time - duration) < 0.001);
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate((before) => { window.__gargantua.renderOnce(); return window.__gargantua.journey.state().scene.motionTime > before; }, tail.state.scene.motionTime));
  await page.evaluate(() => window.__gargantua.journey.pause());
  const tailPause = await page.evaluate(() => window.__gargantua.journey.state().transport.time);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.time), tailPause);
  await page.evaluate(() => window.__gargantua.journey.restart());
  assert.ok(await page.evaluate(() => window.__gargantua.journey.state().transport.time < 2));
  assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.tail), false);
  await page.evaluate(() => window.__gargantua.app.journeyUI.show());
  await page.locator('#journey-timeline').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const audio = window.__gargantua.app.audio;
    return audio.enabled && audio.ctx.state === 'running' && audio.n.master.gain.value > 0.1;
  });
  const stopped = await page.evaluate(() => {
    const g = window.__gargantua;
    return { journey: g.journey.state(), state: g.state(), params: g.params(), position: g.app.camera.position.toArray(), fov: g.app.camera.fov,
      persisted: localStorage.getItem('gargantua.v1'), interiorReleased: g.app.interior === null, enabled: g.app.controls.enabled };
  });
  assert.equal(stopped.journey.active, false); assert.equal(stopped.journey.transport.time, 0);
  assert.deepEqual(stopped.params, lab.params); assert.deepEqual(stopped.state, lab.state);
  assert.deepEqual(stopped.position, lab.position); assert.equal(stopped.fov, lab.fov);
  assert.equal(stopped.persisted, persisted); assert.equal(stopped.interiorReleased, true); assert.equal(stopped.enabled, true);

  // Runtime errors must surface even after successful playback hides controls.
  await page.locator('#journey-start').click();
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.playing);
  assert.equal(await page.locator('#journey-panel').isVisible(), false);
  await page.evaluate(() => window.__gargantua.app.music.audio.dispatchEvent(new Event('error')));
  assert.equal(await page.locator('#journey-panel').isVisible(), true);
  assert.match(await page.locator('#journey-message').textContent(), /Recording playback failed/);
  assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.playing), false);

  await page.locator('#journey-file').setInputFiles({ name: 'short.wav', mimeType: 'audio/wav', buffer: wav(6) });
  await page.waitForFunction(() => window.__gargantua.journey.state().transport.loaded && window.__gargantua.journey.state().transport.duration === 6);
  assert.deepEqual(await page.evaluate(() => window.__gargantua.journey.state().anchors), DEFAULT_ANCHORS);
  assert.match(await page.locator('#journey-message').textContent(), /Cue seconds are unchanged/);
  assert.equal(await page.evaluate(() => window.__gargantua.journey.start()), false);
  const custom = { revealStart: .1, revealEnd: 1, plungeStart: 2, crossing: 3, thinningStart: 4, sparseAt: 5 };
  await summary.click();
  for (const [key, value] of Object.entries(custom)) await page.locator(`#journey-cue-form input[name="${key}"]`).fill(String(value));
  await page.locator('#journey-cue-form button').click();
  assert.deepEqual(await page.evaluate(() => window.__gargantua.journey.state().anchors), custom);
  await page.evaluate(() => window.__gargantua.journey.seek(2.999));
  const beforeCrossing = await page.evaluate(pixels);
  assert.equal(beforeCrossing.scene.interior, false);
  await page.evaluate(() => window.__gargantua.journey.seek(3));
  const atCrossing = await page.evaluate(pixels);
  assert.equal(atCrossing.scene.interior, true);
  assert.notEqual(beforeCrossing.hash, atCrossing.hash);
  await page.locator('#journey-cue-form input[name="crossing"]').fill('1.5');
  await page.locator('#journey-cue-form button').click();
  assert.deepEqual(await page.evaluate(() => window.__gargantua.journey.state().anchors), custom);
  assert.match(await page.locator('#journey-message').textContent(), /Previous cues are still active/);
  assert.equal(await page.evaluate(() => window.__gargantua.journey.start()), true);
  await page.evaluate(() => window.__gargantua.journey.stop());
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS  recording, scrub, playback, pause, seek, restart, end, +120 s silent tail, stop, GPU recovery, laboratory isolation, cue validation');

  const captures = [];
  for (const time of [0, 52, 160, 208, 217, 218, 222, 245, 265.227, 385.227, 385.427, 385.827, 386.227]) {
    await page.goto(`${base}?shot=1&journey=exit-music&t=${time}&seed=7&w=640&h=360&quality=medium`);
    await page.waitForFunction(() => window.__gargantua?.ready);
    const capture = await page.evaluate(pixels);
    captures.push({ time, ...capture });
    if (time === 208 || time === 217) assert.ok(capture.litFraction > 0.005, `premature blackout at ${time}`);
    if (time >= 218) { assert.ok(capture.mean < 3); assert.ok(capture.litFraction < 0.06); assert.ok(capture.max < 170); }
    if (time <= 245) await page.locator('#view').screenshot({ path: path.join(OUT, `phase-${time}.png`) });
    assert.equal(await page.evaluate(() => window.__gargantua.journey.state().transport.loaded), false);
  }
  const tailCaptures = captures.filter((capture) => capture.time >= 385);
  assert.ok(tailCaptures.some((capture) => capture.max >= 25), 'tail needs visible local flashes');
  assert.ok(new Set(tailCaptures.map((capture) => capture.hash)).size > 1, 'tail must remain animated');
  await page.goto(`${base}?shot=1&journey=exit-music&t=222&seed=7&w=640&h=360&quality=medium`);
  await page.waitForFunction(() => window.__gargantua?.ready);
  assert.equal((await page.evaluate(pixels)).hash, captures.find((capture) => capture.time === 222).hash);
  assert.equal(errors.length, 0, errors.join('\n'));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ captures, errors }, null, 2));
  console.log(`PASS  deterministic phase captures, visible pre-crossing disk, dark interior, animated sparse tail (${OUT})`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
