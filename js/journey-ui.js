import { ANCHOR_KEYS } from './journey.js';

const LABELS = {
  revealStart: 'Reveal starts', revealEnd: 'Reveal complete', plungeStart: 'Plunge starts',
  crossing: 'Crossing · provisional', thinningStart: 'Thinning starts', sparseAt: 'Sparse tail begins',
};
const clock = (t) => {
  const tenths = Math.round(t * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

export class JourneyUI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.message = '';
    this.lastUpdate = 0;
    this.scrubbing = false;
    root.innerHTML = `
      <button id="journey-toggle" aria-controls="journey-panel" aria-expanded="false">Exit Music · performance</button>
      <div id="journey-panel" hidden>
        <h2>Exit Music</h2>
        <p class="journey-intro">One journey across the event horizon.<br>The interior is artistic imagery.</p>
        <label class="journey-file">Local recording<input id="journey-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"></label>
        <p id="journey-recording">Choose your local recording. Audio stays on this device.</p>
        <div class="journey-buttons">
          <button id="journey-start" disabled>Start</button>
          <button id="journey-pause" disabled>Pause</button>
          <button id="journey-restart" disabled>Restart</button>
          <button id="journey-stop" disabled>Stop</button>
        </div>
        <label for="journey-timeline">Recording position <output id="journey-clock">0:00.0</output></label>
        <input id="journey-timeline" type="range" min="0" max="265.227" step="0.01" value="0" disabled>
        <p id="journey-phase">The recording plays once; the silent tail continues until Stop.</p>
        <details id="journey-cues">
          <summary>Timing cues · crossing is provisional</summary>
          <p>Seconds in the selected recording. Preview around the closing vocal climax, then adjust the crossing. Cues are never rescaled.</p>
          <form id="journey-cue-form">
            ${ANCHOR_KEYS.map((key) => `<label>${LABELS[key]}<input name="${key}" type="number" min="0" step="0.001" required></label>`).join('')}
            <button type="submit">Apply cues</button>
          </form>
        </details>
        <p id="journey-message" role="status" aria-live="polite"></p>
        <p class="journey-help">Space: pause / resume · Esc: stop · G: controls · Q: quality · F: fullscreen</p>
        <button id="journey-hide">Hide controls</button>
      </div>`;
    this.$ = (id) => root.querySelector(`#journey-${id}`);
    this.$('toggle').onclick = () => this.toggle();
    this.$('hide').onclick = () => this.toggle(false);
    this.$('file').onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      this.message = '';
      await app.loadRecording(file);
      event.target.value = '';
      this.update(true);
    };
    this.$('start').onclick = () => this.run(() => app.startJourney(), true);
    this.$('pause').onclick = () => app.pauseJourney();
    this.$('restart').onclick = () => this.run(() => app.startJourney({ restart: true }), true);
    this.$('stop').onclick = () => { app.stopJourney(); this.show(); };
    this.$('timeline').oninput = (event) => this.run(() => app.seekJourney(Number(event.target.value)));
    const endScrub = () => { this.scrubbing = false; this.update(true); };
    this.$('timeline').onpointerdown = () => { this.scrubbing = true; };
    this.$('timeline').onkeydown = (event) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) this.scrubbing = true;
    };
    this.$('timeline').onkeyup = this.$('timeline').onblur = endScrub;
    window.addEventListener('pointerup', endScrub);
    window.addEventListener('pointercancel', endScrub);
    this.$('cue-form').onsubmit = (event) => {
      event.preventDefault();
      const next = Object.fromEntries(ANCHOR_KEYS.map((key) => [key, Number(event.target.elements.namedItem(key).value)]));
      try { app.setJourneyAnchors(next); this.setMessage('Cues applied. Crossing remains provisional until you calibrate it by ear.'); }
      catch (error) { this.setMessage(error.message + ' Previous cues are still active.'); }
    };
    this.syncCues();
    this.unsubscribe = app.music.subscribe((state) => {
      if (state.error) this.show();
      this.update(true);
    });
    this.update(true);
  }
  async run(action, hideOnSuccess = false) {
    this.message = '';
    try {
      if (await action() && hideOnSuccess) {
        this.toggle(false);
        this.app.canvas.focus({ preventScroll: true });
      }
    }
    catch (error) { this.message = error.message; }
    this.update(true);
  }
  show() { this.toggle(true); }
  toggle(show = this.$('panel').hidden) {
    this.$('panel').hidden = !show;
    this.$('toggle').setAttribute('aria-expanded', String(show));
    if (!show && this.$('panel').contains(document.activeElement)) this.$('toggle').focus();
  }
  setMessage(message) { this.message = message; this.update(true); }
  syncCues() {
    for (const key of ANCHOR_KEYS) this.$('cue-form').elements.namedItem(key).value = this.app.journeyAnchors[key];
  }
  update(force = false) {
    const now = performance.now();
    if (!force && now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    const app = this.app, t = app.music.snapshot();
    this.$('recording').textContent = t.name
      ? `${t.name} · ${t.loaded ? t.duration.toFixed(3) + ' s' : t.status === 'loading' ? 'Loading…' : 'Unavailable'}`
      : 'Choose your local recording. Audio stays on this device.';
    this.$('start').textContent = app.journeyActive ? 'Resume' : 'Start';
    this.$('start').disabled = !t.loaded || t.playing || app.music.busy || app.contextLost;
    this.$('pause').disabled = !t.playing && t.status !== 'starting';
    this.$('restart').disabled = !t.loaded || app.music.busy || app.contextLost;
    this.$('stop').disabled = !app.journeyActive && !app.music.busy;
    this.$('timeline').disabled = !t.loaded || app.contextLost;
    this.$('timeline').max = t.duration || 265.227;
    if (!this.scrubbing) this.$('timeline').value = Math.min(t.time, t.duration);
    this.$('clock').textContent = t.tail ? `Silent tail +${clock(t.time - t.duration)}` : `${clock(t.time)} / ${clock(t.duration)}`;
    const phase = app.journeySample?.phase;
    this.$('phase').textContent = app.journeyActive
      ? `${app.journeyCaptureTime !== null ? 'Deterministic preview · ' : ''}${phase || 'opening'}${t.tail ? ' · silent, continues until Stop' : ''}`
      : 'The recording plays once; the silent tail continues until Stop.';
    this.$('message').textContent = [this.message, t.error, t.warning].filter(Boolean).join(' ');
    this.$('toggle').textContent = app.journeyActive ? 'Exit Music · controls' : 'Exit Music · performance';
  }
}
