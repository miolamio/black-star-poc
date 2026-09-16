import * as THREE from 'three';
import { PARTICLE_COUNT, sampleParticle } from './journey.js';
import { INTERIOR_VERT, INTERIOR_FRAG, INTERIOR_FIELD_FRAG } from './shaders/interior.frag.js';
import { FULLSCREEN_VERT } from './shaders/post.glsl.js';

export class InteriorPass {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3));
    this.geometry.setIndex([0,1,2,0,2,3]);
    this.segments = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_COUNT * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.appearance = new THREE.InstancedBufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('segment', this.segments);
    this.geometry.setAttribute('appearance', this.appearance);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: INTERIOR_VERT, fragmentShader: INTERIOR_FRAG,
      uniforms: { uAspect: { value: 1 } }, depthTest: false, depthWrite: false,
      transparent: true, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.fieldMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: INTERIOR_FIELD_FRAG,
      uniforms: { uAspect: { value: 1 }, uFlash: { value: 0 }, uAngle: { value: 0 }, uShape: { value: 0 } },
      depthTest: false, depthWrite: false,
    });
    this.field = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fieldMaterial);
    this.field.frustumCulled = false;
    this.scene.add(this.field);
  }
  setSize(width, height) {
    this.material.uniforms.uAspect.value = this.fieldMaterial.uniforms.uAspect.value = width / height;
  }
  render(renderer, target, sample) {
    this.fieldMaterial.uniforms.uFlash.value = sample.flash.strength;
    this.fieldMaterial.uniforms.uAngle.value = sample.flash.angle;
    this.fieldMaterial.uniforms.uShape.value = sample.flash.shape;
    this.geometry.instanceCount = sample.particleCount;
    for (let id = 0; id < sample.particleCount; id++) {
      // Double-precision motion sampling continues indefinitely; only positions
      // go to the GPU, avoiding an ever-growing float shader clock.
      const p = sampleParticle(id, sample.motionTime, sample.seed);
      this.segments.setXYZW(id, p.x, p.y, p.dx, p.dy);
      this.appearance.setXYZ(id, p.width, p.brightness, p.hue);
    }
    this.segments.needsUpdate = this.appearance.needsUpdate = true;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.geometry.dispose(); this.material.dispose();
    this.field.geometry.dispose(); this.fieldMaterial.dispose();
  }
}
