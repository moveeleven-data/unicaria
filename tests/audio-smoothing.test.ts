import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";
import { VoiceEngine } from "../src/audio/voice-engine";
import {
  SmoothGain,
  SmoothSynth,
  FADE_SECONDS,
  ATTACK_SECONDS,
  RELEASE_SECONDS,
} from "../src/audio/smooth-synth";

const voice = {
  id: "a",
  staffId: "staff",
  midi: 60,
  program: 16,
  percussion: false,
  velocity: 88,
  expression: 80,
  volume: 90,
  pan: 64,
};
const size = 128;

// Constant output exposes envelope steps that a favorable oscillator phase
// could hide. It also lets us inspect when a lane is actually hard-stopped.
function constant(rate = 48000, capacity = 2) {
  const sounding = new Set<number>();
  const synth = {
    midiChannels: [] as { setDrums: () => void }[],
    createMIDIChannel() {
      this.midiChannels.push({ setDrums() {} });
    },
    noteOn: vi.fn((ch: number) => sounding.add(ch)),
    noteOff: vi.fn(),
    controllerChange: vi.fn((ch: number, cc: number) => {
      if (cc === 120) sounding.delete(ch);
    }),
    programChange: vi.fn(),
    processSplit(outputs: Float32Array[][]) {
      for (const ch of sounding) {
        outputs[ch][0].fill(1);
        outputs[ch][1].fill(-0.5);
      }
    },
  };
  const smooth = new SmoothSynth(
    synth as unknown as SpessaSynthProcessor,
    rate,
    capacity * 2,
  );
  const engine = new VoiceEngine(smooth, capacity);
  const left = new Float32Array(size),
    right = new Float32Array(size);
  const render = () => {
    engine.advance();
    smooth.process(left, right);
    return [...left];
  };
  const settle = (seconds = 0.025) => {
    for (let i = 0; i < Math.ceil((seconds * rate) / size); i++) render();
  };
  return { engine, smooth, synth, render, settle, left, right, sounding };
}

describe("sample-level handoffs", () => {
  it("supports 256-note swaps and coalesces another dense change without cuts", () => {
    const c = constant(48000, 256);
    const chord = (n: number) =>
      Array.from({ length: 256 }, (_, i) => ({ ...voice, id: `${n}:${i}` }));
    c.engine.snapshot(chord(0), 0);
    c.settle();
    c.engine.snapshot(chord(1), 1);
    c.render();
    c.synth.controllerChange.mockClear();
    c.engine.snapshot(chord(2), 2);
    expect(c.synth.controllerChange).not.toHaveBeenCalled();
    c.settle(0.04);
    expect(c.engine.active.size).toBe(256);
    expect([...c.engine.active.keys()].every((id) => id.startsWith("2:"))).toBe(
      true,
    );
    expect(c.sounding.size).toBe(256);
    c.engine.stop();
    c.settle();
    expect(c.sounding.size).toBe(0);
  });
  it("keeps instrument and pitch changes off a lane that is still fading", () => {
    const c = constant();
    c.engine.snapshot([voice], 0);
    c.settle();
    const before = c.engine.active.get(voice.id)!.channel;
    c.engine.snapshot(
      [{ ...voice, midi: 72, program: 73, percussion: true }],
      1,
    );
    const after = c.engine.active.get(voice.id)!.channel;
    expect(after).not.toBe(before);
    expect(c.sounding.has(before)).toBe(true);
    c.settle();
    expect(c.sounding.has(before)).toBe(false);
    expect(c.engine.active.get(voice.id)!.voice.midi).toBe(72);
  });
  it("shortens a normal release promptly when Escape interrupts playback", () => {
    const c = constant();
    c.engine.start(voice, 0);
    c.settle();
    c.engine.end(voice.id, 1);
    c.render();
    c.engine.stop();
    c.settle(0.025);
    expect(c.sounding.size).toBe(0);
  });
  it.each([44100, 48000, 96000])(
    "fades from the exact current value to zero at %i Hz",
    (rate) => {
      const c = constant(rate);
      c.engine.snapshot([voice], 0);
      c.settle();
      c.synth.controllerChange.mockClear();
      c.engine.snapshot([], 0.03);
      expect(c.synth.controllerChange).not.toHaveBeenCalled();
      const samples: number[] = [];
      for (let i = 0; i < Math.ceil((rate * FADE_SECONDS) / size) + 2; i++)
        samples.push(...c.render());
      expect(samples[0]).toBe(1);
      const length = Math.round(rate * FADE_SECONDS);
      expect(samples[length]).toBe(0);
      expect(samples.slice(length).every((v) => v === 0)).toBe(true);
      expect(samples.every((v, i) => i === 0 || v <= samples[i - 1])).toBe(
        true,
      );
      expect(
        Math.max(...samples.slice(1).map((v, i) => Math.abs(v - samples[i]))),
      ).toBeLessThan(1.51 / length);
      expect(c.synth.controllerChange).toHaveBeenCalledExactlyOnceWith(
        0,
        120,
        0,
      );
      expect(c.sounding.size).toBe(0);
    },
  );
  it("does not turn a partially started note up when it is released", () => {
    const c = constant(96000);
    c.engine.snapshot([voice], 0);
    const before = c.render();
    c.engine.snapshot([], 128 / 96000);
    const after = c.render();
    expect(after[0]).toBe(before.at(-1));
    expect(after.at(-1)).toBeLessThan(after[0]);
    c.settle();
    expect(c.sounding.size).toBe(0);
  });
  it("keeps the other unison unchanged and fades stop without extending it", () => {
    const c = constant();
    c.engine.snapshot([voice, { ...voice, id: "b" }], 0);
    c.settle();
    c.engine.snapshot([{ ...voice, id: "b" }], 1);
    expect(c.render()[0]).toBe(2);
    c.settle();
    expect(c.render().every((v) => v === 1)).toBe(true);
    expect(c.synth.noteOn).toHaveBeenCalledTimes(2);
    c.engine.stop();
    expect(c.engine.active.size).toBe(0);
    for (let i = 0; i < 9; i++) {
      c.engine.stop();
      c.render();
    }
    expect(c.sounding.size).toBe(0);
    expect(c.left.every((v) => v === 0)).toBe(true);
  });
  it("retains the normal Note Off, then fades before reclaiming its release", () => {
    const c = constant();
    c.engine.start(voice, 0);
    c.settle();
    c.engine.end(voice.id, 1);
    expect(c.synth.noteOff).toHaveBeenCalledExactlyOnceWith(0, 60);
    c.settle(RELEASE_SECONDS - 0.01);
    expect(c.left[0]).toBe(1);
    c.settle(0.04);
    expect(c.sounding.size).toBe(0);
  });
  it("bounds a burst, keeps only the latest requested chord, and never steals a tail", () => {
    const c = constant();
    const chord = (n: number) =>
      [voice, voice].map((v, i) => ({ ...v, id: `${n}:${i}` }));
    c.engine.snapshot(chord(0), 0);
    c.settle();
    c.engine.snapshot(chord(1), 1);
    c.render();
    c.synth.controllerChange.mockClear();
    for (let i = 2; i <= 10000; i++) c.engine.snapshot(chord(i), 1);
    expect(c.synth.controllerChange).not.toHaveBeenCalled();
    expect(c.synth.noteOn).toHaveBeenCalledTimes(4);
    c.settle(0.04);
    expect([...c.engine.active.keys()]).toEqual(["10000:0", "10000:1"]);
    expect(c.synth.noteOn).toHaveBeenCalledTimes(6);
    expect(c.sounding.size).toBe(2);
    c.engine.stop();
    c.settle();
    expect(c.sounding.size).toBe(0);
  });
  it("cancels queued voices on stop and recovers all lanes", () => {
    const c = constant(48000, 1);
    c.engine.snapshot([voice], 0);
    c.settle();
    c.engine.snapshot([{ ...voice, id: "b" }], 1);
    c.render();
    c.engine.snapshot([{ ...voice, id: "c" }], 1);
    c.engine.stop();
    c.settle();
    expect(c.synth.noteOn).toHaveBeenCalledTimes(2);
    c.engine.snapshot([voice], 2);
    c.settle();
    expect([...c.engine.active.keys()]).toEqual(["a"]);
    expect(c.sounding.size).toBe(1);
  });
  it("starts new notes at zero without losing the settled gain", () => {
    const c = constant();
    c.engine.snapshot([voice], 0);
    expect(c.render()[0]).toBe(0);
    c.settle(ATTACK_SECONDS);
    expect(c.render().every((v) => v === 1)).toBe(true);
  });
  it("makes mid-ramp master-volume reversals continuous and finite", () => {
    const gain = new SmoothGain(0.65);
    expect(gain.next()).toBe(0.65);
    gain.to(0, 864);
    for (let i = 0; i < 230; i++) gain.next();
    const before = gain.value;
    gain.to(1, 864);
    expect(gain.next()).toBe(before);
    for (let i = 0; i < 900; i++)
      expect(Number.isFinite(gain.next())).toBe(true);
    expect(gain.value).toBe(1);
  });
});

describe("actual SoundFont audio at transitions", () => {
  let bank: ReturnType<typeof SoundBankLoader.fromArrayBuffer>;
  beforeAll(async () => {
    const bytes = await readFile("public/GeneralUser-GS.sf2");
    bank = SoundBankLoader.fromArrayBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  });
  async function real(rate = 48000) {
    const synth = new SpessaSynthProcessor(rate, {
      effectsEnabled: false,
      eventsEnabled: false,
      maxBufferSize: size,
    });
    await synth.processorInitialized;
    synth.soundBankManager.addSoundBank(bank, "test");
    const smooth = new SmoothSynth(synth, rate, 16);
    const engine = new VoiceEngine(smooth, 8);
    const left = new Float32Array(size),
      right = new Float32Array(size);
    return {
      synth,
      engine,
      left,
      right,
      render() {
        engine.advance();
        smooth.process(left, right);
      },
    };
  }
  it("removes the hard-cut impulse at 800 different waveform phases", async () => {
    const configs = [
      {
        name: "Flute",
        program: 73,
        midi: 76,
        velocity: 83,
        expression: 64,
        volume: 76,
        pan: 72,
      },
      {
        name: "Piano",
        program: 0,
        midi: 60,
        velocity: 80,
        expression: 52,
        volume: 90,
        pan: 64,
      },
      { name: "Strings", program: 48, midi: 67 },
      { name: "Clarinet", program: 71, midi: 72 },
      { name: "Organ", program: 16, midi: 60 },
    ];
    const control = await real(),
      changed = await real();
    const summaries = [];
    let worstEnvelopeError = 0,
      worstFirstSampleError = 0;
    const median = (v: number[]) =>
      v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
    for (const config of configs) {
      const normalJumps = [],
        hardJumps = [],
        smoothJumps = [];
      for (let trial = 0; trial < 160; trial++) {
        control.engine.stop();
        changed.engine.stop();
        for (let b = 0; b < 9; b++) {
          control.render();
          changed.render();
        }
        const note = { ...voice, ...config };
        control.engine.snapshot([note], 0);
        changed.engine.snapshot([note], 0);
        const blocks = 40 + ((trial * 73 + 19) % 167);
        for (let b = 0; b < blocks; b++) {
          control.render();
          changed.render();
        }
        expect(changed.left).toEqual(control.left);
        const before = [changed.left[size - 1], changed.right[size - 1]];
        changed.engine.snapshot([], 0);
        for (let b = 0; b < 9; b++) {
          control.render();
          changed.render();
          if (b === 0) {
            normalJumps.push(
              Math.max(
                Math.abs(control.left[0] - before[0]),
                Math.abs(control.right[0] - before[1]),
              ),
            );
            hardJumps.push(Math.max(Math.abs(before[0]), Math.abs(before[1])));
            smoothJumps.push(
              Math.max(
                Math.abs(changed.left[0] - before[0]),
                Math.abs(changed.right[0] - before[1]),
              ),
            );
            worstFirstSampleError = Math.max(
              worstFirstSampleError,
              Math.abs(control.left[0] - changed.left[0]),
              Math.abs(control.right[0] - changed.right[0]),
            );
          }
          for (let i = 0; i < size; i++) {
            const t = Math.min(
              1,
              (b * size + i) / Math.round(48000 * FADE_SECONDS),
            );
            const gain = 1 - t * t * (3 - 2 * t);
            worstEnvelopeError = Math.max(
              worstEnvelopeError,
              Math.abs(changed.left[i] - control.left[i] * gain),
              Math.abs(changed.right[i] - control.right[i] * gain),
            );
          }
        }
        expect(changed.left.every((v) => v === 0)).toBe(true);
        expect(changed.synth.voiceCount).toBe(0);
      }
      summaries.push({
        instrument: config.name,
        trials: 160,
        medianNormalJump: median(normalJumps),
        medianHardCutJump: median(hardJumps),
        medianSmoothJump: median(smoothJumps),
      });
    }
    expect(worstFirstSampleError).toBe(0);
    expect(worstEnvelopeError).toBeLessThan(2e-8);
    await mkdir("artifacts/verification", { recursive: true });
    await writeFile(
      "artifacts/verification/smooth-audio-validation.json",
      JSON.stringify(
        {
          sampleRate: 48000,
          transitions: 800,
          fadeMilliseconds: FADE_SECONDS * 1000,
          attackMilliseconds: ATTACK_SECONDS * 1000,
          worstFirstSampleError,
          worstEnvelopeError,
          summaries,
        },
        null,
        2,
      ),
    );
  }, 60000);
  it.each([44100, 48000, 96000])(
    "fades every GM sound and percussion to exact silence at %i Hz",
    async (rate) => {
      const c = await real(rate);
      for (let program = 0; program < 129; program++) {
        c.engine.snapshot(
          [
            {
              ...voice,
              id: String(program),
              program: program % 128,
              percussion: program === 128,
              midi: program === 128 ? 38 : 60,
            },
          ],
          0,
        );
        for (let i = 0; i < 40; i++) c.render();
        c.engine.stop();
        for (let i = 0; i < Math.ceil((rate * FADE_SECONDS) / size) + 2; i++)
          c.render();
        expect(c.left.every((v) => v === 0)).toBe(true);
        expect(c.right.every((v) => v === 0)).toBe(true);
        expect(c.synth.voiceCount).toBe(0);
      }
    },
    30000,
  );
});
