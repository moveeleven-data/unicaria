import type { Duration } from "../core/model";
import { ScoreIcon } from "./ScoreIcon";

export function EntryPalette({
  duration,
  mode,
  rest,
  accidental,
  showNotes,
  showRests,
  choose,
  modify,
  command,
  drag,
}: {
  duration: Duration;
  mode: string;
  rest: boolean;
  accidental: number | undefined;
  showNotes: boolean;
  showRests: boolean;
  choose: (base: number, rest: boolean, reset?: boolean) => void;
  modify: (kind: "dot" | "accidental" | "tuplet", value?: number) => void;
  command: (action: string) => void;
  drag: {
    down: (
      e: React.PointerEvent<HTMLButtonElement>,
      base: number,
      rest: boolean,
    ) => void;
    move: (e: React.PointerEvent<HTMLButtonElement>) => void;
    up: (e: React.PointerEvent<HTMLButtonElement>) => void;
    cancel: () => void;
  };
}) {
  const button = (
    label: string,
    icon: string,
    active: boolean,
    click: () => void,
  ) => (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={active ? "selected" : ""}
      onClick={click}
    >
      <ScoreIcon name={icon} />
    </button>
  );
  return (
    <aside className="entry-palettes" aria-label="Simple Entry palettes">
      {showNotes && (
        <div
          className="entry-palette"
          role="toolbar"
          aria-label="Simple Entry Palette"
        >
          <div className="palette-grip" />
          {button("Eraser", "erase", mode === "erase", () => command("erase"))}
          {[1, 2, 4, 8, 16, 32, 64].map((base) => (
            <button
              key={base}
              aria-label={`Duration ${base}`}
              title={`1/${base} note · click, then click the staff; or drag onto the staff`}
              aria-pressed={!rest && duration.base === base}
              className={!rest && duration.base === base ? "selected" : ""}
              onClick={(e) => {
                if (e.detail === 0) choose(base, false);
              }}
              onDoubleClick={() => choose(base, false, true)}
              onPointerDown={(e) => drag.down(e, base, false)}
              onPointerMove={drag.move}
              onPointerUp={drag.up}
              onPointerCancel={drag.cancel}
              onLostPointerCapture={drag.cancel}
            >
              <ScoreIcon name="note" base={base} />
            </button>
          ))}
          <div className="palette-divider" />
          {button("Dotted duration (.)", "dot", duration.dots > 0, () =>
            modify("dot"),
          )}
          {button("Sharp", "sharp", accidental === 1, () =>
            modify("accidental", 1),
          )}
          {button("Flat", "flat", accidental === -1, () =>
            modify("accidental", -1),
          )}
          {button("Natural", "natural", accidental === 0, () =>
            modify("accidental", 0),
          )}
          <div className="palette-divider" />
          {button("Triplet", "tuplet", !!duration.tuplets.length, () =>
            modify("tuplet"),
          )}
          {button("Tie to next note", "slur", false, () => command("tie"))}
        </div>
      )}
      {showRests && (
        <div
          className="entry-palette rests-palette"
          role="toolbar"
          aria-label="Simple Entry Rests Palette"
        >
          <div className="palette-grip" />
          <div className="palette-spacer" />
          {[1, 2, 4, 8, 16, 32, 64].map((base) => (
            <button
              key={base}
              aria-label={`Rest duration ${base}`}
              title={`1/${base} rest · click, then click the staff; or drag onto the staff`}
              aria-pressed={rest && duration.base === base}
              className={rest && duration.base === base ? "selected" : ""}
              onClick={(e) => {
                if (e.detail === 0) choose(base, true);
              }}
              onDoubleClick={() => choose(base, true, true)}
              onPointerDown={(e) => drag.down(e, base, true)}
              onPointerMove={drag.move}
              onPointerUp={drag.up}
              onPointerCancel={drag.cancel}
              onLostPointerCapture={drag.cancel}
            >
              <ScoreIcon name="rest" base={base} />
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
