// One-shot media clock, then an unbounded monotonic silent clock. No RAF deltas.
import { RECORDING_DURATION } from './journey.js';

export class MusicTransport {
  constructor({ audioFactory = () => new Audio(), now = () => performance.now() / 1000,
    createURL = (file) => URL.createObjectURL(file), revokeURL = (url) => URL.revokeObjectURL(url), loadTimeout = 15000 } = {}) {
    Object.assign(this, { audioFactory, now, createURL, revokeURL, loadTimeout });
    this.audio = null;
    this.url = null;
    this.duration = 0;
    this.name = '';
    this.status = 'stopped';
    this.loaded = false;
    this.position = 0;
    this.tail = false;
    this.tailStarted = 0;
    this.error = '';
    this.warning = '';
    this.generation = 0;
    this.listeners = new Set();
  }

  get playing() { return this.status === 'playing'; }
  get busy() { return this.status === 'starting' || this.status === 'loading'; }
  time() {
    if (this.tail) return this.position + (this.playing ? Math.max(0, this.now() - this.tailStarted) : 0);
    return this.audio && (this.playing || this.status === 'starting')
      ? Math.max(0, Math.min(this.duration, this.audio.currentTime)) : this.position;
  }
  snapshot() {
    return { status: this.status, playing: this.playing, loaded: this.loaded, time: this.time(),
      duration: this.duration, name: this.name, tail: this.tail, error: this.error, warning: this.warning };
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { for (const fn of this.listeners) fn(this.snapshot()); }

  _release() {
    this.cancelLoad?.();
    this.cancelLoad = null;
    if (this.audio) {
      this.audio.onended = this.audio.onerror = this.audio.onpause = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (this.url) this.revokeURL(this.url);
    this.url = null;
    this.audio = null;
    this.loaded = false;
  }

  async load(file) {
    this.stop();
    this._release();
    const generation = ++this.generation;
    this.duration = 0;
    this.name = file?.name || '';
    this.error = this.warning = '';
    if (!file || !file.size) { this.error = 'Choose a readable, nonempty audio file.'; this.notify(); return false; }
    this.status = 'loading';
    this.notify();
    try {
      const audio = this.audio = this.audioFactory();
      audio.preload = 'auto';
      audio.loop = false;
      this.url = this.createURL(file);
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          audio.removeEventListener('loadedmetadata', ready);
          audio.removeEventListener('error', failed);
          this.cancelLoad = null;
          error ? reject(error) : resolve();
        };
        const ready = () => finish();
        const failed = () => finish(new Error('The recording could not be read. Choose another audio file.'));
        const timer = setTimeout(() => finish(new Error('The recording took too long to load. Please retry.')), this.loadTimeout);
        this.cancelLoad = () => finish(new Error('Recording selection replaced.'));
        audio.addEventListener('loadedmetadata', ready);
        audio.addEventListener('error', failed);
        audio.src = this.url;
        audio.load();
      });
      if (generation !== this.generation) return false;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error('The recording has no usable finite duration.');
      this.duration = audio.duration;
      this.loaded = true;
      this.status = 'stopped';
      if (Math.abs(this.duration - RECORDING_DURATION) > 0.25) {
        this.warning = `Recording is ${this.duration.toFixed(3)} s; expected ${RECORDING_DURATION} s. Cue seconds are unchanged. Review the cues before starting.`;
      }
      audio.onended = () => {
        if (this.audio !== audio || (!this.playing && this.status !== 'starting')) return;
        if (this.tail) return;
        audio.pause();
        this.position = this.duration;
        this.tail = true;
        this.tailStarted = this.now();
        this.status = 'playing';
        this.notify();
      };
      audio.onpause = () => {
        // Media controls and browser interruptions can pause outside our UI.
        // Ignore delayed events from internal seeks and the natural end pause.
        if (this.audio !== audio || !audio.paused || audio.ended || this.tail) return;
        if (this.playing || this.status === 'starting') this.pause();
      };
      audio.onerror = () => {
        if (this.audio !== audio) return;
        this.pause();
        this.error = 'Recording playback failed. Select the file again to retry.';
        this.loaded = false;
        this.notify();
      };
      this.notify();
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this._release();
      this.status = 'stopped';
      this.error = error.message;
      this.notify();
      return false;
    }
  }

  async play() {
    if (this.playing) return true;
    if (!this.loaded || this.status === 'loading') { this.error = 'Choose a recording first.'; this.notify(); return false; }
    const generation = ++this.generation;
    const audio = this.audio;
    this.error = '';
    if (this.tail) {
      this.tailStarted = this.now();
      this.status = 'playing';
      this.notify();
      return true;
    }
    this.status = 'starting';
    this.notify();
    try {
      audio.currentTime = this.position;
      await audio.play();
      if (generation !== this.generation) return false;
      this.status = 'playing';
      this.notify();
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      audio.pause();
      this.status = 'paused';
      this.error = `Playback could not start. Press Start / Resume to retry. ${error.message || ''}`;
      this.notify();
      return false;
    }
  }

  pause() {
    if (this.status === 'loading') return; // Metadata loading has no running clock to pause.
    const position = this.time();
    ++this.generation;
    this.audio?.pause();
    this.position = position;
    this.status = this.loaded ? 'paused' : 'stopped';
    this.notify();
  }

  seek(seconds) {
    if (!this.loaded || !Number.isFinite(seconds) || seconds < 0 || seconds > this.duration) {
      throw new RangeError('Seek must be finite seconds within the loaded recording.');
    }
    const resume = this.playing || this.status === 'starting';
    this.pause();
    this.tail = seconds === this.duration;
    this.position = seconds;
    this.audio.currentTime = seconds;
    this.notify();
    return resume ? this.play() : Promise.resolve(true);
  }

  restart() { this.stop(); return this.play(); }
  stop() {
    ++this.generation;
    if (this.status === 'loading') this._release();
    this.audio?.pause();
    this.position = 0;
    this.tail = false;
    this.status = 'stopped';
    if (this.loaded) this.audio.currentTime = 0;
    this.notify();
  }
  dispose() { this.stop(); this._release(); this.listeners.clear(); }
}
