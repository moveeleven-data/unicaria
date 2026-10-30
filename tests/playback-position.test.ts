import { describe, expect, it } from "vitest";
import { blankScore } from "../src/core/model";
import { rat } from "../src/core/rational";
import { counterAt, parseCounter } from "../src/ui/playbackPosition";

describe("playback counter", () => {
  it("respects eighth-note beat units and quarter-note EDU ticks", () => {
    const s = blankScore();
    s.measures[0].beats = 6;
    s.measures[0].beatType = 8;
    const cursor = {
      staffId: s.staves[0].id,
      measureId: s.measures[0].id,
      offset: rat(0),
      voice: 0,
    };
    expect(parseCounter(s, "1 | 4 | 256", cursor).offset).toEqual(rat(7, 4));
    expect(counterAt(s, 1.75)).toBe("1 | 4 | 0256");
    expect(() => parseCounter(s, "1 | 6 | 512", cursor)).toThrow();
    expect(() => parseCounter(s, "1 | 7 | 0", cursor)).toThrow();
  });
  it("honors pickup length and barline boundaries", () => {
    const s = blankScore();
    s.measures[0].pickup = rat(1);
    const cursor = {
      staffId: s.staves[0].id,
      measureId: s.measures[0].id,
      offset: rat(0),
      voice: 0,
    };
    expect(counterAt(s, 1)).toBe("2 | 1 | 0000");
    expect(() => parseCounter(s, "1 | 2", cursor)).toThrow();
  });
  it.each([
    "",
    "0",
    "1 | 0",
    "-1",
    "1 | 1 | 1024",
    "1.5",
    "1 | 2 | -5",
    "hello",
  ])("rejects invalid position %s", (text) => {
    const s = blankScore();
    expect(() =>
      parseCounter(s, text, {
        staffId: s.staves[0].id,
        measureId: s.measures[0].id,
        offset: rat(0),
        voice: 0,
      }),
    ).toThrow();
  });
});
