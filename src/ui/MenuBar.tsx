import { useEffect, useLayoutEffect, useRef, useState } from "react";
type Item = [string, string, string?];
const menus: Record<string, Item[]> = {
  File: [
    ["new", "New score", "Ctrl+N"],
    ["open", "Open…", "Ctrl+O"],
    ["importXml", "Import MusicXML…"],
    ["-1", ""],
    ["save", "Save", "Ctrl+S"],
    ["saveAs", "Save as…", "Ctrl+Shift+S"],
    ["-2", ""],
    ["midi", "Export MIDI…"],
    ["print", "Print / PDF…", "Ctrl+P"],
  ],
  Edit: [
    ["undo", "Undo", "Ctrl+Z"],
    ["redo", "Redo", "Ctrl+Y"],
    ["-1", ""],
    ["cut", "Cut", "Ctrl+X"],
    ["copy", "Copy", "Ctrl+C"],
    ["paste", "Paste", "Ctrl+V"],
    ["pasteInsert", "Insert copied music", "Ctrl+I"],
    ["repeat", "Paste multiple…"],
    ["-2", ""],
    ["selectAll", "Select all", "Ctrl+A"],
    ["selectRegion", "Select region…"],
    ["clear", "Clear music", "Backspace"],
    ["deleteMeasures", "Delete measures"],
    ["insertMeasures", "Insert measures…"],
    ["addMeasures", "Add measures…"],
    ["transpose", "Transpose…"],
  ],
  Utilities: [
    ["transpose", "Transpose…"],
    ["fitMeasures", "Fit measures…", "Ctrl+M"],
    ["repeat", "Repeat selected music…"],
  ],
  View: [
    ["page", "Page view", "Ctrl+E"],
    ["scroll", "Scroll view", "Ctrl+E"],
    ["-1", ""],
    ["horizontal", "Pages side by side"],
    ["vertical", "Pages vertically"],
    ["-2", ""],
    ["zoomIn", "Zoom in", "Ctrl++"],
    ["zoomOut", "Zoom out", "Ctrl+−"],
    ["fitWidth", "Fit width", "Ctrl+]"],
    ["fitPage", "Fit page", "Ctrl+["],
    ["zoom100", "Actual size", "Ctrl+1"],
    ["zoomOther", "Other zoom…", "Ctrl+0"],
    ["-3", ""],
    ["goTo", "Go to measure…", "Ctrl+G"],
    ["instruments", "Instruments / mixer"],
    ["inspector", "Notation inspector"],
  ],
  Document: [
    ["document", "Title and composer…"],
    ["measureSettings", "Time and key signature…"],
    ["clefSettings", "Clef…"],
    ["fitMeasures", "Measures per system…"],
    ["pageLayout", "Page layout…"],
    ["concert", "Display in concert pitch"],
  ],
  "MIDI/Audio": [
    ["play", "Play / stop", "Ctrl+Enter"],
    ["pause", "Pause"],
    ["stop", "All notes off", "Esc"],
    ["-1", ""],
    ["enableAudio", "Enable sound"],
    ["instruments", "ScoreManager / mixer…"],
    ["-2", ""],
    ["midi", "Export MIDI…"],
  ],
  Tools: [
    ["select", "Selection", "Esc"],
    ["staff", "Staff"],
    ["key", "Key Signature"],
    ["time", "Time Signature"],
    ["clef", "Clef"],
    ["measure", "Measure"],
    ["write", "Simple Entry", "N"],
    ["speedy", "Speedy Entry"],
    ["tupletOptions", "Tuplet settings…"],
    ["expression", "Expression"],
    ["articulation", "Articulation"],
    ["crescendo", "Crescendo"],
    ["diminuendo", "Diminuendo"],
    ["slur", "Slur"],
    ["erase", "Eraser"],
    ["hand", "Hand"],
    ["zoom", "Zoom"],
  ],
  Window: [
    ["mainPalette", "Main Tool Palette"],
    ["playbackControls", "Playback Controls"],
    ["notePalette", "Simple Entry Palette"],
    ["restPalette", "Simple Entry Rests Palette"],
    ["-1", ""],
    ["instruments", "ScoreManager / mixer"],
    ["inspector", "Notation inspector"],
  ],
  Help: [["help", "Keyboard guide", "F1"]],
};
export function MenuBar({
  command,
  mode = "select",
  checked = {},
  disabled = {},
}: {
  command: (name: string) => void;
  mode?: string;
  checked?: Record<string, boolean>;
  disabled?: Record<string, boolean>;
}) {
  const [open, setOpen] = useState<string>(),
    root = useRef<HTMLElement>(null);
  const [popup, setPopup] = useState({ left: 8, top: 34, maxHeight: 500 });
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = root.current?.querySelector(`[data-menu="${open}"]`);
      const bounds = button?.getBoundingClientRect();
      if (!bounds) return;
      const top = Math.min(
        bounds.bottom + 4,
        Math.max(8, window.innerHeight - 120),
      );
      setPopup({
        left: Math.max(
          8,
          Math.min(
            bounds.left,
            window.innerWidth - Math.min(280, window.innerWidth - 16) - 8,
          ),
        ),
        top,
        maxHeight: window.innerHeight - top - 12,
      });
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);
  const entries = Object.entries(menus);
  if (mode === "speedy" || mode === "write")
    entries.splice(7, 0, [
      mode === "speedy" ? "Speedy" : "Simple",
      [
        ["tupletOptions", "Tuplet settings…"],
        ["tie", "Tie to next note", "T"],
        [
          "tiePrevious",
          "Tie to previous note",
          mode === "speedy" ? "Ctrl+T" : "Shift+T",
        ],
        ["-1", ""],
        ...(mode === "speedy"
          ? [["speedyFrame", "Edit frame", "0"] as Item]
          : [["insertRest", "Enter rest", "0"] as Item]),
        ["help", "Entry keyboard guide…"],
      ],
    ]);
  const focusItem = (last = false) =>
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      );
      (last ? items?.[items.length - 1] : items?.[0])?.focus();
    });
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(undefined);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  return (
    <nav
      ref={root}
      className="menubar"
      aria-label="Application menu"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          setOpen(undefined);
          root.current
            ?.querySelector<HTMLButtonElement>(`[data-menu="${open}"]`)
            ?.focus();
        }
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          const focused = (e.target as HTMLElement)
            .closest(".menu-root")
            ?.getAttribute("data-name");
          const index = entries.findIndex(
            ([name]) => name === (open ?? focused),
          );
          const name =
            entries[
              (index + (e.key === "ArrowRight" ? 1 : entries.length - 1)) %
                entries.length
            ][0];
          if (open) {
            setOpen(name);
            focusItem();
          } else
            root.current
              ?.querySelector<HTMLButtonElement>(`[data-menu="${name}"]`)
              ?.focus();
        }
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          if (!open) {
            setOpen(
              (e.target as HTMLElement).getAttribute("data-menu") ??
                entries[0][0],
            );
            focusItem(e.key === "ArrowUp");
            return;
          }
          const items = [
            ...(root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ) ?? []),
          ];
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          items[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (index + (e.key === "ArrowDown" ? 1 : items.length - 1)) %
                  items.length
          ]?.focus();
        }
        if (e.key === "Tab") setOpen(undefined);
      }}
    >
      {entries.map(([name, items]) => (
        <div className="menu-root" data-name={name} key={name}>
          <button
            data-menu={name}
            aria-haspopup="menu"
            aria-expanded={open === name}
            onClick={() => setOpen(open === name ? undefined : name)}
            onPointerEnter={() => {
              if (open) setOpen(name);
            }}
          >
            {name}
          </button>
          {open === name && (
            <div
              className="menu-popup"
              style={popup}
              role="menu"
              aria-label={name}
            >
              {items.map(([action, label, shortcut]) =>
                action.startsWith("-") ? (
                  <div key={action} role="separator" />
                ) : (
                  <button
                    role="menuitem"
                    key={action}
                    disabled={disabled[action]}
                    onClick={() => {
                      setOpen(undefined);
                      command(action);
                    }}
                  >
                    <span className="menu-check" aria-hidden="true">
                      {checked[action] ? "✓" : ""}
                    </span>
                    <span className="menu-label">{label}</span>
                    <kbd>{shortcut}</kbd>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
