// Entry point: capability check, app boot, and fatal-error reporting in the overlay.

import { App } from './app.js';
import { parseUrlConfig } from './screenshot.js';
import { Overlay, webgl2Supported } from './recovery.js';

const overlay = new Overlay(document.getElementById('overlay'));
const canvas = document.getElementById('view');
const cfg = parseUrlConfig();

window.__gargantua = { ready: false, error: null };

async function boot() {
  overlay.show('Compiling geodesic kernel…', 'Integrating Schwarzschild null geodesics on the GPU.', { spinner: true });

  if (!webgl2Supported()) {
    overlay.show(
      'WebGL 2 is not available',
      'GARGANTUA integrates geodesics in a WebGL 2 fragment shader. Enable hardware acceleration or use a current Chrome, Firefox, Safari, or Edge.',
      { error: true }
    );
    window.__gargantua.error = 'webgl2-unavailable';
    return;
  }

  const app = new App({
    canvas,
    hudRoot: document.getElementById('hud'),
    guiRoot: document.getElementById('gui'),
    overlay,
    urlConfig: cfg,
  });

  if (cfg.shot) {
    document.body.classList.add('shot');
    if (cfg.hud) document.body.classList.add('shot-hud');
  }

  try {
    await app.init();
    Object.assign(window.__gargantua, app.publicApi(), { ready: app.ready });
  } catch (err) {
    window.__gargantua.error = String(err && err.message ? err.message : err);
    overlay.show('GARGANTUA could not start', window.__gargantua.error, { error: true });
    throw err;
  }
}

boot();
