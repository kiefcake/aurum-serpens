import * as THREE from 'three';
import { NOISE } from './glsl.js';

// The backdrop of every chapter lives in one sky-dome shader, each scene only
// evaluated while its chapter weight is non-zero:
//   hero       a jeweller's studio: velvet drapes catching a warm backlight
//   tree       ink-wash mountains at dusk, the coin moon rising in the valley
//   sculpture  a moonlit gallery wall of tall arched windows
//   coda       deep space, fine stars and a slow band of gold nebula
// Plus gold motes drifting along the whole descent.

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFragment = /* glsl */ `
uniform vec4 uW;            // hero, tree, sculpture, coda
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uMoonRight;
uniform vec3 uMoonUp;
uniform float uMoonTan;     // tangent of the disc's angular radius
uniform float uMoonLight;
varying vec3 vDir;
#define PI 3.14159265
${NOISE}
float fbm3(vec3 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 1.7) + 0.125 * vnoise(p * 4.01 + 9.2) + 0.0625; }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// ---- hero: dark velvet drapes, folds lit from a soft warm source behind the stage
vec3 hero(vec3 d){
  float az = atan(d.x, -d.z);                      // 0 straight ahead of the hero camera
  float y = d.y;
  vec3 col = mix(vec3(0.004, 0.0035, 0.003), vec3(0.0012, 0.001, 0.001), smoothstep(-0.1, 0.6, y));
  float warp = vnoise(vec3(az * 3.0, y * 1.2, 2.0)) * 2.4;
  float folds = 0.5 + 0.5 * sin(az * 34.0 + warp + y * 0.8);
  folds = pow(folds, 3.0);
  // lit only in a band around eye level behind the stage; above it the drapes fall into shadow
  float back = exp(-az * az * 1.6) * smoothstep(0.55, 0.05, y) * smoothstep(-0.25, 0.0, y);
  col += vec3(0.028, 0.018, 0.01) * folds * back;
  // soft pool of light behind the rings
  col += vec3(0.04, 0.026, 0.012) * exp(-(az * az * 6.0 + (y - 0.1) * (y - 0.1) * 14.0));
  return col;
}

// ---- tree: coin moon + layered mountain ridges + mist
vec3 moon(vec3 d, out float cover){
  cover = 0.0;
  float z = dot(d, uMoonDir);
  if (z <= 0.0) return vec3(0.0);
  vec2 q = vec2(dot(d, uMoonRight), dot(d, uMoonUp)) / z / uMoonTan * 0.78;
  float r = length(q) / 0.78;
  if (r > 1.6) return vec3(0.0);
  float sq = max(abs(q.x), abs(q.y)) / 0.78;
  float disc = 1.0 - smoothstep(0.995, 1.005, r);
  float hole = smoothstep(0.205, 0.195, sq);
  float rim = smoothstep(0.86, 0.88, r) * (1.0 - smoothstep(0.97, 0.99, r));
  float frame = smoothstep(0.2, 0.21, sq) * (1.0 - smoothstep(0.27, 0.28, sq));
  float pits = fbm(vec3(q * 5.0, 2.0));
  float wear = fbm3(vec3(q * 18.0, 7.0));
  vec3 nrm = normalize(vec3(q * 0.9, 1.0));
  float light = clamp(dot(nrm, normalize(vec3(-0.55, 0.55, 0.6))), 0.0, 1.0);
  float body = (0.45 + 0.55 * pits) * (0.75 + 0.25 * wear);
  vec3 gold = vec3(0.95, 0.6, 0.24);
  vec3 col = gold * body * (0.08 + 1.1 * light * light) * (1.0 + max(rim, frame) * 1.2);
  cover = disc * (1.0 - hole);
  col *= cover;
  col += gold * exp(-max(r - 1.0, 0.0) * 5.0) * (1.0 - disc) * 0.22;
  return col * 0.2 * uMoonLight;
}
float ridge(float az, float seed, float freq){
  vec3 p = vec3(cos(az) * freq, sin(az) * freq, seed);
  float n = 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.3 + 4.0) + 0.15 * vnoise(p * 5.1 + 9.0);
  return n * n;
}
vec3 tree(vec3 d){
  float y = d.y;
  float az = atan(d.z, d.x);
  vec3 top = vec3(0.004, 0.0025, 0.0015), glow = vec3(0.07, 0.036, 0.013);
  vec3 col = mix(glow, top, smoothstep(-0.02, 0.45, y));
  col += vec3(0.03, 0.014, 0.004) * exp(-max(y, 0.0) * 9.0);
  float cover;
  vec3 m = moon(d, cover);
  col = col * (1.0 - cover * 0.9) + m;
  // the moon rises in a valley: ridges dip toward its azimuth
  float mAz = atan(uMoonDir.z, uMoonDir.x);
  float da = abs(mod(az - mAz + PI, 2.0 * PI) - PI);
  float valley = 0.35 + 0.65 * smoothstep(0.08, 0.7, da);
  // three ridges, far to near: lower contrast and lighter with distance (aerial perspective)
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float h = (0.02 + 0.03 * fi + ridge(az, fi * 13.0, 2.5 + fi * 1.5) * (0.12 + 0.06 * fi)) * valley - 0.02;
    float edge = fwidth(y) * 1.5 + 0.0015;
    float m_ = 1.0 - smoothstep(h - edge, h + edge, y);
    vec3 ink = mix(vec3(0.045, 0.024, 0.01), vec3(0.006, 0.004, 0.003), fi / 2.0);
    // mist pooling at the foot of each ridge
    ink = mix(ink, glow * 0.8, exp(-(h - y) * (14.0 - fi * 3.0)) * 0.6);
    col = mix(col, ink, m_);
  }
  // a band of low cloud across the valley floor
  float mist = fbm3(vec3(az * 3.0 + uTime * 0.01, y * 30.0, 1.0));
  col += glow * 0.35 * smoothstep(0.35, 0.8, mist) * exp(-abs(y + 0.02) * 30.0);
  return col;
}

// ---- sculpture: gallery wall with tall arched windows holding cool moonlight
vec3 gallery(vec3 d){
  float y = d.y;
  float az = atan(d.z, d.x);
  vec3 col = mix(vec3(0.004, 0.0045, 0.006), vec3(0.03, 0.033, 0.042), smoothstep(-0.2, 0.7, y));
  float cells = 16.0;
  float cw = 2.0 * PI / cells;
  float x = fract(az / cw) - 0.5;               // -0.5..0.5 across one bay
  float ey = y / cw;                            // elevation in bay widths
  float w = 0.17, y0 = 0.02, y1 = 0.62;
  // signed distance to a round-headed window, edges softened by derivatives
  float sd = ey > y1 ? length(vec2(x, ey - y1)) - w : max(abs(x) - w, y0 - ey);
  float aa = fwidth(ey) * 1.5;
  float win = 1.0 - smoothstep(-aa, aa, sd);
  float mull = (1.0 - smoothstep(0.0, 0.008 + aa, abs(x))) + (1.0 - smoothstep(0.0, 0.008 + aa, abs(ey - 0.32)));
  float glass = clamp(1.0 - mull, 0.0, 1.0);
  vec3 moonlit = mix(vec3(0.05, 0.065, 0.09), vec3(0.11, 0.13, 0.17), smoothstep(y0, y1 + w, ey));
  col = mix(col, moonlit * (0.75 + 0.25 * h21(vec2(floor(az / cw), 3.0))), win * glass);
  // light spilling around each window into the hall
  col += vec3(0.02, 0.026, 0.036) * exp(-max(sd, 0.0) * 9.0) * (1.0 - win);
  // dark floor line at the foot of the wall
  col *= mix(0.35, 1.0, smoothstep(-0.06, 0.02, y));
  return col;
}

// ---- coda: stars and a gold nebula band
vec3 coda(vec3 d){
  float t = uTime * 0.004;
  vec3 r = vec3(d.x * cos(t) - d.z * sin(t), d.y, d.x * sin(t) + d.z * cos(t));
  vec3 col = vec3(0.0015, 0.0012, 0.001);
  // nebula along a tilted great circle
  float band = dot(r, normalize(vec3(0.3, 1.0, 0.25)));
  float neb = fbm(r * 2.2 + 3.0);
  float dust = exp(-band * band * 9.0) * smoothstep(0.35, 0.85, neb);
  col += vec3(0.07, 0.04, 0.014) * dust;
  col += vec3(0.02, 0.012, 0.006) * exp(-band * band * 3.0) * neb;
  // dark lanes cut through it
  col *= 1.0 - 0.7 * exp(-band * band * 30.0) * smoothstep(0.5, 0.7, fbm3(r * 6.0));
  // stars: one candidate per cell, crisp at any resolution
  vec3 g = r * 160.0;
  vec3 id = floor(g), f = fract(g) - 0.5;
  float hs = hash31(id);
  vec3 off = (hash33(id) - 0.5) * 0.7;
  float sd = length(f - off);
  // never thinner than a pixel; spread the same energy instead of flickering
  float px = length(fwidth(g)) * 0.6;
  float star = smoothstep(0.1 + px, 0.0, sd) * (0.1 / (0.1 + px)) * step(0.93, hs) * (0.4 + 2.0 * pow(hash31(id + 7.0), 6.0));
  star *= 0.7 + 0.3 * sin(uTime * (1.0 + hs * 3.0) + hs * 40.0);
  col += mix(vec3(1.0, 0.85, 0.6), vec3(0.75, 0.85, 1.0), hash31(id + 3.0)) * star;
  return col;
}

void main(){
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0);
  if (uW.x > 0.001) col += hero(d) * uW.x;
  if (uW.y > 0.001) col += tree(d) * uW.y;
  if (uW.z > 0.001) col += gallery(d) * uW.z;
  if (uW.w > 0.001) col += coda(d) * uW.w;
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

const MOON_RADIUS = 0.25;   // angular radius, radians

export class Atmosphere {
  constructor(scene, moonAnchor) {
    this.moonAnchor = moonAnchor.clone();
    this.uniforms = {
      uW: { value: new THREE.Vector4(1, 0, 0, 0) },
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0, 0, -1) },
      uMoonRight: { value: new THREE.Vector3(1, 0, 0) },
      uMoonUp: { value: new THREE.Vector3(0, 1, 0) },
      uMoonTan: { value: Math.tan(MOON_RADIUS) },
      uMoonLight: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    }));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
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
    this._v = new THREE.Vector3();
  }

  update(time, camera, weights, pixelRatio, growth) {
    const u = this.uniforms;
    this.sky.position.copy(camera.position);
    u.uTime.value = time;
    u.uW.value.set(weights.hero, weights.tree, weights.sculpture, weights.outro);
    this.moteUniforms.uTime.value = time;
    this.moteUniforms.uPixel.value = pixelRatio;

    // the coin moon hangs behind the tree from wherever the camera orbits, like
    // a body at infinity, and climbs out of the valley as the tree grows
    if (weights.tree > 0.001) {
      const dir = u.uMoonDir.value;
      dir.copy(this.moonAnchor).sub(camera.position).setY(0).normalize();
      dir.y = -0.02 + growth * 0.17;
      dir.normalize();
      u.uMoonRight.value.crossVectors(dir, this._v.set(0, 1, 0)).normalize();
      u.uMoonUp.value.crossVectors(u.uMoonRight.value, dir);
      u.uMoonLight.value = 0.35 + 0.65 * growth;
    }
  }
}
