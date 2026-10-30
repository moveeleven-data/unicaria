import { useEffect, useRef, useState } from "react";
const menus: Record<string, [string, string, string?][]> = {
  File: [
    ["new", "New score", "Ctrl+N"],
    ["open", "Open…", "Ctrl+O"],
    ["importXml", "Import MusicXML…"],
    ["save", "Save", "Ctrl+S"],
    ["saveAs", "Save as…", "Ctrl+Shift+S"],
    ["midi", "Export MIDI…"],
    ["print", "Print / PDF…", "Ctrl+P"],
  ],
  Edit: [
    ["undo", "Undo", "Ctrl+Z"],
    ["redo", "Redo", "Ctrl+Y"],
    ["cut", "Cut", "Ctrl+X"],
    ["copy", "Copy", "Ctrl+C"],
    ["paste", "Paste", "Ctrl+V"],
    ["pasteInsert", "Insert copied music", "Ctrl+I"],
    ["repeat", "Paste multiple…"],
    ["selectAll", "Select all", "Ctrl+A"],
    ["selectRegion", "Select region…"],
    ["clear", "Clear music", "Backspace"],
    ["deleteMeasures", "Delete measures"],
    ["insertMeasures", "Insert measures…"],
    ["addMeasures", "Add measures…"],
    ["transpose", "Transpose…"],
  ],
  View: [
    ["page", "Page view", "Ctrl+E"],
    ["scroll", "Scroll view", "Ctrl+E"],
    ["horizontal", "Pages side by side"],
    ["vertical", "Pages vertically"],
    ["zoomIn", "Zoom in", "Ctrl++"],
    ["zoomOut", "Zoom out", "Ctrl+−"],
    ["fitWidth", "Fit width", "Ctrl+]"],
    ["fitPage", "Fit page", "Ctrl+["],
    ["zoom100", "Actual size", "Ctrl+1"],
    ["goTo", "Go to measure…", "Ctrl+G"],
    ["instruments", "Instruments / mixer"],
    ["inspector", "Notation inspector"],
  ],
  Document: [
    ["document", "Title and composer…"],
    ["measureSettings", "Time and key signature…"],
    ["fitMeasures", "Measures per system…"],
    ["pageLayout", "Layout…"],
    ["concert", "Concert / written pitch"],
  ],
  Tools: [
    ["select", "Selection", "Esc"],
    ["write", "Simple Entry", "N"],
    ["speedy", "Speedy Entry"],
    ["hand", "Hand"],
    ["zoom", "Zoom"],
    ["expression", "Expression"],
    ["articulation", "Articulation"],
    ["crescendo", "Crescendo"],
    ["diminuendo", "Diminuendo"],
    ["slur", "Slur"],
    ["erase", "Eraser"],
  ],
  Help: [["help", "Keyboard guide", "F1"]],
};
export function MenuBar({ command }: { command: (name: string) => void }) {
  const [open, setOpen] = useState<string>(),
    root = useRef<HTMLDivElement>(null);
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
        if (e.key === "Escape") {
          setOpen(undefined);
          e.stopPropagation();
        }
      }}
    >
      {Object.entries(menus).map(([name, items]) => (
        <div className="menu-root" key={name}>
          <button
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
            <div className="menu-popup" role="menu">
              {items.map(([action, label, shortcut]) => (
                <button
                  role="menuitem"
                  key={action}
                  onClick={() => {
                    setOpen(undefined);
                    command(action);
                  }}
                >
                  <span>{label}</span>
                  <kbd>{shortcut}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
