import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { DualBloomPass } from './bloom.js';
import { Serpent, SERPENT_LENGTH } from './serpent.js';
import { MoneyTree } from './moneyTree.js';
import { Sculpture } from './sculpture.js';
import { Atmosphere } from './atmosphere.js';
import { Stage } from './stage.js';
import { createStudioEnvironment } from './studio.js';
import { FinalShader } from './finalPass.js';
import { initUI } from './ui.js';
import { initSmoothScroll } from './smoothScroll.js';

const TREE_ORIGIN = new THREE.Vector3(0, -44, 0);
const SCULPTURE_ORIGIN = new THREE.Vector3(0, -86, 0);
const HERO_FLOOR = -2;
const RING_R = SERPENT_LENGTH / (Math.PI * 2) * 0.97;

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// render scale ladder: the governor below walks it to hold the frame rate
const ladder = (dpr) => {
  const top = Math.min(dpr, 1.75);
  return [top, ...[1.5, 1.25, 1, 0.8, 0.65].filter((s) => s < top - 0.01)];
};
let SCALES = ladder(window.devicePixelRatio);
let pixelRatio = SCALES[0];
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.environment = createStudioEnvironment(renderer);
const key = new THREE.DirectionalLight(0xffe0b0, 0.7);
key.position.set(4, 9, 6);
scene.add(key);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 1200);
camera.position.set(0, 0, 14);

const atmosphere = new Atmosphere(scene, TREE_ORIGIN.clone().add(new THREE.Vector3(0, 7, 0)));
const tree = new MoneyTree(scene, TREE_ORIGIN);
const sculpture = new Sculpture(scene, SCULPTURE_ORIGIN);
const serpent = new Serpent(scene);
const stage = new Stage(scene, HERO_FLOOR);
const shadowSamples = stage.shadowSamples;
stage.hideInReflection.push(tree.group, sculpture.group, sculpture.shaft, sculpture.floor, sculpture.colonnade, atmosphere.motes);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * pixelRatio, innerHeight * pixelRatio, {
  type: THREE.HalfFloatType,
  samples: pixelRatio >= 1.4 ? 2 : 4,
}));
composer.addPass(new RenderPass(scene, camera));
const bloom = new DualBloomPass({ threshold: 1.0, knee: 0.6 });
composer.addPass(bloom);
// the lens pass composites bloom and does tone mapping + sRGB output itself
const lens = new ShaderPass(FinalShader);
lens.uniforms.tBloom.value = bloom.texture;
composer.addPass(lens);

// ---------------------------------------------------------------- adaptive quality
// The render scale walks a ladder to hold ~60 fps. Where the browser exposes GPU
// timer queries the decision uses real GPU milliseconds (immune to vsync and to
// background-tab throttling) and can predict whether the next step up still
// fits; elsewhere it falls back to frame time and only ever steps down.
const gl = renderer.getContext();
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const queries = [];
const quality = { level: 0, avg: 0, samples: 0, ups: 0 };

function msaaFor(pr) {
  // dense screens already supersample; spend MSAA where pixels are coarse
  return pr >= 1.4 || pr < 1 ? 2 : 4;
}

function applyPixelRatio(pr) {
  pixelRatio = pr;
  renderer.setPixelRatio(pr);
  const samples = msaaFor(pr);
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
  }
  composer.setPixelRatio(pr);
  stage.resize(pr);
  lens.uniforms.uRes.value = [innerWidth * pr, innerHeight * pr];
}

function setLevel(next) {
  quality.level = next;
  quality.avg = 0;
  quality.samples = 0;
  applyPixelRatio(SCALES[next]);
}

function sampleCost(ms) {
  quality.samples++;
  quality.avg += (ms - quality.avg) / Math.min(quality.samples, 30);
  if (quality.samples < 90) return;           // ~1.5 s of evidence per decision
  const { level, avg } = quality;
  if (timer) {
    const ratio = level > 0 ? (SCALES[level - 1] / SCALES[level]) ** 2 : Infinity;
    if (avg > 15 && level < SCALES.length - 1) setLevel(level + 1);
    else if (avg * ratio < 11) setLevel(level - 1);
    else quality.samples = 60;
  } else if (avg > 22 && level < SCALES.length - 1) setLevel(level + 1);
  else if (avg < 17.4 && level > 0 && quality.ups < 1) { quality.ups++; setLevel(level - 1); }
  else quality.samples = 60;
}

function beginGpuTimer() {
  if (!timer || queries.length > 4) return false;
  const q = gl.createQuery();
  gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
  queries.push(q);
  return true;
}

function endGpuTimer(started) {
  if (started) gl.endQuery(timer.TIME_ELAPSED_EXT);
  while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = queries.shift();
    const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && ms > 0.05) sampleCost(ms);
    gl.deleteQuery(q);
  }
}

// ---------------------------------------------------------------- scroll rig
const sections = {
  hero: document.getElementById('hero'),
  tree: document.getElementById('tree'),
  sculpture: document.getElementById('sculpture'),
  outro: document.getElementById('outro'),
};
let anchors = {};
let camPath, lookPath, keyP;

function buildRig() {
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const span = (el) => [el.offsetTop / max, Math.min(1, (el.offsetTop + el.offsetHeight - innerHeight) / max)];
  anchors = { tree: span(sections.tree), sculpture: span(sections.sculpture), outro: span(sections.outro) };

  const T = TREE_ORIGIN, S = SCULPTURE_ORIGIN;
  const keys = [[0, [0, 4.8, 10.5], [0, -1.1, 0]]];
  const [t0, t1] = anchors.tree;
  for (let i = 0; i <= 4; i++) {
    const a = -0.35 + (i / 4) * 2.2;
    const r = 25 - i * 1.3;
    keys.push([t0 + (t1 - t0) * (i / 4),
      [T.x + Math.sin(a) * r, T.y + 6 + i * 1.2, T.z + Math.cos(a) * r],
      [T.x, T.y + 6.5 + i * 0.4, T.z]]);
  }
  const [s0, s1] = anchors.sculpture;
  keys.push([s0, [S.x - 1.6, S.y + 0.9, S.z + 10.8], [S.x, S.y - 0.4, S.z]]);
  keys.push([s0 + (s1 - s0) * 0.5, [S.x + 2.6, S.y + 0.6, S.z + 8.2], [S.x, S.y - 0.3, S.z]]);
  keys.push([s1, [S.x + 0.5, S.y + 1.1, S.z + 6.6], [S.x, S.y + 0.15, S.z]]);
  keys.push([1, [S.x, S.y + 20, S.z + 34], [S.x, S.y + 8, S.z]]);

  keyP = keys.map((k) => k[0]);
  camPath = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal');
  lookPath = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[2])), false, 'centripetal');
  buildTiming();
}

// Scroll progress -> curve parameter through the keys. A monotone cubic
// (Fritsch-Carlson) keeps the camera moving through each key instead of
// easing to a halt at every one, without ever backing up.
let keyM = [];
function buildTiming() {
  const n = keyP.length, du = 1 / (n - 1);
  const sec = [];
  for (let i = 0; i < n - 1; i++) sec.push(du / Math.max(keyP[i + 1] - keyP[i], 1e-5));
  keyM = keyP.map((_, i) => (i === 0 ? sec[0] : i === n - 1 ? sec[n - 2] : (sec[i - 1] + sec[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    const a = keyM[i] / sec[i], b = keyM[i + 1] / sec[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); keyM[i] = k * a * sec[i]; keyM[i + 1] = k * b * sec[i]; }
  }
  // start and end at rest
  keyM[0] = 0;
  keyM[n - 1] = 0;
}

function pathU(p) {
  const n = keyP.length;
  if (p <= keyP[0]) return 0;
  if (p >= keyP[n - 1]) return 1;
  let i = 0;
  while (i < n - 2 && p > keyP[i + 1]) i++;
  const h = keyP[i + 1] - keyP[i], t = (p - keyP[i]) / h;
  const t2 = t * t, t3 = t2 * t;
  const u0 = i / (n - 1), u1 = (i + 1) / (n - 1);
  return (2 * t3 - 3 * t2 + 1) * u0 + (t3 - 2 * t2 + t) * h * keyM[i] +
         (-2 * t3 + 3 * t2) * u1 + (t3 - t2) * h * keyM[i + 1];
}

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
function stationWeights(p) {
  const [t0, t1] = anchors.tree, [s0, s1] = anchors.sculpture;
  const treeW = smooth(t0 - 0.06, t0, p) * (1 - smooth(t1, s0, p));
  const outroW = smooth(s1, s1 + (1 - s1) * 0.7, p);
  const sculptW = smooth(t1, s0, p) * (1 - outroW);
  return { hero: Math.max(0, 1 - treeW - sculptW - outroW), tree: treeW, sculpture: sculptW, outro: outroW };
}

// ---------------------------------------------------------------- input
const pointer = { ndc: new THREE.Vector2(), lastMove: -10, down: false, x: 0, dragDx: 0 };
const raycaster = new THREE.Raycaster();
let charm = 0; // 0 = serpent roams on its own, 1 = serpent follows the cursor

addEventListener('pointermove', (e) => {
  pointer.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (pointer.down) pointer.dragDx += e.clientX - pointer.x;
  pointer.x = e.clientX;
  pointer.lastMove = clock.elapsedTime;
});
addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, button')) return;
  pointer.down = true;
  pointer.x = e.clientX;
  if (weights.tree > 0.6) {
    tree.shakeIt();
    ui.burst(e.clientX, e.clientY);
  }
});
addEventListener('pointerup', () => { pointer.down = false; });

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let scrollP = 0, scrollTarget = 0, prevP = 0, velocity = 0, lastNow = 0, scrollV = 0;
let weights = { hero: 1, tree: 0, sculpture: 0, outro: 0 };
const target = new THREE.Vector3();
const idle = new THREE.Vector3();
const look = new THREE.Vector3();
const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3();
const cursorPoint = new THREE.Vector3();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(HERO_FLOOR + 0.3));
const floorHit = new THREE.Vector3();

function readScroll() {
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  scrollTarget = THREE.MathUtils.clamp(scrollY / max, 0, 1);
}
addEventListener('scroll', readScroll, { passive: true });

function idleTarget(t, out) {
  out.set(0, 0, 0);
  // hero: a lazy figure-eight across the lacquer floor
  tmp.set(Math.sin(t * 0.4) * 4.2, HERO_FLOOR + 0.3, Math.sin(t * 0.8) * 1.8 + 0.8);
  out.addScaledVector(tmp, weights.hero);
  // tree: spiral up and down the trunk so the body coils around it
  const h = 1.5 + 5.5 * (0.5 - 0.5 * Math.cos(t * 0.22));
  const r = 1.25 + h * 0.05;
  tmp.set(TREE_ORIGIN.x + Math.cos(t * 1.25) * r, TREE_ORIGIN.y + h, TREE_ORIGIN.z + Math.sin(t * 1.25) * r);
  out.addScaledVector(tmp, weights.tree);
  // sculpture: circle the foot of the plinth on the gallery floor, like a guardian
  const gr = 2.75 + Math.sin(t * 0.37) * 0.3;
  tmp.set(SCULPTURE_ORIGIN.x + Math.cos(t * 0.55) * gr, SCULPTURE_ORIGIN.y - 2.75,
    SCULPTURE_ORIGIN.z + Math.sin(t * 0.55) * gr);
  out.addScaledVector(tmp, weights.sculpture);
  // coda: a vertical ring in front of the camera framing the closing line. Its
  // circumference matches the body, so the head ends up biting its own tail.
  if (weights.outro > 0) {
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    upv.crossVectors(right, fwd);
    const a = t * 0.85;
    tmp.copy(camera.position).addScaledVector(fwd, 9.5)
      .addScaledVector(right, Math.cos(a) * RING_R).addScaledVector(upv, Math.sin(a) * RING_R + 0.25);
    out.addScaledVector(tmp, weights.outro);
  }
  return out;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const t = clock.elapsedTime;
  const now = performance.now();
  // frame time is only a GPU signal in the fallback path, and never when throttled
  if (!timer && lastNow && now - lastNow < 120 && !document.hidden && t > 2.5) sampleCost(now - lastNow);
  lastNow = now;

  scroller.update(dt);
  readScroll();
  simulate(dt, t);
  const timing = t > 2.5 && beginGpuTimer();
  composer.render(dt);
  endGpuTimer(timing);

  ui.update({ t, p: scrollP, weights, coins: tree.coinsGrown(), totalCoins: tree.coinCount, charm });
  requestAnimationFrame(frame);
}

function simulate(dt, t) {
  // critically damped spring: the camera accelerates and settles smoothly
  // rather than lurching off at full speed the moment the page moves
  const W = 6.5;
  scrollV += (W * W * (scrollTarget - scrollP) - 2 * W * scrollV) * dt;
  scrollP += scrollV * dt;
  velocity += ((scrollP - prevP) / Math.max(dt, 1e-3) * 2.5 - velocity) * (1 - Math.exp(-dt * 8));
  prevP = scrollP;
  weights = stationWeights(scrollP);

  const u = pathU(scrollP);
  camPath.getPoint(u, camera.position);
  lookPath.getPoint(u, look);
  // portrait screens see less horizontally: back the camera off to keep subjects whole
  if (camera.aspect < 1) {
    camera.position.sub(look).multiplyScalar(1 + (1 / camera.aspect - 1) * 0.55).add(look);
  }
  // a touch of parallax from the cursor
  camera.position.x += pointer.ndc.x * 0.6;
  camera.position.y += pointer.ndc.y * 0.35;
  // push the subject away from the chapter copy (tree copy is left, sculpture copy right)
  if (innerWidth > 720) {
    const halfW = camera.position.distanceTo(look) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const shift = (-0.34 * weights.tree + 0.34 * weights.sculpture) * halfW;
    tmp.subVectors(look, camera.position).cross(camera.up).normalize();
    look.addScaledVector(tmp, shift);
  }
  camera.lookAt(look);

  // serpent target: blend between the cursor and its own wandering
  const active = t - pointer.lastMove < 2.5 ? 1 : 0;
  charm += (active - charm) * (1 - Math.exp(-dt * 2));
  raycaster.setFromCamera(pointer.ndc, camera);
  const reach = camera.position.distanceTo(look) * 0.72;
  raycaster.ray.at(reach, cursorPoint);
  // in the hero the cursor steers across the floor rather than through the air
  floorPlane.constant = weights.sculpture > 0.5 ? -(SCULPTURE_ORIGIN.y - 2.75) : -(HERO_FLOOR + 0.3);
  if ((weights.hero > 0.5 || weights.sculpture > 0.5) && raycaster.ray.intersectPlane(floorPlane, floorHit) &&
      floorHit.distanceTo(camera.position) < 30) {
    cursorPoint.lerp(floorHit, THREE.MathUtils.smoothstep(weights.hero + weights.sculpture, 0.5, 0.9));
  }
  target.copy(idleTarget(t, idle)).lerp(cursorPoint, charm * (1 - weights.outro * 0.9));
  const grounded = THREE.MathUtils.smoothstep(weights.hero + weights.sculpture, 0.6, 1);
  serpent.update(dt, t, target, camera.position, grounded, 1 - weights.outro);
  serpent.sampleSpine(shadowSamples, shadowSamples.length);
  stage.update(t, weights.hero > 0.01);

  const [t0, t1] = anchors.tree;
  const growth = THREE.MathUtils.clamp((scrollP - (t0 - 0.04)) / ((t1 - t0) * 0.85 + 0.04), 0, 1);
  // only draw the tree while the camera is anywhere near it
  tree.update(dt, t, growth, scrollP > t0 - 0.08 && scrollP < anchors.sculpture[0] + 0.01);
  if (pointer.dragDx && weights.sculpture > 0.5) sculpture.drag(pointer.dragDx);
  pointer.dragDx = 0;
  sculpture.update(dt, t, weights.sculpture > 0.001 || scrollP > anchors.tree[1] - 0.05, 1 - smooth(0.02, 0.35, weights.outro));
  atmosphere.update(t, camera, weights, pixelRatio, growth);

  lens.uniforms.uTime.value = t;
  lens.uniforms.uVel.value = velocity;
}

function resize() {
  // moved to a screen with a different density: rebuild the ladder, keep the step
  if (Math.min(window.devicePixelRatio, 1.75) !== SCALES[0]) {
    SCALES = ladder(window.devicePixelRatio);
    quality.level = Math.min(quality.level, SCALES.length - 1);
    applyPixelRatio(SCALES[quality.level]);
  }
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  stage.resize(pixelRatio);
  lens.uniforms.uRes.value = [innerWidth * pixelRatio, innerHeight * pixelRatio];
  buildRig();
  readScroll();
}
addEventListener('resize', resize);

const ui = initUI();
const scroller = initSmoothScroll();
resize();
scrollP = prevP = scrollTarget;

// compile every program up front so the loader hides real work, not a stutter
tree.update(0, 0, 1, true);
sculpture.update(0, 0, true);
camPath.getPoint(pathU(scrollP), camera.position);
camera.lookAt(lookPath.getPoint(pathU(scrollP)));
weights = stationWeights(scrollP);
serpent.place(idleTarget(0, idle));
// never let shader compilation hold the loader hostage: cap the wait
const compiled = renderer.compileAsync(scene, camera).catch(() => {});
Promise.race([compiled, new Promise((r) => setTimeout(r, 1800))]).then(() => {
  composer.render(0);
  ui.ready();
  clock.start();
  requestAnimationFrame(frame);
});
