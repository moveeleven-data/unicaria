import { afterEach, expect, it, vi } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { EngineMessage } from "../src/audio/protocol";

afterEach(() => vi.unstubAllGlobals());

it("runs rapid full-worklet chord changes, retains bass, and drains every stop", async () => {
  let processor: any;
  let ready!: () => void;
  const initialized = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const replies: any[] = [];
  vi.stubGlobal("sampleRate", 48000);
  vi.stubGlobal("currentTime", 0);
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      port = {
        onmessage: undefined,
        postMessage: (m: any) => {
          replies.push(m);
          if (m.type === "ready") ready();
        },
      };
    },
  );
  vi.stubGlobal("registerProcessor", (_name: string, Constructor: any) => {
    processor = new Constructor();
  });
  await import("../src/audio/processor");
  const bytes = await readFile("public/GeneralUser-GS.sf2");
  const send = (m: EngineMessage) => processor.port.onmessage({ data: m });
  send({
    type: "load",
    bank: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  });
  await initialized;
  const noteOn = vi.spyOn(processor.synth, "noteOn");
  const voice = {
    id: "held-bass",
    staffId: "bass",
    midi: 36,
    program: 16,
    percussion: false,
    velocity: 83,
    expression: 64,
    volume: 76,
    pan: 72,
  };
  const left = new Float32Array(128),
    right = new Float32Array(128);
  const outputs = [[left, right]];
  const timings: number[] = [];
  let frame = 0,
    sequence = 0,
    peak = 0;
  const render = () => {
    vi.stubGlobal("currentTime", (frame * 128) / 48000);
    const start = performance.now();
    processor.process([], outputs);
    timings.push(performance.now() - start);
    frame++;
    for (let i = 0; i < 128; i++) {
      expect(Number.isFinite(left[i]) && Number.isFinite(right[i])).toBe(true);
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
  };
  send({ type: "volume", volume: 0.65 });
  for (let block = 0; block < 2000; block++) {
    if (block % 4 === 0) {
      const group = Math.floor(block / 4);
      const chord = Array.from({ length: 16 }, (_, i) => ({
        ...voice,
        id: `${group}:${i}`,
        staffId: String(i),
        midi: 48 + i + (group % 7),
        program: [0, 48, 71, 73][i % 4],
      }));
      send({
        type: "snapshot",
        epoch: 1,
        sequence: ++sequence,
        voices: [voice, ...chord],
        retrigger: false,
      });
    }
    render();
  }
  expect(noteOn.mock.calls.filter((c) => c[1] === 36)).toHaveLength(1);
  expect(processor.engine.active.size).toBe(17);
  expect(replies.some((m) => m.type === "error" || m.type === "expired")).toBe(
    false,
  );
  expect(peak).toBeGreaterThan(0.005);
  expect(peak).toBeLessThan(1);
  send({ type: "stop", epoch: 2 });
  for (let i = 0; i < 10; i++) render();
  expect(processor.synth.voiceCount).toBe(0);
  expect(left.every((v) => v === 0) && right.every((v) => v === 0)).toBe(true);
  const count = noteOn.mock.calls.length;
  send({
    type: "snapshot",
    epoch: 1,
    sequence: 9999,
    voices: [voice],
    retrigger: false,
  });
  render();
  expect(noteOn.mock.calls.length).toBe(count);
  // A new valid session can start immediately after the old one drains.
  send({
    type: "snapshot",
    epoch: 2,
    sequence: 1,
    voices: [voice],
    retrigger: false,
  });
  for (let i = 0; i < 20; i++) render();
  expect(left.some((v) => v !== 0)).toBe(true);
  send({ type: "stop", epoch: 3 });
  for (let i = 0; i < 10; i++) render();
  expect(processor.synth.voiceCount).toBe(0);
  // Emulate a fast pointer jump over 24 sixteenths, then let the audio clock
  // render every intermediate slice. The bass must attack only once.
  const sweepStart = noteOn.mock.calls.length;
  const frames = Array.from({ length: 24 }, (_, i) => [
    voice,
    { ...voice, id: `sweep-${i}`, midi: 60 + (i % 12), program: 73 },
  ]);
  send({ type: "sweep", epoch: 3, sequence: 1, direction: 1, frames });
  let audibleSweepBlocks = 0;
  for (let i = 0; i < 180; i++) {
    if (i % 25 === 0) send({ type: "heartbeat", epoch: 3 });
    render();
    if (left.some((v) => Math.abs(v) > 0.00001)) audibleSweepBlocks++;
  }
  const sweepCalls = noteOn.mock.calls.slice(sweepStart);
  expect(sweepCalls.filter((c) => c[1] === 36)).toHaveLength(1);
  expect(sweepCalls.filter((c) => Number(c[1]) >= 60)).toHaveLength(24);
  expect(audibleSweepBlocks).toBeGreaterThan(150);
  send({ type: "stop", epoch: 4 });
  for (let i = 0; i < 10; i++) render();
  expect(processor.synth.voiceCount).toBe(0);
  expect(left.every((v) => v === 0)).toBe(true);
  const sorted = timings.slice(50).sort((a, b) => a - b);
  await mkdir("artifacts/verification", { recursive: true });
  await writeFile(
    "artifacts/verification/worklet-audio-validation.json",
    JSON.stringify(
      {
        sampleRate: 48000,
        blockFrames: 128,
        blockBudgetMs: (128 / 48000) * 1000,
        chordChanges: 500,
        notesPerChord: 17,
        heldBassAttacks: 1,
        sweptShortNotes: 24,
        sweptShortNotesHeard: 24,
        sweepBassAttacks: 1,
        audibleSweepBlocks,
        renderMedianMs: sorted[Math.floor(sorted.length * 0.5)],
        renderP99Ms: sorted[Math.floor(sorted.length * 0.99)],
        renderMaxMs: sorted.at(-1),
        peak,
        errors: replies.filter((m) => m.type === "error"),
        stoppedOutput: "exact digital silence",
        staleSnapshot: "rejected",
        timingCaveat:
          "Node test-process timings; not a browser audio deadline or hardware latency measurement",
      },
      null,
      2,
    ),
  );
}, 30000);
