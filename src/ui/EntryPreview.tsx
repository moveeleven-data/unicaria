import type { Duration } from "../core/model";
import type { EntryPlacement } from "./entryPlacement";

export function EntryPreview({
  placement,
  duration,
  rest,
  keyboard = false,
  accidental,
}: {
  placement: EntryPlacement;
  duration: Duration;
  rest: boolean;
  keyboard?: boolean;
  accidental?: number;
}) {
  const { x, y, bottom, displayPitch } = placement;
  const ledger: number[] = [];
  if (!rest) {
    for (let line = bottom + 10; line <= y + 1; line += 10) ledger.push(line);
    for (let line = bottom - 50; line >= y - 1; line -= 10) ledger.push(line);
  }
  const restCode = 0xe4e3 + [1, 2, 4, 8, 16, 32, 64].indexOf(duration.base);
  return (
    <svg
      className={"entry-preview" + (keyboard ? " keyboard-preview" : "")}
      aria-label={
        rest
          ? "Rest preview"
          : `Note preview ${displayPitch.step}${displayPitch.alter > 0 ? " sharp" : displayPitch.alter < 0 ? " flat" : ""}${displayPitch.octave}`
      }
      data-offset={`${placement.at.offset.n}/${placement.at.offset.d}`}
      style={{ left: x - 24, top: bottom - 140 }}
      width="90"
      height="280"
      viewBox="-24 -140 90 280"
    >
      {ledger.map((line) => (
        <path
          key={line}
          d={`M-5 ${line - bottom}H18`}
          stroke="currentColor"
          strokeWidth="1.4"
        />
      ))}
      {rest ? (
        <text
          x="0"
          y="-20"
          fontFamily="Bravura"
          fontSize="40"
          fill="currentColor"
        >
          {String.fromCodePoint(restCode)}
        </text>
      ) : (
        <g transform={`translate(0 ${y - bottom})`}>
          <ellipse
            cx="6"
            cy="0"
            rx="6"
            ry="4"
            transform="rotate(-20 6 0)"
            fill={duration.base <= 2 ? "var(--paper)" : "currentColor"}
            stroke="currentColor"
            strokeWidth="1.7"
          />
          {duration.base > 1 && (
            <path d="M12 0V-35" stroke="currentColor" strokeWidth="1.5" />
          )}
          {duration.base >= 8 && (
            <text
              x="12"
              y="-35"
              fontFamily="Bravura"
              fontSize="40"
              fill="currentColor"
            >
              {String.fromCodePoint(0xe240 + 2 * Math.log2(duration.base / 8))}
            </text>
          )}
          {(displayPitch.alter !== 0 || accidental === 0) && (
            <text
              x="-17"
              y="0"
              fontFamily="Bravura"
              fontSize="34"
              fill="currentColor"
            >
              {displayPitch.alter > 0
                ? "\uE262"
                : displayPitch.alter < 0
                  ? "\uE260"
                  : "\uE261"}
            </text>
          )}
        </g>
      )}
      {Array.from({ length: duration.dots }, (_, i) => (
        <circle
          key={i}
          cx={21 + i * 6}
          cy={rest ? -20 : y - bottom - 3}
          r="1.8"
          fill="currentColor"
        />
      ))}
      {duration.tuplets[0] && (
        <text
          x="7"
          y={rest ? -51 : y - bottom - 43}
          textAnchor="middle"
          fontSize="13"
          fill="currentColor"
        >
          {duration.tuplets[0].actual}
        </text>
      )}
    </svg>
  );
}
