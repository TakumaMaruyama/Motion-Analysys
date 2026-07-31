import { describe, expect, it } from "vitest";

import {
  calculateCompetitionMeasurements,
  detectGateCrossings,
} from "../../lib/swim";
import {
  POSE_LANDMARK_INDEX,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarks,
} from "../../types/analysis";
import type {
  CalibrationProfileV1,
  DetectedEvent,
  EventSide,
} from "../../types/competition";

function point(x: number, visibility: number): PoseLandmark {
  return { x, y: 0.5, z: 0, visibility };
}

function frame(
  timestampMs: number,
  torsoX: number,
  visibility = 0.95,
  sourceFrameIndex?: number,
): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () =>
    point(torsoX, visibility),
  ) as unknown as PoseLandmarks;
  const mutable = landmarks as unknown as PoseLandmark[];
  mutable[POSE_LANDMARK_INDEX.left_hip] = point(
    torsoX - 0.01,
    visibility,
  );
  mutable[POSE_LANDMARK_INDEX.right_hip] = point(
    torsoX + 0.01,
    visibility,
  );
  return {
    timestampMs,
    sourceFrameIndex,
    imageSize: { width: 1280, height: 720 },
    landmarks,
    worldLandmarks: null,
  };
}

const CALIBRATION: CalibrationProfileV1 = {
  schemaVersion: "1.0",
  id: "pool-side",
  label: "25mプール横",
  imageWidth: 1280,
  imageHeight: 720,
  poolLengthMeters: 25,
  travelDirection: "left-to-right",
  visibilityThreshold: 0.5,
  gates: [
    {
      id: "g0",
      label: "0m",
      normalizedX: 0.2,
      distanceMeters: 0,
      role: "start",
    },
    {
      id: "g10",
      label: "10m",
      normalizedX: 0.6,
      distanceMeters: 10,
      role: "split",
    },
  ],
};

function strokeEvent(
  id: string,
  timestampMs: number,
  side: EventSide,
  confidence = 0.95,
): DetectedEvent {
  return {
    id,
    type: "stroke",
    timestampMs,
    frameIndex: Math.round(timestampMs / 100),
    confidence,
    status:
      confidence >= 0.8
        ? "confirmed"
        : confidence >= 0.5
          ? "needs-review"
          : "unavailable",
    source: "automatic",
    strokeStyle: "freestyle",
    side,
    gateId: null,
  };
}

function gateFrames(visibility = 0.95): readonly PoseFrame[] {
  return [
    frame(0, 0.1, visibility, 10),
    frame(1000, 0.3, visibility, 20),
    frame(2000, 0.5, visibility, 30),
    frame(3000, 0.7, visibility, 40),
  ];
}

describe("detectGateCrossings", () => {
  it("interpolates crossing time and retains source video frame indices", () => {
    const events = detectGateCrossings(gateFrames(), CALIBRATION);

    expect(events.map((event) => event.timestampMs)).toEqual([500, 2500]);
    expect(events.map((event) => event.frameIndex)).toEqual([10, 30]);
    expect(events.map((event) => event.gateId)).toEqual(["g0", "g10"]);
    expect(events.every((event) => event.status === "confirmed")).toBe(true);
  });

  it("classifies review and unavailable crossings at fixed thresholds", () => {
    const review = detectGateCrossings(gateFrames(0.7), CALIBRATION);
    const unavailable = detectGateCrossings(
      gateFrames(0.49),
      CALIBRATION,
    );

    expect(review.every((event) => event.status === "needs-review")).toBe(
      true,
    );
    expect(
      unavailable.every((event) => event.status === "unavailable"),
    ).toBe(true);
  });
});

describe("calculateCompetitionMeasurements", () => {
  it("calculates six interval metrics and bases cycle metrics on complete cycles", () => {
    const gateEvents = detectGateCrossings(gateFrames(), CALIBRATION);
    const events = [
      ...gateEvents,
      strokeEvent("s1", 600, "left"),
      strokeEvent("s2", 900, "right"),
      strokeEvent("s3", 1600, "left"),
      strokeEvent("s4", 2300, "right"),
    ];
    const byType = Object.fromEntries(
      calculateCompetitionMeasurements(events, CALIBRATION).map(
        (measurement) => [measurement.type, measurement],
      ),
    );

    expect(Object.keys(byType).sort()).toEqual([
      "average-speed",
      "cycle-count",
      "cycle-rate",
      "distance-per-cycle",
      "interval-time",
      "stroke-count",
    ]);
    expect(byType["interval-time"].value).toBe(2);
    expect(byType["average-speed"].value).toBe(5);
    expect(byType["stroke-count"].value).toBe(4);
    expect(byType["cycle-count"].value).toBe(2);
    // left周期1000ms、right周期1400msの平均1200ms。
    expect(byType["cycle-rate"].value).toBe(50);
    expect(byType["distance-per-cycle"].value).toBe(6);
  });

  it("does not turn an unknown zero-stroke interval into a valid zero", () => {
    const measurements = calculateCompetitionMeasurements(
      detectGateCrossings(gateFrames(), CALIBRATION),
      CALIBRATION,
    );
    const byType = Object.fromEntries(
      measurements.map((measurement) => [measurement.type, measurement]),
    );

    expect(byType["interval-time"].value).toBe(2);
    expect(byType["average-speed"].value).toBe(5);
    for (const type of [
      "stroke-count",
      "cycle-count",
      "cycle-rate",
      "distance-per-cycle",
    ]) {
      expect(byType[type].value).toBeNull();
      expect(byType[type].status).toBe("unavailable");
    }
  });

  it("requires a complete cycle interval for rate and distance per cycle", () => {
    const gateEvents = detectGateCrossings(gateFrames(), CALIBRATION);
    const measurements = calculateCompetitionMeasurements(
      [
        ...gateEvents,
        strokeEvent("s1", 800, "left"),
        strokeEvent("s2", 1200, "right"),
      ],
      CALIBRATION,
    );
    const rate = measurements.find(
      (measurement) => measurement.type === "cycle-rate",
    )!;
    const distance = measurements.find(
      (measurement) => measurement.type === "distance-per-cycle",
    )!;

    expect(rate.value).toBeNull();
    expect(rate.status).toBe("unavailable");
    expect(distance.value).toBeNull();
    expect(distance.status).toBe("unavailable");
  });

  it("keeps review values but suppresses measurements below 0.5", () => {
    const reviewMeasurements = calculateCompetitionMeasurements(
      [
        ...detectGateCrossings(gateFrames(0.7), CALIBRATION),
        strokeEvent("s1", 600, "left", 0.7),
        strokeEvent("s2", 900, "right", 0.7),
        strokeEvent("s3", 1600, "left", 0.7),
      ],
      CALIBRATION,
    );
    const unavailableMeasurements = calculateCompetitionMeasurements(
      [
        ...detectGateCrossings(gateFrames(0.49), CALIBRATION),
        strokeEvent("s1", 600, "left", 0.49),
        strokeEvent("s2", 900, "right", 0.49),
        strokeEvent("s3", 1600, "left", 0.49),
      ],
      CALIBRATION,
    );

    expect(reviewMeasurements[0].status).toBe("needs-review");
    expect(reviewMeasurements[0].value).toBe(2);
    expect(
      unavailableMeasurements.every(
        (measurement) =>
          measurement.status === "unavailable" &&
          measurement.value === null,
      ),
    ).toBe(true);
  });

  it("keeps gate time and speed valid when only a stroke is low-confidence", () => {
    const gateEvents = detectGateCrossings(gateFrames(), CALIBRATION);
    const measurements = calculateCompetitionMeasurements(
      [
        ...gateEvents,
        strokeEvent("s1", 600, "left", 0.95),
        strokeEvent("s2", 900, "right", 0.49),
        strokeEvent("s3", 1600, "left", 0.95),
      ],
      CALIBRATION,
    );
    const byType = Object.fromEntries(
      measurements.map((measurement) => [measurement.type, measurement]),
    );

    expect(byType["interval-time"]).toMatchObject({
      value: 2,
      status: "confirmed",
    });
    expect(byType["average-speed"]).toMatchObject({
      value: 5,
      status: "confirmed",
    });
    for (const type of [
      "stroke-count",
      "cycle-count",
      "cycle-rate",
      "distance-per-cycle",
    ]) {
      expect(byType[type].value).toBeNull();
      expect(byType[type].status).toBe("unavailable");
    }
  });
});
