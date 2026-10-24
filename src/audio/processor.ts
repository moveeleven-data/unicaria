import { SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";
import { VoiceEngine } from "./voice-engine";
import { SmoothGain, SmoothSynth, FADE_SECONDS } from "./smooth-synth";
import type { EngineMessage, EngineReply } from "./protocol";
import type { AudioAction, DesiredVoice } from "../performance/compiler";
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class UnicariaProcessor extends AudioWorkletProcessor {
  private synth?: SpessaSynthProcessor;
  private engine?: VoiceEngine;
  private smooth?: SmoothSynth;
  private epoch = 0;
  private sequence = -1;
  private lease = 0;
  private mode: "idle" | "scrub" | "play" = "idle";
  private actions: AudioAction[] = [];
  private actionIndex = 0;
  private startAt = 0;
  private playAt = 0;
  private chased?: DesiredVoice[];
  private duration = 0;
  private master = new SmoothGain(0.7);
  private count = 0;
  private peak = 0;
  constructor() {
    super();
    this.port.onmessage = (e) => {
      void this.receive(e.data as EngineMessage).catch((error) => {
        this.mode = "idle";
        this.actions = [];
        this.chased = undefined;
        this.engine?.stop();
        this.reply({ type: "error", message: String(error) });
      });
    };
  }
  private reply(message: EngineReply) {
    this.port.postMessage(message);
  }
  private async receive(m: EngineMessage) {
    if (m.type === "load") {
      this.synth = new SpessaSynthProcessor(sampleRate, {
        effectsEnabled: false,
        eventsEnabled: false,
        initialTime: currentTime,
        maxBufferSize: 128,
      });
      await this.synth.processorInitialized;
      this.synth.soundBankManager.addSoundBank(
        SoundBankLoader.fromArrayBuffer(m.bank),
        "generaluser",
      );
      this.synth.setSystemParameter("voiceCap", 768);
      // Layered SoundFont presets must not steal a still-audible fade voice.
      this.synth.setSystemParameter("autoAllocateVoices", true);
      this.smooth = new SmoothSynth(this.synth, sampleRate);
      this.engine = new VoiceEngine(this.smooth);
      this.reply({ type: "ready" });
      return;
    }
    if (m.type === "volume") {
      if (!Number.isFinite(m.volume)) return;
      this.master.to(
        Math.max(0, Math.min(1, m.volume)),
        sampleRate * FADE_SECONDS,
      );
      return;
    }
    if (m.epoch < this.epoch) return;
    if (m.type === "stop") {
      this.epoch = m.epoch;
      this.sequence = -1;
      this.mode = "idle";
      this.actions = [];
      this.chased = undefined;
      this.engine?.stop();
      return;
    }
    if (m.type === "heartbeat") {
      if (m.epoch === this.epoch) this.lease = currentTime + 0.5;
      return;
    }
    if (!this.engine) return;
    if (m.type === "snapshot") {
      if (m.epoch > this.epoch) {
        this.engine.stop();
        this.sequence = -1;
      }
      if (m.sequence <= this.sequence) return;
      this.epoch = m.epoch;
      this.sequence = m.sequence;
      this.mode = "scrub";
      this.chased = undefined;
      this.actions = [];
      this.lease = currentTime + 0.5;
      this.engine.snapshot(m.voices, currentTime, m.retrigger);
      return;
    }
    if (m.type === "play") {
      this.engine.stop();
      this.epoch = m.epoch;
      this.mode = "play";
      this.lease = currentTime + 0.5;
      this.actions = m.actions;
      this.actionIndex = 0;
      this.startAt = m.startAt - m.offset;
      this.playAt = m.startAt;
      this.duration = m.duration;
      // Chase notes already sounding at the requested start point.
      const active = new Map<string, NonNullable<AudioAction["voice"]>>();
      while (
        this.actionIndex < this.actions.length &&
        this.actions[this.actionIndex].at < m.offset - 1e-8
      ) {
        const a = this.actions[this.actionIndex++];
        if (a.kind === "on") active.set(a.voice!.id, { ...a.voice! });
        if (a.kind === "off") active.delete(a.id!);
        if (a.kind === "expression")
          for (const v of active.values())
            if (v.staffId === a.staffId) v.expression = a.expression!;
      }
      this.chased = [...active.values()];
    }
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    if (!this.synth || !this.engine || !this.smooth) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    if (this.mode !== "idle" && currentTime > this.lease) {
      this.mode = "idle";
      this.engine.stop();
      this.actions = [];
      this.chased = undefined;
      this.reply({ type: "expired" });
    }
    if (this.mode === "play" && currentTime >= this.playAt) {
      if (this.chased) {
        try {
          this.engine.snapshot(this.chased, currentTime);
        } catch (error) {
          this.engine.stop();
          this.mode = "idle";
          this.actions = [];
          this.reply({ type: "error", message: String(error) });
        }
        this.chased = undefined;
      }
      while (
        this.actionIndex < this.actions.length &&
        this.actions[this.actionIndex].at <= currentTime - this.startAt
      ) {
        const a = this.actions[this.actionIndex++];
        try {
          if (a.kind === "on") this.engine.start(a.voice!, currentTime);
          else if (a.kind === "off") this.engine.end(a.id!, currentTime);
          else this.engine.expression(a.staffId!, a.expression!);
        } catch (error) {
          this.engine.stop();
          this.mode = "idle";
          this.reply({ type: "error", message: String(error) });
          break;
        }
      }
      if (currentTime - this.startAt > this.duration + 0.2) {
        this.mode = "idle";
        this.engine.stop();
        this.reply({ type: "ended" });
      }
    }
    this.engine.advance();
    this.smooth.process(left, right);
    let sum = 0;
    for (let i = 0; i < left.length; i++) {
      const master = this.master.next();
      left[i] = Math.tanh(left[i] * master);
      right[i] = Math.tanh(right[i] * master);
      sum += left[i] * left[i] + right[i] * right[i];
      this.peak = Math.max(this.peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    if (++this.count % 24 === 0) {
      this.reply({
        type: "stats",
        voices: this.synth.voiceCount,
        active: this.engine.active.size,
        rms: Math.sqrt(sum / (left.length * 2)),
        peak: this.peak,
        time: currentTime,
      });
      this.peak = 0;
    }
    return true;
  }
}
registerProcessor("unicaria-synth", UnicariaProcessor);
