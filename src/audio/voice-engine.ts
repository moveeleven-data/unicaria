import type { DesiredVoice } from "../performance/compiler";
/** Small synth port makes voice ownership and diffing testable without Web Audio. */
export interface SynthPort {
  noteOn(channel: number, pitch: number, velocity: number): void;
  noteOff(channel: number, pitch: number): void;
  controllerChange(channel: number, cc: number, value: number): void;
  programChange(channel: number, program: number): void;
  setDrums(channel: number, drums: boolean): void;
  release(channel: number, quick: boolean): void;
  isSilent(channel: number): boolean;
  stopAll(): void;
}
export class VoiceEngine {
  readonly active = new Map<string, { voice: DesiredVoice; channel: number }>();
  private free: number[];
  private retiring = new Set<number>();
  private pending = new Map<string, DesiredVoice>();
  readonly channels: number;
  constructor(
    private synth: SynthPort,
    readonly capacity = 256,
  ) {
    // A second bank lets an entire chord fade while its replacement starts.
    this.channels = capacity * 2;
    this.free = Array.from(
      { length: this.channels },
      (_, i) => this.channels - 1 - i,
    );
  }
  advance() {
    for (const channel of this.retiring) {
      if (this.synth.isSilent(channel)) {
        this.free.push(channel);
        this.retiring.delete(channel);
      }
    }
    for (const [id, voice] of this.pending) {
      if (!this.free.length) break;
      this.pending.delete(id);
      this.begin(voice);
    }
  }
  start(voice: DesiredVoice, _now: number) {
    this.advance();
    if (this.active.has(voice.id)) return;
    if (
      !this.pending.has(voice.id) &&
      this.active.size + this.pending.size >= this.capacity
    )
      throw new Error(
        `The ${this.capacity}-note audition limit has been reached.`,
      );
    // Extreme bursts wait for silence instead of stealing an audible tail.
    // Snapshot diffing removes superseded requests before they can sound.
    if (!this.free.length) {
      this.pending.set(voice.id, { ...voice });
      return;
    }
    this.pending.delete(voice.id);
    this.begin(voice);
  }
  private begin(voice: DesiredVoice) {
    const channel = this.free.pop()!;
    this.synth.controllerChange(channel, 120, 0);
    this.synth.controllerChange(channel, 64, 0);
    this.synth.setDrums(channel, voice.percussion);
    this.synth.programChange(channel, voice.percussion ? 0 : voice.program);
    this.synth.controllerChange(channel, 7, voice.volume);
    this.synth.controllerChange(channel, 10, voice.pan);
    this.synth.controllerChange(channel, 11, voice.expression);
    this.synth.noteOn(channel, voice.midi, voice.velocity);
    this.active.set(voice.id, { voice: { ...voice }, channel });
  }
  end(id: string, _now: number, quick = false) {
    this.pending.delete(id);
    const record = this.active.get(id);
    if (!record) return;
    // Scrubbing fades the continuing waveform, independent of preset release
    // envelopes. Timed playback still uses the instrument's normal Note Off.
    if (!quick) this.synth.noteOff(record.channel, record.voice.midi);
    this.synth.release(record.channel, quick);
    this.active.delete(id);
    this.retiring.add(record.channel);
  }
  expression(staffId: string, expression: number) {
    for (const voice of this.pending.values())
      if (voice.staffId === staffId) voice.expression = expression;
    for (const a of this.active.values())
      if (a.voice.staffId === staffId && a.voice.expression !== expression) {
        this.synth.controllerChange(a.channel, 11, expression);
        a.voice.expression = expression;
      }
  }
  snapshot(voices: DesiredVoice[], now: number, retrigger = false) {
    const wanted = new Map(voices.map((v) => [v.id, v]));
    if (wanted.size > this.capacity)
      throw new Error(
        `The ${this.capacity}-note audition limit has been reached.`,
      );
    for (const id of this.pending.keys()) {
      const voice = wanted.get(id);
      if (!voice || retrigger) this.pending.delete(id);
      else this.pending.set(id, { ...voice });
    }
    for (const [id, active] of this.active) {
      const v = wanted.get(id);
      if (
        retrigger ||
        !v ||
        v.midi !== active.voice.midi ||
        v.program !== active.voice.program ||
        v.percussion !== active.voice.percussion
      )
        this.end(id, now, true);
    }
    for (const voice of voices) {
      const a = this.active.get(voice.id);
      if (!a) {
        this.start(voice, now);
        continue;
      }
      for (const [field, cc] of [
        ["expression", 11],
        ["volume", 7],
        ["pan", 10],
      ] as const)
        if (a.voice[field] !== voice[field])
          this.synth.controllerChange(a.channel, cc, voice[field]);
      a.voice = { ...voice };
    }
    this.advance();
  }
  stop() {
    this.synth.stopAll();
    for (const { channel } of this.active.values()) this.retiring.add(channel);
    this.active.clear();
    this.pending.clear();
    this.advance();
  }
}
