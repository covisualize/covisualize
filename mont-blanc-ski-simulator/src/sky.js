import * as THREE from 'three';

/**
 * Time-of-day sky dome, sun, procedural drifting alpine clouds,
 * and continuous lighting palette from crisp alpine morning to vivid pink sunset.
 *
 * timeOfDay in [0, 1]:
 *   0.00 = Early Dawn (soft peach/indigo)
 *   0.20 = Crisp Morning (low golden-white sun, bright cobalt sky)
 *   0.48 = Alpine Midday (high brilliant white sun, deep azure zenith)
 *   0.74 = Golden Hour (warm amber sun, long blue shadows)
 *   0.88 = Pink Sunset / Alpenglow (iconic rose-pink/coral Mont Blanc sunset)
 *   1.00 = Alpine Dusk (deep magenta-violet horizon, twilight indigo, subtle stars)
 */

const KEYFRAMES = [
  {
    t: 0.0,
    elevation: 5,
    azimuth: 62,
    zenith: [0.10, 0.16, 0.34],
    horizon: [0.92, 0.62, 0.56],
    sunColor: [1.0, 0.72, 0.52],
    sunIntensity: 1.15,
    shadowTint: [0.28, 0.38, 0.62],
    fogColor: [0.76, 0.64, 0.70],
    cloudLight: [1.0, 0.76, 0.68],
    cloudShadow: [0.34, 0.36, 0.54],
    alpenglow: 0.55,
    starStrength: 0.25,
  },
  {
    t: 0.22,
    elevation: 24,
    azimuth: 98,
    zenith: [0.13, 0.36, 0.72],
    horizon: [0.76, 0.87, 0.96],
    sunColor: [1.0, 0.95, 0.86],
    sunIntensity: 1.55,
    shadowTint: [0.34, 0.50, 0.78],
    fogColor: [0.74, 0.84, 0.94],
    cloudLight: [1.0, 0.98, 0.95],
    cloudShadow: [0.56, 0.66, 0.80],
    alpenglow: 0.08,
    starStrength: 0.0,
  },
  {
    t: 0.48,
    elevation: 52,
    azimuth: 158,
    zenith: [0.09, 0.32, 0.74],
    horizon: [0.68, 0.84, 0.97],
    sunColor: [1.0, 0.98, 0.94],
    sunIntensity: 1.75,
    shadowTint: [0.32, 0.50, 0.80],
    fogColor: [0.72, 0.84, 0.96],
    cloudLight: [1.0, 1.0, 1.0],
    cloudShadow: [0.58, 0.68, 0.82],
    alpenglow: 0.0,
    starStrength: 0.0,
  },
  {
    t: 0.74,
    elevation: 18,
    azimuth: 232,
    zenith: [0.15, 0.31, 0.62],
    horizon: [0.98, 0.76, 0.58],
    sunColor: [1.0, 0.80, 0.55],
    sunIntensity: 1.5,
    shadowTint: [0.32, 0.42, 0.70],
    fogColor: [0.88, 0.74, 0.68],
    cloudLight: [1.0, 0.86, 0.68],
    cloudShadow: [0.46, 0.48, 0.66],
    alpenglow: 0.45,
    starStrength: 0.0,
  },
  {
    t: 0.88,
    elevation: 6.5,
    azimuth: 258,
    zenith: [0.16, 0.14, 0.38],
    horizon: [1.0, 0.52, 0.60],
    sunColor: [1.0, 0.56, 0.62],
    sunIntensity: 1.32,
    shadowTint: [0.32, 0.34, 0.64],
    fogColor: [0.88, 0.58, 0.68],
    cloudLight: [1.0, 0.62, 0.70],
    cloudShadow: [0.36, 0.30, 0.52],
    alpenglow: 1.0,
    starStrength: 0.22,
  },
  {
    t: 1.0,
    elevation: 1.0,
    azimuth: 274,
    zenith: [0.06, 0.07, 0.20],
    horizon: [0.68, 0.34, 0.52],
    sunColor: [0.92, 0.42, 0.58],
    sunIntensity: 0.82,
    shadowTint: [0.20, 0.24, 0.48],
    fogColor: [0.44, 0.30, 0.48],
    cloudLight: [0.84, 0.44, 0.62],
    cloudShadow: [0.20, 0.18, 0.36],
    alpenglow: 0.85,
    starStrength: 0.75,
  },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor3(target, a, b, t) {
  target.setRGB(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}

export class AlpineSky {
  constructor(scene) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(0.4, 0.6, -0.5).normalize();
    this.sunColor = new THREE.Color(1, 0.96, 0.9);
    this.shadowTint = new THREE.Color(0.32, 0.5, 0.8);
    this.fogColor = new THREE.Color(0.74, 0.84, 0.95);
    this.zenithColor = new THREE.Color(0.1, 0.34, 0.74);
    this.horizonColor = new THREE.Color(0.75, 0.86, 0.96);
    this.cloudLightColor = new THREE.Color(1, 0.98, 0.95);
    this.cloudShadowColor = new THREE.Color(0.55, 0.65, 0.8);
    this.sunIntensity = 1.6;
    this.alpenglow = 0.0;
    this.time = 0;

    // Directional sun light with real-time shadow frustum centered on skier
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 380;
    const d = 85;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.06;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xaad4ff, 0x4b6a9c, 0.72);
    scene.add(this.hemiLight);

    // Custom GLSL atmospheric sky + procedural volumetric-feel clouds
    this.uniforms = {
      uSunDir: { value: this.sunDir.clone() },
      uZenithColor: { value: this.zenithColor.clone() },
      uHorizonColor: { value: this.horizonColor.clone() },
      uFogColor: { value: this.fogColor.clone() },
      uSunColor: { value: this.sunColor.clone() },
      uCloudLight: { value: this.cloudLightColor.clone() },
      uCloudShadow: { value: this.cloudShadowColor.clone() },
      uAlpenglow: { value: 0.0 },
      uStarStrength: { value: 0.0 },
      uTime: { value: 0.0 },
    };

    const skyGeo = new THREE.SphereGeometry(14000, 40, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uZenithColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uFogColor;
        uniform vec3 uSunColor;
        uniform vec3 uCloudLight;
        uniform vec3 uCloudShadow;
        uniform float uAlpenglow;
        uniform float uStarStrength;
        uniform float uTime;

        varying vec3 vDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
          for (int i = 0; i < 5; i++) {
            v += amp * noise(p);
            p = rot * p * 2.03 + vec2(13.1, 7.7);
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float elev = clamp(dir.y, -0.25, 1.0);

          // Rayleigh vertical sky gradient
          float hCurve = pow(1.0 - max(elev, 0.0), 2.6);
          vec3 sky = mix(uZenithColor, uHorizonColor, hCurve);

          // Pink sunset / alpenglow band near horizon
          float band = exp(-abs(elev - 0.05) * 10.5) * uAlpenglow;
          sky += vec3(0.42, 0.12, 0.24) * band;

          // Seamless lower-horizon valley mist blend matching terrain fogColor
          float mistBlend = smoothstep(0.04, -0.05, elev);
          sky = mix(sky, uFogColor, mistBlend);

          // Sun disc + Mie scattering glow
          float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
          float mieHalo = pow(sunDot, 7.0) * 0.42 + pow(sunDot, 48.0) * 0.55;
          float sunDisc = smoothstep(0.9991, 0.99965, sunDot);
          sky += uSunColor * mieHalo * (0.65 + 0.55 * uAlpenglow);
          sky = mix(sky, vec3(1.0, 0.98, 0.92) * 1.4, sunDisc);

          // Procedural layered Alpine cloud deck
          if (dir.y > 0.015) {
            vec2 cloudUV = dir.xz / (dir.y + 0.14) * 1.45;
            vec2 drift = vec2(uTime * 0.008, -uTime * 0.004);
            float n1 = fbm(cloudUV + drift);
            float n2 = fbm(cloudUV * 2.1 - drift * 1.4 + vec2(4.2, -3.1));
            float density = smoothstep(0.47, 0.78, n1 * 0.72 + n2 * 0.32);

            // Fade clouds smoothly near horizon to blend into alpine haze
            float horizonFade = smoothstep(0.015, 0.18, dir.y);
            density *= horizonFade * 0.85;

            // Directional cloud shading (lit underside/silver lining near sun)
            vec2 sunStep = normalize(uSunDir.xz + vec2(0.0001)) * 0.12;
            float nLit = fbm(cloudUV + drift + sunStep);
            float lightMix = clamp(0.55 + (n1 - nLit) * 2.2 + pow(sunDot, 5.0) * 0.65, 0.0, 1.0);
            vec3 cloudCol = mix(uCloudShadow, uCloudLight, lightMix);
            // Warm silver-pink rim near the sun
            cloudCol += uSunColor * pow(sunDot, 12.0) * 0.45 * (1.0 - density * 0.4);

            sky = mix(sky, cloudCol, density);
          }

          // Subtle Alpine twilight stars at dusk/pink sunset zenith
          if (uStarStrength > 0.01 && dir.y > 0.15) {
            vec2 starCell = floor(dir.xz / (dir.y + 0.35) * 190.0);
            float s = hash21(starCell);
            if (s > 0.9965) {
              float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + s * 200.0);
              sky += vec3(0.95, 0.97, 1.0) * uStarStrength * smoothstep(0.15, 0.55, dir.y) * twinkle;
            }
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(skyGeo, skyMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    this.setTimeOfDay(0.68);
  }

  setTimeOfDay(t) {
    this.timeOfDay = THREE.MathUtils.clamp(t, 0, 1);

    let k0 = KEYFRAMES[0];
    let k1 = KEYFRAMES[KEYFRAMES.length - 1];
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (this.timeOfDay >= KEYFRAMES[i].t && this.timeOfDay <= KEYFRAMES[i + 1].t) {
        k0 = KEYFRAMES[i];
        k1 = KEYFRAMES[i + 1];
        break;
      }
    }
    const span = Math.max(1e-5, k1.t - k0.t);
    const f = THREE.MathUtils.smoothstep((this.timeOfDay - k0.t) / span, 0, 1);

    const elevDeg = lerp(k0.elevation, k1.elevation, f);
    const azimDeg = lerp(k0.azimuth, k1.azimuth, f);
    const elevRad = THREE.MathUtils.degToRad(elevDeg);
    const azimRad = THREE.MathUtils.degToRad(azimDeg);

    this.sunDir.set(
      Math.cos(elevRad) * Math.sin(azimRad),
      Math.sin(elevRad),
      Math.cos(elevRad) * Math.cos(azimRad)
    ).normalize();

    lerpColor3(this.zenithColor, k0.zenith, k1.zenith, f);
    lerpColor3(this.horizonColor, k0.horizon, k1.horizon, f);
    lerpColor3(this.sunColor, k0.sunColor, k1.sunColor, f);
    lerpColor3(this.shadowTint, k0.shadowTint, k1.shadowTint, f);
    lerpColor3(this.fogColor, k0.fogColor, k1.fogColor, f);
    lerpColor3(this.cloudLightColor, k0.cloudLight, k1.cloudLight, f);
    lerpColor3(this.cloudShadowColor, k0.cloudShadow, k1.cloudShadow, f);

    this.sunIntensity = lerp(k0.sunIntensity, k1.sunIntensity, f);
    this.alpenglow = lerp(k0.alpenglow, k1.alpenglow, f);
    const starStrength = lerp(k0.starStrength, k1.starStrength, f);

    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = this.sunIntensity;
    this.hemiLight.color.copy(this.horizonColor).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemiLight.groundColor.copy(this.shadowTint);
    this.hemiLight.intensity = 0.58 + 0.24 * Math.max(0, this.sunDir.y);

    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uZenithColor.value.copy(this.zenithColor);
    this.uniforms.uHorizonColor.value.copy(this.horizonColor);
    this.uniforms.uFogColor.value.copy(this.fogColor);
    this.uniforms.uSunColor.value.copy(this.sunColor);
    this.uniforms.uCloudLight.value.copy(this.cloudLightColor);
    this.uniforms.uCloudShadow.value.copy(this.cloudShadowColor);
    this.uniforms.uAlpenglow.value = this.alpenglow;
    this.uniforms.uStarStrength.value = starStrength;
  }

  getTimeLabel() {
    const t = this.timeOfDay;
    if (t < 0.12) return 'Dawn';
    if (t < 0.36) return 'Morning';
    if (t < 0.62) return 'Midday';
    if (t < 0.80) return 'Golden Hour';
    if (t < 0.94) return 'Pink Sunset';
    return 'Alpine Dusk';
  }

  update(dt, focusPos) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    // Keep sky dome centered on camera/skier
    this.mesh.position.copy(focusPos);

    // Keep directional sun shadow camera tightly centered on the skier
    // Snap to shadow texel increments to completely eliminate shadow swimming!
    const shadowSpan = 170;
    const texel = shadowSpan / 2048;
    const sx = Math.round(focusPos.x / texel) * texel;
    const sy = Math.round(focusPos.y / texel) * texel;
    const sz = Math.round(focusPos.z / texel) * texel;

    this.sunLight.target.position.set(sx, sy, sz);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.position.set(
      sx + this.sunDir.x * 180,
      sy + Math.max(this.sunDir.y, 0.18) * 180,
      sz + this.sunDir.z * 180
    );
  }
}
