import {
  beats,
  keyAlter,
  transposeKey,
  midiPitch,
  pitchFromMidi,
  steps,
  type Cursor,
  type Duration,
  type NoteEvent,
  type Pitch,
  type Score,
  type Staff,
} from "../core/model";
import { rat, value } from "../core/rational";
import { xAtTime, type Hit, type Layout } from "../engraving/geometry";

export function pitchY(pitch: Pitch, clef: Staff["clef"], bottom: number) {
  const reference = {
    treble: 30,
    bass: 18,
    alto: 24,
    tenor: 22,
    percussion: 30,
  }[clef];
  return (
    bottom - (pitch.octave * 7 + steps.indexOf(pitch.step) - reference) * 5
  );
}

export interface EntryPlacement {
  at: Cursor;
  pitch: Pitch;
  displayPitch: Pitch;
  x: number;
  y: number;
  bottom: number;
  existing?: NoteEvent;
  pitchIndex: number;
  onNotehead?: boolean;
}

/** One resolution path for hover, palette drop and click. All distances are score units. */
export function entryPlacement(
  score: Score,
  layout: Layout,
  hit: Hit,
  duration: Duration,
  voice: number,
  accidental?: number,
  concert = false,
): EntryPlacement {
  const staff = hit.measure.staves.find((s) => s.id === hit.staffId)!;
  const instrument = score.instruments.find(
    (i) =>
      i.id === score.staves.find((s) => s.id === hit.staffId)!.instrumentId,
  )!;
  const transpose = concert ? instrument.transpose : 0;
  const key = transposeKey(
    score.measures[hit.measure.measureIndex].key,
    transpose,
  );
  const x = xAtTime(hit.measure, value(hit.offset));
  const y = pitchY(hit.pitch, staff.clef, staff.lineBottom);
  const nearby = layout.notes
    .filter(
      (n) =>
        n.measureId === hit.measure.measureId &&
        n.staffId === hit.staffId &&
        Math.abs(n.x + 5 - x) < 18,
    )
    .map((box) => ({ box, note: score.notes.find((n) => n.id === box.id)! }))
    .filter((n) => n.note?.voice === voice)
    .sort((a, b) => Math.abs(a.box.x + 5 - x) - Math.abs(b.box.x + 5 - x))[0];
  const existing = nearby?.note;
  const displayed = (p: Pitch) =>
    transpose ? pitchFromMidi(midiPitch(p) + transpose) : p;
  const pitchIndex =
    existing?.pitches.reduce(
      (best, p, i, pitches) =>
        Math.abs(pitchY(displayed(p), staff.clef, staff.lineBottom) - y) <
        Math.abs(
          pitchY(displayed(pitches[best]), staff.clef, staff.lineBottom) - y,
        )
          ? i
          : best,
      0,
    ) ?? 0;
  // Clamp the grid INDEX, not a floating offset: dotted/tuplet values can straddle a bar.
  const span = beats(duration),
    unit = value(span);
  const tick = Math.max(
    0,
    Math.min(
      Math.ceil(hit.measure.length / unit - 1e-8) - 1,
      Math.round(value(hit.offset) / unit),
    ),
  );
  const offset = existing?.offset ?? rat(tick * span.n, span.d);
  const earlier = score.notes
    .filter(
      (n) =>
        n.staffId === hit.staffId &&
        n.measureId === hit.measure.measureId &&
        value(n.offset) <= value(offset),
    )
    .sort((a, b) => value(b.offset) - value(a.offset))
    .flatMap((n) => n.pitches.map(displayed))
    .find((p) => p.step === hit.pitch.step && p.octave === hit.pitch.octave);
  const displayPitch = {
    ...hit.pitch,
    alter: accidental ?? earlier?.alter ?? keyAlter(hit.pitch.step, key),
  };
  const pitch = transpose
    ? pitchFromMidi(midiPitch(displayPitch) - transpose)
    : displayPitch;
  return {
    at: {
      staffId: hit.staffId,
      measureId: hit.measure.measureId,
      offset,
      voice,
    },
    pitch,
    displayPitch,
    x: nearby?.box.x ?? xAtTime(hit.measure, value(offset)),
    y,
    bottom: staff.lineBottom,
    existing,
    pitchIndex,
    onNotehead: existing
      ? Math.abs(
          (existing.pitches.length
            ? pitchY(
                displayed(existing.pitches[pitchIndex]),
                staff.clef,
                staff.lineBottom,
              )
            : nearby!.box.y) - y,
        ) <= 7
      : false,
  };
}

export function removePitch(score: Score, noteId: string, pitchIndex: number) {
  const note = score.notes.find((n) => n.id === noteId);
  if (!note) return;
  if (note.pitches.length > 1) note.pitches.splice(pitchIndex, 1);
  else score.notes = score.notes.filter((n) => n.id !== noteId);
}
