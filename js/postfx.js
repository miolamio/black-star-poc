// HDR post pipeline: bloom (prefilter -> progressive downsample -> tent upsample)
// and the final composite (chromatic aberration, exposure, ACES, vignette, grain).

import * as THREE from 'three';
import {
  FULLSCREEN_VERT,
  BLOOM_PREFILTER_FRAG,
  BLOOM_DOWN_FRAG,
  BLOOM_UP_FRAG,
  COMPOSITE_FRAG,
} from './shaders/post.glsl.js';

function makeRT(w, h, type) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

function makeMaterial(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

export class PostPipeline {
  constructor(renderer, hdrType) {
    this.renderer = renderer;
    this.hdrType = hdrType;
    this.mips = [];
    this.mipCount = 5;
    this.width = 2;
    this.height = 2;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.prefilterMat = makeMaterial(BLOOM_PREFILTER_FRAG, {
      tInput: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1.0 },
      uKnee: { value: 0.5 },
    });
    this.downMat = makeMaterial(BLOOM_DOWN_FRAG, {
      tInput: { value: null },
      uTexel: { value: new THREE.Vector2() },
    });
    this.upMat = makeMaterial(
      BLOOM_UP_FRAG,
      {
        tInput: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 1.0 },
      },
      {
        transparent: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
      }
    );
    this.compositeMat = makeMaterial(COMPOSITE_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1 },
      uBloomStrength: { value: 0.5 },
      uVignette: { value: 0.4 },
      uGrain: { value: 0.03 },
      uChromatic: { value: 0.002 },
      uGrainSeed: { value: 0 },
      uDebug: { value: 0 },
    });
  }

  setMipCount(n) {
    if (n === this.mipCount) return;
    this.mipCount = n;
    this._rebuildMips();
  }

  setSize(w, h) {
    this.width = Math.max(2, Math.floor(w));
    this.height = Math.max(2, Math.floor(h));
    this._rebuildMips();
  }

  _rebuildMips() {
    for (const rt of this.mips) rt.dispose();
    this.mips = [];
    let w = Math.floor(this.width / 2);
    let h = Math.floor(this.height / 2);
    for (let i = 0; i < this.mipCount; i++) {
      if (w < 2 || h < 2) break;
      this.mips.push(makeRT(w, h, this.hdrType));
      w = Math.floor(w / 2);
      h = Math.floor(h / 2);
    }
  }

  _draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  // sceneRT: HDR scene target. params: live parameter object. outW/outH: canvas size in
  // device pixels. Renders the final image to the default framebuffer.
  render(sceneRT, params, debug, grainSeed, outW, outH) {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = true;

    const doBloom = debug === 0 || debug === 2;
    if (doBloom && this.mips.length > 0) {
      // Prefilter into mip 0
      const m0 = this.mips[0];
      this.prefilterMat.uniforms.tInput.value = sceneRT.texture;
      this.prefilterMat.uniforms.uTexel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
      this.prefilterMat.uniforms.uThreshold.value = params.bloomThreshold;
      this.prefilterMat.uniforms.uKnee.value = Math.max(0.05, params.bloomThreshold * 0.5);
      this._draw(this.prefilterMat, m0);

      // Downsample chain
      for (let i = 1; i < this.mips.length; i++) {
        const src = this.mips[i - 1];
        this.downMat.uniforms.tInput.value = src.texture;
        this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this._draw(this.downMat, this.mips[i]);
      }

      // Upsample chain (additive)
      r.autoClear = false;
      this.upMat.uniforms.uRadius.value = params.bloomRadius;
      for (let i = this.mips.length - 1; i > 0; i--) {
        const src = this.mips[i];
        this.upMat.uniforms.tInput.value = src.texture;
        this.upMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this._draw(this.upMat, this.mips[i - 1]);
      }
      r.autoClear = true;
    }

    const u = this.compositeMat.uniforms;
    u.tScene.value = sceneRT.texture;
    u.tBloom.value = this.mips.length ? this.mips[0].texture : sceneRT.texture;
    u.uResolution.value.set(outW, outH);
    u.uExposure.value = params.exposure;
    u.uBloomStrength.value = this.mips.length ? params.bloomStrength : 0;
    u.uVignette.value = params.vignette;
    u.uGrain.value = params.grain;
    u.uChromatic.value = params.chromaticAberration;
    u.uGrainSeed.value = grainSeed;
    u.uDebug.value = debug;
    this._draw(this.compositeMat, null);

    r.autoClear = prevAutoClear;
  }

  dispose() {
    for (const rt of this.mips) rt.dispose();
    this.mips = [];
    this.prefilterMat.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.compositeMat.dispose();
    this.quad.geometry.dispose();
  }
}
