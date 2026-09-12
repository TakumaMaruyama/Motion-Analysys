import { describe, expect, it } from "vitest";

import { POSE_LANDMARK_INDEX, type PoseFrame, type PoseLandmark, type PoseLandmarks } from "../../types/analysis";
import type { StartCalibrationV1, StartEvent, StartVideoInfo } from "../../types/start";
import {
  buildStartAnalysisResult,
  createStartEventCandidate,
  replaceStartEvent,
  robustForwardVelocityMps,
  startStyleForStroke,
  validateStartEventSequence,
  verifyStartEvent,
} from "../../lib/start";

const CALIBRATION: StartCalibrationV1 = {
  schemaVersion: "1.0",
  imageWidth: 1280,
  imageHeight: 720,
  zeroMeter: { x: 0.1, y: 0.6 },
  fiveMeter: { x: 0.6, y: 0.6 },
  waterSurface: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
  travelDirection: "left-to-right",
};

const VIDEO: StartVideoInfo = {
  name: "start.mp4",
  mimeType: "video/mp4",
  width: 1280,
  height: 720,
  durationMs: 2000,
  effectiveFps: 120,
  fixedCamera: true,
  sideOn: true,
  singleSwimmer: true,
};

function event(type: StartEvent["type"], timestampMs: number, point: StartEvent["point"] = null): StartEvent {
  return verifyStartEvent(createStartEventCandidate(type, { timestampMs, frameIndex: Math.round(timestampMs / (1000 / 120)), point, confidence: 0.7 }), { timestampMs, frameIndex: Math.round(timestampMs / (1000 / 120)), point });
}

function frame(timestampMs: number, x: number): PoseFrame {
  const landmark = (): PoseLandmark => ({ x, y: 0.6, z: 0, visibility: 0.95 });
  const landmarks = Array.from({ length: 33 }, landmark) as unknown as PoseLandmarks;
  const mutable = landmarks as unknown as PoseLandmark[];
  mutable[POSE_LANDMARK_INDEX.left_hip] = { ...landmark(), x: x - 0.01, y: 0.65 };
  mutable[POSE_LANDMARK_INDEX.right_hip] = { ...landmark(), x: x + 0.01, y: 0.65 };
  mutable[POSE_LANDMARK_INDEX.left_shoulder] = { ...landmark(), x: x - 0.01, y: 0.55 };
  mutable[POSE_LANDMARK_INDEX.right_shoulder] = { ...landmark(), x: x + 0.01, y: 0.55 };
  return { timestampMs, sourceFrameIndex: Math.round(timestampMs / (1000 / 120)), imageSize: { width: 1280, height: 720 }, landmarks, worldLandmarks: null };
}

describe("start analysis", () => {
  it("derives a start style without relying on the legacy Competition mode", () => {
    expect(startStyleForStroke("freestyle")).toBe("dive");
    expect(startStyleForStroke("backstroke")).toBe("backstroke");
  });

  it("never calculates from automatic candidates", () => {
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: VIDEO,
      calibration: CALIBRATION,
      events: [
        createStartEventCandidate("signal", { timestampMs: 0, frameIndex: 0, point: null }),
        createStartEventCandidate("takeoff", { timestampMs: 700, frameIndex: 84, point: null }),
      ],
    });
    expect(result.metrics.find((item) => item.id === "block-contact-time")).toMatchObject({ value: null, status: "unavailable" });
    expect(result.analysisMode).toBe("precision");
  });

  it("prefers a verified event over an earlier same-type candidate for metric dependencies", () => {
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: VIDEO,
      calibration: CALIBRATION,
      events: [
        createStartEventCandidate("signal", { timestampMs: 0, frameIndex: 0, point: null }),
        event("signal", 20),
        event("takeoff", 700),
      ],
    });
    expect(result.metrics.find((item) => item.id === "block-contact-time")).toMatchObject({
      value: 680,
      status: "verified",
      requiredEventIds: ["start:signal:20", "start:takeoff:700"],
    });
  });

  it("does not let an out-of-order automatic candidate invalidate otherwise valid capture quality", () => {
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: VIDEO,
      calibration: CALIBRATION,
      events: [
        event("signal", 0),
        event("takeoff", 700),
        createStartEventCandidate("movement-onset", { timestampMs: 900, frameIndex: 108, point: null }),
      ],
    });
    expect(result.quality.status).toBe("needs-review");
    expect(result.quality.warnings.join(" ")).not.toContain("時系列順序が不正");
    expect(result.metrics.find((item) => item.id === "block-contact-time")).toMatchObject({ value: 700, status: "verified" });
  });

  it("requires verified events to be manually frame-confirmed with non-negative values", () => {
    const invalid: StartEvent = {
      id: "invalid",
      type: "signal",
      timestampMs: -1,
      frameIndex: -1,
      point: null,
      confidence: 1,
      status: "verified",
      source: "automatic",
    };
    expect(() => buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: VIDEO,
      calibration: CALIBRATION,
      events: [invalid],
    })).toThrow("non-negative finite timestamp");
    expect(() => verifyStartEvent(createStartEventCandidate("signal", { timestampMs: 0, frameIndex: 0, point: null }), { timestampMs: 0, frameIndex: null, point: null })).toThrow("non-negative integer frame index");
  });

  it("calculates only verified dependencies and invalidates a metric when a dependency is absent", () => {
    const events = [
      event("signal", 0), event("movement-onset", 120), event("takeoff", 700),
      event("head-entry", 1000, { x: 0.36, y: 0.5 }), event("five-meter-head-crossing", 2200),
    ];
    const frames = [frame(700, 0.2), frame(750, 0.25), frame(800, 0.3), frame(900, 0.33), frame(950, 0.35), frame(1000, 0.36)];
    const result = buildStartAnalysisResult({ athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" }, video: VIDEO, calibration: CALIBRATION, events, poseFrames: frames });
    expect(result.metrics.find((item) => item.id === "block-contact-time")?.value).toBe(700);
    expect(result.metrics.find((item) => item.id === "entry-distance")?.value).toBeCloseTo(2.6, 6);
    expect(result.metrics.find((item) => item.id === "takeoff-forward-velocity")?.value).toBeCloseTo(10, 6);
    expect(result.metrics.find((item) => item.id === "five-meter-time")?.value).toBe(2200);
    expect(result.percentiles.every((item) => item.referenceStatus === "available")).toBe(true);
    expect(result.percentiles.find((item) => item.metric === "block-contact-time")?.band).not.toBeNull();

    const withoutSignal = buildStartAnalysisResult({ athlete: result.athlete, video: VIDEO, calibration: CALIBRATION, events: events.filter((item) => item.type !== "signal"), poseFrames: frames });
    expect(withoutSignal.metrics.find((item) => item.id === "entry-time")).toMatchObject({ value: null, status: "unavailable" });
  });

  it("reports low-precision takeoff and entry velocity for calibrated 30fps timing footage", () => {
    const events = [
      event("signal", 0),
      event("movement-onset", 133),
      event("takeoff", 700),
      event("head-entry", 1_033, { x: 0.36, y: 0.5 }),
      event("five-meter-head-crossing", 2_300),
    ];
    const result = buildStartAnalysisResult({
      analysisMode: "timing-only",
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...VIDEO, effectiveFps: 30, fixedCamera: false, sideOn: false },
      calibration: CALIBRATION,
      events,
      poseFrames: [frame(700, 0.2), frame(750, 0.25), frame(800, 0.3), frame(1_000, 0.35), frame(1_033, 0.36)],
    });

    expect(result.analysisMode).toBe("timing-only");
    expect(result.metrics.find((item) => item.id === "movement-onset-time")).toMatchObject({ value: 133, status: "verified" });
    expect(result.metrics.find((item) => item.id === "block-contact-time")).toMatchObject({ value: 700, status: "verified" });
    expect(result.metrics.find((item) => item.id === "flight-time")).toMatchObject({ value: 333, status: "verified" });
    expect(result.metrics.find((item) => item.id === "five-meter-time")).toMatchObject({ value: 2300, status: "verified" });
    expect(result.metrics.find((item) => item.id === "takeoff-forward-velocity")?.status).toBe("verified");
    expect(result.metrics.find((item) => item.id === "takeoff-forward-velocity")?.value).toBeCloseTo(10, 6);
    expect(result.metrics.find((item) => item.id === "takeoff-forward-velocity")?.note).toContain("低精度2D推定");
    expect(result.metrics.find((item) => item.id === "entry-forward-velocity")?.value).toBeCloseTo(100 / 33, 6);
    expect(result.metrics.find((item) => item.id === "entry-forward-velocity")?.note).toContain("低精度2D推定");
    for (const metricId of ["entry-distance", "entry-torso-angle", "zero-to-five-meter-average-speed"] as const) {
      expect(result.metrics.find((item) => item.id === metricId)).toMatchObject({
        value: null,
        status: "unavailable",
        note: "簡易タイムモードでは測定しません。",
      });
    }
    expect(result.percentiles).toEqual([]);
    expect(result.quality.warnings.join(" ")).toContain("1フレーム約33ms");
    expect(result.quality.warnings.join(" ")).toContain("斜め撮影の前方速度");
  });

  it("allows different start events to share one 30fps frame without suppressing time results", () => {
    const events = [
      event("signal", 100),
      event("hands-off", 233),
      event("movement-onset", 233),
      event("rear-foot-off", 800),
      event("takeoff", 800),
      event("head-entry", 1_133),
      event("five-meter-head-crossing", 2_400),
    ];
    const result = buildStartAnalysisResult({
      analysisMode: "timing-only",
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...VIDEO, effectiveFps: 30, fixedCamera: false, sideOn: false },
      calibration: null,
      events,
    });

    expect(result.quality.status).toBe("needs-review");
    expect(result.quality.warnings.join(" ")).not.toContain("時系列順序が不正");
    expect(result.quality.warnings.join(" ")).toContain("簡易速度校正が必要");
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "movement-onset-time", value: 133, status: "verified" }),
      expect.objectContaining({ id: "block-contact-time", value: 700, status: "verified" }),
      expect.objectContaining({ id: "push-off-time", value: 567, status: "verified" }),
      expect.objectContaining({ id: "flight-time", value: 333, status: "verified" }),
      expect.objectContaining({ id: "entry-time", value: 1_033, status: "verified" }),
      expect.objectContaining({ id: "five-meter-time", value: 2_300, status: "verified" }),
    ]));
    expect(result.metrics.find((item) => item.id === "takeoff-forward-velocity")?.value).toBeNull();
    expect(result.metrics.find((item) => item.id === "entry-forward-velocity")?.value).toBeNull();
  });

  it("rejects footage below 30fps even in timing-only mode", () => {
    const result = buildStartAnalysisResult({
      analysisMode: "timing-only",
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...VIDEO, effectiveFps: 29.9, fixedCamera: false, sideOn: false },
      calibration: null,
      events: [event("signal", 0), event("takeoff", 700)],
    });
    expect(result.quality.status).toBe("unavailable");
    expect(result.quality.warnings.join(" ")).toContain("最低30fps");
    expect(result.metrics.every((metric) => metric.value === null)).toBe(true);
  });

  it("treats broadcast-rate 29.97fps as 30fps timing footage", () => {
    const result = buildStartAnalysisResult({
      analysisMode: "timing-only",
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...VIDEO, effectiveFps: 29.97, fixedCamera: false, sideOn: false },
      calibration: null,
      events: [event("signal", 0), event("takeoff", 700)],
    });
    expect(result.quality.status).toBe("needs-review");
    expect(result.metrics.find((item) => item.id === "block-contact-time")).toMatchObject({ value: 700, status: "verified" });
  });

  it("uses a robust median-of-slopes velocity estimate and returns null when coverage is insufficient", () => {
    const points = [
      { x: 0.2, y: 0.5, timestampMs: 0, frameIndex: 0, visibility: 1 },
      { x: 0.25, y: 0.5, timestampMs: 50, frameIndex: 6, visibility: 1 },
      { x: 0.3, y: 0.5, timestampMs: 100, frameIndex: 12, visibility: 1 },
      { x: 0.9, y: 0.5, timestampMs: 101, frameIndex: 13, visibility: 1 },
    ];
    expect(robustForwardVelocityMps(points, CALIBRATION, 0, 100)).toBeCloseTo(10, 6);
    expect(robustForwardVelocityMps(points.slice(0, 1), CALIBRATION, 0, 100)).toBeNull();
  });

  it("uses an entry Pose only within two frames and above the visibility threshold", () => {
    const events = [event("head-entry", 1_000, { x: 0.36, y: 0.5 })];
    const stale = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: VIDEO,
      calibration: CALIBRATION,
      events,
      poseFrames: [frame(950, 0.35)],
    });
    expect(stale.metrics.find((item) => item.id === "entry-torso-angle")).toMatchObject({ value: null, status: "unavailable" });

    const lowVisibilityFrame = frame(1_000, 0.36);
    const mutable = lowVisibilityFrame.landmarks as unknown as PoseLandmark[];
    mutable[POSE_LANDMARK_INDEX.left_shoulder] = { ...mutable[POSE_LANDMARK_INDEX.left_shoulder], visibility: 0.49 };
    const lowVisibility = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: VIDEO,
      calibration: CALIBRATION,
      events,
      poseFrames: [lowVisibilityFrame],
    });
    expect(lowVisibility.metrics.find((item) => item.id === "entry-torso-angle")).toMatchObject({ value: null, status: "unavailable" });
  });

  it("keeps forward distance and velocity positive for right-to-left starts", () => {
    const rightToLeft: StartCalibrationV1 = {
      ...CALIBRATION,
      zeroMeter: { x: 0.9, y: 0.6 },
      fiveMeter: { x: 0.4, y: 0.6 },
      travelDirection: "right-to-left",
    };
    const points = [
      { x: 0.8, y: 0.5, timestampMs: 0, frameIndex: 0, visibility: 1 },
      { x: 0.75, y: 0.5, timestampMs: 50, frameIndex: 6, visibility: 1 },
      { x: 0.7, y: 0.5, timestampMs: 100, frameIndex: 12, visibility: 1 },
    ];
    expect(robustForwardVelocityMps(points, rightToLeft, 0, 100)).toBeCloseTo(10, 6);
  });

  it("rejects rear-foot-off in a backstroke sequence and records manual revisions", () => {
    const rearFoot = event("rear-foot-off", 200);
    expect(validateStartEventSequence([event("signal", 0), rearFoot], "backstroke")).toContain("背泳ぎスタートでは rear-foot-off を使用できません。");
    const initial = buildStartAnalysisResult({ athlete: { strokeStyle: "backstroke", age: 17, researchSexCategory: "female" }, video: VIDEO, calibration: CALIBRATION, events: [event("signal", 0)] });
    const revised = replaceStartEvent(initial, event("takeoff", 800));
    expect(revised.revisionHistory).toHaveLength(1);
    expect(revised.revisionHistory[0].next.status).toBe("verified");
    expect(revised.analysisMode).toBe("precision");
  });

  it("marks age and capture constraints as unavailable instead of fabricating results", () => {
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "breaststroke", age: 12, researchSexCategory: "female" },
      video: { ...VIDEO, effectiveFps: 30 },
      calibration: null,
    });
    expect(result.quality.status).toBe("unavailable");
    expect(result.quality.warnings.join(" ")).toContain("13歳未満");
    expect(result.quality.warnings.join(" ")).toContain("最低60fps");
  });

  it("accepts 60fps with a 120fps recommendation warning", () => {
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...VIDEO, effectiveFps: 60 },
      calibration: CALIBRATION,
    });
    expect(result.quality.status).toBe("needs-review");
    expect(result.quality.warnings.join(" ")).toContain("120fpsを推奨");
  });

  it("suppresses otherwise verified metrics when capture quality is invalid", () => {
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...VIDEO, singleSwimmer: false },
      calibration: CALIBRATION,
      events: [event("signal", 0), event("movement-onset", 120), event("takeoff", 700)],
    });
    expect(result.quality.status).toBe("unavailable");
    expect(result.metrics.find((item) => item.id === "block-contact-time")).toMatchObject({
      value: null,
      status: "unavailable",
    });
  });

  it("stores an external 5m stopwatch value without using it for metrics or percentiles", () => {
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: VIDEO,
      calibration: CALIBRATION,
      events: [event("signal", 0), event("takeoff", 700)],
      externalFiveMeterTimeMs: 1_650,
    });
    expect(result.externalTiming).toMatchObject({
      fiveMeterTimeMs: 1_650,
      usedForPercentile: false,
    });
    expect(result.metrics.find((item) => item.id === "five-meter-time")?.value).toBeNull();
    expect(result.percentiles.some((item) => item.metric === "five-meter-time")).toBe(false);
  });
});
