import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Sky dome whose palette is blended per chapter, plus gold motes along the whole descent.

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const skyFragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform float uTime;
varying vec3 vDir;
${NOISE}
void main(){
  float y = vDir.y;
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.7, y));
  col = mix(col, uBottom, smoothstep(0.0, -0.6, y));
  // three octaves are plenty for smoke this dim, and the sky covers every pixel
  vec3 sp = vDir * 3.0 + vec3(uTime * 0.02, 0.0, uTime * 0.015);
  float smoke = 0.5 * vnoise(sp) + 0.25 * vnoise(sp * 2.02 + 1.7) + 0.125 * vnoise(sp * 4.04 + 9.2) + 0.0625;
  col *= 0.75 + 0.5 * smoke;
  gl_FragColor = vec4(col, 1.0);
}
`;

const moteVertex = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uPixel;
varying float vTw;
varying float vNear;
void main(){
  vec3 p = position;
  p.x += sin(uTime * 0.2 + aSeed * 50.0) * 0.6;
  p.y += sin(uTime * 0.13 + aSeed * 31.0) * 0.8;
  p.z += cos(uTime * 0.17 + aSeed * 17.0) * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vTw = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 90.0), 3.0);
  // motes drifting right past the lens would be huge, overdraw-heavy blurs: cap and fade them
  vNear = smoothstep(0.8, 3.0, -mv.z);
  gl_PointSize = min((0.5 + aSeed * 1.2) * uPixel * 45.0 / -mv.z, 18.0 * uPixel);
  gl_Position = projectionMatrix * mv;
}
`;
const moteFragment = /* glsl */ `
varying float vTw;
varying float vNear;
void main(){
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vec3(0.9, 0.6, 0.26) * a * vTw * vNear * 0.6, 1.0);
}
`;

export const PALETTES = {
  hero: { top: [0.0015, 0.0013, 0.0012], horizon: [0.014, 0.01, 0.007], bottom: [0.0, 0.0, 0.0] },
  tree: { top: [0.003, 0.002, 0.0015], horizon: [0.045, 0.024, 0.009], bottom: [0.002, 0.001, 0.0] },
  sculpture: { top: [0.06, 0.065, 0.08], horizon: [0.016, 0.018, 0.024], bottom: [0.004, 0.004, 0.006] },
  outro: { top: [0.004, 0.0035, 0.003], horizon: [0.02, 0.014, 0.008], bottom: [0.001, 0.001, 0.001] },
};

export class Atmosphere {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uTime: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    }));
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    const n = 1400;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = 12 - Math.random() * 115;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.moteUniforms = { uTime: { value: 0 }, uPixel: { value: 1 } };
    this.motes = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: moteVertex,
      fragmentShader: moteFragment,
      uniforms: this.moteUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);
  }

  update(time, camera, weights, pixelRatio) {
    this.sky.position.copy(camera.position);
    this.uniforms.uTime.value = time;
    this.moteUniforms.uTime.value = time;
    this.moteUniforms.uPixel.value = pixelRatio;
    for (const key of ['top', 'horizon', 'bottom']) {
      const out = [0, 0, 0];
      for (const [name, w] of Object.entries(weights)) {
        PALETTES[name][key].forEach((v, i) => { out[i] += v * w; });
      }
      this.uniforms['u' + key[0].toUpperCase() + key.slice(1)].value.setRGB(...out);
    }
  }
}
