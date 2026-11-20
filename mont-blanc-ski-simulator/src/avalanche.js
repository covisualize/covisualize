import * as THREE from 'three';

/**
 * Live terrain-following Mont Blanc avalanche system:
 *  - Triggers automatically when carving across steep loaded slopes / fracture zones (or via hotkey 'V')
 *  - Simulates 2,400 billowing powder/snow particles + 120 tumbling ice/snow slab chunks
 *  - Flows downhill strictly following real Mont Blanc DEM slope gradients
 *  - Stamps disturbed avalanche scour trails onto the snow track map
 *  - Can overtake and wipe out the skier if they don't tuck or carve off the fall line!
 */
export class AvalancheSystem {
  constructor(scene, terrain, meta) {
    this.scene = scene;
    this.terrain = terrain;
    this.meta = meta;

    this.active = false;
    this.age = 0;
    this.maxDuration = 26;
    this.justTriggered = false;
    this.justOutrun = false;
    this.avalanchesTriggered = 0;
    this.avalanchesOutrun = 0;
    this.stress = 0;
    this.cooldown = 0;
    this.triggeredZones = new Set();

    // Live centroid & speed of avalanche front for audio, HUD & catch mechanics
    this.frontPos = new THREE.Vector3();
    this.frontSpeed = 0;
    this.distToSkier = 9999;
    this.whiteoutIntensity = 0;

    // 1. 2,400 Powder & Snow Cloud Particles
    this.particleCount = 2400;
    this.pPos = new Float32Array(this.particleCount * 3);
    this.pVel = new Float32Array(this.particleCount * 3);
    this.pMeta = new Float32Array(this.particleCount * 3); // [heightOffset, speedMul, life]

    for (let i = 0; i < this.particleCount; i++) {
      this.pPos[i * 3 + 1] = -9999;
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));

    // Soft billowing powder puff sprite
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 3, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
    grad.addColorStop(0.42, 'rgba(232, 242, 252, 0.65)');
    grad.addColorStop(0.78, 'rgba(205, 224, 245, 0.22)');
    grad.addColorStop(1, 'rgba(195, 215, 240, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    this.particleMat = new THREE.PointsMaterial({
      size: 11.5,
      map: new THREE.CanvasTexture(c),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      color: 0xf4f8ff,
    });

    this.points = new THREE.Points(pGeo, this.particleMat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    // 2. 120 Tumbling Snow / Serac Ice Slab Chunks (InstancedMesh)
    this.chunkCount = 120;
    this.chunkPos = new Float32Array(this.chunkCount * 3);
    this.chunkVel = new Float32Array(this.chunkCount * 3);
    this.chunkScale = new Float32Array(this.chunkCount);
    this.chunkRot = new Float32Array(this.chunkCount * 3);

    const chunkGeo = new THREE.IcosahedronGeometry(1.0, 0);
    const chunkMat = new THREE.MeshLambertMaterial({ color: 0xeef5fc });
    this.chunkMesh = new THREE.InstancedMesh(chunkGeo, chunkMat, this.chunkCount);
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.visible = false;
    scene.add(this.chunkMesh);

    this._dummy = new THREE.Object3D();
    this._scourTimer = 0;
  }

  reset() {
    this.active = false;
    this.age = 0;
    this.justTriggered = false;
    this.justOutrun = false;
    this.avalanchesTriggered = 0;
    this.avalanchesOutrun = 0;
    this.stress = 0;
    this.cooldown = 3.0;
    this.triggeredZones.clear();
    this.distToSkier = 9999;
    this.whiteoutIntensity = 0;
    this.points.visible = false;
    this.chunkMesh.visible = false;
  }

  /**
   * Fracture and release an avalanche slab uphill behind/above the skier!
   */
  triggerNearSkier(skierPos) {
    if (this.active) return false;

    // Sample terrain normal to find exact uphill direction!
    const n = this.terrain.getNormalAt(skierPos.x, skierPos.z, _tmpN);
    let upX = -n.x;
    let upZ = -n.z;
    const len = Math.hypot(upX, upZ);
    if (len < 0.05) {
      upX = 0;
      upZ = 1; // South toward Mont Blanc summit
    } else {
      upX /= len;
      upZ /= len;
    }

    // Spawn the slab fracture crown along the steep uphill flank so you IMMEDIATELY witness
    // a roaring powder wall & tumbling snow chunks surging down the Mont Blanc slope into your path!
    const perpX = -upZ;
    const perpZ = upX;
    const flankSide = Math.random() < 0.5 ? 1 : -1;
    const originX = skierPos.x + upX * 38 + perpX * flankSide * 26;
    const originZ = skierPos.z + upZ * 38 + perpZ * flankSide * 26;

    // Initial downhill velocity direction
    const downX = -upX;
    const downZ = -upZ;

    for (let i = 0; i < this.particleCount; i++) {
      // 30% of the powder surge erupts from the visible steep flank ahead-side; 70% sweeps behind/above you!
      const isFlankSurge = i < this.particleCount * 0.32;
      const spreadAcross = isFlankSurge
        ? flankSide * (18 + Math.random() * 55)
        : (Math.random() - 0.5) * 86;
      const spreadDepth = isFlankSurge
        ? -55 + Math.random() * 65
        : (Math.random() - 0.5) * 32;
      const px = originX + perpX * spreadAcross + upX * spreadDepth;
      const pz = originZ + perpZ * spreadAcross + upZ * spreadDepth;
      const py = this.terrain.getHeightAt(px, pz);

      const hOff = 0.8 + Math.random() * 8.5;
      this.pPos[i * 3] = px;
      this.pPos[i * 3 + 1] = py + hOff;
      this.pPos[i * 3 + 2] = pz;

      const initSpd = 9 + Math.random() * 8;
      this.pVel[i * 3] = downX * initSpd - perpX * flankSide * (isFlankSurge ? 6 : 0) + (Math.random() - 0.5) * 4;
      this.pVel[i * 3 + 1] = 0;
      this.pVel[i * 3 + 2] = downZ * initSpd - perpZ * flankSide * (isFlankSurge ? 6 : 0) + (Math.random() - 0.5) * 4;

      this.pMeta[i * 3] = hOff;
      this.pMeta[i * 3 + 1] = 0.85 + Math.random() * 0.42;
      this.pMeta[i * 3 + 2] = 1.0;
    }

    for (let i = 0; i < this.chunkCount; i++) {
      const isFlankChunk = i < this.chunkCount * 0.4;
      const spreadAcross = isFlankChunk
        ? flankSide * (14 + Math.random() * 44)
        : (Math.random() - 0.5) * 62;
      const spreadDepth = isFlankChunk
        ? -48 + Math.random() * 52
        : (Math.random() - 0.5) * 24;
      const cx = originX + perpX * spreadAcross + upX * spreadDepth;
      const cz = originZ + perpZ * spreadAcross + upZ * spreadDepth;
      const cy = this.terrain.getHeightAt(cx, cz);

      this.chunkPos[i * 3] = cx;
      this.chunkPos[i * 3 + 1] = cy + 0.9;
      this.chunkPos[i * 3 + 2] = cz;

      const initSpd = 10 + Math.random() * 7;
      this.chunkVel[i * 3] = downX * initSpd - perpX * flankSide * (isFlankChunk ? 5 : 0) + (Math.random() - 0.5) * 3;
      this.chunkVel[i * 3 + 1] = 1.8 + Math.random() * 2.8;
      this.chunkVel[i * 3 + 2] = downZ * initSpd - perpZ * flankSide * (isFlankChunk ? 5 : 0) + (Math.random() - 0.5) * 3;

      this.chunkScale[i] = 0.75 + Math.random() * 1.6;
      this.chunkRot[i * 3] = Math.random() * Math.PI * 2;
      this.chunkRot[i * 3 + 1] = Math.random() * Math.PI * 2;
      this.chunkRot[i * 3 + 2] = Math.random() * Math.PI * 2;
    }

    this.active = true;
    this.age = 0;
    this.justTriggered = true;
    this.justOutrun = false;
    this.avalanchesTriggered++;
    this.stress = 0;
    this.frontPos.set(originX, this.terrain.getHeightAt(originX, originZ), originZ);
    this.points.visible = true;
    this.chunkMesh.visible = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    return true;
  }

  update(dt, skier, sky, tracks) {
    this.justTriggered = false;
    this.justOutrun = false;
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Tint avalanche powder cloud to match current Time of Day (gorgeous rose-pink at sunset!)
    this.particleMat.color
      .copy(sky.cloudLightColor)
      .lerp(new THREE.Color(0xffffff), 0.35);

    if (!this.active) {
      this.distToSkier = 9999;
      this.whiteoutIntensity = THREE.MathUtils.lerp(this.whiteoutIntensity, 0, Math.min(1, dt * 4));

      // Check natural avalanche slab trigger conditions while actively skiing
      if (this.cooldown <= 0 && !skier.crashed && skier.grounded && skier.speed > 7) {
        const elevM = this.terrain.getElevationMeters(skier.pos.x, skier.pos.z);

        // 1. Designated Mont Blanc fracture zones along upper/mid Bossons face
        const zones = this.meta.avalancheZones || [];
        for (let i = 0; i < zones.length; i++) {
          if (this.triggeredZones.has(i)) continue;
          const z = zones[i];
          const d = Math.hypot(skier.pos.x - z.x, skier.pos.z - z.z);
          if (d < z.radius && (skier.carveIntensity > 0.25 || skier.slopeDeg > 22)) {
            this.triggeredZones.add(i);
            this.triggerNearSkier(skier.pos);
            return;
          }
        }

        // 2. Dynamic steep-slope cut stress anywhere above treeline (>1,950m, >25° slope)
        if (elevM > 1950 && skier.slopeDeg > 25 && skier.carveIntensity > 0.42) {
          this.stress += dt * (skier.slopeDeg - 22) * skier.carveIntensity * 0.14;
          if (this.stress >= 1.0) {
            this.triggerNearSkier(skier.pos);
            return;
          }
        } else {
          this.stress = Math.max(0, this.stress - dt * 0.35);
        }
      }
      return;
    }

    // Active avalanche simulation!
    this.age += dt;
    const fadeOut = this.age > this.maxDuration - 4.5
      ? Math.max(0, (this.maxDuration - this.age) / 4.5)
      : Math.min(1, this.age * 1.4);
    this.particleMat.opacity = 0.72 * fadeOut;

    const g = 24.5;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let sampleN = 0;
    let closeParticles = 0;

    // Update all 2,400 sliding powder particles following real DEM slope gradient
    for (let i = 0; i < this.particleCount; i++) {
      const ix = i * 3;
      let px = this.pPos[ix];
      let py = this.pPos[ix + 1];
      let pz = this.pPos[ix + 2];

      const n = this.terrain.getNormalAt(px, pz, _tmpN, 4.0);
      const spdMul = this.pMeta[ix + 1];

      // Downhill acceleration + turbulent fanning
      let vx = this.pVel[ix] + n.x * n.y * g * spdMul * dt;
      let vz = this.pVel[ix + 2] + n.z * n.y * g * spdMul * dt;

      // Natural drag & slight lateral spread as powder cloud billows
      const drag = Math.exp(-0.34 * dt);
      vx = vx * drag + (Math.random() - 0.5) * 6.5 * dt;
      vz = vz * drag + (Math.random() - 0.5) * 6.5 * dt;

      // Clamp max avalanche rush (~34 m/s / ~122 km/h -> fast & scary, yet outrunnable in a tuck!)
      const hSpd = Math.hypot(vx, vz);
      const maxSpd = 33.5 * spdMul;
      if (hSpd > maxSpd) {
        const s = maxSpd / hSpd;
        vx *= s;
        vz *= s;
      }

      px += vx * dt;
      pz += vz * dt;
      const groundY = this.terrain.getHeightAt(px, pz);

      // Billow powder cloud higher as speed increases
      const cloudLift = this.pMeta[ix] * (0.6 + Math.min(1.6, hSpd * 0.055));
      py = groundY + cloudLift + Math.sin(this.age * 3.5 + i) * 1.2;

      this.pPos[ix] = px;
      this.pPos[ix + 1] = py;
      this.pPos[ix + 2] = pz;
      this.pVel[ix] = vx;
      this.pVel[ix + 2] = vz;

      // Track avalanche front centroid & proximity density to skier
      if ((i & 7) === 0) {
        sumX += px;
        sumY += groundY;
        sumZ += pz;
        sampleN++;
        const dx = px - skier.pos.x;
        const dz = pz - skier.pos.z;
        if (dx * dx + dz * dz < 26 * 26) {
          closeParticles++;
        }
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;

    // Update 120 tumbling snow & ice slab chunks
    for (let i = 0; i < this.chunkCount; i++) {
      const ix = i * 3;
      let cx = this.chunkPos[ix];
      let cy = this.chunkPos[ix + 1];
      let cz = this.chunkPos[ix + 2];

      const n = this.terrain.getNormalAt(cx, cz, _tmpN, 3.0);
      let vx = this.chunkVel[ix] + n.x * n.y * g * 1.05 * dt;
      let vy = this.chunkVel[ix + 1] - 18.0 * dt;
      let vz = this.chunkVel[ix + 2] + n.z * n.y * g * 1.05 * dt;

      const drag = Math.exp(-0.28 * dt);
      vx *= drag;
      vz *= drag;

      cx += vx * dt;
      cy += vy * dt;
      cz += vz * dt;

      const groundY = this.terrain.getHeightAt(cx, cz);
      if (cy < groundY + this.chunkScale[i] * 0.4) {
        cy = groundY + this.chunkScale[i] * 0.4;
        vy = 1.2 + Math.random() * 3.5;
      }

      this.chunkPos[ix] = cx;
      this.chunkPos[ix + 1] = cy;
      this.chunkPos[ix + 2] = cz;
      this.chunkVel[ix] = vx;
      this.chunkVel[ix + 1] = vy;
      this.chunkVel[ix + 2] = vz;

      this.chunkRot[ix] += dt * 4.5;
      this.chunkRot[ix + 1] += dt * 3.2;

      const s = this.chunkScale[i] * fadeOut;
      this._dummy.position.set(cx, cy, cz);
      this._dummy.rotation.set(this.chunkRot[ix], this.chunkRot[ix + 1], this.chunkRot[ix + 2]);
      this._dummy.scale.set(s, s * 0.72, s * 0.9);
      this._dummy.updateMatrix();
      this.chunkMesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.chunkMesh.instanceMatrix.needsUpdate = true;

    if (sampleN > 0) {
      const prevX = this.frontPos.x;
      const prevZ = this.frontPos.z;
      this.frontPos.set(sumX / sampleN, sumY / sampleN, sumZ / sampleN);
      this.frontSpeed = Math.hypot(this.frontPos.x - prevX, this.frontPos.z - prevZ) / Math.max(dt, 0.001);
    }

    // Stamp churned avalanche debris trail onto the mountain snow track map
    this._scourTimer += dt;
    if (this._scourTimer > 0.12) {
      this._scourTimer = 0;
      tracks.stampAvalancheTrail(this.frontPos.x, this.frontPos.z, 26);
    }

    // Proximity & whiteout / catch detection!
    this.distToSkier = Math.hypot(this.frontPos.x - skier.pos.x, this.frontPos.z - skier.pos.z);
    const targetWhiteout = THREE.MathUtils.clamp((closeParticles / 28) * fadeOut, 0, 0.88);
    this.whiteoutIntensity = THREE.MathUtils.lerp(this.whiteoutIntensity, targetWhiteout, Math.min(1, dt * 5));

    // If the dense avalanche body engulfs the skier after initial 1.6s grace, it sweeps them!
    if (!skier.crashed && this.age > 1.6 && this.age < this.maxDuration - 3.5) {
      if (closeParticles >= 24 && this.distToSkier < 24 && skier.airHeight < 3.5) {
        skier.triggerCrash('Engulfed by a Mont Blanc avalanche');
      }
    }

    // End avalanche when it runs out of momentum or duration expires
    if (this.age >= this.maxDuration) {
      this.active = false;
      this.points.visible = false;
      this.chunkMesh.visible = false;
      this.cooldown = 10.0;
      if (!skier.crashed) {
        this.avalanchesOutrun++;
        this.justOutrun = true;
      }
    }
  }
}

const _tmpN = new THREE.Vector3();
