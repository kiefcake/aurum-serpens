import * as THREE from 'three';
import { ENV, GOLD } from './glsl.js';

// The serpent is a follow-the-leader spine simulated on the CPU. Each frame the
// spine (position, tangent, dorsal normal) is packed into a float texture and the
// whole body - a single tube mesh - is skinned in the vertex shader from it.

const N = 128;            // spine joints
const LENGTH = 9;
const SEG = LENGTH / (N - 1);
const RADIUS = 0.24;
const RINGS = 420;        // tube resolution along the body (> N, interpolated)
const SIDES = 28;

const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
// Mirrors profile() in the vertex shader, used to seat the eyes on the head.
function profile(u) {
  return RADIUS * Math.sqrt(smooth(0, 0.03, u)) * (1 + 0.45 * bump(u, 0.032, 0.016)) *
    (1 - 0.2 * bump(u, 0.075, 0.02)) * Math.pow(1 - u, 0.85) * (0.85 + 0.25 * bump(u, 0.35, 0.25));
}

const vertex = /* glsl */ `
uniform sampler2D uSpine;
uniform float uN;
uniform float uR;
uniform float uTime;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
varying vec3 vWorld;
varying vec2 vUv;

vec3 fetchRow(int row, float u){
  float f = u * (uN - 1.0);
  int i0 = int(floor(f));
  int i1 = min(i0 + 1, int(uN) - 1);
  return mix(texelFetch(uSpine, ivec2(i0, row), 0).xyz,
             texelFetch(uSpine, ivec2(i1, row), 0).xyz, fract(f));
}
float bump(float x, float c, float w){ float d = (x - c) / w; return exp(-d * d); }
float profile(float u){
  float nose = sqrt(smoothstep(0.0, 0.03, u));
  float head = 1.0 + 0.45 * bump(u, 0.032, 0.016);
  float neck = 1.0 - 0.2 * bump(u, 0.075, 0.02);
  float tail = pow(1.0 - u, 0.85);
  float girth = 0.85 + 0.25 * bump(u, 0.35, 0.25);
  return uR * nose * head * neck * tail * girth;
}
void main(){
  float u = position.x;
  float a = position.y;
  vec3 P = fetchRow(0, u);
  vec3 T = normalize(fetchRow(1, u));
  vec3 Nn = fetchRow(2, u);
  Nn = normalize(Nn - T * dot(Nn, T));
  vec3 B = cross(T, Nn);
  float r = profile(u) * (1.0 + 0.035 * sin(uTime * 2.2 - u * 34.0));
  float flat_ = mix(0.72, 0.86, smoothstep(0.0, 0.12, u));
  vec3 dir = Nn * cos(a) * flat_ + B * sin(a);
  vec3 nrm = normalize(Nn * cos(a) / flat_ + B * sin(a));
  vec3 wp = P + dir * r;
  vWorld = wp;
  vN = nrm;
  vT = T;
  vB = normalize(cross(nrm, T));
  vUv = vec2(u, a / 6.2831853);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fragment = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
varying vec3 vWorld;
varying vec2 vUv;
${ENV}
void main(){
  // overlapping scales: staggered rows of rounded cells pointing tailward
  vec2 g = vec2(vUv.y * 18.0, vUv.x * 230.0);
  g.x += mod(floor(g.y), 2.0) * 0.5;
  vec2 cell = fract(g) - 0.5;
  vec2 sc = vec2(cell.x, cell.y + 0.22);
  float d = length(sc * vec2(1.0, 1.25));
  float h = 1.0 - smoothstep(0.0, 0.62, d);
  float edge = smoothstep(0.4, 0.56, d);
  vec3 n = normalize(vN + (vB * sc.x - vT * sc.y) * 1.1 * h);

  float dorsal = cos(vUv.y * 6.2831853);
  float belly = smoothstep(-0.25, -0.75, dorsal);
  // diamond saddle markings along the spine
  float along = abs(fract(vUv.x * 22.0) - 0.5) * 2.0;
  float lat = abs(sin(vUv.y * 6.2831853));
  float diamond = 1.0 - smoothstep(0.42, 0.5, abs(along - 0.5) + lat * 0.55);
  float headMask = smoothstep(0.1, 0.0, vUv.x);

  vec3 gold = ${GOLD};
  vec3 emerald = vec3(0.006, 0.07, 0.045);
  vec3 cream = vec3(0.85, 0.66, 0.36);
  vec3 base = mix(emerald, gold, max(diamond, headMask * 0.5) * 0.9);
  base = mix(base, cream * 0.55, belly);
  base = mix(base, gold * 0.9, edge * 0.55);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(vec3(0.5, 0.8, 0.6));
  float ndv = max(dot(n, V), 0.0);
  float diff = max(dot(n, L), 0.0);
  vec3 env = studioEnv(reflect(-V, n));
  float metal = mix(0.45, 1.0, max(max(diamond, edge), belly * 0.6));
  vec3 col = base * (diff * 0.7 + 0.08) * (1.0 - metal) + env * mix(vec3(0.05), base, metal);
  col += pow(1.0 - ndv, 4.0) * vec3(1.0, 0.68, 0.3) * 0.9;
  // thin-film iridescence on the dark scales
  col += 0.12 * h * (1.0 - belly) * (1.0 - diamond) *
         (0.5 + 0.5 * cos(6.2831 * (ndv * 1.6 + vec3(0.0, 0.33, 0.67))));
  // a pulse of light that runs head to tail
  float wave = pow(0.5 + 0.5 * sin(vUv.x * 38.0 - uTime * 6.0), 14.0);
  col += gold * wave * edge * 2.2 * (1.0 - vUv.x);
  gl_FragColor = vec4(col, 1.0);
}
`;

const dustVertex = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;
void main(){
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (1.0 - aLife) * 260.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const dustFragment = /* glsl */ `
varying float vLife;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  if (a <= 0.0 || vLife >= 1.0) discard;
  gl_FragColor = vec4(vec3(2.4, 1.5, 0.55) * a * (1.0 - vLife), 1.0);
}
`;

export class Serpent {
  constructor(scene) {
    this.points = Array.from({ length: N }, (_, i) => new THREE.Vector3(-6 - i * SEG, -2, 0));
    this.tangents = this.points.map(() => new THREE.Vector3(1, 0, 0));
    this.normals = this.points.map(() => new THREE.Vector3(0, 0, 1));
    this.heading = new THREE.Vector3(1, 0, 0);
    this.phase = 0;

    this.data = new Float32Array(N * 3 * 4);
    this.tex = new THREE.DataTexture(this.data, N, 3, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;

    const pos = new Float32Array(RINGS * (SIDES + 1) * 3);
    const idx = [];
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j <= SIDES; j++) {
        const k = (i * (SIDES + 1) + j) * 3;
        pos[k] = i / (RINGS - 1);
        pos[k + 1] = (j / SIDES) * Math.PI * 2;
      }
    }
    for (let i = 0; i < RINGS - 1; i++) {
      for (let j = 0; j < SIDES; j++) {
        const a = i * (SIDES + 1) + j, b = a + SIDES + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);

    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uSpine: { value: this.tex },
        uN: { value: N },
        uR: { value: RADIUS },
        uTime: { value: 0 },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // glowing eyes
    const eyeGeo = new THREE.SphereGeometry(0.04, 16, 12);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 0.9, 0.15) });
    this.eyes = [new THREE.Mesh(eyeGeo, eyeMat), new THREE.Mesh(eyeGeo, eyeMat)];
    this.eyes.forEach((e) => scene.add(e));

    // forked tongue
    this.tongueGeo = new THREE.BufferGeometry();
    this.tongueGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
    this.tongue = new THREE.LineSegments(this.tongueGeo,
      new THREE.LineBasicMaterial({ color: new THREE.Color(3.0, 0.25, 0.2) }));
    this.tongue.frustumCulled = false;
    scene.add(this.tongue);

    // gold dust shed from the scales
    this.dustCount = 900;
    this.dustCursor = 0;
    const dp = new Float32Array(this.dustCount * 3);
    this.dustVel = new Float32Array(this.dustCount * 3);
    this.dustLife = new Float32Array(this.dustCount).fill(1);
    const sizes = new Float32Array(this.dustCount).map(() => 0.04 + Math.random() * 0.08);
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dgeo.setAttribute('aLife', new THREE.BufferAttribute(this.dustLife, 1));
    dgeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.dust = new THREE.Points(dgeo, new THREE.ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);

    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  update(dt, time, target, camPos) {
    const { points, tangents, normals } = this;
    const to = this._a.subVectors(target, points[0]);
    const dist = to.length();
    const speed = Math.min(2.2 + dist * 2.4, 34);
    const desired = to.normalize();
    const view = this._b.subVectors(camPos, points[0]).normalize();
    const side = this._c.crossVectors(desired, view).normalize();
    this.phase += dt * (3 + speed * 0.45);
    desired.addScaledVector(side, Math.sin(this.phase) * 0.6).normalize();
    this.heading.lerp(desired, 1 - Math.exp(-dt * 6)).normalize();
    points[0].addScaledVector(this.heading, speed * dt);

    for (let i = 1; i < N; i++) {
      const d = this._a.subVectors(points[i], points[i - 1]);
      const l = d.length();
      if (l < 1e-6) d.copy(this.heading).negate(); else d.divideScalar(l);
      points[i].copy(points[i - 1]).addScaledVector(d, SEG);
    }

    // tangents point toward the head; the dorsal normal faces the camera so the
    // patterned back is always the side we see
    const blend = 1 - Math.exp(-dt * 10);
    for (let i = 0; i < N; i++) {
      const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, N - 1)];
      tangents[i].subVectors(a, b).normalize();
      const v = this._a.subVectors(camPos, points[i]).normalize();
      v.addScaledVector(tangents[i], -v.dot(tangents[i]));
      if (v.lengthSq() > 0.01) normals[i].lerp(v.normalize(), blend).normalize();
      const o = i * 4;
      this.data.set([points[i].x, points[i].y, points[i].z, 1], o);
      this.data.set([tangents[i].x, tangents[i].y, tangents[i].z, 1], N * 4 + o);
      this.data.set([normals[i].x, normals[i].y, normals[i].z, 1], N * 8 + o);
    }
    this.tex.needsUpdate = true;
    this.material.uniforms.uTime.value = time;

    this._placeHead(time);
    this._updateDust(dt, speed);
  }

  _frameAt(u, P, T, Nn, B) {
    const f = u * (N - 1), i0 = Math.floor(f), i1 = Math.min(i0 + 1, N - 1), t = f - i0;
    P.lerpVectors(this.points[i0], this.points[i1], t);
    T.lerpVectors(this.tangents[i0], this.tangents[i1], t).normalize();
    Nn.lerpVectors(this.normals[i0], this.normals[i1], t);
    Nn.addScaledVector(T, -Nn.dot(T)).normalize();
    B.crossVectors(T, Nn);
  }

  _placeHead(time) {
    const P = new THREE.Vector3(), T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3();
    const u = 0.026;
    this._frameAt(u, P, T, Nn, B);
    const r = profile(u);
    this.eyes.forEach((e, k) => {
      e.position.copy(P).addScaledVector(Nn, r * 0.42).addScaledVector(B, (k ? 1 : -1) * r * 0.62);
    });

    const nose = new THREE.Vector3();
    this._frameAt(0, nose, T, Nn, B);
    const flick = Math.max(0, Math.sin(time * 5.5)) * (Math.sin(time * 0.9) > 0.2 ? 1 : 0);
    const len = 0.28 * flick;
    const arr = this.tongueGeo.attributes.position.array;
    const mid = nose.clone().addScaledVector(T, len * 0.65);
    const wob = Math.sin(time * 40) * 0.03 * flick;
    const tipA = mid.clone().addScaledVector(T, len * 0.35).addScaledVector(B, 0.05 * flick + wob);
    const tipB = mid.clone().addScaledVector(T, len * 0.35).addScaledVector(B, -0.05 * flick + wob);
    [nose, mid, mid, tipA, mid, tipB].forEach((v, i) => v.toArray(arr, i * 3));
    this.tongueGeo.attributes.position.needsUpdate = true;
  }

  _updateDust(dt, speed) {
    const pos = this.dust.geometry.attributes.position.array;
    const emit = Math.min(1 + Math.floor(speed * 0.4), 10);
    for (let e = 0; e < emit; e++) {
      const i = this.dustCursor;
      this.dustCursor = (this.dustCursor + 1) % this.dustCount;
      const j = 8 + Math.floor(Math.random() * (N - 20));
      const p = this.points[j];
      pos[i * 3] = p.x + (Math.random() - 0.5) * 0.3;
      pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.3;
      pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.4;
      this.dustVel[i * 3 + 1] = Math.random() * 0.5 - 0.1;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      this.dustLife[i] = 0;
    }
    for (let i = 0; i < this.dustCount; i++) {
      if (this.dustLife[i] >= 1) continue;
      this.dustLife[i] = Math.min(1, this.dustLife[i] + dt / 2.6);
      pos[i * 3] += this.dustVel[i * 3] * dt;
      pos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.aLife.needsUpdate = true;
  }
}
