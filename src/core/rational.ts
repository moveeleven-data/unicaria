/** Exact score time, in quarter notes. Seconds are computed only at the audio boundary. */
export interface Rational {
  n: number;
  d: number;
}
export const gcd = (a: number, b: number): number => {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a);
};
export function rat(n: number, d = 1): Rational {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0)
    throw new Error("Rhythm exceeds exact integer precision.");
  const g = gcd(n, d);
  return { n: (d < 0 ? -n : n) / g, d: Math.abs(d) / g };
}
export const ZERO = rat(0);
export const add = (a: Rational, b: Rational) =>
  rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational) =>
  rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational) => rat(a.n * b.n, a.d * b.d);
export const compare = (a: Rational, b: Rational) =>
  Math.sign(a.n * b.d - b.n * a.d);
export const value = (a: Rational) => a.n / a.d;
export const equal = (a: Rational, b: Rational) => compare(a, b) === 0;
export const key = (a: Rational) => `${a.n}/${a.d}`;
export const min = (a: Rational, b: Rational) => (compare(a, b) <= 0 ? a : b);
export function fromDecimal(n: number, precision = 1000000): Rational {
  return rat(Math.round(n * precision), precision);
}
