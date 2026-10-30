import type { Dispatch, SetStateAction } from "react";
export function KeyboardGuide({
  setHelp,
}: {
  setHelp: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="modal-backdrop" onPointerDown={() => setHelp(false)}>
      <div
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard guide"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close keyboard guide"
          onClick={() => setHelp(false)}
        >
          ×
        </button>
        <h2>Working in Unicaria</h2>
        <p>
          Click a measure to select it. Shift-click extends the selection; drag
          selects part of a measure. Double-click expands to complete measures,
          then all staves. Right-click for editing commands.
        </p>
        <p>
          To write with the mouse, choose a note on the left and move onto the
          staff. The colored preview shows its pitch and position; click to
          place it. You can also drag a duration from the palette onto the
          staff. Click above or below a note to build a chord, or drag its
          notehead vertically to change that pitch. Ctrl-click selects a note
          for Delete; the eraser removes just the chord tone you click. Escape
          cancels a drag and closes an open panel.
        </p>
        <div className="help-grid">
          {[
            ["Space + move", "Hear every part at the pointer"],
            ["Shift + Space", "Hear the staff beneath the pointer"],
            ["R / ← / → while held", "Reattack / step through the harmony"],
            ["Esc", "Silence and return to Selection"],
            ["Ctrl + Enter", "Play / stop (Shift starts at beginning)"],
            ["N / Tools → Speedy", "Simple / Speedy Entry"],
            ["A–G", "Simple: enter pitch; Speedy: choose pitch"],
            ["1 / 2 / 3 / 4", "64th / 32nd / 16th / eighth"],
            ["5 / 6 / 7", "Quarter / half / whole"],
            ["Number in Speedy", "Enter chosen pitch and duration"],
            ["0 in Simple / Speedy", "Enter rest / exit or reopen frame"],
            ["Ctrl + Shift + number (Speedy)", "Enter a rest of that duration"],
            ["Shift + A–G (Simple)", "Add chord tone"],
            [". / Ctrl + 3", "Dot / triplet (one group in Speedy)"],
            ["Alt + number", "Change selected note duration"],
            ["T / Shift + T", "Tie forward / backward (Ctrl+T in Speedy)"],
            ["Shift + ↑ / ↓ (Speedy)", "Move frame to another staff"],
            ["Backspace (Speedy)", "Remove the chord tone under the crossbar"],
            ["Tools → Slur", "Drag between notes to add a slur"],
            ["↑ / ↓ / + / −", "Move pitch / change accidental"],
            ["Alt + Shift + 1–4", "Choose layer"],
            ["[ / ]", "Previous / next measure"],
            ["Backspace", "Clear selected music, keeping measures"],
            ["Delete (all-staff selection)", "Remove measures from the score"],
            [
              "Ctrl + C / X / V / I",
              "Copy / cut / paste / insert copied music",
            ],
            ["Ctrl + A / Shift + arrows", "Select all / extend selection"],
            ["Ctrl + Z / Y", "Undo / redo"],
            ["Ctrl + E / Ctrl + wheel", "Page–scroll view / zoom"],
            ["Ctrl + G / M", "Go to measure / measures per system"],
            ["Ctrl + Page Up / Down", "Previous / next page"],
            ["Shift + right-click", "Zoom in (add Ctrl to zoom out)"],
            ["Ctrl + S / Shift + Ctrl + S", "Save / Save as"],
            ["File → Export MIDI", "Export playback as a MIDI file"],
          ].map(([key, desc]) => (
            <div key={key}>
              <kbd>{key}</kbd>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <p className="muted small">
          Piano and percussion naturally decay. Sustaining instruments hold.
          Expression text is visual; dedicated dynamics, tempo and instrument
          markings control playback.
        </p>
        <button className="accent wide" onClick={() => setHelp(false)}>
          Back to the score
        </button>
      </div>
    </div>
  );
}
