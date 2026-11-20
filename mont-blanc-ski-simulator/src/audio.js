/**
 * 100% Procedural Web Audio sound engine for Mont Blanc Ski Simulator:
 *  - Dynamic airspeed wind rush & high-speed helmet whistle
 *  - Ski edge carving scrape (warm snow swoosh vs sharp cyan glacier ice hiss)
 *  - Avalanche fracture crack & proximity-scaled sub-bass booming rumble
 *  - Jump whoosh, landing thud, crash impact, and Chamonix finish chime
 */
export class AlpineAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.muted = false;
    this.initialized = false;

    this.windGain = null;
    this.windFilter = null;
    this.carveGain = null;
    this.carveFilter = null;
    this.avGain = null;
    this.avFilter = null;
  }

  init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.72;
    this.masterGain.connect(ctx.destination);

    // Create a reusable 3-second pink/white noise buffer
    const sampleRate = ctx.sampleRate;
    const len = sampleRate * 3;
    const noiseBuf = ctx.createBuffer(1, len, sampleRate);
    const data = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
      b6 = white * 0.115926;
    }

    // 1. Airspeed Wind Channel
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 260;
    this.windFilter.Q.value = 0.85;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windSrc.start();

    // 2. Ski Carving & Edge Scrape Channel
    const carveSrc = ctx.createBufferSource();
    carveSrc.buffer = noiseBuf;
    carveSrc.loop = true;
    this.carveFilter = ctx.createBiquadFilter();
    this.carveFilter.type = 'bandpass';
    this.carveFilter.frequency.value = 1400;
    this.carveFilter.Q.value = 1.6;
    this.carveGain = ctx.createGain();
    this.carveGain.gain.value = 0.0;
    carveSrc.connect(this.carveFilter);
    this.carveFilter.connect(this.carveGain);
    this.carveGain.connect(this.masterGain);
    carveSrc.start();

    // 3. Avalanche Deep Rumble Channel
    const avSrc = ctx.createBufferSource();
    avSrc.buffer = noiseBuf;
    avSrc.loop = true;
    this.avFilter = ctx.createBiquadFilter();
    this.avFilter.type = 'lowpass';
    this.avFilter.frequency.value = 120;
    this.avFilter.Q.value = 2.4;
    this.avGain = ctx.createGain();
    this.avGain.gain.value = 0.0;
    avSrc.connect(this.avFilter);
    this.avFilter.connect(this.avGain);
    this.avGain.connect(this.masterGain);
    avSrc.start();

    this.initialized = true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.05);
    }
  }

  update(skier, avalanche, playing) {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (!playing) {
      // Gentle high-altitude alpine breeze on start/finish screens
      this.windGain.gain.setTargetAtTime(0.06, now, 0.25);
      this.windFilter.frequency.setTargetAtTime(220, now, 0.25);
      this.carveGain.gain.setTargetAtTime(0.0, now, 0.1);
      this.avGain.gain.setTargetAtTime(0.0, now, 0.2);
      return;
    }

    // Wind scales nonlinearly with speed
    const spdFrac = Math.min(1.4, skier.speedKmh / 110);
    const windVol = Math.min(0.62, 0.05 + spdFrac * spdFrac * 0.36);
    const windFreq = 200 + spdFrac * 920 + skier.tuckAmount * 180;
    this.windGain.gain.setTargetAtTime(windVol, now, 0.08);
    this.windFilter.frequency.setTargetAtTime(windFreq, now, 0.08);

    // Ski glide + carving hiss (sharper & higher frequency on cyan glacier ice!)
    const glideBase = skier.grounded && !skier.crashed ? Math.min(0.14, skier.speed * 0.004) : 0;
    const carveVol = skier.grounded && !skier.crashed
      ? Math.min(0.55, glideBase + skier.carveIntensity * 0.32)
      : 0;
    const carveFreq = skier.onGlacier
      ? 2400 + skier.carveIntensity * 1400
      : 1050 + skier.carveIntensity * 950;
    this.carveGain.gain.setTargetAtTime(carveVol, now, 0.06);
    this.carveFilter.frequency.setTargetAtTime(carveFreq, now, 0.06);

    // Avalanche deep booming rumble scaled by proximity
    if (avalanche.active) {
      const prox = Math.max(0, 1 - avalanche.distToSkier / 260);
      const avVol = Math.min(0.95, 0.16 + prox * prox * 0.78);
      const avFreq = 85 + prox * 175;
      this.avGain.gain.setTargetAtTime(avVol, now, 0.1);
      this.avFilter.frequency.setTargetAtTime(avFreq, now, 0.1);
    } else {
      this.avGain.gain.setTargetAtTime(0.0, now, 0.25);
    }
  }

  playJump() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.15);
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playLand(intensity = 0.6) {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    g.gain.setValueAtTime(0.28 * intensity, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  playAvalancheCrack() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.65);
    g.gain.setValueAtTime(0.45, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.75);
  }

  playCrash() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.35);
    g.gain.setValueAtTime(0.42, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  playFinish() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.09;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }
}
