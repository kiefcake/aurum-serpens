import * as THREE from 'three';
import { BUMP, patch } from './studio.js';
import { createHead, EYE_POSITIONS, SNOUT } from './serpentHead.js';

// The serpent is a follow-the-leader spine simulated on the CPU. Each frame the
// spine (position, tangent, dorsal normal) is packed into a float texture and a
// single tube mesh is skinned from it in the vertex shader of a patched
// MeshPhysicalMaterial, so the body gets real PBR, clearcoat and env reflections.
// The surface is a jeweller's pattern: polished gold scales with a black and
// emerald enamel diamond motif down the spine and wide ventral plates beneath.

const N = 128;
const LENGTH = 12;
export const SERPENT_LENGTH = LENGTH;
const SEG = LENGTH / (N - 1);
const RADIUS = 0.42;
const RINGS = 520;
const SIDES = 36;

const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
// Mirrors profile() in the shader. The front of the tube is a slim neck that
// disappears inside the sculpted head mesh.
function profile(u) {
  return RADIUS * Math.sqrt(smooth(0, 0.05, u)) * (0.75 + 0.25 * smooth(0.03, 0.12, u)) *
    Math.pow(1 - u, 0.8) * (0.86 + 0.22 * bump(u, 0.36, 0.25));
}

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
  return uR * sqrt(smoothstep(0.0, 0.05, u)) * (0.75 + 0.25 * smoothstep(0.03, 0.12, u))
       * pow(1.0 - u, 0.8) * (0.86 + 0.22 * bumpf(u, 0.36, 0.25));
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
  float head = 0.0;   // the sculpted head mesh covers the front of the tube
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

  // cloisonne motif on continuous coordinates: emerald diamonds in a slim onyx
  // border, each field fenced by a raised gold wire, anti-aliased by fwidth
  float aroundA = vSUv.y * 6.2831853;
  float lateral = sin(aroundA);
  float top = smoothstep(-0.05, 0.12, cos(aroundA)) * (1.0 - head);
  float motif = abs(fract(along * 9.0) - 0.5) * 2.0;
  float dia = abs(lateral) * 1.25 + motif;
  float fw = fwidth(dia) * 0.75 + 1e-4;
  float field = 1.0 - smoothstep(0.82 - fw, 0.82 + fw, dia);
  float core = 1.0 - smoothstep(0.66 - fw, 0.66 + fw, dia);
  float wire = max(1.0 - smoothstep(0.022, 0.022 + fw * 2.0, abs(dia - 0.82)),
                   1.0 - smoothstep(0.016, 0.016 + fw * 2.0, abs(dia - 0.66))) * top;
  float enamel = field * top * (1.0 - wire);
  float emerald = core * top * (1.0 - wire);

  // continuous belly: wide plates instead of scales
  float bellyMask = smoothstep(-0.55, -0.75, cos(vSUv.y * 6.2831853));
  float plate = abs(fract(along * 150.0) - 0.5) * 2.0;
  float plateH = 1.0 - smoothstep(0.75, 1.0, plate);
  float scales = mix(dome - groove * 0.6, 0.3, enamel) + wire * 0.35;
  float h = mix(scales, plateH, bellyMask);

  vec3 gold = vec3(1.0, 0.74, 0.36);
  vec3 col = gold * (0.9 + 0.1 * h21(id));
  col *= 1.0 - groove * 0.55 * (1.0 - bellyMask) * (1.0 - enamel);
  col = mix(col, vec3(0.006, 0.006, 0.007), enamel);
  // emerald is brightest at the heart of each stone, like light pooling in thick glass
  vec3 green = mix(vec3(0.0, 0.05, 0.026), vec3(0.01, 0.2, 0.095), smoothstep(0.62, 0.15, dia));
  col = mix(col, green, emerald);
  col = mix(col, gold * vec3(1.0, 0.92, 0.82), bellyMask);
  diffuseColor.rgb = col;

  float sMetal = 1.0 - enamel * (1.0 - bellyMask);
  float sRough = mix(0.27 + groove * 0.3, 0.06, enamel);
  sRough = mix(sRough, 0.16, wire);
  sRough = mix(sRough, 0.3, bellyMask * 0.6);
  sRough = mix(sRough, 0.2, head);
  float sHeight = h;
  // a slow glint that slides head to tail
  float glint = pow(0.5 + 0.5 * sin(along * 30.0 - uTime * 3.5), 24.0) * (1.0 - enamel) * (1.0 - along);
`;

const eyeVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main(){
  vP = position / 0.058;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const eyeFragment = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main(){
  vec3 n = normalize(vN), v = normalize(vV);
  float ndv = max(dot(n, v), 0.0);
  // deep emerald iris lit from within, a gold ring, and a vertical slit pupil
  float out_ = abs(vP.x);
  float iris = smoothstep(0.2, 0.9, out_);
  vec3 col = mix(vec3(0.0, 0.05, 0.02), vec3(0.05, 0.75, 0.3), iris * (0.4 + 0.6 * ndv));
  col += vec3(1.2, 0.75, 0.2) * smoothstep(0.55, 0.62, out_) * (1.0 - smoothstep(0.62, 0.7, out_)) * 0.6;
  float slit = (1.0 - smoothstep(0.1, 0.18, abs(vP.z) / (0.35 + 0.65 * (1.0 - abs(vP.y))))) * step(0.5, out_);
  col = mix(col, vec3(0.0), slit);
  col += vec3(2.5) * pow(max(dot(reflect(-v, n), normalize(vec3(0.3, 1.0, 0.4))), 0.0), 120.0);
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

    // sculpted head, carrying the emerald cabochon eyes and the tongue
    this.head = createHead();
    scene.add(this.head);
    const eyeGeo = new THREE.SphereGeometry(0.058, 32, 24);
    const eyeMat = new THREE.ShaderMaterial({ vertexShader: eyeVertex, fragmentShader: eyeFragment });
    EYE_POSITIONS.forEach((p) => {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.copy(p);
      e.scale.set(0.8, 0.8, 1.25);
      e.rotation.y = Math.sign(p.x) * 0.35;
      this.head.add(e);
    });

    this.tongueGeo = new THREE.BufferGeometry();
    this.tongueGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
    this.tongue = new THREE.LineSegments(this.tongueGeo,
      new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 0.08, 0.08) }));
    this.tongue.frustumCulled = false;
    this.head.add(this.tongue);

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
  update(dt, time, target, camPos, groundWeight = 0, wiggle = 1) {
    const { points, tangents, normals } = this;
    const to = this._a.subVectors(target, points[0]);
    const dist = to.length();
    // cruise gently up close, but cross long distances fast so the body never
    // lingers as a pole through the frame while the camera changes chapters
    let speed = dist > 8 ? Math.min(dist * 4.5, 90) : 1.6 + dist * 2.0;
    const desired = to.normalize();
    // fast travel needs fast steering, or the turning circle outgrows the
    // distance and it orbits the target; it also eases off while facing away
    const align = this.heading.dot(desired);
    const turn = 4 + speed * 0.25;
    speed *= 0.3 + 0.7 * Math.max(0, align);
    const view = this._b.subVectors(camPos, points[0]).normalize().lerp(this._up, groundWeight).normalize();
    // lateral undulation: swing the heading side to side around the dorsal axis
    this.phase += dt * (1.5 + speed * 0.32);
    desired.applyAxisAngle(view, Math.sin(this.phase) * 0.85 * wiggle * Math.min(1, 0.35 + dist * 0.3)).normalize();
    this.heading.lerp(desired, 1 - Math.exp(-dt * turn)).normalize();
    points[0].addScaledVector(this.heading, speed * dt);

    // on the floor the body settles onto the ground plane (only once it is near
    // it, and before the length constraint so segments never stretch)
    if (groundWeight > 0) {
      const k = Math.min(1, dt * 6) * groundWeight;
      for (let i = 1; i < N; i++) {
        const dy = target.y - points[i].y;
        if (Math.abs(dy) < 2) points[i].y += dy * k;
      }
    }
    for (let i = 1; i < N; i++) {
      const d = this._a.subVectors(points[i], points[i - 1]);
      const l = d.length();
      if (l < 1e-6) d.copy(this.heading).negate(); else d.divideScalar(l);
      points[i].copy(points[i - 1]).addScaledVector(d, SEG);
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
    this._frameAt(0, P, T, Nn, B);
    // right-handed basis: x = N × T, y = dorsal, z = forward
    const X = new THREE.Vector3().crossVectors(Nn, T);
    this.head.position.copy(P);
    this.head.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Nn, T));
    // the head is held a little proud of the body and tastes the air as it goes
    this.head.rotateX(-0.1 + Math.sin(time * 1.3) * 0.04);
    this.head.rotateY(Math.sin(time * 0.9) * 0.06);

    const flick = Math.max(0, Math.sin(time * 5.5)) * (Math.sin(time * 0.9) > 0.2 ? 1 : 0);
    const len = 0.34 * flick;
    const wob = Math.sin(time * 40) * 0.025 * flick;
    const root = SNOUT.clone().setZ(SNOUT.z - 0.06);
    const mid = SNOUT.clone().setZ(SNOUT.z + len * 0.65);
    const tipA = mid.clone().add(new THREE.Vector3(0.05 * flick + wob, -0.01, len * 0.35));
    const tipB = mid.clone().add(new THREE.Vector3(-0.05 * flick + wob, -0.01, len * 0.35));
    const arr = this.tongueGeo.attributes.position.array;
    [root, mid, mid, tipA, mid, tipB].forEach((v, i) => v.toArray(arr, i * 3));
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
