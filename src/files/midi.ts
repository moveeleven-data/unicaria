import {
  compilePerformance,
  ScoreIndex,
  type Performance,
} from "../performance/compiler";
import { beats, keySignatures, measureBeats, type Score } from "../core/model";
import { gcd } from "../core/rational";

const variable = (n: number) => {
  let bytes = [n & 127];
  while ((n >>= 7)) bytes.unshift((n & 127) | 128);
  return bytes;
};
const word = (n: number) => [(n >> 8) & 255, n & 255];
const long = (n: number) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const text = (s: string) => [...new TextEncoder().encode(s)];
interface Event {
  tick: number;
  order: number;
  data: number[];
}
const meta = (type: number, data: number[]) => [
  255,
  type,
  ...variable(data.length),
  ...data,
];
const clamp = (n: number) => Math.max(0, Math.min(127, Math.round(n)));
function track(events: Event[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let last = 0;
  const bytes: number[] = [];
  for (const e of events) {
    bytes.push(...variable(e.tick - last), ...e.data);
    last = e.tick;
  }
  bytes.push(0, 255, 47, 0);
  return [...text("MTrk"), ...long(bytes.length), ...bytes];
}
export interface MidiExport {
  bytes: Uint8Array;
  warnings: string[];
  ppq: number;
  ports: number;
}
export function exportMidi(score: Score): MidiExport {
  const performance = compilePerformance(new ScoreIndex(score)),
    warnings: string[] = [];
  let ppq = 960;
  const denominators = [
    ...score.notes.flatMap((n) => [beats(n.duration).d, n.offset.d]),
    ...score.measures.map((m) => measureBeats(m).d),
    ...score.marks.flatMap((m) => [m.offset.d, m.endOffset?.d ?? 1]),
  ];
  for (const denominator of denominators) {
    const next = (ppq / gcd(ppq, denominator)) * denominator;
    if (next <= 32767) ppq = next;
    else if (
      !warnings.includes(
        "Some tuplet positions were rounded to the nearest MIDI tick.",
      )
    )
      warnings.push(
        "Some tuplet positions were rounded to the nearest MIDI tick.",
      );
  }
  const ticks = (beat: number) => Math.round(beat * ppq);
  const conductor: Event[] = [
    { tick: 0, order: 0, data: meta(3, text(score.title)) },
  ];
  let previousTempo = -1;
  for (const p of performance.tempos) {
    const tempo = Math.round(60000000 / p.bpm);
    if (tempo === previousTempo) continue;
    previousTempo = tempo;
    conductor.push({
      tick: ticks(p.beat),
      order: 0,
      data: meta(81, [(tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255]),
    });
  }
  for (const o of performance.occurrences) {
    const m = score.measures[o.measureIndex];
    conductor.push({
      tick: ticks(o.start),
      order: 1,
      data: meta(88, [m.beats, Math.log2(m.beatType), 24, 8]),
    });
    conductor.push({
      tick: ticks(o.start),
      order: 1,
      data: meta(89, [(keySignatures.indexOf(m.key) - 7) & 255, 0]),
    });
  }
  // Allocate an independent channel lane for each overlapping note of the same pitch,
  // and each staff/program/controller stream. Tracks alone do not isolate MIDI state.
  const lanes: {
    staffId: string;
    program: number;
    percussion: boolean;
    ends: Map<number, number>;
    events: Event[];
    port: number;
    channel: number;
  }[] = [];
  let melodic = 0,
    drums = 0;
  for (const voice of [...performance.voices].sort(
    (a, b) => a.start - b.start,
  )) {
    let lane = lanes.find(
      (l) =>
        l.staffId === voice.staffId &&
        l.program === voice.program &&
        l.percussion === voice.percussion &&
        (l.ends.get(voice.midi) ?? -1) <= voice.start + 1e-9,
    );
    if (!lane) {
      const slot = voice.percussion ? drums++ : melodic++;
      const port = voice.percussion ? slot : Math.floor(slot / 15);
      let channel = voice.percussion ? 9 : slot % 15;
      if (!voice.percussion && channel >= 9) channel++;
      const staff = score.staves.find((s) => s.id === voice.staffId)!;
      lane = {
        staffId: voice.staffId,
        program: voice.program,
        percussion: voice.percussion,
        ends: new Map(),
        port,
        channel,
        events: [
          { tick: 0, order: 0, data: meta(3, text(staff.name)) },
          { tick: 0, order: 0, data: meta(33, [port]) },
          { tick: 0, order: 1, data: [0xb0 | channel, 0, 0] },
          { tick: 0, order: 1, data: [0xb0 | channel, 32, 0] },
          {
            tick: 0,
            order: 2,
            data: [0xc0 | channel, voice.percussion ? 0 : voice.program],
          },
          { tick: 0, order: 3, data: [0xb0 | channel, 7, voice.volume] },
          { tick: 0, order: 3, data: [0xb0 | channel, 10, voice.pan] },
        ],
      };
      lanes.push(lane);
    }
    lane.ends.set(voice.midi, voice.end);
    lane.events.push(
      {
        tick: ticks(voice.start),
        order: 5,
        data: [0x90 | lane.channel, voice.midi, clamp(voice.velocity)],
      },
      {
        tick: Math.max(ticks(voice.start) + 1, ticks(voice.end)),
        order: 0,
        data: [0x80 | lane.channel, voice.midi, 0],
      },
    );
  }
  for (const lane of lanes) {
    for (const a of performance.actions)
      if (a.kind === "expression" && a.staffId === lane.staffId) {
        const beat = beatAt(performance, a.at);
        lane.events.push({
          tick: ticks(beat),
          order: 4,
          data: [0xb0 | lane.channel, 11, clamp(a.expression!)],
        });
      }
    lane.events.push({
      tick: ticks(performance.totalBeats) + 1,
      order: 10,
      data: [0xb0 | lane.channel, 64, 0],
    });
  }
  const ports = Math.max(1, ...lanes.map((l) => l.port + 1));
  if (ports > 1)
    warnings.push(
      `This score uses ${ports} MIDI ports. Use a player that respects MIDI port metadata.`,
    );
  const chunks = [track(conductor), ...lanes.map((l) => track(l.events))];
  const output = [
    ...text("MThd"),
    0,
    0,
    0,
    6,
    0,
    1,
    ...word(chunks.length),
    ...word(ppq),
  ];
  for (const chunk of chunks) for (const byte of chunk) output.push(byte);
  return { bytes: new Uint8Array(output), warnings, ppq, ports };
}
function beatAt(p: Performance, seconds: number) {
  let low = 0,
    high = p.tempos.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (p.tempos[mid].seconds <= seconds + 1e-9) low = mid;
    else high = mid - 1;
  }
  const t = p.tempos[low];
  return t.beat + ((seconds - t.seconds) * t.bpm) / 60;
}
