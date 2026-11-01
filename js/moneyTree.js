import * as THREE from 'three';
import { NOISE, ENV, GOLD, SWAY } from './glsl.js';

// A procedurally grown 摇钱树 (money tree). Branches are generated recursively,
// every ring of every branch is stamped with a "birth" time, and the vertex
// shader grows the tree by sliding each ring out from its parent as uGrowth rises.
// Leaves are square-holed coins hanging on the outer twigs.

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_DEPTH = 5;
const SIDES = 9;

const barkVertex = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aPrev;
attribute vec3 aPrev2;
attribute float aBirth;
attribute float aPrevBirth;
attribute float aPrev2Birth;
attribute float aRadius;
uniform float uGrowth;
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
${SWAY}
void main(){
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
  vec3 p = c + swayOffset(c, uTime) + normal * aRadius * thick;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const barkFragment = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
${NOISE}
${ENV}
void main(){
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(vec3(0.4, 0.9, 0.5));
  float f = fbm(vW * vec3(2.4, 0.5, 2.4));
  float ridge = abs(sin(f * 16.0));
  vec3 bark = mix(vec3(0.025, 0.016, 0.01), vec3(0.17, 0.09, 0.035), ridge);
  float vein = smoothstep(0.07, 0.0, abs(fbm(vW * 1.1 + 3.0) - 0.5));
  float diff = max(dot(n, L), 0.0) * 0.85 + 0.15;
  vec3 env = studioEnv(reflect(-V, n));
  vec3 gold = ${GOLD};
  vec3 col = bark * diff + env * bark * 0.6;
  col = mix(col, gold * env * 0.7 + gold * 0.25, vein);
  // sap of light climbing the gold veins
  float pulse = pow(0.5 + 0.5 * sin(vW.y * 1.2 - uTime * 2.2), 10.0);
  col += gold * vein * pulse * 3.0;
  col += pow(1.0 - max(dot(n, V), 0.0), 3.0) * vec3(0.9, 0.5, 0.15) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Shared by hanging and falling coins.
export const coinFragment = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vCap;
varying float vJade;
${NOISE}
${ENV}
void main(){
  vec2 q = vUv - 0.5;
  float sq = max(abs(q.x), abs(q.y));
  bool cap = vCap > 0.5;
  if (cap && sq < 0.085) discard;
  float r = length(q) * 2.0;
  float rim = smoothstep(0.8, 0.85, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float frame = smoothstep(0.085, 0.1, sq) * (1.0 - smoothstep(0.13, 0.145, sq));
  float ang = atan(q.y, q.x) + 0.785398;
  float quadrant = floor(ang / 1.570796);
  float glyph = step(0.55, vnoise(vec3(q * 26.0, quadrant * 7.0)))
              * step(0.26, r) * step(r, 0.7);
  float emboss = cap ? max(max(rim, frame), glyph * 0.8) : 0.6;

  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vW);
  vec3 env = studioEnv(reflect(-V, n));
  vec3 base = mix(${GOLD}, vec3(0.1, 0.55, 0.32), vJade);
  vec3 col = base * env * (0.45 + 0.75 * emboss);
  col += base * max(dot(n, normalize(vec3(0.4, 0.9, 0.5))), 0.0) * 0.25;
  col += pow(1.0 - max(dot(n, V), 0.0), 3.0) * base * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

const hangingVertex = /* glsl */ `
attribute float aBirth;
attribute float aPhase;
attribute vec3 aAnchor;
uniform float uGrowth;
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vCap;
varying float vJade;
${SWAY}
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }
void main(){
  float s = clamp((uGrowth - aBirth) / 0.05, 0.0, 1.0);
  float pop = s * (1.0 + sin(s * 9.0) * exp(-s * 4.0) * 0.7);
  float spin = uTime * (0.5 + aPhase * 0.9) + aPhase * 40.0;
  mat3 R = rotY(spin);
  vec3 p = R * (position * pop);
  float swing = sin(uTime * 1.7 + aPhase * 12.0) * (0.25 + uShake * 0.9);
  vec3 c = aAnchor + rotZ(swing) * vec3(0.0, -0.24, 0.0);
  vec3 lp = c + p + swayOffset(aAnchor, uTime);
  vec4 w = modelMatrix * vec4(lp, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * (R * normal));
  vUv = uv;
  vCap = abs(normal.z);
  vJade = step(0.93, aPhase);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fallingVertex = /* glsl */ `
attribute vec3 aStart;
attribute float aSeed;
uniform float uTime;
uniform float uRain;
uniform float uGrowth;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vCap;
varying float vJade;
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
void main(){
  float life = fract(uTime * 0.16 * (0.7 + aSeed * 0.6) + aSeed * 7.31);
  float on = step(aSeed, uRain) * smoothstep(0.0, 0.04, life) * smoothstep(1.0, 0.92, life)
           * smoothstep(0.85, 1.0, uGrowth);
  mat3 R = rotY(life * 9.0 + aSeed * 30.0) * rotX(life * 17.0 + aSeed * 11.0);
  vec3 c = aStart;
  c.y = mix(aStart.y, 0.04, pow(life, 1.7));
  c.x += sin(life * 7.0 + aSeed * 40.0) * 0.7;
  c.z += cos(life * 5.0 + aSeed * 23.0) * 0.7;
  vec3 lp = c + R * position * on;
  vec4 w = modelMatrix * vec4(lp, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * (R * normal));
  vUv = uv;
  vCap = abs(normal.z);
  vJade = step(0.95, fract(aSeed * 13.7));
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

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
  float marble = fbm(vec3(q * 6.0, 1.0));
  vec3 col = mix(vec3(0.012, 0.01, 0.009), vec3(0.05, 0.04, 0.035), marble) * uTint;
  // engraved gold rings
  float rings = smoothstep(0.012, 0.0, abs(fract(r * 6.0) - 0.5) - 0.48) * step(r, 0.84);
  float ang = atan(q.y, q.x);
  float ticks = step(0.92, fract(ang * 36.0 / 6.2831)) * step(0.7, r) * step(r, 0.78);
  float glow = 0.6 + 0.4 * sin(uTime * 1.5 - r * 12.0);
  col += ${GOLD} * (rings + ticks) * (0.25 + glow * 0.45) * uGlow;
  // contact shadow
  col *= mix(0.25, 1.0, smoothstep(0.02, 0.22, r));
  float alpha = smoothstep(1.0, 0.55, r);
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
      const segs = depth < 2 ? 12 : 7;
      const pts = [start.clone()], radii = [rad], births = [birth];
      const d = dir.clone();
      let p = start.clone();
      for (let i = 1; i <= segs; i++) {
        d.x += (rng() - 0.5) * 0.22 * (depth + 1) * 0.5;
        d.z += (rng() - 0.5) * 0.22 * (depth + 1) * 0.5;
        d.y += opts.root ? -0.06 : 0.035;
        d.normalize();
        p = p.clone().addScaledVector(d, len / segs);
        pts.push(p);
        radii.push(rad * (1 - 0.5 * (i / segs)));
        births.push(birth + (len * i) / segs);
      }
      // closing tip ring
      pts.push(p.clone().addScaledVector(d, rad * 0.4));
      radii.push(0.001);
      births.push(births[births.length - 1] + rad * 0.4);
      branches.push({ pts, radii, births });
      if (opts.root) return;

      if (depth >= MAX_DEPTH - 2) {
        for (let i = 2; i <= segs; i++) {
          if (rng() < 0.5 + 0.12 * (depth - 2)) {
            leaves.push({
              anchor: pts[i].clone().add(new THREE.Vector3((rng() - 0.5) * 0.12, -0.02, (rng() - 0.5) * 0.12)),
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
        grow(pts[si], cd, len * (0.66 + rng() * 0.14), radii[si] * 0.74, depth + 1, births[si]);
      }
    };

    grow(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 1, 0), 5.2, 0.62, 0, 0);
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
      // parallel-transported frames
      let T = new THREE.Vector3().subVectors(b.pts[1], b.pts[0]).normalize();
      let Nn = new THREE.Vector3(1, 0, 0);
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

    this.uniforms = {
      uGrowth: { value: 0 },
      uTime: { value: 0 },
      uShake: { value: 0 },
      uRain: { value: 0.1 },
    };
    this.bark = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: barkVertex,
      fragmentShader: barkFragment,
      uniforms: this.uniforms,
    }));
    this.bark.frustumCulled = false;
    this.group.add(this.bark);
  }

  _coinGeometry(size) {
    const geo = new THREE.CylinderGeometry(size, size, size * 0.16, 32, 1);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  _buildCoins(leaves, maxBirth) {
    const geo = this._coinGeometry(0.15);
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
    this.coins = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      vertexShader: hangingVertex,
      fragmentShader: coinFragment,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    }), n);
    this.coins.frustumCulled = false;
    this.group.add(this.coins);
  }

  _buildRain(rng) {
    const n = 320;
    const geo = this._coinGeometry(0.13);
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
    this.rainMesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      vertexShader: fallingVertex,
      fragmentShader: coinFragment,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    }), n);
    this.rainMesh.frustumCulled = false;
    this.group.add(this.rainMesh);
  }

  _buildGround() {
    const g = new THREE.CircleGeometry(13, 96);
    g.rotateX(-Math.PI / 2);
    this.groundUniforms = { uTime: { value: 0 }, uGlow: { value: 0 }, uTint: { value: new THREE.Color(1, 0.85, 0.7) } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      uniforms: this.groundUniforms,
      transparent: true,
    }));
    this.group.add(m);
  }

  // A heap of coins at the roots that accumulates as the tree grows.
  _buildPile(rng) {
    const n = 420;
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 0.025, 24);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffb347, metalness: 1, roughness: 0.28 });
    this.pile = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.8 + Math.pow(rng(), 1.6) * 3.8;
      const h = Math.max(0, 0.55 - r * 0.12) * rng() + 0.012;
      e.set((rng() - 0.5) * 0.7, rng() * 6, (rng() - 0.5) * 0.7);
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
