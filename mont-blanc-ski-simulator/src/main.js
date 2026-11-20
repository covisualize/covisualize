import * as THREE from 'three';
import { AlpineSky } from './sky.js';
import { SnowTrackSystem } from './tracks.js';
import { MontBlancTerrain } from './terrain.js';
import { AlpineEnvironment } from './environment.js';
import { SkierController } from './skier.js';
import { AvalancheSystem } from './avalanche.js';
import { AlpineAudio } from './audio.js';

const BEST_TIME_KEY = 'mont_blanc_ski_best_time_v1';

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '--:--.-';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec * 10) % 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

class MontBlancGame {
  constructor() {
    this.state = 'loading'; // loading | menu | playing | crashed | finished
    this.runTime = 0;
    this.bestTime = this._loadBestTime();
    this.menuOrbitAngle = 0;
    this.totalDropM = 2119;

    // Input state
    this.keys = new Set();
    this.touch = { left: false, right: false, tuck: false, brake: false, jump: false };
    this.tiltEnabled = false;
    this.tiltSteer = 0;

    // Speed-lines / radial motion blur canvas
    this.speedCanvas = document.getElementById('speed-blur-canvas');
    this.speedCtx = this.speedCanvas.getContext('2d');

    // Cache DOM nodes
    this.ui = {
      loading: document.getElementById('loading-overlay'),
      loadingText: document.getElementById('loading-text'),
      startOverlay: document.getElementById('start-overlay'),
      hud: document.getElementById('hud'),
      crashOverlay: document.getElementById('crash-overlay'),
      finishOverlay: document.getElementById('finish-overlay'),
      whiteout: document.getElementById('whiteout-overlay'),

      btnStart: document.getElementById('btn-start'),
      btnTilt: document.getElementById('btn-tilt'),
      btnRetryCrash: document.getElementById('btn-retry-crash'),
      btnPlayAgain: document.getElementById('btn-play-again'),
      btnMute: document.getElementById('btn-mute'),
      btnRestartHud: document.getElementById('btn-restart-hud'),
      btnAvalancheHud: document.getElementById('btn-avalanche-hud'),

      todSlider: document.getElementById('tod-slider'),
      todSliderStart: document.getElementById('tod-slider-start'),
      todLabel: document.getElementById('tod-label'),
      todLabelStart: document.getElementById('tod-label-start'),
      todPresets: document.querySelectorAll('[data-tod]'),

      speedVal: document.getElementById('hud-speed'),
      elevVal: document.getElementById('hud-elev'),
      timerVal: document.getElementById('hud-timer'),
      bestVal: document.getElementById('hud-best'),
      startBestVal: document.getElementById('start-best-time'),
      progressBar: document.getElementById('hud-progress-fill'),
      distVal: document.getElementById('hud-dist'),
      surfaceTag: document.getElementById('hud-surface'),
      avBanner: document.getElementById('avalanche-banner'),
      avDist: document.getElementById('avalanche-dist'),
      toast: document.getElementById('event-toast'),
      fpsVal: document.getElementById('hud-fps'),

      crashReason: document.getElementById('crash-reason'),
      crashStats: document.getElementById('crash-stats'),

      finishTime: document.getElementById('finish-time'),
      finishBestBadge: document.getElementById('finish-best-badge'),
      finishTopSpeed: document.getElementById('finish-top-speed'),
      finishMaxAir: document.getElementById('finish-max-air'),
      finishAvalanches: document.getElementById('finish-avalanches'),

      touchControls: document.getElementById('touch-controls'),
    };

    // FPS tracking
    this.fpsFrames = 0;
    this.fpsAccum = 0;
    this.toastTimer = 0;

    this._initRenderer();
    this._bindEvents();
    this._boot();
  }

  _loadBestTime() {
    try {
      const v = Number(localStorage.getItem(BEST_TIME_KEY));
      return Number.isFinite(v) && v > 5 ? v : null;
    } catch {
      return null;
    }
  }

  _saveBestTime(sec) {
    this.bestTime = sec;
    try {
      localStorage.setItem(BEST_TIME_KEY, String(sec));
    } catch {
      // Ignore private-mode storage errors
    }
  }

  _initRenderer() {
    const container = document.getElementById('canvas-container');
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.15, 22000);
    this.audio = new AlpineAudio();

    this._resizeSpeedCanvas();
  }

  _resizeSpeedCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.speedCanvas.width = Math.floor(window.innerWidth * dpr);
    this.speedCanvas.height = Math.floor(window.innerHeight * dpr);
  }

  async _boot() {
    try {
      this.ui.loadingText.textContent = 'Loading real Chamonix / Mont Blanc elevation data…';
      this.terrain = new MontBlancTerrain();
      this.meta = await this.terrain.load('./data');

      this.totalDropM = Math.max(100, this.meta.start.elevM - this.meta.finish.elevM);

      this.ui.loadingText.textContent = 'Sculpting Mont Blanc peaks, glacier ice & alpine forest…';
      this.sky = new AlpineSky(this.scene);
      this.tracks = new SnowTrackSystem(this.meta);
      this.terrain.buildMeshes(this.scene, this.sky, this.tracks);
      this.environment = new AlpineEnvironment(this.scene, this.terrain, this.meta);
      this.skier = new SkierController(this.scene, this.camera, this.terrain, this.meta);
      this.avalanche = new AvalancheSystem(this.scene, this.terrain, this.meta);

      // Start with dramatic Pink Sunset / Alpenglow lighting (instant showcase of Mont Blanc)
      this._setTimeOfDay(0.84);

      this._updateBestDisplays();
      this.ui.loading.classList.add('hidden');
      this.ui.startOverlay.classList.remove('hidden');
      this.state = 'menu';

      // Show mobile touch controls automatically on touch devices
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        this.ui.touchControls.classList.add('touch-available');
      }

      this.lastFrameTime = performance.now();
      requestAnimationFrame((t) => this._loop(t));
    } catch (err) {
      console.error(err);
      this.ui.loadingText.textContent = `Could not load Mont Blanc terrain data: ${err.message}`;
    }
  }

  _setTimeOfDay(val) {
    const t = THREE.MathUtils.clamp(Number(val), 0, 1);
    if (this.sky) this.sky.setTimeOfDay(t);
    this.ui.todSlider.value = String(t);
    this.ui.todSliderStart.value = String(t);
    const label = this.sky ? this.sky.getTimeLabel() : 'Pink Sunset';
    this.ui.todLabel.textContent = label;
    this.ui.todLabelStart.textContent = label;

    this.ui.todPresets.forEach((btn) => {
      const target = Number(btn.dataset.tod);
      btn.classList.toggle('active', Math.abs(target - t) < 0.06);
    });
  }

  _updateBestDisplays() {
    const txt = this.bestTime ? formatTime(this.bestTime) : '--:--.-';
    this.ui.bestVal.textContent = txt;
    this.ui.startBestVal.textContent = txt;
  }

  _showToast(message, duration = 2.6) {
    this.ui.toast.textContent = message;
    this.ui.toast.classList.add('visible');
    this.toastTimer = duration;
  }

  startRun() {
    this.audio.init();
    this.tracks.clear(this.meta.start.x, this.meta.start.z);
    this.skier.reset();
    this.avalanche.reset();
    this.terrain.updateDetailPatch(this.skier.pos.x, this.skier.pos.z, true);

    this.runTime = 0;
    this.state = 'playing';

    this.ui.startOverlay.classList.add('hidden');
    this.ui.crashOverlay.classList.add('hidden');
    this.ui.finishOverlay.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.ui.avBanner.classList.add('hidden');

    this._showToast('GLACIER DES BOSSONS  •  3,316 m — DROP IN!', 2.5);
  }

  _finishRun() {
    this.state = 'finished';
    this.audio.playFinish();

    const isNewBest = !this.bestTime || this.runTime < this.bestTime;
    if (isNewBest) {
      this._saveBestTime(this.runTime);
      this._updateBestDisplays();
    }

    this.ui.finishTime.textContent = formatTime(this.runTime);
    this.ui.finishBestBadge.classList.toggle('hidden', !isNewBest);
    this.ui.finishTopSpeed.textContent = `${Math.round(this.skier.topSpeedKmh)} km/h`;
    this.ui.finishMaxAir.textContent = `${this.skier.maxAirTime.toFixed(1)} s`;
    this.ui.finishAvalanches.textContent = String(this.avalanche.avalanchesOutrun);

    this.ui.avBanner.classList.add('hidden');
    this.ui.finishOverlay.classList.remove('hidden');
  }

  async _enableTiltControls() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      this._showToast('Tilt sensor not available on this device');
      return;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          this._showToast('Motion sensor permission denied');
          return;
        }
      }
      this.tiltEnabled = !this.tiltEnabled;
      this.ui.btnTilt.textContent = this.tiltEnabled ? 'Tilt Steering: ON' : 'Enable Phone Tilt';
      this.ui.btnTilt.classList.toggle('active', this.tiltEnabled);
    } catch {
      this._showToast('Could not enable tilt steering');
    }
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this._resizeSpeedCanvas();
    });

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);

      if (e.code === 'KeyR' && (this.state === 'playing' || this.state === 'crashed' || this.state === 'finished')) {
        this.startRun();
      } else if (e.code === 'KeyV' && this.state === 'playing') {
        if (this.avalanche.triggerNearSkier(this.skier.pos)) {
          this.audio.playAvalancheCrack();
          this._showToast('SLAB FRACTURE — AVALANCHE BEHIND YOU!', 2.6);
        }
      } else if ((e.code === 'Enter' || e.code === 'Space') && this.state === 'menu') {
        this.startRun();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // Phone tilt steering (works in both portrait and landscape)
    window.addEventListener('deviceorientation', (e) => {
      if (!this.tiltEnabled || e.gamma == null || e.beta == null) return;
      const isLandscape = window.innerWidth > window.innerHeight;
      const rawAngle = isLandscape ? e.beta : e.gamma;
      // Deadzone ±4 deg, full carve at ±28 deg
      const sign = Math.sign(rawAngle);
      const mag = Math.max(0, Math.abs(rawAngle) - 4) / 24;
      this.tiltSteer = THREE.MathUtils.clamp(sign * mag, -1, 1);
    });

    // UI button bindings
    this.ui.btnStart.addEventListener('click', () => this.startRun());
    this.ui.btnRetryCrash.addEventListener('click', () => this.startRun());
    this.ui.btnPlayAgain.addEventListener('click', () => this.startRun());
    this.ui.btnRestartHud.addEventListener('click', () => this.startRun());
    this.ui.btnTilt.addEventListener('click', () => this._enableTiltControls());

    this.ui.btnAvalancheHud.addEventListener('click', () => {
      if (this.state === 'playing' && this.avalanche.triggerNearSkier(this.skier.pos)) {
        this.audio.playAvalancheCrack();
        this._showToast('SLAB FRACTURE — OUTRUN THE AVALANCHE!', 2.6);
      }
    });

    this.ui.btnMute.addEventListener('click', () => {
      this.audio.init();
      this.audio.setMuted(!this.audio.muted);
      this.ui.btnMute.textContent = this.audio.muted ? 'Sound: Off' : 'Sound: On';
    });

    // Time-of-day sliders & presets
    this.ui.todSlider.addEventListener('input', (e) => this._setTimeOfDay(e.target.value));
    this.ui.todSliderStart.addEventListener('input', (e) => this._setTimeOfDay(e.target.value));
    this.ui.todPresets.forEach((btn) => {
      btn.addEventListener('click', () => this._setTimeOfDay(btn.dataset.tod));
    });

    // On-screen mobile touch controls
    const bindTouchBtn = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      const onDown = (e) => {
        e.preventDefault();
        this.touch[key] = true;
        el.classList.add('pressed');
      };
      const onUp = (e) => {
        e.preventDefault();
        this.touch[key] = false;
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointerleave', onUp);
      el.addEventListener('pointercancel', onUp);
    };
    bindTouchBtn('touch-left', 'left');
    bindTouchBtn('touch-right', 'right');
    bindTouchBtn('touch-tuck', 'tuck');
    bindTouchBtn('touch-brake', 'brake');
    bindTouchBtn('touch-jump', 'jump');
  }

  _gatherInput() {
    let steer = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA') || this.touch.left) steer -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD') || this.touch.right) steer += 1;
    if (steer === 0 && this.tiltEnabled) steer = this.tiltSteer;

    const tuck = this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.touch.tuck;
    const brake = this.keys.has('ArrowDown') || this.keys.has('KeyS') || this.touch.brake;
    const jump = this.keys.has('Space') || this.touch.jump;

    return { steer, tuck, brake, jump };
  }

  /**
   * Subtle radial speed-blur streaks along viewport edges when flying fast (>68 km/h).
   */
  _drawSpeedBlur(speedKmh) {
    const ctx = this.speedCtx;
    const w = this.speedCanvas.width;
    const h = this.speedCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this.state !== 'playing' || speedKmh < 65) return;

    const intensity = THREE.MathUtils.clamp((speedKmh - 65) / 68, 0, 1);
    const cx = w * 0.5;
    const cy = h * 0.52;
    const maxR = Math.hypot(cx, cy);
    const lineCount = Math.floor(18 + intensity * 30);
    const t = performance.now() * 0.012;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.08 + intensity * 0.22).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, 1.8 * intensity);
    ctx.beginPath();

    for (let i = 0; i < lineCount; i++) {
      const ang = (i / lineCount) * Math.PI * 2 + Math.sin(t + i * 3.1) * 0.04;
      const phase = ((t * 0.7 + i * 0.37) % 1);
      const r0 = maxR * (0.58 + phase * 0.26);
      const r1 = r0 + maxR * (0.10 + intensity * 0.16);
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    }
    ctx.stroke();

    // Subtle crisp vignette rush at extreme speed
    const grad = ctx.createRadialGradient(cx, cy, maxR * 0.48, cx, cy, maxR);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, `rgba(220,236,255,${(intensity * 0.14).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  _updateHud(dt) {
    const elevM = Math.round(this.terrain.getElevationMeters(this.skier.pos.x, this.skier.pos.z));
    this.ui.speedVal.textContent = String(Math.round(this.skier.speedKmh));
    this.ui.elevVal.textContent = `${elevM.toLocaleString()} m`;
    this.ui.timerVal.textContent = formatTime(this.runTime);

    const distToFinish = Math.hypot(
      this.skier.pos.x - this.meta.finish.x,
      this.skier.pos.z - this.meta.finish.z
    );
    const dropFrac = THREE.MathUtils.clamp(
      (this.meta.start.elevM - elevM) / this.totalDropM,
      0,
      1
    );
    this.ui.progressBar.style.width = `${(dropFrac * 100).toFixed(1)}%`;
    this.ui.distVal.textContent = `${Math.max(0, Math.round(distToFinish / this.meta.worldScale)).toLocaleString()} m to Chamonix`;

    // Dynamic surface badge
    if (!this.skier.grounded && this.skier.airTime > 0.12) {
      this.ui.surfaceTag.textContent = `AIRTIME ${this.skier.airTime.toFixed(1)}s`;
      this.ui.surfaceTag.dataset.mode = 'air';
    } else if (this.skier.onGlacier) {
      this.ui.surfaceTag.textContent = 'GLACIER ICE';
      this.ui.surfaceTag.dataset.mode = 'ice';
    } else if (this.skier.tuckAmount > 0.6) {
      this.ui.surfaceTag.textContent = 'AERO TUCK';
      this.ui.surfaceTag.dataset.mode = 'tuck';
    } else if (this.skier.brakeAmount > 0.5) {
      this.ui.surfaceTag.textContent = 'EDGE BRAKE';
      this.ui.surfaceTag.dataset.mode = 'brake';
    } else {
      this.ui.surfaceTag.textContent = `POWDER • ${Math.round(this.skier.slopeDeg)}°`;
      this.ui.surfaceTag.dataset.mode = 'snow';
    }

    // Avalanche proximity warning banner + powder whiteout overlay
    if (this.avalanche.active) {
      this.ui.avBanner.classList.remove('hidden');
      this.ui.avDist.textContent = `${Math.round(this.avalanche.distToSkier)} m`;
    } else {
      this.ui.avBanner.classList.add('hidden');
    }
    this.ui.whiteout.style.opacity = String(this.avalanche.whiteoutIntensity.toFixed(3));

    // Toast fadeout
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.ui.toast.classList.remove('visible');
      }
    }
  }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    // FPS counter
    this.fpsFrames++;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      this.ui.fpsVal.textContent = `${Math.round(this.fpsFrames / this.fpsAccum)} FPS`;
      this.fpsFrames = 0;
      this.fpsAccum = 0;
    }

    if (this.state === 'menu') {
      // Sweeping scenic alpine camera looking down Glacier des Bossons with Mont Blanc & Aiguille du Midi framing the sky
      this.menuOrbitAngle += dt * 0.14;
      const sx = this.meta.start.x;
      const sz = this.meta.start.z;
      const sy = this.terrain.getHeightAt(sx, sz);

      const camX = sx + Math.sin(this.menuOrbitAngle) * 140;
      const camZ = sz + 115 + Math.cos(this.menuOrbitAngle) * 55;
      const camY = Math.max(this.terrain.getHeightAt(camX, camZ) + 42, sy + 68);
      this.camera.position.set(camX, camY, camZ);
      this.camera.fov = 64;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(sx - 120, sy - 140, sz - 650);

      this.skier.rig.visible = false;
      this.sky.update(dt, this.camera.position);
      this.terrain.updateUniforms(this.sky, this.tracks, this.skier);
      this.audio.update(this.skier, this.avalanche, false);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === 'playing') {
      this.runTime += dt;
      const input = this._gatherInput();
      this.skier.update(dt, input, this.environment, this.tracks);
      this.avalanche.update(dt, this.skier, this.sky, this.tracks);
      this.terrain.updateDetailPatch(this.skier.pos.x, this.skier.pos.z);
      this.tracks.flush();

      // Trigger one-shot audio cues
      if (this.skier.justJumped) this.audio.playJump();
      if (this.skier.justLandedIntensity > 0) this.audio.playLand(this.skier.justLandedIntensity);
      if (this.avalanche.justTriggered) {
        this.audio.playAvalancheCrack();
        this._showToast('AVALANCHE TRIGGERED — TUCK & CARVE OFF THE FALL LINE!', 3.2);
      }
      if (this.avalanche.justOutrun) {
        this._showToast('AVALANCHE OUTRUN!', 2.4);
      }

      // Check wipeout
      if (this.skier.crashed) {
        this.state = 'crashed';
        this.audio.playCrash();
        this.ui.crashReason.textContent = this.skier.crashReason;
        const elevM = Math.round(this.terrain.getElevationMeters(this.skier.pos.x, this.skier.pos.z));
        this.ui.crashStats.textContent = `Time ${formatTime(this.runTime)}  •  Elevation ${elevM.toLocaleString()} m  •  Top speed ${Math.round(this.skier.topSpeedKmh)} km/h`;
        this.ui.avBanner.classList.add('hidden');
        setTimeout(() => {
          if (this.state === 'crashed') this.ui.crashOverlay.classList.remove('hidden');
        }, 650);
      }

      // Check Chamonix Valley finish gate!
      const dFin = Math.hypot(
        this.skier.pos.x - this.meta.finish.x,
        this.skier.pos.z - this.meta.finish.z
      );
      const currElevM = this.terrain.getElevationMeters(this.skier.pos.x, this.skier.pos.z);
      if (!this.skier.crashed && (dFin < this.meta.finish.radius || currElevM <= this.meta.finish.elevM + 10)) {
        this._finishRun();
      }

      this._updateHud(dt);
      this._drawSpeedBlur(this.skier.speedKmh);
    } else if (this.state === 'crashed') {
      this.skier.update(dt, { steer: 0, tuck: false, brake: true, jump: false }, this.environment, this.tracks);
      this.avalanche.update(dt, this.skier, this.sky, this.tracks);
      this.tracks.flush();
      this._drawSpeedBlur(0);
    } else if (this.state === 'finished') {
      // Gentle victory glide-to-stop
      this.skier.update(dt, { steer: 0, tuck: false, brake: true, jump: false }, this.environment, this.tracks);
      this.tracks.flush();
      this._drawSpeedBlur(0);
    }

    this.sky.update(dt, this.skier.pos);
    this.terrain.updateUniforms(this.sky, this.tracks, this.skier);
    this.audio.update(this.skier, this.avalanche, this.state === 'playing');
    this.renderer.render(this.scene, this.camera);
  }
}

new MontBlancGame();
