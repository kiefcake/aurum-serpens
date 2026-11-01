import * as THREE from 'three';
import { NOISE, ENV, GOLD } from './glsl.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundFragment } from './moneyTree.js';
import { patch } from './studio.js';

// A raymarched marble ouroboros on a fluted plinth, repaired with kintsugi gold.
// It is rendered inside a proxy box: the box's fragments start rays in the
// sculpture's object space and write true depth, so it composites with the
// rest of the (rasterised) scene, serpent included.

const HALF = new THREE.Vector3(1.75, 3.2, 1.75);

const vertex = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fragment = /* glsl */ `
uniform float uTime;
uniform float uSpin;
uniform mat4 uInvModel;
uniform mat4 uModel;
uniform mat4 uProj;
uniform vec3 uHalf;
uniform vec3 uLight;
varying vec3 vWorld;
#define PI 3.14159265
${NOISE}
${ENV}

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdEllipsoid(vec3 p, vec3 r){ float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

vec3 toSnake(vec3 p){
  vec3 s = p - vec3(0.0, -0.22, 0.0);
  s.xz = rot(uSpin) * s.xz;
  s.yz = rot(0.42) * s.yz;
  return s;
}

float pedestal(vec3 p){
  float ang = atan(p.z, p.x);
  float flute = 0.028 * smoothstep(-0.2, 0.7, cos(ang * 24.0));
  float column = max(length(p.xz) - (0.6 - flute), abs(p.y + 2.03) - 0.83);
  float d = column;
  d = min(d, sdRoundBox(p - vec3(0.0, -1.1, 0.0), vec3(0.95, 0.12, 0.95), 0.04));
  d = min(d, sdRoundBox(p - vec3(0.0, -1.27, 0.0), vec3(0.76, 0.07, 0.76), 0.03));
  d = min(d, sdRoundBox(p - vec3(0.0, -2.93, 0.0), vec3(1.05, 0.1, 1.05), 0.03));
  d = min(d, sdRoundBox(p - vec3(0.0, -2.77, 0.0), vec3(0.8, 0.07, 0.8), 0.03));
  return d;
}

// x: distance, y: material (0 marble, 2 ruby eye)
vec2 snake(vec3 p){
  vec3 s = toSnake(p);
  const float R = 1.15;
  float phi = atan(s.z, s.x);
  float u = (phi + PI) / (2.0 * PI);          // 0 at the tail, 1 at the head
  float wave = 0.16 * sin(3.0 * phi + uTime * 0.8);
  vec2 q = vec2(length(s.xz) - R, s.y - wave);
  float thick = mix(0.055, 0.25, smoothstep(0.0, 0.85, u)) * (1.0 - 0.14 * smoothstep(0.9, 0.97, u));
  float theta = atan(q.y, q.x);
  vec2 g = vec2(theta / (2.0 * PI) * 16.0, u * 110.0);
  g.x += mod(floor(g.y), 2.0) * 0.5;
  vec2 c = fract(g) - 0.5;
  float groove = smoothstep(0.32, 0.5, length(c * vec2(1.0, 1.3) + vec2(0.0, 0.15)));
  float body = length(q) - thick + groove * 0.007 * smoothstep(0.02, 0.15, u);

  float hw = 0.16 * sin(3.0 * PI + uTime * 0.8);
  vec3 hp = s - vec3(-R * cos(0.12), hw, R * sin(0.12));
  hp = vec3(hp.x, hp.y, -hp.z);                 // +z is forward for the head
  float skull = sdEllipsoid(hp - vec3(0.0, 0.02, 0.02), vec3(0.24, 0.19, 0.36));
  float snout = sdEllipsoid(hp - vec3(0.0, -0.01, 0.25), vec3(0.16, 0.115, 0.2));
  float head = smin(skull, snout, 0.08);
  float mouth = max(abs(hp.y + 0.015) - 0.022 - max(hp.z - 0.12, 0.0) * 0.3, 0.06 - hp.z);
  head = max(head, -mouth);
  vec3 bp = vec3(abs(hp.x), hp.y, hp.z);
  head = smin(head, sdEllipsoid(bp - vec3(0.125, 0.12, 0.12), vec3(0.08, 0.05, 0.15)), 0.04);
  float eye = length(bp - vec3(0.16, 0.075, 0.17)) - 0.042;
  head = max(head, -(eye - 0.008));

  vec2 res = vec2(smin(body, head, 0.09), 0.0);
  if (eye < res.x) res = vec2(eye, 2.0);
  return res;
}

vec2 map(vec3 p){
  float ped = pedestal(p);
  // the whole snake, head included, lives inside a fat torus: far from it,
  // the distance to that torus is a safe step and skips the detailed SDF
  vec3 b = toSnake(p);
  float bound = length(vec2(length(b.xz) - 1.15, b.y)) - 0.62;
  if (bound > 0.08) return ped < bound ? vec2(ped, 1.0) : vec2(bound, 0.0);
  vec2 s = snake(p);
  return ped < s.x ? vec2(ped, 1.0) : s;
}

vec3 calcNormal(vec3 p){
  vec2 e = vec2(0.0012, -0.0012);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
                   e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd){
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 28; i++){
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.03, 0.3);
    if (res < 0.002 || t > 5.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n){
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++){
    float h = 0.03 * float(i) * float(i);
    occ += (h - map(p + n * h).x) * w;
    w *= 0.7;
  }
  return clamp(1.0 - occ * 1.6, 0.0, 1.0);
}

vec2 boxHit(vec3 ro, vec3 rd, vec3 b){
  vec3 m = 1.0 / rd;
  vec3 n = m * ro;
  vec3 k = abs(m) * b;
  vec3 t1 = -n - k, t2 = -n + k;
  return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z));
}

void main(){
  vec3 ro = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  vec3 rd = normalize((uInvModel * vec4(vWorld, 1.0)).xyz - ro);
  vec2 tb = boxHit(ro, rd, uHalf);
  if (tb.x > tb.y || tb.y < 0.0) discard;
  float t = max(tb.x, 0.0);
  float m = -1.0;
  for (int i = 0; i < 128; i++){
    vec2 h = map(ro + rd * t);
    if (h.x < 0.0006 * t + 0.0004){ m = h.y; break; }
    t += h.x * 0.8;
    if (t > tb.y) break;
  }
  if (m < 0.0) discard;

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  vec3 L = normalize((uInvModel * vec4(uLight, 0.0)).xyz);
  vec3 tp = m < 0.5 ? toSnake(p) : p;    // texture space follows the spinning snake

  float v = fbm(tp * 1.5);
  float veins = pow(1.0 - abs(sin((tp.x * 1.2 + tp.y * 0.8 + tp.z * 0.4 + v * 5.0) * 2.1)), 9.0);
  vec3 marble = mix(vec3(0.93, 0.91, 0.87), vec3(0.32, 0.31, 0.34), veins * 0.75);
  marble *= 0.9 + 0.1 * fbm(tp * 9.0);

  float crack = voronoiEdge(tp * 1.6 + 4.0);
  float gold = (1.0 - smoothstep(0.012, 0.04, crack)) * smoothstep(0.42, 0.62, fbm(tp * 0.8 + 7.0));

  float sh = softShadow(p + n * 0.01, L);
  float ao = ambientOcclusion(p, n);
  float ndl = dot(n, L);
  float diff = max(ndl, 0.0) * sh;
  // translucency: marble lets light through where it is thin
  float thin = 1.0 - clamp(-map(p - n * 0.14).x / 0.14, 0.0, 1.0);
  float wrap = max((ndl + 0.6) / 1.6, 0.0);
  vec3 V = -rd;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 80.0) * sh;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 sky = vec3(0.55, 0.58, 0.66);

  vec3 col = marble * (diff * vec3(0.78, 0.72, 0.66) + sky * 0.16 * ao * (0.5 + 0.5 * n.y));
  col += marble * vec3(0.9, 0.6, 0.4) * wrap * thin * 0.28;
  col += spec * 0.45 + fres * sky * 0.18 * ao;

  vec3 g = ${GOLD};
  vec3 goldCol = g * studioEnv(reflect(rd, n)) * 0.9 + g * diff * 0.6;
  goldCol += g * (0.9 + 0.6 * sin(uTime * 2.0 + tp.y * 5.0 + tp.x * 3.0));
  col = mix(col, goldCol, gold);
  if (m > 1.5) col = vec3(3.5, 0.15, 0.08) * (0.6 + 0.4 * max(dot(n, V), 0.0)) + spec;

  gl_FragColor = vec4(col, 1.0);
  vec4 clip = uProj * viewMatrix * (uModel * vec4(p, 1.0));
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
}
`;

const shaftVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying float vH;
void main(){
  vH = uv.y;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const shaftFragment = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vW;
varying float vH;
${NOISE}
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float edge = pow(abs(dot(normalize(vN), V)), 2.5);
  float motes = 0.7 + 0.3 * vnoise(vec3(vW.xz * 3.0, vW.y * 2.0 + uTime * 0.4));
  float a = edge * (1.0 - vH) * smoothstep(0.0, 0.15, vH) * motes * 0.075 * uOpacity;
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, 1.0);
}
`;

export class Sculpture {
  constructor(scene, origin) {
    this.origin = origin.clone();
    this.group = new THREE.Group();
    this.group.position.copy(origin);
    scene.add(this.group);

    this.uniforms = {
      uTime: { value: 0 },
      uSpin: { value: 0 },
      uInvModel: { value: new THREE.Matrix4() },
      uModel: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uHalf: { value: HALF },
      uLight: { value: new THREE.Vector3(0.45, 0.9, 0.35).normalize() },
    };
    const box = new THREE.BoxGeometry(HALF.x * 2, HALF.y * 2, HALF.z * 2);
    this.proxy = new THREE.Mesh(box, new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: this.uniforms,
      side: THREE.BackSide,
    }));
    this.proxy.onBeforeRender = (r, s, camera) => this.uniforms.uProj.value.copy(camera.projectionMatrix);
    this.group.add(this.proxy);

    this.shaftUniforms = { uTime: { value: 0 }, uOpacity: { value: 1 } };
    const cone = new THREE.ConeGeometry(2.6, 9, 64, 1, true);
    this.shaft = new THREE.Mesh(cone, new THREE.ShaderMaterial({
      vertexShader: shaftVertex,
      fragmentShader: shaftFragment,
      uniforms: this.shaftUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }));
    this.shaft.position.set(origin.x, origin.y + 1.6, origin.z);
    scene.add(this.shaft);

    const floor = new THREE.CircleGeometry(12, 96);
    floor.rotateX(-Math.PI / 2);
    this.floorUniforms = { uTime: { value: 0 }, uGlow: { value: 0.5 }, uTint: { value: new THREE.Color(0.9, 0.95, 1.15) } };
    this.floor = new THREE.Mesh(floor, new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vW; varying vec2 vUv;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: groundFragment,
      uniforms: this.floorUniforms,
      transparent: true,
    }));
    this.floor.position.set(origin.x, origin.y - 3.03, origin.z);
    scene.add(this.floor);

    this.colonnade = this._buildColonnade(origin);
    scene.add(this.colonnade);

    this.rotation = 0;
    this.velocity = 0.15;
  }

  // A ring of fluted dark-marble columns standing in the gallery's gloom, rim
  // lit by the moonlit windows behind them: parallax and scale for the room.
  _buildColonnade(origin) {
    const H = 11, COUNT = 14, R = 13.5;
    const shaft = new THREE.CylinderGeometry(0.42, 0.47, H - 0.9, 64, 8, true);
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 - 0.07 * Math.max(0, Math.cos(a * 20)) ** 0.6;   // twenty flutes
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    shaft.computeVertexNormals();
    const base = new THREE.BoxGeometry(1.25, 0.5, 1.25).translate(0, -H / 2 + 0.25, 0);
    const torus = new THREE.CylinderGeometry(0.6, 0.62, 0.18, 48).translate(0, -H / 2 + 0.59, 0);
    const neck = new THREE.CylinderGeometry(0.6, 0.47, 0.25, 48).translate(0, H / 2 - 0.52, 0);
    const abacus = new THREE.BoxGeometry(1.2, 0.3, 1.2).translate(0, H / 2 - 0.25, 0);
    [shaft, base, torus, neck, abacus].forEach((g) => { g.deleteAttribute('uv'); });
    const geo = mergeGeometries([shaft.toNonIndexed(), base.toNonIndexed(), torus.toNonIndexed(),
      neck.toNonIndexed(), abacus.toNonIndexed()]);

    const mat = new THREE.MeshStandardMaterial({ color: 0x8a847c, roughness: 0.3, metalness: 0, envMapIntensity: 0.25 });
    this.roomFade = { value: 1 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRoomFade = this.roomFade;
      shader.vertexShader = patch(shader.vertexShader, [
        ['#include <common>', '#include <common>\nvarying float vColY;'],
        ['#include <begin_vertex>', `#include <begin_vertex>\nvColY = position.y / ${H.toFixed(1)} + 0.5;`],
      ]);
      shader.fragmentShader = patch(shader.fragmentShader, [
        ['#include <common>', '#include <common>\nvarying float vColY;\nuniform float uRoomFade;'],
        // fading to black reads as fading out against the dark hall
        ['#include <opaque_fragment>', 'outgoingLight *= uRoomFade;\n#include <opaque_fragment>'],
        // the feet sink into darkness; the capitals catch the most light
        ['#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.04, 1.0, smoothstep(0.0, 0.75, vColY));'],
        ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float rimC = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
          totalEmissiveRadiance += vec3(0.05, 0.065, 0.09) * rimC * smoothstep(0.05, 0.6, vColY);`],
      ]);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2 + 0.11;
      m.makeRotationY(-a).setPosition(origin.x + Math.cos(a) * R, origin.y - 3.03 + H / 2, origin.z + Math.sin(a) * R);
      mesh.setMatrixAt(i, m);
    }
    mesh.computeBoundingSphere();
    return mesh;
  }

  drag(dx) {
    this.velocity = dx * 0.35;
  }

  // the colonnade is the gallery's room: it leaves once the camera pulls out for the coda
  update(dt, time, visible, room = 1) {
    this.group.visible = this.shaft.visible = this.floor.visible = visible;
    this.colonnade.visible = visible && room > 0.01;
    this.roomFade.value = room;
    this.velocity += (0.12 - this.velocity) * (1 - Math.exp(-dt * 1.2));
    this.rotation += this.velocity * dt;
    this.group.rotation.y = this.rotation;
    this.group.updateMatrixWorld();
    this.uniforms.uModel.value.copy(this.group.matrixWorld);
    this.uniforms.uInvModel.value.copy(this.group.matrixWorld).invert();
    this.uniforms.uTime.value = time;
    this.uniforms.uSpin.value = time * 0.08;
    this.shaftUniforms.uTime.value = time;
    this.floorUniforms.uTime.value = time;
  }
}
