import {
  absolute,
  beats,
  measureBeats,
  measureStarts,
  type Score,
} from "../core/model";
import { add, compare, value, ZERO } from "../core/rational";
import {
  fullMeasures,
  isStack,
  regionTimes,
  type Region,
} from "../core/editing";
import { xAtTime, type Hit, type Layout } from "../engraving/geometry";

export function regionFromHits(
  score: Score,
  a: Hit,
  b: Hit,
  whole = false,
): Region {
  const ai = score.staves.findIndex((s) => s.id === a.staffId),
    bi = score.staves.findIndex((s) => s.id === b.staffId);
  if (whole)
    return fullMeasures(
      score,
      a.measure.measureIndex,
      b.measure.measureIndex,
      ai,
      bi,
    );
  const [left, right] = a.time <= b.time ? [a, b] : [b, a],
    staffIds = score.staves
      .slice(Math.min(ai, bi), Math.max(ai, bi) + 1)
      .map((s) => s.id);
  const snap = (hit: Hit, end: boolean) => {
    const events = score.notes.filter(
      (n) =>
        n.measureId === hit.measure.measureId && staffIds.includes(n.staffId),
    );
    const boundaries = [
      ZERO,
      measureBeats(score.measures[hit.measure.measureIndex]),
      ...events.flatMap((n) => [n.offset, add(n.offset, beats(n.duration))]),
    ].sort(compare);
    const t = value(hit.offset);
    return end
      ? (boundaries.find((x) => value(x) > t + 1e-7) ??
          measureBeats(score.measures[hit.measure.measureIndex]))
      : ([...boundaries].reverse().find((x) => value(x) <= t + 1e-7) ?? ZERO);
  };
  return {
    start: { measureId: left.measure.measureId, offset: snap(left, false) },
    end: { measureId: right.measure.measureId, offset: snap(right, true) },
    staffIds,
  };
}
export function extendRegion(score: Score, region: Region, hit: Hit): Region {
  const starts = measureStarts(score),
    start = absolute(starts, region.start),
    end = absolute(starts, region.end);
  const staffIndices = [...region.staffIds, hit.staffId].map((id) =>
    score.staves.findIndex((s) => s.id === id),
  );
  return {
    start:
      hit.time < value(start)
        ? { measureId: hit.measure.measureId, offset: ZERO }
        : region.start,
    end:
      hit.time >= value(end)
        ? {
            measureId: hit.measure.measureId,
            offset: measureBeats(score.measures[hit.measure.measureIndex]),
          }
        : region.end,
    staffIds: score.staves
      .slice(Math.min(...staffIndices), Math.max(...staffIndices) + 1)
      .map((s) => s.id),
  };
}
export function selectionRects(score: Score, layout: Layout, region: Region) {
  const { start, end } = regionTimes(score, region),
    stack = isStack(score, region);
  return layout.measures.flatMap((m) => {
    if (
      m.start + m.length <= value(start) + 1e-8 ||
      m.start >= value(end) - 1e-8
    )
      return [];
    const a = Math.max(0, value(start) - m.start),
      b = Math.min(m.length, value(end) - m.start);
    const left = a === 0 ? m.x : xAtTime(m, a) - 5,
      right = b === m.length ? m.endX : xAtTime(m, b) - 5;
    const staves = m.staves.filter((s) => region.staffIds.includes(s.id));
    if (stack)
      return [
        {
          left,
          top: staves[0].top + 9,
          width: Math.max(1, right - left),
          height: staves.at(-1)!.bottom - staves[0].top - 16,
          key: m.measureId,
        },
      ];
    return staves.map((s) => ({
      left,
      top: s.lineBottom - 43,
      width: Math.max(1, right - left),
      height: 48,
      key: m.measureId + s.id,
    }));
  });
}
export function moveRegionEdge(
  score: Score,
  region: Region,
  key: string,
  byMeasure = false,
  activeEdge?: "start" | "end",
): Region {
  const first = score.staves.findIndex((s) => s.id === region.staffIds[0]),
    last = score.staves.findIndex((s) => s.id === region.staffIds.at(-1));
  const edge =
    activeEdge ?? (["ArrowLeft", "ArrowUp"].includes(key) ? "start" : "end");
  if (key === "ArrowUp" || key === "ArrowDown") {
    const delta = key === "ArrowUp" ? -1 : 1;
    const a =
      edge === "start" ? Math.max(0, Math.min(last, first + delta)) : first;
    const b =
      edge === "end"
        ? Math.max(first, Math.min(score.staves.length - 1, last + delta))
        : last;
    return {
      ...region,
      staffIds: score.staves.slice(a, b + 1).map((s) => s.id),
    };
  }
  if (key === "PageUp")
    return {
      ...region,
      staffIds: score.staves.slice(0, last + 1).map((s) => s.id),
    };
  if (key === "PageDown")
    return { ...region, staffIds: score.staves.slice(first).map((s) => s.id) };
  if (key === "Home")
    return {
      ...region,
      start: { measureId: score.measures[0].id, offset: ZERO },
    };
  if (key === "End")
    return {
      ...region,
      end: {
        measureId: score.measures.at(-1)!.id,
        offset: measureBeats(score.measures.at(-1)!),
      },
    };
  const starts = measureStarts(score),
    t = absolute(starts, region[edge]);
  const points = score.measures.flatMap((m) => [
    { measureId: m.id, offset: ZERO },
    { measureId: m.id, offset: measureBeats(m) },
  ]);
  if (!byMeasure)
    points.push(
      ...score.notes
        .filter((n) => region.staffIds.includes(n.staffId))
        .flatMap((n) => [
          { measureId: n.measureId, offset: n.offset },
          { measureId: n.measureId, offset: add(n.offset, beats(n.duration)) },
        ]),
    );
  points.sort((p, q) => compare(absolute(starts, p), absolute(starts, q)));
  const next =
    key === "ArrowLeft"
      ? [...points].reverse().find((p) => compare(absolute(starts, p), t) < 0)
      : points.find((p) => compare(absolute(starts, p), t) > 0);
  if (!next) return region;
  const result = { ...region, [edge]: next };
  return compare(absolute(starts, result.start), absolute(starts, result.end)) <
    0
    ? result
    : region;
}
