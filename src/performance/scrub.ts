import { type DesiredVoice, type Scope, ScoreIndex } from "./compiler";
/** Include every distinct harmonic slice crossed between two pointer samples. */
export function scrubFrames(
  index: ScoreIndex,
  from: number,
  to: number,
  scope: Scope,
): DesiredVoice[][] {
  const direction = Math.sign(to - from);
  if (!direction) return [index.at(to, scope)];
  const boundaries = index.boundaries.filter((t) =>
    direction > 0
      ? t > from + 1e-8 && t < to - 1e-8
      : t < from - 1e-8 && t > to + 1e-8,
  );
  if (direction < 0) boundaries.reverse();
  const times = [
    ...boundaries.map((t) => Math.max(0, t + (direction < 0 ? -1e-7 : 1e-7))),
    to,
  ];
  let previous = index
    .at(from, scope)
    .map((v) => v.id)
    .join("/");
  const frames: DesiredVoice[][] = [];
  for (const t of times) {
    const voices = index.at(t, scope),
      key = voices.map((v) => v.id).join("/");
    if (key !== previous || t === to) {
      frames.push(voices);
      previous = key;
    }
  }
  return frames;
}
