// Cinematic camera paths. Each path maps time (seconds) to a camera pose:
// position and look target in rs units, vertical FOV in degrees, and a roll angle.
// The black hole sits at the origin; the disk lies in the y = 0 plane.

import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

function spherical(out, r, elevation, azimuth) {
  const c = Math.cos(elevation);
  out.set(r * c * Math.sin(azimuth), r * Math.sin(elevation), r * c * Math.cos(azimuth));
  return out;
}

// Solve Kepler's equation M = E - e sin E for E (a few Newton iterations).
function keplerTrueAnomaly(M, e) {
  let E = M;
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

export const PATHS = {
  orbit: {
    name: 'Orbit',
    describe: 'Slow orbit just above the disk plane',
    pose(t, pose) {
      const r = 20.0 + 2.2 * Math.sin(t * 0.07);
      const el = 0.12 + 0.08 * Math.sin(t * 0.11 + 0.8);
      spherical(pose.position, r, el, t * 0.045);
      pose.target.set(0, 0, 0);
      pose.fov = 48 + 2.0 * Math.sin(t * 0.05);
      pose.roll = 0.03 * Math.sin(t * 0.09);
      return pose;
    },
  },
  flyby: {
    name: 'Flyby',
    describe: 'Keplerian hyperbolic pass with periapsis at 5.5 rs',
    pose(t, pose) {
      const T = 46;
      const e = 0.7;
      const rp = 6.5;
      const p = rp * (1 + e);
      const M = (2 * Math.PI * ((t / T) % 1)) - Math.PI;
      const nu = keplerTrueAnomaly(M, e);
      const r = p / (1 + e * Math.cos(nu));
      // Orbit in a plane tilted by 22 degrees about the x axis.
      const x = r * Math.cos(nu);
      const z = r * Math.sin(nu);
      const tilt = 0.38;
      pose.position.set(x, z * Math.sin(tilt) + 0.6, z * Math.cos(tilt));
      // Look slightly ahead of the hole so the disk sweeps through frame.
      const near = Math.exp(-(((r - rp) / 8) ** 2));
      pose.target.set(0.9 * near * Math.sin(nu), 0, 0);
      pose.fov = 52 + 16 * near;
      pose.roll = 0.22 * Math.sin(nu) * near;
      return pose;
    },
  },
  plunge: {
    name: 'Plunge',
    describe: 'Spiral in toward the photon sphere and pull back out',
    pose(t, pose) {
      const T = 52;
      const s = (t / T) % 1;
      const u = 0.5 - 0.5 * Math.cos(2 * Math.PI * s);          // 0 -> 1 -> 0
      const uu = u * u * (3 - 2 * u);
      const r = 30 - (30 - 2.3) * Math.pow(uu, 0.85);
      const el = 0.32 - 0.26 * uu;
      // Faster azimuthal motion as we get closer (Keplerian-ish feel).
      const az = t * 0.05 + 2.4 * Math.pow(uu, 1.5);
      spherical(pose.position, r, el, az);
      pose.target.set(0, 0.15 * (1 - uu), 0);
      pose.fov = 50 + 20 * uu;
      pose.roll = 0.35 * Math.sin(2 * Math.PI * s) * uu;
      return pose;
    },
  },
  rise: {
    name: 'Polar Rise',
    describe: 'From the disk plane up to a near-polar view',
    pose(t, pose) {
      const T = 40;
      const s = (t / T) % 1;
      const u = 0.5 - 0.5 * Math.cos(2 * Math.PI * s);
      const el = 0.02 + 1.38 * u * u * (3 - 2 * u);
      const r = 9.5 + 2.5 * u;
      spherical(pose.position, r, el, t * 0.06);
      pose.target.set(0, 0, 0);
      pose.fov = 58 - 8 * u;
      pose.roll = 0.0;
      return pose;
    },
  },
  free: {
    name: 'Free',
    describe: 'OrbitControls: drag to orbit, wheel to zoom',
    pose: null,
  },
};

export const PATH_KEYS = Object.keys(PATHS);

export function makePose() {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 55, roll: 0 };
}

// Apply a pose to a THREE.PerspectiveCamera (handles roll via the up vector).
export function applyPose(camera, pose) {
  camera.position.copy(pose.position);
  _fwd.subVectors(pose.target, pose.position).normalize();
  _right.crossVectors(_fwd, Y);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, _fwd).normalize();
  camera.up.copy(_up).multiplyScalar(Math.cos(pose.roll)).addScaledVector(_right, Math.sin(pose.roll));
  camera.lookAt(pose.target);
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
}
