import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ANCHORS as A, RECORDING_DURATION as D, ANCHOR_KEYS, PARTICLE_COUNT, SPARSE_COUNT,
  validateAnchors, sampleJourney, sampleParticle, sampleInteriorFlash } from '../js/journey.js';
import { MusicTransport } from '../js/music-transport.js';

test('approach never retreats; early reveal and concentrated plunge meet boundaries', () => {
  let last = Infinity;
  let lastProjection = Infinity;
  for (let time = 0; time <= D + 120; time += 0.1) {
    const scene = sampleJourney(time);
    assert.ok(scene.radius <= last + 1e-10);
    assert.ok(Math.abs(Math.hypot(...scene.position) - scene.radius) < 1e-10);
    last = scene.radius;
    const projection = scene.radius * Math.tan(scene.fov * Math.PI / 360);
    assert.ok(projection <= lastProjection + 1e-10, 'apparent size never shrinks');
    lastProjection = projection;
  }
  assert.ok(A.revealEnd <= D / 3);
  assert.equal(sampleJourney(A.revealEnd).phase, 'approach');
  assert.equal(sampleJourney(A.crossing - 0.001).interior, false);
  assert.equal(sampleJourney(A.crossing).interior, true);
  assert.equal(sampleJourney(A.crossing).radius, 1);
  assert.ok(sampleJourney(A.crossing - 1).radius > 5);
  for (const key of ANCHOR_KEYS) {
    const before = sampleJourney(A[key] - 0.00001), after = sampleJourney(A[key] + 0.00001);
    assert.ok(Math.abs(after.radius - before.radius) < 0.001, key);
    assert.ok(Math.abs(after.fov - before.fov) < 0.001, key);
  }
});

test('inward speed increases throughout the approach without a jump at a cue', () => {
  for (const anchors of [A, { revealStart: .1, revealEnd: 1, plungeStart: 2, crossing: 3, thinningStart: 4, sparseAt: 5 }]) {
    const dt = anchors.crossing / 10000;
    const speed = (time) => (sampleJourney(time, anchors).radius - sampleJourney(time + dt, anchors).radius) / dt;
    let previous = 0;
    for (let time = 0; time < anchors.crossing - dt; time += dt * 10) {
      const next = speed(time);
      assert.ok(next >= previous - 1e-8, `deceleration at ${time}`);
      previous = next;
    }
    for (const key of ['revealStart', 'revealEnd', 'plungeStart']) {
      assert.ok(Math.abs(speed(anchors[key]) - speed(anchors[key] - dt)) < speed(anchors.crossing - dt) * 0.002, key);
    }
  }
});

test('cue validation is strict, preserves seconds and copies input', () => {
  const input = { ...A }, valid = validateAnchors(input);
  input.crossing = 1;
  assert.equal(valid.crossing, A.crossing);
  assert.ok(Object.isFrozen(valid));
  assert.deepEqual(validateAnchors(A, 300), A);
  for (const value of [NaN, Infinity, -1, A.plungeStart, D + 1]) {
    assert.throws(() => validateAnchors({ ...A, crossing: value }), RangeError);
  }
  assert.throws(() => validateAnchors(A, 200));
  assert.throws(() => validateAnchors({ ...A, revealEnd: 100 }));
  assert.throws(() => validateAnchors(A, Infinity));
  for (const time of [-1, NaN, Infinity]) assert.throws(() => sampleJourney(time));
  for (const seed of [-1, NaN, 1.5, 2 ** 32]) assert.throws(() => sampleJourney(0, A, seed));
});

test('thinning removes stable identities to a nonzero floor without global dimming', () => {
  let count = PARTICLE_COUNT;
  for (let time = A.thinningStart; time < A.sparseAt + 10; time += 0.1) {
    const next = sampleJourney(time);
    assert.ok(next.particleCount <= count && next.particleCount >= SPARSE_COUNT);
    assert.equal(next.parameters.exposure, 1.05);
    assert.equal(next.parameters.grain, 0);
    count = next.particleCount;
  }
  assert.equal(count, SPARSE_COUNT);
  assert.equal(sampleJourney(D + 86400).particleCount, SPARSE_COUNT);
  const at = sampleJourney(D + 120);
  assert.equal(at.silentTail, true);
  assert.ok(at.motionTime > sampleJourney(D).motionTime);
  assert.deepEqual(sampleJourney(240, A, 12), sampleJourney(240, A, 12));
  assert.deepEqual(sampleParticle(1, at.motionTime, 12), sampleParticle(1, at.motionTime, 12));
  assert.notDeepEqual(sampleParticle(1, 120, 12), sampleParticle(1, 120.2, 12));
  assert.notDeepEqual(sampleParticle(1, 120, 12), sampleParticle(1, 120, 13));
});

test('interior stars accelerate toward the viewer and flashes become rare in the tail', () => {
  for (let id = 0; id < 30; id++) {
    const samples = [0, .001, .002].map((t) => sampleParticle(id, t));
    const radii = samples.map((p) => Math.hypot(p.x, p.y));
    if (radii[0] < radii[1] && radii[1] < radii[2]) {
      assert.ok(radii[2] - radii[1] >= radii[1] - radii[0]);
      assert.ok(Math.hypot(samples[1].dx, samples[1].dy) >= Math.hypot(samples[0].dx, samples[0].dy));
    }
  }
  assert.equal(sampleInteriorFlash(0.1).strength, 1);
  assert.equal(sampleInteriorFlash(1).strength, 0);
  const peak = sampleInteriorFlash(4.3, 7);
  assert.deepEqual(sampleInteriorFlash(4.3, 7), peak);
  assert.notEqual(sampleInteriorFlash(8.5, 7).angle, peak.angle);
  const events = Array.from({ length: 100 }, (_, i) => sampleInteriorFlash(i * 4.2 + .1, 7, SPARSE_COUNT / PARTICLE_COUNT));
  const flashes = events.filter((event) => event.strength > 0);
  assert.ok(flashes.length > 0 && flashes.length < 20);
});

class FakeAudio extends EventTarget {
  constructor() { super(); this.duration = D; this.currentTime = 0; this.paused = true; this.src = ''; this.playCalls = 0; }
  load() { if (this.src && !this.manual) queueMicrotask(() => this.dispatchEvent(new Event(this.failLoad ? 'error' : 'loadedmetadata'))); }
  removeAttribute() { this.src = ''; }
  pause() { this.paused = true; }
  play() { this.playCalls++; this.paused = false; return this.playResult?.() ?? Promise.resolve(); }
  end() { this.paused = true; this.currentTime = this.duration; this.onended?.(); }
}
function harness(configure = () => {}) {
  let seconds = 0, index = 0;
  const audios = [], revoked = [];
  const transport = new MusicTransport({
    audioFactory: () => { const audio = new FakeAudio(); configure(audio); audios.push(audio); return audio; },
    now: () => seconds, createURL: () => `blob:fixture-${++index}`, revokeURL: (url) => revoked.push(url), loadTimeout: 30,
  });
  return { transport, audios, revoked, advance: (delta) => { seconds += delta; } };
}
const file = { name: 'synthetic.wav', size: 100 };

test('default URL recording starts at zero and is not revoked as a local blob', async () => {
  const { transport: t, audios, revoked } = harness();
  const url = 'http://localhost/media/exit-music.mp3';
  assert.equal(await t.loadUrl(url, 'Exit Music'), true);
  assert.equal(audios[0].src, url);
  assert.equal(t.name, 'Exit Music');
  assert.equal(t.time(), 0);
  await t.play();
  assert.equal(audios[0].currentTime, 0);
  await t.load(file);
  assert.equal(audios[0].src, '');
  assert.deepEqual(revoked, []);
  t.dispose();
  assert.deepEqual(revoked, ['blob:fixture-1']);
});

test('audio is authoritative; seeks reconstruct, pause freezes, natural end starts silent monotonic tail', async () => {
  const { transport: t, audios, advance } = harness();
  assert.equal(await t.load(file), true);
  assert.equal(await t.play(), true);
  const audio = audios[0];
  assert.equal(audio.loop, false);
  advance(120);
  audio.currentTime = 52;
  assert.equal(t.time(), 52);
  t.pause();
  audio.currentTime = 53;
  advance(10);
  assert.equal(t.time(), 52);
  await t.seek(12);
  assert.equal(audio.currentTime, 12);
  assert.equal(t.playing, false);
  await t.play();
  await t.seek(230);
  assert.equal(t.playing, true);
  assert.equal(t.time(), 230);
  audio.end();
  const plays = audio.playCalls;
  advance(120);
  assert.equal(t.time(), D + 120);
  assert.equal(t.tail, true);
  assert.equal(audio.paused, true);
  assert.equal(audio.playCalls, plays);
  t.pause(); advance(120);
  assert.equal(t.time(), D + 120);
  await t.play(); advance(2);
  assert.equal(t.time(), D + 122);
  assert.equal(audio.playCalls, plays);
  await t.seek(30);
  assert.equal(t.tail, false);
  assert.equal(t.time(), 30);
  t.stop();
  assert.equal(t.time(), 0);
  assert.equal(t.playing, false);
  await t.restart();
  assert.equal(t.time(), 0);
  t.dispose();
});

test('invalid seeks leave the last position and playback untouched', async () => {
  const { transport: t } = harness();
  await t.load(file); await t.seek(34);
  for (const value of [-1, Infinity, NaN, D + 1, '12']) assert.throws(() => t.seek(value), RangeError);
  assert.equal(t.time(), 34);
  await t.seek(D);
  await t.play();
  assert.equal(t.tail, true);
  t.dispose();
});

test('native pause reconciles transport, ignores stale pause events, and preserves the silent tail', async () => {
  const { transport: t, audios, advance } = harness();
  await t.load(file); await t.play();
  const audio = audios[0];
  audio.currentTime = 11;
  audio.pause(); audio.onpause();
  assert.equal(t.status, 'paused');
  assert.equal(t.time(), 11);
  advance(10);
  assert.equal(t.time(), 11);
  await t.play();
  audio.onpause(); // An old queued event after playback resumed must not pause it.
  assert.equal(t.playing, true);
  audio.end(); advance(120); audio.onpause();
  assert.equal(t.playing, true);
  assert.equal(t.time(), D + 120);
  t.dispose();
});

test('end arriving before the play promise settles keeps the tail and ignores duplicate end events', async () => {
  const { transport: t, audios, advance } = harness();
  await t.load(file);
  let resolve;
  audios[0].playResult = () => new Promise((done) => { resolve = done; });
  const pending = t.play();
  audios[0].end();
  advance(5);
  audios[0].end();
  resolve();
  assert.equal(await pending, true);
  assert.equal(t.tail, true);
  assert.equal(t.time(), D + 5);
  t.dispose();
});

test('play rejection is stopped and retryable; late promises cannot undo pause, stop, or replacement', async () => {
  const { transport: t, audios } = harness();
  await t.load(file);
  const audio = audios[0];
  audio.playResult = () => Promise.reject(new Error('gesture required'));
  assert.equal(await t.play(), false);
  assert.equal(t.playing, false);
  assert.equal(audio.paused, true);
  assert.match(t.error, /retry/);
  audio.playResult = undefined;
  assert.equal(await t.play(), true);
  t.pause();
  let resolve;
  audio.playResult = () => new Promise((done) => { resolve = done; });
  const pending = t.play();
  t.stop(); resolve();
  assert.equal(await pending, false);
  assert.equal(t.status, 'stopped');
  const otherPending = t.play();
  const complete = resolve;
  await t.load({ ...file, name: 'replacement.wav' });
  complete();
  assert.equal(await otherPending, false);
  assert.equal(t.status, 'stopped');
  t.dispose();
});

test('source errors, duration errors, timeouts, replacement and disposal release local URLs', async () => {
  const { transport: t, audios, revoked } = harness((audio) => { audio.manual = true; });
  assert.equal(await t.load(null), false);
  const pending = t.load(file);
  t.pause();
  assert.equal(t.status, 'loading');
  audios[0].dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await pending, true);
  const stopped = t.load(file);
  t.stop();
  assert.equal(await stopped, false);
  assert.equal(t.status, 'stopped');
  assert.equal(t.audio, null);
  const old = t.load(file);
  const latest = t.load(file);
  audios.at(-1).dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await old, false);
  assert.equal(await latest, true);
  const failed = t.load(file);
  audios.at(-1).dispatchEvent(new Event('error'));
  assert.equal(await failed, false);
  const invalid = t.load(file);
  audios.at(-1).duration = Infinity;
  audios.at(-1).dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await invalid, false);
  assert.match(t.error, /finite duration/);
  assert.equal(await t.load(file), false);
  assert.match(t.error, /too long/);
  t.dispose();
  assert.equal(revoked.length, audios.length);
  assert.equal(new Set(revoked).size, revoked.length);
});

test('replacement duration is reported and never silently changes authored cues', async () => {
  const { transport: t } = harness((audio) => { audio.duration = 300; });
  await t.load(file);
  assert.equal(t.duration, 300);
  assert.match(t.warning, /Cue seconds are unchanged/);
  assert.equal(A.crossing, 218);
  t.audio.onerror();
  assert.equal(t.loaded, false);
  assert.equal(t.playing, false);
  t.dispose();
});
