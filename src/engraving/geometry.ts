import { value, fromDecimal, type Rational } from "../core/rational";
import { steps, type Pitch, type Staff } from "../core/model";
export interface Anchor {
  x: number;
  time: number;
}
export interface MeasureBox {
  measureId: string;
  measureIndex: number;
  start: number;
  length: number;
  x: number;
  endX: number;
  top: number;
  bottom: number;
  anchors: Anchor[];
  staves: {
    id: string;
    top: number;
    bottom: number;
    lineBottom: number;
    clef: Staff["clef"];
  }[];
}
export interface NoteBox {
  id: string;
  x: number;
  y: number;
  staffId: string;
  measureId: string;
  offset: Rational;
}
export interface Layout {
  width: number;
  height: number;
  measures: MeasureBox[];
  notes: NoteBox[];
}
export interface Hit {
  measure: MeasureBox;
  staffId: string;
  time: number;
  offset: Rational;
  pitch: Pitch;
}
export function timeAtX(box: MeasureBox, x: number): number {
  const anchors = box.anchors;
  if (x <= anchors[0].x) return 0;
  if (x >= anchors.at(-1)!.x) return box.length;
  for (let i = 1; i < anchors.length; i++)
    if (x < anchors[i].x) {
      const a = anchors[i - 1],
        b = anchors[i];
      return a.time + ((b.time - a.time) * (x - a.x)) / (b.x - a.x);
    }
  return box.length;
}
export function xAtTime(box: MeasureBox, t: number): number {
  const a = box.anchors;
  if (t <= 0) return a[0].x;
  for (let i = 1; i < a.length; i++)
    if (t <= a[i].time) {
      const left = a[i - 1],
        right = a[i];
      return (
        left.x +
        ((right.x - left.x) * (t - left.time)) / (right.time - left.time || 1)
      );
    }
  return a.at(-1)!.x;
}
export function hitTest(layout: Layout, x: number, y: number): Hit | undefined {
  const measure = layout.measures.find(
    (b) => x >= b.x && x < b.endX && y >= b.top && y <= b.bottom,
  );
  if (!measure) return;
  const staff = measure.staves.reduce((best, s) =>
    Math.abs(y - (s.top + s.bottom) / 2) <
    Math.abs(y - (best.top + best.bottom) / 2)
      ? s
      : best,
  );
  const bottom: Record<Staff["clef"], number> = {
    treble: 4 * 7 + 2,
    bass: 2 * 7 + 4,
    alto: 3 * 7 + 3,
    tenor: 3 * 7 + 1,
    percussion: 4 * 7 + 2,
  };
  const diatonic = bottom[staff.clef] + Math.round((staff.lineBottom - y) / 5);
  const pitch: Pitch = {
    step: steps[((diatonic % 7) + 7) % 7],
    octave: Math.floor(diatonic / 7),
    alter: 0,
  };
  const time = Math.min(
    measure.length - 1e-7,
    Math.max(0, timeAtX(measure, x)),
  );
  return {
    measure,
    staffId: staff.id,
    time: measure.start + time,
    offset: fromDecimal(time),
    pitch,
  };
}
export function cursorX(layout: Layout, measureId: string, offset: Rational) {
  const m = layout.measures.find((b) => b.measureId === measureId);
  return m ? xAtTime(m, value(offset)) : 0;
}
