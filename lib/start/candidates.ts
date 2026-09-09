import { POSE_LANDMARK_INDEX, type Point2D, type PoseFrame, type PoseLandmark } from "../../types/analysis";
import type {
  StartCalibrationV1,
  StartEvent,
  StartEventStatus,
  StartEventType,
  StartStyle,
} from "../../types/start";
import { createStartEventCandidate } from "./analysis";

const MIN_VISIBILITY = 0.5;
const MOTION_DISTANCE = 0.012;
const HAND_OR_FOOT_DISTANCE = 0.025;
const TAKEOFF_DISTANCE = 0.035;

type CandidatePoint = Point2D & { readonly visibility: number };

interface CandidateDetection {
  readonly timestampMs: number;
  readonly frameIndex: number | null;
  readonly point: Point2D | null;
  readonly confidence: number;
}

export interface StartCandidateOptions {
  /** 時刻順でなくてもよい。重複時は元動画のフレーム番号を優先する。 */
  readonly frames: readonly PoseFrame[];
  readonly calibration?: StartCalibrationV1 | null;
  readonly travelDirection?: StartCalibrationV1["travelDirection"];
  readonly startStyle: StartStyle;
  /** Web Audio 等で得られた号砲候補。未取得ならPose候補を過信しない。 */
  readonly signalTimestampMs?: number | null;
  readonly signalFrameIndex?: number | null;
  /** 音声ピークの明瞭さ。校正済み確率ではない。 */
  readonly signalConfidence?: number;
  readonly minimumVisibility?: number;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function bounded(value: number): number {
  return finite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function point(landmark: PoseLandmark | undefined, threshold: number): CandidatePoint | null {
  if (!landmark || !finite(landmark.x) || !finite(landmark.y) || !finite(landmark.visibility) || landmark.visibility < threshold) {
    return null;
  }
  return { x: landmark.x, y: landmark.y, visibility: landmark.visibility };
}

function midpoint(first: CandidatePoint | null, second: CandidatePoint | null): CandidatePoint | null {
  if (!first || !second) return null;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    visibility: Math.min(first.visibility, second.visibility),
  };
}

function distance(first: Point2D, second: Point2D): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function surfaceYAt(x: number, calibration: StartCalibrationV1): number | null {
  const [first, second] = calibration.waterSurface;
  const deltaX = second.x - first.x;
  if (!finite(deltaX) || Math.abs(deltaX) < Number.EPSILON) return null;
  const ratio = (x - first.x) / deltaX;
  const value = first.y + (second.y - first.y) * ratio;
  return finite(value) ? value : null;
}

function normalizedFrames(frames: readonly PoseFrame[]): readonly PoseFrame[] {
  return frames
    .filter((frame) => finite(frame.timestampMs) && frame.timestampMs >= 0)
    .slice()
    .sort((first, second) =>
      first.timestampMs - second.timestampMs ||
      (first.sourceFrameIndex ?? Number.MAX_SAFE_INTEGER) - (second.sourceFrameIndex ?? Number.MAX_SAFE_INTEGER),
    );
}

function typicalFrameIntervalMs(frames: readonly PoseFrame[]): number | null {
  const intervals = frames
    .slice(1)
    .map((frame, index) => frame.timestampMs - frames[index].timestampMs)
    .filter((value) => finite(value) && value > 0)
    .sort((first, second) => first - second);
  if (intervals.length === 0) return null;
  return intervals[Math.floor(intervals.length / 2)];
}

function transitionConfidence(
  visibilityByFrame: readonly number[],
  displacements: readonly number[],
  minimumDistance: number,
): number {
  if (visibilityByFrame.length === 0 || displacements.length === 0) return 0;
  const minimumVisibility = Math.min(...visibilityByFrame);
  const strongestRatio = Math.max(...displacements) / minimumDistance;
  const magnitudeScore = bounded((strongestRatio - 1) / 1.5);
  const sustained = displacements.length >= 2 && displacements.every((value) => value >= minimumDistance * 0.85);
  const sustainedScore = sustained ? displacements.length >= 3 ? 1 : 0.8 : 0.2;
  return bounded(minimumVisibility * 0.45 + magnitudeScore * 0.3 + sustainedScore * 0.25);
}

function frameIndex(frame: PoseFrame, fallback: number): number {
  return Number.isInteger(frame.sourceFrameIndex) && (frame.sourceFrameIndex ?? -1) >= 0
    ? frame.sourceFrameIndex!
    : fallback;
}

function trunk(frame: PoseFrame, threshold: number): CandidatePoint | null {
  const hips = midpoint(
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_hip], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_hip], threshold),
  );
  return hips ?? midpoint(
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_shoulder], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_shoulder], threshold),
  );
}

function hands(frame: PoseFrame, threshold: number): CandidatePoint | null {
  return midpoint(
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_wrist], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_wrist], threshold),
  );
}

function feet(frame: PoseFrame, threshold: number): readonly [CandidatePoint | null, CandidatePoint | null] {
  const left = midpoint(
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_heel], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_foot_index], threshold),
  ) ?? point(frame.landmarks[POSE_LANDMARK_INDEX.left_ankle], threshold);
  const right = midpoint(
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_heel], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_foot_index], threshold),
  ) ?? point(frame.landmarks[POSE_LANDMARK_INDEX.right_ankle], threshold);
  return [left, right];
}

/**
 * MediaPipe Poseに頭頂ランドマークはないため、可視な顔点の最遠端を
 * 肩中心→顔中心の身体軸方向へわずかに外挿して頭頂推定点を作る。
 * 交差前後で点集合が変わるだけの座標跳びを避けるため、鼻・両目・両耳の
 * 5点がすべて可視でないフレームは自動候補に使用しない。
 */
function estimatedHeadTop(frame: PoseFrame, threshold: number): CandidatePoint | null {
  const shoulders = midpoint(
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_shoulder], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_shoulder], threshold),
  );
  const nose = point(frame.landmarks[POSE_LANDMARK_INDEX.nose], threshold);
  const face = [
    nose,
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_eye_outer], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_eye_outer], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.left_ear], threshold),
    point(frame.landmarks[POSE_LANDMARK_INDEX.right_ear], threshold),
  ].filter((item): item is CandidatePoint => item !== null);
  if (!shoulders || !nose || face.length !== 5) return null;

  const faceCenter = {
    x: face.reduce((sum, item) => sum + item.x, 0) / face.length,
    y: face.reduce((sum, item) => sum + item.y, 0) / face.length,
  };
  const axisX = faceCenter.x - shoulders.x;
  const axisY = faceCenter.y - shoulders.y;
  const axisLength = Math.hypot(axisX, axisY);
  if (!finite(axisLength) || axisLength < 0.015 || axisLength > 0.35) return null;
  const unitX = axisX / axisLength;
  const unitY = axisY / axisLength;
  const distal = face.reduce((best, item) => {
    const projection = (item.x - shoulders.x) * unitX + (item.y - shoulders.y) * unitY;
    const bestProjection = (best.x - shoulders.x) * unitX + (best.y - shoulders.y) * unitY;
    return projection > bestProjection ? item : best;
  }, face[0]);
  const faceSpan = Math.max(...face.map((item) => distance(item, faceCenter)));
  const padding = Math.min(axisLength * 0.25, Math.max(0.003, faceSpan * 0.35));
  const estimated = { x: distal.x + unitX * padding, y: distal.y + unitY * padding };
  if (estimated.x < 0 || estimated.x > 1 || estimated.y < 0 || estimated.y > 1) return null;
  return {
    ...estimated,
    visibility: Math.min(shoulders.visibility, ...face.map((item) => item.visibility)),
  };
}

function firstUsable<T>(
  frames: readonly PoseFrame[],
  get: (frame: PoseFrame) => T | null,
): { readonly frame: PoseFrame; readonly value: T } | null {
  for (const frame of frames) {
    const value = get(frame);
    if (value !== null) return { frame, value };
  }
  return null;
}

function firstDisplaced(
  frames: readonly PoseFrame[],
  initial: Point2D,
  get: (frame: PoseFrame) => CandidatePoint | null,
  minimumDistance: number,
  lowerBoundMs: number | null,
  frameIntervalMs: number | null,
): CandidateDetection | null {
  let previous: CandidatePoint | null = null;
  let previousFrame: PoseFrame | null = null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const current = get(frame);
    if (!current) {
      previous = null;
      previousFrame = null;
      continue;
    }
    if (lowerBoundMs !== null && frame.timestampMs < lowerBoundMs) {
      previous = current;
      previousFrame = frame;
      continue;
    }
    const currentDistance = distance(current, initial);
    const crossedContinuously = previous !== null && previousFrame !== null &&
      distance(previous, initial) < minimumDistance && currentDistance >= minimumDistance &&
      (frameIntervalMs === null || frame.timestampMs - previousFrame.timestampMs <= frameIntervalMs * 1.75);
    if (!crossedContinuously) {
      previous = current;
      previousFrame = frame;
      continue;
    }
    const evidence: CandidatePoint[] = [current];
    for (let offset = 1; offset <= 2; offset += 1) {
      const nextFrame = frames[index + offset];
      if (!nextFrame) break;
      const previousFrame = frames[index + offset - 1];
      if (frameIntervalMs !== null && nextFrame.timestampMs - previousFrame.timestampMs > frameIntervalMs * 1.75) break;
      const next = get(nextFrame);
      if (!next) break;
      evidence.push(next);
    }
    const displacements = evidence.map((item) => distance(item, initial));
    return {
      timestampMs: frame.timestampMs,
      frameIndex: frameIndex(frame, index),
      point: { x: current.x, y: current.y },
      confidence: transitionConfidence(evidence.map((item) => item.visibility), displacements, minimumDistance),
    };
  }
  return null;
}

function firstTakeoff(
  frames: readonly PoseFrame[],
  initial: readonly [CandidatePoint | null, CandidatePoint | null],
  threshold: number,
  lowerBoundMs: number | null,
  frameIntervalMs: number | null,
): CandidateDetection | null {
  if (!initial[0] || !initial[1]) return null;
  let previous: readonly [CandidatePoint, CandidatePoint] | null = null;
  let previousFrame: PoseFrame | null = null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const current = feet(frame, threshold);
    if (!current[0] || !current[1]) {
      previous = null;
      previousFrame = null;
      continue;
    }
    const currentPair = [current[0], current[1]] as const;
    if (lowerBoundMs !== null && frame.timestampMs < lowerBoundMs) {
      previous = currentPair;
      previousFrame = frame;
      continue;
    }
    const leftDisplacement = distance(initial[0], current[0]);
    const rightDisplacement = distance(initial[1], current[1]);
    const currentMinimum = Math.min(leftDisplacement, rightDisplacement);
    const previousMinimum = previous
      ? Math.min(distance(initial[0], previous[0]), distance(initial[1], previous[1]))
      : Number.POSITIVE_INFINITY;
    const crossedContinuously = previous !== null && previousFrame !== null &&
      previousMinimum < TAKEOFF_DISTANCE && currentMinimum >= TAKEOFF_DISTANCE &&
      (frameIntervalMs === null || frame.timestampMs - previousFrame.timestampMs <= frameIntervalMs * 1.75);
    if (!crossedContinuously) {
      previous = currentPair;
      previousFrame = frame;
      continue;
    }
    const visibilityByFrame: number[] = [Math.min(current[0].visibility, current[1].visibility)];
    const displacements: number[] = [currentMinimum];
    for (let offset = 1; offset <= 2; offset += 1) {
      const nextFrame = frames[index + offset];
      if (!nextFrame) break;
      const previousFrame = frames[index + offset - 1];
      if (frameIntervalMs !== null && nextFrame.timestampMs - previousFrame.timestampMs > frameIntervalMs * 1.75) break;
      const next = feet(nextFrame, threshold);
      if (!next[0] || !next[1]) break;
      visibilityByFrame.push(Math.min(next[0].visibility, next[1].visibility));
      displacements.push(Math.min(distance(initial[0], next[0]), distance(initial[1], next[1])));
    }
    return {
      timestampMs: frame.timestampMs,
      frameIndex: frameIndex(frame, index),
      point: { x: (current[0].x + current[1].x) / 2, y: (current[0].y + current[1].y) / 2 },
      confidence: transitionConfidence(visibilityByFrame, displacements, TAKEOFF_DISTANCE),
    };
  }
  return null;
}

function firstCrossing(
  frames: readonly PoseFrame[],
  getPosition: (frame: PoseFrame) => CandidatePoint | null,
  crossed: (previous: CandidatePoint, current: CandidatePoint) => boolean,
  isBeyond: (current: CandidatePoint) => boolean,
  lowerBoundMs: number | null,
  frameIntervalMs: number | null,
): CandidateDetection | null {
  let previous: CandidatePoint | null = null;
  let previousFrame: PoseFrame | null = null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const current = getPosition(frame);
    if (!current) {
      previous = null;
      previousFrame = null;
      continue;
    }
    if (lowerBoundMs !== null && frame.timestampMs < lowerBoundMs) {
      previous = current;
      previousFrame = frame;
      continue;
    }
    const crossingFramesAreContiguous = previousFrame !== null && (
      frameIntervalMs === null || frame.timestampMs - previousFrame.timestampMs <= frameIntervalMs * 1.75
    );
    if (previous && crossingFramesAreContiguous && crossed(previous, current)) {
      const evidence: CandidatePoint[] = [previous, current];
      for (let offset = 1; offset <= 2; offset += 1) {
        const nextFrame = frames[index + offset];
        if (!nextFrame) break;
        const previousFrame = frames[index + offset - 1];
        if (frameIntervalMs !== null && nextFrame.timestampMs - previousFrame.timestampMs > frameIntervalMs * 1.75) break;
        const next = getPosition(nextFrame);
        if (!next || !isBeyond(next)) break;
        evidence.push(next);
      }
      const minimumVisibility = Math.min(...evidence.map((item) => item.visibility));
      const transitionStrength = bounded(distance(previous, current) / 0.02);
      const sustainedScore = evidence.length >= 4 ? 1 : evidence.length >= 3 ? 0.8 : 0.2;
      return {
        timestampMs: frame.timestampMs,
        frameIndex: frameIndex(frame, index),
        point: { x: current.x, y: current.y },
        confidence: bounded(minimumVisibility * 0.45 + transitionStrength * 0.25 + sustainedScore * 0.3),
      };
    }
    previous = current;
    previousFrame = frame;
  }
  return null;
}

function eventFromDetection(
  type: StartEventType,
  detection: CandidateDetection | null,
  status: StartEventStatus = "candidate",
): StartEvent {
  const event = createStartEventCandidate(type, {
    timestampMs: detection?.timestampMs ?? null,
    frameIndex: detection?.frameIndex ?? null,
    point: detection?.point ?? null,
    confidence: detection?.confidence ?? 0,
  });
  if (event.status === "unavailable") return event;
  return { ...event, status: status === "candidate" && event.confidence >= 0.6 ? "candidate" : "needs-review" };
}

function hideIfOutOfOrder(
  event: StartEvent,
  lowerBoundMs: number | null,
): StartEvent {
  if (event.timestampMs === null || lowerBoundMs === null || event.timestampMs >= lowerBoundMs) return event;
  return eventFromDetection(event.type, null);
}

/**
 * Poseと音声から自動判定前のイベント候補を返す。
 *
 * この関数が返すイベントは verified にならず、算出指標の依存関係を満たさない。
 * 画像外、遮蔽、低い可視性、順序不整合ではnull/unavailableへ安全側に倒す。
 */
export function deriveStartEventCandidates(
  options: StartCandidateOptions,
): readonly StartEvent[] {
  const threshold = options.minimumVisibility ?? MIN_VISIBILITY;
  const calibration = options.calibration ?? null;
  const travelDirection = options.travelDirection ?? calibration?.travelDirection ?? "left-to-right";
  const frames = normalizedFrames(options.frames);
  const frameIntervalMs = typicalFrameIntervalMs(frames);
  const baselineFrames = frames.slice(0, Math.min(8, frames.length));
  const signalDetection = finite(options.signalTimestampMs ?? Number.NaN) && (options.signalTimestampMs ?? -1) >= 0
    ? {
        timestampMs: options.signalTimestampMs!,
        frameIndex: Number.isInteger(options.signalFrameIndex) && (options.signalFrameIndex ?? -1) >= 0
          ? options.signalFrameIndex!
          : null,
        point: null,
        confidence: bounded(options.signalConfidence ?? 0.35),
      }
    : null;
  const signal = eventFromDetection("signal", signalDetection, "needs-review");
  const signalTime = signal.timestampMs;

  const initialTrunk = firstUsable(baselineFrames, (frame) => trunk(frame, threshold));
  const movementDetection = initialTrunk
    ? firstDisplaced(frames, initialTrunk.value, (frame) => trunk(frame, threshold), MOTION_DISTANCE, signalTime, frameIntervalMs)
    : null;
  const movement = hideIfOutOfOrder(eventFromDetection("movement-onset", movementDetection), signalTime);
  const movementTime = movement.timestampMs;

  const initialHands = firstUsable(baselineFrames, (frame) => hands(frame, threshold));
  let handsOff = eventFromDetection(
    "hands-off",
    initialHands
      ? firstDisplaced(frames, initialHands.value, (frame) => hands(frame, threshold), HAND_OR_FOOT_DISTANCE, movementTime, frameIntervalMs)
      : null,
  );

  const baselineFeet = firstUsable(baselineFrames, (frame) => {
    const value = feet(frame, threshold);
    return value[0] && value[1] ? value : null;
  });
  const initialFeet = baselineFeet?.value ?? [null, null] as const;
  const rearInitial = initialFeet[0] && initialFeet[1]
    ? travelDirection === "left-to-right"
      ? initialFeet[0].x <= initialFeet[1].x ? initialFeet[0] : initialFeet[1]
      : initialFeet[0].x >= initialFeet[1].x ? initialFeet[0] : initialFeet[1]
    : null;
  const rearFoot = options.startStyle === "dive"
    ? eventFromDetection(
      "rear-foot-off",
      rearInitial
        ? firstDisplaced(frames, rearInitial, (frame) => {
          const current = feet(frame, threshold);
          if (!current[0] || !current[1]) return null;
          return travelDirection === "left-to-right"
            ? current[0].x <= current[1].x ? current[0] : current[1]
            : current[0].x >= current[1].x ? current[0] : current[1];
        }, HAND_OR_FOOT_DISTANCE, movementTime, frameIntervalMs)
        : null,
    )
    : eventFromDetection("rear-foot-off", null);
  const takeoff = eventFromDetection(
    "takeoff",
    firstTakeoff(frames, initialFeet, threshold, movementTime, frameIntervalMs),
  );

  handsOff = hideIfOutOfOrder(handsOff, movementTime);
  if (takeoff.timestampMs !== null && handsOff.timestampMs !== null && handsOff.timestampMs > takeoff.timestampMs) {
    handsOff = eventFromDetection("hands-off", null);
  }
  const safeRearFoot = takeoff.timestampMs !== null && rearFoot.timestampMs !== null && rearFoot.timestampMs > takeoff.timestampMs
    ? eventFromDetection("rear-foot-off", null)
    : hideIfOutOfOrder(rearFoot, movementTime);

  const entry = calibration
    ? eventFromDetection(
      "head-entry",
      firstCrossing(
      frames,
      (frame) => estimatedHeadTop(frame, threshold),
      (previous, current) => {
        const previousSurface = surfaceYAt(previous.x, calibration);
        const currentSurface = surfaceYAt(current.x, calibration);
        return previousSurface !== null && currentSurface !== null && previous.y < previousSurface && current.y >= currentSurface;
      },
      (current) => {
        const surface = surfaceYAt(current.x, calibration);
        return surface !== null && current.y >= surface;
      },
      takeoff.timestampMs,
      frameIntervalMs,
      ),
    )
    : eventFromDetection("head-entry", null);
  const safeEntry = hideIfOutOfOrder(entry, takeoff.timestampMs);
  const fiveMeter = safeEntry.timestampMs === null || !calibration
    ? eventFromDetection("five-meter-head-crossing", null)
    : eventFromDetection(
      "five-meter-head-crossing",
      firstCrossing(
        frames,
        (frame) => estimatedHeadTop(frame, threshold),
        (previous, current) => travelDirection === "left-to-right"
          ? previous.x < calibration.fiveMeter.x && current.x >= calibration.fiveMeter.x
          : previous.x > calibration.fiveMeter.x && current.x <= calibration.fiveMeter.x,
        (current) => travelDirection === "left-to-right"
          ? current.x >= calibration.fiveMeter.x
          : current.x <= calibration.fiveMeter.x,
        safeEntry.timestampMs,
        frameIntervalMs,
      ),
    );

  return [signal, movement, handsOff, safeRearFoot, takeoff, safeEntry, hideIfOutOfOrder(fiveMeter, safeEntry.timestampMs)];
}
