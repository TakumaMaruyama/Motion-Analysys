import {
  POSE_LANDMARK_INDEX,
  type PoseFrame,
  type PoseLandmark,
} from "../../types/analysis";
import type {
  CalibrationProfileV1,
  DetectedEvent,
  DistanceGate,
  Measurement,
  MeasurementType,
  MeasurementUnit,
  StrokeStyle,
} from "../../types/competition";
import {
  clampConfidence,
  confidenceStatus,
} from "./confidence";

export interface GateCrossingOptions {
  readonly includeLowConfidence?: boolean;
}

interface TorsoPoint {
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly x: number;
  readonly confidence: number;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number.`);
  }
}

export function validateCalibrationProfile(
  calibration: CalibrationProfileV1,
): void {
  assertFinitePositive(calibration.imageWidth, "imageWidth");
  assertFinitePositive(calibration.imageHeight, "imageHeight");
  assertFinitePositive(calibration.poolLengthMeters, "poolLengthMeters");
  if (
    !Number.isFinite(calibration.visibilityThreshold) ||
    calibration.visibilityThreshold < 0 ||
    calibration.visibilityThreshold > 1
  ) {
    throw new RangeError(
      "visibilityThreshold must be between 0 and 1.",
    );
  }

  const ids = new Set<string>();
  for (const gate of calibration.gates) {
    if (!gate.id.trim()) {
      throw new TypeError("distance gate id must not be empty.");
    }
    if (ids.has(gate.id)) {
      throw new TypeError(`duplicate distance gate id: ${gate.id}`);
    }
    ids.add(gate.id);
    if (
      !Number.isFinite(gate.normalizedX) ||
      gate.normalizedX < 0 ||
      gate.normalizedX > 1
    ) {
      throw new RangeError(
        `normalizedX for gate ${gate.id} must be between 0 and 1.`,
      );
    }
    if (
      !Number.isFinite(gate.distanceMeters) ||
      gate.distanceMeters < 0 ||
      gate.distanceMeters > calibration.poolLengthMeters
    ) {
      throw new RangeError(
        `distanceMeters for gate ${gate.id} must be within the pool length.`,
      );
    }
  }
}

function validLandmark(landmark: PoseLandmark | undefined): boolean {
  return Boolean(
    landmark &&
      Number.isFinite(landmark.x) &&
      Number.isFinite(landmark.visibility),
  );
}

function midpoint(
  first: PoseLandmark | undefined,
  second: PoseLandmark | undefined,
): { readonly x: number; readonly confidence: number } | null {
  if (!validLandmark(first) || !validLandmark(second)) {
    return null;
  }
  return {
    x: (first!.x + second!.x) / 2,
    confidence: clampConfidence(
      Math.min(first!.visibility, second!.visibility),
    ),
  };
}

function torsoPoint(
  frame: PoseFrame,
  frameIndex: number,
): TorsoPoint | null {
  const hipCenter = midpoint(
    frame.landmarks[POSE_LANDMARK_INDEX.left_hip],
    frame.landmarks[POSE_LANDMARK_INDEX.right_hip],
  );
  const shoulderCenter = midpoint(
    frame.landmarks[POSE_LANDMARK_INDEX.left_shoulder],
    frame.landmarks[POSE_LANDMARK_INDEX.right_shoulder],
  );
  const center = hipCenter ?? shoulderCenter;
  if (!center || !Number.isFinite(frame.timestampMs)) {
    return null;
  }
  return {
    frameIndex,
    timestampMs: frame.timestampMs,
    ...center,
  };
}

function crossingRatio(
  previousX: number,
  currentX: number,
  gate: DistanceGate,
  direction: CalibrationProfileV1["travelDirection"],
): number | null {
  const crossed =
    direction === "left-to-right"
      ? previousX < gate.normalizedX && currentX >= gate.normalizedX
      : previousX > gate.normalizedX && currentX <= gate.normalizedX;
  if (!crossed || currentX === previousX) {
    return null;
  }
  const ratio = (gate.normalizedX - previousX) / (currentX - previousX);
  return ratio >= 0 && ratio <= 1 ? ratio : null;
}

function stableTimestamp(timestampMs: number): string {
  return timestampMs.toFixed(3).replace(/\.?0+$/, "");
}

function roundTimestamp(timestampMs: number): number {
  return Math.round(timestampMs * 1_000_000) / 1_000_000;
}

/** 腰中心（取得不能なら肩中心）のゲート通過を線形補間する。 */
export function detectGateCrossings(
  frames: readonly PoseFrame[],
  calibration: CalibrationProfileV1,
  options: GateCrossingOptions = {},
): readonly DetectedEvent[] {
  validateCalibrationProfile(calibration);
  const points = frames
    .map((frame, arrayIndex) =>
      torsoPoint(frame, frame.sourceFrameIndex ?? arrayIndex),
    )
    .filter((point): point is TorsoPoint => point !== null)
    .sort(
      (first, second) => first.timestampMs - second.timestampMs,
    );
  const events: DetectedEvent[] = [];

  for (const gate of calibration.gates) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const ratio = crossingRatio(
        previous.x,
        current.x,
        gate,
        calibration.travelDirection,
      );
      if (ratio === null || current.timestampMs <= previous.timestampMs) {
        continue;
      }

      const timestampMs = roundTimestamp(
        previous.timestampMs +
          (current.timestampMs - previous.timestampMs) * ratio,
      );
      const confidence = Math.min(
        previous.confidence,
        current.confidence,
      );
      const status = confidenceStatus(confidence);
      if (
        status !== "confirmed" &&
        options.includeLowConfidence === false
      ) {
        break;
      }
      const frameIndex =
        ratio <= 0.5 + Number.EPSILON * 8
          ? previous.frameIndex
          : current.frameIndex;
      events.push({
        id: `gate:${gate.id}:${stableTimestamp(timestampMs)}`,
        type: "gate-crossing",
        timestampMs,
        frameIndex,
        confidence,
        status,
        source: "automatic",
        strokeStyle: null,
        side: null,
        gateId: gate.id,
      });
      break;
    }
  }

  return events.sort(
    (first, second) =>
      first.timestampMs - second.timestampMs ||
      first.id.localeCompare(second.id),
  );
}

function measurementStatus(
  confidence: number,
  calculable: boolean,
  verified: boolean,
) {
  return calculable
    ? confidenceStatus(confidence, verified)
    : "unavailable" as const;
}

function createMeasurement(
  id: string,
  type: MeasurementType,
  label: string,
  calculatedValue: number,
  unit: MeasurementUnit,
  confidence: number,
  fromEventId: string,
  toEventId: string,
  distanceMeters: number,
  verified: boolean,
): Measurement {
  const calculable = Number.isFinite(calculatedValue);
  const status = measurementStatus(confidence, calculable, verified);
  return {
    id,
    type,
    label,
    value: status === "unavailable" ? null : calculatedValue,
    unit,
    confidence: clampConfidence(confidence),
    status,
    fromEventId,
    toEventId,
    distanceMeters,
  };
}

function cycleCountForEvents(
  strokeEvents: readonly DetectedEvent[],
  fallbackStrokeStyle: StrokeStyle | null,
): number {
  const strokeStyle =
    strokeEvents.find((event) => event.strokeStyle)?.strokeStyle ??
    fallbackStrokeStyle;
  return strokeStyle === "freestyle" || strokeStyle === "backstroke"
    ? strokeEvents.length / 2
    : strokeEvents.length;
}

function completeCycleDurationsMs(
  strokeEvents: readonly DetectedEvent[],
): readonly number[] {
  const ordered = [...strokeEvents].sort(
    (first, second) => first.timestampMs - second.timestampMs,
  );
  const strokeStyle = ordered.find(
    (event) => event.strokeStyle !== null,
  )?.strokeStyle;
  if (!strokeStyle || ordered.length < 2) {
    return [];
  }

  if (strokeStyle === "breaststroke" || strokeStyle === "butterfly") {
    return ordered.slice(1).flatMap((event, index) => {
      const duration = event.timestampMs - ordered[index].timestampMs;
      return duration > 0 ? [duration] : [];
    });
  }

  const sameSideDurations = (["left", "right"] as const).flatMap(
    (side) => {
      const sideEvents = ordered.filter((event) => event.side === side);
      return sideEvents.slice(1).flatMap((event, index) => {
        const duration = event.timestampMs - sideEvents[index].timestampMs;
        return duration > 0 ? [duration] : [];
      });
    },
  );
  if (sameSideDurations.length > 0) {
    return sameSideDurations;
  }

  // side情報がないデータは、左右2ストロークで1周期として補う。
  return ordered.slice(2).flatMap((event, index) => {
    const duration = event.timestampMs - ordered[index].timestampMs;
    return duration > 0 ? [duration] : [];
  });
}

/**
 * 時系列で隣接する校正ゲート間について、主要6指標を再計算する。
 */
export function calculateCompetitionMeasurements(
  events: readonly DetectedEvent[],
  calibration: CalibrationProfileV1,
): readonly Measurement[] {
  validateCalibrationProfile(calibration);
  const gateById = new Map(
    calibration.gates.map((gate) => [gate.id, gate] as const),
  );
  const gateEvents = events
    .filter(
      (event) =>
        event.type === "gate-crossing" &&
        event.gateId !== null &&
        gateById.has(event.gateId),
    )
    .sort(
      (first, second) => first.timestampMs - second.timestampMs,
    );
  const measurements: Measurement[] = [];

  for (let index = 1; index < gateEvents.length; index += 1) {
    const fromEvent = gateEvents[index - 1];
    const toEvent = gateEvents[index];
    const fromGate = gateById.get(fromEvent.gateId! as string)!;
    const toGate = gateById.get(toEvent.gateId! as string)!;
    const elapsedSeconds =
      (toEvent.timestampMs - fromEvent.timestampMs) / 1000;
    const distanceMeters = Math.abs(
      toGate.distanceMeters - fromGate.distanceMeters,
    );
    const intervalStrokeEvents = events.filter(
      (event) =>
        event.type === "stroke" &&
        event.timestampMs > fromEvent.timestampMs &&
        event.timestampMs <= toEvent.timestampMs,
    );
    const strokeCount = intervalStrokeEvents.length;
    const hasStrokeEvents = strokeCount > 0;
    const cycleCount = cycleCountForEvents(
      intervalStrokeEvents,
      null,
    );
    const cycleDurationsMs = completeCycleDurationsMs(
      intervalStrokeEvents,
    );
    const averageCycleDurationMs =
      cycleDurationsMs.length > 0
        ? cycleDurationsMs.reduce((sum, value) => sum + value, 0) /
          cycleDurationsMs.length
        : Number.NaN;
    const cycleRate = Number.isFinite(averageCycleDurationMs)
      ? 60_000 / averageCycleDurationMs
      : Number.NaN;
    const averageSpeed =
      elapsedSeconds > 0
        ? distanceMeters / elapsedSeconds
        : Number.NaN;
    const distancePerCycle =
      Number.isFinite(averageSpeed) &&
      Number.isFinite(cycleRate) &&
      cycleRate > 0
        ? averageSpeed * 60 / cycleRate
        : Number.NaN;
    const gateConfidence = Math.min(
      fromEvent.confidence,
      toEvent.confidence,
    );
    const strokeConfidence = Math.min(
      gateConfidence,
      ...(intervalStrokeEvents.length > 0
        ? intervalStrokeEvents.map((event) => event.confidence)
        : [1]),
    );
    const labelPrefix = `${fromGate.label}→${toGate.label}`;
    const pairId = `${fromEvent.id}:${toEvent.id}`;
    const gateCommon = [
      gateConfidence,
      fromEvent.id,
      toEvent.id,
      distanceMeters,
      fromEvent.source === "manual" ||
        toEvent.source === "manual",
    ] as const;
    const strokeCommon = [
      strokeConfidence,
      fromEvent.id,
      toEvent.id,
      distanceMeters,
      gateCommon[4] ||
        intervalStrokeEvents.some((event) => event.source === "manual"),
    ] as const;

    measurements.push(
      createMeasurement(
        `interval-time:${pairId}`,
        "interval-time",
        `${labelPrefix} 区間時間`,
        elapsedSeconds > 0 ? elapsedSeconds : Number.NaN,
        "s",
        ...gateCommon,
      ),
      createMeasurement(
        `average-speed:${pairId}`,
        "average-speed",
        `${labelPrefix} 平均速度`,
        averageSpeed,
        "m/s",
        ...gateCommon,
      ),
      createMeasurement(
        `stroke-count:${pairId}`,
        "stroke-count",
        `${labelPrefix} ストローク数`,
        hasStrokeEvents ? strokeCount : Number.NaN,
        "count",
        ...strokeCommon,
      ),
      createMeasurement(
        `cycle-count:${pairId}`,
        "cycle-count",
        `${labelPrefix} サイクル数`,
        hasStrokeEvents ? cycleCount : Number.NaN,
        "count",
        ...strokeCommon,
      ),
      createMeasurement(
        `cycle-rate:${pairId}`,
        "cycle-rate",
        `${labelPrefix} サイクルレート`,
        cycleRate,
        "cycles/min",
        ...strokeCommon,
      ),
      createMeasurement(
        `distance-per-cycle:${pairId}`,
        "distance-per-cycle",
        `${labelPrefix} 1サイクル距離`,
        distancePerCycle,
        "m/cycle",
        ...strokeCommon,
      ),
    );
  }

  return measurements;
}
