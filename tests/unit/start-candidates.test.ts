import { describe, expect, it } from "vitest";

import { deriveStartEventCandidates } from "../../lib/start/candidates";
import { autoConfirmStartEvents } from "../../lib/start/auto-confirmation";
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
  mutable[POSE_LANDMARK_INDEX.left_eye_outer] = landmark(values.headX - 0.003, values.headY - 0.004);
  mutable[POSE_LANDMARK_INDEX.right_eye_outer] = landmark(values.headX + 0.003, values.headY - 0.004);
  mutable[POSE_LANDMARK_INDEX.left_ear] = landmark(values.headX - 0.006, values.headY - 0.008);
  mutable[POSE_LANDMARK_INDEX.right_ear] = landmark(values.headX + 0.006, values.headY - 0.008);
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
      poseFrame(500, { trunkX: 0.5, wristX: 0.46, leftFootX: 0.32, rightFootX: 0.37, headX: 0.56, headY: 0.57 }),
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
    expect(eventAt(events, "head-entry")).toMatchObject({ timestampMs: 400 });
    expect(eventAt(events, "head-entry").point).not.toBeNull();
    expect(eventAt(events, "five-meter-head-crossing").timestampMs).toBe(600);
    expect(events.every((event) => event.status !== "verified")).toBe(true);
    expect(validateStartEventSequence(events, "dive")).toEqual([]);
  });

  it("uses a multi-landmark head-axis proxy instead of the nose coordinate", () => {
    const frames = [
      poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 }),
      poseFrame(100, { trunkX: 0.23, wristX: 0.22, leftFootX: 0.14, rightFootX: 0.19, headX: 0.3, headY: 0.46 }),
      poseFrame(200, { trunkX: 0.32, wristX: 0.3, leftFootX: 0.2, rightFootX: 0.25, headX: 0.42, headY: 0.49 }),
      poseFrame(300, { trunkX: 0.4, wristX: 0.38, leftFootX: 0.28, rightFootX: 0.33, headX: 0.52, headY: 0.54 }),
      poseFrame(400, { trunkX: 0.5, wristX: 0.48, leftFootX: 0.38, rightFootX: 0.43, headX: 0.62, headY: 0.58 }),
    ];
    const events = deriveStartEventCandidates({ frames, calibration, startStyle: "dive", signalTimestampMs: 0 });
    const entry = eventAt(events, "head-entry");

    expect(entry.timestampMs).toBe(300);
    expect(entry.point).not.toEqual({ x: 0.52, y: 0.54 });
    expect(entry.point?.x).toBeGreaterThan(0.52);
  });

  it("does not treat one terminal foot jump as sustained takeoff evidence", () => {
    const frames = [
      poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 }),
      poseFrame(100, { trunkX: 0.225, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.25, headY: 0.43 }),
      poseFrame(200, { trunkX: 0.225, wristX: 0.2, leftFootX: 0.2, rightFootX: 0.25, headX: 0.27, headY: 0.44 }),
    ];
    const candidates = deriveStartEventCandidates({
      frames,
      calibration,
      startStyle: "dive",
      signalTimestampMs: 0,
      signalFrameIndex: 0,
      signalConfidence: 0.98,
    });
    const events = autoConfirmStartEvents(candidates, {
      analysisMode: "precision",
      effectiveFps: 100,
      fixedCamera: true,
      sideOn: true,
      singleSwimmer: true,
      calibration,
      startStyle: "dive",
    });

    expect(eventAt(candidates, "takeoff").confidence).toBeLessThan(0.86);
    expect(eventAt(events, "takeoff").status).toBe("needs-review");
  });

  it("does not bridge a head crossing across an occlusion gap", () => {
    const visible = [
      poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 }),
      poseFrame(100, { trunkX: 0.23, wristX: 0.22, leftFootX: 0.14, rightFootX: 0.19, headX: 0.3, headY: 0.44 }),
      poseFrame(200, { trunkX: 0.32, wristX: 0.3, leftFootX: 0.2, rightFootX: 0.25, headX: 0.4, headY: 0.47 }),
      poseFrame(300, { trunkX: 0.4, wristX: 0.38, leftFootX: 0.28, rightFootX: 0.33, headX: 0.48, headY: 0.48 }),
    ];
    const hidden = poseFrame(400, { trunkX: 0.46, wristX: 0.44, leftFootX: 0.34, rightFootX: 0.39, headX: 0.52, headY: 0.52 });
    const hiddenLandmarks = hidden.landmarks as unknown as PoseLandmark[];
    [
      POSE_LANDMARK_INDEX.nose,
      POSE_LANDMARK_INDEX.left_eye_outer,
      POSE_LANDMARK_INDEX.right_eye_outer,
      POSE_LANDMARK_INDEX.left_ear,
      POSE_LANDMARK_INDEX.right_ear,
    ].forEach((index) => { hiddenLandmarks[index] = { ...hiddenLandmarks[index], visibility: 0 }; });
    const frames = [
      ...visible,
      hidden,
      poseFrame(900, { trunkX: 0.7, wristX: 0.68, leftFootX: 0.58, rightFootX: 0.63, headX: 0.7, headY: 0.58 }),
      poseFrame(910, { trunkX: 0.71, wristX: 0.69, leftFootX: 0.59, rightFootX: 0.64, headX: 0.71, headY: 0.59 }),
    ];
    const events = deriveStartEventCandidates({ frames, calibration, startStyle: "dive", signalTimestampMs: 0 });

    expect(eventAt(events, "head-entry")).toMatchObject({ timestampMs: null, status: "unavailable" });
  });

  it("does not treat feet reappearing after occlusion as the takeoff transition", () => {
    const frames = [
      poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 }),
      poseFrame(100, { trunkX: 0.23, wristX: 0.22, leftFootX: 0.1, rightFootX: 0.15, headX: 0.24, headY: 0.43 }),
      poseFrame(200, { trunkX: 0.25, wristX: 0.24, leftFootX: 0.1, rightFootX: 0.15, headX: 0.26, headY: 0.44 }),
      poseFrame(300, { trunkX: 0.27, wristX: 0.26, leftFootX: 0.1, rightFootX: 0.15, headX: 0.28, headY: 0.45 }),
      poseFrame(900, { trunkX: 0.5, wristX: 0.48, leftFootX: 0.25, rightFootX: 0.3, headX: 0.52, headY: 0.56 }),
      poseFrame(910, { trunkX: 0.51, wristX: 0.49, leftFootX: 0.26, rightFootX: 0.31, headX: 0.53, headY: 0.57 }),
      poseFrame(920, { trunkX: 0.52, wristX: 0.5, leftFootX: 0.27, rightFootX: 0.32, headX: 0.54, headY: 0.58 }),
    ];
    const hiddenFeet = frames[3].landmarks as unknown as PoseLandmark[];
    [
      POSE_LANDMARK_INDEX.left_ankle,
      POSE_LANDMARK_INDEX.right_ankle,
      POSE_LANDMARK_INDEX.left_heel,
      POSE_LANDMARK_INDEX.right_heel,
      POSE_LANDMARK_INDEX.left_foot_index,
      POSE_LANDMARK_INDEX.right_foot_index,
    ].forEach((index) => { hiddenFeet[index] = { ...hiddenFeet[index], visibility: 0 }; });

    const events = deriveStartEventCandidates({ frames, calibration, startStyle: "dive", signalTimestampMs: 0 });
    expect(eventAt(events, "takeoff")).toMatchObject({ timestampMs: null, status: "unavailable" });
  });

  it("does not create head entry when the proxy changes only because a face point reappears", () => {
    const frames = [0, 100, 200, 300, 400, 500, 510, 520].map((timestampMs) =>
      poseFrame(timestampMs, {
        trunkX: timestampMs < 100 ? 0.2 : 0.3 + timestampMs / 10_000,
        wristX: timestampMs < 100 ? 0.2 : 0.3 + timestampMs / 10_000,
        leftFootX: timestampMs < 200 ? 0.1 : 0.22 + timestampMs / 10_000,
        rightFootX: timestampMs < 200 ? 0.15 : 0.27 + timestampMs / 10_000,
        headX: 0.4,
        headY: 0.46,
      }),
    );
    for (const frame of frames) {
      const landmarks = frame.landmarks as unknown as PoseLandmark[];
      landmarks[POSE_LANDMARK_INDEX.left_shoulder] = { x: 0.29, y: 0.3, z: 0, visibility: 0.95 };
      landmarks[POSE_LANDMARK_INDEX.right_shoulder] = { x: 0.31, y: 0.3, z: 0, visibility: 0.95 };
      landmarks[POSE_LANDMARK_INDEX.nose] = { x: 0.4, y: 0.46, z: 0, visibility: 0.95 };
      landmarks[POSE_LANDMARK_INDEX.left_eye_outer] = { x: 0.39, y: 0.47, z: 0, visibility: 0.95 };
      landmarks[POSE_LANDMARK_INDEX.right_eye_outer] = { x: 0.41, y: 0.47, z: 0, visibility: 0.95 };
      landmarks[POSE_LANDMARK_INDEX.left_ear] = { x: 0.38, y: 0.52, z: 0, visibility: frame.timestampMs < 500 ? 0 : 0.95 };
      landmarks[POSE_LANDMARK_INDEX.right_ear] = { x: 0.42, y: 0.46, z: 0, visibility: 0.95 };
    }

    const events = deriveStartEventCandidates({ frames, calibration, startStyle: "dive", signalTimestampMs: 0 });
    expect(eventAt(events, "head-entry")).toMatchObject({ timestampMs: null, status: "unavailable" });
  });

  it("automatically confirms only sustained high-score detections that satisfy capture policy", () => {
    const frames = [
      poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 }),
      poseFrame(100, { trunkX: 0.225, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.25, headY: 0.42 }),
      poseFrame(200, { trunkX: 0.27, wristX: 0.24, leftFootX: 0.14, rightFootX: 0.19, headX: 0.33, headY: 0.44 }),
      poseFrame(300, { trunkX: 0.34, wristX: 0.3, leftFootX: 0.18, rightFootX: 0.23, headX: 0.42, headY: 0.47 }),
      poseFrame(400, { trunkX: 0.42, wristX: 0.38, leftFootX: 0.25, rightFootX: 0.3, headX: 0.5, headY: 0.54 }),
      poseFrame(500, { trunkX: 0.5, wristX: 0.46, leftFootX: 0.32, rightFootX: 0.37, headX: 0.56, headY: 0.57 }),
      poseFrame(600, { trunkX: 0.6, wristX: 0.55, leftFootX: 0.4, rightFootX: 0.45, headX: 0.62, headY: 0.58 }),
      poseFrame(700, { trunkX: 0.7, wristX: 0.65, leftFootX: 0.5, rightFootX: 0.55, headX: 0.7, headY: 0.6 }),
    ];
    const candidates = deriveStartEventCandidates({
      frames,
      calibration,
      startStyle: "dive",
      signalTimestampMs: 0,
      signalFrameIndex: 0,
      signalConfidence: 0.98,
    });
    const events = autoConfirmStartEvents(candidates, {
      analysisMode: "precision",
      effectiveFps: 120,
      fixedCamera: true,
      sideOn: true,
      singleSwimmer: true,
      calibration,
      startStyle: "dive",
    });

    expect(eventAt(events, "signal").status).toBe("confirmed");
    expect(eventAt(events, "movement-onset").status).toBe("confirmed");
    expect(eventAt(events, "takeoff").status).toBe("confirmed");
    expect(eventAt(events, "head-entry").status).toBe("confirmed");
    expect(eventAt(events, "five-meter-head-crossing").status).toBe("confirmed");
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

  it("keeps early timing candidates but withholds entry and 5m without calibration", () => {
    const frames = [
      poseFrame(0, { trunkX: 0.2, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.22, headY: 0.42 }),
      poseFrame(100, { trunkX: 0.225, wristX: 0.2, leftFootX: 0.1, rightFootX: 0.15, headX: 0.25, headY: 0.42 }),
      poseFrame(200, { trunkX: 0.27, wristX: 0.24, leftFootX: 0.14, rightFootX: 0.19, headX: 0.33, headY: 0.44 }),
      poseFrame(400, { trunkX: 0.42, wristX: 0.38, leftFootX: 0.25, rightFootX: 0.3, headX: 0.5, headY: 0.54 }),
    ];
    const events = deriveStartEventCandidates({
      frames,
      calibration: null,
      travelDirection: "left-to-right",
      startStyle: "dive",
      signalTimestampMs: 0,
    });

    expect(eventAt(events, "movement-onset").timestampMs).not.toBeNull();
    expect(eventAt(events, "takeoff").timestampMs).not.toBeNull();
    expect(eventAt(events, "head-entry")).toMatchObject({ timestampMs: null, status: "unavailable" });
    expect(eventAt(events, "five-meter-head-crossing")).toMatchObject({ timestampMs: null, status: "unavailable" });
    expect(events.every((event) => event.status !== "verified")).toBe(true);
  });
});
