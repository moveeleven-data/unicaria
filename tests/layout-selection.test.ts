import { describe, expect, it } from "vitest";
import { blankScore, duration, id, putNote } from "../src/core/model";
import { fullMeasures, insertMeasures, regionTimes } from "../src/core/editing";
import { ZERO, rat, value } from "../src/core/rational";
import { defaultRenderOptions, planPages } from "../src/engraving/pagination";
import { moveRegionEdge } from "../src/ui/selection";

describe("page geometry and keyboard region boundaries", () => {
  it("places each measure exactly once across horizontal and vertical pages", () => {
    const s = blankScore();
    insertMeasures(s, 8, 32);
    for (const arrangement of ["horizontal", "vertical"] as const) {
      const p = planPages(s, { ...defaultRenderOptions, arrangement });
      const indices = p.systems.flatMap((x) =>
        x.widths.map((_, i) => x.first + i),
      );
      expect(indices).toEqual(s.measures.map((_, i) => i));
      expect(p.pages.length).toBeGreaterThan(1);
      for (const system of p.systems) {
        const page = p.pages[system.page];
        expect(system.x).toBeGreaterThan(page.x);
        expect(system.y).toBeGreaterThan(page.y);
        expect(
          system.x + system.widths.reduce((a, b) => a + b, 0),
        ).toBeLessThan(page.x + page.width);
      }
    }
  });
  it("fits an eight-staff score without spilling the bottom staff outside the page", () => {
    const s = blankScore();
    while (s.staves.length < 8) s.staves.push({ ...s.staves[0], id: id() });
    const p = planPages(s);
    expect(p.pages.length).toBeGreaterThan(1);
    for (const system of p.systems)
      expect(system.y + 7 * p.staffGap + 120).toBeLessThan(
        p.pages[system.page].y + p.pages[system.page].height,
      );
  });
  it("uses a single continuous system in Scroll View", () => {
    const s = blankScore();
    const p = planPages(s, { ...defaultRenderOptions, view: "scroll" });
    expect(p.systems).toHaveLength(1);
    expect(p.systems[0].widths).toHaveLength(8);
    expect(p.width).toBeGreaterThan(1600);
  });
  it("protects dense notation even when a larger measure count is requested", () => {
    const s = blankScore();
    for (const m of s.measures)
      for (let i = 0; i < 16; i++)
        putNote(
          s,
          {
            staffId: s.staves[0].id,
            measureId: m.id,
            voice: 0,
            offset: rat(i, 4),
          },
          duration(16),
          [{ step: "C", octave: 4, alter: 1 }],
        );
    const p = planPages(s, { ...defaultRenderOptions, measuresPerSystem: 8 });
    expect(p.systems.every((system) => system.widths.length === 1)).toBe(true);
  });
  it("gives dense measures more width and fewer companions in automatic layout", () => {
    const s = blankScore();
    for (let i = 0; i < 16; i++)
      putNote(
        s,
        {
          staffId: s.staves[0].id,
          measureId: s.measures[0].id,
          voice: 0,
          offset: rat(i, 4),
        },
        duration(16),
        [{ step: "C", octave: 4, alter: 1 }],
      );
    const p = planPages(s);
    expect(p.systems[0].widths.length).toBeLessThan(4);
    expect(p.systems[0].widths[0]).toBeGreaterThan(350);
  });
  it("expands and contracts the same horizontal edge while Shift remains held", () => {
    const s = blankScore();
    let r = fullMeasures(s, 1, 2, 0, 0);
    r = moveRegionEdge(s, r, "ArrowLeft", true, "start");
    expect(value(regionTimes(s, r).start)).toBe(0);
    r = moveRegionEdge(s, r, "ArrowRight", true, "start");
    expect(value(regionTimes(s, r).start)).toBe(4);
    expect(value(regionTimes(s, r).end)).toBe(12);
  });
  it("does not contract a region past its opposite edge", () => {
    const s = blankScore();
    const r = fullMeasures(s, 0, 0, 0, 0);
    expect(moveRegionEdge(s, r, "ArrowRight", true, "start")).toEqual(r);
  });
  it("expands and contracts staff ranges without losing every staff", () => {
    const s = blankScore();
    let r = fullMeasures(s, 0, 0, 0, 0);
    r = moveRegionEdge(s, r, "ArrowDown", false, "end");
    expect(r.staffIds).toHaveLength(2);
    r = moveRegionEdge(s, r, "ArrowUp", false, "end");
    r = moveRegionEdge(s, r, "ArrowUp", false, "end");
    expect(r.staffIds).toHaveLength(1);
    expect(r.start.offset).toEqual(ZERO);
  });
});
