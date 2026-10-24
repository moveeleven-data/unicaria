import {
  blankScore,
  duration,
  id,
  pitchFromMidi,
  type NoteEvent,
  type Score,
} from "./model";
import { rat } from "./rational";
export function demoScore(): Score {
  const score = blankScore();
  score.title = "A study in light";
  score.composer = "Unicaria · example score";
  score.tempo = 92;
  const flute = {
    id: id(),
    name: "Flute",
    program: 73,
    transpose: 0,
    percussion: false,
    volume: 76,
    pan: 72,
    mute: false,
    solo: false,
  };
  score.instruments.push(flute);
  score.staves.unshift({
    id: id(),
    instrumentId: flute.id,
    name: "Flute",
    clef: "treble",
  });
  const add = (
    staff: number,
    bar: number,
    offset: number,
    base: number,
    pitches: number[],
    voice = 0,
    tuplet = false,
  ): NoteEvent => {
    const n: NoteEvent = {
      id: id(),
      staffId: score.staves[staff].id,
      measureId: score.measures[bar].id,
      voice,
      offset: rat(Math.round(offset * 3), 3),
      duration: duration(base, 0, tuplet ? [{ actual: 3, normal: 2 }] : []),
      pitches: pitches.map(pitchFromMidi),
      articulation: "",
    };
    score.notes.push(n);
    return n;
  };
  const chords = [
    [60, 64, 67],
    [57, 60, 64],
    [53, 57, 60],
    [55, 59, 62],
    [60, 64, 67],
    [62, 65, 69],
    [55, 59, 62],
    [60, 64, 67],
  ];
  const bass = [48, 45, 41, 43, 48, 50, 43, 48];
  const melody = [
    [76, 74, 72, 71],
    [72, 76, 79, 76],
    [77, 76, 74, 72],
    [74, 71, 67, 71],
    [76, 79, 81, 79],
    [77, 76, 74, 72],
    [71, 74, 77, 74],
    [72, 72, 72, 72],
  ];
  for (let bar = 0; bar < 8; bar++) {
    add(2, bar, 0, 1, [bass[bar]]);
    add(1, bar, 0, 2, chords[bar]);
    add(1, bar, 2, 2, chords[bar]);
    if (bar === 4) {
      for (let j = 0; j < 6; j++)
        add(0, bar, j / 3, 8, [[76, 77, 79, 81, 79, 77][j]], 0, true);
      add(0, bar, 2, 2, [76]);
    } else if (bar === 7) add(0, bar, 0, 1, [72]);
    else for (let j = 0; j < 4; j++) add(0, bar, j, 4, [melody[bar][j]]);
  }
  score.marks.push({
    id: id(),
    kind: "dynamic",
    staffId: score.staves[0].id,
    measureId: score.measures[0].id,
    offset: rat(0),
    text: "mp",
    amount: 64,
  });
  score.marks.push({
    id: id(),
    kind: "dynamic",
    staffId: score.staves[1].id,
    measureId: score.measures[0].id,
    offset: rat(0),
    text: "p",
    amount: 52,
  });
  score.marks.push({
    id: id(),
    kind: "hairpin",
    staffId: score.staves[0].id,
    measureId: score.measures[2].id,
    offset: rat(0),
    endMeasureId: score.measures[3].id,
    endOffset: rat(3),
    text: "cresc.",
    amount: 64,
    target: 96,
  });
  score.marks.push({
    id: id(),
    kind: "tempoRamp",
    measureId: score.measures[6].id,
    offset: rat(0),
    endMeasureId: score.measures[7].id,
    endOffset: rat(0),
    text: "rit.",
    amount: 92,
    target: 64,
  });
  score.notes.find(
    (n) =>
      n.staffId === score.staves[0].id && n.measureId === score.measures[7].id,
  )!.articulation = "fermata";
  return score;
}
