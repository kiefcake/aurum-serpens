import * as THREE from 'three';
import { NOISE } from './glsl.js';

// A colossal square-holed coin hanging behind the money tree like a harvest
// moon. It's a camera-facing card drawn entirely in the shader: a cratered
// metal disc with a raised rim and inner frame, lit from one side, wrapped in
// haze. It rises as the tree grows.

const fragment = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 q = (vUv - 0.5) * 2.0;           // -1..1, disc radius 0.78
  float r = length(q) / 0.78;
  float sq = max(abs(q.x), abs(q.y)) / 0.78;

  float disc = 1.0 - smoothstep(0.995, 1.005, r);
  float hole = smoothstep(0.205, 0.195, sq);
  float rim = smoothstep(0.86, 0.88, r) * (1.0 - smoothstep(0.97, 0.99, r));
  float frame = smoothstep(0.2, 0.21, sq) * (1.0 - smoothstep(0.27, 0.28, sq));

  // worn, pitted surface; lit from the upper left with a crescent of shadow
  float pits = fbm(vec3(q * 5.0, 2.0));
  float wear = fbm(vec3(q * 18.0, 7.0));
  vec3 nrm = normalize(vec3(q * 0.9, 1.0));
  float light = clamp(dot(nrm, normalize(vec3(-0.55, 0.55, 0.6))), 0.0, 1.0);
  float body = (0.45 + 0.55 * pits) * (0.75 + 0.25 * wear);
  float relief = max(rim, frame);

  vec3 gold = vec3(0.95, 0.6, 0.24);
  vec3 col = gold * body * (0.25 + 0.95 * light) * (1.0 + relief * 0.9);
  col *= disc * (1.0 - hole);

  // halo and a little drifting haze in front
  // the card's edge sits at r = 1.28: the halo must be gone well before it
  float halo = exp(-max(r - 1.0, 0.0) * 6.0) * (1.0 - disc) * 0.2 * smoothstep(1.25, 1.05, r);
  float haze = fbm(vec3(q * 1.6 + vec2(uTime * 0.015, 0.0), uTime * 0.02));
  col += gold * halo;
  col *= 0.75 + 0.5 * haze;

  gl_FragColor = vec4(col * 0.32 * uOpacity * smoothstep(1.27, 1.2, r), 1.0);
}
`;

export class CoinMoon {
  constructor(scene, anchor) {
    this.anchor = anchor.clone();
    this.uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 } };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: fragment,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.scale.setScalar(46);
    this.mesh.renderOrder = -0.5;
    scene.add(this.mesh);
  }

  update(time, camera, weight, growth) {
    this.mesh.visible = weight > 0.001;
    this.uniforms.uTime.value = time;
    this.uniforms.uOpacity.value = weight * (0.35 + 0.65 * growth);
    // always directly behind the tree from wherever the camera orbits, like a
    // body at infinity, and rising out of the horizon as the tree grows
    const away = this.anchor.clone().sub(camera.position).setY(0).normalize();
    this.mesh.position.copy(this.anchor).addScaledVector(away, 46).add(new THREE.Vector3(0, -6 + growth * 12, 0));
    this.mesh.quaternion.copy(camera.quaternion);
  }
}
