/** Small synthesized sound engine (no audio files): engine hum, warp spool / jump / cruise / exit, UI blips. */
export class Sound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private engine?: { gain: GainNode; filter: BiquadFilterNode; osc: OscillatorNode; osc2: OscillatorNode };
  private warp?: { gain: GainNode; filter: BiquadFilterNode; osc: OscillatorNode; lfo: OscillatorNode };
  private cabin?: GainNode;
  private noise?: AudioBuffer;
  muted = false;
  volume = 0.7;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // brown-ish noise buffer
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    this.noise = buf;

    // engine: filtered noise + two detuned low oscillators
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 200;
      filter.Q.value = 0.8;
      const src = this.loopNoise();
      src.connect(filter);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 42;
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 63.5;
      const og = ctx.createGain();
      og.gain.value = 0.05;
      osc.connect(og);
      osc2.connect(og);
      og.connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      this.engine = { gain, filter, osc, osc2 };
    }
    // warp field: resonant noise + a slowly modulated tone
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 120;
      filter.Q.value = 2.5;
      this.loopNoise().connect(filter);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.3;
      const lg = ctx.createGain();
      lg.gain.value = 6;
      lfo.connect(lg).connect(osc.frequency);
      const og = ctx.createGain();
      og.gain.value = 0.25;
      osc.connect(og).connect(gain);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      lfo.start();
      this.warp = { gain, filter, osc, lfo };
    }
    // cabin air (very quiet)
    {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 900;
      this.loopNoise().connect(f).connect(g).connect(this.master);
      this.cabin = g;
    }
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise!;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 2);
    return s;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /**
   * @param throttle 0..1
   * @param warpSpool 0..1 while charging
   * @param warpIntensity 0..1 while in cruise
   */
  update(throttle: number, boost: boolean, warpSpool: number, warpIntensity: number, cockpit: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.warp || !this.cabin) return;
    const t = ctx.currentTime;
    const e = this.engine;
    const thr = Math.min(1, throttle + (boost ? 0.35 : 0));
    e.gain.gain.setTargetAtTime(0.05 + thr * 0.33, t, 0.15);
    e.filter.frequency.setTargetAtTime(140 + thr * 700 + warpSpool * 600, t, 0.2);
    e.osc.frequency.setTargetAtTime(38 + thr * 22 + warpSpool * 30, t, 0.3);
    e.osc2.frequency.setTargetAtTime(57 + thr * 33 + warpSpool * 45, t, 0.3);
    const w = this.warp;
    const wl = Math.max(warpSpool * 0.7, warpIntensity);
    w.gain.gain.setTargetAtTime(wl * 0.55, t, 0.25);
    w.filter.frequency.setTargetAtTime(90 + warpSpool * 900 + warpIntensity * 260, t, 0.3);
    w.osc.frequency.setTargetAtTime(48 + warpSpool * 160 + warpIntensity * 20, t, 0.4);
    this.cabin.gain.setTargetAtTime(cockpit ? 0.012 : 0.0, t, 0.3);
  }

  /** One-shot sounds. */
  play(kind: 'click' | 'confirm' | 'deny' | 'jump' | 'exit' | 'spool' | 'arrive'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.master);
    const tone = (f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g).connect(out);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.05);
    };
    const burst = (dur: number, f0: number, f1: number, vol: number, q = 0.7, delay = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise!;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, t + delay);
      f.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      s.connect(f).connect(g).connect(out);
      s.start(t + delay, Math.random() * 2);
      s.stop(t + delay + dur + 0.05);
    };
    switch (kind) {
      case 'click':
        tone(1800, 1200, 0.05, 'sine', 0.06);
        break;
      case 'confirm':
        tone(880, 880, 0.08, 'sine', 0.08);
        tone(1320, 1320, 0.12, 'sine', 0.07, 0.08);
        break;
      case 'deny':
        tone(300, 220, 0.18, 'square', 0.05);
        break;
      case 'spool':
        tone(60, 420, 3.2, 'sawtooth', 0.05);
        burst(3.3, 200, 3000, 0.25, 1.5);
        break;
      case 'jump':
        tone(90, 28, 1.6, 'sine', 0.9);
        burst(1.8, 6000, 80, 1.0, 0.9);
        tone(1400, 60, 0.9, 'sawtooth', 0.06);
        break;
      case 'exit':
        burst(1.4, 3000, 120, 0.6, 1.2);
        tone(320, 40, 1.2, 'sine', 0.35);
        break;
      case 'arrive':
        tone(660, 660, 0.1, 'sine', 0.06);
        tone(990, 990, 0.18, 'sine', 0.05, 0.1);
        break;
    }
  }
}
