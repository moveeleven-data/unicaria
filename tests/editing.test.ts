import { describe, it, expect } from "vitest";
import {
  blankScore,
  beats,
  duration,
  measureStarts,
  absolute,
  id,
  putNote,
} from "../src/core/model";
import { ZERO, rat, value } from "../src/core/rational";
import { validateScore } from "../src/core/validation";
import {
  changeMeter,
  clearRegion,
  copyRegion,
  deleteMeasures,
  enterNote,
  fullMeasures,
  insertMeasures,
  isStack,
  pasteRegion,
  regionNotes,
  spellDuration,
  transposeRegion,
} from "../src/core/editing";
const pitch = { step: "C" as const, alter: 0, octave: 4 };
function setup() {
  const s = blankScore();
  const at = {
    staffId: s.staves[0].id,
    measureId: s.measures[0].id,
    voice: 0,
    offset: ZERO,
  };
  return { s, at };
}
describe("measure and region editing", () => {
  it("shortening an existing note leaves silence and preserves its identity and articulation", () => {
    const { s, at } = setup();
    const n = putNote(s, at, duration(2), [pitch]);
    n.articulation = "accent";
    const changed = enterNote(s, at, duration(8), [pitch]);
    expect(s.notes).toHaveLength(1);
    expect(changed[0].id).toBe(n.id);
    expect(changed[0].articulation).toBe("accent");
    expect(value(beats(changed[0].duration))).toBe(0.5);
    validateScore(s);
  });
  it("editing an existing duration preserves a valid incoming tie", () => {
    const { s, at } = setup();
    const a = putNote(s, at, duration(), [pitch]),
      b = putNote(s, { ...at, offset: rat(1) }, duration(), [pitch]);
    a.tieTo = b.id;
    enterNote(s, { ...at, offset: rat(1) }, duration(2), [pitch]);
    expect(s.notes.find((n) => n.id === a.id)!.tieTo).toBe(b.id);
    validateScore(s);
  });

  it("rebars a sustained note in 3/4 without discarding its fourth beat", () => {
    const { s, at } = setup();
    putNote(s, at, duration(1), [pitch]);
    changeMeter(s, 0, 0, 3, 4);
    expect(s.measures).toHaveLength(9);
    expect(s.notes).toHaveLength(2);
    expect(s.notes[0].tieTo).toBe(s.notes[1].id);
    expect(s.notes.map((n) => value(beats(n.duration)))).toEqual([3, 1]);
    validateScore(s);
  });
  it("retains all attacks and exact tuplet times through rebarring", () => {
    const { s, at } = setup();
    for (let i = 0; i < 12; i++)
      putNote(
        s,
        { ...at, offset: rat(i, 3) },
        duration(8, 0, [{ actual: 3, normal: 2 }]),
        [pitch],
      );
    changeMeter(s, 0, 0, 2, 4);
    expect(s.notes).toHaveLength(12);
    expect(s.notes.every((n) => n.duration.tuplets[0]?.actual === 3)).toBe(
      true,
    );
    validateScore(s);
  });
  it("clips a hairpin on both sides of cleared music and interpolates its levels", () => {
    const { s, at } = setup();
    s.marks.push({
      id: id(),
      kind: "hairpin",
      ...at,
      endMeasureId: s.measures[0].id,
      endOffset: rat(4),
      text: "cresc.",
      amount: 40,
      target: 100,
    });
    clearRegion(s, {
      start: { ...at, offset: rat(1) },
      end: { ...at, offset: rat(3) },
      staffIds: [at.staffId],
    });
    expect(s.marks).toHaveLength(2);
    expect(s.marks.map((m) => [m.amount, m.target])).toEqual([
      [40, 55],
      [85, 100],
    ]);
    validateScore(s);
  });
  it("copies the selected part of a hairpin that began earlier", () => {
    const { s, at } = setup();
    s.marks.push({
      id: id(),
      kind: "hairpin",
      ...at,
      endMeasureId: s.measures[0].id,
      endOffset: rat(4),
      text: "cresc.",
      amount: 40,
      target: 100,
    });
    const clip = copyRegion(s, {
      start: { ...at, offset: rat(1) },
      end: { ...at, offset: rat(3) },
      staffIds: [at.staffId],
    });
    expect(clip.marks[0].mark).toMatchObject({ amount: 55, target: 85 });
    pasteRegion(s, clip, { ...at, measureId: s.measures[1].id });
    validateScore(s);
  });
  it("uses ordinary tied rhythms instead of invented tuplets for binary fragments", () => {
    const ds = spellDuration(rat(5, 4));
    expect(ds).toHaveLength(2);
    expect(ds.every((d) => d.tuplets.length === 0)).toBe(true);
  });
  it("distinguishes a staff region from a complete measure stack", () => {
    const { s } = setup();
    expect(isStack(s, fullMeasures(s, 0, 1, 0, 0))).toBe(false);
    expect(isStack(s, fullMeasures(s, 0, 1))).toBe(true);
  });
  it("clears only the selected staves and measures", () => {
    const { s, at } = setup();
    putNote(s, at, duration(), [pitch]);
    putNote(s, { ...at, staffId: s.staves[1].id }, duration(), [pitch]);
    putNote(s, { ...at, measureId: s.measures[1].id }, duration(), [pitch]);
    clearRegion(s, fullMeasures(s, 0, 0, 0, 0));
    expect(s.notes).toHaveLength(2);
    expect(s.measures).toHaveLength(8);
    validateScore(s);
  });
  it("preserves both sides of a sustained note when its middle is cleared", () => {
    const { s, at } = setup();
    putNote(s, at, duration(1), [pitch]);
    clearRegion(s, {
      start: { ...at, offset: rat(1) },
      end: { ...at, offset: rat(3) },
      staffIds: [at.staffId],
    });
    expect(
      s.notes.map((n) => [value(n.offset), value(beats(n.duration))]),
    ).toEqual([
      [0, 1],
      [3, 1],
    ]);
    expect(s.notes.every((n) => !n.tieTo)).toBe(true);
    validateScore(s);
  });
  it("deletes measure stacks and repairs dangling ties and slurs", () => {
    const { s, at } = setup();
    const a = putNote(s, at, duration(1), [pitch]),
      b = putNote(s, { ...at, measureId: s.measures[1].id }, duration(1), [
        pitch,
      ]);
    a.tieTo = b.id;
    deleteMeasures(s, fullMeasures(s, 1));
    expect(s.measures).toHaveLength(7);
    expect(s.notes[0].tieTo).toBeUndefined();
    validateScore(s);
  });
  it("keeps one usable blank measure when every measure is deleted", () => {
    const { s, at } = setup();
    putNote(s, at, duration(), [pitch]);
    deleteMeasures(s, fullMeasures(s, 0, 7));
    expect(s.measures).toHaveLength(1);
    expect(s.notes).toHaveLength(0);
    validateScore(s);
  });
  it("shortens a hairpin spanning deleted measures rather than losing it", () => {
    const { s, at } = setup();
    s.marks.push({
      id: id(),
      kind: "hairpin",
      ...at,
      endMeasureId: s.measures[3].id,
      endOffset: rat(4),
      text: "cresc.",
      amount: 50,
      target: 100,
    });
    deleteMeasures(s, fullMeasures(s, 1, 2));
    expect(s.marks).toHaveLength(1);
    const starts = measureStarts(s);
    expect(
      value(
        absolute(starts, {
          measureId: s.marks[0].endMeasureId!,
          offset: s.marks[0].endOffset!,
        }),
      ),
    ).toBe(8);
    validateScore(s);
  });
  it("inserts before a measure using its meter and key but no repeats", () => {
    const { s } = setup();
    Object.assign(s.measures[2], { beats: 3, key: "Eb", repeatEnd: true });
    const old = s.measures[2].id;
    insertMeasures(s, 2, 3);
    expect(s.measures[5].id).toBe(old);
    expect(s.measures[2]).toMatchObject({ beats: 3, key: "Eb" });
    expect(s.measures[2].repeatEnd).toBeUndefined();
    validateScore(s);
  });
  it("breaks a tie interrupted by inserted measures", () => {
    const { s, at } = setup();
    const a = putNote(s, at, duration(1), [pitch]),
      b = putNote(s, { ...at, measureId: s.measures[1].id }, duration(), [
        pitch,
      ]);
    a.tieTo = b.id;
    insertMeasures(s, 1, 1);
    expect(a.tieTo).toBeUndefined();
    validateScore(s);
  });
  it("rejects invalid insertion counts without modifying the document", () => {
    const { s } = setup();
    for (const n of [0, -1, 1.5, 2000])
      expect(() => insertMeasures(s, 0, n)).toThrow();
    expect(s.measures).toHaveLength(8);
  });
  it("automatically splits and ties notes across barlines", () => {
    const { s, at } = setup();
    const notes = enterNote(s, { ...at, offset: rat(3) }, duration(2), [pitch]);
    expect(notes).toHaveLength(2);
    expect(notes[0].tieTo).toBe(notes[1].id);
    expect(notes.map((n) => value(beats(n.duration)))).toEqual([1, 1]);
    validateScore(s);
  });
  it("extends the score when entering at the final barline", () => {
    const { s, at } = setup();
    const notes = enterNote(
      s,
      { ...at, measureId: s.measures.at(-1)!.id, offset: rat(4) },
      duration(),
      [pitch],
    );
    expect(s.measures).toHaveLength(9);
    expect(notes[0].measureId).toBe(s.measures[8].id);
    validateScore(s);
  });
  it("preserves exact tuplet timing through copy and paste", () => {
    const { s, at } = setup();
    putNote(
      s,
      { ...at, offset: rat(1, 3) },
      duration(8, 0, [{ actual: 3, normal: 2 }]),
      [pitch],
    );
    const clip = copyRegion(s, {
      start: { ...at, offset: rat(1, 3) },
      end: { ...at, offset: rat(2, 3) },
      staffIds: [at.staffId],
    });
    pasteRegion(s, clip, {
      ...at,
      measureId: s.measures[1].id,
      offset: rat(2, 3),
    });
    expect(s.notes.at(-1)!.offset).toEqual(rat(2, 3));
    expect(beats(s.notes.at(-1)!.duration)).toEqual(rat(1, 3));
    validateScore(s);
  });
  it("copies chords, layers, grace notes, articulations, and internal links with fresh IDs", () => {
    const { s, at } = setup();
    const a = putNote(s, at, duration(), [pitch, { ...pitch, step: "E" }]),
      b = putNote(s, { ...at, offset: rat(1) }, duration(), [pitch]);
    a.tieTo = b.id;
    a.articulation = "accent";
    a.grace = [{ ...pitch, step: "D" }];
    putNote(s, { ...at, voice: 1 }, duration(2), [{ ...pitch, octave: 3 }]);
    const clip = copyRegion(s, fullMeasures(s, 0, 0, 0, 0));
    pasteRegion(s, clip, { ...at, measureId: s.measures[1].id });
    const copied = s.notes.filter((n) => n.measureId === s.measures[1].id);
    expect(copied).toHaveLength(3);
    expect(copied[0].tieTo).toBe(copied[1].id);
    expect(copied[0].id).not.toBe(a.id);
    expect(copied[0].grace).toEqual(a.grace);
    expect(copied[0].articulation).toBe("accent");
    expect(copied[2].voice).toBe(1);
    validateScore(s);
  });
  it("allows overlap when pasting because the clipboard is a snapshot", () => {
    const { s, at } = setup();
    for (let i = 0; i < 3; i++)
      putNote(s, { ...at, measureId: s.measures[i].id }, duration(), [
        { ...pitch, octave: i + 3 },
      ]);
    const clip = copyRegion(s, fullMeasures(s, 0, 1, 0, 0));
    pasteRegion(s, clip, { ...at, measureId: s.measures[1].id });
    expect(
      s.notes.find((n) => n.measureId === s.measures[2].id)!.pitches[0].octave,
    ).toBe(4);
    validateScore(s);
  });
  it("rebars a staff-only paste across a different meter", () => {
    const { s, at } = setup();
    putNote(s, at, duration(1), [pitch]);
    s.measures[1].beats = 3;
    s.measures[2].beats = 3;
    pasteRegion(s, copyRegion(s, fullMeasures(s, 0, 0, 0, 0)), {
      ...at,
      measureId: s.measures[1].id,
    });
    expect(
      s.notes.filter((n) => n.measureId === s.measures[1].id),
    ).toHaveLength(1);
    expect(
      value(
        beats(s.notes.find((n) => n.measureId === s.measures[1].id)!.duration),
      ),
    ).toBe(3);
    validateScore(s);
  });
  it("copies measure settings when inserting a complete stack", () => {
    const { s, at } = setup();
    s.measures[0].beats = 3;
    s.measures[0].key = "D";
    putNote(s, at, duration(2, 1), [pitch]);
    pasteRegion(
      s,
      copyRegion(s, fullMeasures(s, 0)),
      { ...at, measureId: s.measures[2].id },
      true,
    );
    expect(s.measures).toHaveLength(9);
    expect(s.measures[2]).toMatchObject({ beats: 3, key: "D" });
    validateScore(s);
  });
  it("rejects insufficient target staves instead of silently dropping a part", () => {
    const { s, at } = setup();
    expect(() =>
      pasteRegion(s, copyRegion(s, fullMeasures(s, 0)), {
        ...at,
        staffId: s.staves[1].id,
      }),
    ).toThrow(/staves/);
  });
  it("transposes only the selected region", () => {
    const { s, at } = setup();
    putNote(s, at, duration(), [pitch]);
    putNote(s, { ...at, measureId: s.measures[1].id }, duration(), [pitch]);
    transposeRegion(s, fullMeasures(s, 0, 0, 0, 0), 12);
    expect(s.notes.map((n) => n.pitches[0].octave)).toEqual([5, 4]);
    validateScore(s);
  });
  it("spells dotted and tuplet fragments exactly", () => {
    for (const t of [rat(3), rat(7, 4), rat(1, 3), rat(2, 5), rat(5, 2)])
      expect(
        spellDuration(t).reduce((sum, d) => sum + value(beats(d)), 0),
      ).toBeCloseTo(value(t));
  });
  it("active-layer clearing leaves all other layers intact", () => {
    const { s, at } = setup();
    putNote(s, at, duration(), [pitch]);
    putNote(s, { ...at, voice: 1 }, duration(), [pitch]);
    clearRegion(s, fullMeasures(s, 0), 0);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].voice).toBe(1);
    validateScore(s);
  });
  it("selects sustained notes that cross a partial region", () => {
    const { s, at } = setup();
    putNote(s, at, duration(1), [pitch]);
    expect(
      regionNotes(s, {
        start: { ...at, offset: rat(1) },
        end: { ...at, offset: rat(2) },
        staffIds: [at.staffId],
      }),
    ).toHaveLength(1);
  });
});
