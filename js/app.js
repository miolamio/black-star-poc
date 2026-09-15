// Application: renderer, geodesic pass, post pipeline, camera, UI, persistence,
// screenshot mode, and WebGL context recovery.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEODESIC_FRAG } from './shaders/geodesic.frag.js';
import { FULLSCREEN_VERT } from './shaders/post.glsl.js';
import { PARAM_DEFS, PARAM_COUNT, clampParams, uniformName } from './params.js';
import { PRESETS, PRESET_KEYS, DEFAULT_PRESET, getPreset } from './presets.js';
import { QUALITY, QUALITY_KEYS, detectQuality } from './quality.js';
import { PATHS, PATH_KEYS, makePose, applyPose } from './camera-paths.js';
import { PostPipeline } from './postfx.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { Gui } from './gui.js';
import { installHotkeys } from './hotkeys.js';
import { loadState, saveState } from './storage.js';
import { downloadCanvasPNG, screenshotName } from './screenshot.js';
import { installContextRecovery } from './recovery.js';

const STATE_VERSION = 1;

export class App {
  constructor({ canvas, hudRoot, guiRoot, overlay, urlConfig }) {
    this.canvas = canvas;
    this.hudRoot = hudRoot;
    this.guiRoot = guiRoot;
    this.overlay = overlay;
    this.cfg = urlConfig;
    this.shot = !!urlConfig.shot;

    this.state = {
      preset: DEFAULT_PRESET,
      path: PRESETS[DEFAULT_PRESET].path,
      quality: detectQuality(),
      debug: 0,
      hud: true,
      gui: true,
      legend: true,
      paused: false,
      audio: false,
    };
    this.params = clampParams(PRESETS[DEFAULT_PRESET].params);
    this.savedCamera = null;

    this.time = 0;
    this.frameIndex = 0;
    this.lastNow = 0;
    this.raf = 0;
    this.running = false;
    this.contextLost = false;
    this.ready = false;
    this.captureRequested = false;
    this.saveTimer = 0;
    this.shaderError = null;

    this.stats = {
      fps: 0, frameMs: 0, internalW: 0, internalH: 0, resolutionScale: 1, canvasW: 0, canvasH: 0, dpr: 1,
      quality: '', preset: '', path: '', paused: false, camR: 0, camEl: 0, camSpeed: 0, fov: 55,
      maxSteps: 0, rays: 0, maxCrossings: 0, zCam: 1, time: 0, debug: 0, audio: 'off', paramCount: PARAM_COUNT,
    };
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fpsLast = 0;
    this._prevCamPos = new THREE.Vector3();
    this._camSpeedSmooth = 0;

    this.pose = makePose();
    this.audio = new AudioEngine();
    this._frame = this._frame.bind(this);
  }

  // ------------------------------------------------------------------ init
  async init() {
    this._applyPersistedState();
    this._applyUrlConfig();
    this._createRenderer();
    this._createCamera();
    this._createGeodesicPass();
    this.post = new PostPipeline(this.renderer, this.hdrType);
    this.post.setMipCount(QUALITY[this.state.quality].bloomMips);
    this._createUi();
    this._installEvents();
    this._resize();

    // Compile the big kernel before the first frame so the loading overlay stays honest.
    if (this.renderer.extensions.has('KHR_parallel_shader_compile')) {
      await this.renderer.compileAsync(this.rayScene, this.rayCam);
    } else {
      this.renderer.compile(this.rayScene, this.rayCam);
    }
    if (this.shaderError) throw new Error('Shader compilation failed:\n' + this.shaderError);

    if (this.shot) {
      this.time = this.cfg.t ?? 0;
      this.state.paused = true;
      this._stepOnce(performance.now());
      this._markReady();
      if (this.cfg.download) await this.saveScreenshot();
    } else {
      this.start();
    }
  }

  _applyPersistedState() {
    if (this.shot) return; // screenshot mode must be independent of local state
    const s = loadState();
    if (!s || s.version !== STATE_VERSION) return;
    if (s.preset && PRESETS[s.preset]) this.state.preset = s.preset;
    if (s.params) this.params = clampParams({ ...this.params, ...s.params });
    if (s.path && PATHS[s.path]) this.state.path = s.path;
    if (s.quality && QUALITY[s.quality]) this.state.quality = s.quality;
    if (Number.isInteger(s.debug) && s.debug >= 0 && s.debug <= 9) this.state.debug = s.debug;
    for (const k of ['hud', 'gui', 'legend', 'audio']) if (typeof s[k] === 'boolean') this.state[k] = s[k];
    if (s.camera && Array.isArray(s.camera.position) && s.camera.position.length === 3) this.savedCamera = s.camera;
  }

  _applyUrlConfig() {
    const c = this.cfg;
    if (c.preset && PRESETS[c.preset]) {
      this.state.preset = c.preset;
      this.params = clampParams(PRESETS[c.preset].params);
      this.state.path = PRESETS[c.preset].path;
      this.savedCamera = null;
    }
    if (Object.keys(c.params).length) this.params = clampParams({ ...this.params, ...c.params });
    if (c.path && PATHS[c.path]) this.state.path = c.path;
    if (c.quality && QUALITY[c.quality]) this.state.quality = c.quality;
    if (Number.isInteger(c.debug) && c.debug >= 0 && c.debug <= 9) this.state.debug = c.debug;
    if (c.cam) {
      this.state.path = 'free';
      this.savedCamera = { position: c.cam, target: c.look || [0, 0, 0], fov: c.fov || getPreset(this.state.preset).camera.fov };
    } else if (c.fov && this.savedCamera) {
      this.savedCamera.fov = c.fov;
    }
    if (c.t !== null && c.t !== undefined) this.time = c.t;
    if (this.shot) {
      this.state.hud = !!c.hud;
      this.state.gui = false;
      this.state.legend = false;
      this.state.audio = false;
    }
  }

  _createRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.shot,
      premultipliedAlpha: false,
    });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required.');
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = true;
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = gl.getProgramInfoLog(program) || '';
      const fsLog = gl.getShaderInfoLog(fs) || '';
      const vsLog = gl.getShaderInfoLog(vs) || '';
      this.shaderError = [log, vsLog, fsLog].filter(Boolean).join('\n').trim() || 'unknown shader error';
      this.overlay.show('Shader compilation failed', this.shaderError.slice(0, 1200), { error: true });
      this.stop();
    };
    const ext = renderer.extensions;
    this.hdrType = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
    this.renderer = renderer;

    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, {
      type: this.hdrType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
  }

  _createCamera() {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    const preset = getPreset(this.state.preset);
    const cam = this.savedCamera || { position: preset.camera.position, target: [0, 0, 0], fov: preset.camera.fov };
    this.camera.position.fromArray(cam.position);
    this.camera.fov = cam.fov || preset.camera.fov;
    this.camera.lookAt(...(cam.target || [0, 0, 0]));
    this.camera.updateProjectionMatrix();

    const controls = new OrbitControls(this.camera, this.canvas);
    controls.target.set(...(cam.target || [0, 0, 0]));
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 1.6;
    controls.maxDistance = 60;
    controls.enabled = this.state.path === 'free';
    controls.addEventListener('change', () => this._scheduleSave());
    this.controls = controls;
    this._prevCamPos.copy(this.camera.position);
  }

  _createGeodesicPass() {
    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
      uTanHalfFov: { value: 0.5 },
      uMaxSteps: { value: 180 },
      uStepScale: { value: 1 },
      uDebug: { value: 0 },
      uDiskOn: { value: 1 },
      uSkyOn: { value: 1 },
    };
    for (const d of PARAM_DEFS) uniforms[uniformName(d.key)] = { value: d.def };
    this.uniforms = uniforms;

    this.rayMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GEODESIC_FRAG,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.rayScene = new THREE.Scene();
    this.rayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.rayMaterial);
    quad.frustumCulled = false;
    this.rayScene.add(quad);
  }

  _createUi() {
    this.hud = new Hud(this.hudRoot);
    this.hud.setVisible(this.state.hud);
    this.hud.setLegendVisible(this.state.legend);
    this.gui = new Gui(this, this.guiRoot);
    this.gui.setVisible(this.state.gui);
    if (this.state.audio && !this.shot) this._armAudioResume();
  }

  _installEvents() {
    this._removeHotkeys = installHotkeys(this);
    window.addEventListener('resize', () => {
      if (!this.shot) this._resize();   // shot mode has a fixed size; resizing would clear the frozen frame
    });
    this.canvas.addEventListener(
      'pointerdown',
      () => {
        if (this.state.path !== 'free') this.setPath('free');
      },
      { capture: true }
    );
    installContextRecovery(this.canvas, {
      onLost: () => {
        this.contextLost = true;
        this.stop();
        this.overlay.show('WebGL context lost', 'Waiting for the GPU to come back. Rendering resumes automatically.', { spinner: true });
      },
      onRestored: () => {
        this.contextLost = false;
        this.shaderError = null;
        this.overlay.show('WebGL context restored', 'Recompiling geodesic kernel…', { spinner: true });
        this.ready = false;          // next successful frame hides the overlay again
        this.lastNow = 0;
        this.start();
      },
      onCreationError: (e) => {
        this.overlay.show('WebGL context could not be created', e.statusMessage || '', { error: true });
      },
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lastNow = 0;
    });
  }

  // ------------------------------------------------------------------ sizing
  _resize() {
    const q = QUALITY[this.state.quality];
    let cssW, cssH, dpr;
    if (this.shot && this.cfg.w && this.cfg.h) {
      cssW = Math.max(16, Math.floor(this.cfg.w));
      cssH = Math.max(16, Math.floor(this.cfg.h));
      dpr = 1;
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
    } else {
      cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
      cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    }
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    const canvasW = Math.floor(cssW * dpr);
    const canvasH = Math.floor(cssH * dpr);
    const internalW = Math.max(8, Math.round(canvasW * q.resolutionScale));
    const internalH = Math.max(8, Math.round(canvasH * q.resolutionScale));
    this.sceneRT.setSize(internalW, internalH);
    this.post.setSize(internalW, internalH);
    this.uniforms.uResolution.value.set(internalW, internalH);
    this.camera.aspect = internalW / internalH;
    this.camera.updateProjectionMatrix();
    Object.assign(this.stats, { canvasW, canvasH, dpr, internalW, internalH, resolutionScale: q.resolutionScale });
  }

  // ------------------------------------------------------------------ loop
  start() {
    if (this.running) return;
    this.running = true;
    this.lastNow = 0;
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  _frame(nowMs) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._frame);
    if (this.contextLost) return;
    this._stepOnce(nowMs);
    if (!this.ready) this._markReady();
  }

  _stepOnce(nowMs) {
    const t0 = performance.now();
    const now = nowMs / 1000;
    const dt = this.lastNow ? Math.min(now - this.lastNow, 0.1) : 1 / 60;
    this.lastNow = now;
    if (!this.state.paused && !this.shot) this.time += dt;

    this._updateCamera(dt);
    this._updateUniforms();
    this._render();
    this.frameIndex++;

    if (this.captureRequested) {
      this.captureRequested = false;
      this._doCapture();
    }

    const frameMs = performance.now() - t0;
    this._updateStats(dt, frameMs, nowMs);
    this.hud.update(this.stats, nowMs);
    this.audio.update({
      camRadius: this.stats.camR,
      camSpeed: this.stats.camSpeed,
      diskTemperature: this.params.diskTemperature,
      diskBrightness: this.params.diskBrightness,
      diskDensity: this.params.diskDensity,
      diskSpin: this.params.diskSpin,
      diskInner: this.params.diskInner,
      turbulence: this.params.turbulence,
    });
  }

  _updateCamera(dt) {
    const path = PATHS[this.state.path];
    if (path && path.pose) {
      path.pose(this.time, this.pose);
      applyPose(this.camera, this.pose);
    } else {
      this.controls.update();
    }
    this.camera.updateMatrixWorld();
    const d = this.camera.position.distanceTo(this._prevCamPos);
    const inst = dt > 0 ? d / dt : 0;
    this._camSpeedSmooth += (inst - this._camSpeedSmooth) * Math.min(1, dt * 6);
    this._prevCamPos.copy(this.camera.position);
  }

  _updateUniforms() {
    const u = this.uniforms;
    const m = this.camera.matrixWorld.elements;
    u.uCamPos.value.copy(this.camera.position);
    u.uCamRight.value.set(m[0], m[1], m[2]).normalize();
    u.uCamUp.value.set(m[4], m[5], m[6]).normalize();
    u.uCamFwd.value.set(-m[8], -m[9], -m[10]).normalize();
    u.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    u.uTime.value = this.time;
    for (const d of PARAM_DEFS) u[uniformName(d.key)].value = this.params[d.key];
    const q = QUALITY[this.state.quality];
    u.uMaxSteps.value = q.maxSteps;
    u.uStepScale.value = q.stepScale;
    u.uDebug.value = this.state.debug;
    u.uDiskOn.value = this.state.debug === 7 ? 0 : 1;
    u.uSkyOn.value = this.state.debug === 8 ? 0 : 1;
  }

  _render() {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(this.rayScene, this.rayCam);
    const grainSeed = this.shot ? Math.floor(this.cfg.seed) : this.frameIndex % 4096;
    this.post.render(this.sceneRT, this.params, this.state.debug, grainSeed, this.stats.canvasW, this.stats.canvasH);
    r.setRenderTarget(null);
  }

  _updateStats(dt, frameMs, nowMs) {
    const s = this.stats;
    this._fpsFrames++;
    if (nowMs - this._fpsLast > 500) {
      s.fps = (this._fpsFrames * 1000) / (nowMs - this._fpsLast);
      this._fpsFrames = 0;
      this._fpsLast = nowMs;
    }
    s.frameMs = s.frameMs * 0.9 + frameMs * 0.1;
    const p = this.camera.position;
    s.camR = p.length();
    s.camEl = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, p.y / Math.max(s.camR, 1e-6)))));
    s.camSpeed = this._camSpeedSmooth;
    s.fov = this.camera.fov;
    s.quality = QUALITY[this.state.quality].name;
    s.preset = getPreset(this.state.preset).name;
    s.path = PATHS[this.state.path].name;
    s.paused = this.state.paused;
    s.maxSteps = QUALITY[this.state.quality].maxSteps;
    s.rays = s.internalW * s.internalH;
    s.maxCrossings = this.params.maxCrossings;
    s.zCam = 1 / Math.sqrt(Math.max(1 - 1 / Math.max(s.camR, 1.0001), 1e-6));
    s.time = this.time;
    s.debug = this.state.debug;
    s.audio = this.audio.enabled ? 'on (synth)' : this.audio.available ? 'off · press M' : 'unavailable';
  }

  _markReady() {
    this.ready = true;
    this.overlay.hide();
    document.body.dataset.ready = '1';
    if (window.__gargantua) window.__gargantua.ready = true;
  }

  // ------------------------------------------------------------------ actions
  setPreset(key) {
    if (!PRESETS[key]) return;
    const preset = PRESETS[key];
    this.state.preset = key;
    Object.assign(this.params, clampParams(preset.params));
    this.setPath(preset.path, { fromPreset: true });
    this.gui.refresh();
    this._scheduleSave();
  }

  cyclePreset(dir) {
    const i = PRESET_KEYS.indexOf(this.state.preset);
    this.setPreset(PRESET_KEYS[(i + dir + PRESET_KEYS.length) % PRESET_KEYS.length]);
  }

  resetParams() {
    const preset = PRESETS[this.state.preset];
    Object.assign(this.params, clampParams(preset.params));
    this.gui.refresh();
    this._scheduleSave();
  }

  setPath(key, { fromPreset = false } = {}) {
    if (!PATHS[key]) return;
    const wasFree = this.state.path === 'free';
    this.state.path = key;
    if (key === 'free') {
      this.camera.up.set(0, 1, 0);
      if (fromPreset) {
        const cam = PRESETS[this.state.preset].camera;
        this.camera.position.fromArray(cam.position);
        this.camera.fov = cam.fov;
        this.camera.updateProjectionMatrix();
      }
      this.controls.target.set(0, 0, 0);
      this.controls.enabled = true;
      this.controls.update();
    } else {
      this.controls.enabled = false;
      if (wasFree || fromPreset) this._prevCamPos.copy(this.camera.position);
    }
    this.gui.refresh();
    this._scheduleSave();
  }

  cyclePath() {
    const i = PATH_KEYS.indexOf(this.state.path);
    this.setPath(PATH_KEYS[(i + 1) % PATH_KEYS.length]);
  }

  setQuality(key) {
    if (!QUALITY[key]) return;
    this.state.quality = key;
    this.post.setMipCount(QUALITY[key].bloomMips);
    this._resize();
    this.gui.refresh();
    this._scheduleSave();
  }

  cycleQuality() {
    const i = QUALITY_KEYS.indexOf(this.state.quality);
    this.setQuality(QUALITY_KEYS[(i + 1) % QUALITY_KEYS.length]);
  }

  setDebug(n) {
    n = Math.max(0, Math.min(9, n | 0));
    this.state.debug = n;
    this.gui.refresh();
    this._scheduleSave();
  }

  setPaused(v) {
    this.state.paused = !!v;
    this.gui.refresh();
  }

  resetTime() {
    this.time = 0;
  }

  setHud(v) {
    this.state.hud = !!v;
    this.hud.setVisible(this.state.hud);
    this.gui.refresh();
    this._scheduleSave();
  }

  setGui(v) {
    this.state.gui = !!v;
    this.gui.setVisible(this.state.gui);
    this._scheduleSave();
  }

  setLegend(v) {
    this.state.legend = !!v;
    this.hud.setLegendVisible(this.state.legend);
    this._scheduleSave();
  }

  async setAudio(v) {
    if (v) {
      const ok = await this.audio.enable();
      this.state.audio = ok;
    } else {
      this.audio.disable();
      this.state.audio = false;
    }
    this.gui.refresh();
    this._scheduleSave();
  }

  _armAudioResume() {
    const resume = () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      this.setAudio(true);
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  onParamChanged() {
    this._scheduleSave();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  saveScreenshot() {
    this.captureRequested = true;
    if (!this.running) {
      // Not looping (screenshot mode): render synchronously and capture.
      this._stepOnce(performance.now());
    }
    return this._capturePromise || Promise.resolve();
  }

  _doCapture() {
    const name = screenshotName(this.state);
    this._capturePromise = downloadCanvasPNG(this.canvas, name)
      .then((bytes) => {
        this.lastScreenshot = { name, bytes };
        return bytes;
      })
      .catch(() => 0);
  }

  simulateContextLoss() {
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 1500);
    return true;
  }

  // ------------------------------------------------------------------ persistence
  _scheduleSave() {
    if (this.shot) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = 0;
      this._save();
    }, 300);
  }

  _save() {
    const camera = {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      fov: this.camera.fov,
    };
    saveState({
      version: STATE_VERSION,
      params: this.params,
      preset: this.state.preset,
      path: this.state.path,
      quality: this.state.quality,
      debug: this.state.debug,
      hud: this.state.hud,
      gui: this.state.gui,
      legend: this.state.legend,
      audio: this.state.audio,
      camera,
    });
  }

  // Small, stable surface for automation and the console.
  publicApi() {
    return {
      ready: this.ready,
      app: this,
      stats: () => ({ ...this.stats }),
      state: () => ({ ...this.state }),
      params: () => ({ ...this.params }),
      hdrType: this.hdrType === THREE.HalfFloatType ? 'half-float' : 'uint8',
      setDebug: (n) => this.setDebug(n),
      setPreset: (k) => this.setPreset(k),
      setQuality: (k) => this.setQuality(k),
      setPath: (k) => this.setPath(k),
      renderOnce: () => this._stepOnce(performance.now()),
      simulateContextLoss: () => this.simulateContextLoss(),
    };
  }
}
