import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// Hero stage: a black lacquer floor that genuinely reflects the serpent (planar
// mirror render, blurred for gloss), darkened by soft contact shadows computed
// from the serpent's spine, under a pair of gold halo rings.

export const SHADOW_SAMPLES = 40;

const FloorShader = {
  name: 'LacquerFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uSpine: { value: Array.from({ length: SHADOW_SAMPLES }, () => new THREE.Vector4()) },
    uTime: { value: 0 },
    uShadowBound: { value: new THREE.Vector4(0, 0, 0, -1) },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vW;
    void main(){
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec4 uSpine[${SHADOW_SAMPLES}];
    uniform float uTime;
    uniform vec4 uShadowBound;
    uniform vec2 uTexel;
    varying vec4 vUv;
    varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv.xy / vUv.w;
      // glossy blur: a small rotated disc of taps, wider further from the viewer
      vec3 refl = vec3(0.0);
      float spread = 2.5;
      float rot = hash(gl_FragCoord.xy) * 6.2831;
      for (int i = 0; i < 12; i++){
        float a = rot + float(i) * 2.39996;
        float r = sqrt(float(i) / 12.0) * spread;
        refl += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r * uTexel).rgb;
      }
      refl /= 12.0;

      vec3 V = normalize(cameraPosition - vW);
      float fres = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
      float r = length(vW.xz);
      vec3 col = vec3(0.003, 0.0028, 0.0026);
      col += vec3(0.022, 0.016, 0.01) * exp(-r * r / 24.0);
      col += refl * mix(0.22, 0.85, fres);

      float sh = 0.0;
      // only pixels near the serpent's footprint pay for the contact-shadow loop
      vec2 bd = vW.xz - uShadowBound.xy;
      if (dot(bd, bd) < uShadowBound.w)
      for (int i = 0; i < ${SHADOW_SAMPLES}; i++){
        vec4 s = uSpine[i];
        vec2 d = vW.xz - s.xz;
        float h = max(s.y - vW.y, 0.0);
        float w = s.w * 1.8 + h * 0.4 + 0.05;
        sh += exp(-dot(d, d) / (w * w)) * smoothstep(3.0, 0.1, h);
      }
      col *= 1.0 - clamp(sh * 0.45, 0.0, 0.9);

      float fade = smoothstep(26.0, 7.0, r);
      gl_FragColor = vec4(col, fade);
    }
  `,
};

export class Stage {
  constructor(scene, floorY) {
    this.floorY = floorY;
    const geo = new THREE.PlaneGeometry(80, 80);
    this.scale = Math.min(window.devicePixelRatio, 1.5) * 0.5;
    this.floor = new Reflector(geo, {
      textureWidth: Math.round(innerWidth * this.scale),
      textureHeight: Math.round(innerHeight * this.scale),
      clipBias: 0.003,
      shader: FloorShader,
    });
    this.floor.material.transparent = true;
    // the mirror only needs what can actually stand on the floor: skip everything
    // else in the reflection pass (it re-renders the whole scene otherwise)
    this.hideInReflection = [];
    const reflect = this.floor.onBeforeRender;
    this.floor.onBeforeRender = (renderer, scene, camera) => {
      const was = this.hideInReflection.map((o) => o.visible);
      this.hideInReflection.forEach((o) => { o.visible = false; });
      reflect(renderer, scene, camera);
      this.hideInReflection.forEach((o, i) => { o.visible = was[i]; });
    };
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = floorY;
    const u = this.floor.material.uniforms;
    u.uTexel.value.set(1 / (innerWidth * this.scale), 1 / (innerHeight * this.scale));
    scene.add(this.floor);

    // halo rings: thin bars of HDR gold that bloom, turning like a gyroscope
    this.rings = new THREE.Group();
    this.rings.position.set(0, floorY + 3.3, -6.5);
    const ringMat = (k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15 * k, 0.78 * k, 0.34 * k) });
    const outer = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.012, 12, 400), ringMat(1));
    const inner = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.008, 8, 400), ringMat(0.55));
    const tick = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.005, 6, 400), ringMat(0.35));
    this.rings.add(outer, inner, tick);
    this.ringParts = [outer, inner, tick];
    scene.add(this.rings);
    this.shadowSamples = u.uSpine.value;
  }

  // pixelRatio follows the adaptive render scale; the mirror is half of it
  resize(pixelRatio = Math.min(window.devicePixelRatio, 1.5)) {
    this.scale = Math.min(pixelRatio, 1.5) * 0.5;
    const w = Math.round(innerWidth * this.scale), h = Math.round(innerHeight * this.scale);
    this.floor.getRenderTarget().setSize(w, h);
    this.floor.material.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  update(time, visible) {
    this.floor.visible = this.rings.visible = visible;
    const u = this.floor.material.uniforms;
    u.uTime.value = time;
    // footprint of the shadow samples (centre xz, squared radius incl. blur reach)
    let cx = 0, cz = 0;
    for (const s of this.shadowSamples) { cx += s.x; cz += s.z; }
    cx /= this.shadowSamples.length; cz /= this.shadowSamples.length;
    let r = 0;
    for (const s of this.shadowSamples) {
      const reach = s.w * 1.8 + Math.max(s.y - this.floorY, 0) * 0.4 + 0.05;
      r = Math.max(r, Math.hypot(s.x - cx, s.z - cz) + reach * 2.5);
    }
    u.uShadowBound.value.set(cx, cz, 0, r * r);
    const [outer, inner, tick] = this.ringParts;
    outer.rotation.y = Math.sin(time * 0.25) * 0.5;
    inner.rotation.x = time * 0.18;
    inner.rotation.y = Math.cos(time * 0.21) * 0.6;
    tick.rotation.y = -time * 0.1;
  }
}
