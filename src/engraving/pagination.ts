import { value } from "../core/rational";
import { type Score } from "../core/model";

export type ScoreView = "page" | "scroll";
export interface RenderOptions {
  view: ScoreView;
  arrangement: "horizontal" | "vertical";
  measuresPerSystem: number;
  staffSpacing: number;
}
export const defaultRenderOptions: RenderOptions = {
  view: "page",
  arrangement: "horizontal",
  measuresPerSystem: 0,
  staffSpacing: 96,
};
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  number: number;
}
export interface SystemPlan {
  x: number;
  y: number;
  first: number;
  widths: number[];
  page: number;
}
export interface PagePlan {
  width: number;
  height: number;
  pages: PageBox[];
  systems: SystemPlan[];
  staffGap: number;
}

/** Layout depends on rhythmic density, never on window zoom. */
export function planPages(
  score: Score,
  options: RenderOptions = defaultRenderOptions,
): PagePlan {
  const staffGap = options.staffSpacing;
  const contentHeight = (score.staves.length - 1) * staffGap + 120;
  const pageWidth = 1000,
    pageHeight = Math.max(1414, contentHeight + 280),
    gap = 28;
  const left = 132,
    right = 62,
    available = pageWidth - left - right;
  const eventsByMeasure = new Map<string, Score["notes"]>();
  for (const n of score.notes) {
    const entries = eventsByMeasure.get(n.measureId) ?? [];
    entries.push(n);
    eventsByMeasure.set(n.measureId, entries);
  }
  const minimums = score.measures.map((m, i) => {
    const notes = eventsByMeasure.get(m.id) ?? [],
      onsets = new Map<number, number>();
    for (const n of notes) {
      const accidental = n.pitches.some((p) => p.alter !== 0) ? 9 : 0;
      onsets.set(
        value(n.offset),
        Math.max(
          onsets.get(value(n.offset)) ?? 0,
          20 +
            accidental +
            (n.duration.dots ? 6 : 0) +
            (n.grace?.length ?? 0) * 12,
        ),
      );
    }
    return Math.max(
      130,
      38 + [...onsets.values()].reduce((s, n) => s + n, 0) + (i === 0 ? 42 : 0),
    );
  });
  if (options.view === "scroll") {
    const widths = minimums.map((w, i) =>
      Math.max(210, w + (i === 0 ? 55 : 0)),
    );
    const width = left + right + widths.reduce((a, b) => a + b, 0),
      height = contentHeight + 230;
    return {
      width,
      height,
      staffGap,
      pages: [{ x: 0, y: 0, width, height, number: 1 }],
      systems: [{ x: left, y: 120, first: 0, widths, page: 0 }],
    };
  }
  const systems: SystemPlan[] = [],
    pages: PageBox[] = [];
  let first = 0,
    page = 0,
    y = 180;
  const pageOrigin = () =>
    options.arrangement === "horizontal"
      ? { x: page * (pageWidth + gap), y: 0 }
      : { x: 0, y: page * (pageHeight + gap) };
  const addPage = () => {
    const p = pageOrigin();
    pages.push({
      ...p,
      width: pageWidth,
      height: pageHeight,
      number: page + 1,
    });
  };
  addPage();
  while (first < score.measures.length) {
    let count = 0,
      total = 70;
    const max = options.measuresPerSystem || 4;
    while (first + count < score.measures.length && count < max) {
      const next = minimums[first + count];
      if (count > 0 && total + next > available) break;
      total += next;
      count++;
    }
    if (y + contentHeight > pageHeight - 80 && systems.length) {
      page++;
      y = 96;
      addPage();
    }
    const p = pageOrigin(),
      weights = minimums
        .slice(first, first + count)
        .map((w, i) => w + (i === 0 ? 55 : 0)),
      sum = weights.reduce((a, b) => a + b, 0);
    systems.push({
      x: p.x + left,
      y: p.y + y,
      first,
      widths: weights.map((w) => (available * w) / sum),
      page,
    });
    first += count;
    y += contentHeight + 64;
  }
  return {
    width:
      options.arrangement === "horizontal"
        ? pages.length * (pageWidth + gap) - gap
        : pageWidth,
    height:
      options.arrangement === "vertical"
        ? pages.length * (pageHeight + gap) - gap
        : pageHeight,
    pages,
    systems,
    staffGap,
  };
}
