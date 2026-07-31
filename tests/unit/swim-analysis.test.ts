import { describe, expect, expectTypeOf, it } from "vitest";

import { buildAnalysisResult } from "../../lib/pose/analysis";
import {
  applyManualEventOverrides,
  buildCompetitionAnalysisResult,
  calculateCompetitionMeasurements,
  recalculateCompetitionAnalysis,
} from "../../lib/swim";
import {
  POSE_LANDMARK_INDEX,
  type AnalysisInputInfo,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarks,
} from "../../types/analysis";
import type {
  CalibrationProfileV1,
  CompetitionAnalysisResultV2,
  DetectedEvent,
  ManualEventOverride,
  StartCompetitionAnalysisResultV2,
  SwimCompetitionAnalysisResultV2,
  TurnCompetitionAnalysisResultV2,
} from "../../types/competition";

const INPUT: AnalysisInputInfo = {
  kind: "video",
  name: "race.mp4",
  mimeType: "video/mp4",
  width: 1280,
  height: 720,
  durationMs: 3000,
  mirrored: false,
};

const CALIBRATION: CalibrationProfileV1 = {
  schemaVersion: "1.0",
  id: "pool-side",
  label: "side view",
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

function point(x: number): PoseLandmark {
  return { x, y: 0.5, z: 0, visibility: 0.95 };
}

function frame(
  timestampMs: number,
  torsoX: number,
  sourceFrameIndex: number,
): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () =>
    point(torsoX),
  ) as unknown as PoseLandmarks;
  const mutable = landmarks as unknown as PoseLandmark[];
  mutable[POSE_LANDMARK_INDEX.left_hip] = point(torsoX - 0.01);
  mutable[POSE_LANDMARK_INDEX.right_hip] = point(torsoX + 0.01);
  return {
    timestampMs,
    sourceFrameIndex,
    imageSize: { width: 1280, height: 720 },
    landmarks,
    worldLandmarks: null,
  };
}

const FRAMES = [
  frame(0, 0.1, 10),
  frame(1000, 0.3, 20),
  frame(2000, 0.5, 30),
  frame(3000, 0.7, 40),
];

function buildV2() {
  const source = buildAnalysisResult(
    FRAMES,
    INPUT,
    30,
    FRAMES.map((value) => value.timestampMs),
  );
  return buildCompetitionAnalysisResult(source, {
    sessionLabel: "決勝1組",
    mode: "start",
    strokeStyle: "freestyle",
    calibration: CALIBRATION,
    videoInput: {
      container: "mp4",
      detectedMimeType: "video/mp4",
      codec: "avc1.640028",
      rotation: 0,
      codedWidth: 1920,
      codedHeight: 1080,
      displayWidth: 1280,
      displayHeight: 720,
      effectiveFps: 29.97,
      firstTimestampMs: 12,
      durationMs: 3000,
      frameTimestampsMs: [0, 100, 220, 400, 1000, 2000, 3000],
    },
  });
}

function addedStroke(id: string, timestampMs: number): DetectedEvent {
  return {
    id,
    type: "stroke",
    timestampMs,
    frameIndex: 0,
    confidence: 0.1,
    status: "unavailable",
    source: "automatic",
    strokeStyle: "freestyle",
    side: "left",
    gateId: null,
  };
}

function automaticStroke(
  id: string,
  timestampMs: number,
  side: "left" | "right",
): DetectedEvent {
  return {
    id,
    type: "stroke",
    timestampMs,
    frameIndex: Math.round(timestampMs / 100),
    confidence: 0.95,
    status: "confirmed",
    source: "automatic",
    strokeStyle: "freestyle",
    side,
    gateId: null,
  };
}

describe("buildCompetitionAnalysisResult", () => {
  it("retains V1, raw frames, video metadata, trim and quality at V2 top level", () => {
    const result = buildV2();

    expect(result.schemaVersion).toBe("2.0");
    expect(result.source.schemaVersion).toBe("1.0");
    expect(result.rawPoseFrames).toBe(result.source.frames);
    expect(result.input).toBe(result.source.input);
    expect(result.sampling).toBe(result.source.sampling);
    expect(result.trim).toEqual({
      startTimestampMs: 0,
      endTimestampMs: 3000,
    });
    expect(result.videoInput).toMatchObject({
      codec: "avc1.640028",
      codedWidth: 1920,
      displayWidth: 1280,
      effectiveFps: 29.97,
      firstTimestampMs: 12,
    });
    expect(result.quality.status).toBe("confirmed");
    expect(result.revisionHistory).toEqual([]);
  });

  it("returns a mode-preserving discriminated union", () => {
    const base = buildV2();
    const common = {
      source: base.source,
      calibration: CALIBRATION,
      strokeStyle: "freestyle" as const,
    };
    const swim = buildCompetitionAnalysisResult(common.source, {
      ...common,
      mode: "swim",
    });
    const turn = buildCompetitionAnalysisResult(common.source, {
      ...common,
      mode: "turn",
    });
    const start = buildCompetitionAnalysisResult(common.source, {
      ...common,
      mode: "start",
    });

    expectTypeOf(swim).toEqualTypeOf<SwimCompetitionAnalysisResultV2>();
    expectTypeOf(turn).toEqualTypeOf<TurnCompetitionAnalysisResultV2>();
    expectTypeOf(start).toEqualTypeOf<StartCompetitionAnalysisResultV2>();
    expectTypeOf(
      recalculateCompetitionAnalysis(swim, []),
    ).toEqualTypeOf<SwimCompetitionAnalysisResultV2>();

    const results: readonly CompetitionAnalysisResultV2[] = [
      swim,
      turn,
      start,
    ];
    expect(results.map((result) => result.mode)).toEqual([
      "swim",
      "turn",
      "start",
    ]);
    for (const result of results) {
      switch (result.mode) {
        case "swim":
          expectTypeOf(result).toEqualTypeOf<SwimCompetitionAnalysisResultV2>();
          break;
        case "turn":
          expectTypeOf(result).toEqualTypeOf<TurnCompetitionAnalysisResultV2>();
          break;
        case "start":
          expectTypeOf(result).toEqualTypeOf<StartCompetitionAnalysisResultV2>();
          break;
      }
    }
  });

  it("suppresses otherwise plausible gate metrics when splash or framing loss makes pose coverage low", () => {
    const sparseSource = buildAnalysisResult(
      FRAMES,
      INPUT,
      30,
      Array.from({ length: 31 }, (_, index) => index * 100),
    );
    const result = buildCompetitionAnalysisResult(sparseSource, {
      mode: "swim",
      strokeStyle: "freestyle",
      calibration: CALIBRATION,
    });

    expect(result.quality.poseDetectionRate).toBeLessThan(0.5);
    expect(result.quality.status).toBe("unavailable");
    expect(result.measurements).toHaveLength(6);
    expect(
      result.measurements.every(
        (measurement) =>
          measurement.value === null &&
          measurement.status === "unavailable",
      ),
    ).toBe(true);
  });
});

describe("manual event overrides and recalculation", () => {
  it("marks a moved event verified and recalculates interval metrics", () => {
    const result = buildV2();
    const firstGate = result.events.find(
      (event) => event.gateId === "g0",
    )!;
    const originalSpeed = result.measurements.find(
      (measurement) => measurement.type === "average-speed",
    )!;
    const override: ManualEventOverride = {
      action: "update",
      eventId: firstGate.id,
      timestampMs: 250,
    };
    const recalculated = recalculateCompetitionAnalysis(result, [override]);
    const moved = recalculated.events.find(
      (event) => event.id === firstGate.id,
    )!;
    const speed = recalculated.measurements.find(
      (measurement) => measurement.type === "average-speed",
    )!;

    expect(moved).toMatchObject({
      timestampMs: 250,
      frameIndex: 2,
      confidence: 1,
      status: "verified",
      source: "manual",
    });
    expect(originalSpeed.value).toBe(5);
    expect(speed.value).toBeCloseTo(10 / 2.25);
    expect(speed.status).toBe("verified");
    expect(result.events.find((event) => event.id === firstGate.id)).toEqual(
      firstGate,
    );
    expect(recalculated.revisionHistory).toEqual([
      { revision: 1, overrides: [override] },
    ]);
  });

  it("normalizes additions to verified and supports deletion", () => {
    const result = buildV2();
    const addition: ManualEventOverride = {
      action: "add",
      event: addedStroke("manual-stroke", 1500),
    };
    const withAddition = applyManualEventOverrides(
      result.automaticEvents,
      [addition],
      result.rawPoseFrames,
    );
    const added = withAddition.find(
      (event) => event.id === "manual-stroke",
    )!;

    expect(added).toMatchObject({
      frameIndex: 20,
      confidence: 1,
      status: "verified",
      source: "manual",
    });

    const removal: ManualEventOverride = {
      action: "remove",
      eventId: "manual-stroke",
    };
    expect(
      applyManualEventOverrides(withAddition, [removal]).some(
        (event) => event.id === "manual-stroke",
      ),
    ).toBe(false);
  });

  it("rejects stale overrides instead of silently ignoring them", () => {
    expect(() =>
      recalculateCompetitionAnalysis(buildV2(), [
        { action: "remove", eventId: "missing" },
      ]),
    ).toThrow("unknown event");
  });

  it("marks calculable metrics verified after a deletion-only revision", () => {
    const base = buildV2();
    const strokes = [
      automaticStroke("s1", 600, "left"),
      automaticStroke("s2", 800, "right"),
      automaticStroke("s3", 1200, "left"),
      automaticStroke("s4", 1400, "right"),
      automaticStroke("s5", 1800, "left"),
      automaticStroke("s6", 2000, "right"),
    ];
    const automaticEvents = [...base.automaticEvents, ...strokes].sort(
      (first, second) => first.timestampMs - second.timestampMs,
    );
    const withAutomaticStrokes: StartCompetitionAnalysisResultV2 = {
      ...base,
      automaticEvents,
      events: automaticEvents,
      measurements: calculateCompetitionMeasurements(
        automaticEvents,
        base.calibration,
      ),
    };
    const recalculated = recalculateCompetitionAnalysis(
      withAutomaticStrokes,
      [{ action: "remove", eventId: "s2" }],
    );

    expect(
      recalculated.events.every((event) => event.source === "automatic"),
    ).toBe(true);
    expect(recalculated.measurements).toHaveLength(6);
    expect(
      recalculated.measurements
        .filter((measurement) =>
          measurement.type === "interval-time" ||
          measurement.type === "average-speed",
        )
        .every((measurement) => measurement.status === "confirmed"),
    ).toBe(true);
    expect(
      recalculated.measurements
        .filter((measurement) =>
          measurement.type !== "interval-time" &&
          measurement.type !== "average-speed",
        )
        .every(
          (measurement) =>
            measurement.value !== null && measurement.status === "verified",
        ),
    ).toBe(true);
  });
});
