import * as THREE from 'three';
import { NOISE, GOLD, SWAY } from './glsl.js';
import { BUMP, patch } from './studio.js';

// A procedurally grown 摇钱树 (money tree) in the manner of Han-dynasty tomb
// bronzes: verdigris-patinated bronze limbs inlaid with gold, hung with
// square-holed coins. Branches are generated recursively and every ring is
// stamped with a birth time; the vertex shader grows the tree by sliding each
// ring out from its parent as uGrowth rises. All surfaces are patched
// MeshPhysical/Standard materials so they sit in the same studio lighting.

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_DEPTH = 5;
const SIDES = 10;

// ------------------------------------------------------------------ coin face
// Height map for the coin caps: raised rim, raised frame around the square hole
// and four characters, softened so the bump reads as a cast bevel.
function coinFaceTexture() {
  const S = 512;
  const raw = document.createElement('canvas');
  raw.width = raw.height = S;
  const out = document.createElement('canvas');
  out.width = out.height = S;
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;

  const draw = () => {
    const c = raw.getContext('2d');
    const m = S / 2;
    c.fillStyle = '#000';
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#5c5c5c';
    c.beginPath(); c.arc(m, m, m, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = S * 0.07;
    c.beginPath(); c.arc(m, m, m - S * 0.045, 0, Math.PI * 2); c.stroke();
    const hole = S * 0.085, frame = S * 0.14;
    c.fillStyle = '#fff';
    c.fillRect(m - frame, m - frame, frame * 2, frame * 2);
    c.fillStyle = '#000';
    c.fillRect(m - hole, m - hole, hole * 2, hole * 2);
    c.fillStyle = '#e8e8e8';
    c.font = `700 ${S * 0.2}px "Noto Serif TC", "Songti TC", "PMingLiU", "SimSun", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const off = S * 0.285;
    [['招', 0, -off], ['財', 0, off], ['進', off, 0], ['寶', -off, 0]]
      .forEach(([ch, x, y]) => c.fillText(ch, m + x, m + y + S * 0.01));
    const o = out.getContext('2d');
    o.filter = `blur(${S * 0.005}px)`;
    o.drawImage(raw, 0, 0);
    tex.needsUpdate = true;
  };
  draw();
  if (document.fonts) document.fonts.load(`700 40px "Noto Serif TC"`, '招財進寶').then(draw).catch(() => {});
  return tex;
}

// --------------------------------------------------------------------- shaders
const BARK_VERT_HEAD = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aPrev;
attribute vec3 aPrev2;
attribute float aBirth;
attribute float aPrevBirth;
attribute float aPrev2Birth;
attribute float aRadius;
uniform float uGrowth;
uniform float uTime;
varying vec3 vWPos;
${SWAY}
`;
const BARK_VERT = /* glsl */ `
  vec3 c;
  float thick;
  if (uGrowth >= aBirth){
    c = aCenter;
    thick = mix(0.55, 1.0, clamp((uGrowth - aBirth) / 0.3, 0.0, 1.0));
  } else if (uGrowth >= aPrevBirth){
    float t = (uGrowth - aPrevBirth) / max(aBirth - aPrevBirth, 1e-5);
    c = mix(aPrev, aCenter, t);
    thick = 0.3 + 0.25 * t;
  } else {
    // two or more rings ahead of the growth front: collapse onto the front
    float t = clamp((uGrowth - aPrev2Birth) / max(aPrevBirth - aPrev2Birth, 1e-5), 0.0, 1.0);
    c = mix(aPrev2, aPrev, t);
    thick = 0.0;
  }
  vec3 transformed = c + swayOffset(c, uTime) + normal * aRadius * thick;
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const BARK_FRAG_HEAD = /* glsl */ `
uniform float uTime;
varying vec3 vWPos;
${NOISE}
${BUMP}
`;
const BARK_FRAG = /* glsl */ `
  float n1 = fbm(vWPos * 1.3);
  float n2 = fbm(vWPos * vec3(6.0, 1.4, 6.0));
  // verdigris gathers in the bark furrows and in broad weathered patches;
  // the raised ridges stay rubbed back to bronze
  float furrow = 1.0 - abs(sin(n2 * 14.0));
  float patina = clamp(smoothstep(0.5, 0.7, n1) + smoothstep(0.5, 0.95, furrow) * 0.9, 0.0, 1.0);
  float vein = smoothstep(0.018, 0.0, abs(fbm(vWPos * 0.9 + 3.0) - 0.5)) * (1.0 - patina);
  vec3 bronze = vec3(0.5, 0.29, 0.14) * (0.8 + 0.4 * n2);
  vec3 verd = mix(vec3(0.07, 0.26, 0.22), vec3(0.34, 0.6, 0.5), smoothstep(0.3, 0.8, fbm(vWPos * 9.0)));
  diffuseColor.rgb = mix(mix(bronze, verd, patina), ${GOLD}, vein);
  float sMetal = mix(mix(0.92, 0.0, patina), 1.0, vein);
  float sRough = mix(mix(0.38, 0.88, patina), 0.14, vein);
  float sHeight = (1.0 - furrow) * 0.7 + patina * 0.25 - vein * 0.4;
  float pulse = pow(0.5 + 0.5 * sin(vWPos.y * 1.2 - uTime * 2.0), 12.0);
`;

const COIN_VERT_HEAD = /* glsl */ `
uniform float uGrowth;
uniform float uTime;
uniform float uRain;
varying vec2 vCUv;
varying float vCap;
varying float vKind;
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }
`;
const HANGING_HEAD = /* glsl */ `
attribute float aBirth;
attribute float aPhase;
attribute vec3 aAnchor;
${SWAY}
`;
const HANGING_NORMAL = /* glsl */ `
  float cs = clamp((uGrowth - aBirth) / 0.05, 0.0, 1.0);
  float pop = cs * (1.0 + sin(cs * 9.0) * exp(-cs * 4.0) * 0.7);
  mat3 cR = rotY(uTime * (0.4 + aPhase * 0.7) + aPhase * 40.0);
  vec3 objectNormal = cR * normal;
  vKind = aPhase > 0.93 ? 1.0 : (aPhase > 0.8 ? 2.0 : 0.0);
`;
const HANGING_POS = /* glsl */ `
  float swing = sin(uTime * 1.7 + aPhase * 12.0) * (0.22 + uShake * 0.9);
  vec3 cc = aAnchor + rotZ(swing) * vec3(0.0, -0.2, 0.0);
  vec3 transformed = cc + cR * (position * pop) + swayOffset(aAnchor, uTime);
  vCUv = uv;
  vCap = abs(normal.z);
`;
const FALLING_HEAD = /* glsl */ `
attribute vec3 aStart;
attribute float aSeed;
`;
const FALLING_NORMAL = /* glsl */ `
  float life = fract(uTime * 0.16 * (0.7 + aSeed * 0.6) + aSeed * 7.31);
  float on = step(aSeed, uRain) * smoothstep(0.0, 0.04, life) * smoothstep(1.0, 0.92, life)
           * smoothstep(0.85, 1.0, uGrowth);
  mat3 cR = rotY(life * 9.0 + aSeed * 30.0) * rotX(life * 17.0 + aSeed * 11.0);
  vec3 objectNormal = cR * normal;
  vKind = fract(aSeed * 13.7) > 0.93 ? 1.0 : 0.0;
`;
const FALLING_POS = /* glsl */ `
  vec3 cc = aStart;
  cc.y = mix(aStart.y, 0.04, pow(life, 1.7));
  cc.x += sin(life * 7.0 + aSeed * 40.0) * 0.7;
  cc.z += cos(life * 5.0 + aSeed * 23.0) * 0.7;
  vec3 transformed = cc + cR * position * on;
  vCUv = uv;
  vCap = abs(normal.z);
`;
const COIN_FRAG_HEAD = /* glsl */ `
uniform sampler2D uCoinFace;
varying vec2 vCUv;
varying float vCap;
varying float vKind;
${BUMP}
`;
const COIN_FRAG = /* glsl */ `
  vec2 cq = vCUv - 0.5;
  bool cap = vCap > 0.5;
  if (cap && max(abs(cq.x), abs(cq.y)) < 0.085) discard;
  float sHeight = cap ? texture2D(uCoinFace, vCUv).r : 0.6 + 0.4 * step(0.5, fract(vCUv.x * 160.0));
  vec3 cGold = vec3(1.0, 0.72, 0.33);
  vec3 cJade = vec3(0.05, 0.42, 0.24);
  vec3 cBronze = mix(vec3(0.45, 0.27, 0.13), vec3(0.18, 0.45, 0.38), smoothstep(0.55, 0.3, sHeight));
  vec3 base = vKind > 1.5 ? cBronze : (vKind > 0.5 ? cJade : cGold);
  diffuseColor.rgb = base * (0.7 + 0.3 * sHeight);
  float sMetal = vKind > 1.5 ? 0.7 : (vKind > 0.5 ? 0.0 : 1.0);
  float sRough = vKind > 0.5 ? (vKind > 1.5 ? 0.6 : 0.1) : mix(0.38, 0.2, smoothstep(0.4, 0.8, sHeight));
`;

function physical(params, { uniforms, vertHead, vertNormal, vertPos, fragHead, fragBody, bump }) {
  const m = new THREE.MeshPhysicalMaterial(params);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patch(shader.vertexShader, [
      ['#include <common>', '#include <common>\n' + vertHead],
      ...(vertNormal ? [['#include <beginnormal_vertex>', vertNormal]] : []),
      ['#include <begin_vertex>', vertPos],
    ]);
    shader.fragmentShader = patch(shader.fragmentShader, [
      ['#include <common>', '#include <common>\n' + fragHead],
      ['#include <color_fragment>', '#include <color_fragment>\n' + fragBody],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sRough;'],
      ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;'],
      ['#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\nnormal = perturbFromHeight(-vViewPosition, normal, sHeight, ${bump});`],
    ]);
  };
  return m;
}

const groundVertex = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
export const groundFragment = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uTint;
varying vec3 vW;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float marble = fbm(vec3(q * 7.0, 1.0));
  vec3 col = mix(vec3(0.006, 0.005, 0.0045), vec3(0.03, 0.026, 0.022), marble) * uTint;
  vec3 V = normalize(cameraPosition - vW);
  col += vec3(0.05, 0.035, 0.02) * pow(1.0 - max(V.y, 0.0), 4.0) * uTint;
  float rings = smoothstep(0.482, 0.497, abs(fract(r * 6.0) - 0.5)) * step(r, 0.84);
  float ang = atan(q.y, q.x);
  float ticks = step(0.94, fract(ang * 48.0 / 6.2831)) * step(0.7, r) * step(r, 0.76);
  float glow = 0.6 + 0.4 * sin(uTime * 1.2 - r * 10.0);
  col += ${GOLD} * (rings + ticks) * (0.12 + glow * 0.22) * uGlow;
  col *= mix(0.2, 1.0, smoothstep(0.02, 0.2, r));
  float alpha = smoothstep(1.0, 0.5, r);
  gl_FragColor = vec4(col, alpha);
}
`;

export class MoneyTree {
  constructor(scene, origin) {
    this.group = new THREE.Group();
    this.group.position.copy(origin);
    scene.add(this.group);

    const rng = mulberry32(1903);
    const branches = [];
    const leaves = [];

    const perpendicular = (d) => {
      const t = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      return new THREE.Vector3().crossVectors(d, t).normalize();
    };

    const grow = (start, dir, len, rad, depth, birth, opts = {}) => {
      const segs = depth < 2 ? 14 : 8;
      const pts = [start.clone()], radii = [rad], births = [birth];
      const d = dir.clone();
      let p = start.clone();
      for (let i = 1; i <= segs; i++) {
        d.x += (rng() - 0.5) * 0.2 * (depth + 1) * 0.5;
        d.z += (rng() - 0.5) * 0.2 * (depth + 1) * 0.5;
        d.y += opts.root ? -0.06 : 0.03;
        d.normalize();
        p = p.clone().addScaledVector(d, len / segs);
        pts.push(p);
        radii.push(rad * (1 - 0.5 * (i / segs)));
        births.push(birth + (len * i) / segs);
      }
      pts.push(p.clone().addScaledVector(d, rad * 0.4));
      radii.push(0.001);
      births.push(births[births.length - 1] + rad * 0.4);
      branches.push({ pts, radii, births });
      if (opts.root) return;

      if (depth >= MAX_DEPTH - 2) {
        for (let i = 2; i <= segs; i++) {
          if (rng() < [0.3, 0.72, 0.9][depth - (MAX_DEPTH - 2)]) {
            leaves.push({
              anchor: pts[i].clone().add(new THREE.Vector3((rng() - 0.5) * 0.1, -0.02, (rng() - 0.5) * 0.1)),
              birth: births[i] + 0.4 + rng() * 0.6,
              phase: rng(),
            });
          }
        }
      }
      if (depth >= MAX_DEPTH) return;

      const count = depth === 0 ? 4 : rng() < 0.55 ? 2 : 3;
      const azimuth0 = rng() * Math.PI * 2;
      for (let c = 0; c < count; c++) {
        const si = depth === 0
          ? Math.floor(segs * (0.55 + 0.45 * (c / count)))
          : segs - Math.floor(rng() * 3);
        const base = new THREE.Vector3().subVectors(pts[si], pts[si - 1]).normalize();
        const perp = perpendicular(base).applyAxisAngle(base, azimuth0 + (c / count) * Math.PI * 2 + rng() * 0.6);
        const spread = 0.42 + rng() * 0.45;
        const cd = base.clone().multiplyScalar(Math.cos(spread)).addScaledVector(perp, Math.sin(spread)).normalize();
        grow(pts[si], cd, len * (0.66 + rng() * 0.14), radii[si] * 0.72, depth + 1, births[si]);
      }
    };

    grow(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 1, 0), 5.2, 0.6, 0, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rng() * 0.4;
      grow(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(Math.cos(a), -0.35, Math.sin(a)).normalize(),
        2.0 + rng(), 0.3, 1, 0, { root: true });
    }

    const maxBirth = Math.max(
      ...branches.map((b) => b.births[b.births.length - 1]),
      ...leaves.map((l) => l.birth),
    );
    this.coinCount = leaves.length;
    this.leafBirths = leaves.map((l) => l.birth / maxBirth).sort((a, b) => a - b);

    this.uniforms = {
      uGrowth: { value: 0 },
      uTime: { value: 0 },
      uShake: { value: 0 },
      uRain: { value: 0.1 },
      uCoinFace: { value: coinFaceTexture() },
    };

    this._buildBark(branches, maxBirth);
    this._buildCoins(leaves, maxBirth);
    this._buildRain(rng);
    this._buildGround();
    this._buildPile(rng);

    this.growth = 0;
    this.rain = 0.1;
    this.shake = 0;
  }

  _buildBark(branches, maxBirth) {
    const P = [], Nrm = [], C = [], Pr = [], Pr2 = [], Bi = [], PB = [], PB2 = [], Rad = [], idx = [];
    let vbase = 0;
    for (const b of branches) {
      const n = b.pts.length;
      let T = new THREE.Vector3().subVectors(b.pts[1], b.pts[0]).normalize();
      const Nn = new THREE.Vector3(1, 0, 0);
      Nn.addScaledVector(T, -Nn.dot(T));
      if (Nn.lengthSq() < 0.01) Nn.set(0, 0, 1).addScaledVector(T, -T.z);
      Nn.normalize();
      for (let i = 0; i < n; i++) {
        const a = b.pts[Math.max(i - 1, 0)], c = b.pts[Math.min(i + 1, n - 1)];
        T = new THREE.Vector3().subVectors(c, a).normalize();
        Nn.addScaledVector(T, -Nn.dot(T)).normalize();
        const B = new THREE.Vector3().crossVectors(T, Nn);
        const prev = b.pts[Math.max(i - 1, 0)], prev2 = b.pts[Math.max(i - 2, 0)];
        const birth = b.births[i] / maxBirth;
        const pb = i > 0 ? b.births[i - 1] / maxBirth : birth - 1e-4;
        const pb2 = i > 1 ? b.births[i - 2] / maxBirth : pb - 1e-4;
        for (let j = 0; j <= SIDES; j++) {
          const ang = (j / SIDES) * Math.PI * 2;
          const dir = Nn.clone().multiplyScalar(Math.cos(ang)).addScaledVector(B, Math.sin(ang));
          const p = b.pts[i];
          P.push(p.x + dir.x * b.radii[i], p.y + dir.y * b.radii[i], p.z + dir.z * b.radii[i]);
          Nrm.push(dir.x, dir.y, dir.z);
          C.push(p.x, p.y, p.z);
          Pr.push(prev.x, prev.y, prev.z);
          Pr2.push(prev2.x, prev2.y, prev2.z);
          Bi.push(birth); PB.push(pb); PB2.push(pb2);
          Rad.push(b.radii[i]);
        }
      }
      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < SIDES; j++) {
          const a = vbase + i * (SIDES + 1) + j, c = a + SIDES + 1;
          idx.push(a, a + 1, c, c, a + 1, c + 1);
        }
      }
      vbase += n * (SIDES + 1);
    }
    const g = new THREE.BufferGeometry();
    const f3 = (a) => new THREE.Float32BufferAttribute(a, 3);
    const f1 = (a) => new THREE.Float32BufferAttribute(a, 1);
    g.setAttribute('position', f3(P));
    g.setAttribute('normal', f3(Nrm));
    g.setAttribute('aCenter', f3(C));
    g.setAttribute('aPrev', f3(Pr));
    g.setAttribute('aPrev2', f3(Pr2));
    g.setAttribute('aBirth', f1(Bi));
    g.setAttribute('aPrevBirth', f1(PB));
    g.setAttribute('aPrev2Birth', f1(PB2));
    g.setAttribute('aRadius', f1(Rad));
    g.setIndex(idx);

    const mat = physical({ color: 0xffffff, metalness: 1, roughness: 0.4, side: THREE.DoubleSide }, {
      uniforms: this.uniforms,
      vertHead: BARK_VERT_HEAD,
      vertPos: BARK_VERT,
      fragHead: BARK_FRAG_HEAD,
      fragBody: BARK_FRAG,
      bump: '0.06',
    });
    // gold inlay carries a slow pulse of light up the trunk
    const compile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader) => {
      compile(shader);
      shader.fragmentShader = patch(shader.fragmentShader, [[
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += ${GOLD} * vein * pulse * 1.6;`,
      ]]);
    };
    this.bark = new THREE.Mesh(g, mat);
    this.bark.frustumCulled = false;
    this.group.add(this.bark);
  }

  _coinGeometry(size) {
    const geo = new THREE.CylinderGeometry(size, size, size * 0.14, 40, 1);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  _coinMaterial(vertHead, vertNormal, vertPos) {
    return physical({ color: 0xffffff, metalness: 1, roughness: 0.3, envMapIntensity: 1.4, side: THREE.DoubleSide }, {
      uniforms: this.uniforms,
      vertHead: COIN_VERT_HEAD + vertHead,
      vertNormal,
      vertPos,
      fragHead: COIN_FRAG_HEAD,
      fragBody: COIN_FRAG,
      bump: '0.0045',
    });
  }

  _buildCoins(leaves, maxBirth) {
    const geo = this._coinGeometry(0.155);
    const n = leaves.length;
    const birth = new Float32Array(n), phase = new Float32Array(n), anchor = new Float32Array(n * 3);
    leaves.forEach((l, i) => {
      birth[i] = l.birth / maxBirth;
      phase[i] = l.phase;
      l.anchor.toArray(anchor, i * 3);
    });
    geo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(birth, 1));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchor, 3));
    this.coins = new THREE.InstancedMesh(geo, this._coinMaterial(HANGING_HEAD, HANGING_NORMAL, HANGING_POS), n);
    this.coins.frustumCulled = false;
    this.group.add(this.coins);
  }

  _buildRain(rng) {
    const n = 320;
    const geo = this._coinGeometry(0.12);
    const start = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 5.5;
      start[i * 3] = Math.cos(a) * r;
      start[i * 3 + 1] = 6 + rng() * 6;
      start[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = rng();
    }
    geo.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    this.rainMesh = new THREE.InstancedMesh(geo, this._coinMaterial(FALLING_HEAD, FALLING_NORMAL, FALLING_POS), n);
    this.rainMesh.frustumCulled = false;
    this.group.add(this.rainMesh);
  }

  _buildGround() {
    const g = new THREE.CircleGeometry(14, 128);
    g.rotateX(-Math.PI / 2);
    this.groundUniforms = { uTime: { value: 0 }, uGlow: { value: 0 }, uTint: { value: new THREE.Color(1, 0.88, 0.75) } };
    this.group.add(new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      uniforms: this.groundUniforms,
      transparent: true,
    })));
  }

  // A heap of coins at the roots that accumulates as the tree grows.
  _buildPile(rng) {
    const n = 520;
    const geo = new THREE.CylinderGeometry(0.13, 0.13, 0.02, 32);
    const face = this.uniforms.uCoinFace.value;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffdb91, metalness: 1, roughness: 0.3, envMapIntensity: 1.2,
      bumpMap: face, bumpScale: 1.2, alphaMap: face, alphaTest: 0.12,
    });
    this.pile = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.75 + Math.pow(rng(), 1.7) * 3.6;
      const h = Math.max(0, 0.5 - r * 0.12) * rng() + 0.012;
      e.set((rng() - 0.5) * 0.6, rng() * 6, (rng() - 0.5) * 0.6);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
      this.pile.setMatrixAt(i, m);
    }
    this.pile.count = 0;
    this.pileMax = n;
    this.group.add(this.pile);
  }

  shakeIt() {
    this.shake = 1;
    this.rain = 1;
  }

  coinsGrown() {
    let lo = 0, hi = this.leafBirths.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.leafBirths[mid] <= this.growth) lo = mid + 1; else hi = mid; }
    return lo;
  }

  update(dt, time, growth, visible) {
    this.group.visible = visible;
    this.growth = growth;
    this.shake *= Math.exp(-dt * 1.6);
    this.rain += (0.12 - this.rain) * (1 - Math.exp(-dt * 0.35));
    this.uniforms.uGrowth.value = growth;
    this.uniforms.uTime.value = time;
    this.uniforms.uShake.value = this.shake;
    this.uniforms.uRain.value = this.rain;
    this.groundUniforms.uTime.value = time;
    this.groundUniforms.uGlow.value = Math.min(1, growth * 1.5);
    this.pile.count = Math.floor(this.pileMax * Math.max(0, (growth - 0.3) / 0.7));
  }
}
