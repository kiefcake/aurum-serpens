import * as THREE from 'three';

// A procedural jewelry-photography studio, prefiltered into a PMREM env map:
// a black room lit by a large overhead softbox, tall warm strip lights and a
// cool rim. Metals get crisp, deliberate highlights instead of a grey blur.

export function createStudioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(24, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide }),
  ));

  const panel = (w, h, hex, intensity, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(9, 6, 0xffffff, 5, [0, 11, 1]);          // overhead softbox
  panel(1.1, 14, 0xffd49a, 9, [-10.5, 1, 3]);    // warm strip, left
  panel(1.1, 14, 0xffe7c8, 7, [10.5, 0, -2]);    // warm strip, right
  panel(14, 1.2, 0x9ec4ff, 2.5, [0, 4, -11]);    // cool rim, back
  panel(5, 2.5, 0xffffff, 3.5, [4, 3, 10.5]);    // small front fill
  panel(24, 2, 0x2a1a0c, 1, [0, -11, 0]);        // faint warm bounce from below

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.015).texture;
  pmrem.dispose();
  return tex;
}

// Shared GLSL for physically based materials patched via onBeforeCompile.
// Bump from an arbitrary procedural height (same math as three's bumpmap chunk).
export const BUMP = /* glsl */ `
vec3 perturbFromHeight(vec3 surfPos, vec3 surfNorm, float h, float strength){
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * strength;
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

// Replace a list of [search, replacement] pairs, failing loudly if a hook moved.
export function patch(src, pairs) {
  for (const [from, to] of pairs) {
    if (!src.includes(from)) throw new Error(`shader hook not found: ${from}`);
    src = src.replace(from, to);
  }
  return src;
}
