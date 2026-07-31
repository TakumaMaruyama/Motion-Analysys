import type {
  AnalysisMode,
  CompetitionAnalysisResultV2,
  EventStatus,
  StrokeStyle,
} from "@/types/competition";

export type SwimWorkflowStep =
  | "setup"
  | "calibration"
  | "analyzing"
  | "results";

export type SwimMetricKey =
  | "intervalTimeSec"
  | "averageSpeedMps"
  | "strokeCount"
  | "cycleCount"
  | "cycleRateCpm"
  | "distancePerCycleM";

export type SwimEventType =
  | "leftStroke"
  | "rightStroke"
  | "bilateralStroke"
  | "gateCrossing";

export interface SwimTimelineEventView {
  readonly id: string;
  readonly type: SwimEventType;
  readonly timestampMs: number;
  readonly gateId: "gate-a" | "gate-b" | null;
  readonly confidence: number | null;
  readonly source: "automatic" | "manual";
  readonly status: EventStatus;
}

export interface SwimMetricView {
  readonly key: SwimMetricKey;
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly detail: string;
  readonly quality: EventStatus;
}

export interface SwimAnalysisViewResult {
  readonly competition: CompetitionAnalysisResultV2;
  readonly schemaVersion: string;
  readonly analyzedAt: string;
  readonly mode: AnalysisMode;
  readonly stroke: StrokeStyle;
  readonly sessionLabel: string | null;
  readonly sourceName: string;
  readonly trim: {
    readonly startMs: number;
    readonly endMs: number;
  };
  readonly calibration: {
    readonly firstGateX: number;
    readonly secondGateX: number;
    readonly distanceMeters: number;
  };
  readonly metrics: readonly SwimMetricView[];
  readonly events: readonly SwimTimelineEventView[];
  readonly quality: {
    readonly processedFrameCount: number;
    readonly detectedFrameCount: number;
    readonly coverage: number;
    readonly warnings: readonly string[];
  };
}

export interface SwimAnalysisUiRequest {
  readonly mode: AnalysisMode;
  readonly stroke: StrokeStyle;
  readonly sessionLabel: string | null;
  readonly sourceName: string;
  readonly sourceFile: File;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly trimStartMs: number;
  readonly trimEndMs: number;
  readonly firstGateX: number;
  readonly secondGateX: number;
  readonly distanceMeters: number;
}

export interface SwimAnalysisUiCallbacks {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number, message: string) => void;
}
