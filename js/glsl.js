// Shared GLSL chunks. Everything here is injected verbatim into ShaderMaterials.

export const NOISE = /* glsl */ `
float hash31(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
vec3 hash33(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
                 mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                 mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){
    s += a * vnoise(p);
    p = p * 2.02 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
// distance to the nearest Voronoi cell border (F2 - F1), used for kintsugi cracks
float voronoiEdge(vec3 x){
  vec3 i = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int l = -1; l <= 1; l++){
    vec3 g = vec3(float(l), float(j), float(k));
    vec3 r = g + hash33(i + g) - f;
    float d = dot(r, r);
    if (d < f1){ f2 = f1; f1 = d; } else if (d < f2){ f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}
`;

// A fake HDR "studio" environment so metals read as metal without cube maps.
export const ENV = /* glsl */ `
vec3 studioEnv(vec3 r){
  float up = r.y * 0.5 + 0.5;
  vec3 c = mix(vec3(0.012, 0.01, 0.008), vec3(0.35, 0.22, 0.1), pow(up, 2.5));
  c += vec3(1.6, 1.25, 0.85) * smoothstep(0.78, 0.97, r.y);
  c += vec3(2.6, 2.2, 1.7) * smoothstep(0.93, 0.995, dot(r, normalize(vec3(0.7, 0.35, 0.6))));
  c += vec3(0.5, 0.9, 0.75) * 1.2 * smoothstep(0.9, 0.99, dot(r, normalize(vec3(-0.85, 0.1, 0.3))));
  c += vec3(0.6, 0.35, 0.12) * smoothstep(0.2, -0.6, r.y) * 0.25;
  return c;
}
`;

export const GOLD = 'vec3(1.0, 0.64, 0.24)';

// Wind sway shared by the tree bark and the coins hanging from it, so they move together.
export const SWAY = /* glsl */ `
uniform float uShake;
vec3 swayOffset(vec3 p, float t){
  float h = max(p.y, 0.0);
  float amp = 0.0022 * h * h * (1.0 + uShake * 4.0);
  return vec3(sin(t * 0.7 + p.y * 0.25 + uShake * sin(t * 13.0) * 2.0),
              0.0,
              cos(t * 0.53 + p.y * 0.21)) * amp;
}
`;
