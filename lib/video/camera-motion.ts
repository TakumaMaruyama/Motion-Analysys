const THUMBNAIL_WIDTH = 64;
const THUMBNAIL_HEIGHT = 36;
const SAMPLE_INTERVAL_MS = 400;
const MAX_SHIFT_PIXELS = 5;
const MINIMUM_TEXTURE = 10;
const MINIMUM_SCORE_IMPROVEMENT = 0.22;
const SCALE_CANDIDATES = [0.92, 0.96, 1, 1.04, 1.08] as const;
const ROTATION_CANDIDATES_DEGREES = [-5, -2.5, 0, 2.5, 5] as const;
const MINIMUM_ASSESSABLE_RATIO = 0.6;
const MINIMUM_CONSISTENT_DIRECTION = 0.72;

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

export type CameraStabilityState = "stable" | "moving" | "unassessable";

export type CameraMovementKind =
  | "none"
  | "translation"
  | "zoom"
  | "rotation"
  | "combined";

export interface CameraTransformEstimate extends CameraTranslationEstimate {
  /** 1 is unchanged; values above 1 represent zooming in. */
  readonly scale: number;
  readonly rotationDegrees: number;
  readonly movement: CameraMovementKind;
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

function transformedScore(
  baseline: Uint16Array,
  current: Uint16Array,
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
  scale: number,
  rotationDegrees: number,
): number {
  const margin = MAX_SHIFT_PIXELS + 2;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radians = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  let error = 0;
  let count = 0;

  for (let y = margin; y < height - margin; y += 1) {
    const centeredY = y - centerY;
    for (let x = margin; x < width - margin; x += 1) {
      const centeredX = x - centerX;
      const transformedX =
        centerX +
        scale * (cosine * centeredX - sine * centeredY) +
        shiftX;
      const transformedY =
        centerY +
        scale * (sine * centeredX + cosine * centeredY) +
        shiftY;
      const left = Math.floor(transformedX);
      const top = Math.floor(transformedY);
      if (
        left < 0 ||
        left + 1 >= width ||
        top < 0 ||
        top + 1 >= height
      ) {
        continue;
      }

      const fractionX = transformedX - left;
      const fractionY = transformedY - top;
      const topLeft = current[top * width + left];
      const topRight = current[top * width + left + 1];
      const bottomLeft = current[(top + 1) * width + left];
      const bottomRight = current[(top + 1) * width + left + 1];
      const interpolated =
        topLeft * (1 - fractionX) * (1 - fractionY) +
        topRight * fractionX * (1 - fractionY) +
        bottomLeft * (1 - fractionX) * fractionY +
        bottomRight * fractionX * fractionY;
      error += Math.abs(baseline[y * width + x] - interpolated);
      count += 1;
    }
  }
  return count > 0 ? error / count : Number.POSITIVE_INFINITY;
}

function noTransformEstimate(
  assessed: boolean,
  improvement = 0,
): CameraTransformEstimate {
  return {
    assessed,
    shiftX: 0,
    shiftY: 0,
    scale: 1,
    rotationDegrees: 0,
    movement: "none",
    improvement,
  };
}

function movementKind(
  shiftX: number,
  shiftY: number,
  scale: number,
  rotationDegrees: number,
): CameraMovementKind {
  const parts = [
    shiftX !== 0 || shiftY !== 0,
    scale !== 1,
    rotationDegrees !== 0,
  ];
  const partCount = parts.filter(Boolean).length;
  if (partCount > 1) return "combined";
  if (parts[0]) return "translation";
  if (parts[1]) return "zoom";
  if (parts[2]) return "rotation";
  return "none";
}

/**
 * Estimates a small whole-frame similarity transform. The deliberately coarse
 * transform grid avoids treating swimmer or splash deformation as camera
 * movement while still covering the pan, zoom and roll normally caused by a
 * bumped poolside camera.
 */
export function estimateCameraTransform(
  baselineThumbnail: CameraMotionThumbnail,
  currentThumbnail: CameraMotionThumbnail,
): CameraTransformEstimate {
  assertThumbnail(baselineThumbnail);
  assertThumbnail(currentThumbnail);
  if (
    baselineThumbnail.width !== currentThumbnail.width ||
    baselineThumbnail.height !== currentThumbnail.height
  ) {
    throw new RangeError("Camera-motion thumbnails must have the same size.");
  }

  const { width, height } = baselineThumbnail;
  const baseline = edgeMap(baselineThumbnail);
  const current = edgeMap(currentThumbnail);
  const texture = Math.min(
    averageTexture(baseline),
    averageTexture(current),
  );
  if (texture < MINIMUM_TEXTURE) return noTransformEstimate(false);

  const zeroScore = transformedScore(
    baseline,
    current,
    width,
    height,
    0,
    0,
    1,
    0,
  );
  let bestScore = zeroScore;
  let bestShiftX = 0;
  let bestShiftY = 0;
  let bestScale = 1;
  let bestRotationDegrees = 0;

  // First find the dominant pan on the identity transform. Zoom and rotation
  // around the frame centre only perturb that translation by a small amount,
  // so the more expensive similarity search can stay local to this anchor.
  for (
    let shiftY = -MAX_SHIFT_PIXELS;
    shiftY <= MAX_SHIFT_PIXELS;
    shiftY += 1
  ) {
    for (
      let shiftX = -MAX_SHIFT_PIXELS;
      shiftX <= MAX_SHIFT_PIXELS;
      shiftX += 1
    ) {
      if (shiftX === 0 && shiftY === 0) continue;
      const score = transformedScore(
        baseline,
        current,
        width,
        height,
        shiftX,
        shiftY,
        1,
        0,
      );
      if (score < bestScore) {
        bestScore = score;
        bestShiftX = shiftX;
        bestShiftY = shiftY;
      }
    }
  }

  const translationAnchorX = bestShiftX;
  const translationAnchorY = bestShiftY;
  for (const scale of SCALE_CANDIDATES) {
    for (const rotationDegrees of ROTATION_CANDIDATES_DEGREES) {
      for (
        let shiftY = Math.max(
          -MAX_SHIFT_PIXELS,
          translationAnchorY - 1,
        );
        shiftY <=
        Math.min(MAX_SHIFT_PIXELS, translationAnchorY + 1);
        shiftY += 1
      ) {
        for (
          let shiftX = Math.max(
            -MAX_SHIFT_PIXELS,
            translationAnchorX - 1,
          );
          shiftX <=
          Math.min(MAX_SHIFT_PIXELS, translationAnchorX + 1);
          shiftX += 1
        ) {
          if (
            shiftX === 0 &&
            shiftY === 0 &&
            scale === 1 &&
            rotationDegrees === 0
          ) {
            continue;
          }
          const score = transformedScore(
            baseline,
            current,
            width,
            height,
            shiftX,
            shiftY,
            scale,
            rotationDegrees,
          );
          if (score < bestScore) {
            bestScore = score;
            bestShiftX = shiftX;
            bestShiftY = shiftY;
            bestScale = scale;
            bestRotationDegrees = rotationDegrees;
          }
        }
      }
    }
  }

  const improvement =
    zeroScore > Number.EPSILON
      ? (zeroScore - bestScore) / zeroScore
      : 0;
  if (improvement < MINIMUM_SCORE_IMPROVEMENT) {
    return noTransformEstimate(true, improvement);
  }
  return {
    assessed: true,
    shiftX: bestShiftX,
    shiftY: bestShiftY,
    scale: bestScale,
    rotationDegrees: bestRotationDegrees,
    movement: movementKind(
      bestShiftX,
      bestShiftY,
      bestScale,
      bestRotationDegrees,
    ),
    improvement,
  };
}

function normalizedMovementVector(
  estimate: CameraTransformEstimate,
): readonly [number, number, number, number] | null {
  const vector = [
    estimate.shiftX / MAX_SHIFT_PIXELS,
    estimate.shiftY / MAX_SHIFT_PIXELS,
    (estimate.scale - 1) / 0.08,
    estimate.rotationDegrees / 5,
  ] as const;
  const length = Math.hypot(...vector);
  if (length <= Number.EPSILON) return null;
  return [
    vector[0] / length,
    vector[1] / length,
    vector[2] / length,
    vector[3] / length,
  ];
}

/** Pure summary used by the monitor and deterministic validation tests. */
export function classifyCameraStability(
  observations: readonly CameraTransformEstimate[],
): CameraStabilityState {
  if (observations.length < 3) return "unassessable";
  const assessed = observations.filter((observation) => observation.assessed);
  if (
    assessed.length < 3 ||
    assessed.length / observations.length < MINIMUM_ASSESSABLE_RATIO
  ) {
    return "unassessable";
  }

  const moving = assessed.filter(
    (observation) => observation.movement !== "none",
  );
  if (moving.length < 2 || moving.length / assessed.length < 0.45) {
    return "stable";
  }

  const direction = [0, 0, 0, 0];
  let vectorCount = 0;
  for (const observation of moving) {
    const vector = normalizedMovementVector(observation);
    if (!vector) continue;
    vectorCount += 1;
    for (let index = 0; index < direction.length; index += 1) {
      direction[index] += vector[index];
    }
  }
  if (vectorCount < 2) return "unassessable";
  return Math.hypot(...direction) >=
    vectorCount * MINIMUM_CONSISTENT_DIRECTION
    ? "moving"
    : "unassessable";
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
  private observations: CameraTransformEstimate[] = [];
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  get cameraMotionDetected(): boolean {
    return this.stabilityState === "moving";
  }

  get stabilityState(): CameraStabilityState {
    return classifyCameraStability(this.observations);
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
    this.observations.push(
      estimateCameraTransform(this.baseline, thumbnail),
    );
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
