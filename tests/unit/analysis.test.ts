import { describe, expect, it } from "vitest";

import { buildAnalysisResult } from "../../lib/pose/analysis";
import {
  POSE_LANDMARK_INDEX,
  type AnalysisInputInfo,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarks,
} from "../../types/analysis";

const INPUT: AnalysisInputInfo = {
  kind: "video",
  name: "deterministic.mp4",
  mimeType: "video/mp4",
  width: 1280,
  height: 720,
  durationMs: 100,
  mirrored: false,
};

function point(
  x: number,
  y: number,
  visibility = 0.95,
): PoseLandmark {
  return { x, y, z: 0, visibility };
}

function createFrame(
  timestampMs: number,
  horizontalOffset = 0,
): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () =>
    point(0.5, 0.5),
  ) as unknown as PoseLandmarks;
  const mutable = landmarks as unknown as PoseLandmark[];
  const set = (
    index: number,
    x: number,
    y: number,
  ) => {
    mutable[index] = point(x + horizontalOffset, y);
  };

  set(POSE_LANDMARK_INDEX.left_shoulder, 0.4, 0.3);
  set(POSE_LANDMARK_INDEX.right_shoulder, 0.6, 0.3);
  set(POSE_LANDMARK_INDEX.left_elbow, 0.3, 0.45);
  set(POSE_LANDMARK_INDEX.right_elbow, 0.7, 0.45);
  set(POSE_LANDMARK_INDEX.left_wrist, 0.2, 0.55);
  set(POSE_LANDMARK_INDEX.right_wrist, 0.8, 0.55);
  set(POSE_LANDMARK_INDEX.left_hip, 0.43, 0.55);
  set(POSE_LANDMARK_INDEX.right_hip, 0.57, 0.55);
  set(POSE_LANDMARK_INDEX.left_knee, 0.42, 0.75);
  set(POSE_LANDMARK_INDEX.right_knee, 0.58, 0.75);
  set(POSE_LANDMARK_INDEX.left_ankle, 0.4, 0.92);
  set(POSE_LANDMARK_INDEX.right_ankle, 0.6, 0.92);
  set(POSE_LANDMARK_INDEX.left_foot_index, 0.36, 0.96);
  set(POSE_LANDMARK_INDEX.right_foot_index, 0.64, 0.96);

  return {
    timestampMs,
    imageSize: { width: 1280, height: 720 },
    landmarks,
    worldLandmarks: null,
  };
}

describe("buildAnalysisResult", () => {
  it("records the complete fixed timestamp schedule separately from detected frames", () => {
    const sourceFrames = [
      createFrame(66.666667, 0.02),
      createFrame(0),
      createFrame(33.333333, 0.01),
    ];
    const fixedTimestampsMs = [
      66.666667,
      0,
      100,
      33.333333,
    ];

    const result = buildAnalysisResult(
      sourceFrames,
      INPUT,
      30,
      fixedTimestampsMs,
    );

    expect(result.sampling).toEqual({
      targetFps: 30,
      frameCount: 4,
      detectedFrameCount: 3,
      timestampsMs: [0, 33.333333, 66.666667, 100],
      startTimestampMs: 0,
      endTimestampMs: 100,
    });
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([
      0,
      33.333333,
      66.666667,
    ]);
    expect(fixedTimestampsMs).toEqual([
      66.666667,
      0,
      100,
      33.333333,
    ]);
  });

  it("reanalysis produces the same timestamps and major joint angles", () => {
    const frames = [
      createFrame(0),
      createFrame(33.333333, 0.01),
      createFrame(66.666667, 0.02),
    ];
    const timestampsMs = [0, 33.333333, 66.666667, 100];
    const first = buildAnalysisResult(
      frames,
      INPUT,
      30,
      timestampsMs,
    );
    const second = buildAnalysisResult(
      frames,
      INPUT,
      30,
      timestampsMs,
    );

    expect(second.sampling.timestampsMs).toEqual(
      first.sampling.timestampsMs,
    );

    const majorMetricKeys = [
      "leftElbowAngle",
      "rightElbowAngle",
      "leftKneeAngle",
      "rightKneeAngle",
      "trunkLean",
    ] as const;

    for (const key of majorMetricKeys) {
      const firstValues = first.metrics[key].values;
      const secondValues = second.metrics[key].values;

      expect(secondValues.map((value) => value.timestampMs)).toEqual(
        firstValues.map((value) => value.timestampMs),
      );
      expect(firstValues).toHaveLength(frames.length);

      firstValues.forEach((value, index) => {
        const repeatedValue = secondValues[index];
        expect(value.status).toBe("valid");
        expect(repeatedValue.status).toBe("valid");
        const difference = Math.abs(
          value.value! - repeatedValue.value!,
        );
        expect(difference).toBe(0);
        expect(difference).toBeLessThanOrEqual(2);
      });
    }
  });
});
