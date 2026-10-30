import type { ReactNode } from "react";

/** Original monochrome artwork. Musical glyphs use the bundled, licensed Bravura font. */
export function ScoreIcon({ name, base = 4 }: { name: string; base?: number }) {
  const glyphs: Record<string, string> = {
    write: "\uE1D7",
    speedy: "\uE1D9",
    clef: "\uE050",
    expression: "\uE52D",
    sharp: "\uE262",
    flat: "\uE260",
    natural: "\uE261",
  };
  if (name === "note" || name === "rest") {
    const index = [1, 2, 4, 8, 16, 32, 64].indexOf(base);
    const code =
      name === "rest"
        ? 0xe4e3 + index
        : [0xe1d2, 0xe1d3, 0xe1d5, 0xe1d7, 0xe1d9, 0xe1db, 0xe1dd][index];
    return (
      <span aria-hidden="true" className={`music-icon ${name}`}>
        {String.fromCodePoint(code ?? 0xe1d5)}
      </span>
    );
  }
  if (glyphs[name])
    return (
      <span aria-hidden="true" className={`music-icon ${name}`}>
        {glyphs[name]}
      </span>
    );
  const paths: Record<string, ReactNode> = {
    select: (
      <path
        fill="currentColor"
        stroke="none"
        d="M6 3v18l4.5-5 4 7 3-2-4-7 7-.5z"
      />
    ),
    staff: (
      <>
        <path d="M2 6h20M2 10h20M2 14h20M2 18h20M6 3v18" />
        <path d="M9 9c-5-4-6 6 0 2" />
      </>
    ),
    key: (
      <>
        <path d="M2 6h20M2 10h20M2 14h20M2 18h20" opacity=".45" />
        <path d="M9 3v16M14 2v16M6 9l11-2M6 14l11-2" />
      </>
    ),
    time: (
      <>
        <text
          x="12"
          y="12"
          textAnchor="middle"
          stroke="none"
          fill="currentColor"
          fontFamily="Georgia"
          fontSize="13"
          fontWeight="bold"
        >
          4
        </text>
        <text
          x="12"
          y="23"
          textAnchor="middle"
          stroke="none"
          fill="currentColor"
          fontFamily="Georgia"
          fontSize="13"
          fontWeight="bold"
        >
          4
        </text>
      </>
    ),
    measure: (
      <>
        <path d="M2 6h20M2 10h20M2 14h20M2 18h20M4 3v18M20 3v18" />
        <path d="M8 10h8v4H8z" fill="currentColor" />
      </>
    ),
    tuplet: (
      <>
        <path d="M3 15v4h18v-4" />
        <text
          x="12"
          y="13"
          textAnchor="middle"
          fontSize="15"
          fill="currentColor"
          stroke="none"
          fontFamily="Georgia"
        >
          3
        </text>
      </>
    ),
    articulation: (
      <>
        <ellipse
          cx="10"
          cy="18"
          rx="4"
          ry="2.5"
          fill="currentColor"
          transform="rotate(-20 10 18)"
        />
        <path d="M14 17V6" />
        <circle cx="10" cy="4" r="1.2" fill="currentColor" />
      </>
    ),
    crescendo: <path d="M22 6L3 12l19 6" />,
    diminuendo: <path d="M2 6l19 6-19 6" />,
    slur: (
      <path d="M2 17Q12 0 22 17Q12 5 2 17" fill="currentColor" stroke="none" />
    ),
    text: (
      <>
        <path d="M4 6V3h16v3M12 3v18M8 21h8" strokeWidth="2" />
      </>
    ),
    page: (
      <>
        <path d="M5 2h11l4 4v16H5zM15 2v5h5M8 10h9M8 14h9M8 18h6" />
      </>
    ),
    erase: (
      <>
        <path d="M3 15L14 4l7 7-11 11H8zM8 10l7 7M10 22h12" />
      </>
    ),
    hand: (
      <path d="M6 13V6q0-3 2-1v7-8q1-3 3-1v9-9q2-2 3 1v8-6q2-2 3 1v8l2-3q3-2 3 0l-4 8q-1 3-4 3H9q-3 0-4-3l-3-6q0-3 2-1z" />
    ),
    zoom: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M15 15l7 7M6 10h8M10 6v8" />
      </>
    ),
    first: (
      <>
        <path d="M4 5v14" />
        <path
          d="M20 5l-8 7 8 7zM12 5l-8 7 8 7z"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
    previous: (
      <path
        d="M20 5l-8 7 8 7zM12 5l-8 7 8 7z"
        fill="currentColor"
        stroke="none"
      />
    ),
    next: (
      <path d="M4 5l8 7-8 7zM12 5l8 7-8 7z" fill="currentColor" stroke="none" />
    ),
    last: (
      <>
        <path d="M20 5v14" />
        <path
          d="M4 5l8 7-8 7zM12 5l8 7-8 7z"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
    play: <path d="M7 4l14 8-14 8z" fill="currentColor" stroke="none" />,
    stop: <path d="M6 6h12v12H6z" fill="currentColor" stroke="none" />,
    pause: (
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" stroke="none" />
    ),
    undo: (
      <>
        <path d="M8 5L3 10l5 5M3 10h11q10 0 7 10" />
      </>
    ),
    redo: (
      <>
        <path d="M16 5l5 5-5 5M21 10H10Q0 10 3 20" />
      </>
    ),
    dot: <circle cx="12" cy="12" r="2" fill="currentColor" />,
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="score-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
