import { ScoreIcon } from "./ScoreIcon";

const tools = [
  ["select", "select", "Selection (Esc)"],
  ["staff", "staff", "Staff"],
  ["key", "key", "Key Signature"],
  ["time", "time", "Time Signature"],
  ["clef", "clef", "Clef"],
  ["measure", "measure", "Measure"],
  ["write", "write", "Simple Entry (N)"],
  ["speedy", "speedy", "Speedy Entry"],
  ["tupletOptions", "tuplet", "Tuplet settings"],
  ["slur", "slur", "Slur"],
  ["articulation", "articulation", "Articulation"],
  ["expression", "expression", "Expression"],
  ["crescendo", "crescendo", "Crescendo"],
  ["diminuendo", "diminuendo", "Diminuendo"],
  ["document", "text", "Title and composer"],
  ["pageLayout", "page", "Page Layout"],
  ["hand", "hand", "Hand"],
  ["zoom", "zoom", "Zoom"],
] as const;
export function MainPalette({
  mode,
  command,
  articulation,
  setArticulation,
}: {
  mode: string;
  command: (name: string) => void;
  articulation: string;
  setArticulation: (name: string) => void;
}) {
  return (
    <div className="main-palette" role="toolbar" aria-label="Main Tool Palette">
      <div className="toolbar-grip" />
      {tools.map(([action, icon, label]) => (
        <button
          key={action}
          aria-label={label}
          title={label}
          className={mode === action ? "selected" : ""}
          aria-pressed={mode === action}
          onClick={() => command(action)}
          onDoubleClick={() => {
            if (action === "measure") command("addMeasures");
          }}
        >
          <ScoreIcon name={icon} />
        </button>
      ))}
      {mode === "articulation" && (
        <select
          aria-label="Articulation tool"
          value={articulation}
          onChange={(e) => setArticulation(e.target.value)}
        >
          {[
            "staccato",
            "tenuto",
            "accent",
            "marcato",
            "fermata",
            "trill",
            "tremolo",
          ].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      )}
    </div>
  );
}
