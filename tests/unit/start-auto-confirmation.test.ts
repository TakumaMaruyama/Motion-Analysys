import { describe, expect, it } from "vitest";

import {
  autoConfirmStartEvents,
  buildStartAnalysisResult,
  createStartEventCandidate,
  verifyStartEvent,
} from "../../lib/start";
import type {
  StartAutoConfirmationContext,
} from "../../lib/start/auto-confirmation";
import type { StartCalibrationV1, StartEvent, StartEventType, StartVideoInfo } from "../../types/start";

const calibration: StartCalibrationV1 = {
  schemaVersion: "1.0",
  imageWidth: 1280,
  imageHeight: 720,
  zeroMeter: { x: 0.1, y: 0.5 },
  fiveMeter: { x: 0.6, y: 0.5 },
  waterSurface: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
  travelDirection: "left-to-right",
};

const video: StartVideoInfo = {
  name: "start.mp4",
  mimeType: "video/mp4",
  width: 1280,
  height: 720,
  durationMs: 3000,
  effectiveFps: 120,
  fixedCamera: true,
  sideOn: true,
  singleSwimmer: true,
};

const context: StartAutoConfirmationContext = {
  analysisMode: "precision",
  effectiveFps: 120,
  fixedCamera: true,
  sideOn: true,
  singleSwimmer: true,
  calibration,
  startStyle: "dive",
};

function candidate(
  type: StartEventType,
  timestampMs: number,
  confidence = 0.96,
  point: StartEvent["point"] = null,
): StartEvent {
  return createStartEventCandidate(type, {
    timestampMs,
    frameIndex: Math.round(timestampMs / (1000 / 120)),
    point,
    confidence,
  });
}

function highScoreSequence(): readonly StartEvent[] {
  return [
    candidate("signal", 0),
    candidate("movement-onset", 120),
    candidate("hands-off", 300),
    candidate("rear-foot-off", 400),
    candidate("takeoff", 700),
    candidate("head-entry", 1_000, 0.96, { x: 0.36, y: 0.51 }),
    candidate("five-meter-head-crossing", 2_200),
  ];
}

describe("start automatic confirmation policy", () => {
  it("automatically confirms an ordered high-score sequence and calculates provisional metrics", () => {
    const events = autoConfirmStartEvents(highScoreSequence(), context);
    expect(events.every((event) => event.status === "confirmed")).toBe(true);
    expect(events.every((event) => event.automaticDecision?.reasons.length === 0)).toBe(true);

    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video,
      calibration,
      events,
    });
    expect(result.metrics.find((metric) => metric.id === "block-contact-time")).toMatchObject({
      value: 700,
      status: "confirmed",
    });
    expect(result.metrics.find((metric) => metric.id === "flight-time")).toMatchObject({
      value: 300,
      status: "confirmed",
    });
    expect(result.percentiles).toEqual([]);
  });

  it("routes a low-score dependency and all dependent events to coach review", () => {
    const sequence = highScoreSequence().map((event) =>
      event.type === "movement-onset" ? { ...event, confidence: 0.5 } : event,
    );
    const events = autoConfirmStartEvents(sequence, context);

    expect(events.find((event) => event.type === "signal")?.status).toBe("confirmed");
    expect(events.find((event) => event.type === "movement-onset")).toMatchObject({ status: "needs-review" });
    expect(events.find((event) => event.type === "takeoff")?.automaticDecision?.reasons).toContain("movement-not-confirmed");
    expect(events.find((event) => event.type === "head-entry")?.status).toBe("needs-review");
  });

  it("does not auto-confirm timing-only entry/5m or any event from an unfixed camera", () => {
    const timingEvents = autoConfirmStartEvents(highScoreSequence(), {
      ...context,
      analysisMode: "timing-only",
      effectiveFps: 30,
      sideOn: false,
      calibration: null,
    });
    expect(timingEvents.find((event) => event.type === "movement-onset")?.status).toBe("confirmed");
    expect(timingEvents.find((event) => event.type === "head-entry")?.status).toBe("needs-review");
    expect(timingEvents.find((event) => event.type === "five-meter-head-crossing")?.status).toBe("needs-review");

    const movingCamera = autoConfirmStartEvents(highScoreSequence(), { ...context, fixedCamera: false });
    expect(movingCamera.every((event) => event.status !== "confirmed")).toBe(true);
    expect(movingCamera[0].automaticDecision?.reasons).toContain("fixed-camera-not-confirmed");
  });

  it("rejects forged automatic confirmation and clears automation evidence after coach confirmation", () => {
    const forged: StartEvent = {
      ...candidate("signal", 0),
      status: "confirmed",
    };
    expect(() => buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video,
      calibration,
      events: [forged],
    })).toThrow("policy decision");

    const automaticallyConfirmed = autoConfirmStartEvents(highScoreSequence(), context)[0];
    const manuallyVerified = verifyStartEvent(automaticallyConfirmed, {
      timestampMs: automaticallyConfirmed.timestampMs,
      frameIndex: automaticallyConfirmed.frameIndex,
      point: automaticallyConfirmed.point,
    });
    expect(manuallyVerified).toMatchObject({ status: "verified", source: "manual", confidence: 1 });
    expect(manuallyVerified.automaticDecision).toBeUndefined();
  });

  it("rechecks capture conditions and upstream timing at the result boundary", () => {
    const automaticallyConfirmed = autoConfirmStartEvents(highScoreSequence(), context);
    const movingCameraResult = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...video, fixedCamera: false },
      calibration,
      events: automaticallyConfirmed,
    });
    expect(movingCameraResult.events.every((event) => event.status !== "confirmed")).toBe(true);
    expect(movingCameraResult.metrics.find((metric) => metric.id === "block-contact-time")).toMatchObject({
      value: null,
      status: "unavailable",
    });

    const editedSignal = verifyStartEvent(automaticallyConfirmed[0], {
      timestampMs: 115,
      frameIndex: 14,
      point: null,
    });
    const editedResult = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video,
      calibration,
      events: [editedSignal, ...automaticallyConfirmed.slice(1)],
    });
    expect(editedResult.events.find((event) => event.type === "movement-onset")).toMatchObject({
      status: "needs-review",
    });
    expect(editedResult.metrics.find((metric) => metric.id === "movement-onset-time")).toMatchObject({
      value: null,
      status: "unavailable",
    });
  });
});
