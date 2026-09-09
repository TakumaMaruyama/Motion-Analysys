import type {
  StartAnalysisMode,
  StartAutomaticDecision,
  StartCalibrationV1,
  StartEvent,
  StartEventType,
  StartStyle,
} from "../../types/start";
import { validateStartCalibration } from "./calibration";

export const START_AUTO_CONFIRMATION_POLICY_VERSION = "start-heuristic-auto-v1" as const;

export const START_AUTO_CONFIRMATION_MIN_SCORE: Readonly<Record<StartEventType, number>> = {
  signal: 0.9,
  "movement-onset": 0.86,
  "hands-off": 0.84,
  "rear-foot-off": 0.84,
  takeoff: 0.86,
  "head-entry": 0.9,
  "five-meter-head-crossing": 0.9,
};

export interface StartAutoConfirmationContext {
  readonly analysisMode: StartAnalysisMode;
  readonly effectiveFps: number | null;
  readonly fixedCamera: boolean;
  readonly sideOn: boolean;
  readonly singleSwimmer: boolean;
  readonly calibration: StartCalibrationV1 | null;
  readonly startStyle: StartStyle;
}

function finiteEvent(event: StartEvent | undefined): event is StartEvent & {
  readonly timestampMs: number;
  readonly frameIndex: number;
} {
  return Boolean(
    event &&
    event.timestampMs !== null &&
    Number.isFinite(event.timestampMs) &&
    event.timestampMs >= 0 &&
    event.frameIndex !== null &&
    Number.isInteger(event.frameIndex) &&
    event.frameIndex >= 0,
  );
}

function validCalibration(calibration: StartCalibrationV1 | null): boolean {
  if (calibration === null) return false;
  try {
    validateStartCalibration(calibration);
    return true;
  } catch {
    return false;
  }
}

function within(
  earlier: StartEvent | undefined,
  later: StartEvent | undefined,
  minimumMs: number,
  maximumMs: number,
): boolean {
  if (!finiteEvent(earlier) || !finiteEvent(later)) return false;
  const duration = later.timestampMs - earlier.timestampMs;
  return duration >= minimumMs && duration <= maximumMs;
}

function isConfirmed(event: StartEvent | undefined): boolean {
  return Boolean(event && (event.status === "confirmed" || event.status === "verified"));
}

const METHOD_BY_EVENT: Readonly<Record<StartEventType, StartAutomaticDecision["method"]>> = {
  signal: "audio-rms-peak-v1",
  "movement-onset": "pose-trunk-displacement-v1",
  "hands-off": "pose-hand-displacement-v1",
  "rear-foot-off": "pose-rear-foot-displacement-v1",
  takeoff: "pose-bilateral-foot-displacement-v1",
  "head-entry": "pose-head-axis-proxy-crossing-v1",
  "five-meter-head-crossing": "pose-head-axis-proxy-crossing-v1",
};

function baseReasons(
  event: StartEvent,
  context: StartAutoConfirmationContext,
): string[] {
  const reasons: string[] = [];
  const minimumFps = context.analysisMode === "precision" ? 60 : 30;
  if (!finiteEvent(event)) reasons.push("missing-frame-or-time");
  if (!Number.isFinite(event.confidence) || event.confidence < START_AUTO_CONFIRMATION_MIN_SCORE[event.type]) {
    reasons.push("score-below-policy");
  }
  if (context.effectiveFps === null || context.effectiveFps + 0.05 < minimumFps) reasons.push("fps-below-mode-minimum");
  if (!context.singleSwimmer) reasons.push("single-swimmer-not-confirmed");
  if (!context.fixedCamera) reasons.push("fixed-camera-not-confirmed");
  if (context.analysisMode === "precision" && !context.sideOn) reasons.push("side-on-not-confirmed");
  if (context.analysisMode === "precision" && !validCalibration(context.calibration)) reasons.push("calibration-invalid");
  if (context.analysisMode === "timing-only" && (event.type === "head-entry" || event.type === "five-meter-head-crossing")) {
    reasons.push("event-not-auto-confirmed-in-timing-only");
  }
  if ((event.type === "head-entry" || event.type === "five-meter-head-crossing") && !validCalibration(context.calibration)) {
    reasons.push("spatial-calibration-required");
  }
  if (event.type === "head-entry" && event.point === null) reasons.push("head-point-required");
  if (event.type === "rear-foot-off" && context.startStyle === "backstroke") reasons.push("dive-only-event");
  return reasons;
}

/**
 * イベント固有スコアに、撮影条件と時系列依存を加えて自動判定する。
 * confidenceは確率ではないため、判定ポリシー版と拒否理由を必ず保存する。
 */
export function autoConfirmStartEvents(
  events: readonly StartEvent[],
  context: StartAutoConfirmationContext,
): readonly StartEvent[] {
  const byType = new Map<StartEventType, StartEvent>();
  for (const event of events) {
    const existing = byType.get(event.type);
    if (!existing || event.status === "verified" || existing.status !== "verified") {
      byType.set(event.type, event);
    }
  }
  const resolved = new Map<StartEventType, StartEvent>();

  const decide = (type: StartEventType, dependencyReasons: readonly string[] = []): void => {
    const event = byType.get(type);
    if (!event) return;
    if (event.source === "manual" || event.status === "verified" || event.status === "unavailable") {
      resolved.set(type, event);
      return;
    }
    const reasons = [...baseReasons(event, context), ...dependencyReasons];
    const confirmed = reasons.length === 0;
    resolved.set(type, {
      ...event,
      status: confirmed ? "confirmed" : "needs-review",
      automaticDecision: {
        policyVersion: START_AUTO_CONFIRMATION_POLICY_VERSION,
        scoreKind: "heuristic",
        method: METHOD_BY_EVENT[event.type],
        decision: confirmed ? "confirmed" : "needs-review",
        reasons,
      },
    });
  };

  const signal = byType.get("signal");
  const movement = byType.get("movement-onset");
  decide("signal", within(signal, movement, 50, 1_500) ? [] : ["signal-movement-window-invalid"]);

  decide("movement-onset", [
    ...(isConfirmed(resolved.get("signal")) ? [] : ["signal-not-confirmed"]),
    ...(within(signal, movement, 50, 1_500) ? [] : ["signal-movement-window-invalid"]),
  ]);
  const takeoff = byType.get("takeoff");
  decide("takeoff", [
    ...(isConfirmed(resolved.get("movement-onset")) ? [] : ["movement-not-confirmed"]),
    ...(within(movement, takeoff, 50, 2_000) ? [] : ["movement-takeoff-window-invalid"]),
  ]);

  const contactDependencies = [
    ...(isConfirmed(resolved.get("movement-onset")) ? [] : ["movement-not-confirmed"]),
    ...(isConfirmed(resolved.get("takeoff")) ? [] : ["takeoff-not-confirmed"]),
  ];
  const hands = byType.get("hands-off");
  decide("hands-off", [
    ...contactDependencies,
    ...(finiteEvent(movement) && finiteEvent(hands) && finiteEvent(takeoff) &&
      hands.timestampMs >= movement.timestampMs && hands.timestampMs <= takeoff.timestampMs
      ? [] : ["hands-off-window-invalid"]),
  ]);
  const rear = byType.get("rear-foot-off");
  decide("rear-foot-off", context.startStyle === "backstroke" ? [] : [
    ...contactDependencies,
    ...(finiteEvent(movement) && finiteEvent(rear) && finiteEvent(takeoff) &&
      rear.timestampMs >= movement.timestampMs && rear.timestampMs <= takeoff.timestampMs
      ? [] : ["rear-foot-window-invalid"]),
  ]);

  const entry = byType.get("head-entry");
  decide("head-entry", [
    ...(isConfirmed(resolved.get("takeoff")) ? [] : ["takeoff-not-confirmed"]),
    ...(within(takeoff, entry, 50, 2_500) ? [] : ["takeoff-entry-window-invalid"]),
  ]);
  const five = byType.get("five-meter-head-crossing");
  decide("five-meter-head-crossing", [
    ...(isConfirmed(resolved.get("head-entry")) ? [] : ["head-entry-not-confirmed"]),
    ...(within(entry, five, 100, 7_000) ? [] : ["entry-five-meter-window-invalid"]),
  ]);

  // 同種候補が複数ある場合、選択した1件だけを置換し、他候補を複製しない。
  return events.map((event) => byType.get(event.type) === event ? resolved.get(event.type) ?? event : event);
}

/** build/export境界で、自動判定イベントがポリシー証跡を持つか検査する。 */
export function isValidAutoConfirmedStartEvent(event: StartEvent): boolean {
  return event.status === "confirmed" &&
    event.source === "automatic" &&
    finiteEvent(event) &&
    Number.isFinite(event.confidence) &&
    event.confidence >= START_AUTO_CONFIRMATION_MIN_SCORE[event.type] &&
    event.automaticDecision?.policyVersion === START_AUTO_CONFIRMATION_POLICY_VERSION &&
    event.automaticDecision.scoreKind === "heuristic" &&
    event.automaticDecision.method === METHOD_BY_EVENT[event.type] &&
    event.automaticDecision.decision === "confirmed" &&
    event.automaticDecision.reasons.length === 0;
}
