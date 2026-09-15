// Keyboard shortcuts. Ignored while typing into a GUI input.

export function installHotkeys(app) {
  const handler = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key;
    if (k >= '0' && k <= '9') {
      app.setDebug(Number(k));
      e.preventDefault();
      return;
    }
    switch (k) {
      case '[': app.cyclePreset(-1); break;
      case ']': app.cyclePreset(1); break;
      case 'c': case 'C': app.cyclePath(); break;
      case 'Escape': app.setPath('free'); break;
      case ' ': app.setPaused(!app.state.paused); e.preventDefault(); break;
      case 'q': case 'Q': app.cycleQuality(); break;
      case 'm': case 'M': app.setAudio(!app.audio.enabled); break;
      case 'h': case 'H': app.setHud(!app.state.hud); break;
      case 'g': case 'G': app.setGui(!app.state.gui); break;
      case 'k': case 'K': case '?': app.setLegend(!app.state.legend); break;
      case 's': case 'S': app.saveScreenshot(); break;
      case 'f': case 'F': app.toggleFullscreen(); break;
      case 't': case 'T': app.resetTime(); break;
      case 'r': case 'R': app.resetParams(); break;
      default: return;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
