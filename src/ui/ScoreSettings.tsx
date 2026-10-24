import {
  id,
  keySignatures,
  type Score,
  type Staff,
  type Instrument,
  type Measure,
  type Cursor,
} from "../core/model";
import { fromDecimal, value, ZERO } from "../core/rational";
import type { Dispatch, SetStateAction } from "react";
type Commit = (change: (score: Score) => void) => boolean;

interface Props {
  score: Score;
  staff: Staff;
  instrument: Instrument;
  measure: Measure;
  measureIndex: number;
  cursor: Cursor;
  commit: Commit;
  setCursor: Dispatch<SetStateAction<Cursor>>;
  setSelected: Dispatch<SetStateAction<string | undefined>>;
  fileAction: (action: string) => Promise<void>;
}
export function ScoreSettings({
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
}: Props) {
  return (
    <>
      <section>
        <h3>Document</h3>
        <label>
          Title
          <input
            value={score.title}
            onChange={(e) =>
              commit((s) => {
                s.title = e.target.value;
              })
            }
          />
        </label>
        <label>
          Composer
          <input
            value={score.composer}
            onChange={(e) =>
              commit((s) => {
                s.composer = e.target.value;
              })
            }
          />
        </label>
        <div className="row buttons">
          <button onClick={() => void fileAction("new")}>New score</button>
          <button onClick={() => void fileAction("print")}>Print / PDF</button>
        </div>
      </section>
      <section>
        <h3>Measure {measureIndex + 1}</h3>
        <div className="row">
          <label>
            Beats
            <input
              type="number"
              min="1"
              max="32"
              value={measure.beats}
              onChange={(e) =>
                commit((s) => {
                  for (let i = measureIndex; i < s.measures.length; i++)
                    s.measures[i].beats = Number(e.target.value);
                })
              }
            />
          </label>
          <label>
            Beat unit
            <select
              value={measure.beatType}
              onChange={(e) =>
                commit((s) => {
                  for (let i = measureIndex; i < s.measures.length; i++)
                    s.measures[i].beatType = Number(e.target.value);
                })
              }
            >
              {[1, 2, 4, 8, 16, 32].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          Meter changes apply from this measure onward. Existing notes must fit.
        </p>
        <label>
          Key signature
          <select
            value={measure.key}
            onChange={(e) =>
              commit((s) => {
                for (let i = measureIndex; i < s.measures.length; i++)
                  s.measures[i].key = e.target.value;
              })
            }
          >
            {keySignatures.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Pickup length (0 = full bar)
          <input
            type="number"
            min="0"
            max="32"
            step=".25"
            value={measure.pickup ? value(measure.pickup) : 0}
            onChange={(e) =>
              commit((s) => {
                const m = s.measures[measureIndex];
                if (Number(e.target.value) > 0)
                  m.pickup = fromDecimal(Number(e.target.value));
                else delete m.pickup;
              })
            }
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!measure.repeatStart}
            onChange={(e) =>
              commit((s) => {
                s.measures[measureIndex].repeatStart = e.target.checked;
              })
            }
          />
          Start repeat
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!measure.repeatEnd}
            onChange={(e) =>
              commit((s) => {
                s.measures[measureIndex].repeatEnd = e.target.checked;
              })
            }
          />
          End repeat (twice)
        </label>
        <label>
          Ending
          <select
            value={measure.ending ?? 0}
            onChange={(e) =>
              commit((s) => {
                s.measures[measureIndex].ending =
                  Number(e.target.value) || undefined;
              })
            }
          >
            <option value="0">None</option>
            <option value="1">First ending</option>
            <option value="2">Second ending</option>
          </select>
        </label>
        <button
          className="danger-link"
          disabled={score.measures.length === 1}
          onClick={() => {
            const next = score.measures[Math.max(0, measureIndex - 1)];
            commit((s) => {
              const ids = new Set(
                s.notes
                  .filter((n) => n.measureId === measure.id)
                  .map((n) => n.id),
              );
              s.measures = s.measures.filter((m) => m.id !== measure.id);
              s.notes = s.notes.filter((n) => n.measureId !== measure.id);
              s.marks = s.marks.filter(
                (m) =>
                  m.measureId !== measure.id && m.endMeasureId !== measure.id,
              );
              for (const n of s.notes) {
                if (n.tieTo && ids.has(n.tieTo)) delete n.tieTo;
                if (n.slurTo && ids.has(n.slurTo)) delete n.slurTo;
              }
            });
            setCursor({
              ...cursor,
              measureId:
                next.id === measure.id ? score.measures[1].id : next.id,
              offset: ZERO,
            });
            setSelected(undefined);
          }}
        >
          Delete measure
        </button>
      </section>
      <section>
        <h3>{staff.name}</h3>
        <label>
          Staff name
          <input
            value={staff.name}
            onChange={(e) =>
              commit((s) => {
                s.staves.find((x) => x.id === staff.id)!.name = e.target.value;
              })
            }
          />
        </label>
        <label>
          Clef
          <select
            value={staff.clef}
            onChange={(e) =>
              commit((s) => {
                s.staves.find((x) => x.id === staff.id)!.clef = e.target
                  .value as typeof staff.clef;
              })
            }
          >
            {["treble", "bass", "alto", "tenor", "percussion"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Sounding transposition (semitones)
          <input
            type="number"
            min="-36"
            max="36"
            value={instrument.transpose}
            onChange={(e) =>
              commit((s) => {
                s.instruments.find((i) => i.id === instrument.id)!.transpose =
                  Number(e.target.value);
              })
            }
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={instrument.percussion}
            onChange={(e) =>
              commit((s) => {
                s.instruments.find((i) => i.id === instrument.id)!.percussion =
                  e.target.checked;
              })
            }
          />
          GM percussion kit
        </label>
        <label>
          Pan
          <input
            type="range"
            min="0"
            max="127"
            value={instrument.pan}
            onChange={(e) =>
              commit((s) => {
                s.instruments.find((i) => i.id === instrument.id)!.pan = Number(
                  e.target.value,
                );
              })
            }
          />
        </label>
        <button
          className="wide"
          onClick={() =>
            commit((s) =>
              s.staves.push({
                id: id(),
                instrumentId: instrument.id,
                name: instrument.name,
                clef: "bass",
              }),
            )
          }
        >
          ＋ Add staff to this instrument
        </button>
        <button
          className="danger-link"
          disabled={score.staves.length === 1}
          onClick={() => {
            commit((s) => {
              s.staves = s.staves.filter((x) => x.id !== staff.id);
              s.notes = s.notes.filter((n) => n.staffId !== staff.id);
              s.marks = s.marks.filter((m) => m.staffId !== staff.id);
              s.instruments = s.instruments.filter((i) =>
                s.staves.some((st) => st.instrumentId === i.id),
              );
            });
            setCursor({
              ...cursor,
              staffId: score.staves.find((s) => s.id !== staff.id)!.id,
            });
            setSelected(undefined);
          }}
        >
          Remove staff
        </button>
      </section>
    </>
  );
}
