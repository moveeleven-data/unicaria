import {
  absolute,
  beats,
  duration,
  id,
  measureBeats,
  measureStarts,
  midiPitch,
  pitchFromMidi,
  scoreLength,
  type Cursor,
  type Duration,
  type Mark,
  type Measure,
  type NoteEvent,
  type Pitch,
  type Score,
} from "./model";
import {
  add,
  compare,
  mul,
  rat,
  sub,
  value,
  ZERO,
  type Rational,
} from "./rational";

export interface Position {
  measureId: string;
  offset: Rational;
}
/** A half-open interval of musical time over a contiguous set of staves. */
export interface Region {
  start: Position;
  end: Position;
  staffIds: string[];
}
export interface MusicClip {
  length: Rational;
  staffCount: number;
  notes: { event: NoteEvent; time: Rational; span: Rational; staff: number }[];
  marks: { mark: Mark; time: Rational; end?: Rational; staff?: number }[];
  measures?: Measure[];
}
const min = (a: Rational, b: Rational) => (compare(a, b) < 0 ? a : b);
const max = (a: Rational, b: Rational) => (compare(a, b) > 0 ? a : b);

export function fullMeasures(
  score: Score,
  first: number,
  last = first,
  staffA = 0,
  staffB = score.staves.length - 1,
): Region {
  const lo = Math.max(0, Math.min(first, last)),
    hi = Math.min(score.measures.length - 1, Math.max(first, last));
  return {
    start: { measureId: score.measures[lo].id, offset: ZERO },
    end: {
      measureId: score.measures[hi].id,
      offset: measureBeats(score.measures[hi]),
    },
    staffIds: score.staves
      .slice(Math.min(staffA, staffB), Math.max(staffA, staffB) + 1)
      .map((s) => s.id),
  };
}
export function regionTimes(score: Score, region: Region) {
  const starts = measureStarts(score);
  return {
    start: absolute(starts, region.start),
    end: absolute(starts, region.end),
  };
}
export function isStack(score: Score, region: Region) {
  const last = score.measures.find((m) => m.id === region.end.measureId);
  return (
    region.staffIds.length === score.staves.length &&
    region.staffIds.every((id) => score.staves.some((s) => s.id === id)) &&
    region.start.offset.n === 0 &&
    !!last &&
    compare(region.end.offset, measureBeats(last)) === 0
  );
}
export function regionNotes(score: Score, region: Region) {
  const { start, end } = regionTimes(score, region),
    starts = measureStarts(score);
  return score.notes.filter(
    (n) =>
      region.staffIds.includes(n.staffId) &&
      compare(absolute(starts, n), end) < 0 &&
      compare(add(absolute(starts, n), beats(n.duration)), start) > 0,
  );
}
export function positionAt(
  score: Score,
  time: Rational,
  endpoint = false,
): Position {
  const starts = measureStarts(score);
  for (const m of score.measures) {
    const start = starts.get(m.id)!,
      end = add(start, measureBeats(m));
    if (compare(time, end) < 0 || (endpoint && compare(time, end) === 0))
      return { measureId: m.id, offset: max(ZERO, sub(time, start)) };
  }
  const last = score.measures.at(-1)!;
  return { measureId: last.id, offset: measureBeats(last) };
}
export function cleanLinks(score: Score) {
  const notes = new Map(score.notes.map((n) => [n.id, n])),
    starts = measureStarts(score);
  for (const n of score.notes)
    for (const key of ["tieTo", "slurTo"] as const) {
      const other = n[key] ? notes.get(n[key]!) : undefined;
      if (!n[key]) continue;
      const distance = other
        ? compare(
            absolute(starts, other),
            add(absolute(starts, n), beats(n.duration)),
          )
        : -1;
      if (
        !other ||
        other.staffId !== n.staffId ||
        other.voice !== n.voice ||
        !n.pitches.length ||
        !other.pitches.length ||
        distance < 0 ||
        (key === "tieTo" &&
          (distance !== 0 ||
            !n.pitches.some((p) =>
              other.pitches.some((q) => midiPitch(p) === midiPitch(q)),
            )))
      )
        delete n[key];
    }
}
export function insertMeasures(
  score: Score,
  before: number,
  count: number,
  templates?: Measure[],
) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 2000 ||
    score.measures.length + count > 2000
  )
    throw new Error(
      "Choose 1–2000 measures, within the 2000-measure document limit.",
    );
  if (!Number.isInteger(before) || before < 0 || before > score.measures.length)
    throw new Error("Invalid insertion point.");
  const reference = score.measures[Math.min(before, score.measures.length - 1)];
  const added = Array.from({ length: count }, (_, i) =>
    templates?.[i]
      ? { ...structuredClone(templates[i]), id: id() }
      : {
          id: id(),
          beats: reference.beats,
          beatType: reference.beatType,
          key: reference.key,
        },
  );
  score.measures.splice(before, 0, ...added);
  cleanLinks(score);
  return added;
}
export function deleteMeasures(score: Score, region: Region) {
  const first = score.measures.findIndex(
      (m) => m.id === region.start.measureId,
    ),
    last = score.measures.findIndex((m) => m.id === region.end.measureId);
  if (first < 0 || last < first)
    throw new Error("Select the measures to delete.");
  const removed = new Set(
    score.measures.slice(first, last + 1).map((m) => m.id),
  );
  const oldStarts = measureStarts(score),
    oldTimes = new Map(
      score.marks.map((m) => [
        m.id,
        {
          start: absolute(oldStarts, m),
          end: m.endMeasureId
            ? absolute(oldStarts, {
                measureId: m.endMeasureId,
                offset: m.endOffset!,
              })
            : undefined,
        },
      ]),
    );
  const cutStart = oldStarts.get(region.start.measureId)!,
    cutEnd = add(
      oldStarts.get(region.end.measureId)!,
      measureBeats(score.measures[last]),
    ),
    cutLength = sub(cutEnd, cutStart);
  score.measures.splice(first, last - first + 1);
  if (!score.measures.length)
    score.measures.push({ id: id(), beats: 4, beatType: 4, key: "C" });
  score.notes = score.notes.filter((n) => !removed.has(n.measureId));
  const collapse = (t: Rational) =>
    compare(t, cutStart) <= 0
      ? t
      : compare(t, cutEnd) < 0
        ? cutStart
        : sub(t, cutLength);
  score.marks = score.marks.flatMap((m) => {
    const t = oldTimes.get(m.id)!;
    if (!t.end) return removed.has(m.measureId) ? [] : [m];
    const a = collapse(t.start),
      b = collapse(t.end);
    if (compare(a, b) >= 0) return [];
    const start = positionAt(score, a),
      end = positionAt(score, b, true);
    return [
      { ...m, ...start, endMeasureId: end.measureId, endOffset: end.offset },
    ];
  });
  cleanLinks(score);
  return score.measures[Math.min(first, score.measures.length - 1)].id;
}

/** Spell a duration without converting exact tuplet time to floating point. */
export function spellDuration(
  span: Rational,
  preferred?: Duration,
): Duration[] {
  if (span.n === 0) return [];
  const candidates: Duration[] = [];
  for (const tuplets of [
    [],
    ...(preferred?.tuplets.length ? [preferred.tuplets] : []),
  ])
    for (const base of [1, 2, 4, 8, 16, 32, 64])
      for (const dots of [0, 1, 2])
        candidates.push(duration(base, dots, tuplets));
  const exact = candidates.find((d) => compare(beats(d), span) === 0);
  if (exact) return [exact];
  // Imported partial tuplets may need a ratio that differs from the source note.
  if ((span.d & (span.d - 1)) !== 0)
    for (let actual = 2; actual <= 16; actual++)
      for (let normal = 1; normal <= 16; normal++)
        for (const base of [1, 2, 4, 8, 16, 32, 64]) {
          const d = duration(base, 0, [{ actual, normal }]);
          if (compare(beats(d), span) === 0) return [d];
        }
  candidates.sort((a, b) => compare(beats(b), beats(a)));
  let remaining = span;
  const result: Duration[] = [];
  while (remaining.n && result.length < 128) {
    const d = candidates.find((d) => compare(beats(d), remaining) <= 0);
    if (!d)
      throw new Error(
        "This rhythm cannot be represented exactly. Select on note boundaries.",
      );
    result.push(structuredClone(d));
    remaining = sub(remaining, beats(d));
  }
  if (remaining.n)
    throw new Error("Rhythm exceeds the supported notation length.");
  return result;
}
function ensureLength(score: Score, end: Rational) {
  while (compare(scoreLength(score), end) < 0)
    insertMeasures(score, score.measures.length, 1);
}
/** Create tied fragments across barlines, preserving pitch, layer and expression. */
export function placeEvent(
  score: Score,
  template: NoteEvent,
  time: Rational,
  span = beats(template.duration),
) {
  ensureLength(score, add(time, span));
  let remaining = span,
    t = time;
  const result: NoteEvent[] = [];
  while (remaining.n) {
    const p = positionAt(score, t),
      m = score.measures.find((m) => m.id === p.measureId)!;
    const piece = min(remaining, sub(measureBeats(m), p.offset));
    for (const d of spellDuration(piece, template.duration)) {
      const n: NoteEvent = {
        ...structuredClone(template),
        id: result.length ? id() : template.id,
        ...positionAt(score, t),
        duration: d,
      };
      delete n.tieTo;
      delete n.slurTo;
      if (result.length) {
        delete n.grace;
        n.articulation = "";
      }
      const previous = result.at(-1);
      if (previous && n.pitches.length) previous.tieTo = n.id;
      result.push(n);
      t = add(t, beats(d));
    }
    remaining = sub(remaining, piece);
  }
  score.notes.push(...result);
  return result;
}
export function clearRegion(score: Score, region: Region, layer?: number) {
  const { start, end } = regionTimes(score, region),
    starts = measureStarts(score);
  const affected = regionNotes(score, region).filter(
    (n) => layer === undefined || n.voice === layer,
  );
  const ids = new Set(affected.map((n) => n.id));
  score.notes = score.notes.filter((n) => !ids.has(n.id));
  for (const n of affected) {
    const a = absolute(starts, n),
      b = add(a, beats(n.duration));
    if (compare(a, start) < 0) placeEvent(score, n, a, sub(start, a));
    if (compare(b, end) > 0) {
      const fragments = placeEvent(
        score,
        { ...n, id: id(), grace: undefined, articulation: "" },
        end,
        sub(b, end),
      );
      const tail = fragments.at(-1)!;
      tail.tieTo = n.tieTo;
      tail.slurTo = n.slurTo;
    }
  }
  if (layer === undefined)
    score.marks = score.marks.flatMap((m) => {
      if (
        !(m.staffId
          ? region.staffIds.includes(m.staffId)
          : region.staffIds.length === score.staves.length)
      )
        return [m];
      const a = absolute(starts, m);
      if (!m.endMeasureId)
        return compare(a, start) >= 0 && compare(a, end) < 0 ? [] : [m];
      const b = absolute(starts, {
        measureId: m.endMeasureId,
        offset: m.endOffset!,
      });
      if (compare(b, start) <= 0 || compare(a, end) >= 0) return [m];
      const pieces: Mark[] = [];
      const amountAt = (t: Rational) =>
        Math.round(
          m.amount +
            (((m.target ?? m.amount) - m.amount) * value(sub(t, a))) /
              value(sub(b, a)),
        );
      if (compare(a, start) < 0) {
        const p = positionAt(score, start, true);
        pieces.push({
          ...m,
          endMeasureId: p.measureId,
          endOffset: p.offset,
          target: m.target === undefined ? undefined : amountAt(start),
        });
      }
      if (compare(b, end) > 0) {
        const p = positionAt(score, end);
        pieces.push({
          ...m,
          id: id(),
          ...p,
          amount: m.target === undefined ? m.amount : amountAt(end),
        });
      }
      return pieces;
    });
  cleanLinks(score);
}
export function copyRegion(
  score: Score,
  region: Region,
  layer?: number,
): MusicClip {
  const { start, end } = regionTimes(score, region),
    starts = measureStarts(score);
  const notes = regionNotes(score, region)
    .filter((n) => layer === undefined || n.voice === layer)
    .map((event) => {
      const a = absolute(starts, event),
        b = add(a, beats(event.duration)),
        clipped = structuredClone(event);
      if (compare(a, start) < 0) {
        clipped.grace = undefined;
        clipped.articulation = "";
      }
      return {
        event: clipped,
        time: sub(max(a, start), start),
        span: sub(min(b, end), max(a, start)),
        staff: region.staffIds.indexOf(event.staffId),
      };
    });
  const marks: MusicClip["marks"] = score.marks.flatMap((mark) => {
    if (
      !(mark.staffId
        ? region.staffIds.includes(mark.staffId)
        : region.staffIds.length === score.staves.length)
    )
      return [];
    const a = absolute(starts, mark),
      b = mark.endMeasureId
        ? absolute(starts, {
            measureId: mark.endMeasureId,
            offset: mark.endOffset!,
          })
        : undefined;
    if (
      b
        ? compare(b, start) <= 0 || compare(a, end) >= 0
        : compare(a, start) < 0 || compare(a, end) >= 0
    )
      return [];
    const left = max(a, start),
      right = b ? min(b, end) : undefined,
      copy = structuredClone(mark);
    if (b && mark.target !== undefined) {
      const amountAt = (t: Rational) =>
        Math.round(
          mark.amount +
            ((mark.target! - mark.amount) * value(sub(t, a))) /
              value(sub(b, a)),
        );
      copy.amount = amountAt(left);
      copy.target = amountAt(right!);
    }
    return [
      {
        mark: copy,
        time: sub(left, start),
        end: right ? sub(right, start) : undefined,
        staff: mark.staffId ? region.staffIds.indexOf(mark.staffId) : undefined,
      },
    ];
  });
  return {
    length: sub(end, start),
    staffCount: region.staffIds.length,
    notes,
    marks,
    measures:
      isStack(score, region) && layer === undefined
        ? structuredClone(
            score.measures.slice(
              score.measures.findIndex((m) => m.id === region.start.measureId),
              score.measures.findIndex((m) => m.id === region.end.measureId) +
                1,
            ),
          )
        : undefined,
  };
}
export function pasteRegion(
  score: Score,
  clip: MusicClip,
  at: Cursor,
  insert = false,
  layer?: number,
): Region {
  if (!clip.length.n) throw new Error("Nothing to paste.");
  const firstStaff = score.staves.findIndex((s) => s.id === at.staffId);
  if (firstStaff < 0 || firstStaff + clip.staffCount > score.staves.length)
    throw new Error(
      "The copied region needs more destination staves. Choose a higher staff or add staves.",
    );
  const targetStaffIds = score.staves
    .slice(firstStaff, firstStaff + clip.staffCount)
    .map((s) => s.id);
  let time = absolute(measureStarts(score), at);
  if (
    insert &&
    clip.measures &&
    at.offset.n === 0 &&
    firstStaff === 0 &&
    clip.staffCount === score.staves.length
  ) {
    const before = score.measures.findIndex((m) => m.id === at.measureId);
    const added = insertMeasures(
      score,
      before,
      clip.measures.length,
      clip.measures,
    );
    at = { ...at, measureId: added[0].id };
    time = absolute(measureStarts(score), at);
  } else if (insert) {
    const tailRegion: Region = {
      start: positionAt(score, time),
      end: positionAt(score, scoreLength(score), true),
      staffIds: targetStaffIds,
    };
    const tail = copyRegion(score, tailRegion, layer);
    clearRegion(score, tailRegion, layer);
    ensureLength(score, add(scoreLength(score), clip.length));
    if (tail.length.n)
      pasteRegion(
        score,
        tail,
        { ...at, ...positionAt(score, add(time, clip.length)) },
        false,
        layer,
      );
  }
  ensureLength(score, add(time, clip.length));
  // A full stack carries its meter/key; ordinary staff regions retain target settings.
  if (
    clip.measures &&
    at.offset.n === 0 &&
    firstStaff === 0 &&
    clip.staffCount === score.staves.length &&
    layer === undefined
  ) {
    const first = score.measures.findIndex((m) => m.id === at.measureId);
    while (score.measures.length < first + clip.measures.length)
      insertMeasures(score, score.measures.length, 1);
    clearRegion(
      score,
      fullMeasures(score, first, first + clip.measures.length - 1),
    );
    clip.measures.forEach((m, i) => {
      score.measures[first + i] = {
        ...structuredClone(m),
        id: score.measures[first + i].id,
      };
    });
  }
  const region: Region = {
    start: positionAt(score, time),
    end: positionAt(score, add(time, clip.length), true),
    staffIds: targetStaffIds,
  };
  clearRegion(score, region, layer);
  const mapped = new Map<string, NoteEvent[]>();
  for (const n of clip.notes) {
    const template = { ...n.event, id: id(), staffId: targetStaffIds[n.staff] };
    mapped.set(
      n.event.id,
      placeEvent(score, template, add(time, n.time), n.span),
    );
  }
  for (const { event } of clip.notes) {
    const last = mapped.get(event.id)!.at(-1)!;
    if (event.tieTo && mapped.has(event.tieTo))
      last.tieTo = mapped.get(event.tieTo)![0].id;
    if (event.slurTo && mapped.has(event.slurTo))
      mapped.get(event.id)![0].slurTo = mapped.get(event.slurTo)![0].id;
  }
  for (const m of clip.marks) {
    const p = positionAt(score, add(time, m.time)),
      end = m.end ? positionAt(score, add(time, m.end), true) : undefined;
    score.marks.push({
      ...m.mark,
      id: id(),
      ...p,
      staffId: m.staff === undefined ? undefined : targetStaffIds[m.staff],
      endMeasureId: end?.measureId,
      endOffset: end?.offset,
    });
  }
  cleanLinks(score);
  return region;
}
export function enterNote(
  score: Score,
  at: Cursor,
  d: Duration,
  pitches: Pitch[],
): NoteEvent[] {
  const time = absolute(measureStarts(score), at),
    end = add(time, beats(d));
  ensureLength(score, end);
  const existing = score.notes.find(
    (n) =>
      n.staffId === at.staffId &&
      n.measureId === at.measureId &&
      n.voice === at.voice &&
      compare(n.offset, at.offset) === 0,
  );
  const incoming = existing
    ? score.notes
        .filter((n) => n.tieTo === existing.id || n.slurTo === existing.id)
        .map((n) => ({ id: n.id, tieTo: n.tieTo, slurTo: n.slurTo }))
    : [];
  if (existing) score.notes = score.notes.filter((n) => n.id !== existing.id);
  clearRegion(
    score,
    {
      start: positionAt(score, time),
      end: positionAt(score, end, true),
      staffIds: [at.staffId],
    },
    at.voice,
  );
  const template: NoteEvent = {
    ...(existing ?? { id: id(), articulation: "" }),
    ...at,
    duration: d,
    pitches,
  };
  if (!pitches.length) {
    template.articulation = "";
    delete template.grace;
  }
  const result = placeEvent(score, template, time);
  if (existing) {
    result.at(-1)!.tieTo = existing.tieTo;
    result[0].slurTo = existing.slurTo;
  }
  for (const link of incoming) {
    const n = score.notes.find((n) => n.id === link.id);
    if (n) {
      n.tieTo = link.tieTo;
      n.slurTo = link.slurTo;
    }
  }
  cleanLinks(score);
  return result;
}
export function transposeRegion(
  score: Score,
  region: Region,
  semitones: number,
) {
  for (const n of regionNotes(score, region)) {
    n.pitches = n.pitches.map((p) => pitchFromMidi(midiPitch(p) + semitones));
    n.grace = n.grace?.map((p) => pitchFromMidi(midiPitch(p) + semitones));
  }
  cleanLinks(score);
}
/** Rebar an explicit measure range without throwing away overflowing music. */
export function changeMeter(
  score: Score,
  first: number,
  last: number,
  numerator: number,
  denominator: number,
  rebar = true,
) {
  if (
    !Number.isInteger(numerator) ||
    numerator < 1 ||
    numerator > 32 ||
    ![1, 2, 4, 8, 16, 32].includes(denominator)
  )
    throw new Error("Choose a valid time signature.");
  if (first < 0 || last < first || last >= score.measures.length)
    throw new Error("Choose a valid measure range.");
  const starts = measureStarts(score),
    base = starts.get(score.measures[first].id)!,
    rangeIds = new Set(score.measures.slice(first, last + 1).map((m) => m.id));
  const oldLength = score.measures
    .slice(first, last + 1)
    .reduce((t, m) => add(t, measureBeats(m)), ZERO);
  const moving = score.notes
    .filter((n) => rangeIds.has(n.measureId))
    .map((n) => ({
      event: structuredClone(n),
      time: sub(absolute(starts, n), base),
    }));
  const markPositions = score.marks.map((m) => ({
    mark: m,
    start: rangeIds.has(m.measureId)
      ? sub(absolute(starts, m), base)
      : undefined,
    end:
      m.endMeasureId && rangeIds.has(m.endMeasureId)
        ? sub(
            absolute(starts, {
              measureId: m.endMeasureId,
              offset: m.endOffset!,
            }),
            base,
          )
        : undefined,
  }));
  for (let i = first; i <= last; i++) {
    score.measures[i].beats = numerator;
    score.measures[i].beatType = denominator;
    if (
      score.measures[i].pickup &&
      compare(score.measures[i].pickup!, rat(numerator * 4, denominator)) > 0
    )
      delete score.measures[i].pickup;
  }
  if (!rebar) return;
  let length = score.measures
      .slice(first, last + 1)
      .reduce((t, m) => add(t, measureBeats(m)), ZERO),
    after = last + 1;
  while (compare(length, oldLength) < 0) {
    const template = {
      ...score.measures[last],
      id: id(),
      pickup: undefined,
      repeatStart: undefined,
      repeatEnd: undefined,
      ending: undefined,
    };
    insertMeasures(score, after++, 1, [template]);
    length = add(length, measureBeats(template));
  }
  score.notes = score.notes.filter((n) => !rangeIds.has(n.measureId));
  const fragments = new Map<string, NoteEvent[]>();
  for (const { event, time } of moving)
    fragments.set(event.id, placeEvent(score, event, add(base, time)));
  for (const { event } of moving) {
    const pieces = fragments.get(event.id)!;
    if (event.tieTo) pieces.at(-1)!.tieTo = event.tieTo;
    if (event.slurTo) pieces[0].slurTo = event.slurTo;
  }
  for (const p of markPositions) {
    if (p.start) Object.assign(p.mark, positionAt(score, add(base, p.start)));
    if (p.end) {
      const end = positionAt(score, add(base, p.end), true);
      p.mark.endMeasureId = end.measureId;
      p.mark.endOffset = end.offset;
    }
  }
  cleanLinks(score);
}
export function repeatRegion(score: Score, region: Region, times: number) {
  if (!Number.isInteger(times) || times < 1 || times > 100)
    throw new Error("Choose 1–100 copies.");
  const clip = copyRegion(score, region),
    start = regionTimes(score, region).end;
  for (let i = 0; i < times; i++) {
    const at = add(start, mul(clip.length, rat(i)));
    ensureLength(score, add(at, clip.length));
    pasteRegion(score, clip, {
      ...positionAt(score, at),
      staffId: region.staffIds[0],
      voice: 0,
    });
  }
}
export function regionDescription(score: Score, region: Region) {
  const a =
      score.measures.findIndex((m) => m.id === region.start.measureId) + 1,
    b = score.measures.findIndex((m) => m.id === region.end.measureId) + 1;
  return `Measure${a === b ? "" : "s"} ${a}${a === b ? "" : `–${b}`} · ${region.staffIds.length} ${region.staffIds.length === 1 ? "staff" : "staves"} · ${Number(value(sub(regionTimes(score, region).end, regionTimes(score, region).start)).toFixed(3))} beats`;
}
