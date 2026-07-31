import type { AnalysisResultV1 } from "../../types/analysis";
import type {
  AnalysisMode,
  CalibrationProfileV1,
  CompetitionAnalysisQuality,
  CompetitionAnalysisResultForMode,
  CompetitionAnalysisResultV2,
  CompetitionVideoInputInfo,
  DetectedEvent,
  ManualEventOverride,
  Measurement,
  StrokeStyle,
} from "../../types/competition";
import { clampConfidence, confidenceStatus } from "./confidence";
import {
  calculateCompetitionMeasurements,
  detectGateCrossings,
  type GateCrossingOptions,
} from "./gates";
import { applyManualEventOverrides } from "./overrides";
import {
  deriveStrokeEvents,
  type StrokeDetectionOptions,
} from "./strokes";

export interface BuildCompetitionAnalysisOptions<
  Mode extends AnalysisMode = AnalysisMode,
> {
  readonly sessionLabel?: string | null;
  readonly mode: Mode;
  readonly strokeStyle: StrokeStyle;
  readonly calibration: CalibrationProfileV1;
  readonly videoInput?: CompetitionVideoInputInfo;
  readonly strokeDetection?: Omit<
    StrokeDetectionOptions,
    "travelDirection"
  >;
  readonly gateCrossing?: GateCrossingOptions;
}

function fallbackVideoInput(
  source: AnalysisResultV1,
): CompetitionVideoInputInfo {
  return {
    container: source.input.mimeType?.split("/", 2)[1] ?? null,
    detectedMimeType: source.input.mimeType,
    codec: null,
    rotation: 0,
    codedWidth: source.input.width,
    codedHeight: source.input.height,
    displayWidth: source.input.width,
    displayHeight: source.input.height,
    effectiveFps: source.sampling.targetFps,
    firstTimestampMs: source.sampling.startTimestampMs,
    durationMs: source.input.durationMs,
    frameTimestampsMs: source.sampling.timestampsMs,
  };
}

function sortedEvents(
  events: readonly DetectedEvent[],
): readonly DetectedEvent[] {
  return [...events].sort(
    (first, second) =>
      first.timestampMs - second.timestampMs ||
      first.id.localeCompare(second.id),
  );
}

function touchedEventsForOverrides(
  result: CompetitionAnalysisResultV2,
  events: readonly DetectedEvent[],
  overrides: readonly ManualEventOverride[],
): readonly DetectedEvent[] {
  const previousById = new Map(
    [...result.automaticEvents, ...result.events].map(
      (event) => [event.id, event] as const,
    ),
  );
  const currentById = new Map(
    events.map((event) => [event.id, event] as const),
  );
  const touched: DetectedEvent[] = [];

  for (const override of overrides) {
    if (override.action === "add") {
      touched.push(override.event);
      const current = currentById.get(override.event.id);
      if (current) touched.push(current);
      continue;
    }

    const previous = previousById.get(override.eventId);
    const current = currentById.get(override.eventId);
    if (previous) touched.push(previous);
    if (current) touched.push(current);
  }

  return touched;
}

function markAffectedMeasurementsVerified(
  result: CompetitionAnalysisResultV2,
  events: readonly DetectedEvent[],
  measurements: readonly Measurement[],
  overrides: readonly ManualEventOverride[],
): readonly Measurement[] {
  if (overrides.length === 0) return measurements;

  const currentById = new Map(
    events.map((event) => [event.id, event] as const),
  );
  const touched = touchedEventsForOverrides(result, events, overrides);

  return measurements.map((measurement) => {
    if (
      measurement.value === null ||
      measurement.fromEventId === null ||
      measurement.toEventId === null
    ) {
      return measurement;
    }

    const fromEvent = currentById.get(measurement.fromEventId);
    const toEvent = currentById.get(measurement.toEventId);
    if (!fromEvent || !toEvent) return measurement;

    const startMs = Math.min(fromEvent.timestampMs, toEvent.timestampMs);
    const endMs = Math.max(fromEvent.timestampMs, toEvent.timestampMs);
    const touchesGate = touched.some(
      (event) =>
        event.type === "gate-crossing" &&
        (event.id === fromEvent.id ||
          event.id === toEvent.id ||
          (event.timestampMs > startMs && event.timestampMs < endMs)),
    );
    const touchesStroke = touched.some(
      (event) =>
        event.type === "stroke" &&
        event.timestampMs > startMs &&
        event.timestampMs <= endMs,
    );
    const strokeDerived =
      measurement.type !== "interval-time" &&
      measurement.type !== "average-speed";
    const dependencyEvents = events.filter(
      (event) =>
        event.id === fromEvent.id ||
        event.id === toEvent.id ||
        (strokeDerived &&
          event.type === "stroke" &&
          event.timestampMs > startMs &&
          event.timestampMs <= endMs),
    );
    const allDependenciesResolved = dependencyEvents.every(
      (event) =>
        event.status === "confirmed" || event.status === "verified",
    );

    return (
      touchesGate || (strokeDerived && touchesStroke)
    ) && allDependenciesResolved
      ? { ...measurement, status: "verified" as const }
      : measurement;
  });
}

function applyOverallQualityToMeasurements(
  measurements: readonly Measurement[],
  quality: CompetitionAnalysisQuality,
): readonly Measurement[] {
  const captureStatus = confidenceStatus(quality.poseDetectionRate);
  return measurements.map((measurement) => {
    if (measurement.status === "verified") return measurement;
    const confidence = Math.min(
      measurement.confidence,
      quality.poseDetectionRate,
    );
    if (
      measurement.value === null ||
      captureStatus === "unavailable"
    ) {
      return {
        ...measurement,
        value: null,
        confidence,
        status: "unavailable" as const,
      };
    }
    if (captureStatus === "needs-review") {
      return {
        ...measurement,
        confidence,
        status: "needs-review" as const,
      };
    }
    return measurement;
  });
}

function assessQuality(
  source: AnalysisResultV1,
  events: readonly DetectedEvent[],
  calibration: CalibrationProfileV1,
): CompetitionAnalysisQuality {
  const poseDetectionRate =
    source.sampling.frameCount > 0
      ? clampConfidence(
          source.sampling.detectedFrameCount /
            source.sampling.frameCount,
        )
      : 0;
  const eventConfidence =
    events.length > 0
      ? clampConfidence(
          events.reduce(
            (sum, event) => sum + event.confidence,
            0,
          ) / events.length,
        )
      : 0;
  const confidence = Math.min(poseDetectionRate, eventConfidence);
  const warnings: string[] = [];
  if (poseDetectionRate < 0.5) {
    warnings.push("Poseを取得できたフレームが半数未満です。");
  }
  if (events.length === 0) {
    warnings.push("競泳イベントを検出できませんでした。");
  }
  if (
    source.input.width !== calibration.imageWidth ||
    source.input.height !== calibration.imageHeight
  ) {
    warnings.push("校正時と解析動画の解像度が一致しません。");
  }
  if (events.some((event) => event.status === "needs-review")) {
    warnings.push("確認が必要な自動検出イベントがあります。");
  }
  if (events.some((event) => event.status === "unavailable")) {
    warnings.push("未計測扱いの低信頼度イベントがあります。");
  }

  return {
    status: confidenceStatus(confidence),
    confidence,
    poseDetectionRate,
    eventConfidence,
    warnings,
  };
}

/** V1 Pose解析から、競泳用V2結果を決定論的に構築する。 */
export function buildCompetitionAnalysisResult(
  source: AnalysisResultV1,
  options: BuildCompetitionAnalysisOptions<"swim">,
): CompetitionAnalysisResultForMode<"swim">;
export function buildCompetitionAnalysisResult(
  source: AnalysisResultV1,
  options: BuildCompetitionAnalysisOptions<"turn">,
): CompetitionAnalysisResultForMode<"turn">;
export function buildCompetitionAnalysisResult(
  source: AnalysisResultV1,
  options: BuildCompetitionAnalysisOptions<"start">,
): CompetitionAnalysisResultForMode<"start">;
export function buildCompetitionAnalysisResult<Mode extends AnalysisMode>(
  source: AnalysisResultV1,
  options: BuildCompetitionAnalysisOptions<Mode>,
): CompetitionAnalysisResultForMode<Mode>;
export function buildCompetitionAnalysisResult(
  source: AnalysisResultV1,
  options: BuildCompetitionAnalysisOptions,
): CompetitionAnalysisResultV2 {
  const strokeEvents = deriveStrokeEvents(
    source.frames,
    options.strokeStyle,
    {
      ...options.strokeDetection,
      travelDirection: options.calibration.travelDirection,
    },
  );
  const gateEvents = detectGateCrossings(
    source.frames,
    options.calibration,
    options.gateCrossing,
  );
  const automaticEvents = sortedEvents([
    ...strokeEvents,
    ...gateEvents,
  ]);
  const quality = assessQuality(
    source,
    automaticEvents,
    options.calibration,
  );
  const measurements = applyOverallQualityToMeasurements(
    calculateCompetitionMeasurements(
      automaticEvents,
      options.calibration,
    ),
    quality,
  );

  return {
    schemaVersion: "2.0",
    analyzedAt: source.analyzedAt,
    sessionLabel: options.sessionLabel?.trim() || null,
    mode: options.mode,
    strokeStyle: options.strokeStyle,
    calibration: options.calibration,
    input: source.input,
    videoInput: options.videoInput ?? fallbackVideoInput(source),
    sampling: source.sampling,
    trim: {
      startTimestampMs: source.sampling.startTimestampMs,
      endTimestampMs: source.sampling.endTimestampMs,
    },
    rawPoseFrames: source.frames,
    quality,
    source,
    automaticEvents,
    manualOverrides: [],
    events: automaticEvents,
    measurements,
    revisionHistory: [],
  };
}

/**
 * 渡されたoverride一式を自動検出結果へ適用し、主要6指標を再計算する。
 * revisionHistoryは呼び出し単位で追記する。
 */
export function recalculateCompetitionAnalysis<
  Result extends CompetitionAnalysisResultV2,
>(
  result: Result,
  overrides: readonly ManualEventOverride[],
): Result {
  const events = applyManualEventOverrides(
    result.automaticEvents,
    overrides,
    result.rawPoseFrames,
    result.videoInput.frameTimestampsMs,
  );
  const quality = assessQuality(
    result.source,
    events,
    result.calibration,
  );
  const measurements = applyOverallQualityToMeasurements(
    markAffectedMeasurementsVerified(
      result,
      events,
      calculateCompetitionMeasurements(events, result.calibration),
      overrides,
    ),
    quality,
  );
  const nextRevision =
    (result.revisionHistory.at(-1)?.revision ?? 0) + 1;

  return {
    ...result,
    quality,
    manualOverrides: [...overrides],
    events,
    measurements,
    revisionHistory: [
      ...result.revisionHistory,
      { revision: nextRevision, overrides: [...overrides] },
    ],
  } as Result;
}
