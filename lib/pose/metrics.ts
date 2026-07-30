import {
  POSE_LANDMARK_INDEX,
  type ImageDimensions,
  type MetricStatus,
  type MetricUnit,
  type MetricValue,
  type Point2D,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarkIndex,
  type RangeOfMotionSummary,
  type TimedMetricValue,
  type TimedTrajectoryPoint,
  type TrajectorySummary,
} from "../../types/analysis";

export const DEFAULT_VISIBILITY_THRESHOLD = 0.5;
export const MAX_VIDEO_SAMPLE_RATE_HZ = 30;

export type StandardPoseMetricKey =
  | "leftElbowAngle"
  | "rightElbowAngle"
  | "leftShoulderAngle"
  | "rightShoulderAngle"
  | "leftHipAngle"
  | "rightHipAngle"
  | "leftKneeAngle"
  | "rightKneeAngle"
  | "leftAnkleAngle"
  | "rightAnkleAngle"
  | "trunkLean"
  | "shoulderTilt"
  | "hipTilt";

type LandmarkInput = PoseLandmark | null | undefined;

interface PointAssessment {
  readonly confidence: number;
  readonly status: MetricStatus;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assertVisibilityThreshold(threshold: number): void {
  if (!isFiniteNumber(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("visibilityThreshold must be between 0 and 1.");
  }
}

function assessPoints(
  points: readonly LandmarkInput[],
  visibilityThreshold: number,
): PointAssessment {
  assertVisibilityThreshold(visibilityThreshold);

  if (
    points.length === 0 ||
    points.some(
      (point) =>
        !point ||
        !isFiniteNumber(point.x) ||
        !isFiniteNumber(point.y) ||
        !isFiniteNumber(point.visibility),
    )
  ) {
    return { confidence: 0, status: "unavailable" };
  }

  const confidence = Math.min(
    ...points.map((point) => clampConfidence(point!.visibility)),
  );

  return {
    confidence,
    status:
      confidence < visibilityThreshold ? "low-confidence" : "valid",
  };
}

function createMetric(
  value: number,
  unit: MetricUnit,
  assessment: PointAssessment,
): MetricValue {
  if (assessment.status !== "valid") {
    return {
      value: null,
      unit,
      confidence: assessment.confidence,
      status: assessment.status,
    };
  }

  if (!isFiniteNumber(value)) {
    return {
      value: null,
      unit,
      confidence: assessment.confidence,
      status: "unavailable",
    };
  }

  return {
    value,
    unit,
    confidence: assessment.confidence,
    status: "valid",
  };
}

function suppressedMetric(
  unit: MetricUnit,
  status: Exclude<MetricStatus, "valid">,
  confidence = 0,
): MetricValue {
  return {
    value: null,
    unit,
    confidence: clampConfidence(confidence),
    status,
  };
}

function getLandmark(
  frame: PoseFrame,
  index: PoseLandmarkIndex,
): PoseLandmark | undefined {
  return frame.landmarks[index];
}

/**
 * 3点 a-b-c の、bを頂点とする画像平面上の角度を返す。
 * 戻り値は0〜180度。必要な点のvisibilityが閾値未満なら値を抑止する。
 */
export function calculateAngle2D(
  a: LandmarkInput,
  b: LandmarkInput,
  c: LandmarkInput,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): MetricValue {
  const assessment = assessPoints([a, b, c], visibilityThreshold);
  if (assessment.status !== "valid" || !a || !b || !c) {
    return createMetric(Number.NaN, "deg", assessment);
  }

  const firstX = a.x - b.x;
  const firstY = a.y - b.y;
  const secondX = c.x - b.x;
  const secondY = c.y - b.y;
  const firstLength = Math.hypot(firstX, firstY);
  const secondLength = Math.hypot(secondX, secondY);

  if (firstLength === 0 || secondLength === 0) {
    return suppressedMetric("deg", "unavailable", assessment.confidence);
  }

  const cosine = Math.min(
    1,
    Math.max(
      -1,
      (firstX * secondX + firstY * secondY) /
        (firstLength * secondLength),
    ),
  );

  return createMetric(
    (Math.acos(cosine) * 180) / Math.PI,
    "deg",
    assessment,
  );
}

export function calculateJointAngle(
  frame: PoseFrame,
  first: PoseLandmarkIndex,
  vertex: PoseLandmarkIndex,
  third: PoseLandmarkIndex,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): MetricValue {
  return calculateAngle2D(
    getLandmark(frame, first),
    getLandmark(frame, vertex),
    getLandmark(frame, third),
    visibilityThreshold,
  );
}

/**
 * 腰中心から肩中心へ向かう線と、画像上方向との符号付き角度。
 * 正は画面右側へ、負は画面左側へ肩中心が傾いていることを示す。
 */
export function calculateTrunkLean(
  frame: PoseFrame,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): MetricValue {
  const leftShoulder = getLandmark(
    frame,
    POSE_LANDMARK_INDEX.left_shoulder,
  );
  const rightShoulder = getLandmark(
    frame,
    POSE_LANDMARK_INDEX.right_shoulder,
  );
  const leftHip = getLandmark(frame, POSE_LANDMARK_INDEX.left_hip);
  const rightHip = getLandmark(frame, POSE_LANDMARK_INDEX.right_hip);
  const assessment = assessPoints(
    [leftShoulder, rightShoulder, leftHip, rightHip],
    visibilityThreshold,
  );

  if (
    assessment.status !== "valid" ||
    !leftShoulder ||
    !rightShoulder ||
    !leftHip ||
    !rightHip
  ) {
    return createMetric(Number.NaN, "deg", assessment);
  }

  const shoulderX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipX = (leftHip.x + rightHip.x) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const deltaX = shoulderX - hipX;
  const deltaY = shoulderY - hipY;

  if (deltaX === 0 && deltaY === 0) {
    return suppressedMetric("deg", "unavailable", assessment.confidence);
  }

  return createMetric(
    (Math.atan2(deltaX, -deltaY) * 180) / Math.PI,
    "deg",
    assessment,
  );
}

/**
 * 2点を結ぶ線の画面水平線に対する傾き（-90〜90度）。
 * 正は画面の左から右へ向かって下がる線を示す。
 */
export function calculateLineTilt(
  first: LandmarkInput,
  second: LandmarkInput,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): MetricValue {
  const assessment = assessPoints([first, second], visibilityThreshold);
  if (assessment.status !== "valid" || !first || !second) {
    return createMetric(Number.NaN, "deg", assessment);
  }

  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  if (deltaX === 0 && deltaY === 0) {
    return suppressedMetric("deg", "unavailable", assessment.confidence);
  }

  let angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
  if (angle > 90) {
    angle -= 180;
  } else if (angle < -90) {
    angle += 180;
  }

  return createMetric(angle, "deg", assessment);
}

export function calculateShoulderTilt(
  frame: PoseFrame,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): MetricValue {
  return calculateLineTilt(
    getLandmark(frame, POSE_LANDMARK_INDEX.left_shoulder),
    getLandmark(frame, POSE_LANDMARK_INDEX.right_shoulder),
    visibilityThreshold,
  );
}

export function calculateHipTilt(
  frame: PoseFrame,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): MetricValue {
  return calculateLineTilt(
    getLandmark(frame, POSE_LANDMARK_INDEX.left_hip),
    getLandmark(frame, POSE_LANDMARK_INDEX.right_hip),
    visibilityThreshold,
  );
}

function withTimestamp(
  value: MetricValue,
  timestampMs: number,
): TimedMetricValue {
  return { ...value, timestampMs };
}

/** 解析画面で標準表示する左右の主要関節角度と体幹指標。 */
export function calculateStandardPoseMetrics(
  frame: PoseFrame,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): Readonly<Record<StandardPoseMetricKey, TimedMetricValue>> {
  const angle = (
    first: PoseLandmarkIndex,
    vertex: PoseLandmarkIndex,
    third: PoseLandmarkIndex,
  ) =>
    withTimestamp(
      calculateJointAngle(
        frame,
        first,
        vertex,
        third,
        visibilityThreshold,
      ),
      frame.timestampMs,
    );

  return {
    leftElbowAngle: angle(
      POSE_LANDMARK_INDEX.left_shoulder,
      POSE_LANDMARK_INDEX.left_elbow,
      POSE_LANDMARK_INDEX.left_wrist,
    ),
    rightElbowAngle: angle(
      POSE_LANDMARK_INDEX.right_shoulder,
      POSE_LANDMARK_INDEX.right_elbow,
      POSE_LANDMARK_INDEX.right_wrist,
    ),
    leftShoulderAngle: angle(
      POSE_LANDMARK_INDEX.left_elbow,
      POSE_LANDMARK_INDEX.left_shoulder,
      POSE_LANDMARK_INDEX.left_hip,
    ),
    rightShoulderAngle: angle(
      POSE_LANDMARK_INDEX.right_elbow,
      POSE_LANDMARK_INDEX.right_shoulder,
      POSE_LANDMARK_INDEX.right_hip,
    ),
    leftHipAngle: angle(
      POSE_LANDMARK_INDEX.left_shoulder,
      POSE_LANDMARK_INDEX.left_hip,
      POSE_LANDMARK_INDEX.left_knee,
    ),
    rightHipAngle: angle(
      POSE_LANDMARK_INDEX.right_shoulder,
      POSE_LANDMARK_INDEX.right_hip,
      POSE_LANDMARK_INDEX.right_knee,
    ),
    leftKneeAngle: angle(
      POSE_LANDMARK_INDEX.left_hip,
      POSE_LANDMARK_INDEX.left_knee,
      POSE_LANDMARK_INDEX.left_ankle,
    ),
    rightKneeAngle: angle(
      POSE_LANDMARK_INDEX.right_hip,
      POSE_LANDMARK_INDEX.right_knee,
      POSE_LANDMARK_INDEX.right_ankle,
    ),
    leftAnkleAngle: angle(
      POSE_LANDMARK_INDEX.left_knee,
      POSE_LANDMARK_INDEX.left_ankle,
      POSE_LANDMARK_INDEX.left_foot_index,
    ),
    rightAnkleAngle: angle(
      POSE_LANDMARK_INDEX.right_knee,
      POSE_LANDMARK_INDEX.right_ankle,
      POSE_LANDMARK_INDEX.right_foot_index,
    ),
    trunkLean: withTimestamp(
      calculateTrunkLean(frame, visibilityThreshold),
      frame.timestampMs,
    ),
    shoulderTilt: withTimestamp(
      calculateShoulderTilt(frame, visibilityThreshold),
      frame.timestampMs,
    ),
    hipTilt: withTimestamp(
      calculateHipTilt(frame, visibilityThreshold),
      frame.timestampMs,
    ),
  };
}

/**
 * 時系列の有効値だけから最小・最大・可動域・平均を計算する。
 * 異なる単位を混ぜた場合は、呼び出し側の不具合として例外にする。
 */
export function summarizeRangeOfMotion(
  samples: readonly TimedMetricValue[],
  unit: MetricUnit = samples[0]?.unit ?? "deg",
): RangeOfMotionSummary {
  const validSamples = samples.filter(
    (
      sample,
    ): sample is TimedMetricValue & {
      readonly value: number;
      readonly status: "valid";
    } => sample.status === "valid" && isFiniteNumber(sample.value),
  );

  if (validSamples.some((sample) => sample.unit !== unit)) {
    throw new RangeError("Range-of-motion samples must use one unit.");
  }

  if (validSamples.length === 0) {
    const lowConfidenceSamples = samples.filter(
      (sample) => sample.status === "low-confidence",
    );
    const status: Exclude<MetricStatus, "valid"> =
      lowConfidenceSamples.length > 0 ? "low-confidence" : "unavailable";
    const confidence =
      lowConfidenceSamples.length > 0
        ? Math.max(
            ...lowConfidenceSamples.map((sample) =>
              clampConfidence(sample.confidence),
            ),
          )
        : 0;
    const empty = suppressedMetric(unit, status, confidence);

    return {
      minimum: empty,
      maximum: empty,
      range: empty,
      mean: empty,
      minimumTimestampMs: null,
      maximumTimestampMs: null,
      sampleCount: samples.length,
      validSampleCount: 0,
    };
  }

  let minimum = validSamples[0];
  let maximum = validSamples[0];
  let sum = 0;
  let confidence = 1;

  for (const sample of validSamples) {
    if (sample.value < minimum.value) {
      minimum = sample;
    }
    if (sample.value > maximum.value) {
      maximum = sample;
    }
    sum += sample.value;
    confidence = Math.min(confidence, clampConfidence(sample.confidence));
  }

  const assessment: PointAssessment = { status: "valid", confidence };

  return {
    minimum: createMetric(minimum.value, unit, {
      status: "valid",
      confidence: clampConfidence(minimum.confidence),
    }),
    maximum: createMetric(maximum.value, unit, {
      status: "valid",
      confidence: clampConfidence(maximum.confidence),
    }),
    range: createMetric(maximum.value - minimum.value, unit, assessment),
    mean: createMetric(sum / validSamples.length, unit, assessment),
    minimumTimestampMs: minimum.timestampMs,
    maximumTimestampMs: maximum.timestampMs,
    sampleCount: samples.length,
    validSampleCount: validSamples.length,
  };
}

export function landmarkTrajectoryPoints(
  frames: readonly PoseFrame[],
  index: PoseLandmarkIndex,
): readonly TimedTrajectoryPoint[] {
  return frames.flatMap((frame) => {
    const landmark = getLandmark(frame, index);
    if (!landmark) {
      return [];
    }

    return [
      {
        x: landmark.x,
        y: landmark.y,
        visibility: landmark.visibility,
        timestampMs: frame.timestampMs,
      },
    ];
  });
}

export function midpointTrajectoryPoints(
  frames: readonly PoseFrame[],
  firstIndex: PoseLandmarkIndex,
  secondIndex: PoseLandmarkIndex,
): readonly TimedTrajectoryPoint[] {
  return frames.flatMap((frame) => {
    const first = getLandmark(frame, firstIndex);
    const second = getLandmark(frame, secondIndex);
    if (!first || !second) {
      return [];
    }

    return [
      {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
        visibility: Math.min(first.visibility, second.visibility),
        timestampMs: frame.timestampMs,
      },
    ];
  });
}

/**
 * 正規化座標の軌跡を要約する。
 *
 * pathLengthは低信頼度点をまたいで線を結ばず、連続した有効点間だけを
 * 合計する。displacementは最初と最後の有効点の直線距離。
 */
export function summarizeTrajectory(
  points: readonly TimedTrajectoryPoint[],
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): TrajectorySummary {
  assertVisibilityThreshold(visibilityThreshold);
  const orderedPoints = [...points].sort(
    (first, second) => first.timestampMs - second.timestampMs,
  );
  const validPoints: TimedTrajectoryPoint[] = [];
  let lowConfidenceSampleCount = 0;
  let pathLength = 0;
  let previousValidPoint: TimedTrajectoryPoint | null = null;

  for (const point of orderedPoints) {
    const coordinatesAreValid =
      isFiniteNumber(point.x) &&
      isFiniteNumber(point.y) &&
      isFiniteNumber(point.timestampMs) &&
      isFiniteNumber(point.visibility);
    const visibility = coordinatesAreValid
      ? clampConfidence(point.visibility)
      : 0;

    if (!coordinatesAreValid || visibility < visibilityThreshold) {
      if (coordinatesAreValid && visibility < visibilityThreshold) {
        lowConfidenceSampleCount += 1;
      }
      previousValidPoint = null;
      continue;
    }

    if (previousValidPoint) {
      pathLength += Math.hypot(
        point.x - previousValidPoint.x,
        point.y - previousValidPoint.y,
      );
    }
    validPoints.push(point);
    previousValidPoint = point;
  }

  const firstPoint = validPoints[0] ?? null;
  const lastPoint = validPoints.at(-1) ?? null;
  const confidence =
    validPoints.length > 0
      ? Math.min(
          ...validPoints.map((point) => clampConfidence(point.visibility)),
        )
      : 0;
  const insufficientStatus: Exclude<MetricStatus, "valid"> =
    validPoints.length === 0 && lowConfidenceSampleCount > 0
      ? "low-confidence"
      : "unavailable";

  if (!firstPoint || !lastPoint) {
    const empty = suppressedMetric(
      "normalized",
      insufficientStatus,
      confidence,
    );
    return {
      pathLength: empty,
      displacement: empty,
      rangeX: empty,
      rangeY: empty,
      bounds: null,
      firstTimestampMs: null,
      lastTimestampMs: null,
      durationMs: 0,
      sampleCount: points.length,
      validSampleCount: 0,
      lowConfidenceSampleCount,
    };
  }

  const xValues = validPoints.map((point) => point.x);
  const yValues = validPoints.map((point) => point.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const assessment: PointAssessment = { status: "valid", confidence };
  const hasMotionPair = validPoints.length >= 2;
  const motionAssessment: PointAssessment = hasMotionPair
    ? assessment
    : { status: "unavailable", confidence };

  return {
    pathLength: createMetric(
      hasMotionPair ? pathLength : Number.NaN,
      "normalized",
      motionAssessment,
    ),
    displacement: createMetric(
      hasMotionPair
        ? Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y)
        : Number.NaN,
      "normalized",
      motionAssessment,
    ),
    rangeX: createMetric(maxX - minX, "normalized", assessment),
    rangeY: createMetric(maxY - minY, "normalized", assessment),
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
    firstTimestampMs: firstPoint.timestampMs,
    lastTimestampMs: lastPoint.timestampMs,
    durationMs: Math.max(0, lastPoint.timestampMs - firstPoint.timestampMs),
    sampleCount: points.length,
    validSampleCount: validPoints.length,
    lowConfidenceSampleCount,
  };
}

export function summarizeLandmarkTrajectory(
  frames: readonly PoseFrame[],
  index: PoseLandmarkIndex,
  visibilityThreshold = DEFAULT_VISIBILITY_THRESHOLD,
): TrajectorySummary {
  return summarizeTrajectory(
    landmarkTrajectoryPoints(frames, index),
    visibilityThreshold,
  );
}

/** 正規化座標を描画用pixel座標へ変換する。 */
export function normalizedToPixel(
  point: Point2D,
  dimensions: ImageDimensions,
  mirrored = false,
): Point2D {
  if (
    !isFiniteNumber(dimensions.width) ||
    !isFiniteNumber(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new RangeError("Image dimensions must be positive finite numbers.");
  }

  return {
    x: (mirrored ? 1 - point.x : point.x) * dimensions.width,
    y: point.y * dimensions.height,
  };
}

/** 描画の左右反転用。解剖学的なleft/right index自体は入れ替えない。 */
export function mirrorNormalizedLandmark(
  landmark: PoseLandmark,
): PoseLandmark {
  return { ...landmark, x: 1 - landmark.x };
}

export function timestampMsForSample(
  sampleIndex: number,
  sampleRateHz: number,
): number {
  if (!Number.isInteger(sampleIndex) || sampleIndex < 0) {
    throw new RangeError("sampleIndex must be a non-negative integer.");
  }
  if (!isFiniteNumber(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError("sampleRateHz must be a positive finite number.");
  }

  return (sampleIndex * 1000) / sampleRateHz;
}

/**
 * 動画先頭を0msとして、終端を含まない固定時刻列を作る。
 * 呼び出し側が30Hzを超えて指定しても30Hzへ制限する。
 */
export function createFixedSampleTimestamps(
  durationMs: number,
  requestedSampleRateHz = MAX_VIDEO_SAMPLE_RATE_HZ,
): readonly number[] {
  if (!isFiniteNumber(durationMs) || durationMs < 0) {
    throw new RangeError("durationMs must be a non-negative finite number.");
  }
  if (
    !isFiniteNumber(requestedSampleRateHz) ||
    requestedSampleRateHz <= 0
  ) {
    throw new RangeError(
      "requestedSampleRateHz must be a positive finite number.",
    );
  }
  if (durationMs === 0) {
    return [];
  }

  const sampleRateHz = Math.min(
    requestedSampleRateHz,
    MAX_VIDEO_SAMPLE_RATE_HZ,
  );
  const sampleCount = Math.ceil((durationMs * sampleRateHz) / 1000 - 1e-12);

  return Array.from({ length: sampleCount }, (_, index) =>
    Number(timestampMsForSample(index, sampleRateHz).toFixed(6)),
  );
}
