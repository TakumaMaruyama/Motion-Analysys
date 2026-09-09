import {
  POSE_LANDMARK_INDEX,
  type PoseFrame,
  type PoseLandmark,
} from "../../types/analysis";
import type {
  StartAnalysisQuality,
  StartAnalysisMode,
  StartAnalysisResultV1,
  StartAthleteProfile,
  StartCalibrationV1,
  StartEvent,
  StartEventRevision,
  StartEventStatus,
  StartEventType,
  StartMetric,
  StartMetricType,
  StartPosePoint,
  StartVideoInfo,
} from "../../types/start";
import {
  calibratedDistanceMeters,
  forwardDistanceMeters,
  validateStartCalibration,
  waterSurfaceAngleRadians,
} from "./calibration";
import {
  autoConfirmStartEvents,
  isValidAutoConfirmedStartEvent,
} from "./auto-confirmation";
import {
  BORN_2026_REFERENCE_DATASET,
  percentileForStartMetric,
} from "./references";

function eventOrder(type: StartEventType): number {
  if (type === "hands-off" || type === "rear-foot-off") return 2;
  return type === "signal" ? 0 : type === "movement-onset" ? 1 : type === "takeoff" ? 3 : type === "head-entry" ? 4 : 5;
}

const START_METRIC_DEFINITIONS: readonly {
  readonly id: StartMetricType;
  readonly label: string;
  readonly unit: StartMetric["unit"];
}[] = [
  { id: "movement-onset-time", label: "初動時間", unit: "ms" },
  { id: "block-contact-time", label: "ブロック／壁接触時間", unit: "ms" },
  { id: "push-off-time", label: "動作開始後の押し出し時間", unit: "ms" },
  { id: "flight-time", label: "飛行時間", unit: "ms" },
  { id: "entry-time", label: "入水時間", unit: "ms" },
  { id: "entry-distance", label: "入水距離", unit: "m" },
  { id: "takeoff-forward-velocity", label: "離台直後の推定前方速度", unit: "m/s" },
  { id: "entry-forward-velocity", label: "入水直前の推定前方速度", unit: "m/s" },
  { id: "entry-torso-angle", label: "入水時体幹角度", unit: "deg" },
  { id: "five-meter-time", label: "5m時間", unit: "ms" },
  { id: "zero-to-five-meter-average-speed", label: "0～5m平均速度", unit: "m/s" },
];

const TIMING_ONLY_METRICS = new Set<StartMetricType>([
  "movement-onset-time",
  "block-contact-time",
  "push-off-time",
  "flight-time",
  "entry-time",
  "five-meter-time",
]);

function isReferenceMetric(
  metric: StartMetricType,
): metric is "block-contact-time" | "entry-time" | "entry-distance" | "five-meter-time" {
  return metric === "block-contact-time" || metric === "entry-time" || metric === "entry-distance" || metric === "five-meter-time";
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function finiteTimestamp(event: StartEvent | undefined): event is StartEvent & { readonly timestampMs: number } {
  return Boolean(event && Number.isFinite(event.timestampMs));
}

function isValidVerifiedStartEvent(event: StartEvent): boolean {
  return event.status === "verified" &&
    event.source === "manual" &&
    event.timestampMs !== null &&
    Number.isFinite(event.timestampMs) &&
    event.timestampMs >= 0 &&
    event.frameIndex !== null &&
    Number.isInteger(event.frameIndex) &&
    event.frameIndex >= 0;
}

function isResolvedStartEvent(event: StartEvent): boolean {
  return isValidVerifiedStartEvent(event) || isValidAutoConfirmedStartEvent(event);
}

/** 手動確認と自動判定の双方について、出所に対応する証跡を検査する。 */
export function validateVerifiedStartEvent(event: StartEvent): void {
  if (event.status === "verified" && !isValidVerifiedStartEvent(event)) {
    throw new TypeError(
      "A verified start event requires a non-negative finite timestamp, a non-negative integer frame index, and manual source.",
    );
  }
  if (event.status === "confirmed" && !isValidAutoConfirmedStartEvent(event)) {
    throw new TypeError(
      "An automatically confirmed start event requires a valid frame, score, source, and policy decision.",
    );
  }
}

function eventByType(events: readonly StartEvent[], type: StartEventType): StartEvent | undefined {
  const matching = events.filter((event) => event.type === type);
  // 同種の自動判定より、コーチが確認したイベントを常に優先する。
  return matching.find(isValidVerifiedStartEvent) ?? matching.find(isValidAutoConfirmedStartEvent) ?? matching[0];
}

function metric(
  id: StartMetricType,
  events: readonly StartEvent[],
  required: readonly StartEventType[],
  value: number | null,
  note: string | null = null,
): StartMetric {
  const definition = START_METRIC_DEFINITIONS.find((item) => item.id === id)!;
  const dependencies = required.map((type) => eventByType(events, type));
  const requiredEventIds = dependencies.flatMap((event) => event ? [event.id] : []);
  const eventsResolved = dependencies.length === required.length && dependencies.every(
    (event) => finiteTimestamp(event) && isResolvedStartEvent(event),
  );
  const valid = eventsResolved && value !== null && Number.isFinite(value);
  const containsAutomatic = dependencies.some((event) => event?.status === "confirmed");
  return {
    id,
    label: definition.label,
    value: valid ? value : null,
    unit: definition.unit,
    status: valid ? containsAutomatic ? "confirmed" : "verified" : "unavailable",
    requiredEventIds,
    note: valid ? note : (note ?? "必要イベントの自動判定またはコーチ確認が完了するまで計算しません。"),
  };
}

/** 背泳ぎは壁スタート、他の3泳法は飛び込みスタートとして扱う。 */
export function startStyleForStroke(strokeStyle: StartAthleteProfile["strokeStyle"]): StartAthleteProfile["startStyle"] {
  return strokeStyle === "backstroke" ? "backstroke" : "dive";
}

/**
 * 自動判定またはコーチ確認済みイベントの順序違反を返す。
 */
export function validateStartEventSequence(
  events: readonly StartEvent[],
  startStyle: StartAthleteProfile["startStyle"],
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<StartEventType>();
  let previousOrder = -1;
  let previousTime = -Infinity;
  for (const event of events
    .filter((item) => (item.status === "confirmed" || item.status === "verified") && item.timestampMs !== null)
    .slice()
    .sort((first, second) => (first.timestampMs! - second.timestampMs!) || first.id.localeCompare(second.id))) {
    if (seen.has(event.type)) errors.push(`イベント ${event.type} が重複しています。`);
    seen.add(event.type);
    if (startStyle === "backstroke" && event.type === "rear-foot-off") {
      errors.push("背泳ぎスタートでは rear-foot-off を使用できません。");
    }
    const order = eventOrder(event.type);
    if (order < previousOrder || event.timestampMs! < previousTime) {
      errors.push("スタートイベントの時系列順序が不正です。");
    }
    previousOrder = Math.max(previousOrder, order);
    previousTime = event.timestampMs!;
  }
  return errors;
}

/** 自動推定候補を作る。自動判定ポリシーまたはコーチ確認を通るまで指標を確定しない。 */
export function createStartEventCandidate(
  type: StartEventType,
  candidate: Omit<StartEvent, "id" | "type" | "status" | "source" | "confidence"> & { readonly confidence?: number },
): StartEvent {
  const timestamp = candidate.timestampMs === null ? "na" : candidate.timestampMs.toFixed(3).replace(/\.0+$/, "");
  return {
    id: `start:${type}:${timestamp}`,
    type,
    timestampMs: candidate.timestampMs,
    frameIndex: candidate.frameIndex,
    point: candidate.point,
    confidence: clampConfidence(candidate.confidence ?? 0),
    status: candidate.timestampMs === null ? "unavailable" : "candidate",
    source: "automatic",
  };
}

/** コーチがフレームを見て確定したイベントだけをverifiedにする。 */
export function verifyStartEvent(
  event: StartEvent,
  update: Pick<StartEvent, "timestampMs" | "frameIndex" | "point">,
): StartEvent {
  if (
    update.timestampMs === null ||
    !Number.isFinite(update.timestampMs) ||
    update.timestampMs < 0 ||
    update.frameIndex === null ||
    !Number.isInteger(update.frameIndex) ||
    update.frameIndex < 0
  ) {
    throw new TypeError(
      "A verified start event requires a non-negative finite timestamp and a non-negative integer frame index.",
    );
  }
  return {
    ...event,
    ...update,
    confidence: 1,
    status: "verified",
    source: "manual",
    automaticDecision: undefined,
  };
}

function pointFromFrame(frame: PoseFrame, frameIndex: number): StartPosePoint | null {
  const leftHip = frame.landmarks[POSE_LANDMARK_INDEX.left_hip];
  const rightHip = frame.landmarks[POSE_LANDMARK_INDEX.right_hip];
  const leftShoulder = frame.landmarks[POSE_LANDMARK_INDEX.left_shoulder];
  const rightShoulder = frame.landmarks[POSE_LANDMARK_INDEX.right_shoulder];
  const pair = (first: PoseLandmark, second: PoseLandmark) =>
    Number.isFinite(first.x) && Number.isFinite(first.y) && Number.isFinite(second.x) && Number.isFinite(second.y)
      ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, visibility: Math.min(first.visibility, second.visibility) }
      : null;
  const center = pair(leftHip, rightHip) ?? pair(leftShoulder, rightShoulder);
  if (!center || !Number.isFinite(frame.timestampMs)) return null;
  return { ...center, timestampMs: frame.timestampMs, frameIndex: frame.sourceFrameIndex ?? frameIndex };
}

export function deriveStartPosePoints(frames: readonly PoseFrame[]): readonly StartPosePoint[] {
  return frames.flatMap((frame, index) => {
    const point = pointFromFrame(frame, index);
    return point ? [point] : [];
  }).sort((first, second) => first.timestampMs - second.timestampMs || first.frameIndex - second.frameIndex);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Theil-Sen（全ペア傾きの中央値）で、X方向の2D速度を頑健に推定する。 */
export function robustForwardVelocityMps(
  points: readonly StartPosePoint[],
  calibration: StartCalibrationV1,
  startTimestampMs: number,
  endTimestampMs: number,
): number | null {
  if (!Number.isFinite(startTimestampMs) || !Number.isFinite(endTimestampMs) || endTimestampMs <= startTimestampMs) return null;
  let threshold: number;
  try {
    validateStartCalibration(calibration);
    threshold = 0.5;
  } catch {
    return null;
  }
  const inWindow = points.filter((point) => point.timestampMs >= startTimestampMs && point.timestampMs <= endTimestampMs && point.visibility >= threshold)
    .map((point) => ({ ...point, distance: calibratedDistanceMeters(point.x, calibration) }))
    .filter((point): point is StartPosePoint & { readonly distance: number } => point.distance !== null);
  if (inWindow.length < 2) return null;
  const slopes: number[] = [];
  for (let first = 0; first < inWindow.length - 1; first += 1) {
    for (let second = first + 1; second < inWindow.length; second += 1) {
      const deltaSeconds = (inWindow[second].timestampMs - inWindow[first].timestampMs) / 1000;
      if (deltaSeconds > 0) slopes.push((inWindow[second].distance - inWindow[first].distance) / deltaSeconds);
    }
  }
  return median(slopes);
}

function torsoAngleDegrees(
  frames: readonly PoseFrame[],
  timestampMs: number,
  calibration: StartCalibrationV1,
  effectiveFps: number | null,
): number | null {
  const surfaceAngle = waterSurfaceAngleRadians(calibration);
  if (
    surfaceAngle === null ||
    effectiveFps === null ||
    !Number.isFinite(effectiveFps) ||
    effectiveFps <= 0
  ) return null;
  const closest = frames.reduce<PoseFrame | null>((best, frame) =>
    best === null || Math.abs(frame.timestampMs - timestampMs) < Math.abs(best.timestampMs - timestampMs) ? frame : best,
  null);
  // 入水時刻から2フレームを超えるPoseは入水姿勢として扱わない。
  if (!closest || Math.abs(closest.timestampMs - timestampMs) > (2_000 / effectiveFps)) return null;
  const midpoint = (first: PoseLandmark, second: PoseLandmark) =>
    Number.isFinite(first.x) && Number.isFinite(first.y) && Number.isFinite(second.x) && Number.isFinite(second.y) &&
    first.visibility >= 0.5 && second.visibility >= 0.5
      ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      : null;
  const shoulders = midpoint(closest.landmarks[POSE_LANDMARK_INDEX.left_shoulder], closest.landmarks[POSE_LANDMARK_INDEX.right_shoulder]);
  const hips = midpoint(closest.landmarks[POSE_LANDMARK_INDEX.left_hip], closest.landmarks[POSE_LANDMARK_INDEX.right_hip]);
  if (!shoulders || !hips) return null;
  const torso = Math.atan2(shoulders.y - hips.y, shoulders.x - hips.x);
  let degrees = Math.abs(((torso - surfaceAngle) * 180) / Math.PI) % 180;
  if (degrees > 90) degrees = 180 - degrees;
  return Number.isFinite(degrees) ? degrees : null;
}

function calculateMetrics(
  events: readonly StartEvent[],
  calibration: StartCalibrationV1 | null,
  posePoints: readonly StartPosePoint[],
  poseFrames: readonly PoseFrame[],
  effectiveFps: number | null,
): readonly StartMetric[] {
  const signal = eventByType(events, "signal");
  const movement = eventByType(events, "movement-onset");
  const takeoff = eventByType(events, "takeoff");
  const entry = eventByType(events, "head-entry");
  const five = eventByType(events, "five-meter-head-crossing");
  const duration = (first: StartEvent | undefined, second: StartEvent | undefined) => finiteTimestamp(first) && finiteTimestamp(second) && second.timestampMs >= first.timestampMs ? second.timestampMs - first.timestampMs : null;
  const usableCalibration = calibration === null ? null : (() => { try { validateStartCalibration(calibration); return calibration; } catch { return null; } })();
  const entryDistance = usableCalibration && entry?.point ? forwardDistanceMeters(entry.point, usableCalibration) : null;
  const takeoffVelocity = usableCalibration && finiteTimestamp(takeoff)
    ? robustForwardVelocityMps(posePoints, usableCalibration, takeoff.timestampMs, takeoff.timestampMs + 100)
    : null;
  const entryVelocity = usableCalibration && finiteTimestamp(entry)
    ? robustForwardVelocityMps(posePoints, usableCalibration, entry.timestampMs - 100, entry.timestampMs)
    : null;
  const entryAngle = usableCalibration && finiteTimestamp(entry)
    ? torsoAngleDegrees(poseFrames, entry.timestampMs, usableCalibration, effectiveFps)
    : null;
  const fiveTime = duration(signal, five);
  return [
    metric("movement-onset-time", events, ["signal", "movement-onset"], duration(signal, movement)),
    metric("block-contact-time", events, ["signal", "takeoff"], duration(signal, takeoff)),
    metric("push-off-time", events, ["movement-onset", "takeoff"], duration(movement, takeoff)),
    metric("flight-time", events, ["takeoff", "head-entry"], duration(takeoff, entry)),
    metric("entry-time", events, ["signal", "head-entry"], duration(signal, entry)),
    metric("entry-distance", events, ["head-entry"], entryDistance, usableCalibration ? null : "0m・5m・水面の校正が必要です。"),
    metric("takeoff-forward-velocity", events, ["takeoff"], takeoffVelocity, "離台後100msの体幹中心XをTheil-Sen回帰で推定。"),
    metric("entry-forward-velocity", events, ["head-entry"], entryVelocity, "入水前100msの体幹中心XをTheil-Sen回帰で推定。"),
    metric("entry-torso-angle", events, ["head-entry"], entryAngle, "水面に対する2D体幹角度。"),
    metric("five-meter-time", events, ["signal", "five-meter-head-crossing"], fiveTime),
    metric("zero-to-five-meter-average-speed", events, ["signal", "five-meter-head-crossing"], fiveTime !== null && fiveTime > 0 ? 5 / (fiveTime / 1000) : null),
  ];
}

export function assessStartAnalysisQuality(
  athlete: StartAthleteProfile,
  video: StartVideoInfo,
  calibration: StartCalibrationV1 | null,
  events: readonly StartEvent[],
  analysisMode: StartAnalysisMode = "precision",
): StartAnalysisQuality {
  const warnings: string[] = [];
  if (!Number.isInteger(athlete.age) || athlete.age < 13) warnings.push("13歳未満は本アプリの解析対象外です。");
  if (analysisMode === "precision") {
    if (video.effectiveFps === null || video.effectiveFps + 0.05 < 60) warnings.push("精密モードは最低60fpsが必要です。");
    else if (video.effectiveFps < 120) warnings.push("120fpsを推奨します。イベント精度は未検証です。");
    if (!video.fixedCamera) warnings.push("精密モードは固定カメラが必要です。");
    if (!video.sideOn) warnings.push("精密モードは真横撮影が必要です。");
    if (calibration === null) warnings.push("0m・5m・水面の校正が未完了です。");
  } else {
    if (video.effectiveFps === null || video.effectiveFps + 0.05 < 30) warnings.push("簡易タイムモードは最低30fpsが必要です。");
    else if (video.effectiveFps < 60) warnings.push("30fpsでは1フレーム約33msです。時間は粗い参考値として扱ってください。");
    if (!video.fixedCamera) warnings.push("カメラが動く映像では自動判定を行わないため、各イベントを手動で確認してください。");
    if (!video.sideOn) warnings.push("斜め撮影では距離・速度・角度を測定せず、時間指標だけを表示します。");
  }
  if (!video.singleSwimmer) warnings.push("1レーン・1選手の映像が必要です。");
  if (events.some((event) => event.status === "candidate" || event.status === "needs-review")) warnings.push("一部イベントはコーチ確認が必要です。確認されるまで依存する数値へ使用しません。");
  if (events.some((event) => event.status === "confirmed")) warnings.push("未検証ベータの自動判定を含みます。重要な判断では映像を確認してください。");
  if (events.some((event) => event.status === "unavailable")) warnings.push("一部イベントは画面外または判定スコア不足です。");
  const sequenceErrors = validateStartEventSequence(events, athlete.startStyle);
  warnings.push(...sequenceErrors);
  const baseUnavailable =
    !Number.isInteger(athlete.age) ||
    athlete.age < 13 ||
    video.effectiveFps === null ||
    !video.singleSwimmer ||
    sequenceErrors.length > 0;
  const unavailable = baseUnavailable || (analysisMode === "precision"
    ? video.effectiveFps! + 0.05 < 60 || !video.fixedCamera || !video.sideOn
    : video.effectiveFps! + 0.05 < 30);
  return {
    status: unavailable
      ? "unavailable"
      : warnings.length > 0
        ? "needs-review"
        : "ready",
    warnings,
  };
}

export interface BuildStartAnalysisOptions {
  /** 省略時は従来どおり精密モードとして扱う。 */
  readonly analysisMode?: StartAnalysisMode;
  readonly travelDirection?: StartCalibrationV1["travelDirection"];
  readonly athlete: Omit<StartAthleteProfile, "startStyle"> & { readonly startStyle?: StartAthleteProfile["startStyle"] };
  readonly video: StartVideoInfo;
  readonly calibration: StartCalibrationV1 | null;
  readonly events?: readonly StartEvent[];
  readonly poseFrames?: readonly PoseFrame[];
  /** 記録専用。5m指標や研究参考帯には絶対に使用しない。 */
  readonly externalFiveMeterTimeMs?: number | null;
}

export function buildStartAnalysisResult(options: BuildStartAnalysisOptions): StartAnalysisResultV1 {
  const analysisMode = options.analysisMode ?? "precision";
  const travelDirection = options.travelDirection ?? options.calibration?.travelDirection ?? "left-to-right";
  const athlete: StartAthleteProfile = { ...options.athlete, startStyle: startStyleForStroke(options.athlete.strokeStyle) };
  const suppliedEvents = [...(options.events ?? [])];
  suppliedEvents.forEach(validateVerifiedStartEvent);
  // 保存済みの自動判定証跡だけを信用せず、現在の撮影条件・校正・先行イベントで再評価する。
  const events = [...autoConfirmStartEvents(suppliedEvents, {
    analysisMode,
    effectiveFps: options.video.effectiveFps,
    fixedCamera: options.video.fixedCamera,
    sideOn: options.video.sideOn,
    singleSwimmer: options.video.singleSwimmer,
    calibration: options.calibration,
    startStyle: athlete.startStyle,
  })].sort((first, second) => (first.timestampMs ?? Number.POSITIVE_INFINITY) - (second.timestampMs ?? Number.POSITIVE_INFINITY) || first.id.localeCompare(second.id));
  events.forEach(validateVerifiedStartEvent);
  const poseFrames = options.poseFrames ?? [];
  const externalFiveMeterTimeMs = options.externalFiveMeterTimeMs ?? null;
  if (
    externalFiveMeterTimeMs !== null &&
    (!Number.isFinite(externalFiveMeterTimeMs) || externalFiveMeterTimeMs <= 0)
  ) {
    throw new RangeError("External 5m stopwatch time must be a positive finite value or null.");
  }
  const posePoints = deriveStartPosePoints(poseFrames);
  const quality = assessStartAnalysisQuality(
    athlete,
    options.video,
    options.calibration,
    events,
    analysisMode,
  );
  const calculatedMetrics = calculateMetrics(
    events,
    options.calibration,
    posePoints,
    poseFrames,
    options.video.effectiveFps,
  );
  const metrics = quality.status === "unavailable"
    ? calculatedMetrics.map((item): StartMetric => ({
        ...item,
        value: null,
        status: "unavailable",
        note: "対象年齢または撮影品質の必須条件を満たしていません。",
      }))
    : analysisMode === "timing-only"
      ? calculatedMetrics.map((item): StartMetric => TIMING_ONLY_METRICS.has(item.id)
        ? item
        : {
            ...item,
            value: null,
            status: "unavailable",
            note: "簡易タイムモードでは測定しません。",
          })
      : calculatedMetrics;
  return {
    schemaVersion: "1.0",
    analysisMode,
    travelDirection,
    athlete,
    video: options.video,
    calibration: options.calibration,
    events,
    metrics,
    percentiles: analysisMode === "timing-only"
      ? []
      : metrics
        .filter((item) => item.status === "verified" && isReferenceMetric(item.id))
        .map((item) => percentileForStartMetric(item.id as "block-contact-time" | "entry-time" | "entry-distance" | "five-meter-time", item.unit === "ms" && item.value !== null ? item.value / 1000 : item.value, athlete, BORN_2026_REFERENCE_DATASET)),
    quality,
    posePoints,
    poseFrames,
    externalTiming: {
      fiveMeterTimeMs: externalFiveMeterTimeMs,
      source: "external-stopwatch",
      usedForPercentile: false,
      note: "記録専用です。5m指標・研究参考帯には使用しません。",
    },
    revisionHistory: [],
  };
}

/** 変更履歴を保ち、依存指標と百分位を決定論的に再計算する。 */
export function replaceStartEvent(
  result: StartAnalysisResultV1,
  nextEvent: StartEvent,
): StartAnalysisResultV1 {
  const previous = result.events.find((event) => event.id === nextEvent.id) ?? null;
  const events = previous
    ? result.events.map((event) => event.id === nextEvent.id ? nextEvent : event)
    : [...result.events, nextEvent];
  const rebuilt = buildStartAnalysisResult({
    analysisMode: result.analysisMode,
    travelDirection: result.travelDirection,
    athlete: result.athlete,
    video: result.video,
    calibration: result.calibration,
    events,
    poseFrames: result.poseFrames,
    externalFiveMeterTimeMs: result.externalTiming.fiveMeterTimeMs,
  });
  const revision: StartEventRevision = { revision: (result.revisionHistory.at(-1)?.revision ?? 0) + 1, eventId: nextEvent.id, previous, next: nextEvent };
  return { ...rebuilt, revisionHistory: [...result.revisionHistory, revision] };
}

export function startEventStatusAllowsMetric(status: StartEventStatus): boolean {
  return status === "confirmed" || status === "verified";
}
