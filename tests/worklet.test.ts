import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineMessage } from "../src/audio/protocol";
const state = vi.hoisted(() => ({ synth: undefined as any }));
vi.mock("spessasynth_core", () => ({
  SoundBankLoader: { fromArrayBuffer: () => ({}) },
  SpessaSynthProcessor: class {
    processorInitialized = Promise.resolve();
    midiChannels: any[] = [];
    voiceCount = 0;
    soundBankManager = { addSoundBank: vi.fn() };
    setSystemParameter = vi.fn();
    noteOn = vi.fn();
    noteOff = vi.fn();
    controllerChange = vi.fn();
    programChange = vi.fn();
    stopAllChannels = vi.fn();
    createMIDIChannel() {
      this.midiChannels.push({ setDrums: vi.fn() });
    }
    processSplit(
      _outputs: Float32Array[][],
      left: Float32Array,
      right: Float32Array,
    ) {
      left.fill(0);
      right.fill(0);
    }
    constructor() {
      state.synth = this;
    }
  },
}));
let processor: any;
async function message(message: EngineMessage) {
  processor.port.onmessage({ data: message });
  await Promise.resolve();
  await Promise.resolve();
}
const voice = {
  id: "a",
  staffId: "piano",
  midi: 60,
  program: 0,
  percussion: false,
  velocity: 90,
  expression: 80,
  volume: 90,
  pan: 64,
};
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("sampleRate", 48000);
  vi.stubGlobal("currentTime", 0);
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      port = { onmessage: undefined, postMessage: vi.fn() };
    },
  );
  vi.stubGlobal("registerProcessor", (_name: string, Constructor: any) => {
    processor = new Constructor();
  });
  await import("../src/audio/processor");
  await message({ type: "load", bank: new ArrayBuffer(0) });
});
afterEach(() => vi.unstubAllGlobals());
describe("audio-thread session protection", () => {
  it("waits for the scheduled start before chasing a note at a mid-score offset", async () => {
    await message({
      type: "play",
      epoch: 1,
      startAt: 0.03,
      offset: 1,
      duration: 3,
      actions: [
        { at: 0, kind: "on", voice },
        { at: 2, kind: "off", id: voice.id },
      ],
    });
    expect(state.synth.noteOn).not.toHaveBeenCalled();
    vi.stubGlobal("currentTime", 0.02);
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    expect(state.synth.noteOn).not.toHaveBeenCalled();
    vi.stubGlobal("currentTime", 0.03);
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    expect(state.synth.noteOn).toHaveBeenCalledTimes(1);
  });
  it("does not revive a scheduled chase after a stop", async () => {
    await message({
      type: "play",
      epoch: 1,
      startAt: 0.03,
      offset: 1,
      duration: 3,
      actions: [{ at: 0, kind: "on", voice }],
    });
    await message({ type: "stop", epoch: 2 });
    state.synth.noteOn.mockClear();
    vi.stubGlobal("currentTime", 0.04);
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    expect(state.synth.noteOn).not.toHaveBeenCalled();
  });
  it("fails a chord over the limit safely and can recover", async () => {
    await message({ type: "snapshot", epoch: 1, sequence: 1, voices: [voice] });
    await message({
      type: "snapshot",
      epoch: 1,
      sequence: 2,
      voices: Array.from({ length: 257 }, (_, i) => ({
        ...voice,
        id: String(i),
      })),
    });
    expect(processor.engine.active.size).toBe(0);
    expect(processor.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
    await message({ type: "snapshot", epoch: 2, sequence: 1, voices: [voice] });
    expect(processor.engine.active.size).toBe(1);
  });
  it("ignores nonfinite master volume without poisoning audio", async () => {
    await message({ type: "volume", volume: NaN });
    const left = new Float32Array(128),
      right = new Float32Array(128);
    processor.process([], [[left, right]]);
    expect([...left, ...right].every(Number.isFinite)).toBe(true);
  });
  it("rejects a delayed snapshot after its session has stopped", async () => {
    await message({
      type: "snapshot",
      epoch: 1,
      sequence: 1,
      voices: [voice],
      retrigger: false,
    });
    await message({ type: "stop", epoch: 2 });
    state.synth.noteOn.mockClear();
    await message({
      type: "snapshot",
      epoch: 1,
      sequence: 99,
      voices: [voice],
      retrigger: false,
    });
    expect(state.synth.noteOn).not.toHaveBeenCalled();
  });
  it("ignores out-of-order snapshots within a session", async () => {
    await message({
      type: "snapshot",
      epoch: 1,
      sequence: 3,
      voices: [voice],
      retrigger: false,
    });
    state.synth.noteOff.mockClear();
    await message({
      type: "snapshot",
      epoch: 1,
      sequence: 2,
      voices: [],
      retrigger: false,
    });
    expect(state.synth.noteOff).not.toHaveBeenCalled();
  });
  it("silences a stuck input session when its heartbeat expires", async () => {
    await message({
      type: "snapshot",
      epoch: 1,
      sequence: 1,
      voices: [voice],
      retrigger: false,
    });
    vi.stubGlobal("currentTime", 0.6);
    state.synth.controllerChange.mockClear();
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    // The safety stop releases ownership immediately and drains its short fade.
    for (let i = 0; i < 8; i++)
      processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    expect(state.synth.controllerChange).toHaveBeenCalledWith(0, 120, 0);
    expect(processor.port.postMessage).toHaveBeenCalledWith({
      type: "expired",
    });
  });
  it("does not let an old heartbeat renew a newer session", async () => {
    await message({
      type: "snapshot",
      epoch: 2,
      sequence: 1,
      voices: [voice],
      retrigger: false,
    });
    vi.stubGlobal("currentTime", 0.4);
    await message({ type: "heartbeat", epoch: 1 });
    vi.stubGlobal("currentTime", 0.6);
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    expect(processor.port.postMessage).toHaveBeenCalledWith({
      type: "expired",
    });
  });
  it("preserves a live session while fresh heartbeats arrive", async () => {
    await message({
      type: "snapshot",
      epoch: 2,
      sequence: 1,
      voices: [voice],
      retrigger: false,
    });
    vi.stubGlobal("currentTime", 0.4);
    await message({ type: "heartbeat", epoch: 2 });
    vi.stubGlobal("currentTime", 0.6);
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    expect(processor.port.postMessage).not.toHaveBeenCalledWith({
      type: "expired",
    });
  });
});
