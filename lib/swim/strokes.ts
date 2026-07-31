import {
  POSE_LANDMARK_INDEX,
  type PoseFrame,
  type PoseLandmarkIndex,
} from "../../types/analysis";
import type {
  DetectedEvent,
  EventSide,
  StrokeStyle,
  TravelDirection,
} from "../../types/competition";
import {
  clampConfidence,
  confidenceStatus,
} from "./confidence";

export interface StrokeDetectionOptions {
  readonly travelDirection?: TravelDirection;
  /** 同じ信号から連続してイベントを採用しない最短時間。 */
  readonly minimumCycleMs?: number;
  /** 正規化画像座標で必要な局所ピークの高さ。 */
  readonly minimumProminence?: number;
}

interface SignalPoint {
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly value: number;
  readonly confidence: number;
  readonly leftValue?: number;
  readonly rightValue?: number;
}

interface Peak {
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly confidence: number;
}

const DEFAULT_MINIMUM_CYCLE_MS = 300;
const DEFAULT_MINIMUM_PROMINENCE = 0.01;

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number.`);
  }
}

function sortedFrames(frames: readonly PoseFrame[]) {
  return frames.map((frame, arrayIndex) => ({
    frame,
    frameIndex: frame.sourceFrameIndex ?? arrayIndex,
  })).sort(
    (first, second) =>
      first.frame.timestampMs - second.frame.timestampMs,
  );
}

function extensionSignal(
  frame: PoseFrame,
  wristIndex: PoseLandmarkIndex,
  elbowIndex: PoseLandmarkIndex,
  shoulderIndex: PoseLandmarkIndex,
  directionSign: number,
  frameIndex: number,
): SignalPoint | null {
  const wrist = frame.landmarks[wristIndex];
  const elbow = frame.landmarks[elbowIndex];
  const shoulder = frame.landmarks[shoulderIndex];
  if (
    !wrist ||
    !elbow ||
    !shoulder ||
    !Number.isFinite(wrist.x) ||
    !Number.isFinite(elbow.x) ||
    !Number.isFinite(shoulder.x) ||
    !Number.isFinite(wrist.visibility) ||
    !Number.isFinite(elbow.visibility) ||
    !Number.isFinite(shoulder.visibility)
  ) {
    return null;
  }

  return {
    frameIndex,
    timestampMs: frame.timestampMs,
    value:
      ((wrist.x * 0.75 + elbow.x * 0.25) - shoulder.x) *
      directionSign,
    confidence: clampConfidence(
      Math.min(
        wrist.visibility,
        elbow.visibility,
        shoulder.visibility,
      ),
    ),
  };
}

function applyAlternationConfidence(
  sourceEvents: readonly DetectedEvent[],
): readonly DetectedEvent[] {
  const events = [...sourceEvents].sort(
    (first, second) =>
      first.timestampMs - second.timestampMs ||
      first.id.localeCompare(second.id),
  );
  return events.map((event, index) => {
    const previous = events[index - 1];
    const next = events[index + 1];
    const violatesAlternation =
      previous?.side === event.side || next?.side === event.side;
    if (!violatesAlternation) {
      return event;
    }
    const confidence = clampConfidence(event.confidence * 0.6);
    return {
      ...event,
      confidence,
      status: confidenceStatus(confidence),
    };
  });
}

function findLocalPeaks(
  points: readonly SignalPoint[],
  minimumCycleMs: number,
  minimumProminence: number,
): readonly Peak[] {
  const candidates: Array<Peak & { readonly prominence: number }> = [];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const prominence = current.value - Math.max(previous.value, next.value);

    if (
      current.value > previous.value &&
      current.value >= next.value &&
      prominence >= minimumProminence
    ) {
      const prominenceConfidence = Math.min(
        1,
        prominence / (minimumProminence * 2),
      );
      const symmetryConfidence =
        current.leftValue === undefined || current.rightValue === undefined
          ? 1
          : 1 -
            Math.min(
              1,
              Math.abs(current.leftValue - current.rightValue) /
                Math.max(
                  minimumProminence,
                  Math.abs(current.leftValue) +
                    Math.abs(current.rightValue),
                ),
            );

      candidates.push({
        frameIndex: current.frameIndex,
        timestampMs: current.timestampMs,
        prominence,
        confidence: clampConfidence(
          current.confidence * prominenceConfidence * symmetryConfidence,
        ),
      });
    }
  }

  const selected: Array<Peak & { readonly prominence: number }> = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (
      !previous ||
      candidate.timestampMs - previous.timestampMs >= minimumCycleMs
    ) {
      selected.push(candidate);
      continue;
    }

    if (candidate.prominence > previous.prominence) {
      selected[selected.length - 1] = candidate;
    }
  }

  return selected.map(({ frameIndex, timestampMs, confidence }) => ({
    frameIndex,
    timestampMs,
    confidence,
  }));
}

function stableTimestamp(timestampMs: number): string {
  return timestampMs.toFixed(3).replace(/\.?0+$/, "");
}

function eventsFromSignal(
  points: readonly SignalPoint[],
  strokeStyle: StrokeStyle,
  side: EventSide,
  minimumCycleMs: number,
  minimumProminence: number,
): readonly DetectedEvent[] {
  return findLocalPeaks(points, minimumCycleMs, minimumProminence).map(
    (peak): DetectedEvent => ({
      id: `stroke:${strokeStyle}:${side ?? "none"}:${stableTimestamp(peak.timestampMs)}`,
      type: "stroke",
      timestampMs: peak.timestampMs,
      frameIndex: peak.frameIndex,
      confidence: peak.confidence,
      status: confidenceStatus(peak.confidence),
      source: "automatic",
      strokeStyle,
      side,
      gateId: null,
    }),
  );
}

function synchronousSignal(
  left: readonly SignalPoint[],
  right: readonly SignalPoint[],
): readonly SignalPoint[] {
  const rightByTimestamp = new Map(
    right.map((point) => [point.timestampMs, point] as const),
  );

  return left.flatMap((leftPoint) => {
    const rightPoint = rightByTimestamp.get(leftPoint.timestampMs);
    if (!rightPoint) {
      return [];
    }
    return [
      {
        frameIndex: leftPoint.frameIndex,
        timestampMs: leftPoint.timestampMs,
        value: (leftPoint.value + rightPoint.value) / 2,
        confidence: Math.min(
          leftPoint.confidence,
          rightPoint.confidence,
        ),
        leftValue: leftPoint.value,
        rightValue: rightPoint.value,
      },
    ];
  });
}

/**
 * 手首の肩に対する進行方向への伸展ピークからストロークイベントを導く。
 * 自由形・背泳ぎは左右別、平泳ぎ・バタフライは左右同期信号を使う。
 */
export function deriveStrokeEvents(
  frames: readonly PoseFrame[],
  strokeStyle: StrokeStyle,
  options: StrokeDetectionOptions = {},
): readonly DetectedEvent[] {
  const minimumCycleMs =
    options.minimumCycleMs ?? DEFAULT_MINIMUM_CYCLE_MS;
  const minimumProminence =
    options.minimumProminence ?? DEFAULT_MINIMUM_PROMINENCE;
  assertFinitePositive(minimumCycleMs, "minimumCycleMs");
  assertFinitePositive(minimumProminence, "minimumProminence");

  const directionSign =
    (options.travelDirection ?? "left-to-right") === "left-to-right"
      ? 1
      : -1;
  const orderedFrames = sortedFrames(frames);
  const signal = (
    wrist: PoseLandmarkIndex,
    elbow: PoseLandmarkIndex,
    shoulder: PoseLandmarkIndex,
  ) =>
    orderedFrames.flatMap(({ frame, frameIndex }) => {
      const point = extensionSignal(
        frame,
        wrist,
        elbow,
        shoulder,
        directionSign,
        frameIndex,
      );
      return point ? [point] : [];
    });
  const left = signal(
    POSE_LANDMARK_INDEX.left_wrist,
    POSE_LANDMARK_INDEX.left_elbow,
    POSE_LANDMARK_INDEX.left_shoulder,
  );
  const right = signal(
    POSE_LANDMARK_INDEX.right_wrist,
    POSE_LANDMARK_INDEX.right_elbow,
    POSE_LANDMARK_INDEX.right_shoulder,
  );

  const events =
    strokeStyle === "freestyle" || strokeStyle === "backstroke"
      ? applyAlternationConfidence([
          ...eventsFromSignal(
            left,
            strokeStyle,
            "left",
            minimumCycleMs,
            minimumProminence,
          ),
          ...eventsFromSignal(
            right,
            strokeStyle,
            "right",
            minimumCycleMs,
            minimumProminence,
          ),
        ])
      : eventsFromSignal(
          synchronousSignal(left, right),
          strokeStyle,
          "both",
          minimumCycleMs,
          minimumProminence,
        );

  return [...events].sort(
    (first, second) =>
      first.timestampMs - second.timestampMs ||
      first.id.localeCompare(second.id),
  );
}
