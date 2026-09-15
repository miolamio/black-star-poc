#!/usr/bin/env node
// Numerical validation of the geodesic integrator used in js/shaders/geodesic.frag.js.
// The JS below is a line-for-line port of the GLSL (rs = 1 units):
//   a = -1.5 * h^2 * x / r^5,  RK4,  dt = clamp(0.065 r, 0.03, 1.6) * stepScale
//
// Checks:
//   1. Weak-field deflection matches the post-Newtonian series
//      alpha = 4(M/b) + (15π/4)(M/b)^2 + (128/3)(M/b)^3, with M = 1/2.
//   2. The shader's adaptive RK4 agrees with a fine-step reference integration.
//   3. Rays with b < b_c = 3√3/2 are captured; rays with b > b_c escape.
//   4. A ray just outside b_c loops around the photon sphere (deflection > 180°).
//   5. Disk redshift factor g at the ISCO matches the closed-form values.
//
// Exit code 0 on success; results are written to verify/results/geodesic.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const M = 0.5;
const B_CRIT = (3 * Math.sqrt(3)) / 2;

function accel(p, h2) {
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  const r = Math.sqrt(r2);
  const k = (-1.5 * h2) / (r2 * r2 * r);
  return [k * p[0], k * p[1], k * p[2]];
}

function add(a, b, s = 1) { return [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]]; }

function rk4(p, v, dt, h2) {
  const k1v = accel(p, h2), k1p = v;
  const k2v = accel(add(p, k1p, 0.5 * dt), h2), k2p = add(v, k1v, 0.5 * dt);
  const k3v = accel(add(p, k2p, 0.5 * dt), h2), k3p = add(v, k2v, 0.5 * dt);
  const k4v = accel(add(p, k3p, dt), h2), k4p = add(v, k3v, dt);
  const np = [0, 1, 2].map((i) => p[i] + (dt / 6) * (k1p[i] + 2 * k2p[i] + 2 * k3p[i] + k4p[i]));
  const nv = [0, 1, 2].map((i) => v[i] + (dt / 6) * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
  return [np, nv];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));

// Trace a ray starting at x = -R0 with impact parameter b, moving in +x.
// stepFn(r) gives dt. Returns { captured, deflection, steps, hMin, hMax }.
function trace(b, { R0 = 60, stepFn, maxSteps = 200000 }) {
  let p = [-R0, b, 0];
  let v = [1, 0, 0];
  const L = cross(p, v);
  const h2 = dot(L, L);
  const h0 = Math.sqrt(h2);
  let hMin = Infinity, hMax = 0;
  let totalAngle = 0;
  let prevDir = v;
  for (let i = 0; i < maxSteps; i++) {
    const r = len(p);
    if (r < 1.0) return { captured: true, steps: i, hMin, hMax, h0 };
    if (r > R0 && dot(p, v) > 0) {
      const vn = v.map((x) => x / len(v));
      return { captured: false, deflection: Math.acos(Math.max(-1, Math.min(1, vn[0]))), totalAngle, steps: i, hMin, hMax, h0 };
    }
    [p, v] = rk4(p, v, stepFn(r), h2);
    const h = len(cross(p, v));
    hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    const d = v.map((x) => x / len(v));
    totalAngle += Math.acos(Math.max(-1, Math.min(1, dot(d, prevDir))));
    prevDir = d;
  }
  return { captured: false, exhausted: true, steps: maxSteps, hMin, hMax, h0 };
}

const shaderStep = (stepScale) => (r) => Math.min(1.6, Math.max(0.03, r * 0.065)) * stepScale;
const referenceStep = (r) => Math.min(0.5, Math.max(0.002, r * 0.004));

// Post-Newtonian expansion of the Schwarzschild deflection angle to 4th order.
function series(b) {
  const x = M / b;
  return 4 * x + (15 * Math.PI / 4) * x ** 2 + (128 / 3) * x ** 3 + (3465 * Math.PI / 64) * x ** 4;
}

// Disk redshift factor for a circular orbit at radius r, photon leaving along +/- ephi.
function gFactor(r, cosTheta) {
  const lapse = Math.sqrt(1 - 1 / r);
  const beta = Math.sqrt(1 / (2 * (r - 1)));
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  return lapse / (gamma * (1 - beta * cosTheta));
}

const results = [];
let failures = 0;
function check(name, ok, detail) {
  results.push({ name, ok, ...detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && detail.note ? '  — ' + detail.note : ''}`);
}

console.log('GARGANTUA geodesic integrator validation (rs = 1, M = 0.5)\n');

// 1 + 2: deflection
// Rays start 25 impact parameters away so the truncated tail of the deflection is < 0.01%.
for (const [b, tolSeries, tolRef] of [[10, 0.004, 0.005], [20, 0.002, 0.003], [40, 0.002, 0.002]]) {
  const R0 = 25 * b;
  const ref = trace(b, { R0, stepFn: referenceStep, maxSteps: 4000000 });
  const hi = trace(b, { R0, stepFn: shaderStep(0.85) });
  const lo = trace(b, { R0, stepFn: shaderStep(1.35) });
  const s = series(b);
  const errSeries = Math.abs(ref.deflection - s) / s;
  const errHi = Math.abs(hi.deflection - ref.deflection) / ref.deflection;
  const errLo = Math.abs(lo.deflection - ref.deflection) / ref.deflection;
  check(`deflection b=${b}: reference vs PN series`, errSeries < tolSeries, {
    b, reference: ref.deflection, series: s, relError: errSeries, tolerance: tolSeries,
    note: `ref ${ref.deflection.toFixed(6)} rad, series ${s.toFixed(6)} rad, rel err ${(errSeries * 100).toFixed(3)}%`,
  });
  check(`deflection b=${b}: shader step (high) vs reference`, errHi < tolRef, {
    b, shader: hi.deflection, reference: ref.deflection, relError: errHi, steps: hi.steps, tolerance: tolRef,
    note: `${hi.steps} RK4 steps, rel err ${(errHi * 100).toFixed(3)}%`,
  });
  check(`deflection b=${b}: shader step (low) vs reference`, errLo < tolRef * 2, {
    b, shader: lo.deflection, reference: ref.deflection, relError: errLo, steps: lo.steps, tolerance: tolRef * 2,
    note: `${lo.steps} RK4 steps, rel err ${(errLo * 100).toFixed(3)}%`,
  });
}

// h conservation along a shader-step trajectory
{
  const t = trace(6, { R0: 60, stepFn: shaderStep(1.0) });
  const drift = Math.max(Math.abs(t.hMax - t.h0), Math.abs(t.hMin - t.h0)) / t.h0;
  check('angular momentum |x × v| conserved to 1e-6 (b=6)', drift < 1e-6, { drift, note: `max relative drift ${drift.toExponential(2)}` });
}

// 3: capture boundary
{
  const inside = trace(2.5, { R0: 60, stepFn: shaderStep(1.0), maxSteps: 20000 });
  const outside = trace(2.7, { R0: 60, stepFn: shaderStep(1.0), maxSteps: 20000 });
  check('b=2.50 < b_c is captured by the horizon', inside.captured === true, { b: 2.5, bCrit: B_CRIT, steps: inside.steps, note: `${inside.steps} steps` });
  check('b=2.70 > b_c escapes to infinity', outside.captured === false && !outside.exhausted, {
    b: 2.7, bCrit: B_CRIT, deflection: outside.deflection, steps: outside.steps,
    note: `deflection ${(outside.deflection * 180 / Math.PI).toFixed(1)}°`,
  });
  // Bisect the critical impact parameter with the reference integrator.
  let lo = 2.4, hi = 2.8;
  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi);
    const t = trace(mid, { R0: 60, stepFn: (r) => Math.min(0.5, Math.max(0.01, r * 0.02)), maxSteps: 400000 });
    if (t.captured) lo = mid; else hi = mid;
  }
  const bc = 0.5 * (lo + hi);
  const err = Math.abs(bc - B_CRIT) / B_CRIT;
  check('numerical critical impact parameter matches 3√3/2', err < 2e-3, { measured: bc, exact: B_CRIT, relError: err, note: `b_c ≈ ${bc.toFixed(5)} (exact ${B_CRIT.toFixed(5)}), rel err ${(err * 100).toFixed(3)}%` });
}

// 4: photon-sphere loop
{
  const t = trace(2.62, { R0: 60, stepFn: (r) => Math.min(0.5, Math.max(0.01, r * 0.02)), maxSteps: 400000 });
  const deg = (t.totalAngle || 0) * 180 / Math.PI;
  check('b=2.62 loops around the photon sphere (total turning > 180°)', !t.captured && deg > 180, { b: 2.62, totalTurningDeg: deg, note: `total turning ${deg.toFixed(1)}°` });
}

// 5: disk redshift factor at the ISCO
{
  const gApp = gFactor(3, 1);
  const gRec = gFactor(3, -1);
  const gFace = gFactor(3, 0);
  const okApp = Math.abs(gApp - Math.sqrt(2)) < 1e-9;           // 0.8165 / (1.1547 * 0.5)
  const okRec = Math.abs(gRec - Math.sqrt(2) / 3) < 1e-9;       // 0.8165 / (1.1547 * 1.5)
  const okFace = Math.abs(gFace - Math.sqrt(0.5)) < 1e-9;       // lapse / gamma
  check('ISCO redshift factors: approaching √2, receding √2/3, transverse 1/√2', okApp && okRec && okFace, {
    approaching: gApp, receding: gRec, transverse: gFace, note: `g = ${gApp.toFixed(4)}, ${gRec.toFixed(4)}, ${gFace.toFixed(4)}; beaming ratio (g³) ${(Math.pow(gApp / gRec, 3)).toFixed(1)}:1`,
  });
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'geodesic.json'), JSON.stringify({ date: new Date().toISOString(), failures, results }, null, 2));

console.log(`\n${results.length - failures}/${results.length} checks passed.`);
process.exit(failures ? 1 : 0);
