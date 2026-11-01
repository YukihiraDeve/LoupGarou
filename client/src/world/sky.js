// Procedural sky dome: gradient, sun disc + glow, moon with halo, twinkling stars, horizon haze.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uMoon;
uniform float uSunDisc;
uniform float uTime;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float stars(vec3 d, float scale, float density) {
  vec3 p = d * scale;
  vec3 c = floor(p);
  vec3 f = fract(p);
  float r = hash13(c);
  if (r < density) return 0.0;
  vec3 o = hash33(c) * 0.7 + 0.15;
  float dist = length(f - o);
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 4.0) + r * 60.0);
  return smoothstep(0.09, 0.0, dist) * tw * (r - density) / (1.0 - density);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
  // warm band along the horizon on the sun side
  float sd = dot(d, uSunDir);
  float side = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0001, uSunDir.z))), 0.0);
  float band = exp(-abs(h) * 9.0) * pow(side, 3.0);
  col = mix(col, uGlow, band * 0.75);
  // glow around the sun
  float g = max(sd, 0.0);
  col += uGlow * (pow(g, 12.0) * 0.55 + pow(g, 90.0) * 0.9);
  // sun disc
  col += uSunColor * smoothstep(0.99935, 0.99965, sd) * uSunDisc * 12.0;
  // ground below the horizon (seen between the trees)
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  // stars
  if (uStars > 0.001 && h > -0.02) {
    float s = stars(d, 180.0, 0.93) + stars(d, 320.0, 0.965) * 0.7;
    col += vec3(0.85, 0.9, 1.0) * s * uStars * smoothstep(-0.02, 0.25, h) * 2.2;
  }
  // moon
  float md = dot(d, uMoonDir);
  if (uMoon > 0.001) {
    float disc = smoothstep(0.99905, 0.99925, md);
    // fake craters: low-frequency noise on the disc
    vec3 local = (d - uMoonDir) * 900.0;
    float n = hash13(floor(local * 0.9)) * 0.12 + hash13(floor(local * 0.35)) * 0.18;
    vec3 moonCol = vec3(1.0, 0.97, 0.9) * (1.05 - n);
    col = mix(col, moonCol * 1.6, disc * uMoon);
    col += vec3(0.55, 0.65, 0.9) * (pow(max(md, 0.0), 400.0) * 0.5 + pow(max(md, 0.0), 30.0) * 0.08) * uMoon;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uSunDir: { value: new THREE.Vector3(0, 0.1, -1) },
      uMoonDir: { value: new THREE.Vector3(0.5, 0.5, 0.5).normalize() },
      uStars: { value: 0 },
      uMoon: { value: 0 },
      uSunDisc: { value: 1 },
      uTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';
  }

  follow(camera) {
    this.mesh.position.copy(camera.position);
  }
}
