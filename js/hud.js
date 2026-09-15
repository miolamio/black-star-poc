// Telemetry HUD: a monospace panel updated a few times per second, plus the hotkey legend.

const ROWS = [
  ['fps', 'FPS'],
  ['frame', 'Frame'],
  ['internal', 'Internal res'],
  ['canvas', 'Canvas'],
  ['quality', 'Quality'],
  ['preset', 'Preset'],
  ['path', 'Camera path'],
  ['camR', 'Camera r'],
  ['camEl', 'Inclination'],
  ['camSpeed', 'Camera speed'],
  ['fov', 'FOV'],
  ['steps', 'Max RK4 steps'],
  ['rays', 'Rays / frame'],
  ['crossings', 'Disk crossings'],
  ['redshift', 'Horizon redshift'],
  ['time', 'Sim time'],
  ['debug', 'Debug view'],
  ['audio', 'Audio'],
  ['params', 'Live params'],
];

export const DEBUG_NAMES = [
  'Final composite',
  'Raw HDR scene',
  'Bloom buffer',
  'Redshift factor g',
  'Disk crossing count',
  'Integration steps',
  'Termination class',
  'Sky only',
  'Disk only',
  'Deflection angle',
];

export const HOTKEYS = [
  ['0–9', 'Debug view'],
  ['[ / ]', 'Previous / next preset'],
  ['C', 'Cycle camera path'],
  ['Esc', 'Free camera (drag / wheel)'],
  ['Space', 'Pause / resume time'],
  ['Q', 'Cycle quality'],
  ['M', 'Toggle audio'],
  ['H', 'Toggle HUD'],
  ['G', 'Toggle parameter panel'],
  ['K', 'Toggle this legend'],
  ['S', 'Save screenshot (PNG)'],
  ['F', 'Fullscreen'],
  ['T', 'Reset time'],
  ['R', 'Reset preset parameters'],
];

export class Hud {
  constructor(root) {
    this.root = root;
    this.visible = true;
    this.cells = {};
    this.lastUpdate = 0;

    const panel = document.createElement('div');
    panel.className = 'hud-panel';
    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = 'TELEMETRY';
    panel.appendChild(title);
    const table = document.createElement('table');
    for (const [key, label] of ROWS) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = label;
      const td = document.createElement('td');
      td.textContent = '—';
      tr.appendChild(th);
      tr.appendChild(td);
      table.appendChild(tr);
      this.cells[key] = td;
    }
    panel.appendChild(table);
    root.appendChild(panel);
    this.panel = panel;

    const legend = document.createElement('div');
    legend.className = 'hud-legend';
    const lt = document.createElement('div');
    lt.className = 'hud-title';
    lt.textContent = 'HOTKEYS';
    legend.appendChild(lt);
    const lTable = document.createElement('table');
    for (const [k, v] of HOTKEYS) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = k;
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(th);
      tr.appendChild(td);
      lTable.appendChild(tr);
    }
    legend.appendChild(lTable);
    root.appendChild(legend);
    this.legend = legend;
    this.legendVisible = true;
  }

  setVisible(v) {
    this.visible = v;
    this.panel.hidden = !v;
    this.legend.hidden = !(v && this.legendVisible);
  }

  setLegendVisible(v) {
    this.legendVisible = v;
    this.legend.hidden = !(this.visible && v);
  }

  update(stats, now) {
    if (!this.visible) return;
    if (now - this.lastUpdate < 200) return;
    this.lastUpdate = now;
    const c = this.cells;
    c.fps.textContent = stats.fps.toFixed(0);
    c.frame.textContent = stats.frameMs.toFixed(1) + ' ms';
    c.internal.textContent = `${stats.internalW} × ${stats.internalH} (×${stats.resolutionScale.toFixed(2)})`;
    c.canvas.textContent = `${stats.canvasW} × ${stats.canvasH} @ ${stats.dpr.toFixed(2)} dpr`;
    c.quality.textContent = stats.quality;
    c.preset.textContent = stats.preset;
    c.path.textContent = stats.path + (stats.paused ? ' (paused)' : '');
    c.camR.textContent = stats.camR.toFixed(2) + ' rs';
    c.camEl.textContent = stats.camEl.toFixed(1) + '°';
    c.camSpeed.textContent = stats.camSpeed.toFixed(2) + ' rs/s';
    c.fov.textContent = stats.fov.toFixed(1) + '°';
    c.steps.textContent = String(stats.maxSteps);
    c.rays.textContent = (stats.rays / 1e6).toFixed(2) + ' M';
    c.crossings.textContent = 'up to ' + stats.maxCrossings;
    c.redshift.textContent = '1 + z = ' + stats.zCam.toFixed(3);
    c.time.textContent = stats.time.toFixed(1) + ' s';
    c.debug.textContent = `${stats.debug} · ${DEBUG_NAMES[stats.debug]}`;
    c.audio.textContent = stats.audio;
    c.params.textContent = String(stats.paramCount);
  }
}
