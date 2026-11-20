import * as THREE from 'three';

/**
 * Loads the real Chamonix / Mont Blanc 16-bit DEM + Glacier mask PNG,
 * provides fast bicubic height/normal/slope/glacier sampling,
 * builds an adaptive dual-LOD terrain (full massif + high-detail near-skier patch),
 * and renders it with a custom GLSL Alpine snow/rock/glacier/sparkle/tracks/shadow shader.
 */
export class MontBlancTerrain {
  constructor() {
    this.meta = null;
    this.gridSize = 513;
    this.heights = null; // Float32Array in world Y units
    this.glacier = null; // Float32Array in [0..1]
    this.worldWidth = 6044;
    this.worldDepth = 8235;
    this.minElevM = 978;
    this.maxElevM = 4786;
    this.heightScale = 0.65;

    this.baseMesh = null;
    this.detailMesh = null;
    this.material = null;

    this.detailGridSegs = 104;
    this.detailSpan = 210; // ~2.0m vertex spacing right around the skier!
    this.detailStep = this.detailSpan / this.detailGridSegs;
    this.detailCenterX = 1e9;
    this.detailCenterZ = 1e9;
  }

  async load(dataBaseUrl = './data') {
    const [metaRes, img] = await Promise.all([
      fetch(`${dataBaseUrl}/mont_blanc_meta.json`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load metadata (${r.status})`);
        return r.json();
      }),
      new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load mont_blanc_dem.png'));
        image.src = `${dataBaseUrl}/mont_blanc_dem.png`;
      }),
    ]);

    this.meta = metaRes;
    this.gridSize = metaRes.gridSize;
    this.worldWidth = metaRes.worldWidth;
    this.worldDepth = metaRes.worldDepth;
    this.minElevM = metaRes.minElevM;
    this.maxElevM = metaRes.maxElevM;
    this.heightScale = metaRes.heightScale;

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data;

    const count = this.gridSize * this.gridSize;
    this.heights = new Float32Array(count);
    this.glacier = new Float32Array(count);

    const elevSpan = this.maxElevM - this.minElevM;
    for (let i = 0; i < count; i++) {
      const p = i * 4;
      const q16 = (pixels[p] << 8) | pixels[p + 1];
      const elevM = this.minElevM + (q16 / 65535) * elevSpan;
      this.heights[i] = (elevM - this.minElevM) * this.heightScale;
      this.glacier[i] = pixels[p + 2] / 255;
    }

    return this.meta;
  }

  _gridSample(arr, u, v) {
    const n = this.gridSize;
    const gx = Math.max(0, Math.min(n - 1.001, u * (n - 1)));
    const gz = Math.max(0, Math.min(n - 1.001, v * (n - 1)));
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;

    const row0 = iz * n;
    const row1 = (iz + 1) * n;
    const h00 = arr[row0 + ix];
    const h10 = arr[row0 + ix + 1];
    const h01 = arr[row1 + ix];
    const h11 = arr[row1 + ix + 1];

    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  _cubicRow(arr, rowOffset, ix, fx) {
    const n = this.gridSize;
    const i0 = Math.max(0, ix - 1);
    const i1 = ix;
    const i2 = Math.min(n - 1, ix + 1);
    const i3 = Math.min(n - 1, ix + 2);
    const p0 = arr[rowOffset + i0];
    const p1 = arr[rowOffset + i1];
    const p2 = arr[rowOffset + i2];
    const p3 = arr[rowOffset + i3];
    const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
    const c = -0.5 * p0 + 0.5 * p2;
    return ((a * fx + b) * fx + c) * fx + p1;
  }

  /**
   * Subtle natural snow rollers & wind-sculpted sastrugi undulation on top of real DEM.
   */
  _snowMicroRelief(x, z) {
    return (
      Math.sin(x * 0.037 + z * 0.029) * 0.32 +
      Math.cos(x * 0.068 - z * 0.054) * 0.16 +
      Math.sin(x * 0.14 + z * 0.11) * 0.055
    );
  }

  /**
   * Smooth bicubic world Y height at (x, z).
   */
  getHeightAt(x, z) {
    const u = x / this.worldWidth + 0.5;
    const v = z / this.worldDepth + 0.5;
    const n = this.gridSize;
    const gx = Math.max(0, Math.min(n - 1.001, u * (n - 1)));
    const gz = Math.max(0, Math.min(n - 1.001, v * (n - 1)));
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;

    const r0 = Math.max(0, iz - 1) * n;
    const r1 = iz * n;
    const r2 = Math.min(n - 1, iz + 1) * n;
    const r3 = Math.min(n - 1, iz + 2) * n;

    const q0 = this._cubicRow(this.heights, r0, ix, fx);
    const q1 = this._cubicRow(this.heights, r1, ix, fx);
    const q2 = this._cubicRow(this.heights, r2, ix, fx);
    const q3 = this._cubicRow(this.heights, r3, ix, fx);

    const a = -0.5 * q0 + 1.5 * q1 - 1.5 * q2 + 0.5 * q3;
    const b = q0 - 2.5 * q1 + 2.0 * q2 - 0.5 * q3;
    const c = -0.5 * q0 + 0.5 * q2;
    const demY = ((a * fz + b) * fz + c) * fz + q1;

    return demY + this._snowMicroRelief(x, z);
  }

  getElevationMeters(x, z) {
    return this.minElevM + this.getHeightAt(x, z) / this.heightScale;
  }

  getGlacierAt(x, z) {
    const u = x / this.worldWidth + 0.5;
    const v = z / this.worldDepth + 0.5;
    return this._gridSample(this.glacier, u, v);
  }

  getNormalAt(x, z, target = new THREE.Vector3(), eps = 2.0) {
    const hL = this.getHeightAt(x - eps, z);
    const hR = this.getHeightAt(x + eps, z);
    const hD = this.getHeightAt(x, z - eps);
    const hU = this.getHeightAt(x, z + eps);
    return target.set(hL - hR, 2 * eps, hD - hU).normalize();
  }

  getSlopeDeg(x, z) {
    const n = this.getNormalAt(x, z, _tmpN);
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)));
  }

  /**
   * Build the full Mont Blanc massif mesh + high-detail adaptive near-player patch
   * sharing one custom Alpine GLSL ShaderMaterial.
   */
  buildMeshes(scene, sky, tracks) {
    this.sky = sky;
    this.tracks = tracks;

    // 1. Custom GLSL Snow, Rock, Glacier, Sparkle, Carved Tracks & Shadow Shader
    this.uniforms = {
      uSunDir: { value: sky.sunDir.clone() },
      uSunColor: { value: sky.sunColor.clone() },
      uSunIntensity: { value: sky.sunIntensity },
      uShadowTint: { value: sky.shadowTint.clone() },
      uFogColor: { value: sky.fogColor.clone() },
      uHorizonColor: { value: sky.horizonColor.clone() },
      uAlpenglow: { value: sky.alpenglow },

      uNearTrackMap: { value: tracks.nearTexture },
      uNearTrackBounds: { value: tracks.getNearBoundsVec4() },
      uFarTrackMap: { value: tracks.farTexture },
      uFarTrackBounds: { value: tracks.getFarBoundsVec4() },

      uSunShadowMap: { value: null },
      uSunShadowMatrix: { value: new THREE.Matrix4() },
      uHasShadowMap: { value: 0.0 },

      uSkierPos: { value: new THREE.Vector3() },
      uSkierYaw: { value: 0.0 },
      uSkierTuck: { value: 0.0 },
      uSkierAir: { value: 0.0 },
      uSkierEdge: { value: 0.0 },
      uMinElevY: { value: 0.0 },
      uHeightScale: { value: this.heightScale },
      uMinElevM: { value: this.minElevM },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aGlacier;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vGlacier;
        varying float vDist;

        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vGlacier = aGlacier;
          vec4 mv = viewMatrix * wp;
          vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        #include <packing>

        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uShadowTint;
        uniform vec3 uFogColor;
        uniform vec3 uHorizonColor;
        uniform float uAlpenglow;

        uniform sampler2D uNearTrackMap;
        uniform vec4 uNearTrackBounds;
        uniform sampler2D uFarTrackMap;
        uniform vec4 uFarTrackBounds;

        uniform sampler2D uSunShadowMap;
        uniform mat4 uSunShadowMatrix;
        uniform float uHasShadowMap;

        uniform vec3 uSkierPos;
        uniform float uSkierYaw;
        uniform float uSkierTuck;
        uniform float uSkierAir;
        uniform float uSkierEdge;
        uniform float uHeightScale;
        uniform float uMinElevM;

        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vGlacier;
        varying float vDist;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.53);
          return fract(p.x * p.y);
        }

        float noise2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += amp * noise2D(p);
            p = m * p * 2.04 + vec2(17.3, 9.2);
            amp *= 0.5;
          }
          return v;
        }

        // Real Three.js PCF 3x3 shadow map lookup for trees, rocks, and finish arch
        float sampleTreeShadow(vec3 worldPos, vec3 N) {
          if (uHasShadowMap < 0.5) return 1.0;
          vec4 sc = uSunShadowMatrix * vec4(worldPos + N * 0.45, 1.0);
          vec3 proj = sc.xyz / sc.w;
          if (proj.x < 0.02 || proj.x > 0.98 || proj.y < 0.02 || proj.y > 0.98 || proj.z > 1.0 || proj.z < 0.0) {
            return 1.0;
          }
          float currentDepth = proj.z - 0.0008;
          float texel = 1.0 / 2048.0;
          float shadow = 0.0;
          for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
              float d = unpackRGBAToDepth(texture2D(uSunShadowMap, proj.xy + vec2(float(x), float(y)) * texel));
              shadow += (currentDepth > d) ? 0.0 : 1.0;
            }
          }
          shadow /= 9.0;
          // Smooth edge fade at frustum boundary
          float edgeFade = smoothstep(0.02, 0.10, min(min(proj.x, 1.0 - proj.x), min(proj.y, 1.0 - proj.y)));
          return mix(1.0, shadow, edgeFade);
        }

        // Crisp analytical projected shadow of the first-person skier (body, skis, poles) on the snow!
        float sampleSkierShadow(vec3 worldPos, vec3 sunDir) {
          vec3 toFrag = worldPos - uSkierPos;
          if (dot(toFrag, toFrag) > 280.0) return 1.0;

          float sy = max(sunDir.y, 0.14);
          // Ray cast from fragment toward sun; check intersection with skier vertical column
          // Project skier height h onto snow along -sunDir: offset = -sunDir.xz / sy * h
          vec2 sunProj = -sunDir.xz / sy;

          // Local skier basis: forward = (sin(yaw), cos(yaw)), right = (cos(yaw), -sin(yaw))
          float sY = sin(uSkierYaw);
          float cY = cos(uSkierYaw);
          vec2 fwd = vec2(sY, cY);
          vec2 rgt = vec2(cY, -sY);

          float airH = max(0.0, uSkierAir);
          float bodyH = mix(1.62, 1.08, uSkierTuck);
          float shadowHit = 0.0;

          // 1. Twin skis shadow (at height = airH + 0.05)
          vec2 skiDelta = toFrag.xz - sunProj * (airH + 0.06);
          float sF = dot(skiDelta, fwd);
          float sR = dot(skiDelta, rgt);
          float leftSki = smoothstep(0.11, 0.03, abs(sR + 0.25)) * smoothstep(1.05, 0.80, abs(sF - 0.10));
          float rightSki = smoothstep(0.11, 0.03, abs(sR - 0.25)) * smoothstep(1.05, 0.80, abs(sF - 0.10));
          shadowHit = max(shadowHit, max(leftSki, rightSki) * 0.72);

          // 2. Legs + Torso + Helmet silhouette projected along sun ray
          for (int i = 0; i < 4; i++) {
            float frac = (float(i) + 0.5) / 4.0;
            float h = airH + 0.15 + frac * bodyH;
            // Subtle forward lean into downhill & lateral carve lean
            vec2 bodyOffset = fwd * (0.18 + uSkierTuck * 0.28) * frac + rgt * (-uSkierEdge * 0.34 * frac);
            vec2 d = (toFrag.xz - bodyOffset) - sunProj * h;
            float rad = (i == 3) ? 0.22 : ((i == 2) ? 0.34 : 0.28);
            float dist = length(d);
            shadowHit = max(shadowHit, smoothstep(rad + 0.16, rad * 0.45, dist) * 0.84);
          }

          // 3. Ski poles shadow extending out to left & right sides
          vec2 poleBaseL = rgt * (-0.42) + fwd * 0.12;
          vec2 poleBaseR = rgt * (0.42) + fwd * 0.12;
          vec2 dPL = (toFrag.xz - poleBaseL) - sunProj * (airH + bodyH * 0.52);
          vec2 dPR = (toFrag.xz - poleBaseR) - sunProj * (airH + bodyH * 0.52);
          float poleL = smoothstep(0.12, 0.03, abs(dot(dPL, rgt))) * smoothstep(0.70, 0.45, abs(dot(dPL, fwd)));
          float poleR = smoothstep(0.12, 0.03, abs(dot(dPR, rgt))) * smoothstep(0.70, 0.45, abs(dot(dPR, fwd)));
          shadowHit = max(shadowHit, max(poleL, poleR) * 0.48);

          // Soften shadow slightly when high in the air
          float airSoft = 1.0 / (1.0 + airH * 0.12);
          return 1.0 - shadowHit * 0.78 * airSoft;
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDir);

          float elevM = uMinElevM + vWorldPos.y / uHeightScale;
          float slope = 1.0 - clamp(N.y, 0.0, 1.0); // 0 = flat, ~0.18 = 35 deg, ~0.35 = 50 deg

          // Procedural Alpine rock & snow grain noise
          float nMacro = fbm(vWorldPos.xz * 0.011);
          float nMed = fbm(vWorldPos.xz * 0.055);
          float nFine = noise2D(vWorldPos.xz * 0.48);
          float strata = noise2D(vec2(vWorldPos.y * 0.14 + nMacro * 3.5, (vWorldPos.x + vWorldPos.z) * 0.025));

          // 1. Snow vs Exposed Mont Blanc Protogine Granite Rock by slope + elevation
          float rockThreshold = mix(0.175, 0.245, nMacro);
          // Slightly more exposed dark alpine cliffs higher up
          rockThreshold -= smoothstep(2800.0, 4400.0, elevM) * 0.028;
          float rockMask = smoothstep(rockThreshold, rockThreshold + 0.115, slope);

          // Lower Chamonix valley floor patches (<1220m) show subtle alpine pine-needle / meadow earth on steep cuts
          float valleyGrass = smoothstep(1340.0, 1080.0, elevM) * smoothstep(0.06, 0.18, slope) * (1.0 - rockMask);

          // 2. Glacier Ice Strip (Glacier des Bossons luminous cyan-turquoise ice!)
          float glacierNoise = fbm(vWorldPos.xz * 0.065 + vec2(0.0, vWorldPos.z * 0.03));
          float glacierMask = smoothstep(0.24, 0.62, vGlacier + (glacierNoise - 0.5) * 0.25) * (1.0 - rockMask * 0.85);
          float crevasse = smoothstep(0.42, 0.72, sin(vWorldPos.z * 0.24 + vWorldPos.x * 0.08 + glacierNoise * 5.2) * 0.5 + 0.5);

          // 3. Carved Snow Tracks (near high-res + persistent mountain corridor)
          vec2 nearUV = (vWorldPos.xz - uNearTrackBounds.xy) * uNearTrackBounds.zw;
          vec2 farUV = (vWorldPos.xz - uFarTrackBounds.xy) * uFarTrackBounds.zw;

          float trackGroove = 0.0;
          float trackBerm = 0.0;
          float avScour = 0.0;

          // Sample persistent full-run tracks first
          if (farUV.x > 0.002 && farUV.x < 0.998 && farUV.y > 0.002 && farUV.y < 0.998) {
            vec3 farT = texture2D(uFarTrackMap, farUV).rgb;
            trackGroove = max(trackGroove, farT.r * 0.72);
            trackBerm = max(trackBerm, farT.g * 0.55);
            avScour = max(avScour, farT.b);
          }

          // Blend in razor-sharp near track map with finite-difference normal perturbation!
          vec3 trackNormalOffset = vec3(0.0);
          if (nearUV.x > 0.01 && nearUV.x < 0.99 && nearUV.y > 0.01 && nearUV.y < 0.99) {
            float nearEdge = smoothstep(0.01, 0.08, min(min(nearUV.x, 1.0 - nearUV.x), min(nearUV.y, 1.0 - nearUV.y)));
            vec3 nearT = texture2D(uNearTrackMap, nearUV).rgb;
            trackGroove = mix(trackGroove, max(trackGroove, nearT.r), nearEdge);
            trackBerm = mix(trackBerm, max(trackBerm, nearT.g), nearEdge);
            avScour = mix(avScour, max(avScour, nearT.b), nearEdge);

            // Finite-difference groove height for realistic carved snow lip lighting
            float epsUV = 1.25 / 512.0;
            float hL = texture2D(uNearTrackMap, nearUV - vec2(epsUV, 0.0)).r;
            float hR = texture2D(uNearTrackMap, nearUV + vec2(epsUV, 0.0)).r;
            float hD = texture2D(uNearTrackMap, nearUV - vec2(0.0, epsUV)).r;
            float hU = texture2D(uNearTrackMap, nearUV + vec2(0.0, epsUV)).r;
            trackNormalOffset = vec3((hR - hL) * 0.85, 0.0, (hU - hD) * 0.85) * nearEdge;
          }

          // Only show tracks on snow/glacier, not sheer granite cliffs
          float trackFade = 1.0 - rockMask;
          trackGroove *= trackFade;
          trackBerm *= trackFade;

          // Rich wind-sculpted Alpine snow sastrugi & ripple normals + carved track lip normal
          float ripple1 = fbm(vWorldPos.xz * 0.16 + vec2(0.0, vWorldPos.z * 0.08));
          float ripple2 = fbm(vWorldPos.xz * 0.34 - vec2(vWorldPos.x * 0.06, 0.0));
          float nearRippleFade = smoothstep(260.0, 20.0, vDist);
          vec3 snowMicroN = vec3(
            (ripple1 - 0.5) * 0.24 + (ripple2 - 0.5) * 0.14 * nearRippleFade,
            0.0,
            (nMed - 0.5) * 0.22 + (nFine - 0.5) * 0.12 * nearRippleFade
          );

          vec3 detailN = normalize(
            N +
            snowMicroN * (1.0 - rockMask) +
            vec3((strata - 0.5) * 0.42, 0.0, (nMed - 0.5) * 0.36) * rockMask +
            trackNormalOffset * 1.35
          );

          // 4. Surface Albedo Palette
          vec3 snowAlbedo = mix(vec3(0.84, 0.90, 0.97), vec3(0.95, 0.97, 1.0), nMed * 0.65 + ripple1 * 0.35);
          // Carved ski groove shows cool blue shadowed snow inside + bright powdery lip on the berm
          snowAlbedo = mix(snowAlbedo, vec3(0.46, 0.63, 0.86), clamp(trackGroove * 0.82, 0.0, 0.82));
          snowAlbedo += vec3(0.08, 0.09, 0.10) * trackBerm * (1.0 - trackGroove * 0.45);
          // Avalanche disturbed powder looks churned and slightly cool-grey/blue
          snowAlbedo = mix(snowAlbedo, vec3(0.70, 0.78, 0.88), clamp(avScour * 0.58, 0.0, 0.58));

          // Glacier ice: deep luminous cyan-turquoise with frosted ridges
          vec3 glacierDeep = vec3(0.10, 0.60, 0.82);
          vec3 glacierBright = vec3(0.52, 0.90, 0.98);
          vec3 glacierAlbedo = mix(glacierDeep, glacierBright, crevasse * 0.72 + nFine * 0.18);
          // Skis scraping across cyan glacier leave crisp white ice-shaving lines!
          glacierAlbedo = mix(glacierAlbedo, vec3(0.92, 0.98, 1.0), clamp(trackGroove * 0.70, 0.0, 0.70));

          // Granite cliff rock (Mont Blanc dark grey-slate with warm mineral hints)
          vec3 rockDark = vec3(0.14, 0.15, 0.19);
          vec3 rockLight = vec3(0.35, 0.34, 0.37);
          vec3 rockAlbedo = mix(rockDark, rockLight, strata * 0.7 + nFine * 0.3);

          vec3 valleyAlbedo = vec3(0.22, 0.29, 0.20);

          vec3 albedo = mix(snowAlbedo, glacierAlbedo, glacierMask);
          albedo = mix(albedo, valleyAlbedo, valleyGrass * 0.45);
          albedo = mix(albedo, rockAlbedo, rockMask);

          // 5. Alpine Lighting: Direct Sun + Soft Blue Sky Shadows + Sunset Alpenglow
          float NdotL = dot(detailN, L);
          float diffuse = max(NdotL, 0.0);
          // Soft wrap lighting on snow subsurface scattering
          float snowWrap = clamp((NdotL + 0.12) / 1.12, 0.0, 1.0);
          float litFactor = mix(snowWrap, diffuse, rockMask);

          // Real shadow maps (trees/rocks) + crisp projected skier silhouette shadow!
          float treeShadow = sampleTreeShadow(vWorldPos, N);
          float skierShadow = sampleSkierShadow(vWorldPos, L);
          float totalShadow = min(treeShadow, skierShadow);

          // Hemisphere ambient: rich cool Alpine cobalt-blue in shadows, crisp sky fill on top
          float hemi = 0.5 + 0.5 * detailN.y;
          vec3 ambient = mix(uShadowTint * 0.52, mix(uShadowTint, vec3(0.76, 0.86, 0.98), 0.36), hemi);
          // Subsurface cyan glow inside glacier ice shadows
          ambient = mix(ambient, vec3(0.14, 0.58, 0.78), glacierMask * 0.45);

          vec3 directLight = uSunColor * (uSunIntensity * 0.68) * litFactor * totalShadow;

          // Vivid Pink Sunset Alpenglow on high snow peaks & sun-kissed ridges!
          float peakFactor = smoothstep(1700.0, 4100.0, elevM);
          vec3 alpenglowTint = vec3(1.0, 0.44, 0.58) * uAlpenglow * (0.24 + 0.48 * peakFactor) * litFactor * totalShadow;

          vec3 color = albedo * (ambient * 0.62 + directLight + alpenglowTint);

          // 6. Specular Highlights: Glossy Glacier Ice + Micro-Facet Snow Sparkle!
          vec3 H = normalize(L + V);
          float NdotH = max(dot(detailN, H), 0.0);

          // Glacier glossy ice sheen
          float iceSpec = pow(NdotH, 46.0) * glacierMask * 0.75 * totalShadow;
          // Broad soft snow sheen (stronger in carved icy grooves)
          float snowSheen = pow(NdotH, 20.0) * (0.10 + trackGroove * 0.24) * (1.0 - rockMask) * totalShadow;

          // Snow crystal sparkle glitter (twinkles with view angle on nearby sunlit snow!)
          float sparkle = 0.0;
          if (vDist < 95.0 && rockMask < 0.6 && totalShadow > 0.4) {
            vec2 spGrid = floor(vWorldPos.xz * 4.8);
            float rnd = hash21(spGrid);
            float viewShift = hash21(spGrid + floor(V.xz * 14.0));
            float glint = smoothstep(0.968, 0.996, rnd * 0.5 + viewShift * 0.5);
            sparkle = glint * smoothstep(95.0, 10.0, vDist) * (1.0 - rockMask) * litFactor * 1.45;
          }

          color += uSunColor * (iceSpec + snowSheen + sparkle);

          // Subtle rim fresnel on snow & ice
          float fresnel = pow(1.0 - max(dot(detailN, V), 0.0), 4.0);
          color += uHorizonColor * fresnel * (0.08 + glacierMask * 0.16) * (1.0 - rockMask * 0.7);

          // 7. Atmospheric Alpine Distance Haze / Aerial Perspective
          float fogFactor = 1.0 - exp(-pow(vDist * 0.00025, 1.48));
          // Slightly stronger valley mist at lower elevations & far boundary
          float valleyMist = smoothstep(2000.0, 1050.0, elevM) * smoothstep(300.0, 2400.0, vDist) * 0.30;
          float farFade = smoothstep(3400.0, 5600.0, vDist) * 0.55;
          fogFactor = clamp(fogFactor + valleyMist + farFade, 0.0, 0.98);

          // Mie sun-glow tint in the distance haze
          float sunView = max(dot(-V, L), 0.0);
          vec3 hazeColor = mix(uFogColor, uSunColor, pow(sunView, 5.0) * (0.24 + 0.32 * uAlpenglow));
          color = mix(color, hazeColor, fogFactor);

          // ACES filmic tone mapping keeps bright morning snow textured with blue shadows instead of clipping flat white
          color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
          color = clamp(color, 0.0, 1.0);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    // 2. Full Mont Blanc Massif Base Mesh (256 x 256 segments)
    const baseSegs = 256;
    const baseGeo = new THREE.PlaneGeometry(this.worldWidth, this.worldDepth, baseSegs, baseSegs);
    baseGeo.rotateX(-Math.PI / 2);

    const posAttr = baseGeo.attributes.position;
    const glacierAttr = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      posAttr.setY(i, this.getHeightAt(x, z));
      glacierAttr[i] = this.getGlacierAt(x, z);
    }
    baseGeo.setAttribute('aGlacier', new THREE.BufferAttribute(glacierAttr, 1));
    baseGeo.computeVertexNormals();

    this.baseMesh = new THREE.Mesh(baseGeo, this.material);
    this.baseMesh.frustumCulled = false;
    this.baseMesh.onBeforeRender = () => this._syncShadowUniforms();
    scene.add(this.baseMesh);

    // 3. Adaptive High-Detail Near-Player Terrain Patch (104 x 104 over 210m x 210m -> ~2.0m vertices!)
    const detailGeo = new THREE.PlaneGeometry(
      this.detailSpan,
      this.detailSpan,
      this.detailGridSegs,
      this.detailGridSegs
    );
    detailGeo.rotateX(-Math.PI / 2);
    detailGeo.setAttribute(
      'aGlacier',
      new THREE.BufferAttribute(new Float32Array(detailGeo.attributes.position.count), 1)
    );

    this.detailMesh = new THREE.Mesh(detailGeo, this.material);
    this.detailMesh.frustumCulled = false;
    this.detailMesh.renderOrder = 1;
    this.detailMesh.onBeforeRender = () => this._syncShadowUniforms();
    scene.add(this.detailMesh);

    this.updateDetailPatch(this.meta.start.x, this.meta.start.z, true);
  }

  _syncShadowUniforms() {
    if (!this.sky || !this.sky.sunLight.shadow.map) return;
    this.uniforms.uSunShadowMap.value = this.sky.sunLight.shadow.map.texture;
    this.uniforms.uSunShadowMatrix.value.copy(this.sky.sunLight.shadow.matrix);
    this.uniforms.uHasShadowMap.value = 1.0;
  }

  /**
   * Snap and refresh the high-resolution near-player terrain patch around the skier.
   */
  updateDetailPatch(skierX, skierZ, force = false) {
    const snap = this.detailStep * 4;
    const cx = Math.round(skierX / snap) * snap;
    const cz = Math.round(skierZ / snap) * snap;
    if (!force && cx === this.detailCenterX && cz === this.detailCenterZ) return;

    this.detailCenterX = cx;
    this.detailCenterZ = cz;
    this.detailMesh.position.set(cx, 0, cz);

    const geo = this.detailMesh.geometry;
    const pos = geo.attributes.position;
    const glAttr = geo.attributes.aGlacier;
    const half = this.detailSpan * 0.5;

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = cx + lx;
      const wz = cz + lz;
      const edgeFrac = Math.max(Math.abs(lx), Math.abs(lz)) / half;
      // Gently lift center by +0.08m above coarse base mesh, taper smoothly below at outer rim so edges never seam!
      const seamOffset = edgeFrac > 0.80 ? 0.08 - ((edgeFrac - 0.80) / 0.20) * 1.15 : 0.08;
      pos.setY(i, this.getHeightAt(wx, wz) + seamOffset);
      glAttr.setX(i, this.getGlacierAt(wx, wz));
    }

    pos.needsUpdate = true;
    glAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }

  updateUniforms(sky, tracks, skierState) {
    this.uniforms.uSunDir.value.copy(sky.sunDir);
    this.uniforms.uSunColor.value.copy(sky.sunColor);
    this.uniforms.uSunIntensity.value = sky.sunIntensity;
    this.uniforms.uShadowTint.value.copy(sky.shadowTint);
    this.uniforms.uFogColor.value.copy(sky.fogColor);
    this.uniforms.uHorizonColor.value.copy(sky.horizonColor);
    this.uniforms.uAlpenglow.value = sky.alpenglow;

    tracks.getNearBoundsVec4(this.uniforms.uNearTrackBounds.value);
    tracks.getFarBoundsVec4(this.uniforms.uFarTrackBounds.value);

    if (skierState) {
      this.uniforms.uSkierPos.value.copy(skierState.pos);
      this.uniforms.uSkierYaw.value = skierState.yaw;
      this.uniforms.uSkierTuck.value = skierState.tuckAmount;
      this.uniforms.uSkierAir.value = skierState.airHeight;
      this.uniforms.uSkierEdge.value = skierState.edgeAngle;
    }
  }
}

const _tmpN = new THREE.Vector3();
