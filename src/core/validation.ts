import {
  absolute,
  beats,
  measureBeats,
  measureStarts,
  midiPitch,
  keySignatures,
  type Score,
} from "./model";
import { add, compare, rat } from "./rational";

/** Imported documents cross a trust boundary. Validate before rendering or playing. */
export function parseScore(text: string): Score {
  if (text.length > 20_000_000)
    throw new Error("Score file is too large (20 MB maximum).");
  const score: Score = JSON.parse(text);
  // The original prototype used the same schema under a different name.
  if (
    score &&
    (score.format as string) === "counterpoint" &&
    score.version === 1
  )
    score.format = "unicaria";
  validateScore(score);
  return score;
}
export function validateScore(score: Score): void {
  const fail = (message: string): never => {
    throw new Error(`Invalid score: ${message}`);
  };
  const integer = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  const string = (v: unknown, max = 200) =>
    typeof v === "string" && v.length <= max;
  if (!score || score.format !== "unicaria" || score.version !== 1)
    fail("unsupported document format or version.");
  if (
    !string(score.title) ||
    !string(score.composer) ||
    !integer(score.tempo, 20, 400)
  )
    fail("title, composer or tempo.");
  for (const [name, max] of [
    ["instruments", 64],
    ["staves", 64],
    ["measures", 2000],
    ["notes", 200000],
    ["marks", 20000],
  ] as const) {
    if (!Array.isArray(score[name]) || score[name].length > max)
      fail(`${name} limit.`);
  }
  if (
    !score.staves.length ||
    !score.measures.length ||
    !score.instruments.length
  )
    fail("a score needs an instrument, staff and measure.");
  const ids = new Set<string>();
  for (const item of [
    ...score.instruments,
    ...score.staves,
    ...score.measures,
    ...score.notes,
    ...score.marks,
  ]) {
    if (!string(item.id, 100) || !item.id || ids.has(item.id))
      fail("missing or duplicate object ID.");
    ids.add(item.id);
  }
  const instruments = new Set(score.instruments.map((i) => i.id)),
    staffs = new Set(score.staves.map((s) => s.id)),
    measures = new Map(score.measures.map((m) => [m.id, m]));
  const rational = (x: { n: number; d: number }) => {
    if (!x || !integer(x.n, 0, 10000000) || !integer(x.d, 1, 1000000))
      fail("invalid rational time.");
    rat(x.n, x.d);
  };
  for (const i of score.instruments) {
    if (
      !string(i.name) ||
      !integer(i.program, 0, 127) ||
      !integer(i.transpose, -36, 36) ||
      !integer(i.volume, 0, 127) ||
      !integer(i.pan, 0, 127) ||
      typeof i.mute !== "boolean" ||
      typeof i.solo !== "boolean" ||
      typeof i.percussion !== "boolean"
    )
      fail("instrument.");
  }
  for (const s of score.staves) {
    if (
      !instruments.has(s.instrumentId) ||
      !string(s.name) ||
      !["treble", "bass", "alto", "tenor", "percussion"].includes(s.clef)
    )
      fail("staff.");
  }
  for (const m of score.measures) {
    if (
      !integer(m.beats, 1, 32) ||
      ![1, 2, 4, 8, 16, 32].includes(m.beatType) ||
      !keySignatures.includes(m.key)
    )
      fail("meter or key.");
    if (m.pickup) {
      rational(m.pickup);
      if (
        m.pickup.n === 0 ||
        compare(m.pickup, rat(m.beats * 4, m.beatType)) > 0
      )
        fail("pickup duration.");
    }
    if (m.ending !== undefined && ![1, 2].includes(m.ending))
      fail("repeat ending.");
  }
  const pitch = (p: { step: string; alter: number; octave: number }) => {
    if (
      !p ||
      !["C", "D", "E", "F", "G", "A", "B"].includes(p.step) ||
      !integer(p.alter, -2, 2) ||
      !integer(p.octave, -1, 9)
    )
      fail("pitch.");
  };
  const voices = new Map<string, Score["notes"]>();
  for (const n of score.notes) {
    rational(n.offset);
    const m = measures.get(n.measureId);
    if (!m || !staffs.has(n.staffId) || !integer(n.voice, 0, 3))
      fail("note location.");
    if (
      !n.duration ||
      ![1, 2, 4, 8, 16, 32, 64].includes(n.duration.base) ||
      !integer(n.duration.dots, 0, 2) ||
      !Array.isArray(n.duration.tuplets) ||
      n.duration.tuplets.length > 3
    )
      fail("duration.");
    for (const t of n.duration.tuplets)
      if (!integer(t.actual, 2, 16) || !integer(t.normal, 1, 16))
        fail("tuplet ratio.");
    if (!Array.isArray(n.pitches) || n.pitches.length > 16) fail("chord.");
    n.pitches.forEach(pitch);
    if (new Set(n.pitches.map(midiPitch)).size !== n.pitches.length)
      fail("duplicate pitch in a chord.");
    if (
      ![
        "",
        "staccato",
        "tenuto",
        "accent",
        "marcato",
        "fermata",
        "trill",
        "tremolo",
      ].includes(n.articulation)
    )
      fail("articulation.");
    if (n.grace) {
      if (!Array.isArray(n.grace) || n.grace.length > 16) fail("grace notes.");
      n.grace.forEach(pitch);
    }
    if (compare(add(n.offset, beats(n.duration)), measureBeats(m!)) > 0)
      fail("note extends beyond barline.");
    const k = `${n.staffId}/${n.measureId}/${n.voice}`;
    const list = voices.get(k) ?? [];
    list.push(n);
    voices.set(k, list);
  }
  for (const list of voices.values()) {
    list.sort((a, b) => compare(a.offset, b.offset));
    for (let j = 1; j < list.length; j++)
      if (
        compare(
          add(list[j - 1].offset, beats(list[j - 1].duration)),
          list[j].offset,
        ) > 0
      )
        fail("overlapping events in one voice.");
  }
  const notes = new Map(score.notes.map((n) => [n.id, n]));
  const starts = measureStarts(score);
  for (const n of score.notes)
    for (const kind of ["tieTo", "slurTo"] as const) {
      const target = n[kind];
      if (!target) continue;
      const other = notes.get(target);
      if (
        !other ||
        other.staffId !== n.staffId ||
        other.voice !== n.voice ||
        !n.pitches.length ||
        !other.pitches.length
      )
        fail("invalid tie/slur reference.");
      const end = add(absolute(starts, n), beats(n.duration)),
        destination = absolute(starts, other!);
      if (compare(destination, end) < 0)
        fail("a tie or slur must point forward to a later note.");
      if (
        kind === "tieTo" &&
        (compare(destination, end) !== 0 ||
          !n.pitches.some((p) =>
            other!.pitches.some((q) => midiPitch(p) === midiPitch(q)),
          ))
      )
        fail("a tie needs an adjacent matching pitch.");
    }
  for (const m of score.marks) {
    if (
      ![
        "dynamic",
        "hairpin",
        "tempo",
        "tempoRamp",
        "pedal",
        "text",
        "program",
        "ottava",
      ].includes(m.kind) ||
      !measures.has(m.measureId) ||
      (m.staffId && !staffs.has(m.staffId)) ||
      !string(m.text, 1000) ||
      !Number.isFinite(m.amount) ||
      Math.abs(m.amount) > 1000
    )
      fail("expression.");
    rational(m.offset);
    if (compare(m.offset, measureBeats(measures.get(m.measureId)!)) > 0)
      fail("expression offset.");
    if (m.endMeasureId && !measures.has(m.endMeasureId))
      fail("expression endpoint.");
    if (m.endOffset) rational(m.endOffset);
    if (
      m.target !== undefined &&
      (!Number.isFinite(m.target) || Math.abs(m.target) > 1000)
    )
      fail("expression target.");
    if (["hairpin", "tempoRamp", "pedal", "ottava"].includes(m.kind)) {
      if (
        !m.endMeasureId ||
        !m.endOffset ||
        compare(m.endOffset, measureBeats(measures.get(m.endMeasureId)!)) > 0 ||
        compare(
          absolute(starts, { measureId: m.endMeasureId, offset: m.endOffset }),
          absolute(starts, m),
        ) <= 0
      )
        fail("a span needs an endpoint after its start, inside the score.");
    }
    if (
      ["dynamic", "hairpin"].includes(m.kind) &&
      (!integer(m.amount, 1, 127) ||
        (m.kind === "hairpin" && !integer(m.target, 1, 127)))
    )
      fail("dynamic range must be 1–127.");
    if (
      ["tempo", "tempoRamp"].includes(m.kind) &&
      (!integer(m.amount, 20, 400) ||
        (m.kind === "tempoRamp" && !integer(m.target, 20, 400)))
    )
      fail("tempo must be 20–400 BPM.");
    if (m.kind === "program" && !integer(m.amount, 0, 127))
      fail("GM program must be 0–127.");
    if (m.kind === "ottava" && ![-24, -12, 0, 12, 24].includes(m.amount))
      fail("octave shift must be −24, −12, 0, 12 or 24 semitones.");
  }
}
