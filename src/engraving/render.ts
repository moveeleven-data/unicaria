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
import {
  planPages,
  defaultRenderOptions,
  type RenderOptions,
} from "./pagination";

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
  el.setAttribute("fill", "#242424");
  el.setAttribute("font-weight", "normal");
  // VexFlow's SVG root carries a stroke. Text must not inherit it.
  el.setAttribute("stroke", "none");
  el.setAttribute("font-family", "Times New Roman, serif");
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
  return p;
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
  selected: string | undefined = undefined,
  concert = false,
  options: RenderOptions = defaultRenderOptions,
): Layout {
  host.replaceChildren();
  const plan = planPages(score, options);
  const { width, height, staffGap } = plan;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  const svg = host.querySelector("svg")!;
  svg.setAttribute(
    "aria-label",
    `${score.title}, ${score.measures.length} measures`,
  );
  svg.setAttribute("role", "img");
  for (const page of plan.pages) {
    const paper = document.createElementNS(svgNS, "rect");
    for (const [key, v] of Object.entries({
      x: page.x,
      y: page.y,
      width: page.width,
      height: page.height,
      fill: "#fffefb",
      stroke: "#555555",
      "stroke-width": 1,
    }))
      paper.setAttribute(key, String(v));
    svg.appendChild(paper);
    if (page.number > 1) {
      label(svg, String(page.number), page.x + 62, page.y + 48, 12);
      label(
        svg,
        score.title,
        page.x + page.width / 2,
        page.y + 48,
        13,
      ).setAttribute("text-anchor", "middle");
    }
  }
  const title = label(
    svg,
    score.title || "Untitled",
    plan.pages[0].width / 2,
    66,
    30,
  );
  title.setAttribute("text-anchor", "middle");
  const composer = label(
    svg,
    score.composer,
    plan.pages[0].width - 62,
    106,
    13,
  );
  composer.setAttribute("text-anchor", "end");
  label(
    svg,
    `♩ = ${score.tempo}`,
    132,
    options.view === "scroll" ? 100 : 156,
    15,
  );
  const starts = measureStarts(score),
    layout: Layout = {
      width,
      height,
      measures: [],
      notes: [],
      pages: plan.pages,
    };
  const rendered = new Map<string, { note: StaveNote; system: number }>();
  const eventsByCell = new Map<string, NoteEvent[]>();
  for (const n of score.notes) {
    const key = `${n.measureId}/${n.staffId}`,
      entries = eventsByCell.get(key) ?? [];
    entries.push(n);
    eventsByCell.set(key, entries);
  }
  for (const [system, line] of plan.systems.entries()) {
    const systemY = line.y;
    const count = line.widths.length;
    for (let col = 0; col < count; col++) {
      const mi = line.first + col,
        m = score.measures[mi],
        barWidth = line.widths[col],
        x = line.x + line.widths.slice(0, col).reduce((a, b) => a + b, 0);
      const box: MeasureBox = {
        measureId: m.id,
        measureIndex: mi,
        system,
        start: value(starts.get(m.id)!),
        length: value(measureBeats(m)),
        x,
        endX: x + barWidth,
        top: systemY - 22,
        bottom: systemY + (score.staves.length - 1) * staffGap + 100,
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
          top: stave.getYForLine(0) - 18,
          bottom: stave.getYForLine(4) + 22,
          lineBottom: stave.getYForLine(4),
          clef: staff.clef,
        });
        if (
          col === 0 &&
          (si === 0 || score.staves[si - 1].instrumentId !== staff.instrumentId)
        ) {
          let groupEnd = si;
          while (
            groupEnd + 1 < score.staves.length &&
            score.staves[groupEnd + 1].instrumentId === staff.instrumentId
          )
            groupEnd++;
          const name = label(
            svg,
            system === 0
              ? staff.name
              : staff.name.length > 14
                ? staff.name.slice(0, 12) + "."
                : staff.name,
            x - 12,
            stave.getYForLine(2) + 4 + ((groupEnd - si) * staffGap) / 2,
            12,
          );
          name.setAttribute("text-anchor", "end");
        }
        const events = eventsByCell.get(`${m.id}/${staff.id}`) ?? [];
        const usedVoices = [
          ...new Set(events.length ? events.map((n) => n.voice) : [0]),
        ].sort();
        const staffVoices: Voice[] = [];
        for (const voiceNumber of usedVoices) {
          const layerEvents = events.filter((n) => n.voice === voiceNumber);
          const entries = layerEvents.length
            ? fillGaps(
                events
                  .filter((n) => n.voice === voiceNumber)
                  .sort((a, b) => compare(a.offset, b.offset)),
                measureBeats(m),
              )
            : [
                {
                  offset: ZERO,
                  span: measureBeats(m),
                  base: 1,
                  dots: 0,
                  tuplets: [],
                },
              ];
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
              : staff.clef === "percussion"
                ? ["b/4"]
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
              alignCenter: !layerEvents.length,
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
                note.setStyle({ fillStyle: "#2468b8", strokeStyle: "#2468b8" });
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
          // Tuplet attach/detach changes VexFlow's unreduced denominators. Build
          // the Voice only after this, or its cached resolution misaligns staves.
          for (const g of glyphs) {
            g.note.getTickMultiplier().simplify();
            g.note.getTicks().simplify();
          }
          const voice = new Voice({ numBeats: m.beats, beatValue: m.beatType })
            .setMode(Voice.Mode.SOFT)
            .setStave(stave)
            .addTickables(glyphs.map((g) => g.note));
          staffVoices.push(voice);
          voices.push(voice);
          groups.push(glyphs);
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
      if (col === 0)
        for (const instrument of score.instruments) {
          const indices = score.staves
            .map((s, i) => (s.instrumentId === instrument.id ? i : -1))
            .filter((i) => i >= 0);
          if (indices.length > 1)
            new StaveConnector(staves[indices[0]], staves[indices.at(-1)!])
              .setType(StaveConnector.type.BRACE)
              .setContext(ctx)
              .draw();
        }
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
                    m.beats > 3 && m.beats % 3 === 0 ? 3 : 1,
                    m.beatType,
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
      const startAbs = box.start + value(mark.offset);
      const groups: MeasureBox[][] = [];
      for (const segment of layout.measures) {
        if (
          segment.start + segment.length <= startAbs ||
          segment.start >= endAbs
        )
          continue;
        const group = groups.at(-1);
        if (group && group[0].system === segment.system) group.push(segment);
        else groups.push([segment]);
      }
      for (const group of groups) {
        const first = group[0],
          last = group.at(-1)!;
        const row =
          first.staves.find((s) => s.id === mark.staffId) ?? first.staves[0];
        const sy = below ? row.lineBottom + 35 : row.top + 9;
        const a = Math.max(startAbs, first.start),
          b = Math.min(endAbs, last.start + last.length);
        const x1 = xAtTime(first, a - first.start),
          x2 = xAtTime(last, b - last.start);
        if (mark.kind === "hairpin") {
          const width = Math.max(0.01, endAbs - startAbs),
            r1 = (a - startAbs) / width,
            r2 = (b - startAbs) / width;
          const crescendo = (mark.target ?? mark.amount) > mark.amount,
            h1 = 5 * (crescendo ? r1 : 1 - r1),
            h2 = 5 * (crescendo ? r2 : 1 - r2);
          path(
            svg,
            `M ${x1} ${sy - h1} L ${x2} ${sy - h2} M ${x1} ${sy + h1} L ${x2} ${sy + h2}`,
          ).setAttribute("data-mark-id", mark.id);
        } else {
          const isFirst = first === box;
          if (isFirst) label(svg, mark.text || mark.kind, x1, sy, 13, "italic");
          path(
            svg,
            `M ${x1 + (isFirst ? 32 : 0)} ${sy + 3} H ${x2}${b === endAbs ? " v -5" : ""}`,
          );
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
