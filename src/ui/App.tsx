import { KeyboardGuide } from "./KeyboardGuide";
import { ScoreSettings } from "./ScoreSettings";
import { InstrumentPanel } from "./InstrumentPanel";
import { MenuBar } from "./MenuBar";
import { MainPalette } from "./MainPalette";
import { EntryPalette } from "./EntryPalette";
import { EntryPreview } from "./EntryPreview";
import {
  entryPlacement,
  pitchY,
  removePitch,
  type EntryPlacement,
} from "./entryPlacement";
import { PlaybackControls } from "./PlaybackControls";
import { ScoreIcon } from "./ScoreIcon";
import { counterAt, parseCounter } from "./playbackPosition";
import { CommandDialog, type DialogSpec } from "./CommandDialog";
import {
  fullMeasures,
  isStack,
  changeMeter,
  cleanLinks,
  clearRegion,
  copyRegion,
  deleteMeasures,
  enterNote,
  insertMeasures,
  pasteRegion,
  regionDescription,
  regionNotes,
  regionTimes,
  repeatRegion,
  transposeRegion,
  type MusicClip,
  type Region,
} from "../core/editing";
import {
  extendRegion,
  moveRegionEdge,
  regionFromHits,
  selectionRects,
} from "./selection";
import { defaultRenderOptions } from "../engraving/pagination";
import { scrubFrames } from "../performance/scrub";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  absolute,
  beats,
  blankScore,
  cloneScore,
  connectNext,
  duration,
  id,
  keyAlter,
  keySignatures,
  measureBeats,
  moveDiatonic,
  nextCursor,
  pitchFromMidi,
  pitchName,
  midiPitch,
  steps,
  type Articulation,
  type Cursor,
  type Duration,
  type MarkKind,
  type Pitch,
  type Score,
  type Step,
} from "../core/model";
import { add, compare, fromDecimal, sub, value, ZERO } from "../core/rational";
import { GM, dynamicValues } from "../core/instruments";
import { validateScore } from "../core/validation";
import { demoScore } from "../core/demo";
import {
  compilePerformance,
  ScoreIndex,
  type Performance,
  type Scope,
} from "../performance/compiler";
import { renderScore } from "../engraving/render";
import { hitTest, xAtTime, type Hit, type Layout } from "../engraving/geometry";
import { AudioController } from "../audio/controller";
import {
  openDocument,
  importXmlDocument,
  recoveryRead,
  recoveryWrite,
  saveDocument,
  saveMidi,
} from "../files/documents";

const initial = demoScore();
function parsePitches(text: string): Pitch[] {
  return text.trim()
    ? text
        .trim()
        .split(/[ ,]+/)
        .map((token) => {
          const match = /^([A-Ga-g])([#b♯♭]{0,2})(-?\d)$/.exec(token);
          if (!match) throw new Error("Use pitches such as C4 E4 G4 or F#5.");
          return {
            step: match[1].toUpperCase() as Step,
            alter: [...match[2]].reduce(
              (s, c) => s + (["#", "♯"].includes(c) ? 1 : -1),
              0,
            ),
            octave: Number(match[3]),
          };
        })
    : [];
}
const formatPitches = (p: Pitch[]) =>
  p
    .map(
      (n) =>
        `${n.step}${n.alter > 0 ? "#".repeat(n.alter) : "b".repeat(-n.alter)}${n.octave}`,
    )
    .join(" ");
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.matches("input,textarea,select") || target.isContentEditable);

export function App() {
  const [score, setScore] = useState<Score>(initial),
    [cursor, setCursor] = useState<Cursor>({
      staffId: initial.staves[0].id,
      measureId: initial.measures[0].id,
      offset: ZERO,
      voice: 0,
    });
  const [selected, setSelected] = useState<string>(),
    [entryDuration, setEntryDuration] = useState<Duration>(duration()),
    [mode, setMode] = useState<
      | "select"
      | "write"
      | "speedy"
      | "staff"
      | "measure"
      | "key"
      | "time"
      | "clef"
      | "hand"
      | "zoom"
      | "expression"
      | "articulation"
      | "crescendo"
      | "diminuendo"
      | "slur"
      | "erase"
    >("select");
  const [entryRest, setEntryRest] = useState(false),
    [entryAccidental, setEntryAccidental] = useState<number>(),
    [speedyActive, setSpeedyActive] = useState(true),
    [palettes, setPalettes] = useState({
      mainPalette: true,
      playbackControls: true,
      notePalette: true,
      restPalette: true,
    }),
    [visiblePage, setVisiblePage] = useState(1),
    [paused, setPaused] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const pauseOffset = useRef<number | undefined>(undefined);
  const pendingTuplet = useRef<
    { actual: number; normal: number; remaining?: number } | undefined
  >(undefined);
  const [region, setRegion] = useState<Region>(),
    [dialog, setDialog] = useState<DialogSpec>(),
    [articulationValue, setArticulationValue] =
      useState<Articulation>("staccato"),
    [openPanel, setOpenPanel] = useState<"instruments" | "inspector">(),
    [viewOptions, setViewOptions] = useState(defaultRenderOptions),
    [fitPage, setFitPage] = useState(false),
    [entryPitch, setEntryPitch] = useState<Pitch>({
      step: "C",
      alter: 0,
      octave: 5,
    }),
    [contextMenu, setContextMenu] = useState<{ x: number; y: number }>(),
    [dragRect, setDragRect] = useState<{
      left: number;
      top: number;
      width: number;
      height: number;
    }>();
  const gesture = useRef<
    | {
        kind:
          | "region"
          | "pan"
          | "copy"
          | "note"
          | "shape"
          | "zoom"
          | "entry"
          | "palette";
        x: number;
        y: number;
        left: number;
        top: number;
        hit?: Hit;
        last?: Hit;
        region?: Region;
        noteId?: string;
        placement?: EntryPlacement;
        duration?: Duration;
        rest?: boolean;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const suppressContext = useRef(false);
  const lastAudition = useRef<{ hit: Hit; scope: string } | undefined>(
    undefined,
  );
  const [scope, setScope] = useState<Scope["mode"]>("all"),
    [pedal, setPedal] = useState(true),
    [latched, setLatched] = useState(false),
    [auditioning, setAuditioning] = useState(false);
  const [playing, setPlaying] = useState(false),
    [playhead, setPlayhead] = useState<number>(),
    [hover, setHover] = useState<Hit>(),
    [zoom, setZoom] = useState(0.85),
    [fitWidth, setFitWidth] = useState(false),
    [concert, setConcert] = useState(false);
  const [dirty, setDirty] = useState(false),
    [notice, setNotice] = useState("Ready"),
    [error, setError] = useState(false),
    [help, setHelp] = useState(false),
    [panel, setPanel] = useState<"note" | "score">("note");
  const [recovery, setRecovery] = useState<Score>(),
    [fonts, setFonts] = useState(false),
    [layout, setLayout] = useState<Layout>(),
    [, setAudioTick] = useState(0),
    [, setHistoryTick] = useState(0);
  const [markKind, setMarkKind] = useState<MarkKind>("dynamic"),
    [markText, setMarkText] = useState("mf"),
    [markAmount, setMarkAmount] = useState(80),
    [markTarget, setMarkTarget] = useState(100),
    [markLength, setMarkLength] = useState(4);
  const [newProgram, setNewProgram] = useState(40),
    [master, setMaster] = useState(0.65),
    [retriggerAll, setRetriggerAll] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    scrollHost = useRef<HTMLDivElement>(null),
    [audio] = useState(() => new AudioController()),
    undo = useRef<Score[]>([]),
    redo = useRef<Score[]>([]),
    clipboard = useRef<MusicClip | undefined>(undefined);
  const selectionEdges = useRef<{
    horizontal?: "start" | "end";
    vertical?: "start" | "end";
  }>({});
  const held = useRef(false),
    shift = useRef(false),
    controlGesture = useRef(false),
    latchedRef = useRef(false),
    lastHit = useRef<Hit | undefined>(undefined),
    lastMembership = useRef(""),
    performanceRef = useRef<Performance | undefined>(undefined),
    playRequest = useRef(0),
    animation = useRef<number>(0);
  const index = useMemo(() => new ScoreIndex(score), [score]);
  const showInstruments = openPanel === "instruments",
    showInspector = openPanel === "inspector";
  const setShowInstruments = (show: boolean) =>
    setOpenPanel((p) =>
      show ? "instruments" : p === "instruments" ? undefined : p,
    );
  const setShowInspector = (show: boolean) =>
    setOpenPanel((p) =>
      show ? "inspector" : p === "inspector" ? undefined : p,
    );
  const closePanel = () => {
    setOpenPanel(undefined);
    scrollHost.current?.focus();
  };
  const note = score.notes.find((n) => n.id === selected),
    staff =
      score.staves.find((s) => s.id === cursor.staffId) ?? score.staves[0],
    instrument = score.instruments.find((i) => i.id === staff.instrumentId)!;
  const measureIndex = score.measures.findIndex(
      (m) => m.id === cursor.measureId,
    ),
    measure = score.measures[measureIndex] ?? score.measures[0];
  const report = (message: string, bad = false) => {
    setNotice(message);
    setError(bad);
  };
  const stop = () => {
    pauseOffset.current = undefined;
    setPaused(false);
    setElapsed(0);
    lastAudition.current = undefined;
    playRequest.current++;
    held.current = false;
    shift.current = false;
    latchedRef.current = false;
    setLatched(false);
    setAuditioning(false);
    setPlaying(false);
    setPlayhead(undefined);
    audio.stop();
    cancelAnimationFrame(animation.current);
  };
  const refreshAudition = (hit = lastHit.current, retrigger = false) => {
    if (!(held.current || latchedRef.current) || !hit) {
      lastAudition.current = undefined;
      if (held.current || latchedRef.current) audio.audition([]);
      return;
    }
    const auditionScope: Scope = {
      mode: shift.current ? "staff" : scope,
      staffId: hit.staffId,
      pedal,
    };
    const voices = index.at(hit.time, auditionScope);
    const membership = voices.map((v) => v.id).join("/");
    const previous = lastAudition.current,
      scopeKey = `${auditionScope.mode}/${auditionScope.mode === "all" ? "" : hit.staffId}/${pedal}`;
    if (audio.state !== "ready") {
      lastAudition.current = undefined;
      return;
    }
    if (
      previous &&
      previous.scope === scopeKey &&
      previous.hit.time === hit.time &&
      !retrigger
    )
      return;
    if (
      previous &&
      previous.scope === scopeKey &&
      (previous.hit.measure.system ?? previous.hit.measure.top) ===
        (hit.measure.system ?? hit.measure.top) &&
      !retrigger &&
      Math.abs(previous.hit.time - hit.time) > 1e-8
    ) {
      audio.sweep(
        scrubFrames(index, previous.hit.time, hit.time, auditionScope),
        Math.sign(hit.time - previous.hit.time),
        retriggerAll,
      );
    } else
      audio.audition(
        voices,
        retrigger || (retriggerAll && membership !== lastMembership.current),
      );
    lastMembership.current = membership;
    lastAudition.current = { hit, scope: scopeKey };
  };
  const commit = (change: (draft: Score) => void) => {
    try {
      const draft = cloneScore(score);
      change(draft);
      validateScore(draft);
      lastAudition.current = undefined;
      playRequest.current++;
      audio.stop();
      undo.current.push(score);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
      pauseOffset.current = undefined;
      setPaused(false);
      setElapsed(0);
      setScore(draft);
      setDirty(true);
      setPlaying(false);
      setPlayhead(undefined);
      setHistoryTick((n) => n + 1);
      setError(false);
      return true;
    } catch (e) {
      report(String(e instanceof Error ? e.message : e), true);
      return false;
    }
  };
  const history = (back: boolean) => {
    const from = back ? undo.current : redo.current,
      to = back ? redo.current : undo.current,
      next = from.pop();
    if (!next) return;
    stop();
    to.push(score);
    setScore(next);
    setSelected(undefined);
    setRegion(undefined);
    const keptMeasure =
      next.measures.find((m) => m.id === cursor.measureId) ??
      next.measures[Math.min(measureIndex, next.measures.length - 1)];
    setCursor({
      ...cursor,
      staffId: next.staves.some((s) => s.id === cursor.staffId)
        ? cursor.staffId
        : next.staves[0].id,
      measureId: keptMeasure.id,
      offset:
        compare(cursor.offset, measureBeats(keptMeasure)) < 0
          ? cursor.offset
          : ZERO,
    });
    setDirty(true);
    setHistoryTick((n) => n + 1);
  };
  const replaceScore = (next: Score) => {
    stop();
    setScore(next);
    setCursor({
      staffId: next.staves[0].id,
      measureId: next.measures[0].id,
      offset: ZERO,
      voice: 0,
    });
    setSelected(undefined);
    setRegion(undefined);
    undo.current = [];
    redo.current = [];
    setDirty(false);
    lastHit.current = undefined;
    setHover(undefined);
  };
  const fileAction = async (action: string) => {
    try {
      if (dirty && ["new", "open", "importXml"].includes(action))
        await recoveryWrite(score);
      if (action === "importXml") {
        stop();
        if (
          dirty &&
          !confirm(
            "Import another score? Your unsaved work remains in recovery.",
          )
        )
          return;
        const result = await importXmlDocument();
        if (!result) return;
        await window.desktop?.newFile();
        replaceScore(result.score);
        setDirty(true);
        setRecovery(undefined);
        report(
          `Imported ${result.score.title} · ${result.score.measures.length} measures · ${result.score.staves.length} staves`,
        );
        if (result.warnings.length)
          setDialog({
            title: "MusicXML import notes",
            description: result.warnings.join(" "),
            fields: [],
            submit: "Continue",
            apply: () => true,
          });
      }
      if (action === "save" || action === "saveAs") {
        stop();
        const name = await saveDocument(score, action === "saveAs");
        if (name) {
          setDirty(false);
          report(`Saved ${name}`);
        }
      }
      if (action === "midi") {
        stop();
        const result = await saveMidi(score);
        if (result.name)
          report(
            `MIDI exported · ${result.ppq} ticks/quarter${result.warnings.length ? " · " + result.warnings.join(" ") : ""}`,
          );
      }
      if (action === "open") {
        stop();
        if (
          dirty &&
          !confirm("Open another score? Your unsaved work remains in recovery.")
        )
          return;
        const next = await openDocument();
        if (next) {
          replaceScore(next);
          report(`Opened ${next.title}`);
        }
      }
      if (action === "new") {
        if (
          dirty &&
          !confirm("Create a new score? Your unsaved work remains in recovery.")
        )
          return;
        replaceScore(blankScore());
        await window.desktop?.newFile();
        report("New score. Click a measure, then type A–G to enter notes.");
      }
      if (action === "print") {
        stop();
        const { preparePrint } = await import("../engraving/print");
        preparePrint(score, concert, viewOptions);
        if (window.desktop) await window.desktop.print();
        else window.print();
      }
    } catch (e) {
      report(String(e), true);
    }
  };
  const enable = async () => {
    try {
      await audio.enable();
      audio.volume(master);
      report("Sound ready.");
    } catch (e) {
      report(String(e), true);
    }
  };
  const play = async (fromStart = false, sourceOverride?: number) => {
    if (playing && sourceOverride === undefined && !fromStart) {
      stop();
      return;
    }
    const resume =
      !fromStart && sourceOverride === undefined
        ? pauseOffset.current
        : undefined;
    stop();
    const request = playRequest.current;
    try {
      await audio.enable();
      if (request !== playRequest.current) return;
      const p = compilePerformance(index);
      performanceRef.current = p;
      const source = sourceOverride ?? value(absolute(index.starts, cursor));
      const occurrence = p.occurrences.find(
        (o) => source >= o.sourceStart && source < o.sourceStart + o.length,
      );
      const offset =
        resume ??
        (fromStart || !occurrence
          ? 0
          : p.secondsAt(occurrence.start + source - occurrence.sourceStart));
      audio.play(p, offset);
      setPlaying(true);
      const tick = () => {
        if (!audio.playing) return;
        const seconds = Math.max(
          0,
          (audio.context?.currentTime ?? 0) - audio.playStart,
        );
        setElapsed(seconds);
        setPlayhead(p.scoreAt(seconds));
        animation.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      report(String(e), true);
    }
  };
  const pause = () => {
    if (!playing) {
      if (paused) void play();
      return;
    }
    const offset = Math.max(
      0,
      (audio.context?.currentTime ?? 0) - audio.playStart,
    );
    playRequest.current++;
    audio.stop();
    cancelAnimationFrame(animation.current);
    pauseOffset.current = offset;
    setElapsed(offset);
    setPlayhead(performanceRef.current?.scoreAt(offset));
    setPlaying(false);
    setPaused(true);
  };
  const seekCounter = (text: string) => {
    try {
      const next = parseCounter(score, text, cursor);
      const wasPlaying = playing;
      stop();
      setCursor(next);
      setSelected(undefined);
      setRegion(undefined);
      revealMeasure(score.measures.findIndex((m) => m.id === next.measureId));
      if (wasPlaying) void play(false, value(absolute(index.starts, next)));
      return true;
    } catch (e) {
      report(String(e instanceof Error ? e.message : e), true);
      return false;
    }
  };
  const insert = (pitches: Pitch[], at = cursor, d = entryDuration) => {
    let created: string | undefined,
      next = at;
    const accepted = commit((draft) => {
      let destination = at;
      const last = draft.measures.at(-1)!;
      if (
        at.measureId === last.id &&
        compare(at.offset, measureBeats(last)) >= 0
      ) {
        const m = {
          id: id(),
          beats: last.beats,
          beatType: last.beatType,
          key: last.key,
        };
        draft.measures.push(m);
        destination = { ...at, measureId: m.id, offset: ZERO };
      }
      const n = enterNote(draft, destination, d, pitches)[0];
      created = n.id;
      next = nextCursor(draft, destination, beats(d));
    });
    if (accepted && created) {
      if (mode === "speedy" && pendingTuplet.current && d.tuplets.length) {
        const group = pendingTuplet.current;
        group.remaining =
          (group.remaining ?? (4 / d.base) * group.normal) - value(beats(d));
        if (group.remaining < 1e-8) {
          pendingTuplet.current = undefined;
          setEntryDuration({ ...d, tuplets: [] });
        } else setEntryDuration(d);
      }
      setRegion(undefined);
      setSelected(created);
      setCursor(next);
      report(
        pitches.length
          ? `Entered ${pitches.map(pitchName).join(" · ")}`
          : "Entered rest",
      );
    }
  };
  const remove = () => {
    if (region) {
      if (commit((s) => clearRegion(s, region))) {
        setSelected(undefined);
        report("Selected music cleared. Measures retained.");
      }
      return;
    }
    if (!note) return;
    const at = {
      staffId: note.staffId,
      measureId: note.measureId,
      offset: note.offset,
      voice: note.voice,
    };
    commit((s) => {
      s.notes = s.notes.filter((n) => n.id !== note.id);
      for (const n of s.notes) {
        if (n.tieTo === note.id) delete n.tieTo;
        if (n.slurTo === note.id) delete n.slurTo;
      }
    });
    setSelected(undefined);
    setCursor(at);
  };
  const editNote = (change: (n: NonNullable<typeof note>) => void) => {
    if (note)
      commit((s) => {
        change(s.notes.find((n) => n.id === note.id)!);
        cleanLinks(s);
      });
  };
  const addMark = () => {
    const at =
      region?.start ??
      (note ? { measureId: note.measureId, offset: note.offset } : cursor);
    const start = value(absolute(index.starts, at)),
      end = region
        ? value(absolute(index.starts, region.end))
        : Math.min(index.length, start + Math.max(0.125, markLength));
    const endMeasure =
      [...score.measures]
        .reverse()
        .find((m) => value(index.starts.get(m.id)!) < end - 1e-9) ??
      score.measures[0];
    commit((s) =>
      s.marks.push({
        id: id(),
        kind: markKind,
        staffId: ["tempo", "tempoRamp"].includes(markKind)
          ? undefined
          : staff.id,
        ...at,
        endMeasureId: ["hairpin", "tempoRamp", "pedal", "ottava"].includes(
          markKind,
        )
          ? endMeasure.id
          : undefined,
        endOffset: fromDecimal(end - value(index.starts.get(endMeasure.id)!)),
        text: markText,
        amount:
          markKind === "dynamic"
            ? (dynamicValues[markText] ?? markAmount)
            : markAmount,
        target: markTarget,
      }),
    );
    report("Expression added.");
  };
  const addInstrument = () => {
    commit((s) => {
      const inst = {
        id: id(),
        name: GM[newProgram],
        program: newProgram,
        transpose: 0,
        percussion: false,
        volume: 90,
        pan: 64,
        mute: false,
        solo: false,
      };
      s.instruments.push(inst);
      s.staves.push({
        id: id(),
        instrumentId: inst.id,
        name: inst.name,
        clef: newProgram >= 32 && newProgram <= 39 ? "bass" : "treble",
      });
    });
  };
  const activeRegion = (): Region =>
    region ??
    (note
      ? {
          start: { measureId: note.measureId, offset: note.offset },
          end: {
            measureId: note.measureId,
            offset: add(note.offset, beats(note.duration)),
          },
          staffIds: [note.staffId],
        }
      : fullMeasures(
          score,
          Math.max(0, measureIndex),
          Math.max(0, measureIndex),
          score.staves.indexOf(staff),
          score.staves.indexOf(staff),
        ));
  const chooseRegion = (next: Region) => {
    setRegion(next);
    setSelected(undefined);
    setCursor({ ...cursor, ...next.start, staffId: next.staffIds[0] });
  };
  const zoomTo = (z: number, point?: { x: number; y: number }) => {
    const element = scrollHost.current;
    const next = Math.max(0.1, Math.min(10, z));
    setFitWidth(false);
    setFitPage(false);
    if (element) {
      const rect = element.getBoundingClientRect(),
        x = point ? point.x - rect.left : element.clientWidth / 2,
        y = point ? point.y - rect.top : element.clientHeight / 2;
      const left = ((element.scrollLeft + x) * next) / zoom - x,
        top = ((element.scrollTop + y) * next) / zoom - y;
      requestAnimationFrame(() => {
        element.scrollLeft = left;
        element.scrollTop = top;
      });
    }
    setZoom(next);
  };
  const revealMeasure = (mi: number) => {
    const m = layout?.measures[mi],
      scroller = scrollHost.current;
    if (m && scroller) {
      scroller.scrollLeft = Math.max(0, m.x * zoom - 150);
      scroller.scrollTop = Math.max(0, m.top * zoom - 110);
    }
  };
  const openNumberDialog = (
    title: string,
    label: string,
    initial: number,
    apply: (n: number) => boolean | void,
    max = 2000,
  ) => {
    stop();
    setDialog({
      title,
      fields: [{ name: "count", label, value: initial, min: 1, max }],
      submit: "Apply",
      apply: (v) => apply(Number(v.count)),
    });
  };
  const command = (action: string) => {
    setContextMenu(undefined);
    if (action in palettes) {
      setPalettes({
        ...palettes,
        [action]: !palettes[action as keyof typeof palettes],
      });
      return;
    }
    if (action === "play") {
      void play();
      return;
    }
    if (action === "pause") return pause();
    if (action === "stop") return stop();
    if (action === "enableAudio") {
      void enable();
      return;
    }
    if (["first", "previous", "next", "last"].includes(action)) {
      const source = playhead ?? value(absolute(index.starts, cursor));
      const current = Number(counterAt(score, source).split("|")[0]) - 1;
      const at =
        action === "first"
          ? 0
          : action === "last"
            ? score.measures.length - 1
            : Math.max(
                0,
                Math.min(
                  score.measures.length - 1,
                  current + (action === "next" ? 1 : -1),
                ),
              );
      seekCounter(String(at + 1));
      return;
    }
    if (action === "speedyFrame") {
      setSpeedyActive(!speedyActive);
      return;
    }
    if (action === "insertRest") {
      insert([]);
      return;
    }
    if (action === "tie" || action === "tiePrevious") {
      if (!note) {
        report("Select a note first.");
        return;
      }
      commit((s) => {
        let source = note;
        if (action === "tiePrevious") {
          const previous = s.notes
            .filter(
              (n) =>
                n.staffId === note.staffId &&
                n.voice === note.voice &&
                compare(
                  absolute(index.starts, n),
                  absolute(index.starts, note),
                ) < 0,
            )
            .sort((a, b) =>
              compare(absolute(index.starts, b), absolute(index.starts, a)),
            )[0];
          if (!previous)
            throw new Error("There is no previous note in this layer.");
          source = previous;
        }
        connectNext(s, source.id, "tieTo");
      });
      return;
    }
    if (action === "tupletOptions") {
      setDialog({
        title: "Tuplet settings",
        description:
          "Choose the ratio for new entries. In Speedy Entry, Ctrl+3, Ctrl+5 or Ctrl+7 creates one group.",
        fields: [
          {
            name: "ratio",
            label: "Tuplet",
            value: String(entryDuration.tuplets[0]?.actual ?? 0),
            options: [
              { value: "0", label: "Straight" },
              { value: "3", label: "Triplet 3:2" },
              { value: "5", label: "Quintuplet 5:4" },
              { value: "7", label: "Septuplet 7:4" },
            ],
          },
        ],
        submit: "Apply",
        apply: (v) => {
          pendingTuplet.current = undefined;
          setEntryDuration((d) => ({
            ...d,
            tuplets: Number(v.ratio)
              ? [
                  {
                    actual: Number(v.ratio),
                    normal: Number(v.ratio) === 3 ? 2 : 4,
                  },
                ]
              : [],
          }));
        },
      });
      return;
    }
    if (action === "clefSettings") {
      setDialog({
        title: "Staff clef",
        description: "Sets the clef for this entire staff.",
        fields: [
          {
            name: "clef",
            label: staff.name,
            value: staff.clef,
            options: ["treble", "bass", "alto", "tenor", "percussion"].map(
              (c) => ({ value: c, label: c }),
            ),
          },
        ],
        submit: "Apply",
        apply: (v) =>
          commit((s) => {
            s.staves.find((st) => st.id === staff.id)!.clef =
              v.clef as typeof staff.clef;
          }),
      });
      return;
    }
    if (action === "measureProperties") {
      setDialog({
        title: "Measure attributes",
        fields: [
          {
            name: "start",
            label: "Start repeat",
            value: measure.repeatStart ? "yes" : "no",
            options: [
              { value: "no", label: "No" },
              { value: "yes", label: "Yes" },
            ],
          },
          {
            name: "end",
            label: "End repeat",
            value: measure.repeatEnd ? "yes" : "no",
            options: [
              { value: "no", label: "No" },
              { value: "yes", label: "Yes" },
            ],
          },
          {
            name: "ending",
            label: "Ending",
            value: measure.ending ?? 0,
            options: [
              { value: 0, label: "None" },
              { value: 1, label: "First" },
              { value: 2, label: "Second" },
            ],
          },
        ],
        submit: "Apply",
        apply: (v) =>
          commit((s) => {
            const m = s.measures[measureIndex];
            m.repeatStart = v.start === "yes";
            m.repeatEnd = v.end === "yes";
            m.ending = Number(v.ending) || undefined;
          }),
      });
      return;
    }
    if (
      ["new", "open", "save", "saveAs", "midi", "print", "importXml"].includes(
        action,
      )
    ) {
      void fileAction(action);
      return;
    }
    if (action === "undo") return history(true);
    if (action === "redo") return history(false);
    if (action === "copy" || action === "cut") {
      clipboard.current = copyRegion(score, activeRegion());
      if (action === "cut") commit((s) => clearRegion(s, activeRegion()));
      report(action === "copy" ? "Music copied." : "Music cut.");
      return;
    }
    if (action === "paste" || action === "pasteInsert") {
      if (!clipboard.current) {
        report("Copy some music first.");
        return;
      }
      let pasted: Region | undefined;
      const at = region
        ? { ...cursor, ...region.start, staffId: region.staffIds[0] }
        : cursor;
      if (
        commit((s) => {
          pasted = pasteRegion(
            s,
            clipboard.current!,
            at,
            action === "pasteInsert",
          );
        }) &&
        pasted
      ) {
        chooseRegion(pasted);
        report(
          action === "pasteInsert" ? "Copied music inserted." : "Music pasted.",
        );
      }
      return;
    }
    if (action === "clear") {
      if (commit((s) => clearRegion(s, activeRegion())))
        report("Selected music cleared. Measures retained.");
      return;
    }
    if (action === "deleteMeasures") {
      let destination = cursor.measureId;
      if (
        commit((s) => {
          destination = deleteMeasures(s, activeRegion());
        })
      ) {
        setRegion(undefined);
        setSelected(undefined);
        setCursor({ ...cursor, measureId: destination, offset: ZERO });
        report("Measures deleted. Undo restores them.");
      }
      return;
    }
    if (action === "selectAll") {
      chooseRegion(fullMeasures(score, 0, score.measures.length - 1));
      setMode("select");
      return;
    }
    if (action === "addMeasures" || action === "insertMeasures") {
      const at =
        action === "addMeasures"
          ? score.measures.length
          : score.measures.findIndex(
              (m) => m.id === activeRegion().start.measureId,
            );
      openNumberDialog(
        action === "addMeasures" ? "Add measures" : "Insert measures",
        action === "addMeasures"
          ? "Number to add at the end"
          : `Number to insert before measure ${at + 1}`,
        1,
        (n) =>
          commit((s) => {
            insertMeasures(s, at, n);
          }),
      );
      return;
    }
    if (action === "transpose") {
      const r = activeRegion();
      stop();
      setDialog({
        title: "Transpose music",
        description: regionDescription(score, r),
        fields: [
          {
            name: "semitones",
            label: "Semitones (12 = octave up, −12 = octave down)",
            value: 12,
            min: -48,
            max: 48,
          },
        ],
        submit: "Transpose",
        apply: (v) => commit((s) => transposeRegion(s, r, Number(v.semitones))),
      });
      return;
    }
    if (action === "repeat") {
      const r = activeRegion();
      openNumberDialog(
        "Repeat selected music",
        "Additional copies after the selection",
        1,
        (n) => commit((s) => repeatRegion(s, r, n)),
        100,
      );
      return;
    }
    if (action === "fitMeasures") {
      stop();
      setDialog({
        title: "Measures per system",
        description:
          "This is the maximum per line. Dense music uses fewer measures to keep notation readable.",
        fields: [
          {
            name: "count",
            label: "Measures per system (0 = automatic spacing)",
            value: viewOptions.measuresPerSystem,
            min: 0,
            max: 8,
          },
        ],
        submit: "Apply",
        apply: (v) => {
          setViewOptions({
            ...viewOptions,
            measuresPerSystem: Number(v.count),
          });
        },
      });
      return;
    }
    if (action === "pageLayout") {
      stop();
      setDialog({
        title: "Page layout",
        description:
          "Dense music may use fewer measures per system to prevent collisions.",
        fields: [
          {
            name: "spacing",
            label: "Staff spacing",
            value: viewOptions.staffSpacing,
            min: 72,
            max: 200,
          },
          {
            name: "measures",
            label: "Measures per system (0 = automatic)",
            value: viewOptions.measuresPerSystem,
            min: 0,
            max: 8,
          },
          {
            name: "arrangement",
            label: "Page arrangement",
            value: viewOptions.arrangement,
            options: [
              { value: "horizontal", label: "Side by side" },
              { value: "vertical", label: "Vertical" },
            ],
          },
        ],
        submit: "Apply",
        apply: (v) =>
          setViewOptions({
            ...viewOptions,
            staffSpacing: Number(v.spacing),
            measuresPerSystem: Number(v.measures),
            arrangement: v.arrangement as "horizontal" | "vertical",
          }),
      });
      return;
    }
    if (action === "goTo") {
      openNumberDialog(
        "Go to measure",
        "Measure",
        measureIndex + 1,
        (n) => {
          if (n < 1 || n > score.measures.length) return false;
          setCursor({
            ...cursor,
            measureId: score.measures[n - 1].id,
            offset: ZERO,
          });
          revealMeasure(n - 1);
        },
        score.measures.length,
      );
      return;
    }
    if (action === "selectRegion") {
      const r = activeRegion();
      stop();
      setDialog({
        title: "Select region",
        fields: [
          {
            name: "first",
            label: "From measure",
            value:
              score.measures.findIndex((m) => m.id === r.start.measureId) + 1,
            min: 1,
            max: score.measures.length,
          },
          {
            name: "last",
            label: "Through measure",
            value:
              score.measures.findIndex((m) => m.id === r.end.measureId) + 1,
            min: 1,
            max: score.measures.length,
          },
          {
            name: "top",
            label: "From staff",
            value: score.staves.findIndex((s) => s.id === r.staffIds[0]),
            options: score.staves.map((s, i) => ({ value: i, label: s.name })),
          },
          {
            name: "bottom",
            label: "Through staff",
            value: score.staves.findIndex((s) => s.id === r.staffIds.at(-1)),
            options: score.staves.map((s, i) => ({ value: i, label: s.name })),
          },
        ],
        submit: "Select",
        apply: (v) => {
          chooseRegion(
            fullMeasures(
              score,
              Number(v.first) - 1,
              Number(v.last) - 1,
              Number(v.top),
              Number(v.bottom),
            ),
          );
          setMode("select");
        },
      });
      return;
    }
    if (action === "document") {
      stop();
      setDialog({
        title: "Score information",
        fields: [
          { name: "title", label: "Title", value: score.title },
          { name: "composer", label: "Composer", value: score.composer },
        ],
        submit: "Apply",
        apply: (v) =>
          commit((s) => {
            s.title = v.title;
            s.composer = v.composer;
          }),
      });
      return;
    }
    if (action === "measureSettings") {
      const r = activeRegion(),
        first = score.measures.findIndex((m) => m.id === r.start.measureId),
        last = score.measures.findIndex((m) => m.id === r.end.measureId),
        m = score.measures[first];
      stop();
      setDialog({
        title: "Time and key signature",
        description:
          "Apply to the measure range below. Existing pitches stay the same when changing key.",
        fields: [
          {
            name: "first",
            label: "From measure",
            value: first + 1,
            min: 1,
            max: score.measures.length,
          },
          {
            name: "last",
            label: "Through measure",
            value: last + 1,
            min: 1,
            max: score.measures.length,
          },
          {
            name: "beats",
            label: "Beats per measure",
            value: m.beats,
            min: 1,
            max: 32,
          },
          {
            name: "unit",
            label: "Beat unit",
            value: m.beatType,
            options: [1, 2, 4, 8, 16, 32].map((n) => ({
              value: n,
              label: String(n),
            })),
          },
          {
            name: "key",
            label: "Key signature",
            value: m.key,
            options: keySignatures.map((k) => ({ value: k, label: k })),
          },
          {
            name: "rebar",
            label: "Existing music",
            value: "yes",
            options: [
              { value: "yes", label: "Rebar and tie across barlines" },
              { value: "no", label: "Keep measure positions (notes must fit)" },
            ],
          },
        ],
        submit: "Apply",
        apply: (v) =>
          commit((s) => {
            const a = Number(v.first) - 1,
              b = Number(v.last) - 1;
            if (a > b)
              throw new Error("The final measure must follow the first.");
            for (let i = a; i <= b; i++) s.measures[i].key = v.key;
            if (
              s.measures
                .slice(a, b + 1)
                .some(
                  (m) =>
                    m.beats !== Number(v.beats) ||
                    m.beatType !== Number(v.unit),
                )
            )
              changeMeter(
                s,
                a,
                b,
                Number(v.beats),
                Number(v.unit),
                v.rebar === "yes",
              );
          }),
      });
      return;
    }
    if (action === "page" || action === "scroll") {
      setViewOptions({ ...viewOptions, view: action });
      return;
    }
    if (action === "horizontal" || action === "vertical") {
      setViewOptions({ ...viewOptions, arrangement: action, view: "page" });
      return;
    }
    if (action === "toggleView") {
      setViewOptions({
        ...viewOptions,
        view: viewOptions.view === "page" ? "scroll" : "page",
      });
      return;
    }
    if (action === "zoomIn") return zoomTo(zoom * 1.2);
    if (action === "zoomOut") return zoomTo(zoom / 1.2);
    if (action === "zoom100") return zoomTo(1);
    if (action === "zoomOther") {
      openNumberDialog(
        "Zoom",
        "Percentage",
        Math.round(zoom * 100),
        (n) => {
          zoomTo(n / 100);
        },
        1000,
      );
      return;
    }
    if (action === "fitWidth") {
      setFitPage(false);
      setFitWidth(true);
      return;
    }
    if (action === "fitPage") {
      setFitWidth(false);
      setFitPage(true);
      return;
    }
    if (action === "concert") {
      setConcert(!concert);
      return;
    }
    if (action === "instruments") {
      setShowInstruments(!showInstruments);
      return;
    }
    if (action === "inspector") {
      setShowInspector(!showInspector);
      return;
    }
    if (action === "help") {
      stop();
      setHelp(true);
      return;
    }
    if (
      [
        "select",
        "staff",
        "measure",
        "key",
        "time",
        "clef",
        "write",
        "speedy",
        "hand",
        "zoom",
        "expression",
        "articulation",
        "crescendo",
        "diminuendo",
        "slur",
        "erase",
      ].includes(action)
    ) {
      setMode(action as typeof mode);
      if (action === "speedy") setSpeedyActive(true);
      if (action === "staff") setShowInstruments(true);
      setRegion(undefined);
      if (action === "expression" || action === "articulation") {
        setShowInspector(true);
        setPanel("note");
      }
    }
  };
  const pointer = (e: { clientX: number; clientY: number }) => {
    if (!layout || !host.current) return;
    const bounds = host.current.getBoundingClientRect();
    return hitTest(
      layout,
      (e.clientX - bounds.left) / zoom,
      (e.clientY - bounds.top) / zoom,
    );
  };
  const chooseEntry = (base: number, rest: boolean, reset = false) => {
    setEntryDuration((d) => ({
      ...d,
      base,
      ...(reset ? { dots: 0, tuplets: [] } : {}),
    }));
    setEntryRest(rest);
    if (reset) setEntryAccidental(undefined);
    pendingTuplet.current = undefined;
    setMode("write");
    setRegion(undefined);
  };
  const placementAt = (hit: Hit, d = entryDuration) =>
    entryPlacement(
      score,
      layout!,
      hit,
      d,
      cursor.voice,
      entryAccidental,
      concert,
    );
  const placeEntry = (
    p: EntryPlacement,
    d = entryDuration,
    rest = entryRest,
  ) => {
    if (held.current || latchedRef.current) return;
    setHover(undefined);
    const existing = p.existing;
    setEntryPitch(p.pitch);
    if (existing?.pitches.length && !rest) {
      const sameLine = existing.pitches.findIndex(
        (q) => q.step === p.pitch.step && q.octave === p.pitch.octave,
      );
      if (sameLine < 0 || entryAccidental !== undefined) {
        if (
          commit((s) => {
            const n = s.notes.find((n) => n.id === existing.id)!;
            if (sameLine < 0) n.pitches.push(p.pitch);
            else n.pitches[sameLine] = p.pitch;
            cleanLinks(s);
          })
        ) {
          setSelected(existing.id);
          setRegion(undefined);
          setCursor(p.at);
          report(
            sameLine < 0
              ? `Added ${pitchName(p.pitch)} to chord`
              : `Changed accidental on ${pitchName(p.pitch)}`,
          );
        }
        return;
      }
    }
    insert(
      rest ? [] : existing?.pitches.length ? existing.pitches : [p.pitch],
      p.at,
      d,
    );
  };
  const cancelEntryGesture = () => {
    gesture.current = undefined;
    setHover(undefined);
    setDragRect(undefined);
  };
  // Captured palette events can arrive from outside the score or even over a panel.
  const paletteHit = (e: { clientX: number; clientY: number }) => {
    const bounds = scrollHost.current?.getBoundingClientRect();
    if (
      !bounds ||
      e.clientX < bounds.left ||
      e.clientX >= bounds.right ||
      e.clientY < bounds.top ||
      e.clientY >= bounds.bottom
    )
      return;
    const top = document.elementFromPoint?.(e.clientX, e.clientY);
    if (top && !scrollHost.current?.contains(top)) return;
    return pointer(e);
  };
  const paletteDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    base: number,
    rest: boolean,
  ) => {
    if (e.button !== 0 || held.current || latchedRef.current) return;
    chooseEntry(base, rest);
    setHover(undefined);
    gesture.current = {
      kind: "palette",
      x: e.clientX,
      y: e.clientY,
      left: 0,
      top: 0,
      moved: false,
      duration: { ...entryDuration, base },
      rest,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const paletteMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (g?.kind !== "palette") return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.moved = true;
    if (g.moved) setHover(paletteHit(e));
  };
  const paletteUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    gesture.current = undefined;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    const hit = g?.kind === "palette" && g.moved ? paletteHit(e) : undefined;
    if (hit) {
      placeEntry(placementAt(hit, g!.duration), g!.duration, g!.rest);
      scrollHost.current?.focus();
    }
    setHover(undefined);
  };
  const selectHit = (hit: Hit, e: React.PointerEvent<HTMLDivElement>) => {
    if (held.current || latchedRef.current) return;
    const resolved = placementAt(hit);
    const nearby = resolved.existing;
    if (mode === "erase" && !resolved.onNotehead) return;
    if (
      nearby &&
      (mode === "speedy" ||
        mode === "erase" ||
        mode === "articulation" ||
        e.ctrlKey ||
        e.metaKey)
    ) {
      const existing = nearby;
      setSelected(existing.id);
      setCursor({
        staffId: existing.staffId,
        measureId: existing.measureId,
        offset: existing.offset,
        voice: existing.voice,
      });
      setPanel("note");
      setRegion(undefined);
      setEntryPitch(existing.pitches[0] ?? entryPitch);
      if (mode === "erase") {
        if (
          commit((s) => {
            removePitch(s, existing.id, resolved.pitchIndex);
            cleanLinks(s);
          })
        )
          report(
            existing.pitches.length > 1
              ? "Removed chord tone."
              : "Removed entry.",
          );
      }
      if (mode === "articulation") {
        commit((s) => {
          const n = s.notes.find((n) => n.id === existing.id)!;
          n.articulation =
            n.articulation === articulationValue ? "" : articulationValue;
        });
      }
      return;
    }
    const placement = placementAt(hit),
      at = placement.at;
    setCursor(at);
    setSelected(undefined);
    setEntryPitch({
      ...placement.pitch,
    });
    setRegion(undefined);
  };

  const pointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    selectionEdges.current = {};
    scrollHost.current?.focus();
    setContextMenu(undefined);
    if (held.current || latchedRef.current) return;
    const hit = pointer(e),
      element = scrollHost.current!;
    if (e.button === 2 && e.shiftKey) {
      zoomTo(e.ctrlKey || e.metaKey ? zoom / 1.25 : zoom * 1.25, {
        x: e.clientX,
        y: e.clientY,
      });
      suppressContext.current = true;
      return;
    }
    if (e.button === 1 || e.button === 2 || mode === "hand") {
      gesture.current = {
        kind: "pan",
        x: e.clientX,
        y: e.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
        moved: false,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (!hit) {
      if (layout && host.current) {
        const bounds = host.current.getBoundingClientRect(),
          x = (e.clientX - bounds.left) / zoom,
          y = (e.clientY - bounds.top) / zoom;
        const box = layout.measures.find(
          (m) => x >= m.x - 125 && x < m.x && y >= m.top && y <= m.bottom,
        );
        if (box) {
          const st = box.staves.reduce((a, b) =>
            Math.abs(y - a.lineBottom + 20) < Math.abs(y - b.lineBottom + 20)
              ? a
              : b,
          );
          const si = score.staves.findIndex((s) => s.id === st.id);
          const r = fullMeasures(score, 0, score.measures.length - 1, si, si);
          if (e.shiftKey && region) {
            r.staffIds = score.staves
              .slice(
                Math.min(
                  si,
                  score.staves.findIndex((s) => s.id === region.staffIds[0]),
                ),
                Math.max(
                  si,
                  score.staves.findIndex(
                    (s) => s.id === region.staffIds.at(-1),
                  ),
                ) + 1,
              )
              .map((s) => s.id);
          }
          chooseRegion(r);
          return;
        }
      }
      setRegion(undefined);
      setSelected(undefined);
      return;
    }
    if (mode === "zoom") {
      gesture.current = {
        kind: "zoom",
        x: e.clientX,
        y: e.clientY,
        left: 0,
        top: 0,
        hit,
        last: hit,
        moved: false,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (["crescendo", "diminuendo", "slur"].includes(mode)) {
      gesture.current = {
        kind: "shape",
        x: e.clientX,
        y: e.clientY,
        left: 0,
        top: 0,
        hit,
        last: hit,
        moved: false,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (mode === "speedy") setSpeedyActive(true);
    if (
      ["select", "staff", "measure", "key", "time", "clef"].includes(mode) &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      const inside =
        region &&
        region.staffIds.includes(hit.staffId) &&
        hit.time >= value(regionTimes(score, region).start) &&
        hit.time < value(regionTimes(score, region).end);
      gesture.current = {
        kind: inside && !e.shiftKey ? "copy" : "region",
        x: e.clientX,
        y: e.clientY,
        left: 0,
        top: 0,
        hit,
        last: hit,
        region,
        moved: false,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (e.shiftKey && region) chooseRegion(extendRegion(score, region, hit));
      else if (!inside) {
        const si = score.staves.findIndex((s) => s.id === hit.staffId);
        chooseRegion(
          fullMeasures(
            score,
            hit.measure.measureIndex,
            hit.measure.measureIndex,
            si,
            si,
          ),
        );
      }
      return;
    }
    if (mode === "expression") {
      selectHit(hit, e);
      setShowInspector(true);
      setPanel("note");
      return;
    }
    if (mode === "write" && !e.ctrlKey && !e.metaKey) {
      gesture.current = {
        kind: "entry",
        x: e.clientX,
        y: e.clientY,
        left: 0,
        top: 0,
        hit,
        last: hit,
        placement: placementAt(hit),
        moved: false,
      };
      setHover(hit);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    selectHit(hit, e);
    if ((mode === "write" && (e.ctrlKey || e.metaKey)) || mode === "speedy") {
      const closest = placementAt(hit).existing;
      if (closest) {
        gesture.current = {
          kind: "note",
          x: e.clientX,
          y: e.clientY,
          left: 0,
          top: 0,
          hit,
          last: hit,
          noteId: closest.id,
          moved: false,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
    }
  };
  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const hit = pointer(e);
    lastHit.current = hit;
    setHover(hit);
    if (held.current || latchedRef.current) {
      refreshAudition(hit);
      return;
    }
    const g = gesture.current;
    if (!g) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.moved = true;
    if (
      g.kind === "entry" &&
      hit &&
      g.hit &&
      (hit.pitch.step !== g.hit.pitch.step ||
        hit.pitch.octave !== g.hit.pitch.octave)
    )
      g.moved = true;
    if (g.kind === "pan") {
      if (scrollHost.current) {
        scrollHost.current.scrollLeft = g.left - (e.clientX - g.x);
        scrollHost.current.scrollTop = g.top - (e.clientY - g.y);
      }
      return;
    }
    if (!hit) return;
    g.last = hit;
    if (g.kind === "region" && g.moved && g.hit)
      chooseRegion(regionFromHits(score, g.hit, hit, e.shiftKey));
    if (g.kind === "zoom" && g.moved && host.current) {
      const b = host.current.getBoundingClientRect();
      setDragRect({
        left: (Math.min(g.x, e.clientX) - b.left) / zoom,
        top: (Math.min(g.y, e.clientY) - b.top) / zoom,
        width: Math.abs(e.clientX - g.x) / zoom,
        height: Math.abs(e.clientY - g.y) / zoom,
      });
    }
    if (g.kind === "shape" && g.hit)
      chooseRegion(regionFromHits(score, g.hit, hit));
    if (g.moved && scrollHost.current) {
      const b = scrollHost.current.getBoundingClientRect();
      if (e.clientX > b.right - 35) scrollHost.current.scrollLeft += 18;
      if (e.clientX < b.left + 35) scrollHost.current.scrollLeft -= 18;
      if (e.clientY > b.bottom - 35) scrollHost.current.scrollTop += 18;
      if (e.clientY < b.top + 35) scrollHost.current.scrollTop -= 18;
    }
  };
  const pointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = undefined;
    setDragRect(undefined);
    if (!g) return;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.kind === "pan") {
      suppressContext.current = g.moved;
      return;
    }
    if (g.kind === "entry") {
      const surface = document.elementFromPoint?.(e.clientX, e.clientY);
      if (surface && !host.current?.parentElement?.contains(surface)) {
        setHover(undefined);
        return;
      }
      const hit = pointer(e);
      if (!hit || held.current || latchedRef.current) return;
      const original = g.placement!;
      const existing = original.existing;
      const display = existing?.pitches[original.pitchIndex];
      const sameHead =
        display &&
        display.step === original.pitch.step &&
        display.octave === original.pitch.octave;
      if (g.moved && sameHead && !entryRest) {
        if (
          hit.staffId !== original.at.staffId ||
          hit.measure.measureId !== original.at.measureId
        )
          return;
        const pitch = placementAt(hit).pitch;
        if (
          existing.pitches.some(
            (p, i) =>
              i !== original.pitchIndex && midiPitch(p) === midiPitch(pitch),
          )
        ) {
          report("That pitch is already in the chord.");
          return;
        }
        if (
          commit((s) => {
            s.notes.find((n) => n.id === existing.id)!.pitches[
              original.pitchIndex
            ] = pitch;
            cleanLinks(s);
          })
        ) {
          setSelected(existing.id);
          setCursor(original.at);
          setEntryPitch(pitch);
          setRegion(undefined);
          setHover(undefined);
          report(`Moved note to ${pitchName(pitch)}`);
        }
      } else placeEntry(placementAt(hit));
      return;
    }
    const end = g.last ?? g.hit;
    if (!end) return;
    if (g.kind === "zoom") {
      if (g.moved && scrollHost.current) {
        const factor = Math.min(
          (scrollHost.current.clientWidth - 80) /
            Math.max(20, Math.abs(e.clientX - g.x)),
          (scrollHost.current.clientHeight - 80) /
            Math.max(20, Math.abs(e.clientY - g.y)),
        );
        zoomTo(zoom * factor, {
          x: (g.x + e.clientX) / 2,
          y: (g.y + e.clientY) / 2,
        });
      } else
        zoomTo(e.ctrlKey ? zoom / 1.25 : zoom * 1.25, {
          x: e.clientX,
          y: e.clientY,
        });
      return;
    }
    if (g.kind === "copy" && g.moved && g.region) {
      const clip = copyRegion(score, g.region);
      let pasted: Region | undefined;
      const at = {
        staffId: end.staffId,
        measureId: end.measure.measureId,
        offset: isStack(score, g.region) ? ZERO : end.offset,
        voice: cursor.voice,
      };
      // Dragging aligns to a beat; full-measure clips align to barlines.
      if (g.region.start.offset.n === 0) at.offset = ZERO;
      else at.offset = fromDecimal(Math.floor(value(end.offset)));
      if (
        commit((s) => {
          pasted = pasteRegion(s, clip, at, e.altKey);
        }) &&
        pasted
      )
        chooseRegion(pasted);
      return;
    }
    if (g.kind === "note" && g.moved && g.noteId) {
      commit((s) => {
        const n = s.notes.find((n) => n.id === g.noteId);
        if (n?.pitches.length) {
          const difference =
            (end.pitch.octave - g.hit!.pitch.octave) * 7 +
            steps.indexOf(end.pitch.step) -
            steps.indexOf(g.hit!.pitch.step);
          n.pitches = n.pitches.map((p) => moveDiatonic(p, difference));
        }
      });
      return;
    }
    if (g.kind === "shape" && g.hit) {
      const r = regionFromHits(score, g.hit, end);
      chooseRegion(r);
      if (mode === "slur") {
        const entries = regionNotes(score, r)
          .filter(
            (n) =>
              n.staffId === g.hit!.staffId &&
              n.voice === cursor.voice &&
              n.pitches.length,
          )
          .sort((a, b) =>
            compare(absolute(index.starts, a), absolute(index.starts, b)),
          );
        if (entries.length > 1)
          commit((s) => {
            s.notes.find((n) => n.id === entries[0].id)!.slurTo =
              entries.at(-1)!.id;
          });
      } else
        commit((s) =>
          s.marks.push({
            id: id(),
            kind: "hairpin",
            staffId: g.hit!.staffId,
            ...r.start,
            endMeasureId: r.end.measureId,
            endOffset: r.end.offset,
            text: mode === "crescendo" ? "cresc." : "dim.",
            amount: mode === "crescendo" ? 60 : 100,
            target: mode === "crescendo" ? 100 : 60,
          }),
        );
    }
  };
  const doubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (held.current || latchedRef.current) return;
    const hit = pointer(e);
    if (!hit) return;
    if (mode === "key" || mode === "time") {
      command("measureSettings");
      return;
    }
    if (mode === "measure") {
      command("measureProperties");
      return;
    }
    if (mode === "clef") {
      command("clefSettings");
      return;
    }
    if (mode === "staff") {
      setShowInspector(true);
      setPanel("score");
      return;
    }
    if (mode === "select") {
      const r =
        region ??
        fullMeasures(
          score,
          hit.measure.measureIndex,
          hit.measure.measureIndex,
          score.staves.findIndex((s) => s.id === hit.staffId),
          score.staves.findIndex((s) => s.id === hit.staffId),
        );
      const a = score.measures.findIndex((m) => m.id === r.start.measureId),
        b = score.measures.findIndex((m) => m.id === r.end.measureId);
      const complete =
        r.start.offset.n === 0 &&
        compare(r.end.offset, measureBeats(score.measures[b])) === 0;
      chooseRegion(
        fullMeasures(
          score,
          a,
          b,
          complete ? 0 : score.staves.findIndex((s) => s.id === r.staffIds[0]),
          complete
            ? score.staves.length - 1
            : score.staves.findIndex((s) => s.id === r.staffIds.at(-1)),
        ),
      );
    }
  };

  useEffect(() => {
    void document.fonts.ready.then(() => setFonts(true));
    void recoveryRead().then(setRecovery);
    audio.onChange = () => setAudioTick((n) => n + 1);
    audio.onEnd = () => {
      held.current = false;
      latchedRef.current = false;
      pauseOffset.current = undefined;
      setPaused(false);
      setElapsed(0);
      setPlaying(false);
      setPlayhead(undefined);
      setLatched(false);
      setAuditioning(false);
    };
    return () => {
      playRequest.current++;
      audio.dispose();
    };
  }, []);
  useEffect(() => {
    window.desktop?.dirty(dirty);
    if (!dirty) return;
    const timer = setTimeout(() => {
      void recoveryWrite(score).catch((e) =>
        report(`Recovery save failed: ${e}`, true),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [score, dirty]);
  useLayoutEffect(() => {
    if (!host.current || !fonts) return;
    try {
      const next = renderScore(
        host.current,
        score,
        selected,
        concert,
        viewOptions,
      );
      setLayout(next);
      if (lastHit.current) {
        const old = lastHit.current;
        const m = next.measures.find(
          (m) => m.measureId === old.measure.measureId,
        );
        if (m) lastHit.current = { ...old, measure: m };
        else lastHit.current = undefined;
      }
      refreshAudition();
    } catch (e) {
      report(`Engraving: ${e}`, true);
    }
  }, [score, selected, concert, fonts, viewOptions]);
  useLayoutEffect(() => {
    const element = scrollHost.current;
    if (!element || (!fitWidth && !fitPage)) return;
    const resize = () => {
      const style = getComputedStyle(element);
      const available =
        element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        4;
      const page = layout?.pages?.[0];
      const width =
          viewOptions.view === "scroll" ? 1000 : (page?.width ?? 1000),
        height = page?.height ?? 1414;
      setZoom(
        Math.max(
          0.1,
          Math.min(
            4,
            fitPage
              ? Math.min(
                  available / width,
                  (element.clientHeight - 48) / height,
                )
              : available / width,
          ),
        ),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [fitWidth, fitPage, layout, showInspector, showInstruments]);
  useEffect(() => {
    const element = scrollHost.current;
    if (!element || !layout || !element.clientWidth || auditioning) return;
    const m =
      playing && playhead !== undefined
        ? layout.measures.find(
            (m) => playhead >= m.start && playhead < m.start + m.length,
          )
        : ["write", "speedy"].includes(mode)
          ? layout.measures.find((m) => m.measureId === cursor.measureId)
          : undefined;
    if (!m) return;
    const st = m.staves.find((s) => s.id === cursor.staffId) ?? m.staves[0];
    const x =
        xAtTime(
          m,
          playing && playhead !== undefined
            ? playhead - m.start
            : value(cursor.offset),
        ) *
          zoom +
        26,
      y = st.lineBottom * zoom + 26;
    if (
      x < element.scrollLeft + 45 ||
      x > element.scrollLeft + element.clientWidth - 45
    )
      element.scrollLeft = Math.max(0, x - element.clientWidth * 0.25);
    if (
      y < element.scrollTop + 55 ||
      y > element.scrollTop + element.clientHeight - 60
    )
      element.scrollTop = Math.max(0, y - element.clientHeight * 0.4);
  }, [cursor, layout, mode, playing, playhead, zoom, auditioning]);
  useEffect(() => {
    const element = scrollHost.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomTo(zoom * Math.exp(-e.deltaY * 0.002), {
          x: e.clientX,
          y: e.clientY,
        });
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom]);
  useEffect(() => {
    latchedRef.current = latched;
    if (latched) {
      playRequest.current++;
      audio.stop();
      setPlaying(false);
      setPlayhead(undefined);
      cancelAnimationFrame(animation.current);
      setAuditioning(true);
      void audio
        .enable()
        .then(() => refreshAudition())
        .catch((e) => report(String(e), true));
    } else if (!held.current) {
      setAuditioning(false);
      audio.stop();
    }
  }, [latched]);
  useEffect(() => {
    refreshAudition();
  }, [scope, pedal, retriggerAll]);
  useEffect(() => {
    const handleCommand = command;
    const off = window.desktop?.onCommand((command) => {
      if (
        ["copy", "cut", "paste", "undo", "redo", "selectAll"].includes(
          command,
        ) &&
        editable(document.activeElement)
      ) {
        void window.desktop?.editText(command);
        return;
      }
      if (dialog || help) return;
      handleCommand(command);
    });
    return off;
  }, [
    score,
    cursor,
    dirty,
    selected,
    region,
    viewOptions,
    zoom,
    showInspector,
    showInstruments,
    mode,
    playing,
    paused,
    entryDuration,
    entryPitch,
    palettes,
    dialog,
    help,
  ]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        if (
          !held.current &&
          !latchedRef.current &&
          !playing &&
          !dialog &&
          !help
        )
          closePanel();
        cancelEntryGesture();
        stop();
        setHelp(false);
        setDialog(undefined);
        setContextMenu(undefined);
        setMode("select");
        return;
      }
      if (editable(e.target) || e.isComposing || dialog || help) return;
      if (mode === "write" && e.code !== "Space") setHover(undefined);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shift.current = true;
        refreshAudition();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat || held.current || help) return;
        gesture.current = undefined;
        lastAudition.current = undefined;
        held.current = true;
        pauseOffset.current = undefined;
        setPaused(false);
        setElapsed(0);
        playRequest.current++;
        controlGesture.current = e.ctrlKey;
        shift.current = e.shiftKey;
        audio.stop();
        setPlaying(false);
        setPlayhead(undefined);
        setAuditioning(true);
        void audio
          .enable()
          .then(() => {
            if (held.current || latchedRef.current) refreshAudition();
          })
          .catch((err) => report(String(err), true));
        return;
      }
      if (
        (held.current || latchedRef.current) &&
        ["ArrowLeft", "ArrowRight"].includes(e.code)
      ) {
        e.preventDefault();
        const hit = lastHit.current;
        if (!hit) return;
        const boundaries = index.boundaries;
        const t =
          e.code === "ArrowRight"
            ? boundaries.find((t) => t > hit.time + 1e-6)
            : [...boundaries].reverse().find((t) => t < hit.time - 1e-6);
        if (t === undefined || !layout) return;
        const box = layout.measures.find(
          (m) => t >= m.start && t < m.start + m.length,
        );
        if (box) {
          const next = {
            ...hit,
            measure: box,
            time: t,
            offset: fromDecimal(t - box.start),
          };
          lastHit.current = next;
          setHover(next);
          refreshAudition(next);
        }
        return;
      }
      if ((held.current || latchedRef.current) && e.code === "KeyR") {
        e.preventDefault();
        refreshAudition(undefined, true);
        return;
      }
      if (held.current || latchedRef.current) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        region &&
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(e.code)
      ) {
        e.preventDefault();
        const axis = ["ArrowUp", "ArrowDown"].includes(e.code)
          ? "vertical"
          : "horizontal";
        selectionEdges.current[axis] ??= ["ArrowLeft", "ArrowUp"].includes(
          e.code,
        )
          ? "start"
          : "end";
        chooseRegion(
          moveRegionEdge(
            score,
            region,
            e.code,
            e.ctrlKey || e.metaKey,
            selectionEdges.current[axis],
          ),
        );
        return;
      }
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
      const durationKeys: Record<string, number> = {
        "1": 64,
        "2": 32,
        "3": 16,
        "4": 8,
        "5": 4,
        "6": 2,
        "7": 1,
      };
      if (
        (e.ctrlKey || e.metaKey) &&
        ["3", "5", "7"].includes(digit ?? "") &&
        !e.shiftKey &&
        (mode === "write" || mode === "speedy")
      ) {
        e.preventDefault();
        const group = { actual: Number(digit), normal: digit === "3" ? 2 : 4 };
        pendingTuplet.current = mode === "speedy" ? { ...group } : undefined;
        setEntryDuration((d) => ({
          ...d,
          tuplets: mode === "speedy" || !d.tuplets.length ? [group] : [],
        }));
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        digit &&
        durationKeys[digit] &&
        mode === "speedy"
      ) {
        e.preventDefault();
        insert([], cursor, {
          ...entryDuration,
          base: durationKeys[digit],
          dots: 0,
        });
        return;
      }
      if (
        ((mode === "speedy" && e.shiftKey) ||
          (mode === "write" && (e.ctrlKey || e.metaKey))) &&
        ["ArrowUp", "ArrowDown"].includes(e.code)
      ) {
        e.preventDefault();
        const si = Math.max(
          0,
          Math.min(
            score.staves.length - 1,
            score.staves.indexOf(staff) + (e.code === "ArrowDown" ? 1 : -1),
          ),
        );
        setCursor({ ...cursor, staffId: score.staves[si].id });
        setSelected(undefined);
        return;
      }
      if (
        mode === "speedy" &&
        (e.ctrlKey || e.metaKey) &&
        ["ArrowLeft", "ArrowRight"].includes(e.code)
      ) {
        e.preventDefault();
        const entries = score.notes
          .filter(
            (n) =>
              n.staffId === cursor.staffId &&
              n.measureId === cursor.measureId &&
              n.voice === cursor.voice,
          )
          .sort((a, b) => compare(a.offset, b.offset));
        const n = e.code === "ArrowLeft" ? entries[0] : entries.at(-1);
        setCursor({
          ...cursor,
          offset: n
            ? e.code === "ArrowLeft"
              ? n.offset
              : add(n.offset, beats(n.duration))
            : ZERO,
        });
        setSelected(e.code === "ArrowLeft" ? n?.id : undefined);
        return;
      }
      if (
        mode === "speedy" &&
        e.shiftKey &&
        ["ArrowLeft", "ArrowRight"].includes(e.code)
      ) {
        e.preventDefault();
        const mi = Math.max(
          0,
          Math.min(
            score.measures.length - 1,
            measureIndex + (e.code === "ArrowRight" ? 1 : -1),
          ),
        );
        setCursor({
          ...cursor,
          measureId: score.measures[mi].id,
          offset: ZERO,
        });
        setSelected(undefined);
        revealMeasure(mi);
        return;
      }
      if (mode === "speedy" && !speedyActive && digit !== "0") return;
      if (e.ctrlKey || e.metaKey) {
        if (["PageUp", "PageDown"].includes(e.code)) {
          e.preventDefault();
          if (viewOptions.view === "page")
            goPage(visiblePage + (e.code === "PageDown" ? 1 : -1));
          else if (scrollHost.current)
            scrollHost.current.scrollLeft +=
              scrollHost.current.clientWidth * (e.code === "PageDown" ? 1 : -1);
          return;
        }
        if (e.code === "KeyT" && mode === "speedy") {
          e.preventDefault();
          command("tiePrevious");
          return;
        }
        const actions: Record<string, string> = {
          KeyZ: e.shiftKey ? "redo" : "undo",
          KeyY: "redo",
          KeyS: e.shiftKey ? "saveAs" : "save",
          KeyO: "open",
          KeyN: "new",
          KeyP: "print",
          KeyE: "toggleView",
          KeyC: "copy",
          KeyX: "cut",
          KeyV: e.altKey ? "repeat" : "paste",
          KeyI: "pasteInsert",
          KeyA: e.shiftKey ? "select" : "selectAll",
          KeyG: "goTo",
          KeyM: "fitMeasures",
          Equal: "zoomIn",
          NumpadAdd: "zoomIn",
          Minus: "zoomOut",
          NumpadSubtract: "zoomOut",
          BracketRight: "fitWidth",
          BracketLeft: "fitPage",
          Digit1: "zoom100",
          Digit0: "zoomOther",
        };
        if (actions[e.code]) {
          e.preventDefault();
          command(actions[e.code]);
        }
        if (e.code === "Enter") {
          e.preventDefault();
          void play(e.shiftKey);
        }
        if (e.code === "Home" || e.code === "End") {
          e.preventDefault();
          revealMeasure(e.code === "Home" ? 0 : score.measures.length - 1);
        }
        return;
      }
      if (e.code === "Enter") {
        e.preventDefault();
        if (mode === "write")
          insert(
            e.shiftKey || e.altKey || entryRest
              ? []
              : [{ ...entryPitch, alter: entryAccidental ?? entryPitch.alter }],
          );
        else if (mode === "speedy") {
          const n = score.notes.find(
            (n) =>
              n.staffId === cursor.staffId &&
              n.measureId === cursor.measureId &&
              n.voice === cursor.voice &&
              compare(n.offset, cursor.offset) === 0,
          );
          if (n)
            commit((s) => {
              const x = s.notes.find((x) => x.id === n.id)!;
              if (
                !x.pitches.some((p) => midiPitch(p) === midiPitch(entryPitch))
              )
                x.pitches.push(entryPitch);
            });
          else insert([entryPitch]);
        } else void play();
        return;
      }
      if (e.code === "F1" || e.key === "?") {
        e.preventDefault();
        stop();
        setHelp(true);
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        if (mode === "speedy") {
          const current = score.notes.find(
            (n) =>
              n.staffId === cursor.staffId &&
              n.measureId === cursor.measureId &&
              n.voice === cursor.voice &&
              compare(n.offset, cursor.offset) === 0,
          );
          if (e.code === "Delete") {
            if (current) {
              commit((s) => {
                s.notes = s.notes.filter((n) => n.id !== current.id);
                cleanLinks(s);
              });
              setSelected(undefined);
            }
            return;
          }
          if (current?.pitches.length)
            commit((s) => {
              const n = s.notes.find((n) => n.id === current.id)!;
              const at = n.pitches.findIndex(
                (p) =>
                  p.step === entryPitch.step && p.octave === entryPitch.octave,
              );
              if (at >= 0) {
                n.pitches.splice(at, 1);
                cleanLinks(s);
              }
            });
          return;
        }
        if (region && e.code === "Delete" && isStack(score, region))
          command("deleteMeasures");
        else remove();
        return;
      }
      if (
        ["PageUp", "PageDown", "Home", "End"].includes(e.code) &&
        scrollHost.current
      ) {
        e.preventDefault();
        const el = scrollHost.current;
        if (e.code === "PageUp" || e.code === "PageDown")
          el.scrollTop += el.clientHeight * (e.code === "PageDown" ? 1 : -1);
        else if (viewOptions.view === "scroll")
          revealMeasure(e.code === "Home" ? 0 : score.measures.length - 1);
        else el.scrollLeft += el.clientWidth * (e.code === "End" ? 1 : -1);
        return;
      }
      if (e.code === "KeyN") {
        e.preventDefault();
        setMode((m) => (m === "write" ? "select" : "write"));
        return;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        if (mode === "write" && note)
          editNote((n) => {
            n.pitches = n.pitches.length ? [] : [entryPitch];
          });
        else insert([]);
        return;
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        command(e.shiftKey ? "tiePrevious" : "tie");
        return;
      }
      if (e.code === "Period") {
        e.preventDefault();
        if (note && (mode === "speedy" || mode === "write")) {
          const dotted = {
            ...note.duration,
            dots: (note.duration.dots + 1) % 3,
          };
          if (
            commit((s) => {
              const created = enterNote(
                s,
                {
                  staffId: note.staffId,
                  measureId: note.measureId,
                  offset: note.offset,
                  voice: note.voice,
                },
                dotted,
                note.pitches,
              );
              setSelected(created[0].id);
            })
          ) {
            setEntryDuration(dotted);
            if (
              mode === "speedy" &&
              pendingTuplet.current?.remaining !== undefined &&
              note.duration.tuplets.length
            ) {
              pendingTuplet.current.remaining -=
                value(beats(dotted)) - value(beats(note.duration));
              if (pendingTuplet.current.remaining < 1e-8) {
                pendingTuplet.current = undefined;
                setEntryDuration({ ...dotted, tuplets: [] });
              }
            }
            setCursor(
              nextCursor(
                score,
                {
                  staffId: note.staffId,
                  measureId: note.measureId,
                  offset: note.offset,
                  voice: note.voice,
                },
                beats(dotted),
              ),
            );
          }
        } else setEntryDuration((d) => ({ ...d, dots: (d.dots + 1) % 3 }));
        return;
      }
      if (digit === "9" && mode === "write") {
        e.preventDefault();
        setEntryDuration((d) => ({
          ...d,
          tuplets: d.tuplets.length ? [] : [{ actual: 3, normal: 2 }],
        }));
        return;
      }
      if (digit === "0") {
        e.preventDefault();
        if (mode === "speedy") {
          setSpeedyActive(!speedyActive);
          return;
        }
        insert([]);
        return;
      }
      if (
        e.altKey &&
        e.shiftKey &&
        digit &&
        Number(digit) >= 1 &&
        Number(digit) <= 4
      ) {
        e.preventDefault();
        setCursor({ ...cursor, voice: Number(digit) - 1 });
        setSelected(undefined);
        return;
      }
      if (digit && durationKeys[digit]) {
        e.preventDefault();
        const d = {
          ...entryDuration,
          base: durationKeys[digit],
          dots: mode === "speedy" ? 0 : entryDuration.dots,
        };
        if (e.altKey && note) {
          commit((s) => {
            const created = enterNote(
              s,
              {
                staffId: note.staffId,
                measureId: note.measureId,
                offset: note.offset,
                voice: note.voice,
              },
              d,
              note.pitches,
            );
            setSelected(created[0].id);
          });
        } else if (mode === "speedy") {
          const n = score.notes.find(
            (n) =>
              n.staffId === cursor.staffId &&
              n.measureId === cursor.measureId &&
              n.voice === cursor.voice &&
              compare(n.offset, cursor.offset) === 0,
          );
          insert(n?.pitches ?? [entryPitch], cursor, d);
        } else setEntryDuration(d);
        return;
      }
      if (e.code === "Quote" && e.shiftKey) {
        e.preventDefault();
        setCursor({ ...cursor, voice: (cursor.voice + 1) % 4 });
        setSelected(undefined);
        return;
      }
      if (e.code === "BracketLeft" || e.code === "BracketRight") {
        e.preventDefault();
        const mi = Math.max(
          0,
          Math.min(
            score.measures.length - 1,
            measureIndex + (e.code === "BracketRight" ? 1 : -1),
          ),
        );
        setCursor({
          ...cursor,
          measureId: score.measures[mi].id,
          offset: ZERO,
        });
        setSelected(undefined);
        revealMeasure(mi);
        return;
      }
      if (
        (e.code === "Equal" ||
          e.code === "Minus" ||
          e.code === "NumpadAdd" ||
          e.code === "NumpadSubtract") &&
        note
      ) {
        e.preventDefault();
        editNote((n) => {
          n.pitches = n.pitches.map((p) => ({
            ...p,
            alter: Math.max(
              -2,
              Math.min(
                2,
                p.alter + (["Equal", "NumpadAdd"].includes(e.code) ? 1 : -1),
              ),
            ),
          }));
        });
        return;
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        const dir = e.code === "ArrowRight" ? 1 : -1;
        if (region && mode === "select") {
          const mi = Math.max(
              0,
              Math.min(score.measures.length - 1, measureIndex + dir),
            ),
            si = score.staves.indexOf(staff);
          chooseRegion(fullMeasures(score, mi, mi, si, si));
          revealMeasure(mi);
          return;
        }
        if (mode === "speedy") {
          const entries = score.notes
            .filter(
              (n) => n.staffId === cursor.staffId && n.voice === cursor.voice,
            )
            .sort((a, b) =>
              compare(absolute(index.starts, a), absolute(index.starts, b)),
            );
          const t = absolute(index.starts, cursor);
          const next =
            dir > 0
              ? entries.find((n) => compare(absolute(index.starts, n), t) > 0)
              : [...entries]
                  .reverse()
                  .find((n) => compare(absolute(index.starts, n), t) < 0);
          if (next) {
            setCursor({
              ...cursor,
              measureId: next.measureId,
              offset: next.offset,
            });
            setSelected(next.id);
            setEntryPitch(next.pitches[0] ?? entryPitch);
            return;
          }
        }
        if (dir > 0) setCursor(nextCursor(score, cursor, beats(entryDuration)));
        else {
          let t = sub(absolute(index.starts, cursor), beats(entryDuration));
          if (compare(t, ZERO) < 0) t = ZERO;
          const m = [...score.measures]
            .reverse()
            .find((m) => compare(index.starts.get(m.id)!, t) <= 0);
          if (m)
            setCursor({
              ...cursor,
              measureId: m.id,
              offset: sub(t, index.starts.get(m.id)!),
            });
        }
        setSelected(undefined);
        return;
      }
      if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        e.preventDefault();
        if (mode === "speedy" || (!note && mode === "write")) {
          setEntryPitch((p) =>
            e.shiftKey
              ? { ...p, octave: p.octave + (e.code === "ArrowUp" ? 1 : -1) }
              : moveDiatonic(p, e.code === "ArrowUp" ? 1 : -1),
          );
          return;
        }
        if (note)
          editNote((n) => {
            n.pitches = n.pitches.map((p) =>
              e.shiftKey
                ? { ...p, octave: p.octave + (e.code === "ArrowUp" ? 1 : -1) }
                : moveDiatonic(p, e.code === "ArrowUp" ? 1 : -1),
            );
          });
        return;
      }
      if (/^[a-g]$/i.test(e.key)) {
        e.preventDefault();
        const step = e.key.toUpperCase() as Step;
        if (mode === "select") setMode("write");
        if (mode === "speedy") {
          setEntryPitch((p) => ({
            ...p,
            step,
            alter: keyAlter(step, measure.key),
          }));
          return;
        }
        setRegion(undefined);
        if (e.shiftKey && note) {
          editNote((n) => {
            const previous = n.pitches.at(-1) ?? {
              step: "C" as Step,
              octave: 4,
              alter: 0,
            };
            let octave = previous.octave;
            if (steps.indexOf(step) <= steps.indexOf(previous.step)) octave++;
            n.pitches.push({
              step,
              octave,
              alter: keyAlter(step, measure.key),
            });
          });
          return;
        }
        const pitch = {
          step,
          octave:
            lastHit.current?.staffId === cursor.staffId
              ? lastHit.current.pitch.octave
              : entryPitch.octave,
          alter: keyAlter(step, measure.key),
        };
        setEntryPitch(pitch);
        insert(
          entryRest
            ? []
            : [{ ...pitch, alter: entryAccidental ?? pitch.alter }],
        );
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shift.current = e.shiftKey;
        if (!e.shiftKey) selectionEdges.current = {};
        refreshAudition();
      }
      if (
        e.code === "Space" ||
        ((e.code === "ControlLeft" || e.code === "ControlRight") &&
          controlGesture.current &&
          !e.ctrlKey)
      ) {
        held.current = false;
        lastAudition.current = undefined;
        controlGesture.current = false;
        if (!latchedRef.current) {
          setAuditioning(false);
          audio.stop();
        } else refreshAudition();
      }
    };
    const blur = () => {
      stop();
      cancelEntryGesture();
    };
    const hidden = () => {
      if (document.hidden) {
        stop();
        cancelEntryGesture();
      }
    };
    const focus = (e: FocusEvent) => {
      if (editable(e.target) && (held.current || latchedRef.current)) stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("focusin", focus);
    };
  }, [
    score,
    cursor,
    selected,
    entryDuration,
    visiblePage,
    entryRest,
    entryAccidental,
    speedyActive,
    paused,
    palettes,
    scope,
    pedal,
    layout,
    playing,
    help,
    retriggerAll,
    region,
    dialog,
    mode,
    viewOptions,
    zoom,
    entryPitch,
    showInspector,
    showInstruments,
  ]);

  const auditionVoices =
    hover && auditioning
      ? index.at(hover.time, {
          mode: shift.current ? "staff" : scope,
          staffId: hover.staffId,
          pedal,
        })
      : [];
  const cursorBox = layout?.measures.find(
      (m) => m.measureId === cursor.measureId,
    ),
    cursorStaff = cursorBox?.staves.find((s) => s.id === cursor.staffId);
  const previewPitch =
    concert && instrument.transpose
      ? pitchFromMidi(midiPitch(entryPitch) + instrument.transpose)
      : entryPitch;
  const entryPreview =
    mode === "write" && !auditioning && !playing && !dialog && !help && layout
      ? hover
        ? placementAt(hover)
        : cursorBox && cursorStaff
          ? {
              at: cursor,
              pitch: entryPitch,
              displayPitch: previewPitch,
              x: xAtTime(cursorBox, value(cursor.offset)),
              y: pitchY(previewPitch, cursorStaff.clef, cursorStaff.lineBottom),
              bottom: cursorStaff.lineBottom,
              pitchIndex: 0,
            }
          : undefined
      : undefined;
  const activePosition = playing
    ? playhead
    : auditioning
      ? hover?.time
      : undefined;
  const activeBox =
    activePosition === undefined
      ? undefined
      : layout?.measures.find(
          (m) =>
            activePosition >= m.start && activePosition < m.start + m.length,
        );
  const goPage = (number: number) => {
    const page = layout?.pages?.[number - 1],
      scroller = scrollHost.current;
    if (!page || !scroller) return;
    scroller.scrollLeft = page.x * zoom;
    scroller.scrollTop = page.y * zoom;
    setVisiblePage(number);
  };
  const currentMarks = score.marks.filter(
    (m) => m.measureId === measure.id && (!m.staffId || m.staffId === staff.id),
  );
  return (
    <div className="app">
      <header className="app-header">
        <MenuBar
          command={command}
          mode={mode}
          checked={{
            ...palettes,
            [mode]: true,
            page: viewOptions.view === "page",
            scroll: viewOptions.view === "scroll",
            horizontal: viewOptions.arrangement === "horizontal",
            vertical: viewOptions.arrangement === "vertical",
            concert,
            instruments: showInstruments,
            inspector: showInspector,
            speedyFrame: speedyActive,
          }}
          disabled={{
            undo: !undo.current.length,
            redo: !redo.current.length,
            paste: !clipboard.current,
            pasteInsert: !clipboard.current,
            pause: !playing && !paused,
          }}
        />
        <button
          className="document-name"
          onClick={() => command("document")}
          title="Edit title and composer"
        >
          {score.title}
          {dirty && (
            <span className="unsaved-dot" aria-label="Unsaved changes">
              •
            </span>
          )}
        </button>
        <div className="brand">Unicaria</div>
      </header>
      {palettes.mainPalette && (
        <MainPalette
          mode={mode}
          command={command}
          articulation={articulationValue}
          setArticulation={(a) => setArticulationValue(a as Articulation)}
        />
      )}
      {palettes.playbackControls && (
        <PlaybackControls
          playing={playing}
          paused={paused}
          counter={counterAt(
            score,
            playhead ?? value(absolute(index.starts, cursor)),
          )}
          elapsed={elapsed}
          tempo={score.tempo}
          command={command}
          seek={seekCounter}
          setTempo={(n) =>
            commit((s) => {
              s.tempo = n;
            })
          }
          audioState={audio.state}
          master={master}
          setMaster={(n) => {
            setMaster(n);
            audio.volume(n);
          }}
        />
      )}
      <div
        className="workspace-bar"
        role="toolbar"
        aria-label="Workspace controls"
      >
        <div className="entry-hint">
          {mode === "write" ? (
            <>
              <strong>Simple Entry</strong>
              <span>
                Click the staff to add · drag a note to move · Ctrl-click to
                select
              </span>
            </>
          ) : mode === "erase" ? (
            <>
              <strong>Eraser</strong>
              <span>Click a notehead to remove it · Ctrl+Z to undo</span>
            </>
          ) : mode === "speedy" ? (
            <>
              <strong>Speedy Entry</strong>
              <span>Choose pitch, then duration · 0 closes the frame</span>
            </>
          ) : (
            <>
              <strong>
                {mode === "select"
                  ? "Selection"
                  : mode[0].toUpperCase() + mode.slice(1)}
              </strong>
              <span>
                Click a measure · Shift-click to extend · drag to select a
                region
              </span>
            </>
          )}
        </div>
        <div className="panel-toggles">
          <button
            aria-pressed={showInstruments}
            className={showInstruments ? "selected" : ""}
            onClick={() => command("instruments")}
          >
            <ScoreIcon name="staff" />
            Instruments
          </button>
          <button
            aria-pressed={showInspector}
            className={showInspector ? "selected" : ""}
            onClick={() => command("inspector")}
          >
            <ScoreIcon name="expression" />
            Inspector
          </button>
        </div>
      </div>
      <div className="workspace">
        {(palettes.notePalette || palettes.restPalette) && (
          <EntryPalette
            mode={mode}
            duration={entryDuration}
            rest={entryRest}
            accidental={entryAccidental}
            showNotes={palettes.notePalette}
            showRests={palettes.restPalette}
            command={command}
            choose={chooseEntry}
            drag={{
              down: paletteDown,
              move: paletteMove,
              up: paletteUp,
              cancel: cancelEntryGesture,
            }}
            modify={(kind, n) => {
              setMode("write");
              if (kind === "dot")
                setEntryDuration((d) => ({ ...d, dots: (d.dots + 1) % 3 }));
              if (kind === "accidental")
                setEntryAccidental(entryAccidental === n ? undefined : n);
              if (kind === "tuplet") {
                pendingTuplet.current = undefined;
                setEntryDuration((d) => ({
                  ...d,
                  tuplets: d.tuplets.length ? [] : [{ actual: 3, normal: 2 }],
                }));
              }
            }}
          />
        )}
        {showInstruments && (
          <InstrumentPanel
            {...{
              score,
              staff,
              instrument,
              cursor,
              commit,
              setCursor,
              setSelected,
              newProgram,
              setNewProgram,
              addInstrument,
              close: closePanel,
            }}
          />
        )}
        <main className="editor">
          {recovery && (
            <div className="recovery-banner">
              Recovery available: <strong>{recovery.title}</strong>
              <button
                onClick={async () => {
                  await window.desktop?.newFile();
                  replaceScore(recovery);
                  setDirty(true);
                  setRecovery(undefined);
                  report("Recovery restored. Save to keep it as a score file.");
                }}
              >
                Restore
              </button>
              <button onClick={() => setRecovery(undefined)}>Dismiss</button>
            </div>
          )}
          <div
            ref={scrollHost}
            className="score-scroll"
            tabIndex={0}
            aria-label="Score editor"
            onScroll={(e) => {
              const horizontal = viewOptions.arrangement === "horizontal";
              const position =
                (horizontal
                  ? e.currentTarget.scrollLeft
                  : e.currentTarget.scrollTop) / zoom;
              const pages = layout?.pages ?? [];
              const extent =
                (horizontal
                  ? e.currentTarget.clientWidth
                  : e.currentTarget.clientHeight) / zoom;
              let page = pages[0],
                best = -1;
              for (const p of pages) {
                const start = horizontal ? p.x : p.y,
                  size = horizontal ? p.width : p.height;
                const visible = Math.max(
                  0,
                  Math.min(position + extent, start + size) -
                    Math.max(position, start),
                );
                if (visible > best + 0.01) {
                  best = visible;
                  page = p;
                }
              }
              setVisiblePage(page?.number ?? 1);
            }}
          >
            <div
              className="paper-space"
              style={{
                width: (layout?.width ?? 1000) * zoom,
                height: (layout?.height ?? 800) * zoom,
              }}
            >
              <div
                className={"paper mode-" + mode}
                style={{
                  transform: `scale(${zoom})`,
                  width: layout?.width ?? 1000,
                  height: layout?.height ?? 800,
                }}
                onPointerMove={pointerMove}
                onPointerLeave={() => {
                  if (gesture.current) return;
                  lastAudition.current = undefined;
                  lastHit.current = undefined;
                  setHover(undefined);
                  if (held.current || latchedRef.current) audio.audition([]);
                }}
                onPointerDown={pointerDown}
                onPointerUp={pointerUp}
                onPointerCancel={() => {
                  cancelEntryGesture();
                  if (held.current) stop();
                }}
                onLostPointerCapture={() => {
                  if (gesture.current) cancelEntryGesture();
                }}
                onDoubleClick={doubleClick}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (suppressContext.current) {
                    suppressContext.current = false;
                    return;
                  }
                  const hit = pointer(e);
                  if (hit && !region) {
                    const si = score.staves.findIndex(
                      (s) => s.id === hit.staffId,
                    );
                    chooseRegion(
                      fullMeasures(
                        score,
                        hit.measure.measureIndex,
                        hit.measure.measureIndex,
                        si,
                        si,
                      ),
                    );
                  }
                  setContextMenu({
                    x: Math.max(
                      8,
                      Math.min(e.clientX, window.innerWidth - 288),
                    ),
                    y: Math.max(
                      8,
                      Math.min(e.clientY, window.innerHeight - 390),
                    ),
                  });
                }}
              >
                <div ref={host} className="engraving" />
                {entryPreview && (
                  <EntryPreview
                    placement={entryPreview}
                    duration={entryDuration}
                    rest={entryRest}
                    keyboard={!hover}
                    accidental={entryAccidental}
                  />
                )}
                {region &&
                  layout &&
                  selectionRects(score, layout, region).map((r) => (
                    <div
                      key={r.key}
                      className="region-highlight"
                      style={{
                        left: r.left,
                        top: r.top,
                        width: r.width,
                        height: r.height,
                      }}
                    />
                  ))}
                {dragRect && (
                  <div className="zoom-rectangle" style={dragRect} />
                )}
                {mode === "speedy" &&
                  speedyActive &&
                  cursorBox &&
                  cursorStaff && (
                    <div
                      className="speedy-frame"
                      style={{
                        left: cursorBox.x - 3,
                        top: cursorStaff.lineBottom - 80,
                        width: cursorBox.endX - cursorBox.x + 6,
                        height: 112,
                      }}
                    >
                      <span>V{cursor.voice + 1}</span>
                      <b className="speedy-tuplet">
                        {entryDuration.tuplets[0]?.actual ?? ""}
                      </b>
                      <div
                        className="speedy-insertion"
                        style={{
                          left:
                            xAtTime(cursorBox, value(cursor.offset)) -
                            cursorBox.x +
                            3,
                        }}
                      />
                      <i
                        style={{
                          left:
                            xAtTime(cursorBox, value(cursor.offset)) -
                            cursorBox.x +
                            3,
                          top:
                            80 -
                            (entryPitch.octave * 7 +
                              steps.indexOf(entryPitch.step) -
                              (staff.clef === "bass" ? 18 : 30)) *
                              5,
                        }}
                      />
                    </div>
                  )}
                {cursorBox &&
                  cursorStaff &&
                  !auditioning &&
                  !playing &&
                  !region &&
                  mode === "write" && (
                    <div
                      className="edit-caret"
                      style={{
                        left: xAtTime(cursorBox, value(cursor.offset)) - 5,
                        top: cursorStaff.lineBottom - 49,
                        height: 62,
                      }}
                    />
                  )}
                {activeBox && activePosition !== undefined && (
                  <div
                    className={"audition-cursor " + (playing ? "playback" : "")}
                    style={{
                      left: xAtTime(
                        activeBox,
                        activePosition - activeBox.start,
                      ),
                      top: activeBox.top + 15,
                      height: activeBox.bottom - activeBox.top - 32,
                    }}
                  ></div>
                )}
              </div>
            </div>
            <div className="score-end">
              <button onClick={() => command("addMeasures")}>
                ＋ Add measures…
              </button>
            </div>
          </div>
          <div className="editor-bottom">
            <div className="page-navigation">
              <button
                aria-label="Previous page"
                disabled={visiblePage <= 1 || viewOptions.view !== "page"}
                onClick={() => goPage(visiblePage - 1)}
              >
                <ScoreIcon name="previous" />
              </button>
              <label>
                Page{" "}
                <input
                  aria-label="Page number"
                  type="number"
                  min="1"
                  max={layout?.pages?.length ?? 1}
                  value={visiblePage}
                  disabled={viewOptions.view !== "page"}
                  onChange={(e) => goPage(Number(e.target.value))}
                />
              </label>
              <span>of {layout?.pages?.length ?? 1}</span>
              <button
                aria-label="Next page"
                disabled={
                  visiblePage >= (layout?.pages?.length ?? 1) ||
                  viewOptions.view !== "page"
                }
                onClick={() => goPage(visiblePage + 1)}
              >
                <ScoreIcon name="next" />
              </button>
            </div>
            <div className="layer-buttons" aria-label="Layers">
              {[0, 1, 2, 3].map((v) => (
                <button
                  key={v}
                  aria-label={"Layer " + (v + 1)}
                  className={cursor.voice === v ? "selected" : ""}
                  onClick={() => {
                    setCursor({ ...cursor, voice: v });
                    setSelected(undefined);
                  }}
                >
                  {v + 1}
                </button>
              ))}
            </div>
            <button className="position-status" onClick={() => command("goTo")}>
              {region
                ? regionDescription(score, region)
                : "Measure " +
                  (measureIndex + 1) +
                  " · Beat " +
                  Number((value(cursor.offset) + 1).toFixed(3)) +
                  " · " +
                  staff.name}
            </button>
            <div className="zoom-controls">
              <select
                aria-label="Score view"
                value={viewOptions.view}
                onChange={(e) => command(e.target.value)}
              >
                <option value="page">Page view</option>
                <option value="scroll">Scroll view</option>
              </select>
              <button
                title="Fit page (Ctrl+[)"
                onClick={() => command("fitPage")}
              >
                Fit page
              </button>
              <button
                title="Fit width (Ctrl+])"
                onClick={() => command("fitWidth")}
              >
                Fit width
              </button>
              <button onClick={() => setConcert(!concert)}>
                {concert ? "Concert pitch" : "Written pitch"}
              </button>
              <button aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.2)}>
                −
              </button>
              <select
                aria-label="Zoom"
                value={String(Math.round(zoom * 100))}
                onChange={(e) => zoomTo(Number(e.target.value) / 100)}
              >
                {[
                  ...new Set([
                    25,
                    50,
                    75,
                    100,
                    125,
                    150,
                    200,
                    300,
                    400,
                    Math.round(zoom * 100),
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .map((z) => (
                    <option key={z} value={z}>
                      {z}%
                    </option>
                  ))}
              </select>
              <button aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.2)}>
                ＋
              </button>
            </div>
          </div>
        </main>
        {showInspector && (
          <aside className="inspector" aria-label="Inspector panel">
            <div className="panel-heading">
              <h2>Inspector</h2>
              <button
                className="panel-close"
                aria-label="Close inspector"
                title="Close inspector (Esc)"
                onClick={closePanel}
              >
                ×
              </button>
            </div>
            <div className="inspector-tabs">
              <button
                className={panel === "note" ? "selected" : ""}
                onClick={() => setPanel("note")}
              >
                Notation
              </button>
              <button
                className={panel === "score" ? "selected" : ""}
                onClick={() => setPanel("score")}
              >
                Score
              </button>
            </div>
            {panel === "note" ? (
              <>
                <section>
                  <h3>{note ? "Selected note" : "Note entry"}</h3>
                  {note ? (
                    <>
                      <label>
                        Pitches
                        <input
                          key={note.id + formatPitches(note.pitches)}
                          defaultValue={formatPitches(note.pitches)}
                          placeholder="C4 E4 G4"
                          onBlur={(e) => {
                            try {
                              const pitches = parsePitches(e.target.value);
                              if (
                                JSON.stringify(pitches) !==
                                JSON.stringify(note.pitches)
                              )
                                editNote((n) => {
                                  n.pitches = pitches;
                                });
                            } catch (err) {
                              report(String(err), true);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                      </label>
                      <div className="row">
                        <label>
                          Duration
                          <select
                            value={note.duration.base}
                            onChange={(e) =>
                              editNote((n) => {
                                n.duration.base = Number(e.target.value);
                              })
                            }
                          >
                            {[1, 2, 4, 8, 16, 32, 64].map((v) => (
                              <option key={v} value={v}>
                                1/{v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Dots
                          <select
                            value={note.duration.dots}
                            onChange={(e) =>
                              editNote((n) => {
                                n.duration.dots = Number(e.target.value);
                              })
                            }
                          >
                            {[0, 1, 2].map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label>
                        Articulation
                        <select
                          value={note.articulation}
                          onChange={(e) =>
                            editNote((n) => {
                              n.articulation = e.target.value as Articulation;
                            })
                          }
                        >
                          {[
                            "",
                            "staccato",
                            "tenuto",
                            "accent",
                            "marcato",
                            "fermata",
                            "trill",
                            "tremolo",
                          ].map((a) => (
                            <option key={a} value={a}>
                              {a || "None"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="row buttons">
                        <button
                          className={note.tieTo ? "selected" : ""}
                          onClick={() =>
                            commit((s) => connectNext(s, note.id, "tieTo"))
                          }
                        >
                          Tie →
                        </button>
                        <button
                          className={note.slurTo ? "selected" : ""}
                          onClick={() =>
                            commit((s) => connectNext(s, note.id, "slurTo"))
                          }
                        >
                          Slur →
                        </button>
                      </div>
                      <label>
                        Grace notes
                        <input
                          key={note.id + "grace"}
                          defaultValue={formatPitches(note.grace ?? [])}
                          placeholder="e.g. D5 E5"
                          onBlur={(e) => {
                            try {
                              const pitches = parsePitches(e.target.value);
                              if (
                                JSON.stringify(pitches) !==
                                JSON.stringify(note.grace ?? [])
                              )
                                editNote((n) => {
                                  n.grace = pitches;
                                });
                            } catch (err) {
                              report(String(err), true);
                            }
                          }}
                        />
                      </label>
                      <div className="row buttons">
                        <button
                          onClick={() =>
                            editNote((n) => {
                              n.pitches = n.pitches.map((p) => ({
                                ...p,
                                alter: Math.max(-2, p.alter - 1),
                              }));
                            })
                          }
                        >
                          ♭ Lower
                        </button>
                        <button
                          onClick={() =>
                            editNote((n) => {
                              n.pitches = n.pitches.map((p) => ({
                                ...p,
                                alter: Math.min(2, p.alter + 1),
                              }));
                            })
                          }
                        >
                          ♯ Raise
                        </button>
                      </div>
                      <button className="danger-link" onClick={remove}>
                        Delete note
                      </button>
                    </>
                  ) : (
                    <p className="muted">
                      Select a note to change its pitch, duration, articulation
                      or ties. Use Write mode to place notes directly.
                    </p>
                  )}
                </section>
                <section>
                  <h3>Expression</h3>
                  <label>
                    Marking
                    <select
                      value={markKind}
                      onChange={(e) => {
                        const kind = e.target.value as MarkKind;
                        setMarkKind(kind);
                        const defaults: Record<
                          MarkKind,
                          [string, number, number]
                        > = {
                          dynamic: ["mf", 80, 80],
                          hairpin: ["cresc.", 60, 100],
                          tempo: ["", score.tempo, score.tempo],
                          tempoRamp: [
                            "rit.",
                            score.tempo,
                            Math.round(score.tempo * 0.7),
                          ],
                          pedal: ["Ped.", 1, 0],
                          text: ["dolce", 0, 0],
                          program: ["pizz.", 45, 0],
                          ottava: ["8va", 12, 0],
                        };
                        const [text, amount, target] = defaults[kind];
                        setMarkText(text);
                        setMarkAmount(amount);
                        setMarkTarget(target);
                      }}
                    >
                      <option value="dynamic">Dynamics</option>
                      <option value="hairpin">Crescendo / diminuendo</option>
                      <option value="tempo">Tempo</option>
                      <option value="tempoRamp">
                        Ritardando / accelerando
                      </option>
                      <option value="pedal">Sustain pedal</option>
                      <option value="text">Expression text</option>
                      <option value="program">Instrument change</option>
                      <option value="ottava">Octave line</option>
                    </select>
                  </label>
                  {markKind === "dynamic" ? (
                    <div className="dynamic-grid">
                      {Object.keys(dynamicValues).map((d) => (
                        <button
                          key={d}
                          className={markText === d ? "selected" : ""}
                          onClick={() => {
                            setMarkText(d);
                            setMarkAmount(dynamicValues[d]);
                          }}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <label>
                      Text
                      <input
                        value={markText}
                        onChange={(e) => setMarkText(e.target.value)}
                      />
                    </label>
                  )}
                  {markKind === "program" ? (
                    <label>
                      Sound
                      <select
                        value={markAmount}
                        onChange={(e) => setMarkAmount(Number(e.target.value))}
                      >
                        {GM.map((n, i) => (
                          <option key={i} value={i}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    !["dynamic", "pedal", "text"].includes(markKind) && (
                      <label>
                        {markKind === "ottava"
                          ? "Semitones"
                          : markKind.startsWith("tempo")
                            ? "Starting BPM"
                            : "Starting dynamic"}
                        <input
                          type="number"
                          value={markAmount}
                          onChange={(e) =>
                            setMarkAmount(Number(e.target.value))
                          }
                        />
                      </label>
                    )
                  )}
                  {["hairpin", "tempoRamp"].includes(markKind) && (
                    <label>
                      {markKind === "tempoRamp"
                        ? "Target BPM"
                        : "Target dynamic"}
                      <input
                        type="number"
                        value={markTarget}
                        onChange={(e) => setMarkTarget(Number(e.target.value))}
                      />
                    </label>
                  )}
                  {["hairpin", "tempoRamp", "pedal", "ottava"].includes(
                    markKind,
                  ) && (
                    <label>
                      Length in quarter-note beats
                      <input
                        type="number"
                        min=".125"
                        step=".25"
                        value={markLength}
                        onChange={(e) => setMarkLength(Number(e.target.value))}
                      />
                    </label>
                  )}
                  <button className="wide accent" onClick={addMark}>
                    Add at {note ? "selected note" : "cursor"}
                  </button>
                  {currentMarks.length > 0 && (
                    <div className="mark-list">
                      {currentMarks.map((m) => (
                        <div key={m.id}>
                          <span>
                            {m.text || m.kind}{" "}
                            <small>beat {value(m.offset) + 1}</small>
                          </span>
                          <button
                            title="Remove expression"
                            onClick={() =>
                              commit((s) => {
                                s.marks = s.marks.filter((x) => x.id !== m.id);
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <h3>Sound preferences</h3>
                  <button
                    aria-label="Latch audition"
                    aria-pressed={latched}
                    onClick={() => setLatched(!latched)}
                  >
                    {latched ? "Release held audition" : "Latch audition"}
                  </button>
                  <label>
                    Scope
                    <select
                      value={scope}
                      onChange={(e) =>
                        setScope(e.target.value as Scope["mode"])
                      }
                    >
                      <option value="all">All instruments</option>
                      <option value="staff">Hovered staff</option>
                      <option value="instrument">Hovered instrument</option>
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={pedal}
                      onChange={(e) => setPedal(e.target.checked)}
                    />
                    Include pedal-held notes
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={retriggerAll}
                      onChange={(e) => setRetriggerAll(e.target.checked)}
                    />
                    Reattack each new chord
                  </label>
                  <p className="muted small">
                    Held notes and ties stay connected. Press R while
                    auditioning to hear a decayed chord again.
                  </p>
                </section>
              </>
            ) : (
              <>
                <ScoreSettings
                  {...{
                    score,
                    staff,
                    instrument,
                    measure,
                    measureIndex,
                    cursor,
                    commit,
                    setCursor,
                    setSelected,
                    fileAction,
                    command,
                  }}
                />
              </>
            )}
          </aside>
        )}
      </div>
      <footer className={"status " + (error ? "error" : "")}>
        <span className="status-dot" />
        <span>
          {auditioning && hover
            ? `Audition · measure ${hover.measure.measureIndex + 1} · ${auditionVoices.length} notes · ${auditionVoices.map((v) => pitchName(pitchFromMidi(v.midi))).join("  ")}`
            : notice}
        </span>
        <span className="status-right">
          {audio.state === "ready"
            ? `${(audio.context?.sampleRate ?? 0) / 1000} kHz · ${audio.active} voices`
            : "OFFLINE WORKSPACE"}
        </span>
      </footer>
      {help && <KeyboardGuide setHelp={setHelp} />}
      {dialog && (
        <CommandDialog
          key={dialog.title}
          spec={dialog}
          close={() => {
            setDialog(undefined);
            scrollHost.current?.focus();
          }}
        />
      )}
      {contextMenu && (
        <>
          <div
            className="context-dismiss"
            onPointerDown={() => setContextMenu(undefined)}
          />
          <div
            className="menu-popup context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {[
              ["cut", "Cut"],
              ["copy", "Copy"],
              ["paste", "Paste"],
              ["pasteInsert", "Insert copied music"],
              ["clear", "Clear music"],
              ["insertMeasures", "Insert measures…"],
              ["addMeasures", "Add measures…"],
              ["deleteMeasures", "Delete measures"],
              ["selectRegion", "Select region…"],
              ["transpose", "Transpose…"],
              ["measureSettings", "Time / key signature…"],
            ].map(([action, label]) => (
              <button
                role="menuitem"
                key={action}
                onClick={() => command(action)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
