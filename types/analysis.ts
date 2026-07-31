/**
 * MediaPipe Pose Landmarker の33点を、モデルの出力順で定義する。
 *
 * この順序は公開データやCSVの互換性に関わるため変更しないこと。
 */
export const POSE_LANDMARK_NAMES = [
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_pinky",
  "right_pinky",
  "left_index",
  "right_index",
  "left_thumb",
  "right_thumb",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot_index",
  "right_foot_index",
] as const;

export type PoseLandmarkName = (typeof POSE_LANDMARK_NAMES)[number];

export const POSE_LANDMARK_INDEX = {
  nose: 0,
  left_eye_inner: 1,
  left_eye: 2,
  left_eye_outer: 3,
  right_eye_inner: 4,
  right_eye: 5,
  right_eye_outer: 6,
  left_ear: 7,
  right_ear: 8,
  mouth_left: 9,
  mouth_right: 10,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_pinky: 17,
  right_pinky: 18,
  left_index: 19,
  right_index: 20,
  left_thumb: 21,
  right_thumb: 22,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
} as const satisfies Record<PoseLandmarkName, number>;

export type PoseLandmarkIndex =
  (typeof POSE_LANDMARK_INDEX)[PoseLandmarkName];

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface PoseLandmark extends Point2D {
  /**
   * 画像幅を基準に正規化された相対的な奥行き。
   * 校正済みの物理距離ではない。
   */
  readonly z: number;
  readonly visibility: number;
  readonly presence?: number;
}

export interface PoseWorldLandmark {
  /**
   * モデルが推定した腰中心基準の相対座標。
   * 単眼推定なので実測のcm/mとして表示しないこと。
   */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility: number;
  readonly presence?: number;
}

type FixedLengthTuple<
  T,
  Length extends number,
  Values extends readonly T[] = readonly [],
> = Values["length"] extends Length
  ? Values
  : FixedLengthTuple<T, Length, readonly [...Values, T]>;

/** 33要素であることを型レベルでも固定した正規化ランドマーク。 */
export type PoseLandmarks = FixedLengthTuple<PoseLandmark, 33>;

/** 33要素であることを型レベルでも固定したモデル相対座標。 */
export type PoseWorldLandmarks = FixedLengthTuple<
  PoseWorldLandmark,
  33
>;

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface PoseFrame {
  /** 解析対象動画またはカメラストリーム先頭からの時刻（ミリ秒）。 */
  readonly timestampMs: number;
  /** 元動画でのフレーム番号。旧V1データやライブ入力では未設定。 */
  readonly sourceFrameIndex?: number;
  readonly imageSize: ImageDimensions;
  readonly landmarks: PoseLandmarks;
  readonly worldLandmarks: PoseWorldLandmarks | null;
}

export interface PoseModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly runtime: string;
  readonly runtimeVersion: string;
  readonly sha256: string;
  readonly landmarkCount: 33;
}

/**
 * 推論実装をUI・指標計算から切り離すためのadapter。
 *
 * TFrameはworker内ならImageBitmap、メインスレッド実装なら
 * HTMLVideoElementなど、呼び出し側の入力型を指定できる。
 */
export interface PoseEstimator<TFrame = ImageBitmap> {
  readonly model: PoseModelInfo;
  init(): Promise<void>;
  estimate(frame: TFrame, timestampMs: number): Promise<PoseFrame | null>;
  close(): Promise<void>;
}

export type MetricStatus =
  | "valid"
  | "low-confidence"
  | "unavailable";

export type MetricUnit =
  | "deg"
  | "normalized"
  | "ratio"
  | "ms"
  | "s"
  | "m"
  | "m/s"
  | "cycles/min"
  | "m/cycle"
  | "px"
  | "count";

export interface MetricValue {
  /**
   * statusがvalidのときだけ数値を持つ。
   * 低信頼度を0などの有効値に見せないため、それ以外はnullとする。
   */
  readonly value: number | null;
  readonly unit: MetricUnit;
  readonly confidence: number;
  readonly status: MetricStatus;
}

export interface TimedMetricValue extends MetricValue {
  readonly timestampMs: number;
}

export interface RangeOfMotionSummary {
  readonly minimum: MetricValue;
  readonly maximum: MetricValue;
  readonly range: MetricValue;
  readonly mean: MetricValue;
  readonly minimumTimestampMs: number | null;
  readonly maximumTimestampMs: number | null;
  readonly sampleCount: number;
  readonly validSampleCount: number;
}

export interface TimedTrajectoryPoint extends Point2D {
  readonly timestampMs: number;
  readonly visibility: number;
}

export interface NormalizedBoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface TrajectorySummary {
  readonly pathLength: MetricValue;
  readonly displacement: MetricValue;
  readonly rangeX: MetricValue;
  readonly rangeY: MetricValue;
  readonly bounds: NormalizedBoundingBox | null;
  readonly firstTimestampMs: number | null;
  readonly lastTimestampMs: number | null;
  readonly durationMs: number;
  readonly sampleCount: number;
  readonly validSampleCount: number;
  readonly lowConfidenceSampleCount: number;
}

export interface AnalysisMetricSeries {
  readonly label: string;
  readonly values: readonly TimedMetricValue[];
  readonly summary: RangeOfMotionSummary;
}

export interface AnalysisInputInfo {
  readonly kind: "camera" | "video";
  readonly name: string | null;
  readonly mimeType: string | null;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number | null;
  readonly mirrored: boolean;
}

export interface AnalysisSamplingInfo {
  /** 要求した固定サンプルレート。アップロード動画では最大30Hz。 */
  readonly targetFps: number;
  /** 人物検出の成否にかかわらず、推論へ渡した固定時刻の総数。 */
  readonly frameCount: number;
  /** 33点のPoseFrameを取得できたフレーム数。 */
  readonly detectedFrameCount: number;
  /** 再解析時に同じ入力へ適用する時刻列（ミリ秒）。 */
  readonly timestampsMs: readonly number[];
  readonly startTimestampMs: number | null;
  readonly endTimestampMs: number | null;
}

export interface AnalysisResultV1 {
  readonly schemaVersion: "1.0";
  readonly analyzedAt: string;
  readonly input: AnalysisInputInfo;
  readonly sampling: AnalysisSamplingInfo;
  readonly model: PoseModelInfo;
  readonly frames: readonly PoseFrame[];
  readonly metrics: Readonly<Record<string, AnalysisMetricSeries>>;
  readonly trajectories: Readonly<Record<string, TrajectorySummary>>;
}

export const POSE_LANDMARKER_FULL_MODEL = {
  id: "mediapipe-pose-landmarker-full",
  displayName: "MediaPipe Pose Landmarker Full",
  runtime: "@mediapipe/tasks-vision",
  runtimeVersion: "1.0.0",
  sha256: "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad",
  landmarkCount: 33,
} as const satisfies PoseModelInfo;
