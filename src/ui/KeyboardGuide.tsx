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
        <button className="modal-close" onClick={() => setHelp(false)}>
          ×
        </button>
        <span className="eyebrow">MAKE THE SCORE YOUR INSTRUMENT</span>
        <h2>Listen as you write.</h2>
        <p>
          Enable sound, hold <kbd>Space</kbd>, and move over the music. Every
          sounding part at that position joins the harmony.
        </p>
        <div className="help-grid">
          {[
            ["Space + move", "Audition all parts"],
            ["Shift + Space", "Audition one staff"],
            ["Ctrl + Space", "Alternate scrubbing shortcut"],
            ["R while auditioning", "Reattack the chord"],
            ["← / → while auditioning", "Step through boundaries"],
            ["Escape", "Silence everything"],
            ["Enter", "Play / stop"],
            ["A–G", "Enter a note and advance"],
            ["Shift + A–G", "Add a chord tone"],
            ["N", "Select / Write mode"],
            ["R", "Enter a rest"],
            ["3", "Toggle triplet"],
            ["5 / 6 / 7 / 8", "Eighth / quarter / half / whole"],
            [".", "Cycle dots"],
            ["T / Shift + T", "Tie / slur to next note"],
            ["↑ / ↓", "Move selected pitches"],
            ["Shift + ↑ / ↓", "Move an octave"],
            ["Ctrl + Z / Y", "Undo / redo"],
            ["Ctrl + C / V", "Copy / paste selected chord"],
            ["Ctrl + S / E", "Save / export MIDI"],
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
