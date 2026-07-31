import type {
  AnalysisInputInfo,
  AnalysisResultV1,
  AnalysisSamplingInfo,
  PoseFrame,
} from "./analysis";

/** 競泳現場で切り替える解析対象。 */
export type AnalysisMode = "swim" | "turn" | "start";

/** 対応する競泳4泳法。 */
export type StrokeStyle =
  | "freestyle"
  | "backstroke"
  | "breaststroke"
  | "butterfly";

export type TravelDirection = "left-to-right" | "right-to-left";

export type DistanceGateRole =
  | "start"
  | "split"
  | "turn"
  | "finish";

/**
 * 画像上の縦線と、実距離を対応させる校正ゲート。
 * normalizedX は入力画像の左端を0、右端を1とする。
 */
export interface DistanceGate {
  readonly id: string;
  readonly label: string;
  readonly normalizedX: number;
  readonly distanceMeters: number;
  readonly role: DistanceGateRole;
}

/**
 * 単一カメラ・単一レーン用の校正情報。
 * 物理速度は、このプロファイルのゲート間距離だけから算出する。
 */
export interface CalibrationProfileV1 {
  readonly schemaVersion: "1.0";
  readonly id: string;
  readonly label: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly poolLengthMeters: number;
  readonly travelDirection: TravelDirection;
  readonly gates: readonly DistanceGate[];
  /** Pose landmark の visibility を有効とみなす下限。 */
  readonly visibilityThreshold: number;
  readonly createdAt?: string;
}

export type DetectedEventType = "stroke" | "gate-crossing";

export type EventSide = "left" | "right" | "both" | null;
export type EventSource = "automatic" | "manual";
export type EventStatus =
  | "confirmed"
  | "needs-review"
  | "unavailable"
  | "verified";

/** 自動検出または手動補正された、動画上の一点の出来事。 */
export interface DetectedEvent {
  readonly id: string;
  readonly type: DetectedEventType;
  readonly timestampMs: number;
  /** rawPoseFrames上の最近傍フレーム。補間イベントも参照可能にする。 */
  readonly frameIndex: number;
  readonly confidence: number;
  readonly status: EventStatus;
  readonly source: EventSource;
  readonly strokeStyle: StrokeStyle | null;
  readonly side: EventSide;
  readonly gateId: string | null;
}

export type MeasurementType =
  | "interval-time"
  | "average-speed"
  | "stroke-count"
  | "cycle-count"
  | "cycle-rate"
  | "distance-per-cycle";

export type MeasurementUnit =
  | "ms"
  | "s"
  | "m"
  | "m/s"
  | "cycles/min"
  | "m/cycle"
  | "count";

/**
 * confidence 0.5未満または算出不能のときだけvalueをnullにする。
 * needs-reviewは値を表示しつつ、UIで確認対象にできる。
 */
export interface Measurement {
  readonly id: string;
  readonly type: MeasurementType;
  readonly label: string;
  readonly value: number | null;
  readonly unit: MeasurementUnit;
  readonly confidence: number;
  readonly status: EventStatus;
  readonly fromEventId: string | null;
  readonly toEventId: string | null;
  readonly distanceMeters: number | null;
}

export type ManualEventOverride =
  | {
      readonly action: "add";
      readonly event: DetectedEvent;
    }
  | {
      readonly action: "update";
      readonly eventId: string;
      readonly timestampMs?: number;
      readonly type?: DetectedEventType;
      readonly strokeStyle?: StrokeStyle | null;
      readonly side?: EventSide;
      readonly gateId?: string | null;
    }
  | {
      readonly action: "remove";
      readonly eventId: string;
    };

export interface AnalysisTrimRange {
  readonly startTimestampMs: number | null;
  readonly endTimestampMs: number | null;
}

export interface CompetitionAnalysisQuality {
  readonly status: EventStatus;
  readonly confidence: number;
  readonly poseDetectionRate: number;
  readonly eventConfidence: number;
  readonly warnings: readonly string[];
}

export interface CompetitionAnalysisRevision {
  readonly revision: number;
  readonly overrides: readonly ManualEventOverride[];
}

/** デコード前のコンテナ検査で得た、競泳解析用の動画入力情報。 */
export interface CompetitionVideoInputInfo {
  readonly container: string | null;
  readonly detectedMimeType: string | null;
  readonly codec: string | null;
  readonly rotation: number;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly effectiveFps: number | null;
  readonly firstTimestampMs: number | null;
  readonly durationMs: number | null;
  /** 動画先頭を0とした、元動画全フレームのpresentation timestamp。 */
  readonly frameTimestampsMs: readonly number[];
}

/** 全モードで共有する、V1 Pose解析を保持した競泳V2結果。 */
export interface CompetitionAnalysisResultV2Base {
  readonly schemaVersion: "2.0";
  readonly analyzedAt: string;
  readonly sessionLabel: string | null;
  readonly strokeStyle: StrokeStyle;
  readonly calibration: CalibrationProfileV1;
  readonly input: AnalysisInputInfo;
  readonly videoInput: CompetitionVideoInputInfo;
  readonly sampling: AnalysisSamplingInfo;
  readonly trim: AnalysisTrimRange;
  readonly rawPoseFrames: readonly PoseFrame[];
  readonly quality: CompetitionAnalysisQuality;
  readonly source: AnalysisResultV1;
  readonly automaticEvents: readonly DetectedEvent[];
  readonly manualOverrides: readonly ManualEventOverride[];
  readonly events: readonly DetectedEvent[];
  readonly measurements: readonly Measurement[];
  readonly revisionHistory: readonly CompetitionAnalysisRevision[];
}

/** 泳区間解析。指標追加時はこのvariantだけを拡張できる。 */
export interface SwimCompetitionAnalysisResultV2
  extends CompetitionAnalysisResultV2Base {
  readonly mode: "swim";
}

/** ターン解析の将来拡張用variant。 */
export interface TurnCompetitionAnalysisResultV2
  extends CompetitionAnalysisResultV2Base {
  readonly mode: "turn";
}

/** スタート解析の将来拡張用variant。 */
export interface StartCompetitionAnalysisResultV2
  extends CompetitionAnalysisResultV2Base {
  readonly mode: "start";
}

/** modeで安全に絞り込める競泳解析V2のdiscriminated union。 */
export type CompetitionAnalysisResultV2 =
  | SwimCompetitionAnalysisResultV2
  | TurnCompetitionAnalysisResultV2
  | StartCompetitionAnalysisResultV2;

export interface CompetitionAnalysisResultV2ByMode {
  readonly swim: SwimCompetitionAnalysisResultV2;
  readonly turn: TurnCompetitionAnalysisResultV2;
  readonly start: StartCompetitionAnalysisResultV2;
}

export type CompetitionAnalysisResultForMode<
  Mode extends AnalysisMode,
> = CompetitionAnalysisResultV2ByMode[Mode];
