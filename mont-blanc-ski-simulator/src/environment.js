import * as THREE from 'three';

/**
 * Deterministic PRNG (Mulberry32) so Mont Blanc trees & boulders
 * stay consistent across runs for fair best-time leaderboards.
 */
function createRng(seed = 4808) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Merge an array of non-indexed BufferGeometries (position, normal, color) into one.
 */
function mergeVertexColoredGeometries(geos) {
  let totalVerts = 0;
  const nonIndexed = geos.map((g) => {
    const ni = g.index ? g.toNonIndexed() : g;
    ni.computeVertexNormals();
    totalVerts += ni.attributes.position.count;
    return ni;
  });

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);

  let offset = 0;
  for (const g of nonIndexed) {
    const count = g.attributes.position.count;
    positions.set(g.attributes.position.array, offset * 3);
    normals.set(g.attributes.normal.array, offset * 3);
    colors.set(g.attributes.color.array, offset * 3);
    offset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

function paintGeometry(geo, colorFn) {
  const pos = geo.attributes.position;
  geo.computeVertexNormals();
  const norm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorFn(c, pos.getX(i), pos.getY(i), pos.getZ(i), norm.getX(i), norm.getY(i), norm.getZ(i));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Build a single procedural snow-dusted Alpine spruce/pine tree geometry
 * (tapered trunk + 4 tiered conifer cones with snow-frosted upper faces).
 */
function createPineTreeGeometry() {
  const parts = [];

  // Bark trunk
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, 3.2, 6);
  trunk.translate(0, 1.6, 0);
  paintGeometry(trunk, (c, x, y) => {
    const shade = 0.78 + 0.22 * (y / 3.2);
    c.setRGB(0.24 * shade, 0.16 * shade, 0.11 * shade);
  });
  parts.push(trunk);

  // 4 layered spruce foliage cones with irregular flutes & frosted snow caps
  const tiers = [
    { r: 2.35, h: 3.4, y: 3.45, segs: 7 },
    { r: 1.92, h: 3.1, y: 5.25, segs: 7 },
    { r: 1.42, h: 2.7, y: 6.95, segs: 7 },
    { r: 0.88, h: 2.2, y: 8.45, segs: 6 },
  ];

  tiers.forEach((t, ti) => {
    const cone = new THREE.ConeGeometry(t.r, t.h, t.segs, 2);
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i);
      const vy = p.getY(i);
      const vz = p.getZ(i);
      const ang = Math.atan2(vz, vx);
      const wave = 1.0 + 0.12 * Math.sin(ang * 3 + ti * 1.7);
      p.setXYZ(i, vx * wave, vy, vz * wave);
    }
    cone.rotateY(ti * 0.65);
    cone.translate(0, t.y, 0);
    paintGeometry(cone, (c, x, y, z, nx, ny) => {
      // Upper-facing foliage tips get crisp snow dusting; underside stays deep Alpine pine green
      const heightFrac = (y - (t.y - t.h * 0.5)) / t.h;
      const snowMix = THREE.MathUtils.clamp((ny - 0.12) * 1.15 + heightFrac * 0.55 - 0.38, 0, 0.92);
      const pineR = 0.06 + ti * 0.01;
      const pineG = 0.21 + ti * 0.025;
      const pineB = 0.14 + ti * 0.015;
      c.setRGB(
        THREE.MathUtils.lerp(pineR, 0.91, snowMix),
        THREE.MathUtils.lerp(pineG, 0.95, snowMix),
        THREE.MathUtils.lerp(pineB, 0.99, snowMix)
      );
    });
    parts.push(cone);
  });

  return mergeVertexColoredGeometries(parts);
}

/**
 * Build a procedural Alpine granite boulder with a snow-dusted top cap.
 */
function createBoulderGeometry() {
  const geo = new THREE.IcosahedronGeometry(1.0, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      0.86 +
      0.16 * Math.sin(x * 3.1 + z * 2.4) +
      0.11 * Math.cos(y * 4.2 - x * 2.7);
    pos.setXYZ(i, x * n * 1.18, y * n * 0.78, z * n * 1.05);
  }
  geo.translate(0, 0.38, 0);
  paintGeometry(geo, (c, x, y, z, nx, ny) => {
    const snowCap = THREE.MathUtils.smoothstep(ny, 0.48, 0.84);
    const rockShade = 0.22 + 0.14 * Math.abs(Math.sin(x * 2.5 + y * 3.3));
    c.setRGB(
      THREE.MathUtils.lerp(rockShade, 0.92, snowCap),
      THREE.MathUtils.lerp(rockShade * 1.02, 0.95, snowCap),
      THREE.MathUtils.lerp(rockShade * 1.12, 1.0, snowCap)
    );
  });
  return geo;
}

export class AlpineEnvironment {
  constructor(scene, terrain, meta) {
    this.scene = scene;
    this.terrain = terrain;
    this.meta = meta;

    // Spatial hash for fast O(1) tree & rock collision checks
    this.cellSize = 32;
    this.grid = new Map();
    this.colliders = [];

    this.treeMesh = null;
    this.rockMesh = null;
    this.guideGroup = new THREE.Group();
    scene.add(this.guideGroup);

    this._buildTreesAndRocks();
    this._buildRunGuidesAndFinish();
  }

  _hashKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _addCollider(x, z, radius, type) {
    const item = { x, z, radius, type };
    this.colliders.push(item);
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const key = this._hashKey(cx, cz);
    let bucket = this.grid.get(key);
    if (!bucket) {
      bucket = [];
      this.grid.set(key, bucket);
    }
    bucket.push(item);
  }

  /**
   * Check collision against nearby trees & boulders. Returns hit collider or null.
   */
  checkCollision(x, z, playerRadius = 0.65) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.grid.get(this._hashKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const c = bucket[i];
          const distX = x - c.x;
          const distZ = z - c.z;
          const minR = c.radius + playerRadius;
          if (distX * distX + distZ * distZ < minR * minR) {
            return c;
          }
        }
      }
    }
    return null;
  }

  _distToRunCenterline(x, z) {
    const wps = this.meta.waypoints;
    let best = Infinity;
    for (let i = 0; i < wps.length - 1; i++) {
      const ax = wps[i].x;
      const az = wps[i].z;
      const bx = wps[i + 1].x;
      const bz = wps[i + 1].z;
      const abx = bx - ax;
      const abz = bz - az;
      const len2 = abx * abx + abz * abz || 1;
      const t = THREE.MathUtils.clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
      const px = ax + abx * t;
      const pz = az + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) best = d;
    }
    return best;
  }

  _buildTreesAndRocks() {
    const rng = createRng(4808);
    const wps = this.meta.waypoints;

    // 1. Place snow-dusted Pine Trees by elevation (<2,260m) & slope (<33°)
    // Concentrate around the lower ski corridor + surrounding Chamonix valley slopes
    const treeTransforms = [];
    const maxTrees = 1650;
    const dummy = new THREE.Object3D();

    // Sample candidate points focused around the lower half of the descent + valley
    let attempts = 0;
    while (treeTransforms.length < maxTrees && attempts < 14000) {
      attempts++;
      let x, z;
      if (attempts < 9500) {
        // Pick near lower/mid waypoints (below treeline) for lush skiable glades
        const wpIdx = Math.floor(7 + rng() * (wps.length - 7));
        const wp = wps[Math.min(wps.length - 1, wpIdx)];
        const spread = 520;
        x = wp.x + (rng() - 0.5) * 2 * spread;
        z = wp.z + (rng() - 0.5) * 2 * spread;
      } else {
        // Broad Chamonix valley forest backdrop
        x = (rng() - 0.5) * 3200 - 300;
        z = -1700 + rng() * 2100;
      }

      const elevM = this.terrain.getElevationMeters(x, z);
      // Alpine treeline in Chamonix is ~2,150–2,280m
      if (elevM < 1030 || elevM > 2260) continue;

      const slopeDeg = this.terrain.getSlopeDeg(x, z);
      if (slopeDeg > 33) continue;

      const glacier = this.terrain.getGlacierAt(x, z);
      if (glacier > 0.22) continue;

      // Sparse krummholz near treeline, dense forest lower down
      if (elevM > 2020 && rng() < (elevM - 2020) / 260) continue;

      // Keep finish gate & immediate start clean, and keep main fall-line wide enough to carve thrilling glades
      const dFinish = Math.hypot(x - this.meta.finish.x, z - this.meta.finish.z);
      if (dFinish < 68) continue;

      const dCenter = this._distToRunCenterline(x, z);
      if (dCenter < 13) continue; // open ribbon right down center
      if (dCenter < 34 && rng() < 0.72) continue; // airy glades near center, dense pines framing sides

      const y = this.terrain.getHeightAt(x, z);
      const treelineShrink = elevM > 1950 ? THREE.MathUtils.lerp(1.0, 0.58, (elevM - 1950) / 310) : 1.0;
      const scale = (0.72 + rng() * 0.85) * treelineShrink;

      dummy.position.set(x, y - 0.35, z);
      dummy.rotation.set((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08);
      dummy.scale.set(scale * (0.9 + rng() * 0.22), scale * (0.9 + rng() * 0.35), scale * (0.9 + rng() * 0.22));
      dummy.updateMatrix();
      treeTransforms.push(dummy.matrix.clone());

      // Only add trunk collider near skiable region
      if (dCenter < 420) {
        this._addCollider(x, z, 0.55 * scale + 0.35, 'pine tree');
      }
    }

    const pineGeo = createPineTreeGeometry();
    const pineMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
    });
    this.treeMesh = new THREE.InstancedMesh(pineGeo, pineMat, treeTransforms.length);
    this.treeMesh.castShadow = true;
    this.treeMesh.receiveShadow = false;
    for (let i = 0; i < treeTransforms.length; i++) {
      this.treeMesh.setMatrixAt(i, treeTransforms[i]);
    }
    this.treeMesh.instanceMatrix.needsUpdate = true;
    this.treeMesh.frustumCulled = false;
    this.scene.add(this.treeMesh);

    // 2. Place Alpine Granite Boulders along moraine flanks, ridges & ski hazards
    const rockTransforms = [];
    const maxRocks = 340;
    attempts = 0;
    while (rockTransforms.length < maxRocks && attempts < 4500) {
      attempts++;
      const wpIdx = Math.floor(1 + rng() * (wps.length - 2));
      const wp = wps[wpIdx];
      const spread = 240;
      const x = wp.x + (rng() - 0.5) * 2 * spread;
      const z = wp.z + (rng() - 0.5) * 2 * spread;

      const dStart = Math.hypot(x - this.meta.start.x, z - this.meta.start.z);
      const dFinish = Math.hypot(x - this.meta.finish.x, z - this.meta.finish.z);
      if (dStart < 95 || dFinish < 75) continue;

      const dCenter = this._distToRunCenterline(x, z);
      if (dCenter < 12 && rng() < 0.85) continue; // occasional thrilling dodgeable boulder, mostly framing sides

      const slopeDeg = this.terrain.getSlopeDeg(x, z);
      if (slopeDeg > 44) continue;

      const y = this.terrain.getHeightAt(x, z);
      const scale = 1.15 + rng() * 2.65;
      dummy.position.set(x, y - 0.35 * scale, z);
      dummy.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
      dummy.scale.set(scale * (0.85 + rng() * 0.4), scale * (0.7 + rng() * 0.45), scale * (0.85 + rng() * 0.4));
      dummy.updateMatrix();
      rockTransforms.push(dummy.matrix.clone());

      if (dCenter < 350) {
        this._addCollider(x, z, scale * 0.88, 'granite boulder');
      }
    }

    const rockGeo = createBoulderGeometry();
    const rockMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
    });
    this.rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockTransforms.length);
    this.rockMesh.castShadow = true;
    this.rockMesh.receiveShadow = false;
    for (let i = 0; i < rockTransforms.length; i++) {
      this.rockMesh.setMatrixAt(i, rockTransforms[i]);
    }
    this.rockMesh.instanceMatrix.needsUpdate = true;
    this.rockMesh.frustumCulled = false;
    this.scene.add(this.rockMesh);
  }

  _buildRunGuidesAndFinish() {
    const wps = this.meta.waypoints;
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.4, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xe8edf4 });
    const flagGeo = new THREE.PlaneGeometry(1.15, 0.65);
    const redFlagMat = new THREE.MeshLambertMaterial({ color: 0xe63946, side: THREE.DoubleSide });
    const blueFlagMat = new THREE.MeshLambertMaterial({ color: 0x1d70b8, side: THREE.DoubleSide });

    // Place widely-spaced alpine backcountry guide gates along the real Bossons line
    for (let i = 1; i < wps.length - 1; i += 2) {
      const prev = wps[i - 1];
      const curr = wps[i];
      const next = wps[i + 1];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      const rightX = -dz / len;
      const rightZ = dx / len;

      const gateHalfW = 24;
      const flagMat = i % 4 === 1 ? redFlagMat : blueFlagMat;

      for (const side of [-1, 1]) {
        const gx = curr.x + rightX * gateHalfW * side;
        const gz = curr.z + rightZ * gateHalfW * side;
        const gy = this.terrain.getHeightAt(gx, gz);

        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(gx, gy + 2.0, gz);
        pole.castShadow = true;
        this.guideGroup.add(pole);

        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(gx + rightX * 0.62 * side, gy + 3.65, gz + rightZ * 0.62 * side);
        flag.rotation.y = Math.atan2(dx, dz) + Math.PI * 0.5;
        this.guideGroup.add(flag);
      }
    }

    // Chamonix Valley Finish Arch
    const fin = this.meta.finish;
    const prevWp = wps[wps.length - 2];
    const dirX = fin.x - prevWp.x;
    const dirZ = fin.z - prevWp.z;
    const yaw = Math.atan2(dirX, dirZ);
    const finY = this.terrain.getHeightAt(fin.x, fin.z);

    const archGroup = new THREE.Group();
    archGroup.position.set(fin.x, finY, fin.z);
    archGroup.rotation.y = yaw;

    const pillarGeo = new THREE.BoxGeometry(1.1, 11.5, 1.1);
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0xc82333 });
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-14, 5.2, 0);
    leftPillar.castShadow = true;
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(14, 5.2, 0);
    rightPillar.castShadow = true;

    const beamGeo = new THREE.BoxGeometry(30.5, 2.6, 1.3);
    const beamMat = new THREE.MeshLambertMaterial({ color: 0x162436 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 10.6, 0);
    beam.castShadow = true;

    // Painted canvas banner text ("CHAMONIX FINISH")
    const bCanvas = document.createElement('canvas');
    bCanvas.width = 1024;
    bCanvas.height = 128;
    const bCtx = bCanvas.getContext('2d');
    bCtx.fillStyle = '#111b29';
    bCtx.fillRect(0, 0, 1024, 128);
    bCtx.fillStyle = '#e63946';
    bCtx.fillRect(0, 0, 1024, 12);
    bCtx.fillRect(0, 116, 1024, 12);
    bCtx.fillStyle = '#ffffff';
    bCtx.font = '700 58px system-ui, -apple-system, sans-serif';
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';
    bCtx.fillText('CHAMONIX  •  FINISH', 512, 66);

    const bannerTex = new THREE.CanvasTexture(bCanvas);
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
    const bannerFront = new THREE.Mesh(new THREE.PlaneGeometry(28.5, 2.2), bannerMat);
    bannerFront.position.set(0, 10.6, -0.7);
    bannerFront.rotation.y = Math.PI;
    const bannerBack = new THREE.Mesh(new THREE.PlaneGeometry(28.5, 2.2), bannerMat);
    bannerBack.position.set(0, 10.6, 0.7);

    archGroup.add(leftPillar, rightPillar, beam, bannerFront, bannerBack);
    this.guideGroup.add(archGroup);
  }
}
