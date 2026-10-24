import {
  absolute,
  beats,
  keyAlter,
  measureBeats,
  measureStarts,
  midiPitch,
  moveDiatonic,
  scoreLength,
  type Articulation,
  type Mark,
  type Score,
} from "../core/model";
import { value } from "../core/rational";

export interface Span {
  id: string;
  eventIds: string[];
  staffId: string;
  instrumentId: string;
  midi: number;
  start: number;
  end: number;
  gateEnd: number;
  pedalEnd: number;
  articulation: Articulation;
  program: number;
  percussion: boolean;
}
export interface DesiredVoice {
  id: string;
  staffId: string;
  midi: number;
  program: number;
  percussion: boolean;
  velocity: number;
  expression: number;
  volume: number;
  pan: number;
}
export interface Scope {
  mode: "all" | "staff" | "instrument";
  staffId: string;
  pedal: boolean;
}
interface TimedMark extends Mark {
  start: number;
  end: number;
}
interface Node {
  span: Span;
  max: number;
  left?: Node;
  right?: Node;
}
function tree(spans: Span[]): Node | undefined {
  if (!spans.length) return;
  const mid = spans.length >> 1,
    left = tree(spans.slice(0, mid)),
    right = tree(spans.slice(mid + 1));
  return {
    span: spans[mid],
    left,
    right,
    max: Math.max(spans[mid].pedalEnd, left?.max ?? 0, right?.max ?? 0),
  };
}
export class ScoreIndex {
  readonly starts;
  readonly spans: Span[] = [];
  readonly marks: TimedMark[];
  readonly length: number;
  readonly boundaries: number[];
  private root?: Node;
  constructor(readonly score: Score) {
    this.starts = measureStarts(score);
    this.length = value(scoreLength(score));
    this.marks = score.marks
      .map((m) => ({
        ...m,
        start: value(absolute(this.starts, m)),
        end: m.endMeasureId
          ? value(
              absolute(this.starts, {
                measureId: m.endMeasureId,
                offset: m.endOffset ?? { n: 0, d: 1 },
              }),
            )
          : value(absolute(this.starts, m)),
      }))
      .sort((a, b) => a.start - b.start);
    const notes = new Map(score.notes.map((n) => [n.id, n]));
    const consumed = new Set<string>();
    const sorted = [...score.notes].sort(
      (a, b) =>
        value(absolute(this.starts, a)) - value(absolute(this.starts, b)),
    );
    for (const note of sorted) {
      const staff = score.staves.find((s) => s.id === note.staffId)!,
        inst = score.instruments.find((i) => i.id === staff.instrumentId)!;
      for (const [pIndex, p] of note.pitches.entries()) {
        const identity = `${note.id}:${pIndex}`;
        if (consumed.has(identity)) continue;
        const start = value(absolute(this.starts, note));
        let end = start + value(beats(note.duration));
        let tail = note;
        const eventIds = [note.id],
          seen = new Set([note.id]);
        while (tail.tieTo) {
          const next = notes.get(tail.tieTo);
          if (
            !next ||
            seen.has(next.id) ||
            next.staffId !== note.staffId ||
            next.voice !== note.voice
          )
            break;
          const match = next.pitches.findIndex(
            (q) => midiPitch(q) === midiPitch(p),
          );
          if (
            match < 0 ||
            Math.abs(value(absolute(this.starts, next)) - end) > 1e-8
          )
            break;
          consumed.add(`${next.id}:${match}`);
          seen.add(next.id);
          eventIds.push(next.id);
          end += value(beats(next.duration));
          tail = next;
        }
        const program = this.discrete(
          "program",
          note.staffId,
          start,
          inst.program,
        );
        const octave = this.discrete("ottava", note.staffId, start, 0);
        const midi =
          midiPitch(p) + (inst.percussion ? 0 : inst.transpose + octave);
        if (midi < 0 || midi > 127) continue;
        const factor =
          tail.articulation === "staccato"
            ? 0.48
            : tail.articulation === "tenuto"
              ? 1
              : tail.slurTo
                ? 1.02
                : 0.94;
        const gateEnd =
          eventIds.length > 1
            ? end -
              (end - value(absolute(this.starts, tail))) *
                (1 - Math.min(1, factor))
            : start + (end - start) * factor;
        let pedalEnd = Math.max(end, gateEnd);
        for (const pedal of this.marks.filter(
          (m) =>
            m.kind === "pedal" &&
            this.applies(m, note.staffId) &&
            m.start <= gateEnd &&
            m.end > gateEnd,
        ))
          pedalEnd = Math.max(pedalEnd, pedal.end);
        this.spans.push({
          id: identity,
          eventIds,
          staffId: note.staffId,
          instrumentId: inst.id,
          midi,
          start,
          end,
          gateEnd,
          pedalEnd,
          articulation: note.articulation,
          program: Math.round(program),
          percussion: inst.percussion,
        });
      }
    }
    this.spans.sort((a, b) => a.start - b.start);
    this.root = tree(this.spans);
    this.boundaries = [
      ...new Set([
        0,
        this.length,
        ...this.spans.flatMap((s) => [s.start, s.end, s.pedalEnd]),
        ...score.notes.flatMap((n) => [
          value(absolute(this.starts, n)),
          value(absolute(this.starts, n)) + value(beats(n.duration)),
        ]),
        ...this.marks.flatMap((m) => [m.start, m.end]),
      ]),
    ].sort((a, b) => a - b);
  }
  private applies(m: TimedMark, staffId: string) {
    return !m.staffId || m.staffId === staffId;
  }
  discrete(
    kind: Mark["kind"],
    staffId: string,
    t: number,
    fallback: number,
  ): number {
    let result = fallback;
    for (const m of this.marks) {
      if (m.start > t + 1e-9) break;
      if (
        m.kind === kind &&
        this.applies(m, staffId) &&
        (kind !== "ottava" || t < m.end - 1e-9)
      )
        result = m.amount;
    }
    return result;
  }
  dynamic(staffId: string, t: number): number {
    let result = 80,
      latest = -Infinity;
    for (const m of this.marks) {
      if (m.start > t + 1e-9) break;
      if (!this.applies(m, staffId)) continue;
      if (m.kind === "dynamic" && m.start >= latest) {
        result = m.amount;
        latest = m.start;
      }
      if (m.kind === "hairpin" && m.start >= latest) {
        const f =
          m.end > m.start
            ? Math.max(0, Math.min(1, (t - m.start) / (m.end - m.start)))
            : 1;
        result = m.amount + ((m.target ?? m.amount) - m.amount) * f;
        latest = m.start;
      }
    }
    return Math.max(1, Math.min(127, result));
  }
  tempo(t: number): number {
    let bpm = this.score.tempo;
    for (const m of this.marks) {
      if (m.start > t + 1e-9) break;
      if (m.kind === "tempo") bpm = m.amount;
      if (m.kind === "tempoRamp") {
        const f =
          m.end > m.start ? Math.min(1, (t - m.start) / (m.end - m.start)) : 1;
        bpm = m.amount + ((m.target ?? m.amount) - m.amount) * f;
      }
    }
    return Math.max(20, Math.min(400, bpm));
  }
  allowed(span: Span, scope: Scope): boolean {
    const inst = this.score.instruments.find(
      (i) => i.id === span.instrumentId,
    )!;
    if (inst.mute || (this.score.instruments.some((i) => i.solo) && !inst.solo))
      return false;
    if (scope.mode === "staff") return span.staffId === scope.staffId;
    if (scope.mode === "instrument")
      return (
        span.instrumentId ===
        this.score.staves.find((s) => s.id === scope.staffId)?.instrumentId
      );
    return true;
  }
  voice(span: Span, t: number, id = span.id): DesiredVoice {
    const i = this.score.instruments.find((i) => i.id === span.instrumentId)!;
    const accent =
      span.articulation === "accent"
        ? 16
        : span.articulation === "marcato"
          ? 24
          : 0;
    // CC11 carries dynamic gain on held notes; velocity supplies the attack/timbre.
    const attack = this.dynamic(span.staffId, span.start),
      dynamic = this.dynamic(span.staffId, t);
    return {
      id,
      staffId: span.staffId,
      midi: span.midi,
      program: span.program,
      percussion: span.percussion,
      velocity: Math.min(127, Math.round(64 + attack * 0.3 + accent)),
      expression: Math.round(dynamic),
      volume: i.volume,
      pan: i.pan,
    };
  }
  at(t: number, scope: Scope): DesiredVoice[] {
    if (t < 0 || t >= this.length + 1e-9) return [];
    const result: DesiredVoice[] = [];
    const visit = (node?: Node) => {
      if (!node || node.max <= t) return;
      visit(node.left);
      const s = node.span;
      if (
        s.start <= t + 1e-9 &&
        (scope.pedal ? s.pedalEnd : s.end) > t + 1e-9 &&
        this.allowed(s, scope)
      )
        result.push(this.voice(s, t));
      if (s.start <= t + 1e-9) visit(node.right);
    };
    visit(this.root);
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
}

export interface Occurrence {
  measureIndex: number;
  pass: number;
  start: number;
  sourceStart: number;
  length: number;
  run: number;
}
export function roadmap(score: Score): Occurrence[] {
  const starts = measureStarts(score),
    result: Occurrence[] = [];
  let repeatStart = 0,
    pass = 1,
    i = 0,
    position = 0,
    run = 0,
    previous = -1;
  const repeated = new Set<number>();
  let steps = 0;
  while (i < score.measures.length && steps++ < score.measures.length * 6) {
    const m = score.measures[i];
    if (m.repeatStart && pass === 1) repeatStart = i;
    if (!m.ending || m.ending === pass) {
      if (i !== previous + 1) run++;
      const length = value(measureBeats(m));
      result.push({
        measureIndex: i,
        pass,
        start: position,
        sourceStart: value(starts.get(m.id)!),
        length,
        run,
      });
      position += length;
      previous = i;
    }
    if (m.repeatEnd && !repeated.has(i)) {
      repeated.add(i);
      pass = 2;
      i = repeatStart;
      continue;
    }
    if (m.repeatEnd && pass === 2 && !score.measures[i + 1]?.ending) pass = 1;
    if (m.ending === 2 && !score.measures[i + 1]?.ending) pass = 1;
    i++;
  }
  return result;
}
export interface TimedVoice extends DesiredVoice {
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  instrumentId: string;
}
export interface TempoPoint {
  beat: number;
  bpm: number;
  seconds: number;
}
export interface AudioAction {
  at: number;
  kind: "on" | "off" | "expression";
  voice?: DesiredVoice;
  id?: string;
  staffId?: string;
  expression?: number;
}
export interface Performance {
  voices: TimedVoice[];
  tempos: TempoPoint[];
  actions: AudioAction[];
  occurrences: Occurrence[];
  duration: number;
  totalBeats: number;
  secondsAt: (beat: number) => number;
  scoreAt: (seconds: number) => number;
}
export function compilePerformance(index: ScoreIndex): Performance {
  const occurrences = roadmap(index.score),
    tempos: TempoPoint[] = [],
    voices: TimedVoice[] = [];
  let seconds = 0;
  for (const occ of occurrences) {
    const count = Math.ceil(occ.length * 32),
      delta = occ.length / count;
    for (let j = 0; j < count; j++) {
      const source = occ.sourceStart + j * delta;
      let bpm = index.tempo(source + delta / 2);
      const fermata = index.spans.some(
        (s) =>
          s.articulation === "fermata" &&
          s.start <= source + 1e-9 &&
          s.end > source,
      );
      if (fermata) bpm /= 1.6;
      tempos.push({ beat: occ.start + j * delta, bpm, seconds });
      seconds += (delta * 60) / bpm;
    }
  }
  const totalBeats = occurrences.reduce((s, o) => s + o.length, 0);
  tempos.push({
    beat: totalBeats,
    bpm: tempos.at(-1)?.bpm ?? index.score.tempo,
    seconds,
  });
  const locate = (
    array: TempoPoint[],
    target: number,
    field: "beat" | "seconds",
  ) => {
    let lo = 0,
      hi = array.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (array[mid][field] <= target) lo = mid;
      else hi = mid - 1;
    }
    return array[lo];
  };
  const secondsAt = (beat: number) => {
    const p = locate(tempos, Math.max(0, beat), "beat");
    return p.seconds + ((beat - p.beat) * 60) / p.bpm;
  };
  const scoreAt = (t: number) => {
    const p = locate(tempos, Math.max(0, t), "seconds"),
      beat = p.beat + ((t - p.seconds) * p.bpm) / 60;
    const occ =
      occurrences.find((o) => beat >= o.start && beat < o.start + o.length) ??
      occurrences.at(-1);
    return occ
      ? Math.min(
          occ.sourceStart + occ.length,
          occ.sourceStart + beat - occ.start,
        )
      : 0;
  };
  for (let oi = 0; oi < occurrences.length; oi++) {
    const occ = occurrences[oi];
    const runEnd =
      occurrences.slice(oi).find((o) => o.run !== occ.run)?.start ?? totalBeats;
    for (const span of index.spans) {
      if (
        span.start < occ.sourceStart - 1e-8 ||
        span.start >= occ.sourceStart + occ.length - 1e-8 ||
        !index.allowed(span, { mode: "all", staffId: "", pedal: true })
      )
        continue;
      const start = occ.start + span.start - occ.sourceStart;
      const end = Math.min(
        runEnd,
        start +
          Math.max(
            span.gateEnd,
            span.pedalEnd > span.end ? span.pedalEnd : span.gateEnd,
          ) -
          span.start,
      );
      const note = index.score.notes.find((n) => n.id === span.eventIds[0])!;
      const base = index.voice(span, span.start, `${occ.run}/${span.id}`);
      const graceLength = note.grace?.length
        ? Math.min(0.125, (end - start) / (note.grace.length + 2))
        : 0;
      if (note.grace?.length && span.id.endsWith(":0")) {
        note.grace.forEach((pitch, j) =>
          voices.push({
            ...base,
            id: `${base.id}:g${j}`,
            midi:
              midiPitch(pitch) +
              (span.percussion
                ? 0
                : index.score.instruments.find(
                    (i) => i.id === span.instrumentId,
                  )!.transpose +
                  index.discrete("ottava", span.staffId, span.start, 0)),
            start: start + j * graceLength,
            end: start + (j + 1) * graceLength,
            sourceStart: span.start,
            sourceEnd: span.start,
            instrumentId: span.instrumentId,
          }),
        );
      }
      if (span.articulation === "trill" || span.articulation === "tremolo") {
        const pitch = note.pitches[Number(span.id.split(":").at(-1))],
          upper = moveDiatonic(pitch, 1);
        upper.alter = keyAlter(
          upper.step,
          index.score.measures[occ.measureIndex].key,
        );
        const interval = midiPitch(upper) - midiPitch(pitch);
        for (
          let t = start + (note.grace?.length ?? 0) * graceLength, j = 0;
          t < end - 1e-8;
          t += 0.125, j++
        )
          voices.push({
            ...base,
            id: `${base.id}:o${j}`,
            midi: Math.max(
              0,
              Math.min(
                127,
                base.midi +
                  (span.articulation === "trill" && j % 2 ? interval : 0),
              ),
            ),
            start: t,
            end: Math.min(end, t + 0.11),
            sourceStart: span.start + t - start,
            sourceEnd: span.start + t - start + 0.125,
            instrumentId: span.instrumentId,
          });
      } else
        voices.push({
          ...base,
          start: start + (note.grace?.length ?? 0) * graceLength,
          end,
          sourceStart: span.start,
          sourceEnd: span.end,
          instrumentId: span.instrumentId,
        });
    }
  }
  const actions: AudioAction[] = voices.flatMap((v) => [
    { at: secondsAt(v.start), kind: "on" as const, voice: v },
    { at: secondsAt(v.end), kind: "off" as const, id: v.id },
  ]);
  for (const occ of occurrences)
    for (let beat = 0; beat < occ.length; beat += 0.125)
      for (const staff of index.score.staves) {
        actions.push({
          at: secondsAt(occ.start + beat),
          kind: "expression",
          staffId: staff.id,
          expression: Math.round(
            index.dynamic(staff.id, occ.sourceStart + beat),
          ),
        });
      }
  const priority = { off: 0, expression: 1, on: 2 };
  actions.sort((a, b) => a.at - b.at || priority[a.kind] - priority[b.kind]);
  return {
    voices,
    tempos,
    actions,
    occurrences,
    duration: seconds,
    totalBeats,
    secondsAt,
    scoreAt,
  };
}
