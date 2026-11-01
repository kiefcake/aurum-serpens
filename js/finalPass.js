// Lens pass: scroll-velocity barrel warp, chromatic fringing, vignette and grain.
export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVel: { value: 0 },
    uRes: { value: [1, 1] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVel;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float v = clamp(uVel, -1.0, 1.0);
      vec2 uv = 0.5 + c * (1.0 - abs(v) * 0.22 * r2);
      uv.y += v * 0.012 * sin(vUv.x * 3.1416);
      vec2 dir = c * (0.003 + abs(v) * 0.022);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;
      float vig = smoothstep(0.9, 0.25, length(c * vec2(1.0, 0.8)));
      col *= mix(0.3, 1.0, vig);
      float g = hash(vUv * uRes + fract(uTime * 7.0) * 113.0) - 0.5;
      col += g * 0.04 * (0.25 + col);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
