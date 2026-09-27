/**
 * Procedural game audio on WebAudio. Nothing is sampled: gunshots, footsteps,
 * foley, UI ticks, announcer stings and the ambience are all synthesised from
 * oscillators and filtered noise, so the build ships no audio files.
 *
 * Bus layout: sources → (panner → distance low-pass)? → bus gain
 * (effects / ui / announcer / music) → master → destination, plus a reverb
 * send (generated impulse response) whose level rises indoors.
 *
 * Degrades to a no-op where AudioContext is missing (tests, headless).
 */
import type { AnnouncementKind, Vec3, WeaponId } from '@tra/shared';
import type { AudioSettings } from '../state/settings';

type Bus = 'effects' | 'music' | 'ui' | 'announcer';

export type ReloadStage = 'out' | 'in' | 'rack';

interface AmbienceNodes {
  nodes: AudioNode[];
  timers: ReturnType<typeof setTimeout>[];
  stop(): void;
}

const MAX_VOICES = 40;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private ambience: AmbienceNodes | null = null;
  private ambienceId: string | null = null;
  private settings: AudioSettings = { master: 0.8, effects: 0.8, music: 0.5, ui: 0.7, announcer: 0.8 };
  private indoor = false;
  private voices = 0;
  private listenerPos: Vec3 = { x: 0, y: 0, z: 0 };
  private lastShotAt = 0;

  /** True when WebAudio exists in this environment. */
  get available(): boolean {
    return typeof window !== 'undefined' && typeof (window as Window & { AudioContext?: unknown }).AudioContext === 'function';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Create/resume the context. Call from a user gesture. */
  resume(): void {
    if (!this.available) return;
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  private init(): void {
    const Ctor = (window as Window & { AudioContext: typeof AudioContext }).AudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.buses = {
      effects: ctx.createGain(),
      music: ctx.createGain(),
      ui: ctx.createGain(),
      announcer: ctx.createGain(),
    };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    // Reverb: exponentially decaying stereo noise impulse (1.6 s).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.6, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.08;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.buses.effects);
    this.noise = this.makeNoise(2);
    this.applyVolumes();
    if (this.ambienceId) this.startAmbience(this.ambienceId);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Settings / listener
  // ---------------------------------------------------------------------------

  setVolumes(a: AudioSettings): void {
    this.settings = { ...a };
    if (this.ctx) this.applyVolumes();
  }

  private applyVolumes(): void {
    const s = this.settings;
    const t = this.ctx!.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.buses.effects.gain.setTargetAtTime(s.effects, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.music, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(s.ui, t, 0.05);
    this.buses.announcer.gain.setTargetAtTime(s.announcer, t, 0.05);
  }

  setListener(pos: Vec3, forward: Vec3, up: Vec3): void {
    this.listenerPos = pos;
    if (!this.ctx) return;
    const l = this.ctx.listener as AudioListener & { setPosition?: (x: number, y: number, z: number) => void; setOrientation?: (...v: number[]) => void };
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else if (l.setPosition && l.setOrientation) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** Indoors → stronger early reflections. */
  setIndoor(indoor: boolean): void {
    if (this.indoor === indoor) return;
    this.indoor = indoor;
    if (this.ctx) this.reverbSend.gain.setTargetAtTime(indoor ? 0.32 : 0.08, this.ctx.currentTime, 0.3);
  }

  // ---------------------------------------------------------------------------
  // Routing helpers
  // ---------------------------------------------------------------------------

  /** Output chain for a source: positional (panner + distance low-pass) or direct. */
  private output(bus: Bus, pos: Vec3 | null, reverbAmount = 1): { node: AudioNode; dist: number } {
    const ctx = this.ctx!;
    if (!pos) {
      const g = ctx.createGain();
      g.connect(this.buses[bus]);
      if (reverbAmount > 0) {
        const send = ctx.createGain();
        send.gain.value = reverbAmount * 0.6;
        g.connect(send);
        send.connect(this.reverbSend);
      }
      return { node: g, dist: 0 };
    }
    const dx = pos.x - this.listenerPos.x;
    const dy = pos.y - this.listenerPos.y;
    const dz = pos.z - this.listenerPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 140;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(700, 18000 * Math.exp(-dist / 45));
    lp.connect(panner);
    panner.connect(this.buses[bus]);
    if (reverbAmount > 0) {
      const send = ctx.createGain();
      send.gain.value = reverbAmount * Math.min(1, 0.4 + dist / 30);
      panner.connect(send);
      send.connect(this.reverbSend);
    }
    return { node: lp, dist };
  }

  private canPlay(): boolean {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    if (this.voices >= MAX_VOICES) return false;
    return true;
  }

  private track(node: AudioScheduledSourceNode): void {
    this.voices++;
    node.onended = () => {
      this.voices--;
    };
  }

  /** Filtered noise burst with an exponential envelope. */
  private noiseBurst(out: AudioNode, t0: number, dur: number, gain: number, filter: { type: BiquadFilterType; from: number; to?: number; q?: number }, attack = 0.002): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.Q.value = filter.q ?? 0.9;
    f.frequency.setValueAtTime(filter.from, t0);
    if (filter.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, filter.to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.02);
    this.track(src);
  }

  /** Oscillator tone with a pitch glide and exponential decay. */
  private tone(out: AudioNode, t0: number, dur: number, gain: number, type: OscillatorType, from: number, to = from, attack = 0.003): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    this.track(o);
  }

  // ---------------------------------------------------------------------------
  // Weapons
  // ---------------------------------------------------------------------------

  /** Gunshot; `pos` null = the local player's own weapon. */
  gunshot(weapon: WeaponId, pos: Vec3 | null): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // Rate-limit identical remote shots piling up in one frame.
    if (pos && now - this.lastShotAt < 0.004) return;
    this.lastShotAt = now;
    const { node, dist } = this.output('effects', pos, this.indoor ? 1 : 0.7);
    const local = pos === null;
    const ar = weapon === 'dijla7';
    const g = local ? 1 : 0.9;
    // Transient crack.
    this.noiseBurst(node, now, ar ? 0.012 : 0.009, 0.9 * g, { type: 'highpass', from: ar ? 1800 : 2600, q: 0.7 });
    // Body: band-passed noise sweeping down.
    this.noiseBurst(node, now, ar ? 0.13 : 0.09, 0.75 * g, { type: 'bandpass', from: ar ? 2600 : 3600, to: ar ? 320 : 640, q: 0.8 });
    // Low thump.
    this.tone(node, now, ar ? 0.14 : 0.1, (ar ? 0.7 : 0.5) * g, 'sine', ar ? 95 : 150, ar ? 38 : 70);
    // Mechanical tail (bolt) and a soft reverb-ish tail for distant shots.
    if (local) this.noiseBurst(node, now + 0.035, 0.03, 0.18, { type: 'bandpass', from: 3200, q: 2.5 });
    if (dist > 20) this.noiseBurst(node, now + 0.03, 0.35, 0.2, { type: 'lowpass', from: 900, to: 300 });
  }

  dryFire(pos: Vec3 | null): void {
    if (!this.canPlay()) return;
    const { node } = this.output('effects', pos, 0.3);
    const t = this.ctx!.currentTime;
    this.noiseBurst(node, t, 0.012, 0.25, { type: 'highpass', from: 2200 });
    this.tone(node, t, 0.02, 0.08, 'square', 1800, 900);
  }

  reload(_weapon: WeaponId, stage: ReloadStage, pos: Vec3 | null): void {
    if (!this.canPlay()) return;
    const { node } = this.output('effects', pos, 0.4);
    const t = this.ctx!.currentTime;
    switch (stage) {
      case 'out':
        this.noiseBurst(node, t, 0.015, 0.3, { type: 'highpass', from: 1500 });
        this.tone(node, t + 0.02, 0.06, 0.12, 'sine', 220, 120);
        break;
      case 'in':
        this.noiseBurst(node, t, 0.04, 0.35, { type: 'lowpass', from: 700 });
        this.noiseBurst(node, t + 0.03, 0.012, 0.22, { type: 'bandpass', from: 2400, q: 3 });
        break;
      case 'rack':
        this.noiseBurst(node, t, 0.012, 0.3, { type: 'bandpass', from: 3000, q: 2 });
        this.noiseBurst(node, t + 0.07, 0.015, 0.34, { type: 'bandpass', from: 2400, q: 2 });
        this.tone(node, t + 0.07, 0.05, 0.1, 'triangle', 500, 300);
        break;
    }
  }

  weaponSwitch(pos: Vec3 | null): void {
    if (!this.canPlay()) return;
    const { node } = this.output('effects', pos, 0.2);
    const t = this.ctx!.currentTime;
    this.noiseBurst(node, t, 0.12, 0.12, { type: 'bandpass', from: 1100, q: 0.6 });
    this.noiseBurst(node, t + 0.1, 0.012, 0.2, { type: 'bandpass', from: 2600, q: 2 });
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  footstep(material: string, pos: Vec3 | null, sprint: boolean): void {
    if (!this.canPlay()) return;
    const { node } = this.output('effects', pos, 0.5);
    const t = this.ctx!.currentTime;
    const g = (sprint ? 0.32 : 0.22) * (pos ? 1 : 0.7);
    switch (material) {
      case 'wood':
      case 'lattice':
        this.noiseBurst(node, t, 0.06, g, { type: 'lowpass', from: 650 });
        this.tone(node, t, 0.07, g * 0.5, 'sine', 190, 120);
        break;
      case 'metal':
        this.noiseBurst(node, t, 0.04, g, { type: 'bandpass', from: 1500, q: 1.2 });
        this.tone(node, t, 0.25, g * 0.25, 'sine', 1240, 1180);
        this.tone(node, t, 0.2, g * 0.15, 'sine', 1860, 1800);
        break;
      case 'ground':
      case 'sand':
      case 'roof':
        this.noiseBurst(node, t, 0.09, g * 0.8, { type: 'lowpass', from: 1000, to: 400 });
        break;
      case 'fabric':
        this.noiseBurst(node, t, 0.08, g * 0.5, { type: 'lowpass', from: 500 });
        break;
      case 'water':
        this.noiseBurst(node, t, 0.12, g, { type: 'bandpass', from: 1800, to: 900, q: 0.7 });
        break;
      default: // cobble, stone, concrete, tile, brick…
        this.noiseBurst(node, t, 0.035, g, { type: 'bandpass', from: 1900, q: 1.6 });
        this.tone(node, t, 0.03, g * 0.4, 'sine', 420, 260);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

  hitmarker(kill: boolean, headshot: boolean): void {
    if (!this.canPlay()) return;
    const { node } = this.output('ui', null, 0);
    const t = this.ctx!.currentTime;
    const base = headshot ? 2300 : 1500;
    this.tone(node, t, 0.03, 0.25, 'square', base, base * 0.9);
    this.tone(node, t + 0.035, 0.03, 0.25, 'square', base * 1.3, base * 1.2);
    if (kill) {
      const notes = headshot ? [880, 1175, 1760] : [660, 880, 1320];
      notes.forEach((f, i) => this.tone(node, t + 0.08 + i * 0.07, 0.16, 0.22, 'triangle', f, f));
      this.noiseBurst(node, t + 0.08, 0.05, 0.15, { type: 'highpass', from: 3000 });
    }
  }

  damageTaken(amount: number): void {
    if (!this.canPlay()) return;
    const { node } = this.output('effects', null, 0.2);
    const t = this.ctx!.currentTime;
    const g = Math.min(0.6, 0.25 + amount / 100);
    this.tone(node, t, 0.16, g, 'sine', 80, 45);
    this.noiseBurst(node, t, 0.08, g * 0.5, { type: 'lowpass', from: 350 });
  }

  /** Tonal announcer stings (no speech). `own` = good news for the local team. */
  announce(kind: AnnouncementKind, own: boolean): void {
    if (!this.canPlay()) return;
    const { node } = this.output('announcer', null, 0.5);
    const t = this.ctx!.currentTime;
    const seq = (notes: number[], step: number, dur: number, type: OscillatorType = 'triangle', gain = 0.28) => {
      notes.forEach((f, i) => {
        this.tone(node, t + i * step, dur, gain, type, f, f);
        this.tone(node, t + i * step, dur, gain * 0.35, 'sine', f * 2, f * 2);
      });
    };
    switch (kind) {
      case 'match_start': seq([262, 330, 392, 523], 0.11, 0.35); break;
      case 'halfway': seq([392, 523], 0.15, 0.3); break;
      case 'last_minute': seq([440, 440, 587], 0.13, 0.22, 'sawtooth', 0.2); break;
      case 'ten_seconds': seq([880], 0.1, 0.08, 'square', 0.15); break;
      case 'lead_taken': seq(own ? [392, 494, 587] : [392, 370, 311], 0.1, 0.3); break;
      case 'lead_lost': seq(own ? [392, 370, 311] : [392, 494, 587], 0.1, 0.3); break;
      case 'match_end': seq([523, 392], 0.2, 0.4); break;
      case 'victory': seq([392, 523, 659, 784, 1047], 0.13, 0.5); break;
      case 'defeat': seq([392, 349, 311, 262], 0.18, 0.5, 'sawtooth', 0.18); break;
      case 'draw': seq([440, 440], 0.25, 0.4); break;
    }
  }

  // ---------------------------------------------------------------------------
  // Ambience
  // ---------------------------------------------------------------------------

  startAmbience(id: string): void {
    this.ambienceId = id;
    if (!this.ctx) return;
    this.stopAmbienceNodes();
    const ctx = this.ctx;
    const nodes: AudioNode[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const bus = this.buses.music; // ambience rides the music bus (menu-safe level)
    const loopNoise = () => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.start();
      nodes.push(src);
      return src;
    };
    // Wind: low-passed noise with a slow LFO on the cutoff.
    const wind = loopNoise();
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass';
    windLp.frequency.value = 380;
    const windGain = ctx.createGain();
    windGain.gain.value = id === 'old_city' ? 0.11 : 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain);
    lfoGain.connect(windLp.frequency);
    lfo.start();
    wind.connect(windLp);
    windLp.connect(windGain);
    windGain.connect(bus);
    nodes.push(windLp, windGain, lfo, lfoGain);
    if (id === 'old_city') {
      // Distant crowd murmur: band-passed noise whose level wanders.
      const crowd = loopNoise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 0.7;
      const crowdGain = ctx.createGain();
      crowdGain.gain.value = 0.05;
      crowd.connect(bp);
      bp.connect(crowdGain);
      crowdGain.connect(bus);
      nodes.push(bp, crowdGain);
      const wander = () => {
        crowdGain.gain.setTargetAtTime(0.035 + Math.random() * 0.045, ctx.currentTime, 0.6);
        timers.push(setTimeout(wander, 700 + Math.random() * 900));
      };
      wander();
      // Occasional bird chirps, panned at random.
      const chirp = () => {
        if (ctx.state === 'running') {
          const pan = ctx.createStereoPanner();
          pan.pan.value = Math.random() * 1.6 - 0.8;
          pan.connect(bus);
          const t = ctx.currentTime;
          const n = 2 + Math.floor(Math.random() * 3);
          const f0 = 2400 + Math.random() * 1200;
          for (let i = 0; i < n; i++) this.tone(pan, t + i * 0.09, 0.07, 0.045, 'sine', f0, f0 * 1.35);
        }
        timers.push(setTimeout(chirp, 4000 + Math.random() * 9000));
      };
      timers.push(setTimeout(chirp, 2000));
    }
    this.ambience = {
      nodes,
      timers,
      stop: () => {
        for (const t of timers) clearTimeout(t);
        for (const n of nodes) {
          try {
            if ('stop' in n && typeof (n as AudioScheduledSourceNode).stop === 'function') (n as AudioScheduledSourceNode).stop();
          } catch {
            /* already stopped */
          }
          n.disconnect();
        }
      },
    };
  }

  private stopAmbienceNodes(): void {
    this.ambience?.stop();
    this.ambience = null;
  }

  stopAmbience(): void {
    this.ambienceId = null;
    this.stopAmbienceNodes();
  }

  dispose(): void {
    this.stopAmbience();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
