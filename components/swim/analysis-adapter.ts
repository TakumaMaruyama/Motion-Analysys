import { buildAnalysisResult } from "@/lib/pose/analysis";
import { WorkerPoseEstimator } from "@/lib/pose/worker-estimator";
import {
  buildCompetitionAnalysisResult,
  deriveStrokeEvents,
  detectGateCrossings,
  exportCompetitionAnalysisCsv,
  exportCompetitionAnalysisJson,
  recalculateCompetitionAnalysis,
} from "@/lib/swim";
import {
  decodeCompetitionVideoTwoPasses,
  getCompetitionVideoFrameTimeline,
  getModeFpsAssessment,
  inspectCompetitionVideo,
} from "@/lib/video/competition-frame-source";
import { CameraMotionMonitor } from "@/lib/video/camera-motion";
import {
  POSE_LANDMARK_INDEX,
  type AnalysisInputInfo,
  type PoseFrame,
} from "@/types/analysis";
import type {
  CalibrationProfileV1,
  CompetitionAnalysisResultV2,
  DetectedEvent,
  EventSide,
  ManualEventOverride,
  MeasurementType,
  TravelDirection,
} from "@/types/competition";

import type {
  SwimAnalysisUiCallbacks,
  SwimAnalysisUiRequest,
  SwimAnalysisViewResult,
  SwimEventType,
  SwimMetricKey,
  SwimMetricView,
  SwimTimelineEventView,
} from "./view-models";

const TARGET_ANALYSIS_FPS = 30;
const COARSE_ANALYSIS_FPS = 20;

const METRIC_DEFINITIONS: readonly {
  readonly key: SwimMetricKey;
  readonly type: MeasurementType;
  readonly label: string;
  readonly unit: string;
  readonly detail: string;
}[] = [
  {
    key: "intervalTimeSec",
    type: "interval-time",
    label: "区間タイム",
    unit: "s",
    detail: "ゲートA–Bの通過時間",
  },
  {
    key: "averageSpeedMps",
    type: "average-speed",
    label: "平均速度",
    unit: "m/s",
    detail: "校正距離 ÷ 区間タイム",
  },
  {
    key: "strokeCount",
    type: "stroke-count",
    label: "ストローク数",
    unit: "count",
    detail: "ゲート間のストロークイベント",
  },
  {
    key: "cycleCount",
    type: "cycle-count",
    label: "サイクル数",
    unit: "count",
    detail: "左右交互または両手1回を1周期",
  },
  {
    key: "cycleRateCpm",
    type: "cycle-rate",
    label: "サイクルレート",
    unit: "cycles/min",
    detail: "1分あたりのサイクル数",
  },
  {
    key: "distancePerCycleM",
    type: "distance-per-cycle",
    label: "1サイクル当たり距離",
    unit: "m/cycle",
    detail: "平均速度とレートから算出",
  },
];

export type SwimTimelineEdit =
  | {
      readonly action: "add";
      readonly type: SwimEventType;
      readonly timestampMs: number;
      readonly gateId: "gate-a" | "gate-b" | null;
      readonly id: string;
    }
  | {
      readonly action: "move";
      readonly eventId: string;
      readonly timestampMs: number;
    }
  | {
      readonly action: "verify";
      readonly eventId: string;
    }
  | {
      readonly action: "remove";
      readonly eventId: string;
    };

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("解析を中断しました。", "AbortError");
  }
}

function midpointX(frame: PoseFrame): number | null {
  const leftHip = frame.landmarks[POSE_LANDMARK_INDEX.left_hip];
  const rightHip = frame.landmarks[POSE_LANDMARK_INDEX.right_hip];
  if (
    leftHip &&
    rightHip &&
    Number.isFinite(leftHip.x) &&
    Number.isFinite(rightHip.x)
  ) {
    return (leftHip.x + rightHip.x) / 2;
  }
  const leftShoulder = frame.landmarks[POSE_LANDMARK_INDEX.left_shoulder];
  const rightShoulder = frame.landmarks[POSE_LANDMARK_INDEX.right_shoulder];
  return leftShoulder &&
    rightShoulder &&
    Number.isFinite(leftShoulder.x) &&
    Number.isFinite(rightShoulder.x)
    ? (leftShoulder.x + rightShoulder.x) / 2
    : null;
}

function inferTravelDirection(frames: readonly PoseFrame[]): TravelDirection {
  const positions = frames.flatMap((frame) => {
    const x = midpointX(frame);
    return x === null ? [] : [x];
  });
  if (positions.length < 2) {
    return "left-to-right";
  }
  return positions.at(-1)! < positions[0]
    ? "right-to-left"
    : "left-to-right";
}

function calibrationFromRequest(
  request: SwimAnalysisUiRequest,
  imageWidth: number,
  imageHeight: number,
  travelDirection: TravelDirection,
): CalibrationProfileV1 {
  const firstIsStart = travelDirection === "left-to-right";
  return {
    schemaVersion: "1.0",
    id: `swim-gates-${imageWidth}x${imageHeight}`,
    label: request.sessionLabel ?? "プールサイド距離校正",
    imageWidth,
    imageHeight,
    poolLengthMeters: request.distanceMeters,
    travelDirection,
    visibilityThreshold: 0.5,
    gates: [
      {
        id: "gate-a",
        label: "A",
        normalizedX: request.firstGateX,
        distanceMeters: 0,
        role: firstIsStart ? "start" : "finish",
      },
      {
        id: "gate-b",
        label: "B",
        normalizedX: request.secondGateX,
        distanceMeters: request.distanceMeters,
        role: firstIsStart ? "finish" : "start",
      },
    ],
  };
}

function eventType(event: DetectedEvent): SwimEventType {
  if (event.type === "gate-crossing") {
    return "gateCrossing";
  }
  if (event.side === "left") {
    return "leftStroke";
  }
  if (event.side === "right") {
    return "rightStroke";
  }
  return "bilateralStroke";
}

function eventView(event: DetectedEvent): SwimTimelineEventView {
  return {
    id: event.id,
    type: eventType(event),
    timestampMs: event.timestampMs,
    gateId:
      event.gateId === "gate-a" || event.gateId === "gate-b"
        ? event.gateId
        : null,
    confidence: event.confidence,
    source: event.source,
    status: event.status,
  };
}

function metricViews(
  result: CompetitionAnalysisResultV2,
): readonly SwimMetricView[] {
  return METRIC_DEFINITIONS.map((definition) => {
    const measurement = result.measurements.find(
      (candidate) => candidate.type === definition.type,
    );
    return {
      key: definition.key,
      label: definition.label,
      value: measurement?.value ?? null,
      unit: measurement?.unit ?? definition.unit,
      detail: definition.detail,
      quality: measurement?.status ?? "unavailable",
    };
  });
}

function viewResult(
  competition: CompetitionAnalysisResultV2,
  context: {
    readonly sessionLabel: string | null;
    readonly sourceName: string;
    readonly trimStartMs: number;
    readonly trimEndMs: number;
  },
): SwimAnalysisViewResult {
  const firstGate = competition.calibration.gates.find(
    (gate) => gate.id === "gate-a",
  );
  const secondGate = competition.calibration.gates.find(
    (gate) => gate.id === "gate-b",
  );
  const distanceMeters =
    firstGate && secondGate
      ? Math.abs(secondGate.distanceMeters - firstGate.distanceMeters)
      : competition.calibration.poolLengthMeters;
  const frameCount = competition.sampling.frameCount;

  return {
    competition,
    schemaVersion: competition.schemaVersion,
    analyzedAt: competition.analyzedAt,
    mode: competition.mode,
    stroke: competition.strokeStyle,
    sessionLabel: context.sessionLabel,
    sourceName: context.sourceName,
    trim: {
      startMs:
        competition.trim.startTimestampMs ?? context.trimStartMs,
      endMs: competition.trim.endTimestampMs ?? context.trimEndMs,
    },
    calibration: {
      firstGateX: firstGate?.normalizedX ?? 0,
      secondGateX: secondGate?.normalizedX ?? 1,
      distanceMeters,
    },
    metrics: metricViews(competition),
    events: competition.events.map(eventView),
    quality: {
      processedFrameCount: frameCount,
      detectedFrameCount: competition.sampling.detectedFrameCount,
      coverage:
        frameCount > 0
          ? competition.sampling.detectedFrameCount / frameCount
          : 0,
      warnings: competition.quality.warnings,
    },
  };
}

export async function runSwimAnalysisForUi(
  request: SwimAnalysisUiRequest,
  callbacks: SwimAnalysisUiCallbacks,
): Promise<SwimAnalysisViewResult> {
  const { signal, onProgress } = callbacks;
  throwIfAborted(signal);
  onProgress(2, "動画情報を確認しています");

  const metadata = await inspectCompetitionVideo(request.sourceFile, signal);
  const assessment = getModeFpsAssessment(metadata, request.mode);
  if (!assessment.allowed) {
    throw new Error(
      assessment.message ?? "この動画は精密解析に対応していません。",
    );
  }
  if (request.trimEndMs > metadata.durationMs + 1) {
    throw new Error("解析区間が動画の長さを超えています。");
  }

  const coarseEstimator = new WorkerPoseEstimator();
  let fineEstimator: WorkerPoseEstimator | null = null;
  const estimators = [coarseEstimator];
  const coarseFrames = new Map<string, PoseFrame>();
  const fineFrames = new Map<string, PoseFrame>();
  const sampledTimestamps = new Map<string, number>();
  const cameraMotionMonitor = new CameraMotionMonitor();
  const trimDurationMs = request.trimEndMs - request.trimStartMs;
  const timestampKey = (timestampMs: number) => timestampMs.toFixed(3);

  try {
    onProgress(6, "姿勢推定モデルを準備しています");
    await coarseEstimator.init();
    throwIfAborted(signal);

    await decodeCompetitionVideoTwoPasses(request.sourceFile, {
      startMs: request.trimStartMs,
      endMs: request.trimEndMs,
      mode: request.mode,
      coarseFps: COARSE_ANALYSIS_FPS,
      signal,
      onCoarseFrame: async (decodedFrame) => {
        throwIfAborted(signal);
        await cameraMotionMonitor.observe(
          decodedFrame.bitmap,
          decodedFrame.timestampMs,
        );
        const key = timestampKey(decodedFrame.timestampMs);
        sampledTimestamps.set(key, decodedFrame.timestampMs);
        const poseFrame = await coarseEstimator.estimate(
          decodedFrame.bitmap,
          decodedFrame.timestampMs,
        );
        if (poseFrame) {
          coarseFrames.set(key, {
            ...poseFrame,
            sourceFrameIndex: decodedFrame.frameIndex,
          });
        }
        const elapsedMs = decodedFrame.timestampMs - request.trimStartMs;
        onProgress(
          8 + 52 * Math.min(1, Math.max(0, elapsedMs / trimDurationMs)),
          `全体を粗解析中（${sampledTimestamps.size}フレーム）`,
        );
      },
      getCandidateTimestampsMs: async () => {
        await coarseEstimator.close();
        throwIfAborted(signal);

        const orderedCoarseFrames = [...coarseFrames.values()].sort(
          (first, second) => first.timestampMs - second.timestampMs,
        );
        if (orderedCoarseFrames.length === 0) {
          return [];
        }
        const provisionalCalibration = calibrationFromRequest(
          request,
          metadata.displayWidth,
          metadata.displayHeight,
          inferTravelDirection(orderedCoarseFrames),
        );
        const candidates = [
          ...deriveStrokeEvents(orderedCoarseFrames, request.stroke, {
            travelDirection: provisionalCalibration.travelDirection,
          }),
          ...detectGateCrossings(
            orderedCoarseFrames,
            provisionalCalibration,
          ),
        ]
          .map((event) => event.timestampMs)
          .sort((first, second) => first - second)
          .filter(
            (timestampMs, index, values) =>
              index === 0 ||
              timestampKey(timestampMs) !== timestampKey(values[index - 1]),
          );

        onProgress(
          65,
          candidates.length > 0
            ? `${candidates.length}件の候補を元fpsで精査します`
            : "候補イベントを集計しています",
        );
        if (candidates.length > 0) {
          const nextFineEstimator = new WorkerPoseEstimator();
          fineEstimator = nextFineEstimator;
          estimators.push(nextFineEstimator);
          await nextFineEstimator.init();
          throwIfAborted(signal);
        }
        return candidates;
      },
      onFineFrame: async (decodedFrame) => {
        throwIfAborted(signal);
        if (!fineEstimator) {
          throw new Error("精密解析用モデルを準備できませんでした。");
        }
        const key = timestampKey(decodedFrame.timestampMs);
        sampledTimestamps.set(key, decodedFrame.timestampMs);
        const poseFrame = await fineEstimator.estimate(
          decodedFrame.bitmap,
          decodedFrame.timestampMs,
        );
        if (poseFrame) {
          fineFrames.set(key, {
            ...poseFrame,
            sourceFrameIndex: decodedFrame.frameIndex,
          });
        }
        const elapsedMs = decodedFrame.timestampMs - request.trimStartMs;
        onProgress(
          68 + 22 * Math.min(1, Math.max(0, elapsedMs / trimDurationMs)),
          `候補前後を精密解析中（合計${sampledTimestamps.size}フレーム）`,
        );
      },
    });
    throwIfAborted(signal);
  } finally {
    await Promise.all(estimators.map((estimator) => estimator.close()));
  }

  const mergedFrames = new Map(coarseFrames);
  for (const [key, frame] of fineFrames) {
    mergedFrames.set(key, frame);
  }
  const frames = [...mergedFrames.values()].sort(
    (first, second) =>
      first.timestampMs - second.timestampMs ||
      (first.sourceFrameIndex ?? 0) - (second.sourceFrameIndex ?? 0),
  );
  const sampleTimestampsMs = [...sampledTimestamps.values()].sort(
    (first, second) => first - second,
  );
  const sourceFrameTimeline = await getCompetitionVideoFrameTimeline(
    request.sourceFile,
    signal,
  );

  if (cameraMotionMonitor.cameraMotionDetected) {
    throw new Error(
      "カメラ移動の可能性を検出しました。三脚で固定し、ズームや追従撮影をせずに撮り直してください。",
    );
  }

  if (frames.length === 0) {
    throw new Error(
      "泳者を検出できませんでした。全身が見える明るい固定撮影動画で、もう一度お試しください。",
    );
  }

  onProgress(92, "ゲート通過とストロークを集計しています");
  const input: AnalysisInputInfo = {
    kind: "video",
    name: request.sourceName,
    mimeType: request.sourceFile.type || metadata.detectedMimeType,
    width: metadata.displayWidth,
    height: metadata.displayHeight,
    durationMs: metadata.durationMs,
    mirrored: false,
  };
  const source = buildAnalysisResult(
    frames,
    input,
    TARGET_ANALYSIS_FPS,
    sampleTimestampsMs,
  );
  const calibration = calibrationFromRequest(
    request,
    metadata.displayWidth,
    metadata.displayHeight,
    inferTravelDirection(frames),
  );
  const competition = buildCompetitionAnalysisResult(source, {
    mode: request.mode,
    strokeStyle: request.stroke,
    calibration,
    sessionLabel: request.sessionLabel ?? undefined,
    videoInput: {
      container: metadata.detectedMimeType.split("/", 2)[1] ?? null,
      detectedMimeType: metadata.detectedMimeType,
      codec: metadata.codecParameterString ?? metadata.codec,
      rotation: Number(metadata.rotation),
      codedWidth: metadata.codedWidth,
      codedHeight: metadata.codedHeight,
      displayWidth: metadata.displayWidth,
      displayHeight: metadata.displayHeight,
      effectiveFps: metadata.effectiveFps,
      firstTimestampMs: metadata.firstTimestampMs,
      durationMs: metadata.durationMs,
      frameTimestampsMs: sourceFrameTimeline.timestampsMs,
    },
  });
  onProgress(100, "分析が完了しました");
  return viewResult(competition, {
    sessionLabel: request.sessionLabel,
    sourceName: request.sourceName,
    trimStartMs: request.trimStartMs,
    trimEndMs: request.trimEndMs,
  });
}

function manualEventFromEdit(
  result: CompetitionAnalysisResultV2,
  edit: Extract<SwimTimelineEdit, { readonly action: "add" }>,
): DetectedEvent {
  const isGate = edit.type === "gateCrossing";
  const side: EventSide =
    edit.type === "leftStroke"
      ? "left"
      : edit.type === "rightStroke"
        ? "right"
        : edit.type === "bilateralStroke"
          ? "both"
          : null;
  return {
    id: edit.id,
    type: isGate ? "gate-crossing" : "stroke",
    timestampMs: edit.timestampMs,
    frameIndex: 0,
    confidence: 1,
    status: "verified",
    source: "manual",
    strokeStyle: isGate ? null : result.strokeStyle,
    side,
    gateId: isGate ? edit.gateId : null,
  };
}

function overrideFromEdit(
  result: CompetitionAnalysisResultV2,
  edit: SwimTimelineEdit,
): ManualEventOverride {
  switch (edit.action) {
    case "add":
      return { action: "add", event: manualEventFromEdit(result, edit) };
    case "move":
      return {
        action: "update",
        eventId: edit.eventId,
        timestampMs: edit.timestampMs,
      };
    case "verify":
      return { action: "update", eventId: edit.eventId };
    case "remove":
      return { action: "remove", eventId: edit.eventId };
  }
}

export function applySwimTimelineEditForUi(
  result: SwimAnalysisViewResult,
  edit: SwimTimelineEdit,
): SwimAnalysisViewResult {
  const override = overrideFromEdit(result.competition, edit);
  const competition = recalculateCompetitionAnalysis(
    result.competition,
    [...result.competition.manualOverrides, override],
  );
  return viewResult(competition, {
    sessionLabel: result.sessionLabel,
    sourceName: result.sourceName,
    trimStartMs: result.trim.startMs,
    trimEndMs: result.trim.endMs,
  });
}

export function exportSwimAnalysisJsonForUi(
  result: SwimAnalysisViewResult,
): string {
  return exportCompetitionAnalysisJson(result.competition, { pretty: true });
}

export function exportSwimAnalysisCsvForUi(
  result: SwimAnalysisViewResult,
): string {
  return exportCompetitionAnalysisCsv(result.competition);
}
