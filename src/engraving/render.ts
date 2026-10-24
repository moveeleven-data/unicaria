import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Fraction,
  Dot,
  Accidental,
  Beam,
  Tuplet,
  StaveTie,
  Curve,
  Articulation,
  Modifier,
  GraceNote,
  GraceNoteGroup,
  Barline,
  StaveConnector,
  Ornament,
  Tremolo,
} from "vexflow/bravura";
import {
  beats,
  duration,
  measureBeats,
  measureStarts,
  pitchFromMidi,
  midiPitch,
  keySignatures,
  type Score,
  type NoteEvent,
  type Pitch,
  type Duration,
  type Step,
} from "../core/model";
import { value, compare, ZERO, type Rational } from "../core/rational";
import { xAtTime, type Layout, type MeasureBox } from "./geometry";
import { fillGaps } from "./rhythm";

const svgNS = "http://www.w3.org/2000/svg";
function label(
  svg: SVGElement,
  text: string,
  x: number,
  y: number,
  size = 13,
  style = "",
) {
  const el = document.createElementNS(svgNS, "text");
  el.textContent = text;
  el.setAttribute("x", `${x}`);
  el.setAttribute("y", `${y}`);
  el.setAttribute("font-size", `${size}`);
  el.setAttribute("fill", "#263833");
  el.setAttribute("font-family", "Georgia, serif");
  if (style) el.setAttribute("font-style", style);
  svg.appendChild(el);
  return el;
}
function path(svg: SVGElement, d: string) {
  const p = document.createElementNS(svgNS, "path");
  p.setAttribute("d", d);
  p.setAttribute("stroke", "#263833");
  p.setAttribute("fill", "none");
  p.setAttribute("stroke-width", "1.2");
  svg.appendChild(p);
}
const pitchKey = (p: Pitch) =>
  `${p.step.toLowerCase()}${p.alter === 1 ? "#" : p.alter === -1 ? "b" : p.alter === 2 ? "##" : p.alter === -2 ? "bb" : ""}/${p.octave}`;
interface Glyph {
  event?: NoteEvent;
  note: StaveNote;
  offset: Rational;
  span: Rational;
  tuplets: Duration["tuplets"];
}
function concertKey(key: string, transpose: number) {
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

export function renderScore(
  host: HTMLDivElement,
  score: Score,
  selected: string | undefined,
  concert = false,
): Layout {
  host.replaceChildren();
  const width = 1120,
    padding = 84,
    staffGap = 132,
    systemHeight = score.staves.length * staffGap + 72;
  const systems = Math.ceil(score.measures.length / 2),
    height = 130 + systems * systemHeight;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  const svg = host.querySelector("svg")!;
  svg.setAttribute(
    "aria-label",
    `${score.title}, ${score.measures.length} measures`,
  );
  svg.setAttribute("role", "img");
  const title = label(svg, score.title || "Untitled", width / 2, 48, 29);
  title.setAttribute("text-anchor", "middle");
  const composer = label(svg, score.composer, width - padding, 77, 13);
  composer.setAttribute("text-anchor", "end");
  label(svg, `♩ = ${score.tempo}`, padding, 100, 15);
  const starts = measureStarts(score),
    layout: Layout = { width, height, measures: [], notes: [] };
  const rendered = new Map<string, { note: StaveNote; system: number }>();
  for (let system = 0; system < systems; system++) {
    const systemY = 130 + system * systemHeight;
    const count = Math.min(2, score.measures.length - system * 2),
      barWidth = (width - padding * 2) / count;
    for (let col = 0; col < count; col++) {
      const mi = system * 2 + col,
        m = score.measures[mi],
        x = padding + col * barWidth;
      const box: MeasureBox = {
        measureId: m.id,
        measureIndex: mi,
        start: value(starts.get(m.id)!),
        length: value(measureBeats(m)),
        x,
        endX: x + barWidth,
        top: systemY - 22,
        bottom: systemY + (score.staves.length - 1) * staffGap + 112,
        anchors: [],
        staves: [],
      };
      const staves: Stave[] = [],
        voices: Voice[] = [],
        groups: Glyph[][] = [],
        tupletDraws: Tuplet[] = [];
      for (const [si, staff] of score.staves.entries()) {
        const instrument = score.instruments.find(
          (i) => i.id === staff.instrumentId,
        )!;
        const key = concert ? concertKey(m.key, instrument.transpose) : m.key;
        const stave = new Stave(x, systemY + si * staffGap, barWidth);
        if (col === 0) stave.addClef(staff.clef).addKeySignature(key);
        else if (m.key !== score.measures[mi - 1].key)
          stave.addKeySignature(key);
        if (
          mi === 0 ||
          m.beats !== score.measures[mi - 1].beats ||
          m.beatType !== score.measures[mi - 1].beatType
        )
          stave.addTimeSignature(`${m.beats}/${m.beatType}`);
        if (m.repeatStart) stave.setBegBarType(Barline.type.REPEAT_BEGIN);
        if (m.repeatEnd) stave.setEndBarType(Barline.type.REPEAT_END);
        else if (mi === score.measures.length - 1)
          stave.setEndBarType(Barline.type.END);
        stave.setContext(ctx);
        staves.push(stave);
        box.staves.push({
          id: staff.id,
          top: systemY + si * staffGap - 12,
          bottom: systemY + si * staffGap + 110,
          lineBottom: stave.getYForLine(4),
          clef: staff.clef,
        });
        if (col === 0) {
          const name = label(
            svg,
            staff.name,
            x - 12,
            stave.getYForLine(2) + 4,
            12,
          );
          name.setAttribute("text-anchor", "end");
        }
        const events = score.notes.filter(
          (n) => n.measureId === m.id && n.staffId === staff.id,
        );
        const usedVoices = [
          ...new Set([0, ...events.map((n) => n.voice)]),
        ].sort();
        const staffVoices: Voice[] = [];
        for (const voiceNumber of usedVoices) {
          const entries = fillGaps(
            events
              .filter((n) => n.voice === voiceNumber)
              .sort((a, b) => compare(a.offset, b.offset)),
            measureBeats(m),
          );
          const glyphs: Glyph[] = [];
          for (const entry of entries) {
            const event = entry.event;
            const pitches = event?.pitches ?? [];
            const rest = pitches.length === 0;
            const restPitch =
              staff.clef === "bass"
                ? "d/3"
                : staff.clef === "alto"
                  ? "g/3"
                  : staff.clef === "tenor"
                    ? "e/3"
                    : "b/4";
            const keys = rest
              ? [restPitch]
              : pitches.map((p) =>
                  pitchKey(
                    concert
                      ? pitchFromMidi(midiPitch(p) + instrument.transpose)
                      : p,
                  ),
                );
            const note = new StaveNote({
              keys,
              duration: `${entry.base}${rest ? "r" : ""}`,
              clef: staff.clef,
              autoStem: usedVoices.length === 1,
              stemDirection: voiceNumber % 2 === 0 ? 1 : -1,
            });
            for (let j = 0; j < entry.dots; j++)
              Dot.buildAndAttach([note], { all: true });
            // Keep the written duration as VexFlow's intrinsic duration. Beaming
            // inspects that value; replacing it with tuplet time adds false beams.
            const nominal = beats(duration(entry.base, entry.dots));
            note.setDuration(new Fraction(nominal.n, nominal.d * 4));
            note.applyTickMultiplier(
              entry.span.n * nominal.d,
              entry.span.d * nominal.n,
            );
            note.setStave(stave);
            if (event) {
              note.setAttribute("id", `note-${event.id}`);
              if (event.id === selected)
                note.setStyle({ fillStyle: "#c27831", strokeStyle: "#c27831" });
              const articulations: Record<string, string> = {
                staccato: "a.",
                tenuto: "a-",
                accent: "a>",
                marcato: "a^",
                fermata: "a@a",
              };
              if (articulations[event.articulation])
                note.addModifier(
                  new Articulation(
                    articulations[event.articulation],
                  ).setPosition(Modifier.Position.ABOVE),
                  0,
                );
              if (event.articulation === "trill")
                note.addModifier(new Ornament("tr"), 0);
              if (event.articulation === "tremolo" && !rest)
                note.addModifier(new Tremolo(3), 0);
              if (event.grace?.length) {
                const grace = event.grace.map(
                  (p) =>
                    new GraceNote({
                      keys: [
                        pitchKey(
                          concert
                            ? pitchFromMidi(midiPitch(p) + instrument.transpose)
                            : p,
                        ),
                      ],
                      duration: "8",
                      slash: true,
                    }),
                );
                note.addModifier(new GraceNoteGroup(grace).beamNotes(), 0);
              }
              rendered.set(event.id, { note, system });
            } else if (voiceNumber > 0)
              note.setStyle({ fillStyle: "#aab3ae", strokeStyle: "#aab3ae" });
            glyphs.push({
              event,
              note,
              offset: entry.offset,
              span: entry.span,
              tuplets: entry.tuplets,
            });
          }
          const voice = new Voice({ numBeats: m.beats, beatValue: m.beatType })
            .setMode(Voice.Mode.SOFT)
            .setStave(stave)
            .addTickables(glyphs.map((g) => g.note));
          staffVoices.push(voice);
          voices.push(voice);
          groups.push(glyphs);
          for (let j = 0; j < glyphs.length; j++) {
            const ratios = glyphs[j].tuplets;
            if (!ratios.length) continue;
            const ratio = ratios[0],
              group: Glyph[] = [];
            for (const g of glyphs.slice(j, j + ratio.actual)) {
              if (JSON.stringify(g.tuplets) !== JSON.stringify(ratios)) break;
              group.push(g);
            }
            if (group.length) {
              const tuplet = new Tuplet(
                group.map((g) => g.note),
                {
                  numNotes: ratio.actual,
                  notesOccupied: ratio.normal,
                  bracketed: true,
                  ratioed: ratio.actual !== 3,
                },
              );
              tuplet.detach();
              tupletDraws.push(tuplet);
              j += group.length - 1;
            }
          }
        }
        Accidental.applyAccidentals(staffVoices, key);
      }
      const startX = Math.max(...staves.map((s) => s.getNoteStartX())) + 5;
      staves.forEach((s) => s.setNoteStartX(startX));
      const formatter = new Formatter();
      for (const stave of staves)
        formatter.joinVoices(voices.filter((v) => v.getStave() === stave));
      formatter.format(voices, x + barWidth - startX - 24, { context: ctx });
      staves.forEach((s) => s.draw());
      if (col === 0 && staves.length > 1)
        new StaveConnector(staves[0], staves.at(-1)!)
          .setType(StaveConnector.type.SINGLE_LEFT)
          .setContext(ctx)
          .draw();
      const beams: Beam[] = [];
      for (const group of groups) {
        const beamGroups: StaveNote[][] = [];
        let current: StaveNote[] = [];
        for (const g of group) {
          if (
            g.note.getDuration() === "8" ||
            g.note.getDuration() === "16" ||
            g.note.getDuration() === "32"
          ) {
            current.push(g.note);
          } else {
            if (current.length > 1) beamGroups.push(current);
            current = [];
          }
        }
        if (current.length > 1) beamGroups.push(current);
        for (const notes of beamGroups)
          try {
            beams.push(
              ...Beam.generateBeams(notes, {
                groups: [
                  new Fraction(
                    m.beatType === 8 && m.beats % 3 === 0 ? 3 : 1,
                    m.beatType === 8 && m.beats % 3 === 0 ? 8 : 4,
                  ),
                ],
              }),
            );
          } catch {
            /* Isolated complex groups keep their flags. */
          }
        for (const g of group) {
          const gx = g.note.getAbsoluteX();
          box.anchors.push({ x: gx, time: value(g.offset) });
          if (g.event)
            layout.notes.push({
              id: g.event.id,
              x: gx,
              y: g.note.getYs()[0],
              staffId: g.event.staffId,
              measureId: m.id,
              offset: g.offset,
            });
        }
      }
      voices.forEach((v) => v.draw(ctx, v.getStave()));
      beams.forEach((b) => b.setContext(ctx).draw());
      tupletDraws.forEach((t) => t.setContext(ctx).draw());
      const byTime = new Map<number, number>();
      for (const a of box.anchors)
        if (!byTime.has(a.time)) byTime.set(a.time, a.x);
      box.anchors = [...byTime]
        .map(([time, x]) => ({ time, x }))
        .sort((a, b) => a.time - b.time);
      box.anchors.push({ x: x + barWidth - 12, time: box.length });
      if (!box.anchors.length || box.anchors[0].time !== 0)
        box.anchors.unshift({ x: startX, time: 0 });
      label(svg, `${mi + 1}`, x + 3, systemY + 6, 11).setAttribute(
        "fill",
        "#7c8980",
      );
      if (m.ending) {
        path(svg, `M ${x + 4} ${systemY - 5} v -13 h ${barWidth - 12}`);
        label(svg, `${m.ending}.`, x + 10, systemY - 7, 12);
      }
      layout.measures.push(box);
    }
  }
  for (const event of score.notes) {
    const from = rendered.get(event.id);
    if (!from) continue;
    if (event.tieTo) {
      const to = rendered.get(event.tieTo),
        target = score.notes.find((n) => n.id === event.tieTo);
      if (to && target) {
        const pairs = event.pitches
          .map((p, i) => [
            i,
            target.pitches.findIndex((q) => midiPitch(q) === midiPitch(p)),
          ])
          .filter((p) => p[1] >= 0);
        if (pairs.length) {
          if (from.system === to.system)
            new StaveTie({
              firstNote: from.note,
              lastNote: to.note,
              firstIndexes: pairs.map((p) => p[0]),
              lastIndexes: pairs.map((p) => p[1]),
            })
              .setContext(ctx)
              .draw();
          else {
            new StaveTie({
              firstNote: from.note,
              firstIndexes: pairs.map((p) => p[0]),
            })
              .setContext(ctx)
              .draw();
            new StaveTie({
              lastNote: to.note,
              lastIndexes: pairs.map((p) => p[1]),
            })
              .setContext(ctx)
              .draw();
          }
        }
      }
    }
    if (event.slurTo) {
      const to = rendered.get(event.slurTo);
      if (to) {
        if (from.system === to.system)
          new Curve(from.note, to.note, {}).setContext(ctx).draw();
        else {
          new Curve(from.note, undefined, {}).setContext(ctx).draw();
          new Curve(undefined, to.note, {}).setContext(ctx).draw();
        }
      }
    }
  }
  for (const mark of score.marks) {
    const box = layout.measures.find((b) => b.measureId === mark.measureId);
    if (!box) continue;
    const staff =
      box.staves.find((s) => s.id === mark.staffId) ?? box.staves[0];
    const x = xAtTime(box, value(mark.offset));
    const below = ["dynamic", "hairpin", "pedal"].includes(mark.kind),
      y = below ? staff.lineBottom + 35 : staff.top + 9;
    if (
      mark.kind === "hairpin" ||
      mark.kind === "pedal" ||
      mark.kind === "tempoRamp" ||
      mark.kind === "ottava"
    ) {
      const end = layout.measures.find(
        (b) => b.measureId === mark.endMeasureId,
      );
      const endAbs = end
        ? end.start + value(mark.endOffset ?? ZERO)
        : box.start + box.length;
      for (const segment of layout.measures) {
        if (
          segment.start + segment.length <= box.start + value(mark.offset) ||
          segment.start >= endAbs
        )
          continue;
        const row =
          segment.staves.find((s) => s.id === mark.staffId) ??
          segment.staves[0];
        const sy = below ? row.lineBottom + 35 : row.top + 9;
        const x1 = xAtTime(
            segment,
            Math.max(0, box.start + value(mark.offset) - segment.start),
          ),
          x2 = xAtTime(
            segment,
            Math.min(segment.length, endAbs - segment.start),
          );
        if (mark.kind === "hairpin") {
          const startAbs = box.start + value(mark.offset),
            width = Math.max(0.01, endAbs - startAbs),
            r1 =
              (segment.start +
                Math.max(0, startAbs - segment.start) -
                startAbs) /
              width,
            r2 =
              (segment.start +
                Math.min(segment.length, endAbs - segment.start) -
                startAbs) /
              width;
          const crescendo = (mark.target ?? mark.amount) > mark.amount;
          const h1 = 5 * (crescendo ? r1 : 1 - r1),
            h2 = 5 * (crescendo ? r2 : 1 - r2);
          path(
            svg,
            `M ${x1} ${sy - h1} L ${x2} ${sy - h2} M ${x1} ${sy + h1} L ${x2} ${sy + h2}`,
          );
        } else {
          if (segment === box)
            label(svg, mark.text || mark.kind, x1, sy, 13, "italic");
          path(svg, `M ${x1 + 32} ${sy + 3} H ${x2} v -5`);
        }
      }
    } else
      label(
        svg,
        mark.kind === "tempo"
          ? `♩ = ${mark.amount}`
          : mark.text || `${mark.amount}`,
        x,
        y,
        mark.kind === "dynamic" ? 18 : 13,
        mark.kind === "dynamic" ? "italic" : "",
      );
  }
  return layout;
}
