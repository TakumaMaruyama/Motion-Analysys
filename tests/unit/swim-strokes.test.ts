import { describe, expect, it } from "vitest";

import {
  confidenceStatus,
  deriveStrokeEvents,
} from "../../lib/swim";
import {
  POSE_LANDMARK_INDEX,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarks,
} from "../../types/analysis";
import type { StrokeStyle } from "../../types/competition";

function point(
  x: number,
  y: number,
  visibility: number,
): PoseLandmark {
  return { x, y, z: 0, visibility };
}

function frame(
  timestampMs: number,
  leftExtension: number,
  rightExtension: number,
  visibility = 0.95,
  elbowVisibility = visibility,
): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () =>
    point(0.5, 0.5, visibility),
  ) as unknown as PoseLandmarks;
  const mutable = landmarks as unknown as PoseLandmark[];
  mutable[POSE_LANDMARK_INDEX.left_shoulder] = point(
    0.5,
    0.4,
    visibility,
  );
  mutable[POSE_LANDMARK_INDEX.right_shoulder] = point(
    0.5,
    0.4,
    visibility,
  );
  mutable[POSE_LANDMARK_INDEX.left_wrist] = point(
    0.5 + leftExtension,
    0.4,
    visibility,
  );
  mutable[POSE_LANDMARK_INDEX.right_wrist] = point(
    0.5 + rightExtension,
    0.4,
    visibility,
  );
  mutable[POSE_LANDMARK_INDEX.left_elbow] = point(
    0.5 + leftExtension * 0.5,
    0.4,
    elbowVisibility,
  );
  mutable[POSE_LANDMARK_INDEX.right_elbow] = point(
    0.5 + rightExtension * 0.5,
    0.4,
    elbowVisibility,
  );
  return {
    timestampMs,
    imageSize: { width: 1280, height: 720 },
    landmarks,
    worldLandmarks: null,
  };
}

const TIMES = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000];
const LEFT = [0, 0.05, 0.2, 0.05, 0, 0.05, 0.2, 0.05, 0];
const RIGHT = [0, 0.05, 0, 0.05, 0.2, 0.05, 0, 0.05, 0];
const SYNC = [0, 0.05, 0.2, 0.05, 0, 0.05, 0.2, 0.05, 0];

describe("deriveStrokeEvents", () => {
  it.each<StrokeStyle>(["freestyle", "backstroke"])(
    "derives alternating left/right events for %s",
    (strokeStyle) => {
      const frames = TIMES.map((timestampMs, index) =>
        frame(timestampMs, LEFT[index], RIGHT[index]),
      );
      const events = deriveStrokeEvents(frames, strokeStyle, {
        minimumCycleMs: 300,
        minimumProminence: 0.05,
      });

      expect(events.map((event) => [event.timestampMs, event.side])).toEqual([
        [500, "left"],
        [1000, "right"],
        [1500, "left"],
      ]);
      expect(events.every((event) => event.type === "stroke")).toBe(true);
      expect(events.every((event) => event.status === "confirmed")).toBe(
        true,
      );
      expect(events.map((event) => event.frameIndex)).toEqual([2, 4, 6]);
    },
  );

  it.each<StrokeStyle>(["breaststroke", "butterfly"])(
    "derives synchronous both-arm cycles for %s",
    (strokeStyle) => {
      const frames = TIMES.map((timestampMs, index) =>
        frame(timestampMs, SYNC[index], SYNC[index]),
      );
      const events = deriveStrokeEvents(frames, strokeStyle, {
        minimumCycleMs: 300,
        minimumProminence: 0.05,
      });

      expect(events.map((event) => [event.timestampMs, event.side])).toEqual([
        [500, "both"],
        [1500, "both"],
      ]);
    },
  );

  it("does not mutate the input order", () => {
    const frames = [
      frame(1000, 0, 0.2),
      frame(500, 0.2, 0),
      frame(0, 0, 0),
    ];
    deriveStrokeEvents(frames, "freestyle", {
      minimumCycleMs: 100,
      minimumProminence: 0.05,
    });
    expect(frames.map((value) => value.timestampMs)).toEqual([
      1000,
      500,
      0,
    ]);
  });

  it("includes elbow visibility in event confidence", () => {
    const frames = TIMES.map((timestampMs, index) =>
      frame(timestampMs, SYNC[index], SYNC[index], 0.95, 0.49),
    );
    const events = deriveStrokeEvents(frames, "butterfly", {
      minimumCycleMs: 300,
      minimumProminence: 0.05,
    });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.confidence === 0.49)).toBe(true);
    expect(events.every((event) => event.status === "unavailable")).toBe(
      true,
    );
  });

  it("downgrades adjacent same-side events that violate alternation", () => {
    const frames = TIMES.map((timestampMs, index) =>
      frame(timestampMs, LEFT[index], 0),
    );
    const events = deriveStrokeEvents(frames, "freestyle", {
      minimumCycleMs: 300,
      minimumProminence: 0.05,
    });

    expect(events.map((event) => event.side)).toEqual(["left", "left"]);
    expect(events.every((event) => event.status === "needs-review")).toBe(
      true,
    );
  });
});

describe("confidenceStatus", () => {
  it("uses the fixed confirmed/review/unavailable boundaries", () => {
    expect(confidenceStatus(0.8)).toBe("confirmed");
    expect(confidenceStatus(0.799)).toBe("needs-review");
    expect(confidenceStatus(0.5)).toBe("needs-review");
    expect(confidenceStatus(0.499)).toBe("unavailable");
    expect(confidenceStatus(0.5, true)).toBe("verified");
    expect(confidenceStatus(0.49, true)).toBe("unavailable");
  });
});
