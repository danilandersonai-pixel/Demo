/** Procedural WebAudio sound effects + quiet ambient drone. No audio files. */
class Audio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  enabled = true;
  volume = 0.5;
  private last = new Map<string, number>();
  private ambient: { osc: OscillatorNode[]; gain: GainNode } | null = null;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined' || !(window as any).AudioContext) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopAmbient();
    else this.startAmbient();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq = 800): void {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  play(name: string): void {
    if (!this.enabled) return;
    const now = performance.now();
    const minGap: Record<string, number> = { build: 80, place: 40, click: 30, notify: 400, alarm: 1500, tech: 500, decon: 60 };
    if (now - (this.last.get(name) ?? 0) < (minGap[name] ?? 100)) return;
    this.last.set(name, now);
    if (!this.ensure()) return;
    switch (name) {
      case 'click':
        this.tone(1200, 0.04, 'square', 0.03);
        break;
      case 'place':
        this.tone(420, 0.07, 'triangle', 0.08, -120);
        break;
      case 'build':
        this.tone(660, 0.08, 'triangle', 0.05);
        this.tone(990, 0.1, 'triangle', 0.04, 0, 0.06);
        break;
      case 'decon':
        this.tone(300, 0.12, 'sawtooth', 0.04, -150);
        break;
      case 'notify':
        this.tone(880, 0.09, 'sine', 0.06);
        this.tone(1320, 0.12, 'sine', 0.05, 0, 0.08);
        break;
      case 'tech':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.05, 0, i * 0.08));
        break;
      case 'alarm':
        this.tone(520, 0.18, 'square', 0.04);
        this.tone(390, 0.22, 'square', 0.04, 0, 0.2);
        break;
      case 'commit':
        this.tone(700, 0.06, 'triangle', 0.05);
        this.tone(1050, 0.1, 'triangle', 0.05, 0, 0.05);
        break;
      case 'era':
        [262, 392, 523, 784].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.06, 0, i * 0.15));
        this.noise(1.2, 0.03, 300);
        break;
      case 'type':
        this.tone(1800 + Math.random() * 400, 0.015, 'square', 0.015);
        break;
      case 'explode':
        this.noise(0.4, 0.15, 200);
        break;
    }
  }

  startAmbient(): void {
    if (!this.enabled || this.ambient || !this.ensure()) return;
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.012;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const osc = [55, 82.4, 110.2].map((fr) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start();
      return o;
    });
    f.connect(gain).connect(this.master!);
    this.ambient = { osc, gain };
  }

  stopAmbient(): void {
    if (!this.ambient) return;
    for (const o of this.ambient.osc) o.stop();
    this.ambient.gain.disconnect();
    this.ambient = null;
  }
}

export const audio = new Audio();
