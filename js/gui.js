// Parameter panel built on lil-gui (shipped with Three.js). Scene controls on top,
// then the 21 live parameters grouped by category.

import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { PARAM_DEFS } from './params.js';
import { PRESETS, PRESET_KEYS } from './presets.js';
import { PATHS, PATH_KEYS } from './camera-paths.js';
import { QUALITY, QUALITY_KEYS } from './quality.js';
import { DEBUG_NAMES } from './hud.js';

export class Gui {
  constructor(app, container) {
    this.app = app;
    this.gui = new GUI({ container, title: 'GARGANTUA', width: 310 });
    this.controllers = [];
    this.visible = true;

    const presetOptions = Object.fromEntries(PRESET_KEYS.map((k) => [PRESETS[k].name, k]));
    const pathOptions = Object.fromEntries(PATH_KEYS.map((k) => [PATHS[k].name, k]));
    const qualityOptions = Object.fromEntries(QUALITY_KEYS.map((k) => [QUALITY[k].name, k]));
    const debugOptions = Object.fromEntries(DEBUG_NAMES.map((n, i) => [`${i} · ${n}`, i]));

    this.ctrl = {
      preset: app.state.preset,
      path: app.state.path,
      quality: app.state.quality,
      debug: app.state.debug,
      audio: app.audio.enabled,
      paused: app.state.paused,
      hud: app.state.hud,
      reset: () => app.resetParams(),
      screenshot: () => app.saveScreenshot(),
      resetTime: () => app.resetTime(),
      loseContext: () => app.simulateContextLoss(),
    };

    const scene = this.gui.addFolder('Scene');
    this._track(scene.add(this.ctrl, 'preset', presetOptions).name('Preset').onChange((v) => app.setPreset(v)));
    this._track(scene.add(this.ctrl, 'path', pathOptions).name('Camera path').onChange((v) => app.setPath(v)));
    this._track(scene.add(this.ctrl, 'quality', qualityOptions).name('Quality').onChange((v) => app.setQuality(v)));
    this._track(scene.add(this.ctrl, 'debug', debugOptions).name('Debug view').onChange((v) => app.setDebug(v)));
    this._track(scene.add(this.ctrl, 'paused').name('Pause time').onChange((v) => app.setPaused(v)));
    this._track(scene.add(this.ctrl, 'audio').name('Audio (M)').onChange((v) => app.setAudio(v)));
    this._track(scene.add(this.ctrl, 'hud').name('Telemetry HUD').onChange((v) => app.setHud(v)));
    scene.add(this.ctrl, 'reset').name('Reset parameters (R)');
    scene.add(this.ctrl, 'resetTime').name('Reset time (T)');
    scene.add(this.ctrl, 'screenshot').name('Save screenshot (S)');
    scene.add(this.ctrl, 'loseContext').name('Simulate WebGL context loss');

    const folders = {};
    for (const def of PARAM_DEFS) {
      if (!folders[def.group]) {
        folders[def.group] = this.gui.addFolder(def.group);
        if (def.group === 'Post' || def.group === 'Sky') folders[def.group].close();
      }
      const c = folders[def.group]
        .add(app.params, def.key, def.min, def.max, def.step)
        .name(def.label)
        .onChange(() => app.onParamChanged(def.key));
      this._track(c);
    }
  }

  _track(c) {
    this.controllers.push(c);
    return c;
  }

  // Pull the current app state into the widgets without firing onChange.
  refresh() {
    const s = this.app.state;
    this.ctrl.preset = s.preset;
    this.ctrl.path = s.path;
    this.ctrl.quality = s.quality;
    this.ctrl.debug = s.debug;
    this.ctrl.audio = this.app.audio.enabled;
    this.ctrl.paused = s.paused;
    this.ctrl.hud = s.hud;
    for (const c of this.controllers) c.updateDisplay();
  }

  setVisible(v) {
    this.visible = v;
    this.gui.domElement.hidden = !v;
  }
}
