import type { PoseFrame } from "../../types/analysis";
import type {
  DetectedEvent,
  ManualEventOverride,
} from "../../types/competition";

function assertTimestamp(timestampMs: number): void {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new RangeError(
      "manual event timestampMs must be a finite non-negative number.",
    );
  }
}

function nearestFrameIndex(
  frames: readonly PoseFrame[],
  sourceFrameTimestampsMs: readonly number[],
  timestampMs: number,
  fallback: number,
): number {
  if (sourceFrameTimestampsMs.length > 0) {
    let low = 0;
    let high = sourceFrameTimestampsMs.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sourceFrameTimestampsMs[middle] < timestampMs) low = middle + 1;
      else high = middle;
    }
    if (low === 0) return 0;
    if (low === sourceFrameTimestampsMs.length) {
      return sourceFrameTimestampsMs.length - 1;
    }
    return timestampMs - sourceFrameTimestampsMs[low - 1] <=
      sourceFrameTimestampsMs[low] - timestampMs
      ? low - 1
      : low;
  }
  if (frames.length === 0) {
    return fallback;
  }
  let nearestIndex = 0;
  let nearestDistance = Math.abs(frames[0].timestampMs - timestampMs);
  for (let index = 1; index < frames.length; index += 1) {
    const distance = Math.abs(frames[index].timestampMs - timestampMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return frames[nearestIndex].sourceFrameIndex ?? nearestIndex;
}

function verifiedEvent(
  event: DetectedEvent,
  frames: readonly PoseFrame[],
  sourceFrameTimestampsMs: readonly number[],
): DetectedEvent {
  assertTimestamp(event.timestampMs);
  return {
    ...event,
    frameIndex: nearestFrameIndex(
      frames,
      sourceFrameTimestampsMs,
      event.timestampMs,
      event.frameIndex,
    ),
    confidence: 1,
    status: "verified",
    source: "manual",
  };
}

/**
 * 自動検出結果へ、追加・移動/変更・削除を順番に適用する。
 * 入力配列は変更せず、手動で触れたイベントは必ずverifiedにする。
 */
export function applyManualEventOverrides(
  automaticEvents: readonly DetectedEvent[],
  overrides: readonly ManualEventOverride[],
  rawPoseFrames: readonly PoseFrame[] = [],
  sourceFrameTimestampsMs: readonly number[] = [],
): readonly DetectedEvent[] {
  const events = new Map(
    automaticEvents.map((event) => [event.id, { ...event }] as const),
  );

  for (const override of overrides) {
    if (override.action === "add") {
      if (events.has(override.event.id)) {
        throw new TypeError(
          `cannot add duplicate event id: ${override.event.id}`,
        );
      }
      events.set(
        override.event.id,
        verifiedEvent(
          override.event,
          rawPoseFrames,
          sourceFrameTimestampsMs,
        ),
      );
      continue;
    }

    const current = events.get(override.eventId);
    if (!current) {
      throw new TypeError(
        `manual override references unknown event: ${override.eventId}`,
      );
    }

    if (override.action === "remove") {
      events.delete(override.eventId);
      continue;
    }

    const timestampMs = override.timestampMs ?? current.timestampMs;
    assertTimestamp(timestampMs);
    events.set(
      override.eventId,
      verifiedEvent(
        {
          ...current,
          timestampMs,
          type: override.type ?? current.type,
          strokeStyle:
            override.strokeStyle === undefined
              ? current.strokeStyle
              : override.strokeStyle,
          side:
            override.side === undefined
              ? current.side
              : override.side,
          gateId:
            override.gateId === undefined
              ? current.gateId
              : override.gateId,
        },
        rawPoseFrames,
        sourceFrameTimestampsMs,
      ),
    );
  }

  return [...events.values()].sort(
    (first, second) =>
      first.timestampMs - second.timestampMs ||
      first.id.localeCompare(second.id),
  );
}
