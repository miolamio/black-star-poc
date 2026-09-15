// Optional procedural audio: a synthesized drone whose pitch follows the gravitational
// redshift at the camera radius, filtered noise driven by disk temperature/brightness,
// and a pulse locked to the disk spin. No audio files; WebAudio only.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.available = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.n = null;
  }

  _build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const n = {};

    n.master = ctx.createGain();
    n.master.gain.value = 0;
    n.comp = ctx.createDynamicsCompressor();
    n.comp.threshold.value = -18;
    n.comp.ratio.value = 4;
    n.master.connect(n.comp).connect(ctx.destination);

    // Drone: two detuned saws + sub sine through a resonant low-pass.
    n.lp = ctx.createBiquadFilter();
    n.lp.type = 'lowpass';
    n.lp.frequency.value = 140;
    n.lp.Q.value = 1.4;
    n.droneGain = ctx.createGain();
    n.droneGain.gain.value = 0.22;
    n.droneGain.connect(n.lp).connect(n.master);

    n.osc1 = ctx.createOscillator(); n.osc1.type = 'sawtooth'; n.osc1.frequency.value = 41.2;
    n.osc2 = ctx.createOscillator(); n.osc2.type = 'sawtooth'; n.osc2.frequency.value = 41.5;
    n.osc3 = ctx.createOscillator(); n.osc3.type = 'sine';     n.osc3.frequency.value = 20.6;
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    const g3 = ctx.createGain(); g3.gain.value = 0.9;
    n.osc1.connect(g1).connect(n.droneGain);
    n.osc2.connect(g2).connect(n.droneGain);
    n.osc3.connect(g3).connect(n.droneGain);

    // Shimmer: a high, slowly vibrating partial.
    n.shimmer = ctx.createOscillator(); n.shimmer.type = 'sine'; n.shimmer.frequency.value = 329.6;
    n.shimmerGain = ctx.createGain(); n.shimmerGain.gain.value = 0.015;
    n.vib = ctx.createOscillator(); n.vib.type = 'sine'; n.vib.frequency.value = 0.18;
    n.vibGain = ctx.createGain(); n.vibGain.gain.value = 4;
    n.vib.connect(n.vibGain).connect(n.shimmer.frequency);
    n.shimmer.connect(n.shimmerGain).connect(n.master);

    // Noise bed: looping white noise through a band-pass (disk temperature -> centre).
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < len; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = (s / 4294967296) * 2 - 1;
    }
    n.noise = ctx.createBufferSource();
    n.noise.buffer = buf;
    n.noise.loop = true;
    n.bp = ctx.createBiquadFilter();
    n.bp.type = 'bandpass';
    n.bp.frequency.value = 500;
    n.bp.Q.value = 0.7;
    n.noiseGain = ctx.createGain();
    n.noiseGain.gain.value = 0.03;
    n.noise.connect(n.bp).connect(n.noiseGain).connect(n.master);

    // Pulse: LFO on the drone gain locked to disk spin.
    n.lfo = ctx.createOscillator(); n.lfo.type = 'sine'; n.lfo.frequency.value = 0.3;
    n.lfoGain = ctx.createGain(); n.lfoGain.gain.value = 0.06;
    n.lfo.connect(n.lfoGain).connect(n.droneGain.gain);

    for (const k of ['osc1', 'osc2', 'osc3', 'shimmer', 'vib', 'noise', 'lfo']) n[k].start();

    this.ctx = ctx;
    this.n = n;
  }

  async enable() {
    if (!this.available) return false;
    try {
      if (!this.ctx) this._build();
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.enabled = true;
      this.n.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.n.master.gain.setTargetAtTime(0.8, this.ctx.currentTime, 0.6);
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  disable() {
    if (!this.ctx) return;
    this.enabled = false;
    const t = this.ctx.currentTime;
    this.n.master.gain.cancelScheduledValues(t);
    this.n.master.gain.setTargetAtTime(0, t, 0.25);
    const ctx = this.ctx;
    setTimeout(() => {
      if (!this.enabled && ctx.state === 'running') ctx.suspend().catch(() => {});
    }, 1200);
  }

  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  // state: { camRadius, camSpeed, diskTemperature, diskBrightness, diskDensity, diskSpin, diskInner, turbulence }
  update(state) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const n = this.n;
    const t = this.ctx.currentTime;
    const r = Math.max(state.camRadius, 1.05);
    const redshift = Math.sqrt(Math.max(1 - 1 / r, 0.03));
    const near = Math.max(0, 1 - (r - 1.5) / 28);
    const speed = Math.min(state.camSpeed, 6);

    const f0 = 41.2 * redshift * (1 + speed * 0.01);
    n.osc1.frequency.setTargetAtTime(f0, t, 0.15);
    n.osc2.frequency.setTargetAtTime(f0 * 1.007, t, 0.15);
    n.osc3.frequency.setTargetAtTime(f0 * 0.5, t, 0.15);
    n.shimmer.frequency.setTargetAtTime(f0 * 8 * (1 + 0.02 * state.turbulence), t, 0.3);
    n.lp.frequency.setTargetAtTime(110 + 900 * near * near + speed * 30, t, 0.2);

    const diskPower = Math.min(1, (state.diskBrightness * state.diskDensity) / 3);
    n.noiseGain.gain.setTargetAtTime(0.01 + 0.16 * diskPower * (0.35 + near) + speed * 0.01, t, 0.3);
    n.bp.frequency.setTargetAtTime(180 + 2400 * Math.min(1, (state.diskTemperature - 1500) / 20000), t, 0.3);
    n.bp.Q.setTargetAtTime(0.5 + 1.5 * state.turbulence, t, 0.3);

    const inner = Math.max(state.diskInner, 1.6);
    const omegaIsco = Math.sqrt(0.5 / (inner * inner * inner)) * Math.abs(state.diskSpin);
    n.lfo.frequency.setTargetAtTime(0.15 + 2.0 * omegaIsco, t, 0.5);
    n.lfoGain.gain.setTargetAtTime(0.03 + 0.08 * near, t, 0.5);
    n.shimmerGain.gain.setTargetAtTime(0.006 + 0.03 * near * (1 - diskPower * 0.5), t, 0.5);
  }
}
