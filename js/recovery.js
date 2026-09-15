// Status overlay (loading / errors) and WebGL context-loss recovery.

export class Overlay {
  constructor(el) {
    this.el = el;
    this.titleEl = el.querySelector('#overlay-title');
    this.msgEl = el.querySelector('#overlay-msg');
    this.spinner = el.querySelector('.spinner');
  }

  show(title, message = '', { spinner = false, error = false } = {}) {
    this.titleEl.textContent = title;
    this.msgEl.textContent = message;
    this.spinner.hidden = !spinner;
    this.el.classList.toggle('error', error);
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
  }
}

export function webgl2Supported() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    return !!gl; // probe canvas is garbage-collected; losing it explicitly makes Firefox warn
  } catch {
    return false;
  }
}

// Installs context-loss handlers on the canvas. `onLost` is called after the default
// (context destruction) is prevented; `onRestored` after the browser restores it.
export function installContextRecovery(canvas, { onLost, onRestored, onCreationError }) {
  const lost = (e) => {
    e.preventDefault();
    onLost && onLost(e);
  };
  const restored = (e) => {
    onRestored && onRestored(e);
  };
  const creation = (e) => {
    onCreationError && onCreationError(e);
  };
  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);
  canvas.addEventListener('webglcontextcreationerror', creation, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    canvas.removeEventListener('webglcontextcreationerror', creation);
  };
}
