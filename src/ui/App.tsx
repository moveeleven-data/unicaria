import { KeyboardGuide } from "./KeyboardGuide";
import { ScoreSettings } from "./ScoreSettings";
import { InstrumentPanel } from "./InstrumentPanel";
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
  measureBeats,
  moveDiatonic,
  nextCursor,
  pitchFromMidi,
  pitchName,
  putNote,
  steps,
  type Articulation,
  type Cursor,
  type Duration,
  type MarkKind,
  type Pitch,
  type Score,
  type Step,
} from "../core/model";
import { compare, fromDecimal, rat, sub, value, ZERO } from "../core/rational";
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
    [mode, setMode] = useState<"select" | "write">("select");
  const [scope, setScope] = useState<Scope["mode"]>("all"),
    [pedal, setPedal] = useState(true),
    [latched, setLatched] = useState(false),
    [auditioning, setAuditioning] = useState(false);
  const [playing, setPlaying] = useState(false),
    [playhead, setPlayhead] = useState<number>(),
    [hover, setHover] = useState<Hit>(),
    [zoom, setZoom] = useState(0.85),
    [fitWidth, setFitWidth] = useState(true),
    [concert, setConcert] = useState(false);
  const [dirty, setDirty] = useState(false),
    [notice, setNotice] = useState(
      "Hold Space and move across the score to hear the harmony.",
    ),
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
    clipboard = useRef<Score["notes"][number] | undefined>(undefined);
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
      if (held.current || latchedRef.current) audio.audition([]);
      return;
    }
    const voices = index.at(hit.time, {
      mode: shift.current ? "staff" : scope,
      staffId: hit.staffId,
      pedal,
    });
    const membership = voices.map((v) => v.id).join("/");
    audio.audition(
      voices,
      retrigger || (retriggerAll && membership !== lastMembership.current),
    );
    lastMembership.current = membership;
  };
  const commit = (change: (draft: Score) => void) => {
    try {
      const draft = cloneScore(score);
      change(draft);
      validateScore(draft);
      playRequest.current++;
      audio.stop();
      undo.current.push(score);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
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
    setCursor({
      staffId: next.staves[0].id,
      measureId: next.measures[0].id,
      offset: ZERO,
      voice: 0,
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
    undo.current = [];
    redo.current = [];
    setDirty(false);
    lastHit.current = undefined;
    setHover(undefined);
  };
  const fileAction = async (action: string) => {
    try {
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
      report("Sound ready. Hold Space over the score.");
    } catch (e) {
      report(String(e), true);
    }
  };
  const play = async (fromStart = false) => {
    if (playing) {
      stop();
      return;
    }
    stop();
    const request = playRequest.current;
    try {
      await audio.enable();
      if (request !== playRequest.current) return;
      const p = compilePerformance(index);
      performanceRef.current = p;
      const source = value(absolute(index.starts, cursor));
      const occurrence = p.occurrences.find(
        (o) => source >= o.sourceStart && source < o.sourceStart + o.length,
      );
      const offset =
        fromStart || !occurrence
          ? 0
          : p.secondsAt(occurrence.start + source - occurrence.sourceStart);
      audio.play(p, offset);
      setPlaying(true);
      const tick = () => {
        if (!audio.playing) return;
        setPlayhead(
          p.scoreAt(
            Math.max(0, (audio.context?.currentTime ?? 0) - audio.playStart),
          ),
        );
        animation.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      report(String(e), true);
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
      const n = putNote(draft, destination, d, pitches);
      created = n.id;
      next = nextCursor(draft, destination, beats(d));
    });
    if (accepted && created) {
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
    if (note) commit((s) => change(s.notes.find((n) => n.id === note.id)!));
  };
  const addMark = () => {
    const at = note
      ? { measureId: note.measureId, offset: note.offset }
      : cursor;
    const start = value(absolute(index.starts, at)),
      end = Math.min(index.length, start + Math.max(0.125, markLength));
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
  const pointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!layout || !host.current) return;
    const bounds = host.current.getBoundingClientRect();
    return hitTest(
      layout,
      (e.clientX - bounds.left) / zoom,
      (e.clientY - bounds.top) / zoom,
    );
  };
  const selectHit = (hit: Hit, e: React.PointerEvent<HTMLDivElement>) => {
    if (held.current || latchedRef.current) return;
    const bounds = host.current!.getBoundingClientRect(),
      x = (e.clientX - bounds.left) / zoom,
      y = (e.clientY - bounds.top) / zoom;
    const nearby = layout!.notes
      .filter(
        (n) =>
          n.measureId === hit.measure.measureId &&
          n.staffId === hit.staffId &&
          Math.abs(n.x - x) < 18,
      )
      .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
    if (nearby && mode === "select") {
      const existing = score.notes.find((n) => n.id === nearby.id)!;
      setSelected(existing.id);
      setCursor({
        staffId: existing.staffId,
        measureId: existing.measureId,
        offset: existing.offset,
        voice: existing.voice,
      });
      setPanel("note");
      return;
    }
    const unit = value(beats(entryDuration)),
      snap = Math.max(
        0,
        Math.min(
          hit.measure.length - unit,
          Math.round(value(hit.offset) / unit) * unit,
        ),
      );
    const at = {
      staffId: hit.staffId,
      measureId: hit.measure.measureId,
      offset: fromDecimal(snap),
      voice: cursor.voice,
    };
    // Entry grid uses the duration's exact denominator, including tuplets.
    at.offset = rat(
      Math.round(snap / unit) * beats(entryDuration).n,
      beats(entryDuration).d,
    );
    setCursor(at);
    setSelected(undefined);
    if (mode === "write") {
      const pitch = {
        ...hit.pitch,
        alter: keyAlter(
          hit.pitch.step,
          score.measures[hit.measure.measureIndex].key,
        ),
      };
      insert([pitch], at);
    }
  };

  useEffect(() => {
    void document.fonts.ready.then(() => setFonts(true));
    void recoveryRead().then(setRecovery);
    audio.onChange = () => setAudioTick((n) => n + 1);
    audio.onEnd = () => {
      held.current = false;
      latchedRef.current = false;
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
      const next = renderScore(host.current, score, selected, concert);
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
  }, [score, selected, concert, fonts]);
  useLayoutEffect(() => {
    const element = scrollHost.current;
    if (!element || !fitWidth) return;
    const resize = () => {
      const style = getComputedStyle(element);
      const available =
        element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        4;
      setZoom(Math.max(0.35, Math.min(1.5, available / 1120)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [fitWidth]);
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
    const off = window.desktop?.onCommand((command) => {
      if (
        ["copy", "cut", "paste", "undo", "redo"].includes(command) &&
        editable(document.activeElement)
      ) {
        void window.desktop?.editText(command);
        return;
      }
      if (command === "undo") history(true);
      else if (command === "redo") history(false);
      else if (command === "copy" || command === "cut") {
        if (note) {
          clipboard.current = structuredClone(note);
          report("Note or chord copied.");
          if (command === "cut") remove();
        }
      } else if (command === "paste") {
        if (clipboard.current)
          insert(clipboard.current.pitches, cursor, clipboard.current.duration);
      } else if (command === "help") {
        stop();
        setHelp(true);
      } else void fileAction(command);
    });
    return off;
  }, [score, cursor, dirty, selected]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        stop();
        setHelp(false);
        return;
      }
      if (editable(e.target) || e.isComposing) return;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shift.current = true;
        refreshAudition();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat || held.current || help) return;
        held.current = true;
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
      if (e.ctrlKey || e.metaKey) {
        if (e.code === "KeyZ") {
          e.preventDefault();
          history(!e.shiftKey);
        }
        if (e.code === "KeyY") {
          e.preventDefault();
          history(false);
        }
        if (e.code === "KeyS") {
          e.preventDefault();
          void fileAction(e.shiftKey ? "saveAs" : "save");
        }
        if (e.code === "KeyO") {
          e.preventDefault();
          void fileAction("open");
        }
        if (e.code === "KeyE") {
          e.preventDefault();
          void fileAction("midi");
        }
        if (e.code === "KeyC" && note) {
          e.preventDefault();
          clipboard.current = structuredClone(note);
          report("Note or chord copied.");
        }
        if (e.code === "KeyV" && clipboard.current) {
          e.preventDefault();
          insert(clipboard.current.pitches, cursor, clipboard.current.duration);
        }
        return;
      }
      if (e.code === "Enter") {
        e.preventDefault();
        void play();
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
        remove();
        return;
      }
      if (e.code === "KeyN") {
        e.preventDefault();
        setMode((m) => (m === "write" ? "select" : "write"));
        return;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        insert([]);
        return;
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        if (note)
          commit((s) =>
            connectNext(s, note.id, e.shiftKey ? "slurTo" : "tieTo"),
          );
        return;
      }
      if (e.code === "Period") {
        e.preventDefault();
        setEntryDuration((d) => ({ ...d, dots: (d.dots + 1) % 3 }));
        return;
      }
      if (e.code === "Digit3") {
        e.preventDefault();
        setEntryDuration((d) => ({
          ...d,
          tuplets: d.tuplets.length ? [] : [{ actual: 3, normal: 2 }],
        }));
        return;
      }
      const durations: Record<string, number> = {
        Digit1: 64,
        Digit2: 32,
        Digit4: 16,
        Digit5: 8,
        Digit6: 4,
        Digit7: 2,
        Digit8: 1,
      };
      if (durations[e.code]) {
        e.preventDefault();
        setEntryDuration((d) => ({ ...d, base: durations[e.code] }));
        return;
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        const dir = e.code === "ArrowRight" ? 1 : -1;
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
              : staff.clef === "bass"
                ? 3
                : 5,
          alter: keyAlter(step, measure.key),
        };
        insert([pitch]);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shift.current = e.shiftKey;
        refreshAudition();
      }
      if (
        e.code === "Space" ||
        ((e.code === "ControlLeft" || e.code === "ControlRight") &&
          controlGesture.current &&
          !e.ctrlKey)
      ) {
        held.current = false;
        controlGesture.current = false;
        if (!latchedRef.current) {
          setAuditioning(false);
          audio.stop();
        } else refreshAudition();
      }
    };
    const blur = () => stop();
    const hidden = () => {
      if (document.hidden) stop();
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
    scope,
    pedal,
    layout,
    playing,
    help,
    retriggerAll,
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
  const currentMarks = score.marks.filter(
    (m) => m.measureId === measure.id && (!m.staffId || m.staffId === staff.id),
  );
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">♮</span>
          <div>
            Unicaria<small>A place to hear your ideas</small>
          </div>
        </div>
        <div className="document-name">
          {score.title}
          <span>{dirty ? "Unsaved changes" : "Local score"}</span>
        </div>
        <div className="file-actions">
          <button onClick={() => void fileAction("open")}>Open</button>
          <button onClick={() => void fileAction("save")}>Save</button>
          <button className="outline" onClick={() => void fileAction("midi")}>
            Export MIDI <span>↗</span>
          </button>
          <button
            className="icon"
            aria-label="Keyboard guide"
            onClick={() => {
              stop();
              setHelp(true);
            }}
          >
            ?
          </button>
        </div>
      </header>
      <div className="transport">
        <div className="transport-buttons">
          <button
            className={"play " + (playing ? "active" : "")}
            aria-label={playing ? "Stop playback" : "Play score"}
            onClick={() => void play()}
          >
            {playing ? "■" : "▶"}
          </button>
          <button
            className="icon"
            title="Play from beginning"
            onClick={() => void play(true)}
          >
            ↤
          </button>
          <button
            className="icon"
            title="Panic: stop all sound (Escape)"
            onClick={stop}
          >
            ◼
          </button>
          <div className="tempo">
            <span>♩</span>
            <input
              aria-label="Tempo"
              type="number"
              min="20"
              max="400"
              value={score.tempo}
              onChange={(e) =>
                commit((s) => {
                  s.tempo = Number(e.target.value);
                })
              }
            />
            <small>BPM</small>
          </div>
        </div>
        <div className={"audition-control " + (auditioning ? "listening" : "")}>
          <button
            aria-label="Audition"
            className={latched ? "latched" : ""}
            onClick={() => setLatched(!latched)}
            aria-pressed={latched}
          >
            ◉ <span>Audition</span>
          </button>
          <span className="hint">
            <kbd>Space</kbd> + move · <kbd>Shift</kbd> for one staff
          </span>
        </div>
        <div className="sound-controls">
          <div className="meter" title="Audio output level">
            <i style={{ height: `${Math.min(100, audio.rms * 700)}%` }} />
          </div>
          <button
            className={"audio-state " + audio.state}
            onClick={() => void enable()}
          >
            <i />
            {audio.state === "ready"
              ? "Sound on"
              : audio.state === "loading"
                ? "Loading sounds…"
                : "Enable sound"}
          </button>
          <input
            aria-label="Master volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={master}
            onChange={(e) => {
              setMaster(Number(e.target.value));
              audio.volume(Number(e.target.value));
            }}
          />
        </div>
      </div>
      <div className="workspace">
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
          }}
        />
        <main className="editor">
          <div className="notation-toolbar">
            <div className="segmented">
              <button
                className={mode === "select" ? "selected" : ""}
                title="Select notes"
                onClick={() => setMode("select")}
              >
                ↖ Select
              </button>
              <button
                className={mode === "write" ? "selected" : ""}
                title="Write notes (N)"
                onClick={() => setMode("write")}
              >
                ✎ Write
              </button>
            </div>
            <div className="duration-buttons">
              {[
                [1, "𝅝"],
                [2, "𝅗𝅥"],
                [4, "♩"],
                [8, "♪"],
                [16, "♬"],
                [32, "32"],
              ].map(([base, symbol]) => (
                <button
                  key={base}
                  className={entryDuration.base === base ? "selected" : ""}
                  aria-label={`Duration ${base}`}
                  title={`1/${base} note`}
                  onClick={() =>
                    setEntryDuration((d) => ({ ...d, base: Number(base) }))
                  }
                >
                  {symbol}
                </button>
              ))}
            </div>
            <button
              className={entryDuration.dots ? "selected" : ""}
              title="Dotted duration (.)"
              onClick={() =>
                setEntryDuration((d) => ({ ...d, dots: (d.dots + 1) % 3 }))
              }
            >
              {entryDuration.dots === 2 ? "··" : "·"}
            </button>
            <select
              aria-label="Tuplet"
              value={entryDuration.tuplets[0]?.actual ?? 0}
              onChange={(e) =>
                setEntryDuration((d) => ({
                  ...d,
                  tuplets: Number(e.target.value)
                    ? [
                        {
                          actual: Number(e.target.value),
                          normal: Number(e.target.value) === 3 ? 2 : 4,
                        },
                      ]
                    : [],
                }))
              }
            >
              <option value="0">Straight</option>
              <option value="3">Triplet 3:2</option>
              <option value="5">Quintuplet 5:4</option>
              <option value="7">Septuplet 7:4</option>
            </select>
            <button title="Insert rest (R)" onClick={() => insert([])}>
              Rest
            </button>
            <select
              aria-label="Voice"
              value={cursor.voice}
              onChange={(e) => {
                setCursor({ ...cursor, voice: Number(e.target.value) });
                setSelected(undefined);
              }}
            >
              {[0, 1, 2, 3].map((v) => (
                <option key={v} value={v}>
                  Voice {v + 1}
                </option>
              ))}
            </select>
            <div className="toolbar-end">
              <button
                className="icon"
                disabled={!undo.current.length}
                title="Undo"
                onClick={() => history(true)}
              >
                ↶
              </button>
              <button
                className="icon"
                disabled={!redo.current.length}
                title="Redo"
                onClick={() => history(false)}
              >
                ↷
              </button>
            </div>
          </div>
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
          >
            <div
              className="paper-space"
              style={{
                width: 1120 * zoom,
                height: (layout?.height ?? 800) * zoom,
              }}
            >
              <div
                className="paper"
                style={{
                  transform: `scale(${zoom})`,
                  width: 1120,
                  height: layout?.height ?? 800,
                }}
                onPointerMove={(e) => {
                  const hit = pointer(e);
                  lastHit.current = hit;
                  setHover(hit);
                  if (held.current || latchedRef.current) refreshAudition(hit);
                }}
                onPointerLeave={() => {
                  lastHit.current = undefined;
                  setHover(undefined);
                  if (held.current || latchedRef.current) audio.audition([]);
                }}
                onPointerDown={(e) => {
                  (
                    e.currentTarget.closest(".score-scroll") as HTMLElement
                  ).focus();
                  const hit = pointer(e);
                  if (hit) selectHit(hit, e);
                }}
              >
                <div ref={host} className="engraving" />
                {cursorBox && cursorStaff && !auditioning && !playing && (
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
                  >
                    <span>{playing ? "PLAY" : "LISTEN"}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="score-end">
              <button
                onClick={() =>
                  commit((s) => {
                    const last = s.measures.at(-1)!;
                    s.measures.push({
                      id: id(),
                      beats: last.beats,
                      beatType: last.beatType,
                      key: last.key,
                    });
                  })
                }
              >
                ＋ Add measure
              </button>
              <span>
                Click a measure · type A–G · Shift + A–G adds a chord tone
              </span>
            </div>
          </div>
          <div className="editor-bottom">
            <span>
              Measure {measureIndex + 1} · Beat{" "}
              {(value(cursor.offset) + 1).toFixed(2).replace(/\.00$/, "")} ·{" "}
              {staff.name}
            </span>
            <div>
              <button
                onClick={() => setConcert(!concert)}
                className={concert ? "selected" : ""}
              >
                {concert ? "Concert pitch" : "Written pitch"}
              </button>
              <button
                onClick={() => setFitWidth(true)}
                className={fitWidth ? "selected" : ""}
              >
                Fit
              </button>
              <button
                onClick={() => {
                  setFitWidth(false);
                  setZoom((z) =>
                    Math.max(0.35, Math.round((z - 0.1) * 100) / 100),
                  );
                }}
              >
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => {
                  setFitWidth(false);
                  setZoom((z) =>
                    Math.min(1.5, Math.round((z + 0.1) * 100) / 100),
                  );
                }}
              >
                ＋
              </button>
            </div>
          </div>
        </main>
        <aside className="inspector">
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
                    Select a note to change its pitch, duration, articulation or
                    ties. Use Write mode to place notes directly.
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
                    <option value="tempoRamp">Ritardando / accelerando</option>
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
                        onChange={(e) => setMarkAmount(Number(e.target.value))}
                      />
                    </label>
                  )
                )}
                {["hairpin", "tempoRamp"].includes(markKind) && (
                  <label>
                    {markKind === "tempoRamp" ? "Target BPM" : "Target dynamic"}
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
                <h3>Audition behavior</h3>
                <label>
                  Scope
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as Scope["mode"])}
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
                  Held notes and ties stay connected. Press R while auditioning
                  to hear a decayed chord again.
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
                }}
              />
            </>
          )}
        </aside>
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
    </div>
  );
}
