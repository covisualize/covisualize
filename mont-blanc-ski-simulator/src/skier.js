import * as THREE from 'three';

/**
 * First-person skier rig (procedural skis, bindings, poles, snow spray particles)
 * and downhill Alpine physics engine (gravity, carving edge turns, tuck, brake, jump, crashes).
 */
export class SkierController {
  constructor(scene, camera, terrain, meta) {
    this.scene = scene;
    this.camera = camera;
    this.terrain = terrain;
    this.meta = meta;

    // Physics state
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = meta.start.yaw; // Heading angle: forward = (sin(yaw), 0, cos(yaw))
    this.edgeAngle = 0; // [-1..+1] carve lean (negative = left turn, positive = right turn)
    this.tuckAmount = 0; // [0..1]
    this.brakeAmount = 0; // [0..1]
    this.grounded = true;
    this.airHeight = 0;
    this.airTime = 0;
    this.maxAirTime = 0;
    this.speed = 0; // world m/s
    this.speedKmh = 0;
    this.topSpeedKmh = 0;
    this.onGlacier = false;
    this.slopeDeg = 0;
    this.carveIntensity = 0;
    this.crashed = false;
    this.crashReason = '';
    this.crashTimer = 0;
    this.crashSpin = 0;
    this.landingCompression = 0;
    this.jumpCooldown = 0;
    this.justJumped = false;
    this.justLandedIntensity = 0;
    this.justCrashed = false;
    this.distanceSkied = 0;

    // Camera smoothing state
    this.smoothPitch = -0.22;
    this.smoothRoll = 0;
    this.camPos = new THREE.Vector3();

    // First-person procedural skis + poles rig attached to a skier-local world group
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this._buildFirstPersonRig();
    this._buildSprayParticles();

    this.reset();
  }

  _buildFirstPersonRig() {
    // 1. Procedural Freeride Skis (built from simple geometric shapes)
    const skiTopMat = new THREE.MeshStandardMaterial({
      color: 0xd93829,
      roughness: 0.28,
      metalness: 0.22,
    });
    const skiBaseMat = new THREE.MeshStandardMaterial({
      color: 0x161b22,
      roughness: 0.4,
      metalness: 0.35,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf7f9fc,
      roughness: 0.3,
    });
    const bindingMat = new THREE.MeshStandardMaterial({
      color: 0x222831,
      roughness: 0.45,
      metalness: 0.65,
    });

    const createSki = () => {
      const ski = new THREE.Group();

      // Main plank (length 1.85m along +Z, width 0.13m, thickness 0.025m)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.026, 1.58), skiTopMat);
      body.position.set(0, 0.015, 0.16);
      ski.add(body);

      // Dark base rail
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.134, 0.01, 1.56), skiBaseMat);
      base.position.set(0, 0.005, 0.16);
      ski.add(base);

      // White alpine racing stripe along topsheet
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.005, 1.44), stripeMat);
      stripe.position.set(0, 0.03, 0.20);
      ski.add(stripe);

      // Upturned curved twin-tip rocker nose (+Z forward)
      const tip1 = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.022, 0.22), skiTopMat);
      tip1.position.set(0, 0.042, 1.03);
      tip1.rotation.x = -0.26;
      ski.add(tip1);

      const tip2 = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 10), skiTopMat);
      tip2.position.set(0, 0.082, 1.15);
      tip2.rotation.x = -0.45;
      ski.add(tip2);

      // Toe & heel bindings
      const toeBind = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.045, 0.14), bindingMat);
      toeBind.position.set(0, 0.045, 0.22);
      ski.add(toeBind);

      const heelBind = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.055, 0.16), bindingMat);
      heelBind.position.set(0, 0.05, -0.18);
      ski.add(heelBind);

      return ski;
    };

    this.skisGroup = new THREE.Group();
    this.leftSki = createSki();
    this.leftSki.position.set(-0.23, 0, 0);
    this.rightSki = createSki();
    this.rightSki.position.set(0.23, 0, 0);
    this.skisGroup.add(this.leftSki, this.rightSki);
    this.rig.add(this.skisGroup);

    // 2. Procedural Ski Poles (grip, tapered shaft, snow basket, carbide tip)
    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0xd0d8e2,
      roughness: 0.25,
      metalness: 0.78,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      roughness: 0.85,
    });
    const basketMat = new THREE.MeshStandardMaterial({
      color: 0xe63946,
      roughness: 0.45,
    });

    const createPole = (side) => {
      const pole = new THREE.Group();
      // Sleek grip & subtle dark winter glove cuff at the wrist end
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.019, 0.17, 10), gripMat);
      grip.position.y = 0.0;
      pole.add(grip);

      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 6, 12), basketMat);
      strap.position.set(side * 0.015, 0.04, -0.02);
      strap.rotation.y = Math.PI * 0.5;
      pole.add(strap);

      // Tapered aluminum shaft extending forward & down toward the snow
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0055, 1.24, 8), shaftMat);
      shaft.position.y = -0.66;
      pole.add(shaft);

      // Circular snow basket near tip
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.012, 12), basketMat);
      basket.position.y = -1.16;
      pole.add(basket);

      return pole;
    };

    this.polesGroup = new THREE.Group();
    this.leftPole = createPole(-1);
    this.rightPole = createPole(1);

    this.polesGroup.add(this.leftPole, this.rightPole);
    this.rig.add(this.polesGroup);
  }

  _buildSprayParticles() {
    this.sprayCount = 220;
    this.sprayPositions = new Float32Array(this.sprayCount * 3);
    this.sprayVelocities = new Float32Array(this.sprayCount * 3);
    this.sprayLife = new Float32Array(this.sprayCount);
    this.sprayCursor = 0;

    for (let i = 0; i < this.sprayCount; i++) {
      this.sprayLife[i] = 0;
      this.sprayPositions[i * 3 + 1] = -9999;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3));

    // Soft circular snow puff texture
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.5, 'rgba(235, 245, 255, 0.55)');
    grad.addColorStop(1, 'rgba(220, 238, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const mat = new THREE.PointsMaterial({
      size: 0.95,
      map: new THREE.CanvasTexture(c),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      color: 0xffffff,
    });

    this.sprayPoints = new THREE.Points(geo, mat);
    this.sprayPoints.frustumCulled = false;
    this.scene.add(this.sprayPoints);
  }

  _emitSpray(x, y, z, vx, vy, vz, count) {
    for (let n = 0; n < count; n++) {
      const i = this.sprayCursor;
      this.sprayCursor = (this.sprayCursor + 1) % this.sprayCount;
      this.sprayPositions[i * 3] = x + (Math.random() - 0.5) * 0.55;
      this.sprayPositions[i * 3 + 1] = y + 0.1 + Math.random() * 0.25;
      this.sprayPositions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.55;
      this.sprayVelocities[i * 3] = vx + (Math.random() - 0.5) * 3.8;
      this.sprayVelocities[i * 3 + 1] = vy + 1.4 + Math.random() * 2.8;
      this.sprayVelocities[i * 3 + 2] = vz + (Math.random() - 0.5) * 3.8;
      this.sprayLife[i] = 0.45 + Math.random() * 0.5;
    }
  }

  _updateSpray(dt) {
    for (let i = 0; i < this.sprayCount; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      if (this.sprayLife[i] <= 0) {
        this.sprayPositions[i * 3 + 1] = -9999;
        continue;
      }
      this.sprayVelocities[i * 3 + 1] -= 7.2 * dt;
      this.sprayPositions[i * 3] += this.sprayVelocities[i * 3] * dt;
      this.sprayPositions[i * 3 + 1] += this.sprayVelocities[i * 3 + 1] * dt;
      this.sprayPositions[i * 3 + 2] += this.sprayVelocities[i * 3 + 2] * dt;
    }
    this.sprayPoints.geometry.attributes.position.needsUpdate = true;
  }

  reset() {
    const start = this.meta.start;
    const y = this.terrain.getHeightAt(start.x, start.z);
    this.pos.set(start.x, y, start.z);
    this.yaw = start.yaw;

    // Gentle starting push downhill
    const initSpeed = 4.5;
    this.vel.set(Math.sin(this.yaw) * initSpeed, 0, Math.cos(this.yaw) * initSpeed);
    this.edgeAngle = 0;
    this.tuckAmount = 0;
    this.brakeAmount = 0;
    this.grounded = true;
    this.airHeight = 0;
    this.airTime = 0;
    this.maxAirTime = 0;
    this.speed = initSpeed;
    this.speedKmh = initSpeed * 3.6;
    this.topSpeedKmh = 0;
    this.carveIntensity = 0;
    this.crashed = false;
    this.crashReason = '';
    this.crashTimer = 0;
    this.crashSpin = 0;
    this.landingCompression = 0;
    this.jumpCooldown = 0;
    this.justJumped = false;
    this.justLandedIntensity = 0;
    this.justCrashed = false;
    this.distanceSkied = 0;

    for (let i = 0; i < this.sprayCount; i++) {
      this.sprayLife[i] = 0;
      this.sprayPositions[i * 3 + 1] = -9999;
    }
    this.sprayPoints.geometry.attributes.position.needsUpdate = true;
    this.syncCameraAndRig(0.016, false);
  }

  triggerCrash(reason) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.crashTimer = 0;
    this.crashSpin = (Math.random() < 0.5 ? -1 : 1) * (2.6 + Math.random() * 1.4);
    this.justCrashed = true;
    this._emitSpray(this.pos.x, this.pos.y + 0.5, this.pos.z, 0, 3.5, 0, 38);
  }

  /**
   * Step downhill skiing physics for one frame.
   * input = { steer: [-1..1], tuck: bool, brake: bool, jump: bool }
   */
  update(dt, input, environment, tracks) {
    this.justJumped = false;
    this.justLandedIntensity = 0;
    this.justCrashed = false;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    if (this.crashed) {
      this.crashTimer += dt;
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 2.8));
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y = this.terrain.getHeightAt(this.pos.x, this.pos.z);
      this.speed = this.vel.length();
      this.speedKmh = this.speed * 3.6;
      this._updateSpray(dt);
      this.syncCameraAndRig(dt, true);
      return;
    }

    const normal = this.terrain.getNormalAt(this.pos.x, this.pos.z, _tmpNormal);
    this.slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)));
    const glacierVal = this.terrain.getGlacierAt(this.pos.x, this.pos.z);
    this.onGlacier = glacierVal > 0.36;

    // Smooth input responses
    const targetEdge = THREE.MathUtils.clamp(input.steer, -1, 1);
    const edgeRate = this.grounded ? 6.8 : 2.6;
    this.edgeAngle = THREE.MathUtils.lerp(this.edgeAngle, targetEdge, Math.min(1, dt * edgeRate));

    const targetTuck = input.tuck && !input.brake ? 1 : 0;
    const targetBrake = input.brake ? 1 : 0;
    this.tuckAmount = THREE.MathUtils.lerp(this.tuckAmount, targetTuck, Math.min(1, dt * 6.5));
    this.brakeAmount = THREE.MathUtils.lerp(this.brakeAmount, targetBrake, Math.min(1, dt * 7.5));

    // Steering / Carving Turn Rate
    // Positive steer = turn right (in Three.js Y-up where forward = (sin(yaw), 0, cos(yaw)), turning right DECREASES yaw!)
    const speedNorm = THREE.MathUtils.clamp(this.speed / 12, 0.25, 1.35);
    const turnPower = this.grounded ? (1.42 + this.brakeAmount * 0.45) : 0.35;
    this.yaw -= this.edgeAngle * turnPower * speedNorm * dt;

    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    // Downhill gravity vector projected onto terrain tangent plane
    const g = 18.8; // Tuned for thrilling real-scale Alpine momentum
    // Normal component of (0, -g, 0) is (-g * normal.y)
    const gravTanX = normal.x * normal.y * g;
    const gravTanZ = normal.z * normal.y * g;

    if (this.grounded) {
      // Forward & lateral velocity components
      let vFwd = this.vel.x * fwdX + this.vel.z * fwdZ;
      let vLat = this.vel.x * rightX + this.vel.z * rightZ;

      // Gravity along ski forward & lateral axes
      const gFwd = gravTanX * fwdX + gravTanZ * fwdZ;
      const gLat = gravTanX * rightX + gravTanZ * rightZ;

      vFwd += gFwd * dt;

      // Snow friction + aerodynamic drag + carving edge scrub + braking
      const snowFriction = this.onGlacier ? 0.018 : 0.036; // Cyan glacier ice is faster & slicker!
      const aeroDrag = THREE.MathUtils.lerp(0.0085, 0.0038, this.tuckAmount);
      const edgeScrub = Math.abs(this.edgeAngle) * (this.onGlacier ? 0.10 : 0.17);
      const brakeDrag = this.brakeAmount * (this.onGlacier ? 0.62 : 1.05);

      const totalDecel = snowFriction * g + aeroDrag * vFwd * Math.abs(vFwd) + (edgeScrub + brakeDrag) * Math.max(0, vFwd) * 0.55;
      if (vFwd > 0) {
        vFwd = Math.max(0, vFwd - totalDecel * dt);
      } else {
        vFwd = Math.min(0, vFwd + totalDecel * dt);
      }

      // Gentle pole-push propulsion if almost stopped so you never get stuck on a mild shelf
      if (vFwd < 3.5 && !input.brake) {
        vFwd += (input.tuck ? 5.2 : 2.8) * dt;
      }

      // Edge grip kills lateral skidding cleanly on snow (slightly looser drift on cyan glacier ice!)
      const lateralGrip = this.onGlacier ? 3.8 : 7.6;
      vLat += gLat * dt;
      vLat *= Math.exp(-lateralGrip * dt);

      // Reconstruct world XZ velocity
      this.vel.x = fwdX * vFwd + rightX * vLat;
      this.vel.z = fwdZ * vFwd + rightZ * vLat;

      // Clamp blistering terminal speed (~142 km/h in a steep Mont Blanc tuck!)
      const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
      const maxSpeed = 40.5;
      if (horizSpeed > maxSpeed) {
        const s = maxSpeed / horizSpeed;
        this.vel.x *= s;
        this.vel.z *= s;
      }

      // Compute vertical velocity matching current slope tangent
      const slopeTanY = -(normal.x * this.vel.x + normal.z * this.vel.z) / Math.max(0.25, normal.y);
      this.vel.y = slopeTanY;

      // Jump!
      if (input.jump && this.jumpCooldown <= 0) {
        this.grounded = false;
        this.vel.y = Math.max(slopeTanY, 0) + 7.6;
        this.jumpCooldown = 0.45;
        this.airTime = 0;
        this.justJumped = true;
      }
    } else {
      // Airborne ballistics!
      this.vel.y -= 17.5 * dt;
      // Very slight air drag
      this.vel.x *= Math.exp(-0.08 * dt);
      this.vel.z *= Math.exp(-0.08 * dt);
      this.airTime += dt;
      if (this.airTime > this.maxAirTime) {
        this.maxAirTime = this.airTime;
      }
    }

    // Integrate position
    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // Keep safely inside Mont Blanc DEM world bounds
    const maxX = this.terrain.worldWidth * 0.47;
    const maxZ = this.terrain.worldDepth * 0.47;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -maxX, maxX);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -maxZ, maxZ);

    this.distanceSkied += Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);

    // Terrain ground contact & natural crest air-time
    const groundY = this.terrain.getHeightAt(this.pos.x, this.pos.z);
    if (this.grounded) {
      const gap = this.pos.y - groundY;
      // Launch naturally off steep terrain rollovers at high speed!
      if (gap > 0.65 && this.speed > 18) {
        this.grounded = false;
        this.airTime = 0;
      } else {
        this.pos.y = groundY;
      }
    } else {
      if (this.pos.y <= groundY) {
        this.pos.y = groundY;
        this.grounded = true;
        if (this.airTime > 0.22) {
          this.landingCompression = Math.min(0.42, 0.14 + this.airTime * 0.18);
          this.justLandedIntensity = Math.min(1, this.airTime * 0.75);
          this._emitSpray(this.pos.x, groundY, this.pos.z, this.vel.x * 0.3, 1.8, this.vel.z * 0.3, 18);
        }
        this.airTime = 0;
      }
    }

    this.airHeight = Math.max(0, this.pos.y - groundY);
    this.landingCompression = THREE.MathUtils.lerp(this.landingCompression, 0, Math.min(1, dt * 8));

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // Display realistic Alpine ski speed (km/h, scaled gently for thrilling readability)
    this.speedKmh = this.speed * 3.6;
    if (this.speedKmh > this.topSpeedKmh) {
      this.topSpeedKmh = this.speedKmh;
    }

    // Carving intensity (for audio + snow spray + avalanche triggering)
    this.carveIntensity = this.grounded
      ? THREE.MathUtils.clamp((Math.abs(this.edgeAngle) * 0.85 + this.brakeAmount * 1.1) * (this.speed / 16), 0, 1.5)
      : 0;

    // Kick up rooster-tail powder spray when carving or braking
    if (this.grounded && this.carveIntensity > 0.22 && this.speed > 6) {
      const sideDir = this.edgeAngle >= 0 ? -1 : 1; // spray shoots to outer edge of carve
      const sx = this.pos.x + rightX * sideDir * 0.35;
      const sz = this.pos.z + rightZ * sideDir * 0.35;
      const sprayVx = rightX * sideDir * (3.2 + this.carveIntensity * 3.5) + this.vel.x * 0.35;
      const sprayVz = rightZ * sideDir * (3.2 + this.carveIntensity * 3.5) + this.vel.z * 0.35;
      this._emitSpray(sx, this.pos.y, sz, sprayVx, 1.5 + this.carveIntensity * 1.6, sprayVz, this.brakeAmount > 0.4 ? 5 : 3);
    }

    // Paint carved twin grooves onto the snow track maps!
    tracks.stampSkis(
      this.pos.x,
      this.pos.z,
      this.yaw,
      this.speed,
      this.edgeAngle,
      this.brakeAmount > 0.35,
      this.grounded
    );

    // Check collisions with pine trees & granite boulders (when near ground)
    if (this.airHeight < 2.2) {
      const hit = environment.checkCollision(this.pos.x, this.pos.z, 0.65);
      if (hit) {
        if (this.speed > 11.5) {
          this.triggerCrash(`Hit a ${hit.type} at ${Math.round(this.speedKmh)} km/h`);
        } else {
          // Gentle glancing push at low speed
          const awayX = this.pos.x - hit.x;
          const awayZ = this.pos.z - hit.z;
          const d = Math.hypot(awayX, awayZ) || 1;
          const push = hit.radius + 0.72 - d;
          if (push > 0) {
            this.pos.x += (awayX / d) * push;
            this.pos.z += (awayZ / d) * push;
          }
          this.vel.x *= 0.65;
          this.vel.z *= 0.65;
        }
      }
    }

    this._updateSpray(dt);
    this.syncCameraAndRig(dt, true);
  }

  /**
   * Align first-person camera and visible skis/poles to terrain slope, carve roll, and tuck posture.
   */
  syncCameraAndRig(dt, animate = true) {
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);

    // Sample slope 10m ahead to pitch camera naturally down Mont Blanc while showcasing towering peaks & sky
    const aheadY = this.terrain.getHeightAt(this.pos.x + fwdX * 10.0, this.pos.z + fwdZ * 10.0);
    const currY = this.terrain.getHeightAt(this.pos.x, this.pos.z);
    const rawSlopePitch = Math.atan2(aheadY - currY, 10.0);
    // Keep horizon comfortably in upper-middle third so peaks, sunset clouds, AND skis/tracks are all framed!
    const targetPitch = THREE.MathUtils.clamp(rawSlopePitch * 0.52 + 0.03, -0.34, 0.22);

    this.smoothPitch = animate
      ? THREE.MathUtils.lerp(this.smoothPitch, targetPitch, Math.min(1, dt * 6.5))
      : targetPitch;

    const targetRoll = this.crashed
      ? Math.sin(this.crashTimer * 6.5) * 0.95 + this.crashSpin * Math.min(0.6, this.crashTimer)
      : -this.edgeAngle * (0.14 + Math.min(0.10, this.speed * 0.003));
    this.smoothRoll = animate
      ? THREE.MathUtils.lerp(this.smoothRoll, targetRoll, Math.min(1, dt * 8.5))
      : targetRoll;

    // Head height drops in aero tuck and dips slightly on jump landings
    const eyeHeight =
      THREE.MathUtils.lerp(1.66, 1.12, this.tuckAmount) -
      this.landingCompression -
      (this.crashed ? Math.min(1.05, this.crashTimer * 2.2) : 0);

    // Subtle high-speed snow vibration micro-shake
    const vib =
      this.grounded && !this.crashed && this.speed > 10
        ? Math.sin(performance.now() * 0.045) * Math.min(0.022, (this.speed - 10) * 0.0008)
        : 0;

    this.camPos.set(this.pos.x, this.pos.y + Math.max(0.45, eyeHeight) + vib, this.pos.z);
    this.camera.position.copy(this.camPos);

    // Dynamic FOV widens smoothly with speed for visceral rush
    const targetFov = 72 + THREE.MathUtils.clamp((this.speedKmh - 35) * 0.22, 0, 20) + this.tuckAmount * 4.5;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 5));
    this.camera.updateProjectionMatrix();

    // Build camera orientation (Yaw -> Pitch -> Roll)
    _euler.set(this.smoothPitch, this.yaw + Math.PI, this.smoothRoll, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);

    // Position the procedural first-person skis + poles rig cleanly at the skier's feet
    this.rig.position.set(this.pos.x, this.pos.y + 0.05, this.pos.z);
    this.rig.rotation.set(0, this.yaw, 0);
    this.rig.visible = !this.crashed;

    // Pitch skis to terrain slope (rig local +Z is forward, so downhill nose-down is +X rotation)
    const skiPitch = this.grounded ? -rawSlopePitch : 0.14;
    const brakeYaw = this.brakeAmount * 0.24;
    const skiEdgeRoll = this.edgeAngle * 0.36;

    this.skisGroup.rotation.x = THREE.MathUtils.lerp(this.skisGroup.rotation.x, skiPitch, Math.min(1, dt * 12));
    this.leftSki.rotation.z = skiEdgeRoll;
    this.rightSki.rotation.z = skiEdgeRoll;
    this.leftSki.rotation.y = brakeYaw;
    this.rightSki.rotation.y = -brakeYaw;
    // Place skis forward so upturned red/white ski tips & front bindings frame the lower center cleanly
    this.skisGroup.position.set(0, 0.12, 1.18);

    // Animate ski poles naturally in lower-left & lower-right hands, shafts angling forward & outward toward snow
    const poleY = THREE.MathUtils.lerp(0.76, 0.56, this.tuckAmount) - this.landingCompression * 0.45;
    const poleZ = THREE.MathUtils.lerp(0.78, 0.54, this.tuckAmount);
    const polePitch = THREE.MathUtils.lerp(-0.92, -1.28, this.tuckAmount) + (this.grounded ? 0 : 0.25);
    const swing = this.edgeAngle * 0.15;

    this.leftPole.position.set(-0.62 - this.tuckAmount * 0.05, poleY, poleZ + swing * 0.12);
    this.leftPole.rotation.set(polePitch + swing, -0.18, -0.32 - this.edgeAngle * 0.10);

    this.rightPole.position.set(0.62 + this.tuckAmount * 0.05, poleY, poleZ - swing * 0.12);
    this.rightPole.rotation.set(polePitch - swing, 0.18, 0.32 - this.edgeAngle * 0.10);
  }
}

const _tmpNormal = new THREE.Vector3();
const _euler = new THREE.Euler();
