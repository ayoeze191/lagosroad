/** One shared AudioContext: a filtered engine drone plus a synthesised pothole thud. */
class GameAudio {
  private ctx?: AudioContext;
  private engine?: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };
  muted = (() => { try { return localStorage.getItem("lrr:muted") === "1"; } catch { return false; } })();

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), sub = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    osc.type = "sawtooth"; sub.type = "square";
    filter.type = "lowpass"; filter.frequency.value = 400;
    gain.gain.value = 0;
    osc.connect(filter); sub.connect(filter); filter.connect(gain).connect(ctx.destination);
    osc.start(); sub.start();
    this.engine = { osc, sub, gain, filter };
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try { localStorage.setItem("lrr:muted", muted ? "1" : "0"); } catch { /* storage unavailable */ }
    if (muted) this.setEngine(0, 0);
  }

  /** ratio 0..1 of top speed; throttle 0..1 */
  setEngine(ratio: number, throttle: number) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime, e = this.engine;
    const f = 42 + ratio * 120 + throttle * 12;
    e.osc.frequency.setTargetAtTime(f, t, 0.05);
    e.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    e.filter.frequency.setTargetAtTime(300 + ratio * 900 + throttle * 300, t, 0.08);
    e.gain.gain.setTargetAtTime(this.muted ? 0 : 0.035 + throttle * 0.03, t, 0.1);
  }

  /** Gunshot: a sharp crack of filtered noise with a low thump. Quieter when it's someone far away. */
  gunshot(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    noise.buffer = buffer; filter.type = "bandpass"; filter.frequency.value = 1800; filter.Q.value = 0.7;
    gain.gain.value = 0.5 * volume;
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
    const osc = ctx.createOscillator(), og = ctx.createGain();
    osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    og.gain.setValueAtTime(0.35 * volume, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(ctx.destination); osc.start(t); osc.stop(t + 0.14);
  }

  /** Metallic clang when a round hits a car. */
  clang(volume = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [820, 1270]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "square"; osc.frequency.value = f;
      g.gain.setValueAtTime(0.08 * volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(g).connect(ctx.destination); osc.start(t); osc.stop(t + 0.26);
    }
  }

  thud(strength = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.18);
    gain.gain.setValueAtTime(0.35 * strength, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.25);
    // A short burst of noise for the rattle of the suspension.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = ctx.createBufferSource(), ng = ctx.createGain();
    noise.buffer = buffer; ng.gain.value = 0.12 * strength;
    noise.connect(ng).connect(ctx.destination);
    noise.start(t);
  }

  private siren?: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode };

  /** Police siren (wailing) while a chase is on. */
  setSiren(on: boolean, distance = 100) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.siren) {
      const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain(), gain = ctx.createGain();
      osc.type = "square"; osc.frequency.value = 750;
      lfo.frequency.value = 0.9; lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 1400;
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start(); lfo.start();
      this.siren = { osc, lfo, gain };
    }
    if (this.siren) {
      const level = on && !this.muted ? Math.max(0.006, 0.05 * Math.min(1, 60 / Math.max(20, distance))) : 0;
      this.siren.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.2);
      if (!on) { const s = this.siren; this.siren = undefined; setTimeout(() => { s.osc.stop(); s.lfo.stop(); }, 800); }
    }
  }

  private beep(freqs: number[], length: number, type: OscillatorType, volume: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type; osc.frequency.value = f;
      gain.gain.setValueAtTime(volume, t + i * length);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (i + 1) * length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * length); osc.stop(t + (i + 1) * length + 0.02);
    });
  }
  /** Angry horn from a vehicle you crashed into. */
  honk() { this.beep([415, 415], 0.18, "sawtooth", 0.06); }
  /** Ka-ching: paid the agbero. */
  cash() { this.beep([1320, 1760], 0.09, "triangle", 0.08); }
  /** Agbero whistle as he starts chasing. */
  whistle() { this.beep([2200, 1800, 2200], 0.12, "sine", 0.06); }

  stop() {
    this.setSiren(false); this.setEngine(0, 0); if (this.engine) this.engine.gain.gain.value = 0; }
}

export const audio = new GameAudio();
