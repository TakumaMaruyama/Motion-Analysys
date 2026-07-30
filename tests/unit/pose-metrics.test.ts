import { describe, expect, it } from "vitest";

import {
  calculateAngle2D,
  calculateHipTilt,
  calculateShoulderTilt,
  calculateStandardPoseMetrics,
  calculateTrunkLean,
  createFixedSampleTimestamps,
  mirrorNormalizedLandmark,
  normalizedToPixel,
  summarizeRangeOfMotion,
  summarizeTrajectory,
  timestampMsForSample,
} from "../../lib/pose/metrics";
import {
  POSE_LANDMARK_INDEX,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarks,
  type TimedMetricValue,
} from "../../types/analysis";

function landmark(
  x: number,
  y: number,
  visibility = 1,
): PoseLandmark {
  return { x, y, z: 0, visibility };
}

function poseFrame(
  timestampMs: number,
  overrides: Readonly<Record<number, PoseLandmark>> = {},
): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () =>
    landmark(0.5, 0.5),
  ) as unknown as PoseLandmarks;

  for (const [index, value] of Object.entries(overrides)) {
    (landmarks as unknown as PoseLandmark[])[Number(index)] = value;
  }

  return {
    timestampMs,
    imageSize: { width: 1280, height: 720 },
    landmarks,
    worldLandmarks: null,
  };
}

function timedMetric(
  timestampMs: number,
  value: number | null,
  status: TimedMetricValue["status"] = "valid",
  confidence = status === "valid" ? 0.9 : 0.2,
): TimedMetricValue {
  return {
    timestampMs,
    value,
    unit: "deg",
    confidence,
    status,
  };
}

describe("calculateAngle2D", () => {
  it("calculates a known 90 degree joint angle", () => {
    const result = calculateAngle2D(
      landmark(0, 0),
      landmark(0, 1),
      landmark(1, 1),
    );

    expect(result.status).toBe("valid");
    expect(result.value).toBeCloseTo(90);
    expect(result.unit).toBe("deg");
  });

  it("suppresses a value when any required point is below visibility 0.5", () => {
    const result = calculateAngle2D(
      landmark(0, 0),
      landmark(0, 1, 0.49),
      landmark(1, 1),
    );

    expect(result).toEqual({
      value: null,
      unit: "deg",
      confidence: 0.49,
      status: "low-confidence",
    });
  });

  it("marks a zero-length vector as unavailable", () => {
    const result = calculateAngle2D(
      landmark(0, 0),
      landmark(0, 0),
      landmark(1, 1),
    );

    expect(result.status).toBe("unavailable");
    expect(result.value).toBeNull();
  });

  it("is invariant under a display-only horizontal mirror", () => {
    const points = [
      landmark(0.2, 0.2),
      landmark(0.4, 0.6),
      landmark(0.8, 0.4),
    ] as const;
    const original = calculateAngle2D(...points);
    const mirrored = calculateAngle2D(
      mirrorNormalizedLandmark(points[0]),
      mirrorNormalizedLandmark(points[1]),
      mirrorNormalizedLandmark(points[2]),
    );

    expect(mirrored.value).toBeCloseTo(original.value!);
  });
});

describe("posture metrics", () => {
  it("calculates signed trunk lean from hip centre to shoulder centre", () => {
    const upright = poseFrame(250, {
      [POSE_LANDMARK_INDEX.left_shoulder]: landmark(0.4, 0.2),
      [POSE_LANDMARK_INDEX.right_shoulder]: landmark(0.6, 0.2),
      [POSE_LANDMARK_INDEX.left_hip]: landmark(0.4, 0.6),
      [POSE_LANDMARK_INDEX.right_hip]: landmark(0.6, 0.6),
    });
    const leaning = poseFrame(250, {
      [POSE_LANDMARK_INDEX.left_shoulder]: landmark(0.5, 0.2),
      [POSE_LANDMARK_INDEX.right_shoulder]: landmark(0.7, 0.2),
      [POSE_LANDMARK_INDEX.left_hip]: landmark(0.4, 0.6),
      [POSE_LANDMARK_INDEX.right_hip]: landmark(0.6, 0.6),
    });

    expect(calculateTrunkLean(upright).value).toBeCloseTo(0);
    expect(calculateTrunkLean(leaning).value).toBeCloseTo(
      (Math.atan2(0.1, 0.4) * 180) / Math.PI,
    );
  });

  it("normalizes shoulder and hip line tilt to -90 through 90 degrees", () => {
    const frame = poseFrame(0, {
      [POSE_LANDMARK_INDEX.left_shoulder]: landmark(0.6, 0.2),
      [POSE_LANDMARK_INDEX.right_shoulder]: landmark(0.4, 0.3),
      [POSE_LANDMARK_INDEX.left_hip]: landmark(0.6, 0.6),
      [POSE_LANDMARK_INDEX.right_hip]: landmark(0.4, 0.5),
    });

    expect(calculateShoulderTilt(frame).value).toBeCloseTo(-26.565051);
    expect(calculateHipTilt(frame).value).toBeCloseTo(26.565051);
  });

  it("preserves timestampMs on every standard metric", () => {
    const metrics = calculateStandardPoseMetrics(poseFrame(1234.5));

    expect(Object.values(metrics)).toHaveLength(13);
    expect(
      Object.values(metrics).every(
        (metric) => metric.timestampMs === 1234.5,
      ),
    ).toBe(true);
  });
});

describe("range and trajectory summaries", () => {
  it("uses valid samples only for range-of-motion extrema", () => {
    const summary = summarizeRangeOfMotion([
      timedMetric(0, 30),
      timedMetric(100, null, "low-confidence"),
      timedMetric(200, 90),
      timedMetric(300, 45),
    ]);

    expect(summary.minimum.value).toBe(30);
    expect(summary.maximum.value).toBe(90);
    expect(summary.range.value).toBe(60);
    expect(summary.mean.value).toBe(55);
    expect(summary.minimumTimestampMs).toBe(0);
    expect(summary.maximumTimestampMs).toBe(200);
    expect(summary.sampleCount).toBe(4);
    expect(summary.validSampleCount).toBe(3);
  });

  it("does not expose a range when every sample is low confidence", () => {
    const summary = summarizeRangeOfMotion([
      timedMetric(0, null, "low-confidence", 0.2),
      timedMetric(100, null, "low-confidence", 0.4),
    ]);

    expect(summary.range.value).toBeNull();
    expect(summary.range.status).toBe("low-confidence");
    expect(summary.range.confidence).toBe(0.4);
  });

  it("does not connect trajectory segments across a low-confidence gap", () => {
    const summary = summarizeTrajectory([
      { timestampMs: 0, x: 0, y: 0, visibility: 1 },
      { timestampMs: 100, x: 3, y: 4, visibility: 1 },
      { timestampMs: 200, x: 30, y: 40, visibility: 0.1 },
      { timestampMs: 300, x: 6, y: 8, visibility: 1 },
      { timestampMs: 400, x: 9, y: 12, visibility: 1 },
    ]);

    expect(summary.pathLength.value).toBe(10);
    expect(summary.displacement.value).toBe(15);
    expect(summary.rangeX.value).toBe(9);
    expect(summary.rangeY.value).toBe(12);
    expect(summary.durationMs).toBe(400);
    expect(summary.validSampleCount).toBe(4);
    expect(summary.lowConfidenceSampleCount).toBe(1);
  });
});

describe("coordinates and fixed timestamps", () => {
  it("converts normalized coordinates with optional display mirroring", () => {
    expect(
      normalizedToPixel({ x: 0.25, y: 0.5 }, { width: 800, height: 600 }),
    ).toEqual({ x: 200, y: 300 });
    expect(
      normalizedToPixel(
        { x: 0.25, y: 0.5 },
        { width: 800, height: 600 },
        true,
      ),
    ).toEqual({ x: 600, y: 300 });
  });

  it("calculates timestamps directly instead of accumulating frame error", () => {
    expect(timestampMsForSample(3, 30)).toBe(100);
    expect(createFixedSampleTimestamps(100, 60)).toEqual([
      0,
      33.333333,
      66.666667,
    ]);
  });
});
