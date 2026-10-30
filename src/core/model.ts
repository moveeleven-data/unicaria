import { add, compare, mul, rat, value, ZERO, type Rational } from "./rational";

export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export interface Pitch {
  step: Step;
  alter: number;
  octave: number;
}
export interface Duration {
  base: number;
  dots: number;
  tuplets: { actual: number; normal: number }[];
}
export type Articulation =
  | ""
  | "staccato"
  | "tenuto"
  | "accent"
  | "marcato"
  | "fermata"
  | "trill"
  | "tremolo";
export interface NoteEvent {
  id: string;
  staffId: string;
  measureId: string;
  voice: number;
  offset: Rational;
  duration: Duration;
  pitches: Pitch[];
  articulation: Articulation;
  tieTo?: string;
  slurTo?: string;
  grace?: Pitch[];
}
export interface Instrument {
  id: string;
  name: string;
  program: number;
  transpose: number;
  percussion: boolean;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
}
export interface Staff {
  id: string;
  instrumentId: string;
  name: string;
  clef: "treble" | "bass" | "alto" | "tenor" | "percussion";
}
export interface Measure {
  id: string;
  beats: number;
  beatType: number;
  key: string;
  pickup?: Rational;
  repeatStart?: boolean;
  repeatEnd?: boolean;
  ending?: number;
}
export type MarkKind =
  | "dynamic"
  | "hairpin"
  | "tempo"
  | "tempoRamp"
  | "pedal"
  | "text"
  | "program"
  | "ottava";
export interface Mark {
  id: string;
  kind: MarkKind;
  staffId?: string;
  measureId: string;
  offset: Rational;
  endMeasureId?: string;
  endOffset?: Rational;
  text: string;
  amount: number;
  target?: number;
}
export interface Score {
  format: "unicaria";
  version: 1;
  title: string;
  composer: string;
  tempo: number;
  instruments: Instrument[];
  staves: Staff[];
  measures: Measure[];
  notes: NoteEvent[];
  marks: Mark[];
}
export interface Cursor {
  staffId: string;
  measureId: string;
  offset: Rational;
  voice: number;
}
export const id = () => crypto.randomUUID();
export const duration = (
  base = 4,
  dots = 0,
  tuplets: Duration["tuplets"] = [],
): Duration => ({ base, dots, tuplets });
export function beats(d: Duration): Rational {
  let result = mul(rat(4, d.base), rat(2 ** (d.dots + 1) - 1, 2 ** d.dots));
  for (const ratio of d.tuplets)
    result = mul(result, rat(ratio.normal, ratio.actual));
  return result;
}
export const measureBeats = (m: Measure) =>
  m.pickup ?? rat(m.beats * 4, m.beatType);
export const steps: Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const semitones = [0, 2, 4, 5, 7, 9, 11];
export const midiPitch = (p: Pitch) =>
  (p.octave + 1) * 12 + semitones[steps.indexOf(p.step)] + p.alter;
export function pitchFromMidi(midi: number): Pitch {
  const pc = ((midi % 12) + 12) % 12;
  const index = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pc];
  return {
    step: steps[index],
    alter: pc - semitones[index],
    octave: Math.floor(midi / 12) - 1,
  };
}
export function moveDiatonic(p: Pitch, amount: number): Pitch {
  const diatonic = p.octave * 7 + steps.indexOf(p.step) + amount;
  return {
    step: steps[((diatonic % 7) + 7) % 7],
    octave: Math.floor(diatonic / 7),
    alter: p.alter,
  };
}
export const pitchName = (p: Pitch) =>
  `${p.step}${p.alter === 2 ? "𝄪" : p.alter === 1 ? "♯" : p.alter === -1 ? "♭" : p.alter === -2 ? "𝄫" : ""}${p.octave}`;
export const keySignatures = [
  "Cb",
  "Gb",
  "Db",
  "Ab",
  "Eb",
  "Bb",
  "F",
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
];
export function keyAlter(step: Step, signature: string): number {
  const count = keySignatures.indexOf(signature) - 7;
  const order = count > 0 ? "FCGDAEB" : "BEADGCF";
  return order.slice(0, Math.abs(count)).includes(step) ? Math.sign(count) : 0;
}
export function transposeKey(key: string, transpose: number) {
  if (!transpose) return key;
  const tonic = (name: string) =>
    midiPitch({
      step: name[0] as Step,
      alter: name.includes("#") ? 1 : name.includes("b") ? -1 : 0,
      octave: 4,
    }) % 12;
  const target = (((tonic(key) + transpose) % 12) + 12) % 12;
  return (
    [...keySignatures]
      .filter((k) => tonic(k) === target)
      .sort(
        (a, b) =>
          Math.abs(keySignatures.indexOf(a) - 7) -
          Math.abs(keySignatures.indexOf(b) - 7),
      )[0] ?? key
  );
}
export function measureStarts(score: Score): Map<string, Rational> {
  const starts = new Map<string, Rational>();
  let t = ZERO;
  for (const m of score.measures) {
    starts.set(m.id, t);
    t = add(t, measureBeats(m));
  }
  return starts;
}
export const absolute = (
  starts: Map<string, Rational>,
  p: { measureId: string; offset: Rational },
) => add(starts.get(p.measureId) ?? ZERO, p.offset);
export const scoreLength = (score: Score) =>
  score.measures.reduce((t, m) => add(t, measureBeats(m)), ZERO);
export function blankScore(): Score {
  const instrument: Instrument = {
    id: id(),
    name: "Piano",
    program: 0,
    transpose: 0,
    percussion: false,
    volume: 90,
    pan: 64,
    mute: false,
    solo: false,
  };
  return {
    format: "unicaria",
    version: 1,
    title: "Untitled",
    composer: "",
    tempo: 96,
    instruments: [instrument],
    staves: [
      { id: id(), instrumentId: instrument.id, name: "Piano", clef: "treble" },
      { id: id(), instrumentId: instrument.id, name: "Piano", clef: "bass" },
    ],
    measures: Array.from({ length: 8 }, () => ({
      id: id(),
      beats: 4,
      beatType: 4,
      key: "C",
    })),
    notes: [],
    marks: [],
  };
}
export const cloneScore = (score: Score): Score => structuredClone(score);
export function noteAt(score: Score, cursor: Cursor): NoteEvent | undefined {
  return score.notes.find(
    (n) =>
      n.staffId === cursor.staffId &&
      n.measureId === cursor.measureId &&
      n.voice === cursor.voice &&
      compare(n.offset, cursor.offset) === 0,
  );
}
export function nextCursor(
  score: Score,
  cursor: Cursor,
  span: Rational,
): Cursor {
  let index = score.measures.findIndex((m) => m.id === cursor.measureId),
    offset = add(cursor.offset, span);
  while (
    index < score.measures.length - 1 &&
    compare(offset, measureBeats(score.measures[index])) >= 0
  ) {
    const length = measureBeats(score.measures[index]);
    offset = rat(
      offset.n * length.d - length.n * offset.d,
      offset.d * length.d,
    );
    index++;
  }
  // Stay at the final barline. Wrapping to zero would overwrite completed music.
  if (compare(offset, measureBeats(score.measures[index])) >= 0)
    offset = measureBeats(score.measures[index]);
  return { ...cursor, measureId: score.measures[index].id, offset };
}
/** Replace only the chosen voice and reject notes that do not fit the measure. */
export function putNote(
  score: Score,
  cursor: Cursor,
  d: Duration,
  pitches: Pitch[],
): NoteEvent {
  const m = score.measures.find((m) => m.id === cursor.measureId)!;
  const end = add(cursor.offset, beats(d));
  if (compare(end, measureBeats(m)) > 0)
    throw new Error(
      "That duration crosses the barline. Use a shorter value and tie it to the next measure.",
    );
  const removed = new Set(
    score.notes
      .filter(
        (n) =>
          n.staffId === cursor.staffId &&
          n.measureId === cursor.measureId &&
          n.voice === cursor.voice &&
          compare(n.offset, end) < 0 &&
          compare(add(n.offset, beats(n.duration)), cursor.offset) > 0,
      )
      .map((n) => n.id),
  );
  score.notes = score.notes.filter((n) => !removed.has(n.id));
  for (const n of score.notes) {
    if (n.tieTo && removed.has(n.tieTo)) delete n.tieTo;
    if (n.slurTo && removed.has(n.slurTo)) delete n.slurTo;
  }
  const note: NoteEvent = {
    id: id(),
    ...cursor,
    duration: structuredClone(d),
    pitches,
    articulation: "",
  };
  score.notes.push(note);
  return note;
}
export function connectNext(
  score: Score,
  eventId: string,
  type: "tieTo" | "slurTo",
): void {
  const n = score.notes.find((n) => n.id === eventId);
  if (!n) return;
  if (n[type]) {
    delete n[type];
    return;
  }
  const starts = measureStarts(score),
    t = value(absolute(starts, n)) + value(beats(n.duration));
  const next = score.notes
    .filter(
      (x) =>
        x.staffId === n.staffId &&
        x.voice === n.voice &&
        value(absolute(starts, x)) >= t - 1e-9,
    )
    .sort((a, b) => compare(absolute(starts, a), absolute(starts, b)))[0];
  if (!next || !next.pitches.length)
    throw new Error("Enter the following note first.");
  if (
    type === "tieTo" &&
    (Math.abs(value(absolute(starts, next)) - t) > 1e-9 ||
      !n.pitches.some((p) =>
        next.pitches.some((q) => midiPitch(p) === midiPitch(q)),
      ))
  )
    throw new Error("A tie needs an adjacent note of the same pitch.");
  n[type] = next.id;
}
