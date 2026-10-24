import { describe, it, expect } from "vitest";
import {
  beats,
  blankScore,
  duration,
  id,
  nextCursor,
  pitchFromMidi,
  putNote,
  type Score,
} from "../src/core/model";
import { add, rat } from "../src/core/rational";
import { parseScore, validateScore } from "../src/core/validation";
import { demoScore } from "../src/core/demo";
import {
  compilePerformance,
  roadmap,
  ScoreIndex,
} from "../src/performance/compiler";
import { VoiceEngine, type SynthPort } from "../src/audio/voice-engine";
import { exportMidi } from "../src/files/midi";
import { parseMidi } from "midi-file";
import {
  hitTest,
  timeAtX,
  xAtTime,
  type MeasureBox,
} from "../src/engraving/geometry";
import { fillGaps } from "../src/engraving/rhythm";

function fixture() {
  const s = blankScore();
  s.measures = s.measures.slice(0, 3);
  s.tempo = 120;
  return s;
}
function note(
  s: Score,
  staff: number,
  bar: number,
  offset: number,
  base: number,
  pitches: number[],
  voice = 0,
) {
  return putNote(
    s,
    {
      staffId: s.staves[staff].id,
      measureId: s.measures[bar].id,
      offset: rat(offset),
      voice,
    },
    duration(base),
    pitches.map(pitchFromMidi),
  );
}
const all = { mode: "all" as const, staffId: "", pedal: false };
describe("editing and export regressions", () => {
  it("does not wrap note entry onto the beginning of the final measure", () => {
    const s = fixture(),
      c = {
        staffId: s.staves[0].id,
        measureId: s.measures.at(-1)!.id,
        voice: 0,
        offset: rat(3),
      };
    expect(nextCursor(s, c, rat(1)).offset).toEqual(rat(4));
  });
  it("rejects cyclic ties in imported documents", () => {
    const s = fixture(),
      a = note(s, 0, 0, 0, 2, [60]),
      b = note(s, 0, 0, 2, 2, [60]);
    a.tieTo = b.id;
    b.tieTo = a.id;
    expect(() => validateScore(s)).toThrow("forward");
  });
  it("rejects out-of-range expression endpoints", () => {
    const s = fixture();
    s.marks.push({
      id: id(),
      kind: "hairpin",
      measureId: s.measures[0].id,
      offset: rat(0),
      endMeasureId: s.measures[0].id,
      endOffset: rat(8),
      text: "cresc.",
      amount: 40,
      target: 100,
    });
    expect(() => validateScore(s)).toThrow("endpoint");
  });
  it("ends an octave line instead of transposing all subsequent notes", () => {
    const s = fixture();
    note(s, 0, 0, 0, 2, [60]);
    note(s, 0, 0, 2, 2, [60]);
    s.marks.push({
      id: id(),
      kind: "ottava",
      measureId: s.measures[0].id,
      offset: rat(0),
      endMeasureId: s.measures[0].id,
      endOffset: rat(2),
      text: "8va",
      amount: 12,
    });
    const idx = new ScoreIndex(s);
    expect(idx.at(1, all)[0].midi).toBe(72);
    expect(idx.at(2, all)[0].midi).toBe(60);
  });
  it("renders missing triplet notes as triplet rests with exact timing", () => {
    const s = fixture(),
      n = note(s, 0, 0, 0, 8, [60]);
    n.duration.tuplets = [{ actual: 3, normal: 2 }];
    const filled = fillGaps([n], rat(4));
    expect(filled.slice(0, 3).map((g) => g.span)).toEqual([
      rat(1, 3),
      rat(1, 3),
      rat(1, 3),
    ]);
    expect(filled[2].tuplets).toEqual(n.duration.tuplets);
    expect(filled.reduce((sum, g) => add(sum, g.span), rat(0))).toEqual(rat(4));
  });
  it("exports nested tuplets on an exact MIDI grid", () => {
    const s = fixture(),
      n = note(s, 0, 0, 0, 8, [60]);
    n.duration.tuplets = [
      { actual: 3, normal: 2 },
      { actual: 3, normal: 2 },
    ];
    expect(exportMidi(s).ppq % 9).toBe(0);
  });
  it("plays a chord grace group only once and keeps long grace sequences inside the note", () => {
    const s = fixture(),
      n = note(s, 0, 0, 0, 4, [60, 64, 67]);
    n.grace = Array.from({ length: 12 }, (_, i) => pitchFromMidi(50 + i));
    const p = compilePerformance(new ScoreIndex(s));
    expect(p.voices.filter((v) => v.id.includes(":g"))).toHaveLength(12);
    expect(p.voices.every((v) => v.end > v.start && v.end <= 1)).toBe(true);
  });
  it("uses the diatonic upper neighbor for a trill", () => {
    const s = fixture();
    note(s, 0, 0, 0, 4, [64]).articulation = "trill";
    const p = compilePerformance(new ScoreIndex(s));
    expect(p.voices[1].midi).toBe(65);
  });
});
describe("exact musical model", () => {
  it.each([3, 5, 7, 11])("closes a %i-note tuplet exactly", (actual) => {
    const d = duration(8, 0, [{ actual, normal: 2 }]);
    let sum = rat(0);
    for (let i = 0; i < actual; i++) sum = add(sum, beats(d));
    expect(sum).toEqual(rat(1));
  });
  it("multiplies nested ratios without drift", () => {
    const d = duration(8, 0, [
      { actual: 3, normal: 2 },
      { actual: 3, normal: 2 },
    ]);
    expect(beats(d)).toEqual(rat(2, 9));
  });
  it("handles dots exactly", () => {
    expect(beats(duration(4, 2))).toEqual(rat(7, 4));
  });
  it("replaces only the selected voice", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    note(s, 0, 0, 0, 4, [72], 1);
    note(s, 0, 0, 0, 2, [64]);
    expect(s.notes).toHaveLength(2);
    expect(s.notes.find((n) => n.voice === 1)?.pitches[0]).toEqual(
      pitchFromMidi(72),
    );
  });
  it("rejects bar overflow", () => {
    const s = fixture();
    expect(() => note(s, 0, 0, 3, 2, [60])).toThrow("barline");
  });
  it("round-trips an editable score without losing tuplets or expressions", () => {
    const s = demoScore();
    expect(parseScore(JSON.stringify(s))).toEqual(s);
  });
  it("validates the example score", () =>
    expect(() => validateScore(demoScore())).not.toThrow());
  it.each(["format", "version", "tempo"])("rejects corrupted %s", (field) => {
    const s = fixture();
    (s as any)[field] = null;
    expect(() => parseScore(JSON.stringify(s))).toThrow();
  });
  it("rejects duplicate identities", () => {
    const s = fixture();
    s.staves[1].id = s.staves[0].id;
    expect(() => validateScore(s)).toThrow("duplicate");
  });
  it("rejects overlapping events on one voice", () => {
    const s = fixture();
    const n = note(s, 0, 0, 0, 1, [60]);
    s.notes.push({
      ...structuredClone(n),
      id: id(),
      offset: rat(1),
      duration: duration(4),
    });
    expect(() => validateScore(s)).toThrow("overlapping");
  });
  it("invalidates ties when replacing their destination", () => {
    const s = fixture();
    const a = note(s, 0, 0, 0, 2, [60]),
      b = note(s, 0, 0, 2, 2, [60]);
    a.tieTo = b.id;
    note(s, 0, 0, 2, 4, [62]);
    expect(a.tieTo).toBeUndefined();
  });
});
describe("vertical harmonic audition", () => {
  it("includes a sustained bass under every melody note", () => {
    const s = fixture();
    note(s, 1, 0, 0, 1, [48]);
    for (let i = 0; i < 4; i++) note(s, 0, 0, i, 4, [72 + i]);
    const idx = new ScoreIndex(s);
    for (let i = 0; i < 4; i++)
      expect(
        idx
          .at(i + 0.2, all)
          .map((v) => v.midi)
          .sort(),
      ).toEqual([48, 72 + i]);
  });
  it("can enter in the middle of a held note", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    expect(new ScoreIndex(s).at(3.8, all).map((v) => v.midi)).toEqual([60]);
  });
  it("uses half-open intervals at shared boundaries", () => {
    const s = fixture();
    note(s, 0, 0, 0, 4, [60]);
    note(s, 0, 0, 1, 4, [62]);
    const idx = new ScoreIndex(s);
    expect(idx.at(1, all).map((v) => v.midi)).toEqual([62]);
    expect(idx.at(2, all)).toEqual([]);
  });
  it("retains a single identity across a tie and barline", () => {
    const s = fixture();
    const a = note(s, 0, 0, 0, 1, [60]),
      b = note(s, 0, 1, 0, 1, [60]);
    a.tieTo = b.id;
    const idx = new ScoreIndex(s);
    expect(idx.at(3.9, all)[0].id).toBe(idx.at(4.1, all)[0].id);
    expect(idx.spans).toHaveLength(1);
  });
  it("preserves repeated-note identity changes", () => {
    const s = fixture();
    note(s, 0, 0, 0, 4, [60]);
    note(s, 0, 0, 1, 4, [60]);
    const idx = new ScoreIndex(s);
    expect(idx.at(0.5, all)[0].id).not.toBe(idx.at(1.5, all)[0].id);
  });
  it("keeps overlapping unisons independent", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    note(s, 0, 0, 0, 2, [60], 1);
    const idx = new ScoreIndex(s);
    expect(idx.at(1, all)).toHaveLength(2);
    expect(idx.at(3, all)).toHaveLength(1);
  });
  it("has no traversal history when moving backward", () => {
    const s = demoScore(),
      idx = new ScoreIndex(s);
    const expected = idx.at(1, all);
    for (const t of [28, 6, 15, 0, 29, 4]) idx.at(t, all);
    expect(idx.at(1, all)).toEqual(expected);
  });
  it("does not repeat the first chord when crossing a barline", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    note(s, 0, 1, 0, 1, [67]);
    const idx = new ScoreIndex(s);
    expect(idx.at(4, all).map((v) => v.midi)).toEqual([67]);
  });
  it("filters by staff without changing musical time", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [72]);
    note(s, 1, 0, 0, 1, [48]);
    expect(
      new ScoreIndex(s)
        .at(1, { ...all, mode: "staff", staffId: s.staves[1].id })
        .map((v) => v.midi),
    ).toEqual([48]);
  });
  it("instrument scope includes both piano staves", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [72]);
    note(s, 1, 0, 0, 1, [48]);
    expect(
      new ScoreIndex(s).at(1, {
        ...all,
        mode: "instrument",
        staffId: s.staves[0].id,
      }),
    ).toHaveLength(2);
  });
  it("mute overrides solo", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    s.instruments[0].mute = true;
    s.instruments[0].solo = true;
    expect(new ScoreIndex(s).at(0, all)).toEqual([]);
  });
  it("sounds transposing instruments at concert pitch", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    s.instruments[0].transpose = -2;
    expect(new ScoreIndex(s).at(0, all)[0].midi).toBe(58);
  });
  it("reconstructs dynamics backward", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    s.marks.push(
      {
        id: id(),
        kind: "dynamic",
        measureId: s.measures[0].id,
        offset: rat(0),
        text: "p",
        amount: 40,
      },
      {
        id: id(),
        kind: "dynamic",
        measureId: s.measures[0].id,
        offset: rat(2),
        text: "f",
        amount: 100,
      },
    );
    const idx = new ScoreIndex(s);
    expect(idx.at(3, all)[0].expression).toBe(100);
    expect(idx.at(1, all)[0].expression).toBe(40);
  });
  it("updates a crescendo while the same note remains held", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    s.marks.push({
      id: id(),
      kind: "hairpin",
      measureId: s.measures[0].id,
      offset: rat(0),
      endMeasureId: s.measures[0].id,
      endOffset: rat(4),
      text: "cresc.",
      amount: 40,
      target: 100,
    });
    const idx = new ScoreIndex(s);
    expect(idx.at(1, all)[0].id).toBe(idx.at(3, all)[0].id);
    expect(idx.at(3, all)[0].expression).toBeGreaterThan(
      idx.at(1, all)[0].expression,
    );
  });
  it("includes pedal-carried notes without accumulating visited chords", () => {
    const s = fixture();
    note(s, 0, 0, 0, 4, [60]);
    note(s, 0, 0, 1, 4, [64]);
    s.marks.push({
      id: id(),
      kind: "pedal",
      measureId: s.measures[0].id,
      offset: rat(0),
      endMeasureId: s.measures[0].id,
      endOffset: rat(3),
      text: "Ped.",
      amount: 1,
    });
    const idx = new ScoreIndex(s);
    expect(idx.at(2.5, { ...all, pedal: true })).toHaveLength(2);
    expect(idx.at(0.5, { ...all, pedal: true })).toHaveLength(1);
    expect(idx.at(3, { ...all, pedal: true })).toHaveLength(0);
    expect(idx.at(2.5, all)).toHaveLength(0);
  });
  it("does not resurrect a note released before pedal-down", () => {
    const s = fixture();
    note(s, 0, 0, 0, 4, [60]);
    s.marks.push({
      id: id(),
      kind: "pedal",
      measureId: s.measures[0].id,
      offset: rat(2),
      endMeasureId: s.measures[0].id,
      endOffset: rat(4),
      text: "Ped.",
      amount: 1,
    });
    expect(new ScoreIndex(s).at(2.5, { ...all, pedal: true })).toHaveLength(0);
  });
  it("keeps staccato available for slow harmonic inspection", () => {
    const s = fixture();
    note(s, 0, 0, 0, 4, [60]).articulation = "staccato";
    expect(new ScoreIndex(s).at(0.9, all)).toHaveLength(1);
  });
  it("does not change an existing held voice to a later patch", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]);
    note(s, 1, 0, 2, 2, [72]);
    s.marks.push({
      id: id(),
      kind: "program",
      measureId: s.measures[0].id,
      offset: rat(2),
      text: "new",
      amount: 40,
    });
    const voices = new ScoreIndex(s).at(3, all);
    expect(voices.map((v) => v.program).sort()).toEqual([0, 40]);
  });
  it("ignores non-rhythmic grace pitches in the principal slice", () => {
    const s = fixture();
    note(s, 0, 0, 0, 1, [60]).grace = [pitchFromMidi(62)];
    expect(new ScoreIndex(s).at(0, all).map((v) => v.midi)).toEqual([60]);
  });
  it("returns silence outside the score", () => {
    const idx = new ScoreIndex(demoScore());
    expect(idx.at(-1, all)).toEqual([]);
    expect(idx.at(idx.length, all)).toEqual([]);
  });
});
describe("voice ownership", () => {
  function setup() {
    const calls: { type: string; args: any[] }[] = [];
    const synth: SynthPort = {
      noteOn: (...args) => calls.push({ type: "on", args }),
      noteOff: (...args) => calls.push({ type: "off", args }),
      controllerChange: (...args) => calls.push({ type: "cc", args }),
      programChange: (...args) => calls.push({ type: "program", args }),
      setDrums: (...args) => calls.push({ type: "drums", args }),
      release: (...args) => calls.push({ type: "release", args }),
      isSilent: () => true,
      stopAll: () => calls.push({ type: "stop", args: [] }),
    };
    const engine = new VoiceEngine(synth, 8);
    const voice = {
      id: "a",
      staffId: "staff",
      midi: 60,
      program: 0,
      percussion: false,
      velocity: 90,
      expression: 80,
      volume: 90,
      pan: 64,
    };
    return { engine, calls, voice };
  }
  it("does not retrigger unchanged voices", () => {
    const { engine, calls, voice } = setup();
    engine.snapshot([voice], 0);
    engine.snapshot([voice], 1);
    expect(calls.filter((c) => c.type === "on")).toHaveLength(1);
  });
  it("allocates independent channels to unisons", () => {
    const { engine, calls, voice } = setup();
    engine.snapshot([voice, { ...voice, id: "b" }], 0);
    const channels = calls.filter((c) => c.type === "on").map((c) => c.args[0]);
    expect(new Set(channels).size).toBe(2);
    engine.snapshot([{ ...voice, id: "b" }], 1);
    expect(engine.active.has("b")).toBe(true);
    expect(engine.active.size).toBe(1);
  });
  it("updates retained voice expression without an attack", () => {
    const { engine, calls, voice } = setup();
    engine.snapshot([voice], 0);
    engine.snapshot([{ ...voice, expression: 100 }], 1);
    expect(calls.filter((c) => c.type === "on")).toHaveLength(1);
    expect(
      calls.some(
        (c) => c.type === "cc" && c.args[1] === 11 && c.args[2] === 100,
      ),
    ).toBe(true);
  });
  it("rearticulates the same pitch with a new identity", () => {
    const { engine, calls, voice } = setup();
    engine.snapshot([voice], 0);
    engine.snapshot([{ ...voice, id: "b" }], 1);
    expect(calls.filter((c) => c.type === "on")).toHaveLength(2);
  });
  it("clears every owned voice on stop", () => {
    const { engine, calls, voice } = setup();
    engine.snapshot([voice], 0);
    engine.stop();
    expect(engine.active.size).toBe(0);
    expect(calls.at(-1)?.type).toBe("stop");
  });
  it("does not leak lanes after 10,000 movements", () => {
    const { engine, voice } = setup();
    for (let j = 0; j < 10000; j++)
      engine.snapshot([{ ...voice, id: String(j) }], j * 0.01);
    expect(engine.active.size).toBe(1);
    engine.snapshot([], 101);
    expect(engine.active.size).toBe(0);
  });
  it("can explicitly reattack a decayed chord", () => {
    const { engine, calls, voice } = setup();
    engine.snapshot([voice], 0);
    engine.snapshot([voice], 1, true);
    expect(calls.filter((c) => c.type === "on")).toHaveLength(2);
  });
});
describe("timed interpretation and MIDI export", () => {
  it("maps constant tempo into elapsed seconds", () => {
    const s = fixture();
    const p = compilePerformance(new ScoreIndex(s));
    expect(p.duration).toBeCloseTo(6, 8);
    expect(p.secondsAt(4)).toBeCloseTo(2, 8);
  });
  it("renders staccato shorter than its notated duration", () => {
    const s = fixture();
    note(s, 0, 0, 0, 4, [60]).articulation = "staccato";
    const p = compilePerformance(new ScoreIndex(s));
    expect(p.voices[0].end - p.voices[0].start).toBeCloseTo(0.48);
  });
  it("follows simple repeats", () => {
    const s = fixture();
    s.measures[0].repeatStart = true;
    s.measures[1].repeatEnd = true;
    expect(roadmap(s).map((o) => o.measureIndex)).toEqual([0, 1, 0, 1, 2]);
  });
  it("follows first and second endings", () => {
    const s = fixture();
    s.measures[0].repeatStart = true;
    s.measures[1].ending = 1;
    s.measures[1].repeatEnd = true;
    s.measures[2].ending = 2;
    expect(roadmap(s).map((o) => o.measureIndex)).toEqual([0, 1, 0, 2]);
  });
  it("slows playback for an explicit ritardando", () => {
    const s = fixture();
    s.marks.push({
      id: id(),
      kind: "tempoRamp",
      measureId: s.measures[0].id,
      offset: rat(0),
      endMeasureId: s.measures[1].id,
      endOffset: rat(0),
      amount: 120,
      target: 60,
      text: "rit.",
    });
    const p = compilePerformance(new ScoreIndex(s));
    expect(p.secondsAt(4)).toBeCloseTo(4 * Math.log(2), 3);
    expect(p.duration).toBeGreaterThan(10);
  });
  it("exports a valid Type 1 MIDI file with named tracks and tempo", () => {
    const parsed = parseMidi(exportMidi(demoScore()).bytes);
    expect(parsed.header.format).toBe(1);
    expect(parsed.header.ticksPerBeat).toBeGreaterThanOrEqual(960);
    expect(parsed.tracks[0].some((e) => e.type === "setTempo")).toBe(true);
    expect(parsed.tracks.flat().some((e) => e.type === "noteOn")).toBe(true);
  });
  it("exports ties as a single note attack", () => {
    const s = fixture(),
      a = note(s, 0, 0, 0, 1, [60]),
      b = note(s, 0, 1, 0, 1, [60]);
    a.tieTo = b.id;
    const parsed = parseMidi(exportMidi(s).bytes);
    expect(
      parsed.tracks.flat().filter((e) => e.type === "noteOn"),
    ).toHaveLength(1);
  });
  it("uses additional ports rather than wrapping independent instruments", () => {
    const s = fixture();
    for (let j = 0; j < 17; j++) {
      const inst = { ...s.instruments[0], id: id(), program: j };
      s.instruments.push(inst);
      const staff = { ...s.staves[0], id: id(), instrumentId: inst.id };
      s.staves.push(staff);
      note(s, s.staves.length - 1, 0, 0, 1, [60]);
    }
    const result = exportMidi(s);
    expect(result.ports).toBe(2);
    expect(result.warnings[0]).toContain("2 MIDI ports");
  });
  it("exports septuplet starts without accumulation error", () => {
    const s = fixture();
    for (let j = 0; j < 7; j++)
      putNote(
        s,
        {
          staffId: s.staves[0].id,
          measureId: s.measures[0].id,
          offset: rat(j * 4, 7),
          voice: 0,
        },
        duration(4, 0, [{ actual: 7, normal: 4 }]),
        [pitchFromMidi(60 + j)],
      );
    const result = exportMidi(s),
      parsed = parseMidi(result.bytes);
    let tick = 0;
    const onsets: number[] = [];
    for (const e of parsed.tracks[1]) {
      tick += e.deltaTime;
      if (e.type === "noteOn") onsets.push(tick);
    }
    expect(onsets).toEqual(
      Array.from({ length: 7 }, (_, i) => (i * result.ppq * 4) / 7),
    );
  });
  it("repeats the same performance deterministically", () => {
    const s = demoScore();
    expect(exportMidi(s).bytes).toEqual(exportMidi(s).bytes);
  });
});
describe("engraved geometry", () => {
  const box: MeasureBox = {
    measureId: "m",
    measureIndex: 0,
    start: 0,
    length: 4,
    x: 0,
    endX: 500,
    top: 0,
    bottom: 150,
    anchors: [
      { x: 50, time: 0 },
      { x: 250, time: 1 },
      { x: 320, time: 2 },
      { x: 490, time: 4 },
    ],
    staves: [
      { id: "staff", top: 0, bottom: 140, lineBottom: 100, clef: "treble" },
    ],
  };
  it("uses rhythmic anchors rather than the measure width", () => {
    expect(timeAtX(box, 250)).toBe(1);
    expect(timeAtX(box, 320)).toBe(2);
  });
  it("inverts the coordinate transform within each segment", () => {
    for (const time of [0, 0.3, 1, 1.6, 2, 3, 4])
      expect(timeAtX(box, xAtTime(box, time))).toBeCloseTo(time, 8);
  });
  it("treats a score margin as silence", () => {
    expect(
      hitTest({ width: 500, height: 150, measures: [box], notes: [] }, -10, 50),
    ).toBeUndefined();
  });
});
