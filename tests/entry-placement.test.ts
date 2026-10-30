import { describe, expect, it } from "vitest";
import {
  blankScore,
  transposeKey,
  duration,
  id,
  midiPitch,
  type NoteEvent,
  type Pitch,
} from "../src/core/model";
import { rat, value } from "../src/core/rational";
import { hitTest, type Layout } from "../src/engraving/geometry";
import { entryPlacement, pitchY, removePitch } from "../src/ui/entryPlacement";
import { cleanLinks, enterNote } from "../src/core/editing";

function fixture() {
  const score = blankScore(),
    staffId = score.staves[0].id,
    measureId = score.measures[0].id;
  const layout: Layout = {
    width: 1000,
    height: 500,
    notes: [],
    measures: [
      {
        measureId,
        measureIndex: 0,
        start: 0,
        length: 4,
        x: 0,
        endX: 1000,
        top: 0,
        bottom: 400,
        anchors: [
          { x: 0, time: 0 },
          { x: 1000, time: 4 },
        ],
        staves: [
          { id: staffId, clef: "treble", top: 0, bottom: 400, lineBottom: 180 },
        ],
      },
    ],
  };
  const add = (pitches: Pitch[], offset = 1, voice = 0) => {
    const n: NoteEvent = {
      id: id(),
      staffId,
      measureId,
      offset: rat(offset),
      voice,
      pitches,
      duration: duration(),
      articulation: "",
    };
    score.notes.push(n);
    layout.notes.push({
      id: n.id,
      x: offset * 250,
      y: 150,
      offset: n.offset,
      staffId,
      measureId,
    });
    return n;
  };
  const at = (
    x: number,
    y = 155,
    d = duration(),
    voice = 0,
    accidental?: number,
    concert = false,
  ) =>
    entryPlacement(
      score,
      layout,
      hitTest(layout, x, y)!,
      d,
      voice,
      accidental,
      concert,
    );
  return { score, layout, add, at };
}
const c: Pitch = { step: "C", octave: 5, alter: 0 },
  e: Pitch = { step: "E", octave: 5, alter: 0 },
  g: Pitch = { step: "G", octave: 5, alter: 0 };

describe("visible, exact mouse entry targets", () => {
  it("snaps preview and committed note to the same pitch and beat", () => {
    const { score, at } = fixture(),
      p = at(300);
    expect(p.at.offset).toEqual(rat(1));
    expect(p.pitch).toEqual(c);
    expect(p.x).toBe(250);
    expect(p.y).toBe(155);
    const n = enterNote(score, p.at, duration(), [p.pitch])[0];
    expect(n.offset).toEqual(p.at.offset);
    expect(n.pitches).toEqual([c]);
  });
  it("keeps triplet positions rational at the last slot of a bar", () => {
    const { at } = fixture();
    expect(
      at(999, 150, duration(8, 0, [{ actual: 3, normal: 2 }])).at.offset,
    ).toEqual(rat(11, 3));
  });
  it("allows a dotted note to start on the last grid slot and tie over the bar", () => {
    const { score, at } = fixture(),
      d = duration(4, 1),
      p = at(999, 150, d);
    expect(p.at.offset).toEqual(rat(3));
    const notes = enterNote(score, p.at, d, [p.pitch]);
    expect(notes).toHaveLength(2);
    expect(notes[0].tieTo).toBe(notes[1].id);
  });
  it("a duration longer than a pickup starts at zero instead of a negative offset", () => {
    const { layout, at } = fixture();
    layout.measures[0].length = 0.5;
    layout.measures[0].anchors[1].time = 0.5;
    expect(value(at(999, 150, duration(1)).at.offset)).toBe(0);
  });
  it("targets an existing event only in the active layer", () => {
    const { add, at } = fixture();
    const n = add([c], 1, 1);
    expect(at(255).existing).toBeUndefined();
    expect(at(255, 150, duration(), 1).existing?.id).toBe(n.id);
  });
  it("locates the actual chord tone rather than always its first pitch", () => {
    const { add, at } = fixture();
    add([c, e, g]);
    expect(at(255, 135).pitchIndex).toBe(2);
    expect(at(255, 145).pitchIndex).toBe(1);
  });
  it("recognizes rests as replaceable events", () => {
    const { add, at } = fixture();
    const n = add([]);
    expect(at(255).existing?.id).toBe(n.id);
    expect(at(255).pitch).toEqual(c);
  });
  it("uses the hovered measure's key signature", () => {
    const { score, at } = fixture();
    score.measures[0].key = "G";
    expect(at(500, 140).pitch).toEqual({ step: "F", octave: 5, alter: 1 });
  });
  it("keeps an existing enharmonic key when no transposition is needed", () => {
    expect(transposeKey("Cb", 0)).toBe("Cb");
    expect(transposeKey("C#", 0)).toBe("C#");
  });
  it("carries accidentals forward only within their measure and octave", () => {
    const { add, at } = fixture();
    add([{ ...c, alter: 1 }], 1);
    expect(at(100).pitch.alter).toBe(0);
    expect(at(750).pitch.alter).toBe(1);
    expect(at(750, 190).pitch.alter).toBe(0);
    expect(at(750, 155, duration(), 0, 0).pitch.alter).toBe(0);
  });
  it("natural overrides a key signature's sharp", () => {
    const { score, at } = fixture();
    score.measures[0].key = "G";
    expect(at(500, 140, duration(), 0, 0).pitch.alter).toBe(0);
  });
  it("concert-pitch mouse entry converts back to the written pitch stored in the score", () => {
    const { score, at } = fixture();
    score.instruments[0].transpose = -2;
    const p = at(500, 155, duration(), 0, 0, true);
    expect(p.displayPitch).toEqual(c);
    expect(midiPitch(p.pitch)).toBe(midiPitch(c) + 2);
  });
  it.each([
    ["treble", { step: "E", octave: 4, alter: 0 }],
    ["bass", { step: "G", octave: 2, alter: 0 }],
    ["alto", { step: "F", octave: 3, alter: 0 }],
    ["tenor", { step: "D", octave: 3, alter: 0 }],
  ] as const)("matches hit testing in %s clef", (clef, p) =>
    expect(pitchY(p, clef, 180)).toBe(180),
  );
  it("erases only the selected chord tone, then removes the event at its last pitch", () => {
    const { score, add } = fixture();
    const n = add([c, e, g]);
    removePitch(score, n.id, 1);
    expect(n.pitches).toEqual([c, g]);
    removePitch(score, n.id, 0);
    expect(n.pitches).toEqual([g]);
    removePitch(score, n.id, 0);
    expect(score.notes).toHaveLength(0);
  });
  it("cleans tie links after erasing a target", () => {
    const { score, add } = fixture();
    const a = add([c], 0),
      b = add([c], 1);
    a.tieTo = b.id;
    removePitch(score, b.id, 0);
    cleanLinks(score);
    expect(a.tieTo).toBeUndefined();
  });
});
