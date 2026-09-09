import type { Point2D, PoseFrame } from "./analysis";

/** 競泳スタート専用の泳法。既存Competition V2とは独立している。 */
export type StartStrokeStyle =
  | "freestyle"
  | "butterfly"
  | "breaststroke"
  | "backstroke";

export type StartStyle = "dive" | "backstroke";
export type ResearchSexCategory = "male" | "female";
/**
 * precision は距離・速度・角度を含む現行の精密解析。
 * timing-only は30fps以上の映像で時間指標だけを扱う簡易解析。
 */
export type StartAnalysisMode = "precision" | "timing-only";

export type StartEventType =
  | "signal"
  | "movement-onset"
  | "hands-off"
  | "rear-foot-off"
  | "takeoff"
  | "head-entry"
  | "five-meter-head-crossing";

/**
 * candidate は自動候補であり、計算には絶対に使用しない。
 * verified はコーチがフレームを確認したイベントだけに設定する。
 */
export type StartEventStatus =
  | "candidate"
  | "needs-review"
  | "verified"
  | "unavailable";

export type StartEventSource = "automatic" | "manual";

export interface StartEvent {
  readonly id: string;
  readonly type: StartEventType;
  readonly timestampMs: number | null;
  readonly frameIndex: number | null;
  /** 頭頂など、画面上でコーチが指定した点。未指定はnull。 */
  readonly point: Point2D | null;
  readonly confidence: number;
  readonly status: StartEventStatus;
  readonly source: StartEventSource;
}

export interface StartCalibrationV1 {
  readonly schemaVersion: "1.0";
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** 0m壁と5m位置を画面正規化座標で指定する。 */
  readonly zeroMeter: Point2D;
  readonly fiveMeter: Point2D;
  /** 水面上の任意の2点。入水角度はこの直線に対して算出する。 */
  readonly waterSurface: readonly [Point2D, Point2D];
  readonly travelDirection: "left-to-right" | "right-to-left";
}

export interface StartVideoInfo {
  readonly name: string | null;
  readonly mimeType: string | null;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number | null;
  readonly effectiveFps: number | null;
  readonly fixedCamera: boolean;
  readonly sideOn: boolean;
  readonly singleSwimmer: boolean;
}

export interface StartAthleteProfile {
  readonly strokeStyle: StartStrokeStyle;
  readonly startStyle: StartStyle;
  readonly age: number;
  readonly researchSexCategory: ResearchSexCategory;
}

export type StartMetricType =
  | "movement-onset-time"
  | "block-contact-time"
  | "push-off-time"
  | "flight-time"
  | "entry-time"
  | "entry-distance"
  | "takeoff-forward-velocity"
  | "entry-forward-velocity"
  | "entry-torso-angle"
  | "five-meter-time"
  | "zero-to-five-meter-average-speed";

export type StartMetricUnit = "ms" | "s" | "m" | "m/s" | "deg";
export type StartMetricStatus = "verified" | "unavailable";

export interface StartMetric {
  readonly id: StartMetricType;
  readonly label: string;
  readonly value: number | null;
  readonly unit: StartMetricUnit;
  readonly status: StartMetricStatus;
  /** 値が成立するために verified である必要があるイベントID。 */
  readonly requiredEventIds: readonly string[];
  readonly note: string | null;
}

export interface StartPosePoint extends Point2D {
  readonly timestampMs: number;
  readonly frameIndex: number;
  readonly visibility: number;
}

export interface StartAnalysisQuality {
  readonly status: "ready" | "needs-review" | "unavailable";
  readonly warnings: readonly string[];
}

export interface StartEventRevision {
  readonly revision: number;
  readonly eventId: string;
  readonly previous: StartEvent | null;
  readonly next: StartEvent;
}

/** 画面外の5m通過を別計時で記録するための値。指標・百分位には使わない。 */
export interface StartExternalTiming {
  readonly fiveMeterTimeMs: number | null;
  readonly source: "external-stopwatch";
  readonly usedForPercentile: false;
  readonly note: string;
}

export interface StartPercentileBand {
  readonly percentile: 3 | 10 | 25 | 50 | 75 | 90 | 97;
  readonly value: number;
}

export type StartReferenceMetric =
  | "block-contact-time"
  | "entry-time"
  | "entry-distance"
  | "five-meter-time";

export interface StartReferenceBand {
  readonly strokeStyle: StartStrokeStyle;
  readonly researchSexCategory: ResearchSexCategory;
  readonly metric: StartReferenceMetric;
  readonly unit: "s" | "m";
  readonly higherIsBetter: boolean;
  readonly bands: readonly StartPercentileBand[];
}

export interface StartReferenceDataset {
  readonly schemaVersion: "1.0";
  readonly id: "born-2026-appendix-a";
  readonly status: "unavailable" | "available";
  readonly source: {
    readonly citation: string;
    readonly url: string;
    readonly doi: string | null;
    readonly license: "CC BY 4.0";
    readonly note: string;
  };
  readonly bands: readonly StartReferenceBand[];
}

export interface StartPercentileResult {
  readonly metric: StartReferenceMetric;
  readonly band: "below-p3" | "p3-p10" | "p10-p25" | "p25-p50" | "p50-p75" | "p75-p90" | "p90-p97" | "above-p97" | null;
  readonly referenceStatus: StartReferenceDataset["status"];
  readonly note: string | null;
}

export interface StartAnalysisResultV1 {
  readonly schemaVersion: "1.0";
  /** 保存結果を別の測定条件として誤比較しないため、選択した手法を保持する。 */
  readonly analysisMode: StartAnalysisMode;
  /** 簡易タイムで校正を持たない場合も候補生成条件を再現する。 */
  readonly travelDirection: StartCalibrationV1["travelDirection"];
  readonly athlete: StartAthleteProfile;
  readonly video: StartVideoInfo;
  readonly calibration: StartCalibrationV1 | null;
  readonly events: readonly StartEvent[];
  readonly metrics: readonly StartMetric[];
  readonly percentiles: readonly StartPercentileResult[];
  readonly quality: StartAnalysisQuality;
  readonly posePoints: readonly StartPosePoint[];
  /** 生のPoseもJSON再現用に保持する。 */
  readonly poseFrames: readonly PoseFrame[];
  readonly externalTiming: StartExternalTiming;
  readonly revisionHistory: readonly StartEventRevision[];
}
