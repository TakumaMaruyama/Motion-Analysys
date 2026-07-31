import type { EventStatus } from "../../types/competition";

export const CONFIRMED_CONFIDENCE_THRESHOLD = 0.8;
export const MEASURABLE_CONFIDENCE_THRESHOLD = 0.5;

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** 競泳UIで共通利用する固定の信頼区分。 */
export function confidenceStatus(
  confidence: number,
  manual = false,
): EventStatus {
  if (
    !Number.isFinite(confidence) ||
    confidence < MEASURABLE_CONFIDENCE_THRESHOLD
  ) {
    return "unavailable";
  }
  if (manual) {
    return "verified";
  }
  return confidence < CONFIRMED_CONFIDENCE_THRESHOLD
    ? "needs-review"
    : "confirmed";
}
