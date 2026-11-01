import * as THREE from 'three';
import { BUMP, patch } from './studio.js';

// The serpent is a follow-the-leader spine simulated on the CPU. Each frame the
// spine (position, tangent, dorsal normal) is packed into a float texture and a
// single tube mesh is skinned from it in the vertex shader of a patched
// MeshPhysicalMaterial, so the body gets real PBR, clearcoat and env reflections.
// The surface is a jeweller's pattern: polished gold scales with a black and
// emerald enamel diamond motif down the spine and wide ventral plates beneath.

const N = 128;
const LENGTH = 12;
const SEG = LENGTH / (N - 1);
const RADIUS = 0.42;
const RINGS = 520;
const SIDES = 36;

const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
// Mirrors profile() in the shader; used to seat the eyes.
function profile(u) {
  return RADIUS * Math.sqrt(smooth(0, 0.028, u)) * (1 + 0.32 * bump(u, 0.04, 0.022)) *
    (1 - 0.22 * bump(u, 0.088, 0.02)) * Math.pow(1 - u, 0.8) * (0.86 + 0.22 * bump(u, 0.36, 0.25));
}
const flatness = (u) => 0.58 + (0.86 - 0.58) * smooth(0.02, 0.13, u);

const VERT_HEAD = /* glsl */ `
uniform sampler2D uSpine;
uniform float uN;
uniform float uR;
uniform float uTime;
varying vec2 vSUv;
vec3 fetchRow(int row, float u){
  float f = u * (uN - 1.0);
  int i0 = int(floor(f));
  int i1 = min(i0 + 1, int(uN) - 1);
  return mix(texelFetch(uSpine, ivec2(i0, row), 0).xyz,
             texelFetch(uSpine, ivec2(i1, row), 0).xyz, fract(f));
}
float bumpf(float x, float c, float w){ float d = (x - c) / w; return exp(-d * d); }
float profile(float u){
  return uR * sqrt(smoothstep(0.0, 0.028, u)) * (1.0 + 0.32 * bumpf(u, 0.04, 0.022))
       * (1.0 - 0.22 * bumpf(u, 0.088, 0.02)) * pow(1.0 - u, 0.8) * (0.86 + 0.22 * bumpf(u, 0.36, 0.25));
}
`;

const VERT_BODY = /* glsl */ `
  float su = position.x;
  float sa = position.y;
  vec3 sP = fetchRow(0, su);
  vec3 sT = normalize(fetchRow(1, su));
  vec3 sN = fetchRow(2, su);
  sN = normalize(sN - sT * dot(sN, sT));
  vec3 sB = cross(sT, sN);
  float sr = profile(su) * (1.0 + 0.025 * sin(uTime * 2.0 - su * 30.0));
  float flat_ = mix(0.58, 0.86, smoothstep(0.02, 0.13, su));
  // belly is flatter than the back
  float ca = cos(sa);
  float dors = ca > 0.0 ? flat_ : flat_ * 0.72;
  vec3 sDir = sN * ca * dors + sB * sin(sa);
  vec3 objectNormal = normalize(sN * ca / dors + sB * sin(sa));
  vec3 sPos = sP + sDir * sr;
  vSUv = vec2(su, sa / 6.2831853);
`;

const FRAG_HEAD = /* glsl */ `
uniform float uTime;
varying vec2 vSUv;
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
${BUMP}
`;

const FRAG_SURFACE = /* glsl */ `
  float along = vSUv.x;
  float head = smoothstep(0.1, 0.06, along);
  float rowsN = mix(130.0, 80.0, head);
  float aroundN = mix(14.0, 11.0, head);
  vec2 g = vec2(vSUv.y * aroundN, along * rowsN);
  float row = floor(g.y);
  float shift = mod(row, 2.0) * 0.5;
  g.x += shift;
  vec2 id = vec2(floor(g.x), row);
  vec2 c = fract(g) - 0.5;
  vec2 sc = vec2(c.x, c.y + 0.18);
  float d = length(sc * vec2(1.0, 1.2));
  // widen the edges with screen-space derivatives so distant scales don't shimmer
  float aa = clamp(fwidth(g.y) * 1.5, 0.0, 0.5);
  float dome = 1.0 - smoothstep(0.05, 0.62 + aa, d);
  float groove = smoothstep(0.44 - aa, 0.54 + aa, d) * (1.0 - smoothstep(0.25, 0.5, aa));

  // cell-centre coordinates so the motif snaps to whole scales (mosaic look)
  float cAround = (id.x + 0.5 - shift) / aroundN;
  float cAlong = (id.y + 0.5) / rowsN;
  float lateral = sin(cAround * 6.2831853);
  float dorsal = cos(cAround * 6.2831853);
  float motif = abs(fract(cAlong * 9.0) - 0.5) * 2.0;
  float dia = abs(lateral) * 1.25 + motif;
  float enamel = step(dia, 0.82) * step(0.0, dorsal) * (1.0 - head);
  float rimGold = step(dia, 1.02) * (1.0 - enamel) * step(0.0, dorsal);
  float emerald = enamel * step(0.6, dia);

  // continuous belly: wide plates instead of scales
  float bellyMask = smoothstep(-0.55, -0.75, cos(vSUv.y * 6.2831853));
  float plate = abs(fract(along * 150.0) - 0.5) * 2.0;
  float plateH = 1.0 - smoothstep(0.75, 1.0, plate);
  float h = mix(dome - groove * 0.6, plateH, bellyMask);

  vec3 gold = vec3(1.0, 0.74, 0.36);
  vec3 col = gold * (0.9 + 0.1 * h21(id));
  col = mix(col, vec3(0.006, 0.006, 0.007), enamel);
  col = mix(col, vec3(0.0, 0.09, 0.045), emerald);
  col = mix(col, gold * vec3(1.0, 0.92, 0.82), bellyMask);
  diffuseColor.rgb = col * (1.0 - groove * 0.55 * (1.0 - bellyMask));

  float sMetal = 1.0 - enamel * (1.0 - bellyMask);
  float sRough = mix(0.27 + groove * 0.3, 0.1, enamel);
  sRough = mix(sRough, 0.3, bellyMask * 0.6);
  sRough = mix(sRough, 0.2, head);
  float sHeight = h;
  // a slow glint that slides head to tail
  float glint = pow(0.5 + 0.5 * sin(along * 30.0 - uTime * 3.5), 24.0) * (1.0 - enamel) * (1.0 - along);
`;

const eyeVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const eyeFragment = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main(){
  vec3 n = normalize(vN), v = normalize(vV);
  float ndv = max(dot(n, v), 0.0);
  vec3 col = mix(vec3(0.0, 0.25, 0.1), vec3(0.2, 2.4, 0.9), pow(ndv, 3.0));
  col += vec3(3.0) * pow(max(dot(reflect(-v, n), normalize(vec3(0.3, 1.0, 0.4))), 0.0), 60.0);
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
  gl_PointSize = aSize * (1.0 - aLife) * 220.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const dustFragment = /* glsl */ `
varying float vLife;
void main(){
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  if (a <= 0.0 || vLife >= 1.0) discard;
  gl_FragColor = vec4(vec3(1.8, 1.2, 0.5) * a * (1.0 - vLife) * 0.8, 1.0);
}
`;

export class Serpent {
  constructor(scene) {
    this.points = Array.from({ length: N }, (_, i) => new THREE.Vector3(-3 - i * SEG, -1.7, 2));
    this.tangents = this.points.map(() => new THREE.Vector3(1, 0, 0));
    this.normals = this.points.map(() => new THREE.Vector3(0, 1, 0));
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
        // denser rings at the head where the shape changes fastest
        const t = i / (RINGS - 1);
        pos[k] = t * t * 0.35 + t * 0.65;
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

    this.uniforms = {
      uSpine: { value: this.tex },
      uN: { value: N },
      uR: { value: RADIUS },
      uTime: { value: 0 },
    };
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.2,
      envMapIntensity: 0.85,
    });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = patch(shader.vertexShader, [
        ['#include <common>', '#include <common>\n' + VERT_HEAD],
        ['#include <beginnormal_vertex>', VERT_BODY],
        ['#include <begin_vertex>', 'vec3 transformed = sPos;'],
      ]);
      shader.fragmentShader = patch(shader.fragmentShader, [
        ['#include <common>', '#include <common>\n' + FRAG_HEAD],
        ['#include <color_fragment>', '#include <color_fragment>\n' + FRAG_SURFACE],
        ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sRough;'],
        ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;'],
        ['#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nnormal = perturbFromHeight(-vViewPosition, normal, sHeight, 0.0055);'],
        ['#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.7, 0.3) * glint * 0.25;'],
      ]);
    };
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // emerald cabochon eyes
    const eyeGeo = new THREE.SphereGeometry(0.05, 24, 16);
    const eyeMat = new THREE.ShaderMaterial({ vertexShader: eyeVertex, fragmentShader: eyeFragment });
    this.eyes = [new THREE.Mesh(eyeGeo, eyeMat), new THREE.Mesh(eyeGeo, eyeMat)];
    this.eyes.forEach((e) => { e.scale.set(1, 0.8, 1.35); scene.add(e); });

    // forked tongue
    this.tongueGeo = new THREE.BufferGeometry();
    this.tongueGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
    this.tongue = new THREE.LineSegments(this.tongueGeo,
      new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 0.08, 0.08) }));
    this.tongue.frustumCulled = false;
    scene.add(this.tongue);

    // gold dust shed from the scales
    this.dustCount = 700;
    this.dustCursor = 0;
    const dp = new Float32Array(this.dustCount * 3);
    this.dustVel = new Float32Array(this.dustCount * 3);
    this.dustLife = new Float32Array(this.dustCount).fill(1);
    const sizes = new Float32Array(this.dustCount).map(() => 0.03 + Math.random() * 0.05);
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
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // Lay the body out in a loose curl around a point (used on load).
  place(center) {
    this.points.forEach((p, i) => {
      const a = i * 0.06;
      p.set(center.x + Math.cos(a) * (1.2 + i * 0.012), center.y, center.z + Math.sin(a) * (1.2 + i * 0.012));
    });
  }

  // groundWeight: 1 = slithering on a floor (back faces up), 0 = free in the air
  // (back faces the camera).
  update(dt, time, target, camPos, groundWeight = 0) {
    const { points, tangents, normals } = this;
    const to = this._a.subVectors(target, points[0]);
    const dist = to.length();
    // cruise gently up close, but cross long distances fast so the body never
    // lingers as a pole through the frame while the camera changes chapters
    const speed = dist > 8 ? Math.min(dist * 4.5, 90) : 1.6 + dist * 2.0;
    const desired = to.normalize();
    const view = this._b.subVectors(camPos, points[0]).normalize().lerp(this._up, groundWeight).normalize();
    // lateral undulation: swing the heading side to side around the dorsal axis
    this.phase += dt * (1.5 + speed * 0.32);
    desired.applyAxisAngle(view, Math.sin(this.phase) * 0.85 * Math.min(1, 0.35 + dist * 0.3)).normalize();
    this.heading.lerp(desired, 1 - Math.exp(-dt * 4)).normalize();
    points[0].addScaledVector(this.heading, speed * dt);

    for (let i = 1; i < N; i++) {
      const d = this._a.subVectors(points[i], points[i - 1]);
      const l = d.length();
      if (l < 1e-6) d.copy(this.heading).negate(); else d.divideScalar(l);
      points[i].copy(points[i - 1]).addScaledVector(d, SEG);
      // on the floor the body settles onto the ground plane
      if (groundWeight > 0) points[i].y += (target.y - points[i].y) * Math.min(1, dt * 6) * groundWeight;
    }

    const blend = 1 - Math.exp(-dt * 10);
    for (let i = 0; i < N; i++) {
      const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, N - 1)];
      tangents[i].subVectors(a, b).normalize();
      const v = this._a.subVectors(camPos, points[i]).normalize().lerp(this._up, groundWeight);
      v.addScaledVector(tangents[i], -v.dot(tangents[i]));
      if (v.lengthSq() > 0.01) normals[i].lerp(v.normalize(), blend).normalize();
      const o = i * 4;
      this.data.set([points[i].x, points[i].y, points[i].z, 1], o);
      this.data.set([tangents[i].x, tangents[i].y, tangents[i].z, 1], N * 4 + o);
      this.data.set([normals[i].x, normals[i].y, normals[i].z, 1], N * 8 + o);
    }
    this.tex.needsUpdate = true;
    this.uniforms.uTime.value = time;

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
    const u = 0.032;
    this._frameAt(u, P, T, Nn, B);
    const r = profile(u);
    const m = new THREE.Matrix4().makeBasis(B, Nn, T);
    this.eyes.forEach((e, k) => {
      e.position.copy(P).addScaledVector(Nn, r * flatness(u) * 0.55).addScaledVector(B, (k ? 1 : -1) * r * 0.66);
      e.quaternion.setFromRotationMatrix(m);
    });

    const nose = new THREE.Vector3();
    this._frameAt(0, nose, T, Nn, B);
    const flick = Math.max(0, Math.sin(time * 5.5)) * (Math.sin(time * 0.9) > 0.2 ? 1 : 0);
    const len = 0.32 * flick;
    const arr = this.tongueGeo.attributes.position.array;
    const mid = nose.clone().addScaledVector(T, len * 0.65);
    const wob = Math.sin(time * 40) * 0.03 * flick;
    const tipA = mid.clone().addScaledVector(T, len * 0.35).addScaledVector(B, 0.05 * flick + wob);
    const tipB = mid.clone().addScaledVector(T, len * 0.35).addScaledVector(B, -0.05 * flick + wob);
    [nose, mid, mid, tipA, mid, tipB].forEach((v, i) => v.toArray(arr, i * 3));
    this.tongueGeo.attributes.position.needsUpdate = true;
  }

  // Subsampled spine for the floor's contact shadow.
  sampleSpine(out, count) {
    for (let i = 0; i < count; i++) {
      const p = this.points[Math.round((i / (count - 1)) * (N - 1))];
      out[i].set(p.x, p.y, p.z, profile(i / (count - 1)));
    }
  }

  _updateDust(dt, speed) {
    const pos = this.dust.geometry.attributes.position.array;
    const emit = Math.random() < 0.5 ? Math.min(Math.floor(speed * 0.12), 3) : 0;
    for (let e = 0; e < emit; e++) {
      const i = this.dustCursor;
      this.dustCursor = (this.dustCursor + 1) % this.dustCount;
      const p = this.points[8 + Math.floor(Math.random() * (N - 20))];
      pos[i * 3] = p.x + (Math.random() - 0.5) * 0.4;
      pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.4;
      pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.4;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.3;
      this.dustVel[i * 3 + 1] = Math.random() * 0.45;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      this.dustLife[i] = 0;
    }
    for (let i = 0; i < this.dustCount; i++) {
      if (this.dustLife[i] >= 1) continue;
      this.dustLife[i] = Math.min(1, this.dustLife[i] + dt / 2.4);
      pos[i * 3] += this.dustVel[i * 3] * dt;
      pos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.aLife.needsUpdate = true;
  }
}
