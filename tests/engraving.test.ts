// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { blankScore, duration, putNote, id } from "../src/core/model";
import { rat } from "../src/core/rational";
import { renderScore } from "../src/engraving/render";
import { preparePrint } from "../src/engraving/print";
import { defaultRenderOptions } from "../src/engraving/pagination";

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        font: "10px serif",
        measureText: (text: string) => ({
          width: text.length * 7,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: text.length * 7,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 3,
          fontBoundingBoxAscent: 10,
          fontBoundingBoxDescent: 3,
        }),
      }) as unknown as CanvasRenderingContext2D,
  );
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value() {
      return { x: 0, y: 0, width: 10, height: 14 };
    },
  });
});
describe("rendered music timing", () => {
  it.each([3, 5, 7])(
    "aligns ordinary eighths with %d-note tuplets at shared beats",
    (actual) => {
      const normal = actual === 3 ? 2 : 4;
      const s = blankScore(),
        m = s.measures[0],
        at = { measureId: m.id, voice: 0 };
      for (let i = 0; i < 8; i++)
        putNote(
          s,
          { ...at, staffId: s.staves[0].id, offset: rat(i, 2) },
          duration(8),
          [{ step: "C", alter: 0, octave: 4 }],
        );
      for (let i = 0; i < (8 * actual) / normal; i++)
        putNote(
          s,
          {
            ...at,
            staffId: s.staves[1].id,
            offset: rat(i * normal, 2 * actual),
          },
          duration(8, 0, [{ actual, normal }]),
          [{ step: "E", alter: 0, octave: 4 }],
        );
      const layout = renderScore(document.createElement("div"), s);
      for (const beat of [0, 2]) {
        const same = layout.notes.filter(
          (n) => n.measureId === m.id && n.offset.n === beat * n.offset.d,
        );
        expect(same).toHaveLength(2);
        expect(same[0].x).toBeCloseTo(same[1].x, 5);
      }
      const bar = layout.measures[0];
      expect(
        layout.notes
          .filter((n) => n.measureId === m.id)
          .every((n) => n.x < bar.endX),
      ).toBe(true);
    },
  );
  it("breaks hairpins at every system, including equal-height systems on adjacent pages", () => {
    const s = blankScore();
    while (s.staves.length < 8) s.staves.push({ ...s.staves[0], id: id() });
    s.marks.push({
      id: "span-test",
      kind: "hairpin",
      staffId: s.staves[0].id,
      measureId: s.measures[0].id,
      offset: rat(0),
      endMeasureId: s.measures[7].id,
      endOffset: rat(4),
      text: "",
      amount: 40,
      target: 100,
    });
    const host = document.createElement("div"),
      layout = renderScore(host, s, undefined, false, {
        ...defaultRenderOptions,
        measuresPerSystem: 1,
      });
    expect(layout.pages).toHaveLength(8);
    expect(host.querySelectorAll('[data-mark-id="span-test"]')).toHaveLength(8);
    for (const p of host.querySelectorAll('[data-mark-id="span-test"]')) {
      const values = p
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      expect(Math.abs(values[2] - values[0])).toBeLessThan(1000);
    }
  });
  it("prints paginated sheets independently of scroll-view geometry", () => {
    const s = blankScore();
    preparePrint(s, false, { ...defaultRenderOptions, view: "scroll" });
    const sheets = document.querySelectorAll(
      "body > .print-pages .print-sheet",
    );
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets[0].querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 1000 1414",
    );
    preparePrint(s, false, defaultRenderOptions);
    expect(document.querySelectorAll("body > .print-pages")).toHaveLength(1);
  });
});
