const THUMBNAIL_WIDTH = 64;
const THUMBNAIL_HEIGHT = 36;
const SAMPLE_INTERVAL_MS = 400;
const MAX_SHIFT_PIXELS = 5;
const MINIMUM_TEXTURE = 10;
const MINIMUM_SCORE_IMPROVEMENT = 0.22;

export interface CameraMotionThumbnail {
  readonly width: number;
  readonly height: number;
  readonly luma: Uint8Array;
}

export interface CameraTranslationEstimate {
  readonly assessed: boolean;
  readonly shiftX: number;
  readonly shiftY: number;
  readonly improvement: number;
}

function assertThumbnail(thumbnail: CameraMotionThumbnail): void {
  if (
    !Number.isInteger(thumbnail.width) ||
    !Number.isInteger(thumbnail.height) ||
    thumbnail.width < 8 ||
    thumbnail.height < 8 ||
    thumbnail.luma.length !== thumbnail.width * thumbnail.height
  ) {
    throw new RangeError("Camera-motion thumbnail dimensions are invalid.");
  }
}

function edgeMap(thumbnail: CameraMotionThumbnail): Uint16Array {
  assertThumbnail(thumbnail);
  const { width, height, luma } = thumbnail;
  const edges = new Uint16Array(width * height);
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x;
      edges[index] =
        Math.abs(luma[index] - luma[index - 1]) +
        Math.abs(luma[index] - luma[index - width]);
    }
  }
  return edges;
}

function averageTexture(edges: Uint16Array): number {
  if (edges.length === 0) return 0;
  let sum = 0;
  for (const value of edges) sum += value;
  return sum / edges.length;
}

function shiftScore(
  baseline: Uint16Array,
  current: Uint16Array,
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
): number {
  const margin = MAX_SHIFT_PIXELS + 2;
  let error = 0;
  let count = 0;
  for (let y = margin; y < height - margin; y += 1) {
    const shiftedY = y + shiftY;
    for (let x = margin; x < width - margin; x += 1) {
      const shiftedX = x + shiftX;
      error += Math.abs(
        baseline[y * width + x] -
          current[shiftedY * width + shiftedX],
      );
      count += 1;
    }
  }
  return count > 0 ? error / count : Number.POSITIVE_INFINITY;
}

/**
 * Estimates coherent background translation on tiny edge maps. Local motion
 * (a swimmer or splash) should not improve the whole-frame alignment enough to
 * pass the conservative threshold.
 */
export function estimateCameraTranslation(
  baselineThumbnail: CameraMotionThumbnail,
  currentThumbnail: CameraMotionThumbnail,
): CameraTranslationEstimate {
  assertThumbnail(baselineThumbnail);
  assertThumbnail(currentThumbnail);
  if (
    baselineThumbnail.width !== currentThumbnail.width ||
    baselineThumbnail.height !== currentThumbnail.height
  ) {
    throw new RangeError("Camera-motion thumbnails must have the same size.");
  }

  const width = baselineThumbnail.width;
  const height = baselineThumbnail.height;
  const baseline = edgeMap(baselineThumbnail);
  const current = edgeMap(currentThumbnail);
  const texture = Math.min(
    averageTexture(baseline),
    averageTexture(current),
  );
  if (texture < MINIMUM_TEXTURE) {
    return { assessed: false, shiftX: 0, shiftY: 0, improvement: 0 };
  }

  const zeroScore = shiftScore(
    baseline,
    current,
    width,
    height,
    0,
    0,
  );
  let bestScore = zeroScore;
  let bestShiftX = 0;
  let bestShiftY = 0;
  for (let shiftY = -MAX_SHIFT_PIXELS; shiftY <= MAX_SHIFT_PIXELS; shiftY += 1) {
    for (let shiftX = -MAX_SHIFT_PIXELS; shiftX <= MAX_SHIFT_PIXELS; shiftX += 1) {
      if (shiftX === 0 && shiftY === 0) continue;
      const score = shiftScore(
        baseline,
        current,
        width,
        height,
        shiftX,
        shiftY,
      );
      if (score < bestScore) {
        bestScore = score;
        bestShiftX = shiftX;
        bestShiftY = shiftY;
      }
    }
  }

  const improvement =
    zeroScore > Number.EPSILON
      ? (zeroScore - bestScore) / zeroScore
      : 0;
  if (
    improvement < MINIMUM_SCORE_IMPROVEMENT ||
    (bestShiftX === 0 && bestShiftY === 0)
  ) {
    return { assessed: true, shiftX: 0, shiftY: 0, improvement };
  }
  return {
    assessed: true,
    shiftX: bestShiftX,
    shiftY: bestShiftY,
    improvement,
  };
}

function imageDataToThumbnail(imageData: ImageData): CameraMotionThumbnail {
  const luma = new Uint8Array(imageData.width * imageData.height);
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 4;
    luma[index] = Math.round(
      imageData.data[offset] * 0.299 +
        imageData.data[offset + 1] * 0.587 +
        imageData.data[offset + 2] * 0.114,
    );
  }
  return { width: imageData.width, height: imageData.height, luma };
}

/** Retains one 64x36 baseline edge sample, never a raw video frame. */
export class CameraMotionMonitor {
  private baseline: CameraMotionThumbnail | null = null;
  private lastSampleTimestampMs = Number.NEGATIVE_INFINITY;
  private assessedCount = 0;
  private movingCount = 0;
  private directionX = 0;
  private directionY = 0;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  get cameraMotionDetected(): boolean {
    if (this.assessedCount < 3 || this.movingCount < 2) return false;
    const movingRatio = this.movingCount / this.assessedCount;
    const directionStrength = Math.hypot(
      this.directionX,
      this.directionY,
    );
    return (
      movingRatio >= 0.45 &&
      directionStrength >= this.movingCount * 0.65
    );
  }

  async observe(bitmap: ImageBitmap, timestampMs: number): Promise<void> {
    if (
      !Number.isFinite(timestampMs) ||
      timestampMs - this.lastSampleTimestampMs < SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    this.lastSampleTimestampMs = timestampMs;
    const thumbnail = this.readThumbnail(bitmap);
    if (!this.baseline) {
      this.baseline = thumbnail;
      return;
    }
    const estimate = estimateCameraTranslation(this.baseline, thumbnail);
    if (!estimate.assessed) return;
    this.assessedCount += 1;
    if (estimate.shiftX === 0 && estimate.shiftY === 0) return;

    this.movingCount += 1;
    const length = Math.hypot(estimate.shiftX, estimate.shiftY);
    this.directionX += estimate.shiftX / length;
    this.directionY += estimate.shiftY / length;
  }

  private readThumbnail(bitmap: ImageBitmap): CameraMotionThumbnail {
    if (!this.canvas || !this.context) {
      if (typeof OffscreenCanvas !== "undefined") {
        this.canvas = new OffscreenCanvas(
          THUMBNAIL_WIDTH,
          THUMBNAIL_HEIGHT,
        );
      } else if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = THUMBNAIL_HEIGHT;
        this.canvas = canvas;
      } else {
        throw new Error("カメラ固定状態を確認できる描画環境がありません。");
      }
      this.context = this.canvas.getContext("2d", {
        willReadFrequently: true,
      }) as typeof this.context;
    }
    if (!this.context) {
      throw new Error("カメラ固定状態の確認を初期化できません。");
    }
    this.context.drawImage(
      bitmap,
      0,
      0,
      THUMBNAIL_WIDTH,
      THUMBNAIL_HEIGHT,
    );
    return imageDataToThumbnail(
      this.context.getImageData(
        0,
        0,
        THUMBNAIL_WIDTH,
        THUMBNAIL_HEIGHT,
      ),
    );
  }
}
