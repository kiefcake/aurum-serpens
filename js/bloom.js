import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Dual-filter bloom (the "Call of Duty: Advanced Warfare" scheme): a chain of
// 13-tap downsamples followed by 9-tap tent upsamples added back up the chain.
// Far cheaper than a gaussian per mip, and the first downsample uses a Karis
// average so single-pixel glints on the scales don't flicker as giant blooms.
// The result is left in `texture` for the final pass to composite.

const vertex = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const down = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 tap(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec3 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
  vec3 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
  vec3 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
  vec3 j = tap(-1.0, 1.0), k = tap(1.0, 1.0), l = tap(-1.0, -1.0), m = tap(1.0, -1.0);
  vec3 col;
  if (uPrefilter > 0.5){
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = 0.125 / (1.0 + luma(g0)), w1 = 0.125 / (1.0 + luma(g1));
    float w2 = 0.125 / (1.0 + luma(g2)), w3 = 0.125 / (1.0 + luma(g3));
    float w4 = 0.5 / (1.0 + luma(g4));
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    // soft-knee threshold
    float br = max(col.r, max(col.g, col.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = rq * rq / (4.0 * uKnee + 1e-4);
    col *= max(rq, br - uThreshold) / max(br, 1e-4);
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const up = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 tap(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main(){
  vec3 s = tap(-1.0, 1.0) + tap(0.0, 1.0) * 2.0 + tap(1.0, 1.0)
         + tap(-1.0, 0.0) * 2.0 + tap(0.0, 0.0) * 4.0 + tap(1.0, 0.0) * 2.0
         + tap(-1.0, -1.0) + tap(0.0, -1.0) * 2.0 + tap(1.0, -1.0);
  gl_FragColor = vec4(s * (uWeight / 16.0), 1.0);
}
`;

export class DualBloomPass extends Pass {
  constructor({ levels = 6, threshold = 1.0, knee = 0.6 } = {}) {
    super();
    this.needsSwap = false;
    this.mips = Array.from({ length: levels }, () => new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    }));
    this.down = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: down, depthTest: false, depthWrite: false,
      uniforms: {
        tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 },
        uThreshold: { value: threshold }, uKnee: { value: knee },
      },
    });
    this.up = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: up, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
    });
    this.quad = new FullScreenQuad(this.down);
    this.texture = this.mips[0].texture;
  }

  setSize(width, height) {
    this.mips.forEach((rt, i) => {
      const s = 2 ** (i + 1);
      rt.setSize(Math.max(1, Math.round(width / s)), Math.max(1, Math.round(height / s)));
    });
  }

  render(renderer, writeBuffer, readBuffer) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const d = this.down.uniforms;
    let src = readBuffer.texture, w = readBuffer.width, h = readBuffer.height;
    this.quad.material = this.down;
    this.mips.forEach((rt, i) => {
      d.tSrc.value = src;
      d.uTexel.value.set(1 / w, 1 / h);
      d.uPrefilter.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(rt);
      this.quad.render(renderer);
      src = rt.texture; w = rt.width; h = rt.height;
    });
    const u = this.up.uniforms;
    this.quad.material = this.up;
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const from = this.mips[i + 1];
      u.tSrc.value = from.texture;
      u.uTexel.value.set(1 / from.width, 1 / from.height);
      renderer.setRenderTarget(this.mips[i]);
      this.quad.render(renderer);
    }
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.mips.forEach((rt) => rt.dispose());
    this.down.dispose();
    this.up.dispose();
    this.quad.dispose();
  }
}
