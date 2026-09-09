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

function head(frame: PoseFrame, threshold: number): CandidatePoint | null {
  return point(frame.landmarks[POSE_LANDMARK_INDEX.nose], threshold);
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
): CandidateDetection | null {
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (lowerBoundMs !== null && frame.timestampMs < lowerBoundMs) continue;
    const current = get(frame);
    if (!current || distance(current, initial) < minimumDistance) continue;
    return {
      timestampMs: frame.timestampMs,
      frameIndex: frameIndex(frame, index),
      point: { x: current.x, y: current.y },
      confidence: bounded(Math.min(current.visibility, Math.min(0.78, 0.45 + distance(current, initial) * 5))),
    };
  }
  return null;
}

function firstTakeoff(
  frames: readonly PoseFrame[],
  initial: readonly [CandidatePoint | null, CandidatePoint | null],
  threshold: number,
  lowerBoundMs: number | null,
): CandidateDetection | null {
  if (!initial[0] || !initial[1]) return null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (lowerBoundMs !== null && frame.timestampMs < lowerBoundMs) continue;
    const current = feet(frame, threshold);
    if (!current[0] || !current[1]) continue;
    const leftDisplacement = distance(initial[0], current[0]);
    const rightDisplacement = distance(initial[1], current[1]);
    if (leftDisplacement < TAKEOFF_DISTANCE || rightDisplacement < TAKEOFF_DISTANCE) continue;
    return {
      timestampMs: frame.timestampMs,
      frameIndex: frameIndex(frame, index),
      point: { x: (current[0].x + current[1].x) / 2, y: (current[0].y + current[1].y) / 2 },
      confidence: bounded(Math.min(current[0].visibility, current[1].visibility, 0.72)),
    };
  }
  return null;
}

function firstCrossing(
  frames: readonly PoseFrame[],
  getPosition: (frame: PoseFrame) => CandidatePoint | null,
  crossed: (previous: CandidatePoint, current: CandidatePoint) => boolean,
  lowerBoundMs: number | null,
): CandidateDetection | null {
  let previous: CandidatePoint | null = null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const current = getPosition(frame);
    if (!current) continue;
    if (lowerBoundMs !== null && frame.timestampMs < lowerBoundMs) {
      previous = current;
      continue;
    }
    if (previous && crossed(previous, current)) {
      return {
        timestampMs: frame.timestampMs,
        frameIndex: frameIndex(frame, index),
        point: { x: current.x, y: current.y },
        confidence: bounded(Math.min(previous.visibility, current.visibility, 0.68)),
      };
    }
    previous = current;
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
 * Poseと音声の自動候補を、コーチ確認前のイベントとして返す。
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
  const baselineFrames = frames.slice(0, Math.min(8, frames.length));
  const signalDetection = finite(options.signalTimestampMs ?? Number.NaN) && (options.signalTimestampMs ?? -1) >= 0
    ? { timestampMs: options.signalTimestampMs!, frameIndex: null, point: null, confidence: 0.35 }
    : null;
  const signal = eventFromDetection("signal", signalDetection, "needs-review");
  const signalTime = signal.timestampMs;

  const initialTrunk = firstUsable(baselineFrames, (frame) => trunk(frame, threshold));
  const movementDetection = initialTrunk
    ? firstDisplaced(frames, initialTrunk.value, (frame) => trunk(frame, threshold), MOTION_DISTANCE, signalTime)
    : null;
  const movement = hideIfOutOfOrder(eventFromDetection("movement-onset", movementDetection), signalTime);
  const movementTime = movement.timestampMs;

  const initialHands = firstUsable(baselineFrames, (frame) => hands(frame, threshold));
  let handsOff = eventFromDetection(
    "hands-off",
    initialHands
      ? firstDisplaced(frames, initialHands.value, (frame) => hands(frame, threshold), HAND_OR_FOOT_DISTANCE, movementTime)
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
        }, HAND_OR_FOOT_DISTANCE, movementTime)
        : null,
    )
    : eventFromDetection("rear-foot-off", null);
  const takeoff = eventFromDetection(
    "takeoff",
    firstTakeoff(frames, initialFeet, threshold, movementTime),
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
      (frame) => head(frame, threshold),
      (previous, current) => {
        const previousSurface = surfaceYAt(previous.x, calibration);
        const currentSurface = surfaceYAt(current.x, calibration);
        return previousSurface !== null && currentSurface !== null && previous.y < previousSurface && current.y >= currentSurface;
      },
      takeoff.timestampMs,
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
        (frame) => head(frame, threshold),
        (previous, current) => travelDirection === "left-to-right"
          ? previous.x < calibration.fiveMeter.x && current.x >= calibration.fiveMeter.x
          : previous.x > calibration.fiveMeter.x && current.x <= calibration.fiveMeter.x,
        safeEntry.timestampMs,
      ),
    );

  return [signal, movement, handsOff, safeRearFoot, takeoff, safeEntry, hideIfOutOfOrder(fiveMeter, safeEntry.timestampMs)];
}
