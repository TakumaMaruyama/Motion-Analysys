const FRAME_TIME_EPSILON_MS = 0.05;

function lowerBound(
  timestampsMs: readonly number[],
  targetMs: number,
): number {
  let low = 0;
  let high = timestampsMs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestampsMs[middle] < targetMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(
  timestampsMs: readonly number[],
  targetMs: number,
): number {
  let low = 0;
  let high = timestampsMs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestampsMs[middle] <= targetMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function boundedFrameIndices(
  timestampsMs: readonly number[],
  minimumMs: number,
  maximumMs: number,
): { readonly first: number; readonly last: number } | null {
  if (timestampsMs.length === 0 || maximumMs < minimumMs) return null;
  const first = lowerBound(timestampsMs, minimumMs);
  const last = upperBound(timestampsMs, maximumMs) - 1;
  return first <= last ? { first, last } : null;
}

/** Snaps an arbitrary media time to a real presentation timestamp. */
export function snapToFrameTimestamp(
  timestampsMs: readonly number[],
  targetMs: number,
  minimumMs: number,
  maximumMs: number,
): number {
  const boundedTarget = Math.min(maximumMs, Math.max(minimumMs, targetMs));
  const bounds = boundedFrameIndices(timestampsMs, minimumMs, maximumMs);
  if (!bounds) return boundedTarget;

  const insertion = lowerBound(timestampsMs, boundedTarget);
  const nextIndex = Math.min(bounds.last, Math.max(bounds.first, insertion));
  const previousIndex = Math.max(bounds.first, nextIndex - 1);
  return boundedTarget - timestampsMs[previousIndex] <=
    timestampsMs[nextIndex] - boundedTarget
    ? timestampsMs[previousIndex]
    : timestampsMs[nextIndex];
}

/** Returns the previous/next real presentation timestamp inside a trim. */
export function adjacentFrameTimestamp(
  timestampsMs: readonly number[],
  currentMs: number,
  direction: -1 | 1,
  minimumMs: number,
  maximumMs: number,
  fallbackStepMs: number,
): number {
  const bounds = boundedFrameIndices(timestampsMs, minimumMs, maximumMs);
  if (!bounds) {
    return Math.min(
      maximumMs,
      Math.max(minimumMs, currentMs + direction * fallbackStepMs),
    );
  }

  if (direction === 1) {
    const nextIndex = Math.max(
      bounds.first,
      upperBound(timestampsMs, currentMs + FRAME_TIME_EPSILON_MS),
    );
    return timestampsMs[Math.min(bounds.last, nextIndex)];
  }

  const previousIndex = Math.min(
    bounds.last,
    lowerBound(timestampsMs, currentMs - FRAME_TIME_EPSILON_MS) - 1,
  );
  return timestampsMs[Math.max(bounds.first, previousIndex)];
}
