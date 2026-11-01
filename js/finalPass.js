// Final pass: scroll-velocity barrel warp, chromatic fringing, bloom composite,
// vignette, then tone mapping and sRGB output (replacing three's OutputPass, so
// the frame takes one full-resolution pass here instead of three), and grain
// added last, in display space, where it reads as film rather than noise.
export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uBloom: { value: 0.06 },
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
    uniform sampler2D tBloom;
    uniform float uBloom;
    uniform float uTime;
    uniform float uVel;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float v = clamp(uVel, -1.0, 1.0);
      vec2 uv = 0.5 + c * (1.0 - abs(v) * 0.12 * r2);
      uv.y += v * 0.012 * sin(vUv.x * 3.1416);
      vec2 dir = c * (0.0006 + abs(v) * 0.0015);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;
      col += texture2D(tBloom, uv).rgb * uBloom;
      float vig = smoothstep(0.9, 0.25, length(c * vec2(1.0, 0.8)));
      col *= mix(0.5, 1.0, vig);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      float g = hash(vUv * uRes + fract(uTime * 7.0) * 113.0) - 0.5;
      gl_FragColor.rgb += g * (0.012 + 0.02 * gl_FragColor.rgb);
    }
  `,
};
