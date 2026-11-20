import * as THREE from 'three';

/**
 * Dual-cascade carved snow track map:
 *   1. Near high-res rolling track map (512x512 over 110m x 110m -> ~21cm/texel)
 *      Shows crisp twin ski grooves, snow berms on hard carves, and pole marks right around you.
 *   2. Persistent mountain corridor map (1024x1024 over the entire Bossons run bounding box)
 *      Permanently preserves your carved S-turns and avalanche scour trails across the entire run.
 *
 * Channel encoding (RGB):
 *   R = recessed groove depth (ambient occlusion + shadow inside ski track)
 *   G = displaced snow berm / lip along carving edges (catches bright sun highlight)
 *   B = avalanche scour / disturbed powder roughness
 */
export class SnowTrackSystem {
  constructor(meta) {
    // Persistent corridor bounds covering the Bossons ski run with generous freeride margin
    this.farMinX = -1550;
    this.farMaxX = 950;
    this.farMinZ = -1750;
    this.farMaxZ = 2450;

    this.farSize = 1024;
    this.farCanvas = document.createElement('canvas');
    this.farCanvas.width = this.farSize;
    this.farCanvas.height = this.farSize;
    this.farCtx = this.farCanvas.getContext('2d', { alpha: false });
    this.farTexture = new THREE.CanvasTexture(this.farCanvas);
    this.farTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.farTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.farTexture.minFilter = THREE.LinearFilter;
    this.farTexture.magFilter = THREE.LinearFilter;
    this.farTexture.generateMipmaps = false;

    // Rolling high-resolution near window centered around the skier
    this.nearSize = 512;
    this.nearSpan = 105; // meters
    this.nearCenterX = meta.start.x;
    this.nearCenterZ = meta.start.z;

    this.nearCanvas = document.createElement('canvas');
    this.nearCanvas.width = this.nearSize;
    this.nearCanvas.height = this.nearSize;
    this.nearCtx = this.nearCanvas.getContext('2d', { alpha: false });
    this.nearTexture = new THREE.CanvasTexture(this.nearCanvas);
    this.nearTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.nearTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.nearTexture.minFilter = THREE.LinearFilter;
    this.nearTexture.magFilter = THREE.LinearFilter;
    this.nearTexture.generateMipmaps = false;

    this.segments = [];
    this.maxSegments = 480;
    this.lastPos = null;
    this.nearDirty = false;
    this.farDirty = false;

    this.clear(meta.start.x, meta.start.z);
  }

  clear(startX = 0, startZ = 0) {
    this.segments.length = 0;
    this.lastPos = null;
    this.nearCenterX = startX;
    this.nearCenterZ = startZ;

    this.farCtx.fillStyle = '#000000';
    this.farCtx.fillRect(0, 0, this.farSize, this.farSize);
    this.nearCtx.fillStyle = '#000000';
    this.nearCtx.fillRect(0, 0, this.nearSize, this.nearSize);

    this.farTexture.needsUpdate = true;
    this.nearTexture.needsUpdate = true;
    this.nearDirty = false;
    this.farDirty = false;
  }

  getFarBoundsVec4(target = new THREE.Vector4()) {
    return target.set(
      this.farMinX,
      this.farMinZ,
      1.0 / (this.farMaxX - this.farMinX),
      1.0 / (this.farMaxZ - this.farMinZ)
    );
  }

  getNearBoundsVec4(target = new THREE.Vector4()) {
    const half = this.nearSpan * 0.5;
    return target.set(
      this.nearCenterX - half,
      this.nearCenterZ - half,
      1.0 / this.nearSpan,
      1.0 / this.nearSpan
    );
  }

  _worldToNear(x, z) {
    const half = this.nearSpan * 0.5;
    return [
      ((x - (this.nearCenterX - half)) / this.nearSpan) * this.nearSize,
      ((z - (this.nearCenterZ - half)) / this.nearSpan) * this.nearSize,
    ];
  }

  _worldToFar(x, z) {
    return [
      ((x - this.farMinX) / (this.farMaxX - this.farMinX)) * this.farSize,
      ((z - this.farMinZ) / (this.farMaxZ - this.farMinZ)) * this.farSize,
    ];
  }

  _drawSegmentOnNear(seg) {
    const ctx = this.nearCtx;
    const [lx0, lz0] = this._worldToNear(seg.lx0, seg.lz0);
    const [lx1, lz1] = this._worldToNear(seg.lx1, seg.lz1);
    const [rx0, rz0] = this._worldToNear(seg.rx0, seg.rz0);
    const [rx1, rz1] = this._worldToNear(seg.rx1, seg.rz1);

    // Quick reject if outside near canvas
    const margin = 20;
    if (
      (lx0 < -margin && lx1 < -margin) ||
      (lx0 > this.nearSize + margin && lx1 > this.nearSize + margin) ||
      (lz0 < -margin && lz1 < -margin) ||
      (lz0 > this.nearSize + margin && lz1 > this.nearSize + margin)
    ) {
      return;
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    const pxPerMeter = this.nearSize / this.nearSpan;
    const grooveW = Math.max(1.5, seg.width * pxPerMeter);
    const depthAlpha = Math.min(0.95, seg.depth);

    // Subtle snow berm / displaced powder lip (Green channel) slightly wider than groove
    const bermAlpha = Math.min(0.85, seg.berm);
    if (bermAlpha > 0.04) {
      ctx.strokeStyle = `rgba(0, ${Math.round(bermAlpha * 190)}, 0, 0.72)`;
      ctx.lineWidth = grooveW * 2.4;
      ctx.beginPath();
      ctx.moveTo(lx0, lz0);
      ctx.lineTo(lx1, lz1);
      ctx.moveTo(rx0, rz0);
      ctx.lineTo(rx1, rz1);
      ctx.stroke();
    }

    // Crisp twin ski grooves (Red channel)
    ctx.strokeStyle = `rgba(${Math.round(depthAlpha * 235)}, 0, 0, 0.88)`;
    ctx.lineWidth = grooveW;
    ctx.beginPath();
    ctx.moveTo(lx0, lz0);
    ctx.lineTo(lx1, lz1);
    ctx.moveTo(rx0, rz0);
    ctx.lineTo(rx1, rz1);
    ctx.stroke();

    ctx.globalCompositeOperation = 'source-over';
  }

  _drawSegmentOnFar(seg) {
    const ctx = this.farCtx;
    const [x0, z0] = this._worldToFar(seg.cx0, seg.cz0);
    const [x1, z1] = this._worldToFar(seg.cx1, seg.cz1);
    if (x0 < 0 || x0 > this.farSize || z0 < 0 || z0 > this.farSize) return;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const d = Math.round(Math.min(1, seg.depth) * 190);
    const b = Math.round(Math.min(1, seg.berm) * 120);
    ctx.strokeStyle = `rgba(${d}, ${b}, 0, 0.75)`;
    ctx.lineWidth = Math.max(1.3, 1.3 + seg.berm * 1.4);
    ctx.beginPath();
    ctx.moveTo(x0, z0);
    ctx.lineTo(x1, z1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  _recenterNear(x, z) {
    this.nearCenterX = x;
    this.nearCenterZ = z;
    this.nearCtx.fillStyle = '#000000';
    this.nearCtx.fillRect(0, 0, this.nearSize, this.nearSize);
    for (let i = 0; i < this.segments.length; i++) {
      this._drawSegmentOnNear(this.segments[i]);
    }
    this.nearDirty = true;
  }

  /**
   * Paint the skier's twin ski grooves for this frame.
   */
  stampSkis(x, z, yaw, speed, edgeAngle, braking, grounded) {
    if (!grounded) {
      this.lastPos = null;
      return;
    }

    // Recenter rolling high-res track window when skier gets within 24m of edge
    if (
      Math.abs(x - this.nearCenterX) > this.nearSpan * 0.24 ||
      Math.abs(z - this.nearCenterZ) > this.nearSpan * 0.24
    ) {
      this._recenterNear(x, z);
    }

    if (!this.lastPos) {
      this.lastPos = { x, z, yaw };
      return;
    }

    const dx = x - this.lastPos.x;
    const dz = z - this.lastPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.22) return;
    if (dist > 18) {
      // Skier teleported / restarted
      this.lastPos = { x, z, yaw };
      return;
    }

    // Perpendicular right vector for twin ski spacing
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const prevRightX = Math.cos(this.lastPos.yaw);
    const prevRightZ = -Math.sin(this.lastPos.yaw);

    const stance = 0.26 + (braking ? 0.10 : 0.0);
    const absEdge = Math.abs(edgeAngle);

    const seg = {
      cx0: this.lastPos.x,
      cz0: this.lastPos.z,
      cx1: x,
      cz1: z,
      lx0: this.lastPos.x - prevRightX * stance,
      lz0: this.lastPos.z - prevRightZ * stance,
      lx1: x - rightX * stance,
      lz1: z - rightZ * stance,
      rx0: this.lastPos.x + prevRightX * stance,
      rz0: this.lastPos.z + prevRightZ * stance,
      rx1: x + rightX * stance,
      rz1: z + rightZ * stance,
      width: 0.20 + absEdge * 0.24 + (braking ? 0.34 : 0),
      depth: 0.55 + absEdge * 0.38 + (braking ? 0.35 : 0) + Math.min(0.2, speed * 0.006),
      berm: absEdge * 0.75 + (braking ? 0.85 : 0.15),
    };

    this.segments.push(seg);
    if (this.segments.length > this.maxSegments) {
      this.segments.shift();
    }

    this._drawSegmentOnNear(seg);
    this._drawSegmentOnFar(seg);
    this.nearDirty = true;
    this.farDirty = true;

    this.lastPos.x = x;
    this.lastPos.z = z;
    this.lastPos.yaw = yaw;
  }

  /**
   * Stamp wide disturbed avalanche scour trail onto the snowpack.
   */
  stampAvalancheTrail(x, z, radius) {
    const [fx, fz] = this._worldToFar(x, z);
    const farPx = Math.max(2, (radius / (this.farMaxX - this.farMinX)) * this.farSize);
    this.farCtx.globalCompositeOperation = 'lighter';
    this.farCtx.fillStyle = 'rgba(42, 30, 140, 0.28)';
    this.farCtx.beginPath();
    this.farCtx.arc(fx, fz, farPx, 0, Math.PI * 2);
    this.farCtx.fill();
    this.farCtx.globalCompositeOperation = 'source-over';
    this.farDirty = true;

    const [nx, nz] = this._worldToNear(x, z);
    const nearPx = (radius / this.nearSpan) * this.nearSize;
    if (nx > -nearPx && nx < this.nearSize + nearPx && nz > -nearPx && nz < this.nearSize + nearPx) {
      this.nearCtx.globalCompositeOperation = 'lighter';
      this.nearCtx.fillStyle = 'rgba(55, 38, 160, 0.22)';
      this.nearCtx.beginPath();
      this.nearCtx.arc(nx, nz, nearPx, 0, Math.PI * 2);
      this.nearCtx.fill();
      this.nearCtx.globalCompositeOperation = 'source-over';
      this.nearDirty = true;
    }
  }

  flush() {
    if (this.nearDirty) {
      this.nearTexture.needsUpdate = true;
      this.nearDirty = false;
    }
    if (this.farDirty) {
      this.farTexture.needsUpdate = true;
      this.farDirty = false;
    }
  }
}
