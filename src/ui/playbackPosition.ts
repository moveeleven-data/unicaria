import {
  measureBeats,
  measureStarts,
  type Cursor,
  type Score,
} from "../core/model";
import { fromDecimal, value } from "../core/rational";

export function counterAt(score: Score, source: number) {
  const starts = measureStarts(score);
  let i = score.measures.findIndex(
    (m) => source < value(starts.get(m.id)!) + value(measureBeats(m)) - 1e-8,
  );
  if (i < 0) i = score.measures.length - 1;
  const m = score.measures[i],
    offset = Math.max(0, source - value(starts.get(m.id)!));
  const unit = 4 / m.beatType,
    beat = Math.floor((offset + 1e-8) / unit);
  const ticks = Math.min(
    Math.round(unit * 1024) - 1,
    Math.max(0, Math.floor((offset - beat * unit) * 1024 + 1e-6)),
  );
  return `${i + 1} | ${beat + 1} | ${String(ticks).padStart(4, "0")}`;
}

export function parseCounter(
  score: Score,
  text: string,
  cursor: Cursor,
): Cursor {
  const match = /^\s*(\d+)(?:\s*\|\s*(\d+)(?:\s*\|\s*(\d+))?)?\s*$/.exec(text);
  if (!match)
    throw new Error("Enter measure | beat | ticks, or just a measure number.");
  const measure = score.measures[Number(match[1]) - 1];
  if (!measure) throw new Error("That measure is outside the score.");
  const beat = Number(match[2] ?? 1),
    ticks = Number(match[3] ?? 0),
    unit = 4 / measure.beatType;
  const offset = (beat - 1) * unit + ticks / 1024;
  if (
    beat < 1 ||
    ticks >= unit * 1024 ||
    offset >= value(measureBeats(measure))
  )
    throw new Error("That beat or tick is outside the measure.");
  return { ...cursor, measureId: measure.id, offset: fromDecimal(offset) };
}
