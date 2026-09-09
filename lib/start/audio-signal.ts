export interface AudioSignalWindowCandidate {
  readonly windowIndex: number;
  /** 校正済み確率ではなく、ピークの明瞭さを0〜1へ正規化したスコア。 */
  readonly confidence: number;
  readonly peakRms: number;
  readonly noiseFloorRms: number;
}

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * RMS窓から最初の明瞭な号砲候補を返す。
 * 同程度の大きなピークが複数ある場合は、飛沫等との区別がつかないため
 * スコアを下げ、自動確定ではなくコーチ確認へ倒す。
 */
export function findAudioSignalWindow(
  windows: readonly number[],
): AudioSignalWindowCandidate | null {
  const usable = windows.map((value) => Number.isFinite(value) && value >= 0 ? value : 0);
  if (usable.length === 0) return null;
  const peak = Math.max(...usable);
  const noiseFloor = median(usable);
  if (peak < 0.015 || peak < Math.max(0.02, noiseFloor * 2)) return null;

  const windowIndex = usable.findIndex((value) => value >= peak * 0.85);
  if (windowIndex < 0) return null;
  const selectedPeak = usable[windowIndex];
  const competingPeak = usable.reduce((maximum, value, index) =>
    Math.abs(index - windowIndex) <= 2 ? maximum : Math.max(maximum, value),
  0);
  const signalToNoise = selectedPeak / Math.max(noiseFloor, 0.001);
  const dominance = selectedPeak / Math.max(competingPeak, 0.001);
  const noiseScore = bounded((signalToNoise - 2) / 4);
  const dominanceScore = bounded((dominance - 1) / 1.5);
  const confidence = bounded(0.45 + noiseScore * 0.25 + dominanceScore * 0.3);

  return {
    windowIndex,
    confidence,
    peakRms: selectedPeak,
    noiseFloorRms: noiseFloor,
  };
}
