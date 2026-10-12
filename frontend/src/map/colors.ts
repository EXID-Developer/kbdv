export const OCEAN = '#0e1824';
export const LAND = '#2c3442';
export const LAND_HOVER = '#3a4456';
export const SELECTED = '#ffd166';

// Diverging sentiment scale (red <- gray -> blue), validated for the dark surface.
const NEGATIVE = [230, 103, 103];
const MID = [123, 129, 140];
const POSITIVE = [57, 135, 229];
// Sequential volume ramp, dark (few) -> light (many).
const SEQ_LOW = [24, 79, 149];
const SEQ_HIGH = [134, 182, 239];

const hex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** Sentiment score in [-1, 1]. */
export function sentimentColor(score: number): string {
  const t = Math.max(-1, Math.min(1, score));
  return hex(t < 0 ? mix(MID, NEGATIVE, -t) : mix(MID, POSITIVE, t));
}

/** Volume as a fraction of the maximum, in [0, 1]. */
export function volumeColor(t: number): string {
  return hex(mix(SEQ_LOW, SEQ_HIGH, Math.max(0, Math.min(1, t))));
}

export const SENTIMENT_SWATCH = { positive: '#3987e5', neutral: '#555c68', negative: '#e66767' } as const;
export const SERIES = '#3987e5';
