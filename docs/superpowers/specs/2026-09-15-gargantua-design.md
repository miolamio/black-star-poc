# GARGANTUA — Schwarzschild Black Hole Raytracer: Design

Date: 2026-09-15
Status: approved by request scope (autonomous session; the request enumerated the full feature set)

## Goal

A full-screen interactive website that renders a Schwarzschild black hole entirely in a
fragment shader by integrating null geodesics. No meshes, textures, images, or video are
used for the subject. It runs from any static file server with no build step.

## Non-goals

- Kerr (spinning) metric. Disk rotation is Keplerian in Schwarzschild spacetime only.
- Physically calibrated radiative transfer. Emission is a thin-disk blackbody model tuned
  for cinematic output.
- Bundling or transpiling. Native ES modules and an import map only.

## Units and physics

- Geometric units with the Schwarzschild radius `rs = 1`. Photon sphere at `r = 1.5`,
  ISCO at `r = 3`, critical impact parameter `b_c = 3√3/2 ≈ 2.598`.
- Null geodesics integrated in 3D via the Binet form written as a central force:
  `a = -1.5 · h² · x / r⁵` with `h = |x × v|` conserved. Positions are Schwarzschild
  coordinates. RK4 with radius-adaptive step. Rays terminate at the horizon (`r < 1`),
  at an escape radius, or on step exhaustion.
- Thin disk in the plane `y = 0` between `diskInner` and `diskOuter`. A crossing is
  detected by a sign change of `y` between steps and located by linear interpolation.
  Up to `maxCrossings` crossings are composited front to back with transmittance.
- Disk emitter on circular orbit with local speed `β = sqrt(1 / (2 (r − 1)))`.
  Combined shift `g = sqrt(1 − 1/r) / (γ (1 − β · n̂))`, with `n̂` the photon direction
  in the local static frame (radial component stretched by `1/sqrt(1 − 1/r)`).
  Observed intensity `∝ g^beaming`, observed temperature `g · T`.
- Temperature profile `T(r) ∝ r^(−3/4) (1 − sqrt(r_in / r))^(1/4)` normalised so the peak
  equals `diskTemperature`. Colour from a Planckian-locus chromaticity fit → XYZ → linear sRGB.
- Turbulence: fbm value noise in `(log r, φ − Ω(r) t, t)`; differential rotation shears
  the pattern. Amplitude and scale are parameters.
- Sky: procedural stars from hashed cells on the octahedral-mapped direction, with
  power-law brightness and colour temperature. Milky Way as a tilted great-circle band
  of fbm nebulosity with dust lanes. Anti-aliased using `fwidth` of the escaped direction,
  which is evaluated in uniform control flow after the loop.

## Rendering pipeline

1. **Geodesic pass** → HDR half-float render target at `resolutionScale × DPR`.
2. **Bloom**: prefilter with soft-knee threshold, 13-tap progressive downsample
   (N mips by quality), 9-tap tent upsample with additive blend.
3. **Composite** to canvas: chromatic aberration (per-channel radial offsets on the HDR
   image), bloom add, exposure, manual ACES (Stephen Hill fit), vignette, luminance-weighted
   film grain, triangular dither, linear → sRGB. Deep blacks preserved: grain is scaled by
   luminance, bloom threshold defaults above disk shadow level.

## Debug views (keys 0–9)

| Key | View |
| --- | --- |
| 0 | Final composite |
| 1 | Raw HDR scene, no post |
| 2 | Bloom buffer |
| 3 | Redshift factor g (blue < 1 < red) |
| 4 | Disk crossing count |
| 5 | Integration step count |
| 6 | Termination class (horizon / disk / sky) |
| 7 | Sky only |
| 8 | Disk only |
| 9 | Deflection angle |

## Live parameters (21)

diskInner, diskOuter, diskDensity, diskTemperature, diskBrightness, beaming, redshift,
diskSpin, turbulence, turbulenceScale, maxCrossings, starDensity, starBrightness,
milkyWay, exposure, bloomStrength, bloomThreshold, bloomRadius, vignette, grain,
chromaticAberration.

## Presets

Interstellar, Quasar, Ember, Pure Lensing. Each sets all 21 parameters and a camera pose.

## Camera

`THREE.PerspectiveCamera` supplies position and basis vectors to the shader. Paths:
Orbit, Flyby, Plunge, Polar Rise, and Free (OrbitControls). Space pauses time.

## Quality profiles

| Profile | Resolution scale | DPR cap | Max steps | Bloom mips |
| --- | --- | --- | --- | --- |
| low | 0.5 | 1.0 | 110 | 4 |
| medium | 0.75 | 1.5 | 180 | 5 |
| high | 1.0 | 2.0 | 300 | 6 |

Initial profile chosen from DPR and hardware concurrency; persisted afterwards.

## Persistence

`localStorage` key `gargantua.v1` holding parameters, quality, preset, HUD visibility,
camera path, and last free-camera pose. `R` resets to preset defaults.

## Recovery

`webglcontextlost` is prevented and shown as an overlay; `webglcontextrestored` rebuilds
render targets and materials. No WebGL2 → explanatory overlay instead of a black canvas.
Shader compile failures are surfaced in the overlay with the log.

## Screenshot mode

`?shot=1` renders deterministically: time from `t`, grain seed from `seed`, camera from
`preset`/`path`/`cam`/`look`/`fov`, size from `w`/`h`, quality from `quality`, debug view
from `debug`. Animation is frozen, HUD hidden unless `hud=1`, `preserveDrawingBuffer` on.
When the frame is on screen the page sets `document.body.dataset.ready = "1"` and
`window.__gargantua.ready = true`. `download=1` also saves a PNG.

## Audio

Optional synthesized drone (WebAudio, no files): two detuned oscillators through a
low-pass filter plus filtered noise. Cut-off, gain, and pitch are driven by camera
radius, camera speed, and disk temperature. Enabled with `M` after a user gesture.

## Verification

- `verify/geodesic.test.mjs`: JS port of the integrator checks weak-field deflection
  `≈ 2/b` and photon-sphere capture around `b_c`.
- `verify/verify.mjs`: Playwright loads the page in screenshot mode for every debug view,
  preset, and quality, asserts no console errors, asserts the frame is not black, and
  writes PNGs plus `verify/results/report.json`.

## File layout

```
index.html            css/style.css
js/main.js            js/app.js           js/params.js      js/presets.js
js/quality.js         js/camera-paths.js  js/hud.js         js/gui.js
js/audio.js           js/postfx.js        js/storage.js     js/hotkeys.js
js/screenshot.js      js/recovery.js
js/shaders/*.glsl.js  lib/three/*         verify/*          README.md
```
