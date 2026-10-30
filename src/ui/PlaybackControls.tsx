import { useRef, useState } from "react";
import { ScoreIcon } from "./ScoreIcon";

export function PlaybackControls({
  playing,
  paused,
  counter,
  elapsed,
  tempo,
  command,
  seek,
  setTempo,
  audioState,
  master,
  setMaster,
  instruments,
  inspector,
}: {
  playing: boolean;
  paused: boolean;
  counter: string;
  elapsed: number;
  tempo: number;
  command: (action: string) => void;
  seek: (text: string) => boolean;
  setTempo: (n: number) => void;
  audioState: string;
  master: number;
  setMaster: (n: number) => void;
  instruments: boolean;
  inspector: boolean;
}) {
  const [draft, setDraft] = useState<string>();
  const edited = useRef(false);
  const time = new Date(Math.max(0, elapsed) * 1000)
    .toISOString()
    .slice(11, 23);
  const controls = [
    ["first", "Beginning"],
    ["previous", "Previous measure"],
    ["stop", "Stop all sound (Escape)"],
    ["play", "Play score"],
    ["pause", "Pause playback"],
    ["next", "Next measure"],
    ["last", "Last measure"],
  ];
  const apply = () => {
    if (!edited.current) {
      setDraft(undefined);
      return;
    }
    if (draft !== undefined && seek(draft)) {
      edited.current = false;
      setDraft(undefined);
    }
  };
  return (
    <div className="transport" role="toolbar" aria-label="Playback Controls">
      <div className="transport-buttons">
        <div className="toolbar-grip" />
        {controls.map(([action, label]) => (
          <button
            key={action}
            aria-label={label}
            title={label}
            aria-pressed={
              action === "play"
                ? playing
                : action === "pause"
                  ? paused
                  : undefined
            }
            disabled={action === "pause" && !playing && !paused}
            className={
              (action === "play" && playing) || (action === "pause" && paused)
                ? "selected"
                : ""
            }
            onClick={() => command(action)}
          >
            <ScoreIcon name={action} />
          </button>
        ))}
        <span className="tool-divider" />
        <input
          className="playback-counter"
          aria-label="Playback position"
          title="Measure | beat | ticks (1024 ticks per quarter note)"
          value={draft ?? counter}
          onFocus={() => {
            edited.current = false;
            setDraft(counter);
          }}
          onChange={(e) => {
            edited.current = true;
            setDraft(e.target.value);
          }}
          onBlur={apply}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              edited.current = false;
              setDraft(undefined);
              e.currentTarget.blur();
            }
          }}
        />
        <label className="elapsed-time">
          Time: <output>{time}</output>
        </label>
        <div className="tempo">
          <span>♩ =</span>
          <input
            aria-label="Tempo"
            type="number"
            min="20"
            max="400"
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="sound-controls">
        <button
          className={"audio-state " + audioState}
          onClick={() => command("enableAudio")}
        >
          <i />
          {audioState === "ready"
            ? "Sound on"
            : audioState === "loading"
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
          onChange={(e) => setMaster(Number(e.target.value))}
        />
        <button
          className={instruments ? "selected" : ""}
          onClick={() => command("instruments")}
        >
          Instruments
        </button>
        <button
          className={inspector ? "selected" : ""}
          onClick={() => command("inspector")}
        >
          Inspector
        </button>
      </div>
    </div>
  );
}
