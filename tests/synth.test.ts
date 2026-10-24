import { beforeAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";
describe("real bundled SoundFont synthesis", () => {
  let synth: SpessaSynthProcessor;
  const left = new Float32Array(128),
    right = new Float32Array(128);
  const energy = (blocks = 50) => {
    let sum = 0;
    for (let b = 0; b < blocks; b++) {
      left.fill(0);
      right.fill(0);
      synth.process(left, right);
      for (let j = 0; j < 128; j++)
        sum += left[j] * left[j] + right[j] * right[j];
    }
    return sum;
  };
  beforeAll(async () => {
    const bytes = await readFile("public/GeneralUser-GS.sf2");
    synth = new SpessaSynthProcessor(48000, {
      effectsEnabled: false,
      eventsEnabled: false,
    });
    await synth.processorInitialized;
    synth.soundBankManager.addSoundBank(
      SoundBankLoader.fromArrayBuffer(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
      "test",
    );
  }, 30000);
  it("generates nonzero audio for every GM program", () => {
    const missing: number[] = [];
    for (let program = 0; program < 128; program++) {
      synth.stopAllChannels(true);
      synth.programChange(0, program);
      synth.noteOn(0, 60, 100);
      if (energy(100) < 1e-7) missing.push(program);
    }
    expect(missing).toEqual([]);
  }, 30000);
  it("generates a percussion hit", () => {
    synth.stopAllChannels(true);
    synth.midiChannels[9].setDrums(true);
    synth.noteOn(9, 38, 100);
    expect(energy()).toBeGreaterThan(0.001);
  });
  it("panic produces silence", () => {
    synth.stopAllChannels(true);
    expect(energy(20)).toBeLessThan(1e-10);
  });
  it("allows one unison to end while another channel continues", () => {
    synth.stopAllChannels(true);
    synth.programChange(0, 16);
    synth.programChange(1, 16);
    synth.noteOn(0, 60, 100);
    synth.noteOn(1, 60, 100);
    energy(20);
    synth.controllerChange(0, 120, 0);
    expect(energy()).toBeGreaterThan(0.01);
    synth.stopAllChannels(true);
  });
});
