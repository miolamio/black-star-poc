// URL configuration and deterministic screenshot mode.
//
//   ?shot=1            freeze time, hide UI, render one deterministic frame, then set
//                      document.body.dataset.ready = "1" and window.__gargantua.ready = true
//   &t=12.5            simulation time (seconds) used for disk turbulence and camera paths
//   &seed=7            film-grain seed
//   &journey=exit-music explicit deterministic performance capture (no recording needed)
//   &preset=quasar     preset key (interstellar | quasar | ember | lensing)
//   &path=orbit        camera path key (orbit | flyby | plunge | rise | free)
//   &cam=x,y,z         explicit camera position (rs units); implies path=free
//   &look=x,y,z        explicit look target (default 0,0,0)
//   &fov=55            vertical field of view in degrees
//   &w=1280&h=720      canvas size in CSS pixels (device pixel ratio forced to 1)
//   &quality=high      low | medium | high
//   &debug=5           debug view 0-9
//   &hud=1             keep the HUD visible in shot mode
//   &download=1        also trigger a PNG download once the frame is ready
//   &<param>=value     override any of the 21 live parameters, e.g. &exposure=1.4
//
// Every key except shot/download also works in interactive mode.

import { PARAM_KEYS } from './params.js';

function num(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function vec(v) {
  if (!v) return null;
  const parts = v.split(',').map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return null;
  return parts;
}

export function parseUrlConfig(search = window.location.search) {
  const q = new URLSearchParams(search);
  const cfg = {
    shot: q.get('shot') === '1' || q.get('shot') === 'true',
    download: q.get('download') === '1',
    journey: q.get('journey') === 'exit-music',
    t: num(q.get('t'), null),
    seed: num(q.get('seed'), 1),
    preset: q.get('preset'),
    path: q.get('path'),
    cam: vec(q.get('cam')),
    look: vec(q.get('look')),
    fov: num(q.get('fov'), null),
    w: num(q.get('w'), null),
    h: num(q.get('h'), null),
    quality: q.get('quality'),
    debug: num(q.get('debug'), null),
    hud: q.get('hud') === '1',
    params: {},
  };
  for (const k of PARAM_KEYS) {
    if (q.has(k)) {
      const v = Number(q.get(k));
      if (Number.isFinite(v)) cfg.params[k] = v;
    }
  }
  if (cfg.cam) cfg.path = 'free';
  return cfg;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))), 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

export async function downloadCanvasPNG(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return blob.size;
}

export function screenshotName(state) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `gargantua-${state.preset}-${stamp}.png`;
}
