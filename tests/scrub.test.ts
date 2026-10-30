import { describe, it, expect } from "vitest";
import { blankScore, duration, putNote } from "../src/core/model";
import { rat, ZERO } from "../src/core/rational";
import { ScoreIndex } from "../src/performance/compiler";
import { scrubFrames } from "../src/performance/scrub";
function study() {
  const score = blankScore();
  const staffId = score.staves[0].id,
    measureId = score.measures[0].id;
  for (let n = 0; n < 16; n++)
    putNote(
      score,
      { staffId, measureId, offset: rat(n, 4), voice: 0 },
      duration(16),
      [{ step: "C", alter: 0, octave: 4 + (n % 3) }],
    );
  putNote(
    score,
    { staffId: score.staves[1].id, measureId, offset: ZERO, voice: 0 },
    duration(1),
    [{ step: "C", alter: 0, octave: 2 }],
  );
  return {
    score,
    index: new ScoreIndex(score),
    scope: { mode: "all" as const, staffId, pedal: false },
  };
}
describe("continuous harmonic scrubbing", () => {
  it("visits every skipped sixteenth when the mouse jumps across a bar", () => {
    const { index, scope } = study();
    const frames = scrubFrames(index, 0.01, 3.99, scope);
    const ids = new Set(frames.flat().map((v) => v.id));
    expect(ids.size).toBe(16);
    expect(frames).toHaveLength(16);
  });
  it("hears every crossed onset while moving backwards", () => {
    const { index, scope } = study();
    const frames = scrubFrames(index, 3.99, 0.01, scope);
    expect(new Set(frames.flat().map((v) => v.id)).size).toBe(16);
    expect(frames[0].find((v) => v.staffId === scope.staffId)!.midi).toBe(84);
    expect(frames.at(-1)!.find((v) => v.staffId === scope.staffId)!.midi).toBe(
      60,
    );
  });
  it("retains the same identity for sustained bass under every slice", () => {
    const { index, scope, score } = study();
    const frames = scrubFrames(index, 0.01, 3.99, scope);
    expect(
      new Set(
        frames.map((f) => f.find((v) => v.staffId === score.staves[1].id)!.id),
      ).size,
    ).toBe(1);
  });
  it("uses staff-only scope for every intermediate slice", () => {
    const { index, scope } = study();
    expect(
      scrubFrames(index, 0.01, 3.99, { ...scope, mode: "staff" }).every(
        (f) => f.length === 1 && f[0].staffId === scope.staffId,
      ),
    ).toBe(true);
  });
  it("includes silence in rests and final releases", () => {
    const { score, scope } = study();
    score.notes = score.notes.filter(
      (n) => n.staffId !== score.staves[1].id && n.offset.n === 0,
    );
    const frames = scrubFrames(new ScoreIndex(score), 0.01, 3.99, scope);
    expect(frames.at(-1)).toEqual([]);
  });
});
