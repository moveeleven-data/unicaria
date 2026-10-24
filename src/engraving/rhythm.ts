import { beats, duration, type Duration, type NoteEvent } from "../core/model";
import {
  add,
  compare,
  mul,
  rat,
  sub,
  value,
  ZERO,
  type Rational,
} from "../core/rational";

export interface RhythmEntry {
  event?: NoteEvent;
  offset: Rational;
  span: Rational;
  base: number;
  dots: number;
  tuplets: Duration["tuplets"];
}

/** Implicit rests complete an unfinished tuplet before returning to ordinary time. */
export function fillGaps(events: NoteEvent[], length: Rational): RhythmEntry[] {
  const result: RhythmEntry[] = [];
  let cursor = ZERO;
  const gap = (end: Rational, neighbors: (NoteEvent | undefined)[]) => {
    let guard = 0;
    while (compare(cursor, end) < 0 && guard++ < 1024) {
      const remaining = sub(end, cursor);
      let chosen: Omit<RhythmEntry, "offset"> | undefined;
      for (const neighbor of neighbors) {
        if (!neighbor?.duration.tuplets.length) continue;
        const d = neighbor.duration;
        const span = beats(d);
        const group = mul(span, rat(d.tuplets[0].actual));
        const origin = mul(
          group,
          rat(Math.floor(value(neighbor.offset) / value(group) + 1e-9)),
        );
        if (
          compare(cursor, origin) >= 0 &&
          compare(add(cursor, span), add(origin, group)) <= 0 &&
          compare(span, remaining) <= 0
        ) {
          chosen = { base: d.base, dots: d.dots, tuplets: d.tuplets, span };
          break;
        }
      }
      if (!chosen) {
        for (const base of [1, 2, 4, 8, 16, 32, 64])
          for (const dots of [2, 1, 0]) {
            const span = beats(duration(base, dots));
            if (
              compare(span, remaining) <= 0 &&
              (!chosen || compare(span, chosen.span) > 0)
            )
              chosen = { base, dots, span, tuplets: [] };
          }
      }
      // Preserve exact timing for an unusual imported rational gap.
      chosen ??= {
        base: 4,
        dots: 0,
        span: remaining,
        tuplets: [{ actual: remaining.d, normal: remaining.n }],
      };
      result.push({ offset: cursor, ...chosen });
      cursor = add(cursor, chosen.span);
    }
  };
  let previous: NoteEvent | undefined;
  for (const event of events) {
    gap(event.offset, [previous, event]);
    result.push({
      event,
      offset: event.offset,
      span: beats(event.duration),
      base: event.duration.base,
      dots: event.duration.dots,
      tuplets: event.duration.tuplets,
    });
    cursor = add(event.offset, beats(event.duration));
    previous = event;
  }
  gap(length, [previous]);
  return result;
}
