import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUMP, patch } from './studio.js';

// The serpent's head: a sphere sculpted in JS into a viper-like wedge, with
// flared jaw corners, a flat crown, brow ridges over the eyes, a carved mouth
// line and a tapered snout. Local axes: +x left/right, +y up (dorsal), +z forward.

const K = 1.15;               // overall scale relative to a 0.42-radius body
export const HEAD_BACK = -0.45 * K;
export const HEAD_TIP = 0.62 * K;

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

function sculpt() {
  const geo = new THREE.SphereGeometry(1, 96, 64);
  geo.rotateX(Math.PI / 2);   // poles on ±z: back of the skull and tip of the snout
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const g = mergeVertices(geo);
  const pos = g.attributes.position;
  const mouth = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (z + 1) / 2;                              // 0 back .. 1 snout
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = Math.atan2(y, x);
    const c = Math.cos(phi), s = Math.sin(phi);
    // superellipse cross-section: flat crown, flatter jaw, crisp sides
    const cx = Math.sign(c) * Math.abs(c) ** 0.55;
    const cy = Math.sign(s) * Math.abs(s) ** (s > 0 ? 0.9 : 0.75);

    // width: neck -> flared jaw corners -> long tapering snout
    const W = t < 0.32
      ? mix(0.3, 0.41, smooth(0, 0.32, t))
      : mix(0.41, 0.15, Math.pow((t - 0.32) / 0.68, 1.25));
    const Htop = mix(0.25, 0.13, Math.pow(t, 0.9));
    const Hbot = mix(0.21, 0.08, t);
    // the snout tip rounds off quickly; the back stays full to swallow the neck
    const shape = t > 0.5 ? Math.pow(ring, 0.55) : Math.pow(ring, 0.35);

    let X = cx * W * shape;
    let Y = cy * (s > 0 ? Htop : Hbot) * shape;
    const Z = mix(-0.45, 0.62, t);

    // brow ridges over the eyes, and a shallow valley between them
    const ax = Math.abs(X);
    if (Y > 0) {
      Y += 0.045 * Math.exp(-(((ax - 0.2) ** 2) / 0.004 + ((t - 0.48) ** 2) / 0.025));
      Y -= 0.018 * Math.exp(-((ax ** 2) / 0.006 + ((t - 0.55) ** 2) / 0.05));
    }
    // carved mouth line along the side, rising slightly toward the jaw hinge
    const line = Math.exp(-(((cy + 0.12 - (1 - t) * 0.12) ** 2) / 0.004)) * smooth(0.12, 0.35, t);
    X *= 1 - 0.07 * line;
    Y *= 1 - 0.07 * line;
    mouth[i] = line;

    pos.setXYZ(i, X * K, Y * K, Z * K);
  }
  g.setAttribute('aMouth', new THREE.BufferAttribute(mouth, 1));
  g.computeVertexNormals();
  return g;
}

const VERT_HEAD = /* glsl */ `
attribute float aMouth;
varying vec3 vHP;
varying float vMouth;
`;
const FRAG_HEAD = /* glsl */ `
varying vec3 vHP;
varying float vMouth;
vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// distance to the nearest Voronoi border: the seams between head shields
float shields(vec2 x){
  vec2 i = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++){
    vec2 g = vec2(float(j), float(k));
    vec2 r = g + 0.15 + 0.7 * h22(i + g) - f;
    float d = dot(r, r);
    if (d < f1){ f2 = f1; f1 = d; } else if (d < f2){ f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}
${BUMP}
`;
const FRAG_BODY = /* glsl */ `
  vec3 hp = vHP / ${K.toFixed(3)};
  float top = smoothstep(0.02, 0.1, hp.y);
  // plates: big on the crown, finer along the jaw
  vec2 sp = top > 0.5 ? hp.xz * vec2(7.0, 5.5) : hp.zy * vec2(8.0, 12.0);
  float seam = 1.0 - smoothstep(0.02, 0.09, shields(sp + 3.0));
  // enamel crown inlay: an emerald diamond between the eyes, ringed in black enamel
  float dia = abs(hp.x) * 2.6 + abs(hp.z - 0.06) * 1.2;
  float inlay = (1.0 - smoothstep(0.3, 0.31, dia)) * top;
  float border = (1.0 - smoothstep(0.37, 0.38, dia)) * top - inlay;
  float enamel = inlay + border;

  vec3 gold = vec3(1.0, 0.74, 0.36);
  vec3 col = gold;
  col *= 1.0 - seam * 0.5 * (1.0 - enamel);
  col = mix(col, vec3(0.0, 0.2, 0.09), inlay);
  col = mix(col, vec3(0.004), border);
  col *= 1.0 - vMouth * 0.85;
  diffuseColor.rgb = col;
  float sMetal = 1.0 - enamel;
  float sRough = mix(mix(0.18, 0.4, seam * (1.0 - enamel)), 0.12, enamel);
  sRough = mix(sRough, 0.6, vMouth);
  float sHeight = -seam * 0.6 * (1.0 - enamel) + inlay * 0.3 - vMouth;
`;

export function createHead() {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.2, envMapIntensity: 0.9 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = patch(shader.vertexShader, [
      ['#include <common>', '#include <common>\n' + VERT_HEAD],
      ['#include <begin_vertex>', '#include <begin_vertex>\nvHP = position;\nvMouth = aMouth;'],
    ]);
    shader.fragmentShader = patch(shader.fragmentShader, [
      ['#include <common>', '#include <common>\n' + FRAG_HEAD],
      ['#include <color_fragment>', '#include <color_fragment>\n' + FRAG_BODY],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sRough;'],
      ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;'],
      ['#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = perturbFromHeight(-vViewPosition, normal, sHeight, 0.012);'],
    ]);
  };
  const head = new THREE.Mesh(sculpt(), mat);
  head.matrixAutoUpdate = true;
  return head;
}

// Eye sockets sit under the brow ridges, on the upper flank.
export const EYE_POSITIONS = [-1, 1].map((side) => new THREE.Vector3(side * 0.297 * K, 0.078 * K, 0.17 * K));
export const SNOUT = new THREE.Vector3(0, -0.01 * K, HEAD_TIP - 0.02);
