import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Serpent } from './serpent.js';
import { MoneyTree } from './moneyTree.js';
import { Sculpture } from './sculpture.js';
import { Atmosphere } from './atmosphere.js';
import { FinalShader } from './finalPass.js';
import { initUI } from './ui.js';

const TREE_ORIGIN = new THREE.Vector3(0, -44, 0);
const SCULPTURE_ORIGIN = new THREE.Vector3(0, -86, 0);

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 1200);
camera.position.set(0, 0, 14);

const atmosphere = new Atmosphere(scene);
const tree = new MoneyTree(scene, TREE_ORIGIN);
const sculpture = new Sculpture(scene, SCULPTURE_ORIGIN);
const serpent = new Serpent(scene);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.6, 0.92);
composer.addPass(bloom);
const lens = new ShaderPass(FinalShader);
composer.addPass(lens);
composer.addPass(new OutputPass());

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
  const keys = [[0, [0, 0, 14], [0, 0, 0]]];
  const [t0, t1] = anchors.tree;
  for (let i = 0; i <= 4; i++) {
    const a = -0.35 + (i / 4) * 2.2;
    const r = 22 - i * 1.8;
    keys.push([t0 + (t1 - t0) * (i / 4),
      [T.x + Math.sin(a) * r, T.y + 6 + i * 1.2, T.z + Math.cos(a) * r],
      [T.x, T.y + 6.5 + i * 0.4, T.z]]);
  }
  const [s0, s1] = anchors.sculpture;
  keys.push([s0, [S.x - 1.5, S.y + 1.0, S.z + 10.5], [S.x, S.y - 0.9, S.z]]);
  keys.push([s0 + (s1 - s0) * 0.5, [S.x + 3.0, S.y + 0.4, S.z + 7.5], [S.x, S.y - 0.7, S.z]]);
  keys.push([s1, [S.x + 0.8, S.y + 2.2, S.z + 6.4], [S.x, S.y - 0.6, S.z]]);
  keys.push([1, [S.x, S.y + 20, S.z + 34], [S.x, S.y + 8, S.z]]);

  keyP = keys.map((k) => k[0]);
  camPath = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[1])), false, 'centripetal');
  lookPath = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k[2])), false, 'centripetal');
}

function pathU(p) {
  let i = 0;
  while (i < keyP.length - 2 && p > keyP[i + 1]) i++;
  const t = THREE.MathUtils.clamp((p - keyP[i]) / Math.max(keyP[i + 1] - keyP[i], 1e-5), 0, 1);
  const eased = t * t * (3 - 2 * t);
  return (i + eased) / (keyP.length - 1);
}

const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
function stationWeights(p) {
  const [t0, t1] = anchors.tree, [s0] = anchors.sculpture;
  const treeW = smooth(t0 - 0.06, t0, p) * (1 - smooth(t1, s0, p));
  const sculptW = smooth(t1, s0, p);
  return { hero: Math.max(0, 1 - treeW - sculptW), tree: treeW, sculpture: sculptW };
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
let scrollP = 0, scrollTarget = 0, prevP = 0, velocity = 0;
let weights = { hero: 1, tree: 0, sculpture: 0 };
const target = new THREE.Vector3();
const idle = new THREE.Vector3();
const look = new THREE.Vector3();
const tmp = new THREE.Vector3();

function readScroll() {
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  scrollTarget = THREE.MathUtils.clamp(scrollY / max, 0, 1);
}
addEventListener('scroll', readScroll, { passive: true });

function idleTarget(t, out) {
  out.set(0, 0, 0);
  // hero: lazy figure-eight in front of the camera
  tmp.set(Math.sin(t * 0.45) * 4.2, Math.sin(t * 0.9) * 1.6 - 0.3, Math.cos(t * 0.45) * 1.5);
  out.addScaledVector(tmp, weights.hero);
  // tree: spiral up and down the trunk so the body coils around it
  const h = 1.5 + 5.5 * (0.5 - 0.5 * Math.cos(t * 0.22));
  const r = 1.25 + h * 0.05;
  tmp.set(TREE_ORIGIN.x + Math.cos(t * 1.25) * r, TREE_ORIGIN.y + h, TREE_ORIGIN.z + Math.sin(t * 1.25) * r);
  out.addScaledVector(tmp, weights.tree);
  // sculpture: circle the plinth like a guardian
  tmp.set(SCULPTURE_ORIGIN.x + Math.cos(t * 0.6) * 2.4, SCULPTURE_ORIGIN.y - 0.4 + Math.sin(t * 1.1) * 0.5,
    SCULPTURE_ORIGIN.z + Math.sin(t * 0.6) * 2.4);
  out.addScaledVector(tmp, weights.sculpture);
  return out;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const t = clock.elapsedTime;

  scrollP += (scrollTarget - scrollP) * (1 - Math.exp(-dt * 4.5));
  velocity += ((scrollP - prevP) / Math.max(dt, 1e-3) * 2.5 - velocity) * (1 - Math.exp(-dt * 8));
  prevP = scrollP;
  weights = stationWeights(scrollP);

  const u = pathU(scrollP);
  camPath.getPoint(u, camera.position);
  lookPath.getPoint(u, look);
  // a touch of parallax from the cursor
  camera.position.x += pointer.ndc.x * 0.6;
  camera.position.y += pointer.ndc.y * 0.35;
  // push the subject away from the chapter copy (tree copy is left, sculpture copy right)
  if (innerWidth > 720) {
    const shift = (-0.16 * weights.tree + 0.2 * weights.sculpture) * camera.position.distanceTo(look);
    tmp.subVectors(look, camera.position).cross(camera.up).normalize();
    look.addScaledVector(tmp, shift);
  }
  camera.lookAt(look);

  // serpent target: blend between the cursor and its own wandering
  const active = t - pointer.lastMove < 2.5 ? 1 : 0;
  charm += (active - charm) * (1 - Math.exp(-dt * 2));
  raycaster.setFromCamera(pointer.ndc, camera);
  const reach = camera.position.distanceTo(look) * 0.72;
  const cursorPoint = raycaster.ray.at(reach, tmp.clone());
  target.copy(idleTarget(t, idle)).lerp(cursorPoint, charm);
  serpent.update(dt, t, target, camera.position);

  const [t0, t1] = anchors.tree;
  const growth = THREE.MathUtils.clamp((scrollP - (t0 - 0.04)) / ((t1 - t0) * 0.85 + 0.04), 0, 1);
  tree.update(dt, t, growth, weights.hero < 0.999 || scrollP > 0.02);
  if (pointer.dragDx && weights.sculpture > 0.5) sculpture.drag(pointer.dragDx);
  pointer.dragDx = 0;
  sculpture.update(dt, t, weights.sculpture > 0.001 || scrollP > anchors.tree[1] - 0.05);
  atmosphere.update(t, camera, weights, pixelRatio);

  lens.uniforms.uTime.value = t;
  lens.uniforms.uVel.value = velocity;
  composer.render(dt);

  ui.update({ t, p: scrollP, weights, coins: tree.coinsGrown(), totalCoins: tree.coinCount, charm });
  requestAnimationFrame(frame);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  lens.uniforms.uRes.value = [innerWidth * pixelRatio, innerHeight * pixelRatio];
  buildRig();
  readScroll();
}
addEventListener('resize', resize);

const ui = initUI();
window.__aurum = { camera, sculpture, tree, serpent, get p() { return scrollP; }, get anchors() { return anchors; } };
resize();
scrollP = prevP = scrollTarget;

// compile every program up front so the loader hides real work, not a stutter
tree.update(0, 0, 1, true);
sculpture.update(0, 0, true);
camPath.getPoint(pathU(scrollP), camera.position);
camera.lookAt(lookPath.getPoint(pathU(scrollP)));
renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
  composer.render(0);
  ui.ready();
  clock.start();
  requestAnimationFrame(frame);
});
