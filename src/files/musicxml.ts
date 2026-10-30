import { unzipSync, strFromU8 } from "fflate";
import {
  blankScore,
  beats,
  duration,
  id,
  keySignatures,
  measureBeats,
  midiPitch,
  pitchFromMidi,
  type Articulation,
  type Duration,
  type Mark,
  type NoteEvent,
  type Pitch,
  type Score,
  type Staff,
  type Step,
} from "../core/model";
import {
  add,
  compare,
  rat,
  sub,
  value,
  ZERO,
  type Rational,
} from "../core/rational";
import { cleanLinks, spellDuration } from "../core/editing";
import { validateScore } from "../core/validation";
import { dynamicValues } from "../core/instruments";

const children = (el: Element, name: string) =>
  [...el.children].filter((e) => e.localName === name);
const child = (el: Element, name: string) => children(el, name)[0];
const text = (el: Element | undefined, name?: string) =>
  ((name && el ? child(el, name) : el)?.textContent ?? "").trim();
const number = (el: Element | undefined, name: string, fallback = 0) => {
  const raw = el ? text(el, name) : "";
  return raw === "" ? fallback : Number(raw);
};
function xmlDocument(source: string) {
  if (source.length > 20_000_000)
    throw new Error("MusicXML exceeds the 20 MB document limit.");
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source))
    throw new Error("MusicXML entity declarations are not supported.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("The MusicXML file is not well-formed XML.");
  return doc;
}
export function decodeMusicXml(bytes: Uint8Array): string {
  if (bytes.byteLength > 20_000_000)
    throw new Error("MusicXML file exceeds 20 MB.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return new TextDecoder().decode(bytes);
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.originalSize > 20_000_000)
        throw new Error("An expanded MusicXML entry exceeds 20 MB.");
      total += entry.originalSize;
      if (total > 60_000_000)
        throw new Error("Expanded MusicXML archive exceeds 60 MB.");
      return /\.(xml|musicxml)$/i.test(entry.name);
    },
  });
  const container = files["META-INF/container.xml"];
  if (!container)
    throw new Error("Compressed MusicXML is missing META-INF/container.xml.");
  const doc = xmlDocument(strFromU8(container));
  const root =
    [...doc.getElementsByTagName("rootfile")].find(
      (e) =>
        e.getAttribute("media-type") ===
        "application/vnd.recordare.musicxml+xml",
    ) ?? doc.getElementsByTagName("rootfile")[0];
  const path = root?.getAttribute("full-path");
  if (!path || !files[path])
    throw new Error("The MusicXML score named in the archive is missing.");
  return strFromU8(files[path]);
}
export interface MusicXmlResult {
  score: Score;
  warnings: string[];
}

/** Parse score-partwise MusicXML into exact musical time; never execute XML or follow links. */
export function importMusicXml(source: string): MusicXmlResult {
  const doc = xmlDocument(source),
    root = doc.documentElement;
  if (root.localName !== "score-partwise")
    throw new Error(
      "Please export the score as score-partwise MusicXML.",
    );
  const parts = children(root, "part");
  if (!parts.length || parts.length > 64)
    throw new Error("The score must contain 1–64 parts.");
  const score = blankScore();
  score.instruments = [];
  score.staves = [];
  score.measures = [];
  score.notes = [];
  score.marks = [];
  score.title =
    text(child(root, "work"), "work-title") ||
    text(root, "movement-title") ||
    "Imported score";
  const identity = child(root, "identification");
  score.composer = identity
    ? children(identity, "creator")
        .filter((e) => e.getAttribute("type") === "composer")
        .map((e) => text(e))
        .join(", ")
    : "";
  const warnings = new Set<string>(),
    partList = child(root, "part-list");
  const partDefs = partList ? children(partList, "score-part") : [];
  const openTies = new Map<string, NoteEvent>(),
    openSlurs = new Map<string, NoteEvent>(),
    openSpans = new Map<string, Mark>();
  const measureLengths = new Map<number, Rational>();
  for (const [pi, part] of parts.entries()) {
    const def = partDefs.find(
      (p) => p.getAttribute("id") === part.getAttribute("id"),
    );
    const midi = def ? child(def, "midi-instrument") : undefined;
    const instrument = {
      id: id(),
      name: (def ? text(def, "part-name") : "") || `Part ${pi + 1}`,
      program: Math.max(0, Math.min(127, number(midi, "midi-program", 1) - 1)),
      percussion: number(midi, "midi-channel") === 10,
      transpose: 0,
      volume: 90,
      pan: 64,
      mute: false,
      solo: false,
    };
    score.instruments.push(instrument);
    const midiMap = new Map<string, number>();
    for (const m of def ? children(def, "midi-instrument") : []) {
      const unpitched = number(m, "midi-unpitched");
      if (unpitched) midiMap.set(m.getAttribute("id") ?? "", unpitched - 1);
    }
    const staffMap = new Map<number, Staff>(),
      voiceMap = new Map<string, number>();
    const ensureStaff = (n: number) => {
      let st = staffMap.get(n);
      if (!st) {
        st = {
          id: id(),
          instrumentId: instrument.id,
          name: instrument.name,
          clef: "treble",
        };
        staffMap.set(n, st);
        score.staves.push(st);
      }
      return st;
    };
    ensureStaff(1);
    let divisions = 1,
      meter = { beats: 4, beatType: 4, key: "C" },
      lastChord: NoteEvent | undefined;
    const bars = children(part, "measure");
    if (bars.length > 2000) throw new Error("MusicXML exceeds 2000 measures.");
    const pendingGrace = new Map<string, Pitch[]>();
    for (const [mi, bar] of bars.entries()) {
      let cursor = ZERO,
        maxEnd = ZERO;
      const attributes = child(bar, "attributes");
      if (attributes) {
        divisions = number(attributes, "divisions", divisions);
        if (
          !Number.isSafeInteger(divisions) ||
          divisions <= 0 ||
          divisions > 1_000_000
        )
          throw new Error("Unsupported MusicXML divisions.");
        const time = child(attributes, "time");
        if (time) {
          const beatsText = text(time, "beats");
          const count = beatsText.split("+").reduce((a, b) => a + Number(b), 0);
          meter = {
            ...meter,
            beats: count,
            beatType: number(time, "beat-type", 4),
          };
        }
        const key = child(attributes, "key");
        if (key) {
          const fifths = number(key, "fifths");
          if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7)
            throw new Error("Nonstandard key signatures are not supported.");
          meter.key = keySignatures[fifths + 7];
        }
        const trans = child(attributes, "transpose");
        if (trans) {
          const change =
            number(trans, "chromatic") + 12 * number(trans, "octave-change");
          if (mi > 0 && change !== instrument.transpose)
            warnings.add(
              "Mid-score instrument transposition changes need review.",
            );
          else instrument.transpose = change;
        }
        const count = number(attributes, "staves", 1);
        for (let n = 1; n <= count; n++) ensureStaff(n);
        for (const clef of children(attributes, "clef")) {
          const st = ensureStaff(Number(clef.getAttribute("number") ?? 1)),
            sign = text(clef, "sign"),
            line = number(clef, "line");
          const next: Staff["clef"] =
            sign === "F"
              ? "bass"
              : sign === "C"
                ? line === 4
                  ? "tenor"
                  : "alto"
                : sign === "percussion"
                  ? "percussion"
                  : "treble";
          if (mi > 0 && st.clef !== next)
            warnings.add(
              "Mid-score clef changes use the staff’s initial clef; review those passages.",
            );
          else st.clef = next;
          if (sign === "TAB")
            warnings.add("Tablature is imported as ordinary notation.");
        }
      }
      if (!score.measures[mi]) score.measures[mi] = { id: id(), ...meter };
      const measure = score.measures[mi];
      if (
        pi > 0 &&
        (measure.beats !== meter.beats || measure.beatType !== meter.beatType)
      )
        throw new Error(
          "Independent time signatures between staves are not yet supported.",
        );
      const markAt = (offset = cursor) => ({ measureId: measure.id, offset });
      for (const item of [...bar.children]) {
        if (item.localName === "backup" || item.localName === "forward") {
          const span = rat(number(item, "duration"), divisions);
          cursor =
            item.localName === "backup" ? sub(cursor, span) : add(cursor, span);
          if (cursor.n < 0)
            throw new Error(
              "MusicXML backup moves before the start of a measure.",
            );
          lastChord = undefined;
          continue;
        }
        if (item.localName === "attributes") continue;
        if (item.localName === "note") {
          const st = ensureStaff(number(item, "staff", 1)),
            voiceKey = `${st.id}/${text(item, "voice") || "1"}`;
          if (!voiceMap.has(voiceKey)) {
            const used = [...voiceMap.keys()].filter((k) =>
              k.startsWith(st.id + "/"),
            ).length;
            if (used >= 4)
              throw new Error(
                `${instrument.name} has more than four voices in a staff.`,
              );
            voiceMap.set(voiceKey, used);
          }
          const voice = voiceMap.get(voiceKey)!;
          const p = child(item, "pitch"),
            unpitched = child(item, "unpitched");
          let pitches: Pitch[] = [];
          if (p)
            pitches = [
              {
                step: text(p, "step") as Step,
                alter: number(p, "alter"),
                octave: number(p, "octave", 4),
              },
            ];
          else if (unpitched) {
            const instrumentRef =
              child(item, "instrument")?.getAttribute("id") ?? "";
            pitches = [pitchFromMidi(midiMap.get(instrumentRef) ?? 38)];
            instrument.percussion = true;
            st.clef = "percussion";
            warnings.add(
              "Unpitched percussion uses its General MIDI note mapping; specialized percussion staff positions need review.",
            );
          }
          if (child(item, "grace")) {
            if (pitches.length)
              pendingGrace.set(voiceKey, [
                ...(pendingGrace.get(voiceKey) ?? []),
                ...pitches,
              ]);
            continue;
          }
          const span = rat(number(item, "duration"), divisions);
          if (span.n <= 0)
            throw new Error("A MusicXML note has no positive duration.");
          const chord = !!child(item, "chord");
          if (
            chord &&
            (!lastChord ||
              lastChord.staffId !== st.id ||
              lastChord.voice !== voice)
          )
            throw new Error("A MusicXML chord is missing its base note.");
          const offset = chord ? lastChord!.offset : cursor;
          const types: Record<string, number> = {
            whole: 1,
            half: 2,
            quarter: 4,
            eighth: 8,
            "16th": 16,
            "32nd": 32,
            "64th": 64,
          };
          const tm = child(item, "time-modification");
          const d: Duration = duration(
            types[text(item, "type")] ?? 4,
            Math.min(2, children(item, "dot").length),
            tm
              ? [
                  {
                    actual: number(tm, "actual-notes"),
                    normal: number(tm, "normal-notes"),
                  },
                ]
              : [],
          );
          let durations =
            compare(beats(d), span) === 0 ? [d] : spellDuration(span, d);
          if (chord && compare(beats(lastChord!.duration), span) !== 0)
            throw new Error(
              "Chord tones with different durations need separate voices.",
            );
          const notation = child(item, "notations"),
            art = notation ? child(notation, "articulations") : undefined;
          const names: Record<string, Articulation> = {
            staccato: "staccato",
            tenuto: "tenuto",
            accent: "accent",
            "strong-accent": "marcato",
          };
          let articulation: Articulation = "";
          for (const a of art ? [...art.children] : [])
            if (names[a.localName]) articulation = names[a.localName];
          if (notation && child(notation, "fermata")) articulation = "fermata";
          const ornaments = notation ? child(notation, "ornaments") : undefined;
          if (ornaments && child(ornaments, "trill-mark"))
            articulation = "trill";
          if (ornaments && child(ornaments, "tremolo"))
            articulation = "tremolo";
          let event: NoteEvent;
          if (chord) {
            event = lastChord!;
            for (const pitch of pitches)
              if (!event.pitches.some((p) => midiPitch(p) === midiPitch(pitch)))
                event.pitches.push(pitch);
          } else {
            let t = offset;
            const fragments: NoteEvent[] = [];
            for (const [di, dur] of durations.entries()) {
              const n: NoteEvent = {
                id: id(),
                staffId: st.id,
                measureId: measure.id,
                voice,
                offset: t,
                duration: dur,
                pitches: structuredClone(pitches),
                articulation: di === 0 ? articulation : "",
              };
              if (di === 0) {
                n.grace = pendingGrace.get(voiceKey);
                pendingGrace.delete(voiceKey);
              }
              if (fragments.length && pitches.length)
                fragments.at(-1)!.tieTo = n.id;
              fragments.push(n);
              score.notes.push(n);
              t = add(t, beats(dur));
            }
            event = fragments[0];
            lastChord = event;
            cursor = add(cursor, span);
          }
          const end = add(offset, span);
          if (compare(end, maxEnd) > 0) maxEnd = end;
          for (const pitch of pitches) {
            const key = `${voiceKey}/${midiPitch(pitch)}`,
              ties = children(item, "tie").concat(
                notation ? children(notation, "tied") : [],
              );
            if (ties.some((t) => t.getAttribute("type") === "stop")) {
              const previous = openTies.get(key);
              if (previous) previous.tieTo = event.id;
              openTies.delete(key);
            }
            if (ties.some((t) => t.getAttribute("type") === "start"))
              openTies.set(key, event);
          }
          for (const slur of notation ? children(notation, "slur") : []) {
            const key = `${voiceKey}/${slur.getAttribute("number") ?? 1}`;
            if (slur.getAttribute("type") === "stop") {
              const previous = openSlurs.get(key);
              if (previous && previous.id !== event.id)
                previous.slurTo = event.id;
              openSlurs.delete(key);
            }
            if (slur.getAttribute("type") === "start")
              openSlurs.set(key, event);
          }
          if (children(item, "lyric").length)
            warnings.add("Lyrics are not imported in this version.");
          continue;
        }
        if (item.localName === "direction") {
          const st = ensureStaff(number(item, "staff", 1)),
            offset = add(cursor, rat(number(item, "offset"), divisions));
          if (offset.n < 0) {
            warnings.add(
              "A direction before the start of a measure was omitted.",
            );
            continue;
          }
          const sound = child(item, "sound"),
            tempo = Number(sound?.getAttribute("tempo"));
          if (tempo >= 20 && tempo <= 400) {
            if (mi === 0 && offset.n === 0) score.tempo = Math.round(tempo);
            else
              score.marks.push({
                id: id(),
                kind: "tempo",
                ...markAt(offset),
                text: "",
                amount: Math.round(tempo),
              });
          }
          for (const direction of children(item, "direction-type").flatMap(
            (t) => [...t.children],
          )) {
            if (direction.localName === "dynamics") {
              const name = direction.children[0]?.localName ?? "mf";
              score.marks.push({
                id: id(),
                kind: "dynamic",
                staffId: st.id,
                ...markAt(offset),
                text: name,
                amount: dynamicValues[name] ?? 80,
              });
            }
            if (direction.localName === "words")
              score.marks.push({
                id: id(),
                kind: "text",
                staffId: st.id,
                ...markAt(offset),
                text: text(direction),
                amount: 0,
              });
            if (direction.localName === "metronome" && !tempo) {
              const bpm = number(direction, "per-minute");
              if (bpm >= 20 && bpm <= 400) {
                const type = text(direction, "beat-unit"),
                  factor = type === "half" ? 2 : type === "eighth" ? 0.5 : 1;
                const target = Math.round(
                  bpm * factor * (child(direction, "beat-unit-dot") ? 1.5 : 1),
                );
                score.marks.push({
                  id: id(),
                  kind: "tempo",
                  ...markAt(offset),
                  text: "",
                  amount: Math.max(20, Math.min(400, target)),
                });
              }
            }
            if (
              ["wedge", "pedal", "octave-shift"].includes(direction.localName)
            ) {
              const type = direction.getAttribute("type") ?? "",
                key = `${st.id}/${direction.localName}/${direction.getAttribute("number") ?? 1}`;
              if (
                (["stop", "up"].includes(type) &&
                  direction.localName !== "octave-shift") ||
                type === "stop"
              ) {
                const previous = openSpans.get(key);
                if (previous) {
                  previous.endMeasureId = measure.id;
                  previous.endOffset = offset;
                  openSpans.delete(key);
                }
              } else if (
                ["crescendo", "diminuendo", "start", "down", "up"].includes(
                  type,
                )
              ) {
                const kind =
                  direction.localName === "wedge"
                    ? "hairpin"
                    : direction.localName === "pedal"
                      ? "pedal"
                      : "ottava";
                const amount =
                  kind === "hairpin"
                    ? type === "crescendo"
                      ? 60
                      : 100
                    : kind === "pedal"
                      ? 1
                      : (type === "down" ? 1 : -1) *
                        (Number(direction.getAttribute("size") ?? 8) === 15
                          ? 24
                          : 12);
                const mark: Mark = {
                  id: id(),
                  kind,
                  staffId: st.id,
                  ...markAt(offset),
                  text:
                    kind === "hairpin"
                      ? type === "crescendo"
                        ? "cresc."
                        : "dim."
                      : kind === "pedal"
                        ? "Ped."
                        : amount > 0
                          ? "8va"
                          : "8vb",
                  amount,
                  target:
                    kind === "hairpin"
                      ? type === "crescendo"
                        ? 100
                        : 60
                      : undefined,
                };
                score.marks.push(mark);
                openSpans.set(key, mark);
              }
            }
          }
        }
        if (item.localName === "barline") {
          const repeat = child(item, "repeat");
          if (repeat?.getAttribute("direction") === "forward")
            measure.repeatStart = true;
          if (repeat?.getAttribute("direction") === "backward")
            measure.repeatEnd = true;
          const ending = child(item, "ending");
          if (ending?.getAttribute("type") === "start") {
            const n = Number(ending.getAttribute("number"));
            if (n === 1 || n === 2) measure.ending = n;
            else
              warnings.add(
                "Only first and second repeat endings are supported.",
              );
          }
        }
        if (item.localName === "harmony")
          warnings.add("Chord-symbol text is not imported in this version.");
      }
      if (compare(maxEnd, measureLengths.get(mi) ?? ZERO) > 0)
        measureLengths.set(mi, maxEnd);
      if (
        bar.getAttribute("implicit") === "yes" &&
        maxEnd.n &&
        compare(maxEnd, rat(measure.beats * 4, measure.beatType)) < 0
      )
        measure.pickup = maxEnd;
    }
  }
  for (const [mi, length] of measureLengths) {
    const m = score.measures[mi];
    if (m.pickup) m.pickup = length;
    if (compare(length, measureBeats(m)) > 0)
      throw new Error(
        `Measure ${mi + 1} contains more beats than its meter. Export it with correct bar durations first.`,
      );
  }
  const last = score.measures.at(-1)!;
  for (const mark of openSpans.values()) {
    mark.endMeasureId = last.id;
    mark.endOffset = measureBeats(last);
    warnings.add(
      "An unclosed expression line was extended to the end of the score.",
    );
  }
  const before = score.notes.filter((n) => n.tieTo || n.slurTo).length;
  cleanLinks(score);
  if (score.notes.filter((n) => n.tieTo || n.slurTo).length < before)
    warnings.add(
      "Some nonadjacent ties or cross-voice slurs could not be represented.",
    );
  const starts = new Map<string, number>();
  let t = 0;
  for (const m of score.measures) {
    starts.set(m.id, t);
    t += value(measureBeats(m));
  }
  score.marks = score.marks.filter((m) => {
    if (!m.endMeasureId) return true;
    const valid =
      starts.get(m.endMeasureId)! + value(m.endOffset!) >
      starts.get(m.measureId)! + value(m.offset);
    if (!valid) warnings.add("Zero-length expression lines were omitted.");
    return valid;
  });
  validateScore(score);
  return { score, warnings: [...warnings] };
}
