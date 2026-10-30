import {
  type Score,
  type Staff,
  type Instrument,
  type Cursor,
} from "../core/model";
import { GM } from "../core/instruments";
import type { Dispatch, SetStateAction } from "react";
type Commit = (change: (score: Score) => void) => boolean;

interface Props {
  score: Score;
  staff: Staff;
  instrument: Instrument;
  cursor: Cursor;
  commit: Commit;
  setCursor: Dispatch<SetStateAction<Cursor>>;
  setSelected: Dispatch<SetStateAction<string | undefined>>;
  newProgram: number;
  setNewProgram: Dispatch<SetStateAction<number>>;
  addInstrument: () => void;
  close: () => void;
}
export function InstrumentPanel({
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
  close,
}: Props) {
  return (
    <aside className="instruments" aria-label="Instruments panel">
      <div className="panel-heading">
        <h2>
          Instruments <span>{score.instruments.length}</span>
        </h2>
        <button
          className="panel-close"
          aria-label="Close instruments"
          title="Close instruments (Esc)"
          onClick={close}
        >
          ×
        </button>
      </div>
      {score.instruments.map((inst, ii) => (
        <div
          key={inst.id}
          className={
            "instrument " + (inst.id === instrument.id ? "chosen" : "")
          }
        >
          <div className="instrument-heading">
            <span className="instrument-number">
              {String(ii + 1).padStart(2, "0")}
            </span>
            <button
              className="instrument-title"
              onClick={() => {
                const st = score.staves.find(
                  (s) => s.instrumentId === inst.id,
                )!;
                setCursor({ ...cursor, staffId: st.id });
                setSelected(undefined);
              }}
            >
              {inst.name}
            </button>
            <button
              className={inst.mute ? "mini toggled" : "mini"}
              title="Mute"
              onClick={() =>
                commit((s) => {
                  s.instruments.find((i) => i.id === inst.id)!.mute =
                    !inst.mute;
                })
              }
            >
              M
            </button>
            <button
              className={inst.solo ? "mini toggled" : "mini"}
              title="Solo"
              onClick={() =>
                commit((s) => {
                  s.instruments.find((i) => i.id === inst.id)!.solo =
                    !inst.solo;
                })
              }
            >
              S
            </button>
          </div>
          <select
            aria-label={`${inst.name} sound`}
            value={inst.program}
            onChange={(e) =>
              commit((s) => {
                s.instruments.find((i) => i.id === inst.id)!.program = Number(
                  e.target.value,
                );
              })
            }
          >
            {GM.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
          <div className="instrument-volume">
            <span>Volume</span>
            <input
              aria-label={`${inst.name} volume`}
              type="range"
              min="0"
              max="127"
              value={inst.volume}
              onChange={(e) =>
                commit((s) => {
                  s.instruments.find((i) => i.id === inst.id)!.volume = Number(
                    e.target.value,
                  );
                })
              }
            />
          </div>
          {score.staves
            .filter((s) => s.instrumentId === inst.id)
            .map((st) => (
              <button
                key={st.id}
                className={
                  "staff-button " + (st.id === staff.id ? "selected" : "")
                }
                onClick={() => {
                  setCursor({ ...cursor, staffId: st.id });
                  setSelected(undefined);
                }}
              >
                <span>
                  {st.clef === "bass" ? "𝄢" : st.clef === "treble" ? "𝄞" : "—"}
                </span>
                {st.clef[0].toUpperCase() + st.clef.slice(1)} staff
              </button>
            ))}
        </div>
      ))}
      <div className="add-instrument">
        <select
          aria-label="New instrument"
          value={newProgram}
          onChange={(e) => setNewProgram(Number(e.target.value))}
        >
          {GM.map((name, i) => (
            <option key={i} value={i}>
              {name}
            </option>
          ))}
        </select>
        <button onClick={addInstrument}>＋ Add instrument</button>
      </div>
      <div className="sidebar-foot">
        <span className="local-dot" />
        All sounds stored on this PC
        <br />
        <small>128 GM instruments + percussion</small>
      </div>
    </aside>
  );
}
