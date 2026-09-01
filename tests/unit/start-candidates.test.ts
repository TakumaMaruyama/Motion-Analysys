import { describe, expect, it } from "vitest";

import { deriveStartEventCandidates } from "../../lib/start/candidates";
import { validateStartEventSequence } from "../../lib/start/analysis";
import { POSE_LANDMARK_INDEX, type PoseFrame, type PoseLandmark, type PoseLandmarks } from "../../types/analysis";
import type { StartCalibrationV1 } from "../../types/start";

const calibration: StartCalibrationV1 = {
  schemaVersion: "1.0",
  imageWidth: 1280,
  imageHeight: 720,
  zeroMeter: { x: 0.1, y: 0.5 },
  fiveMeter: { x: 0.6, y: 0.5 },
  waterSurface: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
  travelDirection: "left-to-right",
};

function poseFrame(
  timestampMs: number,
  values: {
    readonly trunkX: number;
    readonly wristX: number;
    readonly leftFootX: number;
    readonly rightFootX: number;
    readonly headX: number;
    readonly headY: number;
  },
): PoseFrame {
  const landmark = (x = 0.2, y = 0.4): PoseLandmark => ({ x, y, z: 0, visibility: 0.95 });
  const landmarks = Array.from({ length: 33 }, () => landmark()) as unknown as PoseLandmarks;
  const mutable = landmarks as unknown as PoseLandmark[];
  mutable[POSE_LANDMARK_INDEX.left_hip] = landmark(values.trunkX - 0.01, 0.42);
  mutable[POSE_LANDMARK_INDEX.right_hip] = landmark(values.trunkX + 0.01, 0.42);
  mutable[POSE_LANDMARK_INDEX.left_shoulder] = landmark(values.trunkX - 0.01, 0.32);
  mutable[POSE_LANDMARK_INDEX.right_shoulder] = landmark(values.trunkX + 0.01, 0.32);
  mutable[POSE_LANDMARK_INDEX.left_wrist] = landmark(values.wristX - 0.01, 0.35);
  mutable[POSE_LANDMARK_INDEX.right_wrist] = landmark(values.wristX + 0.01, 0.35);
  mutable[POSE_LANDMARK_INDEX.left_heel] = landmark(values.leftFootX, 0.46);
  mutable[POSE_LANDMARK_INDEX.left_foot_index] = landmark(values.leftFootX, 0.47);
  mutable[POSE_LANDMARK_INDEX.right_heel] = landmark(values.rightFootX, 0.46);
  mutable[POSE_LANDMARK_INDEX.right_foot_index] = landmark(values.rightFootX, 0.47);
  mutable[POSE_LANDMARK_INDEX.nose] = landmark(values.headX, values.headY);
  return {
    timestampMs,
    sourceFrameIndex: timestampMs / 10,
    imageSize: { width: 1280, height: 720 },
    landmarks,
    worldLandmarks: null,
  };
}

function eventAt(
  events: ReturnType<typeof deriveStartEventCandidates>,
  type: (typeof events)[number]["type"],
) {
  return events.find((event) => event.type === type)!;
}

describe("start automatic candidates", () => {
  it("never promotes missing Pose data or an audio candidate to a verified event", () => {
    const events = deriveStartEventCandidates({
      frames: [],
      calibration,
      startStyle: "dive",
      signalTimestampMs: null,
    });

    expect(events).toHaveLength(7);
    expect(events.every((event) => event.status === "unavailable")).toBe(true);
    expect(events.every((event) => event.status !== "verified")).toBe(true);
    expect(eventAt(events, "signal").timestampMs).toBeNull();
  });

  it("creates ordered, coach-reviewable candidates from conservative Pose transitions", () => {
    const frames = [
      poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 }),
      poseFrame(100, { trunkX: 0.225, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.25, headY: 0.42 }),
      poseFrame(200, { trunkX: 0.27, wristX: 0.24, leftFootX: 0.14, rightFootX: 0.19, headX: 0.33, headY: 0.44 }),
      poseFrame(300, { trunkX: 0.34, wristX: 0.3, leftFootX: 0.18, rightFootX: 0.23, headX: 0.42, headY: 0.47 }),
      poseFrame(400, { trunkX: 0.42, wristX: 0.38, leftFootX: 0.25, rightFootX: 0.3, headX: 0.5, headY: 0.54 }),
      poseFrame(600, { trunkX: 0.6, wristX: 0.55, leftFootX: 0.4, rightFootX: 0.45, headX: 0.62, headY: 0.58 }),
    ];
    const events = deriveStartEventCandidates({
      frames,
      calibration,
      startStyle: "dive",
      signalTimestampMs: 0,
    });

    expect(eventAt(events, "signal")).toMatchObject({ timestampMs: 0, status: "needs-review", source: "automatic" });
    expect(eventAt(events, "movement-onset").timestampMs).toBe(100);
    expect(eventAt(events, "hands-off").timestampMs).toBe(200);
    expect(eventAt(events, "rear-foot-off").timestampMs).toBe(200);
    expect(eventAt(events, "takeoff").timestampMs).toBe(200);
    expect(eventAt(events, "head-entry")).toMatchObject({ timestampMs: 400, point: { x: 0.5, y: 0.54 } });
    expect(eventAt(events, "five-meter-head-crossing").timestampMs).toBe(600);
    expect(events.every((event) => event.status !== "verified")).toBe(true);
    expect(validateStartEventSequence(events, "dive")).toEqual([]);
  });

  it("removes dive-only rear-foot candidates for backstroke and keeps data shortages null", () => {
    const events = deriveStartEventCandidates({
      frames: [poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 })],
      calibration,
      startStyle: "backstroke",
    });

    expect(eventAt(events, "rear-foot-off")).toMatchObject({ timestampMs: null, frameIndex: null, status: "unavailable" });
    expect(eventAt(events, "signal").status).toBe("unavailable");
    expect(events.every((event) => event.status !== "verified")).toBe(true);
  });
});
