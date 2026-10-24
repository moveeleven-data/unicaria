import type { MIDIController, SpessaSynthProcessor } from "spessasynth_core";
import type { SynthPort } from "./voice-engine";

export const ATTACK_SECONDS = 0.003;
export const FADE_SECONDS = 0.018;
export const RELEASE_SECONDS = 0.18;

/** Finite, sample-clocked ramp with zero slope at both ends. */
export class SmoothGain {
  private from: number;
  private target: number;
  private position = 0;
  private length = 0;
  value: number;
  constructor(value: number) {
    this.value = this.from = this.target = value;
  }
  to(target: number, samples: number) {
    this.from = this.value;
    this.target = target;
    this.position = 0;
    this.length = Math.max(1, Math.round(samples));
  }
  get settled() {
    return this.position >= this.length;
  }
  next() {
    if (this.settled) return (this.value = this.target);
    // Include the exact starting and ending gains, with no block-edge step.
    const t = Math.min(1, this.position / this.length);
    this.value = this.from + (this.target - this.from) * t * t * (3 - 2 * t);
    if (this.position < this.length) this.position++;
    return this.value;
  }
}

type Lane = {
  gain: SmoothGain;
  retiring: boolean;
  delay: number;
};

/**
 * Uses the synth's public split-output API, never its internal voice objects.
 * One note owns each stereo lane. Reclaim happens only after the final zero
 * sample, so reclaiming a channel never truncates an audible waveform.
 * Effects stay disabled: an unseparated effects bus would bypass these fades.
 */
export class SmoothSynth implements SynthPort {
  private outputs: Float32Array[][];
  private lanes: Lane[];
  private busy = new Set<number>();
  private fadeSamples: number;
  private attackSamples: number;
  private releaseSamples: number;
  constructor(
    private synth: SpessaSynthProcessor,
    sampleRate: number,
    channels = 512,
    blockSize = 128,
  ) {
    while (synth.midiChannels.length < channels) synth.createMIDIChannel();
    this.outputs = Array.from({ length: channels }, () => [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ]);
    this.lanes = Array.from({ length: channels }, () => ({
      gain: new SmoothGain(0),
      retiring: false,
      delay: 0,
    }));
    this.fadeSamples = Math.round(sampleRate * FADE_SECONDS);
    this.attackSamples = Math.round(sampleRate * ATTACK_SECONDS);
    this.releaseSamples = Math.round(sampleRate * RELEASE_SECONDS);
  }
  noteOn(channel: number, pitch: number, velocity: number) {
    const lane = this.lanes[channel];
    lane.retiring = false;
    lane.delay = 0;
    lane.gain.to(1, this.attackSamples);
    this.busy.add(channel);
    this.synth.noteOn(channel, pitch, velocity);
  }
  noteOff(channel: number, pitch: number) {
    this.synth.noteOff(channel, pitch);
  }
  controllerChange(channel: number, cc: number, value: number) {
    this.synth.controllerChange(channel, cc as MIDIController, value);
  }
  programChange(channel: number, program: number) {
    this.synth.programChange(channel, program);
  }
  setDrums(channel: number, drums: boolean) {
    this.synth.midiChannels[channel].setDrums(drums);
  }
  isSilent(channel: number) {
    return !this.busy.has(channel);
  }
  release(channel: number, quick: boolean) {
    if (!this.busy.has(channel)) return;
    const lane = this.lanes[channel];
    if (lane.retiring && (!quick || lane.delay === 0)) return;
    lane.retiring = true;
    lane.delay = quick ? 0 : this.releaseSamples;
    if (quick) lane.gain.to(0, this.fadeSamples);
  }
  stopAll() {
    for (const channel of this.busy) this.release(channel, true);
  }
  process(left: Float32Array, right: Float32Array) {
    left.fill(0);
    right.fill(0);
    for (const channel of this.busy) {
      this.outputs[channel][0].fill(0);
      this.outputs[channel][1].fill(0);
    }
    this.synth.processSplit(this.outputs, left, right, 0, left.length);
    for (const channel of this.busy) {
      const lane = this.lanes[channel];
      const [l, r] = this.outputs[channel];
      for (let i = 0; i < left.length; i++) {
        if (lane.delay > 0 && --lane.delay === 0)
          lane.gain.to(0, this.fadeSamples);
        const gain = lane.gain.next();
        left[i] += l[i] * gain;
        right[i] += r[i] * gain;
      }
      if (
        lane.retiring &&
        lane.delay === 0 &&
        lane.gain.value === 0 &&
        lane.gain.settled
      ) {
        this.synth.controllerChange(channel, 120, 0);
        this.busy.delete(channel);
      }
    }
  }
}
