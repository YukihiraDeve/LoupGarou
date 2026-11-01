// Campfire: shader flames on camera-facing layers, GPU-animated embers and smoke, ground glow,
// flickering point light. Nothing is allocated per frame.
import * as THREE from 'three';
import { wobble } from '../util/math.js';

const NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const flameVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const flameFragment = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 uv = vUv;
  float t = uTime * 1.0 + uSeed * 10.0;
  float n = fbm(vec2(uv.x * 3.0 + uSeed * 5.0, uv.y * 2.4 - t * 2.0));
  float n2 = fbm(vec2(uv.x * 7.0 - uSeed * 3.0, uv.y * 5.0 - t * 3.4));
  float x = (uv.x - 0.5) + (n - 0.5) * 0.42 * (0.2 + uv.y);
  float width = mix(0.36, 0.02, pow(uv.y, 0.85));
  float body = smoothstep(width, width * 0.15, abs(x));
  float top = 1.0 - smoothstep(0.25, 0.95, uv.y + (n2 - 0.5) * 0.5);
  float f = body * top * smoothstep(0.0, 0.06, uv.y);
  f = clamp(f * (0.7 + n2 * 0.75), 0.0, 1.0);
  vec3 col = mix(vec3(0.75, 0.1, 0.01), vec3(1.0, 0.45, 0.05), smoothstep(0.05, 0.45, f));
  col = mix(col, vec3(1.0, 0.85, 0.45), smoothstep(0.5, 0.9, f));
  col = mix(col, vec3(1.0, 0.97, 0.85), smoothstep(0.88, 1.0, f));
  gl_FragColor = vec4(col * uIntensity * (0.6 + f * 1.8), f);
}`;

const emberVertex = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uSize;
uniform float uHeight;
uniform float uPixelRatio;
varying float vLife;
varying float vSeed;
void main() {
  float life = fract(uTime * (0.18 + aSeed.y * 0.3) + aSeed.x);
  float ang = aSeed.z * 6.2831 + life * 2.5 * (aSeed.w - 0.5);
  float r = 0.08 + aSeed.w * 0.3 + life * 0.5 * aSeed.w;
  vec3 p = vec3(cos(ang) * r, 0.2 + life * uHeight * (0.55 + aSeed.y), sin(ang) * r);
  p.x += sin(uTime * 2.3 + aSeed.x * 31.0) * 0.18 * life;
  p.z += cos(uTime * 1.9 + aSeed.z * 17.0) * 0.18 * life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixelRatio * (1.0 - life * 0.7) * (0.6 + aSeed.w * 0.8) / max(-mv.z, 0.3);
  vLife = life;
  vSeed = aSeed.w;
}`;

const emberFragment = /* glsl */ `
uniform float uIntensity;
varying float vLife;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.25, 0.02), vLife);
  float fade = (1.0 - vLife) * smoothstep(0.0, 0.05, vLife) * (0.6 + 0.4 * sin(vLife * 40.0 + vSeed * 20.0));
  gl_FragColor = vec4(col * uIntensity * 2.0, a * fade);
}`;

const smokeVertex = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
varying float vLife;
void main() {
  float life = fract(uTime * (0.05 + aSeed.y * 0.04) + aSeed.x);
  vec3 p = vec3((aSeed.z - 0.5) * 0.4, 0.9 + life * 5.5, (aSeed.w - 0.5) * 0.4);
  p.x += life * life * 1.6 + sin(uTime * 0.5 + aSeed.x * 9.0) * 0.3 * life;
  p.z += life * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixelRatio * (0.35 + life * 1.6) / max(-mv.z, 0.3);
  vLife = life;
}`;

const smokeFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFireColor;
uniform float uOpacity;
varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c));
  float fade = smoothstep(0.0, 0.15, vLife) * (1.0 - vLife);
  vec3 col = mix(uFireColor, uColor, smoothstep(0.0, 0.35, vLife));
  gl_FragColor = vec4(col, a * fade * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function seeds(count, rand = Math.random) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seed[i] = rand();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 8);
  return g;
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Campfire {
  constructor(quality) {
    this.group = new THREE.Group();
    this.group.name = 'campfire';
    this.quality = quality;
    this.time = 0;
    this.strength = 1; // 0..1, overall size (embers dying out at game over, ...)

    // flames: a camera-facing pivot with a few layers
    this.billboard = new THREE.Group();
    this.group.add(this.billboard);
    this.flames = [];
    const layers = [
      { w: 1.25, h: 1.55, x: 0, z: 0, seed: 0.1, i: 1.0 },
      { w: 0.8, h: 1.1, x: -0.28, z: 0.06, seed: 0.47, i: 0.85 },
      { w: 0.75, h: 1.0, x: 0.3, z: 0.04, seed: 0.83, i: 0.85 },
      { w: 0.55, h: 0.75, x: 0.05, z: 0.12, seed: 0.31, i: 1.1 },
    ];
    for (const l of layers) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: l.seed }, uIntensity: { value: l.i } },
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const geo = new THREE.PlaneGeometry(l.w, l.h).translate(0, l.h / 2, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(l.x, 0.08, l.z);
      mesh.renderOrder = 5;
      this.billboard.add(mesh);
      this.flames.push({ mesh, mat, base: l.i, h: l.h });
    }

    // glow halo and warm ground disc
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture('rgba(255,150,60,0.55)', 'rgba(255,90,20,0)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }));
    this.halo.scale.set(3.4, 3.4, 1);
    this.halo.position.y = 0.75;
    this.halo.renderOrder = 4;
    this.group.add(this.halo);
    const groundGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(255,120,40,0.45)', 'rgba(255,80,20,0)'),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
      }),
    );
    groundGlow.position.y = 0.03;
    groundGlow.renderOrder = 3;
    this.groundGlow = groundGlow;
    this.group.add(groundGlow);

    // embers
    const MAX_EMBERS = 300;
    this.embers = new THREE.Points(
      seeds(MAX_EMBERS),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uSize: { value: 26 }, uHeight: { value: 3.2 },
          uPixelRatio: { value: 1 }, uIntensity: { value: 1 },
        },
        vertexShader: emberVertex,
        fragmentShader: emberFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.embers.renderOrder = 6;
    this.group.add(this.embers);

    // smoke
    const MAX_SMOKE = 24;
    this.smoke = new THREE.Points(
      seeds(MAX_SMOKE),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uSize: { value: 260 }, uPixelRatio: { value: 1 },
          uColor: { value: new THREE.Color(0.5, 0.5, 0.52) },
          uFireColor: { value: new THREE.Color(1.0, 0.55, 0.25) },
          uOpacity: { value: 0.18 },
        },
        vertexShader: smokeVertex,
        fragmentShader: smokeFragment,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.smoke.renderOrder = 2;
    this.group.add(this.smoke);

    // light
    this.light = new THREE.PointLight(0xff8a3c, 18, 22, 2);
    this.light.position.set(0, 0.9, 0);
    this.light.castShadow = false;
    this.group.add(this.light);
    this.lightBase = 18;
    this.applyQuality(quality.tier);
  }

  applyQuality(tier) {
    this.embers.geometry.setDrawRange(0, tier.embers);
    this.smoke.geometry.setDrawRange(0, tier.smoke);
    this.flames.forEach((f, i) => { f.mesh.visible = i < tier.maxFlameLayers; });
  }

  setPixelRatio(pr) {
    this.embers.material.uniforms.uPixelRatio.value = pr;
    this.smoke.material.uniforms.uPixelRatio.value = pr;
  }

  /** @param env Environment (night factor, hemisphere colour for the smoke) */
  update(dt, camera, env) {
    this.time += dt;
    const t = this.time;
    // face the camera (cylindrical billboard)
    const dx = camera.position.x - this.group.position.x;
    const dz = camera.position.z - this.group.position.z;
    this.billboard.rotation.y = Math.atan2(dx, dz);
    const s = this.strength;
    for (const f of this.flames) {
      f.mat.uniforms.uTime.value = t;
      f.mat.uniforms.uIntensity.value = f.base * s * (0.9 + 0.1 * Math.sin(t * 7 + f.base * 9));
      f.mesh.scale.set(1, (0.92 + 0.08 * wobble(t * 3, f.base * 4)) * (0.3 + 0.7 * s), 1);
    }
    this.embers.material.uniforms.uTime.value = t;
    this.embers.material.uniforms.uIntensity.value = s;
    this.smoke.material.uniforms.uTime.value = t;
    const night = env ? env.night : 1;
    this.smoke.material.uniforms.uColor.value.copy(env ? env.fog.color : this.smoke.material.uniforms.uColor.value)
      .multiplyScalar(0.9 + 0.3 * (1 - night));
    this.smoke.material.uniforms.uOpacity.value = 0.14 + 0.1 * (1 - night);
    const flicker = 0.82 + 0.1 * wobble(t * 6.0, 1) + 0.08 * wobble(t * 13.0, 2);
    this.light.intensity = this.lightBase * flicker * s * (0.35 + 0.65 * night);
    this.light.position.x = 0.06 * wobble(t * 3.1, 3);
    this.light.position.z = 0.06 * wobble(t * 2.7, 4);
    this.halo.material.opacity = (0.35 + 0.65 * night) * s * (0.9 + 0.1 * flicker);
    this.groundGlow.material.opacity = (0.15 + 0.45 * night) * s * flicker;
  }
}

// Fireflies: night-only, GPU animated around the camp.
const flyVertex = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPixelRatio;
uniform float uInner;
uniform float uOuter;
varying float vBlink;
void main() {
  float ang = aSeed.x * 6.2831 + uTime * 0.03 * (aSeed.y - 0.5);
  float r = mix(uInner, uOuter, aSeed.z);
  vec3 p = vec3(cos(ang) * r, 0.4 + aSeed.w * 2.4, sin(ang) * r);
  p.x += sin(uTime * (0.3 + aSeed.y * 0.4) + aSeed.z * 20.0) * 0.8;
  p.y += sin(uTime * (0.5 + aSeed.x * 0.5) + aSeed.w * 13.0) * 0.35;
  p.z += cos(uTime * (0.35 + aSeed.w * 0.3) + aSeed.x * 7.0) * 0.8;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 9.0 * uPixelRatio / max(-mv.z, 0.5) * 6.0;
  vBlink = pow(max(sin(uTime * (0.8 + aSeed.y) + aSeed.x * 40.0), 0.0), 6.0);
}`;
const flyFragment = /* glsl */ `
uniform float uOpacity;
varying float vBlink;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a;
  gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * 2.0, a * vBlink * uOpacity);
}`;

export class Fireflies {
  constructor(quality) {
    const geo = seeds(120);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 20);
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uPixelRatio: { value: 1 }, uOpacity: { value: 0 },
        uInner: { value: 5 }, uOuter: { value: 16 },
      },
      vertexShader: flyVertex,
      fragmentShader: flyFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }));
    this.points.renderOrder = 7;
    this.applyQuality(quality.tier);
  }
  applyQuality(tier) { this.points.geometry.setDrawRange(0, tier.fireflies); }
  update(dt, env, pr) {
    const u = this.points.material.uniforms;
    u.uTime.value += dt;
    u.uPixelRatio.value = pr;
    u.uOpacity.value = env.night;
    this.points.visible = env.night > 0.02;
  }
}
