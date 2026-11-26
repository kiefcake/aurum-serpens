import * as THREE from 'three';
import { NOISE, ENV, GOLD } from './glsl.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundFragment } from './moneyTree.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patch } from './studio.js';

// A raymarched marble ouroboros on a fluted plinth, repaired with kintsugi gold.
// It is rendered inside a proxy box: the box's fragments start rays in the
// sculpture's object space and write true depth, so it composites with the
// rest of the (rasterised) scene, serpent included.

const HALF = new THREE.Vector3(1.78, 3.2, 1.78);

// The serpent's path: a (2,3) torus knot, so one unbroken body passes through
// itself twice before its head closes on its own tail. Evaluated analytically:
// a point has only two candidate strands, one per winding.
const KNOT_R = 0.95, KNOT_r = 0.38;
const knotAt = (s) => {
  const rho = KNOT_R + KNOT_r * Math.cos(1.5 * s);
  return new THREE.Vector3(rho * Math.cos(s), rho * Math.sin(s), KNOT_r * Math.sin(1.5 * s));
};
// The head is rigid, so bake its frame: its axis runs down the tail lying in the
// mouth (the neck rises to meet it), dorsal facing out from the strand's centre.
const headZ = knotAt(0.25).sub(knotAt(-0.05)).normalize();
const headP = knotAt(0.1).addScaledVector(headZ, -0.42);
const headY = new THREE.Vector3(Math.cos(-0.27) * Math.cos(-0.18), Math.cos(-0.27) * Math.sin(-0.18), Math.sin(-0.27));
headY.addScaledVector(headZ, -headY.dot(headZ)).normalize();
const headX = new THREE.Vector3().crossVectors(headY, headZ);
const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

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
uniform float uFlow;
uniform float uFloat;
uniform mat4 uInvModel;
uniform mat4 uModel;
uniform mat4 uProj;
uniform vec3 uHalf;
uniform vec3 uLight;
uniform sampler2D tHall;
uniform float uHallOn;
uniform float uHallGain;
varying vec3 vWorld;
#define PI 3.14159265
#define TAU 6.2831853
const float KR = ${KNOT_R.toFixed(3)};
const float Kr = ${KNOT_r.toFixed(3)};
const vec3 HP = ${v3(headP)};
const vec3 HX = ${v3(headX)};
const vec3 HY = ${v3(headY)};
const vec3 HZ = ${v3(headZ)};
const float TOP = -1.65;       // top face of the plinth
const float CY = 0.2;          // height the knot levitates at
float gDetail = 1.0;           // carved relief on; shadows and occlusion turn it off
${NOISE}
${ENV}

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdEllipsoid(vec3 p, vec3 r){ float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-4); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float sdCyl(vec3 p, float r, float h, float e){
  vec2 d = vec2(length(p.xz) - r + e, abs(p.y) - h + e);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - e;
}

// object space -> knot space (axis z): hovering, tipped back a little, turned
// so the head rides over the top of the silhouette
vec3 toKnot(vec3 p){
  vec3 s = p - vec3(0.0, CY + uFloat, 0.0);
  s.yz = rot(0.16) * s.yz;
  s.xy = rot(1.2) * s.xy;
  return s;
}

// body radius along the length: whip-thin tail, full flank, slim neck that ends
// inside the skull
float bodyR(float u){
  float r = mix(0.072, 0.205, smoothstep(0.0, 0.42, u));
  r *= mix(1.0, 0.72, smoothstep(0.72, 0.95, u));
  return r * (1.0 - smoothstep(0.955, 0.972, u));
}

// distance from a point to one candidate strand; f is the offset in the strand
// frame (x outward = dorsal), corrected for the slant through the meridian
// plane so the tube stays round
float strand(vec3 p, float s, out vec2 f){
  float a = 1.5 * s;
  vec2 nh = vec2(cos(a), sin(a));
  vec2 q = vec2(length(p.xy) - KR, p.z) - Kr * nh;
  float k = 1.5 * Kr / (KR + Kr * nh.x);
  f = vec2(dot(q, nh), dot(q, vec2(-nh.y, nh.x)) / sqrt(1.0 + k * k));
  return length(f);
}

// nearest strand: x distance to surface, y path parameter s, zw frame offset
vec4 nearestBody(vec3 k){
  float phi = atan(k.y, k.x);
  vec2 f0, f1;
  float s1 = phi + TAU;
  float d0 = strand(k, phi, f0) - bodyR(fract(phi / (2.0 * TAU)));
  float d1 = strand(k, s1, f1) - bodyR(fract(s1 / (2.0 * TAU)));
  return d0 < d1 ? vec4(d0, phi, f0) : vec4(d1, s1, f1);
}

// carved scales: long, domed diamonds with fine seams, crawling toward the mouth
float scaleRelief(float s, vec2 f, float u, out float groove){
  float theta = atan(f.y, f.x);
  float sF = (s - uFlow) * 11.0;
  float around = theta / TAU * 18.0;
  vec2 c = fract(vec2(around + sF, around - sF)) - 0.5;
  float edge = max(abs(c.x), abs(c.y)) * 2.0;
  groove = smoothstep(0.84, 1.0, edge);
  float dome = 1.0 - edge * edge;
  float scales = dome * 0.0058 - groove * 0.0028;
  // smooth ventral plates on the inside of the coil
  float belly = smoothstep(-0.45, -0.7, cos(theta));
  float plate = 1.0 - smoothstep(0.44, 0.5, abs(fract(sF * 0.5) - 0.5));
  groove = mix(groove, (1.0 - plate) * 0.6, belly);
  return mix(scales, -(1.0 - plate) * 0.0035, belly) * smoothstep(0.0, 0.25, u);
}

// The head, sculpted from ellipsoids, jaws closing on the tail between them.
// In head units (see HS); x distance, y material (0 marble, 2 emerald eye, 3 gold)
const float HS = 1.22;
vec2 head(vec3 h){
  // upper jaw and skull: a broad viper wedge resting just above the tail
  vec3 up = h - vec3(0.0, 0.062, 0.0);
  up.yz = rot(0.07) * up.yz;
  vec3 ua = vec3(abs(up.x), up.y, up.z);
  float skull = sdEllipsoid(up - vec3(0.0, 0.05, -0.05), vec3(0.245, 0.135, 0.33));
  float snout = sdEllipsoid(up - vec3(0.0, 0.03, 0.24), vec3(0.125, 0.07, 0.27));
  float upper = smin(skull, snout, 0.11);
  // brows, flared jaw corners, a crest between the eyes
  upper = smin(upper, sdEllipsoid(ua - vec3(0.122, 0.128, 0.07), vec3(0.075, 0.034, 0.16)), 0.04);
  upper = smin(upper, sdEllipsoid(ua - vec3(0.205, 0.0, -0.17), vec3(0.085, 0.08, 0.15)), 0.06);
  upper = max(upper, -sdEllipsoid(ua - vec3(0.0, 0.185, 0.05), vec3(0.028, 0.03, 0.16)));
  // nostril
  upper = max(upper, -(length(ua - vec3(0.055, 0.082, 0.41)) - 0.012));
  // flat palate
  upper = smax(upper, -(up.y + 0.006), 0.012);

  // lower jaw, just under the tail
  vec3 lo = h + vec3(0.0, 0.062, 0.0);
  lo.yz = rot(-0.07) * lo.yz;
  float lower = sdEllipsoid(lo - vec3(0.0, -0.03, 0.08), vec3(0.17, 0.066, 0.4));
  lower = smax(lower, lo.y - 0.004, 0.012);
  // the corner of the mouth joins the two
  float hinge = sdEllipsoid(ua - vec3(0.17, -0.07, -0.14), vec3(0.075, 0.1, 0.13));
  float d = smin(smin(upper, lower, 0.02), hinge, 0.05);

  // eye socket and the cabochon that sits in it
  vec3 ep = ua - vec3(0.178, 0.094, 0.075);
  d = max(d, -(length(ep) - 0.05));
  float eye = length(ep) - 0.041;

  // gold fangs closing on either side of the tail
  vec3 fg = ua - vec3(0.06, -0.008, 0.33);
  float taper = mix(0.02, 0.002, clamp(-fg.y / 0.1, 0.0, 1.0));
  float fang = max(length(fg.xz) - taper, max(fg.y - 0.01, -fg.y - 0.1));

  vec2 res = vec2(d, 0.0);
  if (eye < res.x) res = vec2(eye, 2.0);
  if (fang < res.x) res = vec2(fang, 3.0);
  return res;
}

vec3 toHead(vec3 k){ vec3 v = k - HP; return vec3(dot(v, HX), dot(v, HY), dot(v, HZ)); }

vec2 snake(vec3 p){
  vec3 k = toKnot(p);
  // everything lives inside a fat torus: far away, that is a safe cheap step
  float bound = length(vec2(length(k.xy) - KR, k.z)) - (Kr + 0.34);
  if (bound > 0.08) return vec2(bound, 0.0);

  vec4 b = nearestBody(k);
  float d = b.x;
  float u = fract(b.y / (2.0 * TAU));
  if (gDetail > 0.5 && d < 0.03){
    float gr;
    d -= scaleRelief(b.y, b.zw, u, gr);
  }
  vec3 h = toHead(k);
  float hb = length(h - vec3(0.0, 0.0, 0.05)) - 0.74;
  if (hb > 0.05) return vec2(min(d, hb), 0.0);
  vec2 hd = head(h / HS);
  hd.x *= HS;
  // the neck melts into the skull; the tail in the mouth stays a separate form
  if (hd.y > 0.5) return hd.x < d ? hd : vec2(d, 0.0);
  return vec2(smin(d, hd.x, u > 0.5 ? 0.07 : 0.002), 0.0);
}

float pedestal(vec3 p){
  float d = sdCyl(p - vec3(0.0, -2.94, 0.0), 1.32, 0.09, 0.015);
  d = min(d, sdCyl(p - vec3(0.0, -2.78, 0.0), 1.12, 0.07, 0.02));
  d = min(d, length(vec2(length(p.xz) - 0.8, p.y + 2.67)) - 0.055);
  // the fluted drum
  float dr = length(p.xz) - 0.72;
  if (abs(dr) < 0.12) dr += 0.026 * smoothstep(-0.3, 0.7, cos(atan(p.z, p.x) * 24.0));
  d = min(d, max(dr, abs(p.y + 2.24) - 0.42));
  d = min(d, length(vec2(length(p.xz) - 0.77, p.y + 1.83)) - 0.05);
  d = min(d, sdCyl(p - vec3(0.0, TOP - 0.07, 0.0), 1.04, 0.07, 0.018));
  return d;
}

// x distance, y material: 0 marble, 1 plinth, 2 eye, 3 gold
vec2 map(vec3 p){
  // above the plinth, its height is a cheap safe bound on the distance to it
  float ped = p.y > TOP + 0.15 ? p.y - TOP : pedestal(p);
  vec2 s = snake(p);
  return ped < s.x ? vec2(ped, 1.0) : s;
}

vec3 calcNormal(vec3 p, float t){
  // the normal footprint grows with distance, so distant carving doesn't shimmer
  float h = 0.0009 + 0.00022 * t;
  vec2 e = vec2(h, -h);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
                   e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd){
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 22; i++){
    float h = map(ro + rd * t).x;
    res = min(res, 9.0 * h / t);
    t += clamp(h, 0.035, 0.34);
    if (res < 0.003 || t > 5.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n){
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 4; i++){
    float h = 0.03 * float(i) * float(i);
    occ += (h - map(p + n * h).x) * w;
    w *= 0.66;
  }
  return clamp(1.0 - occ * 1.5, 0.0, 1.0);
}

vec2 boxHit(vec3 ro, vec3 rd, vec3 b){
  vec3 m = 1.0 / rd;
  vec3 n = m * ro;
  vec3 k = abs(m) * b;
  vec3 t1 = -n - k, t2 = -n + k;
  return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z));
}

// what polished stone sees: the moonlit windows around the hall, the shaft of
// warm light overhead, the dark floor below
vec3 hallEnv(vec3 r){
  float az = atan(r.z, r.x);
  float band = smoothstep(-0.02, 0.06, r.y) * (1.0 - smoothstep(0.34, 0.5, r.y));
  float wins = smoothstep(0.2, 0.75, cos(az * 16.0));
  vec3 c = mix(vec3(0.012, 0.012, 0.015), vec3(0.05, 0.055, 0.07), smoothstep(-0.2, 0.8, r.y));
  c += vec3(0.42, 0.52, 0.72) * band * wins;
  c += vec3(3.2, 2.7, 2.1) * smoothstep(0.86, 0.985, r.y);
  return c;
}

// the photographed rotunda (an equirectangular HDRI), once it has loaded;
// the warm shaft overhead is the scene's own light and stays on top of it
vec3 env(vec3 r){
  if (uHallOn < 0.5) return hallEnv(r);
  vec2 uv = vec2(atan(r.z, r.x) * (0.5 / PI) + 0.5, asin(clamp(r.y, -1.0, 1.0)) / PI + 0.5);
  return texture2D(tHall, uv).rgb * uHallGain + vec3(3.2, 2.7, 2.1) * 0.6 * smoothstep(0.86, 0.985, r.y);
}

vec3 marbleColor(vec3 tp){
  float w = fbm(tp * 1.3);
  float v1 = pow(1.0 - abs(sin((tp.x * 1.1 + tp.y * 0.7 + tp.z * 0.5 + w * 4.5) * 2.3)), 10.0);
  float v2 = pow(1.0 - abs(sin((tp.x * 2.3 - tp.y * 1.6 + tp.z * 1.2 + w * 7.5) * 3.1)), 18.0);
  vec3 c = mix(vec3(0.97, 0.955, 0.92), vec3(0.93, 0.89, 0.81), smoothstep(0.35, 0.7, w));
  return mix(c, vec3(0.36, 0.37, 0.42), clamp(v1 * 0.6 + v2 * 0.35, 0.0, 1.0));
}

void main(){
  vec3 ro = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  vec3 rd = normalize((uInvModel * vec4(vWorld, 1.0)).xyz - ro);
  vec2 tb = boxHit(ro, rd, uHalf);
  if (tb.x > tb.y || tb.y < 0.0) discard;
  float t = max(tb.x, 0.0);
  float m = -1.0;
  for (int i = 0; i < 120; i++){
    vec2 h = map(ro + rd * t);
    if (h.x < 0.0005 * t + 0.0003){ m = h.y; break; }
    t += h.x * 0.78;
    if (t > tb.y) break;
  }
  if (m < 0.0) discard;

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p, t);
  vec3 L = normalize((uInvModel * vec4(uLight, 0.0)).xyz);
  mat3 toWorld = mat3(uModel);
  vec3 nw = toWorld * n;
  vec3 V = -rd;
  float ndv = max(dot(n, V), 0.0);
  float fres = pow(1.0 - ndv, 5.0);
  vec3 R_ = toWorld * reflect(rd, n);

  gDetail = 0.0;
  float sh = softShadow(p + n * 0.012, L);
  float ao = ambientOcclusion(p, n);
  float ndl = dot(n, L);
  float diff = max(ndl, 0.0) * sh;
  vec3 H = normalize(L + V);
  float ndh = max(dot(n, H), 0.0);
  vec3 g = ${GOLD};
  vec3 col;

  // gold light rising off the plinth's inlaid ring, what seems to hold the knot up
  float lift = exp(-max(p.y - TOP, 0.0) * 1.25);
  vec3 goldUp = vec3(1.0, 0.62, 0.24) * max(-nw.y * 0.75 + 0.25, 0.0) * lift;

  if (m > 2.5){
    col = g * (env(R_) * 0.8 + studioEnv(R_) * 0.5) + g * diff * 0.5;
  } else if (m > 1.5){
    // emerald cabochon: dark at the heart, lit through the far side, one sharp glint
    float through = pow(1.0 - ndv, 2.0);
    col = mix(vec3(0.0, 0.1, 0.05), vec3(0.04, 0.85, 0.42), through) + vec3(0.02, 0.5, 0.25) * (0.5 + 0.5 * sin(uTime * 0.7));
    col *= 0.6 + 0.4 * sh;
    col += (0.05 + 0.95 * fres) * env(R_) + pow(ndh, 400.0) * 5.0 * sh;
  } else if (m > 0.5){
    // Nero Marquina: polished black stone with white and gold veining
    float w = fbm(p * 1.6 + 11.0);
    float vw = pow(1.0 - abs(sin((p.x * 1.4 + p.y * 2.1 - p.z + w * 5.5) * 2.2)), 26.0);
    float vg = pow(1.0 - abs(sin((p.x * 0.9 - p.y * 1.2 + p.z * 1.7 + w * 7.0) * 1.7)), 42.0);
    vec3 base = mix(vec3(0.011, 0.011, 0.013), vec3(0.55, 0.54, 0.52), vw * 0.75);
    float top = step(TOP - 0.004, p.y);
    float ring = top * (1.0 - smoothstep(0.012, 0.02, abs(length(p.xz) - 0.84)));
    float isGold = max(vg, ring);
    col = base * (diff * vec3(0.9, 0.84, 0.76) + vec3(0.1, 0.11, 0.13) * ao) + base * goldUp * 0.35;
    vec3 refl = env(R_) * ao;
    // the polished top truly mirrors the knot floating above it
    if (top > 0.5 && n.y > 0.8){
      vec3 rr = reflect(rd, n);
      float tr = 0.03, hit = -1.0;
      for (int i = 0; i < 22; i++){
        float h = snake(p + rr * tr).x;
        if (h < 0.002){ hit = 1.0; break; }
        tr += h * 0.85;
        if (tr > 4.0) break;
      }
      if (hit > 0.0){
        vec3 q = p + rr * tr;
        refl = marbleColor(toKnot(q) * 1.3) * (0.32 + 0.5 * exp(-tr * 0.5)) * vec3(1.0, 0.86, 0.68);
      }
    }
    float F = 0.055 + 0.945 * fres;
    col += refl * F + pow(ndh, 240.0) * 0.8 * sh;
    vec3 goldCol = g * (env(R_) + studioEnv(R_) * 0.55) * 0.75 + g * diff * 0.35;
    goldCol += g * ring * (1.5 + 0.5 * sin(uTime * 0.9));
    col = mix(col, goldCol, isGold);
  } else {
    // white statuary marble, carved and polished, mended with gold
    vec3 k = toKnot(p);
    vec3 h3 = toHead(k);
    vec4 b = nearestBody(k);
    float u = fract(b.y / (2.0 * TAU)), gr = 0.0;
    // skull and jaws, but not the tail lying between them
    float inTail = (1.0 - step(0.3, u)) * (1.0 - smoothstep(0.004, 0.02, b.x));
    float headMask = (1.0 - smoothstep(0.0, 0.03, sdEllipsoid(h3 - vec3(0.0, 0.0, 0.03), vec3(0.37, 0.34, 0.7)))) * (1.0 - inTail);
    float unusedRelief = scaleRelief(b.y, b.zw, u, gr);
    // texture space rides with the crawling body; the head has its own
    vec3 tp = mix(vec3((b.y - uFlow) * 1.1, b.zw * 2.2), h3 * 2.2 + 19.0, headMask);
    vec3 marble = marbleColor(tp);
    float cavity = gr * (1.0 - headMask);
    marble *= 1.0 - cavity * 0.3;

    // head shields: broad carved plates rather than body scales
    vec2 hs = h3.xz * vec2(7.5, 5.5);
    vec2 hc = fract(vec2(hs.x + hs.y, hs.x - hs.y)) - 0.5;
    float shield = smoothstep(0.42, 0.5, max(abs(hc.x), abs(hc.y))) * smoothstep(0.03, 0.09, h3.y);
    marble *= 1.0 - shield * headMask * 0.3;

    // kintsugi seams along the stone's breaks, and the dorsal chain of gold diamonds
    float crack = voronoiEdge(tp * 1.5 + 4.0);
    float seam = (1.0 - smoothstep(0.012, 0.04, crack)) * smoothstep(0.4, 0.58, fbm(tp * 0.75 + 7.0));
    float theta = atan(b.w, b.z);
    float dorsal = abs(theta) * 1.9 + abs(fract((b.y - uFlow) * 2.0) - 0.5) * 1.5;
    float chain = (1.0 - smoothstep(0.21, 0.25, dorsal)) * (1.0 - headMask) * smoothstep(0.2, 0.3, u);
    // gold lines the inside of the mouth
    float mouthIn = headMask * smoothstep(0.075, 0.05, abs(h3.y)) * smoothstep(-0.08, -0.02, h3.z);
    float gold = clamp(max(seam, max(chain, mouthIn)), 0.0, 1.0);

    // thin stone glows where the key light gets inside it
    float thin = 1.0 - clamp(-map(p - n * 0.11).x / 0.11, 0.0, 1.0);
    float wrap = max((ndl + 0.6) / 1.6, 0.0);

    vec3 sky = vec3(0.34, 0.4, 0.55);
    col = marble * (diff * vec3(1.12, 1.03, 0.92)
          + sky * 0.4 * ao * (0.6 + 0.4 * nw.y)
          + goldUp * 0.7 * ao);
    col += marble * vec3(1.0, 0.66, 0.46) * wrap * thin * 0.5;
    float F = 0.045 + 0.955 * fres;
    col += env(R_) * F * mix(0.35, 1.0, ao) * (1.0 - cavity * 0.7);
    col += pow(ndh, 180.0) * 0.55 * sh * (1.0 - cavity);
    col += vec3(0.3, 0.38, 0.55) * pow(1.0 - ndv, 3.0) * 0.16 * ao;

    vec3 goldCol = g * (env(R_) * 0.9 + studioEnv(R_) * 0.55) + g * diff * 0.5 + goldUp * g * 0.35;
    goldCol += g * 0.22 * (0.7 + 0.3 * sin(uTime * 1.3 + (b.y - uFlow) * 2.0));
    col = mix(col, goldCol, gold);
  }

  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
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
      uFlow: { value: 0 },
      uFloat: { value: 0 },
      uInvModel: { value: new THREE.Matrix4() },
      uModel: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uHalf: { value: HALF },
      uLight: { value: new THREE.Vector3(0.45, 0.9, 0.35).normalize() },
      tHall: { value: null },
      uHallOn: { value: 0 },
      uHallGain: { value: 1 },
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
    this.origin = origin.clone();
    this.props = new THREE.Group();
    scene.add(this.props);

    this.rotation = 0;
    this.velocity = 0;
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

    const mat = new THREE.MeshStandardMaterial({ color: 0x8a847c, roughness: 0.3, metalness: 0, envMapIntensity: 0.15 });
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
  // The gallery's light: the raw panorama for the raymarched stone, and its
  // prefiltered version for everything rasterised in the room
  setHall(equirect, envMap) {
    this.uniforms.tHall.value = equirect;
    this.uniforms.uHallOn.value = 1;
    this.uniforms.uHallGain.value = 0.55;
    this.hallEnv = envMap;
    this.colonnade.material.envMap = envMap;
    this.colonnade.material.envMapIntensity = 0.55;
    this.colonnade.material.needsUpdate = true;
  }

  // Photogrammetry scans (Poly Haven, CC0): marble busts and brass vases on
  // black marble pedestals between the columns, behind the sculpture
  async loadProps() {
    const loader = new GLTFLoader();
    const load = (name) => loader.loadAsync(`assets/models/${name}/${name}_1k.gltf`).then((g) => g.scene);
    const [bust, vase] = await Promise.all([load('marble_bust_01'), load('brass_vase_01')]);
    const fade = (mat) => {
      mat.envMap = this.hallEnv || null;
      mat.envMapIntensity = 0.9;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uRoomFade = this.roomFade;
        shader.fragmentShader = patch(shader.fragmentShader, [
          ['#include <common>', '#include <common>\nuniform float uRoomFade;'],
          ['#include <opaque_fragment>', 'outgoingLight *= uRoomFade;\n#include <opaque_fragment>'],
        ]);
      };
    };
    bust.traverse((o) => { if (o.isMesh) fade(o.material); });
    vase.traverse((o) => { if (o.isMesh) { fade(o.material); o.material.envMapIntensity = 1.3; } });

    const pedMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.14, metalness: 0 });
    fade(pedMat);
    const pedGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.42, 0.42, 1.5, 48).translate(0, 0.75, 0),
      new THREE.CylinderGeometry(0.52, 0.52, 0.1, 48).translate(0, 0.05, 0),
      new THREE.CylinderGeometry(0.5, 0.5, 0.08, 48).translate(0, 1.54, 0),
    ]);
    const COLS = 14, R = 12.2, floorY = this.origin.y - 3.03;
    // the bays straight behind the sculpture, as the camera sees it
    [-2, -1, 0, 1].forEach((k, i) => {
      const a = -Math.PI / 2 + (k / COLS) * Math.PI * 2 + 0.11;
      const x = this.origin.x + Math.cos(a) * R, z = this.origin.z + Math.sin(a) * R;
      const ped = new THREE.Mesh(pedGeo, pedMat);
      ped.position.set(x, floorY, z);
      const item = (i % 2 === 0 ? bust : vase).clone();
      item.scale.setScalar(i % 2 === 0 ? 2.5 : 2.1);
      item.position.set(x, floorY + 1.58, z);
      // face the centre of the room
      item.rotation.y = Math.atan2(this.origin.x - x, this.origin.z - z);
      this.props.add(ped, item);
    });
  }

  update(dt, time, visible, room = 1) {
    this.group.visible = this.shaft.visible = this.floor.visible = visible;
    this.colonnade.visible = this.props.visible = visible && room > 0.01;
    this.roomFade.value = room;
    // a slow sway keeps the knot's face toward the viewer; a drag spins it and
    // it drifts back to the nearest full turn
    this.velocity *= Math.exp(-dt * 1.6);
    this.rotation += this.velocity * dt;
    const home = Math.round(this.rotation / (Math.PI * 2)) * Math.PI * 2;
    this.rotation += (home - this.rotation) * (1 - Math.exp(-dt * 0.3));
    this.group.rotation.y = this.rotation + Math.sin(time * 0.13) * 0.42;
    this.group.updateMatrixWorld();
    this.uniforms.uModel.value.copy(this.group.matrixWorld);
    this.uniforms.uInvModel.value.copy(this.group.matrixWorld).invert();
    this.uniforms.uTime.value = time;
    this.uniforms.uFlow.value = time * 0.05;   // the body feeds itself into the mouth
    this.uniforms.uFloat.value = Math.sin(time * 0.55) * 0.035;
    this.shaftUniforms.uTime.value = time;
    this.floorUniforms.uTime.value = time;
  }
}
