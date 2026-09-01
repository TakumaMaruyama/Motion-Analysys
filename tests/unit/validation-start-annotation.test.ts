import { describe, expect, it } from "vitest";
import {
  exportStartAnnotationJson,
  parseStartAnnotationV1,
} from "../../lib/validation/start-annotation";

const events = [
  { type: "signal", frameIndex: 1, timestampMs: 8, point: null },
  { type: "movement-onset", frameIndex: 4, timestampMs: 33, point: null },
  { type: "hands-off", frameIndex: 8, timestampMs: 67, point: null },
  { type: "rear-foot-off", frameIndex: 9, timestampMs: 75, point: null },
  { type: "takeoff", frameIndex: 10, timestampMs: 83, point: null },
  {
    type: "head-entry",
    frameIndex: 30,
    timestampMs: 250,
    point: { x: 0.42, y: 0.51 },
  },
  {
    type: "five-meter-head-crossing",
    frameIndex: null,
    timestampMs: null,
    point: null,
  },
] as const;

const sample = {
  schemaVersion: "1.0",
  anonymousVideoId: "start-001",
  annotatorId: "coach-a",
  validity: "valid",
  invalidReason: null,
  athlete: {
    strokeStyle: "freestyle",
    age: 14,
    researchSexCategory: "female",
  },
  capture: {
    fps: 120,
    durationMs: 5_000,
    fixedCamera: true,
    sideOn: true,
    singleSwimmer: true,
  },
  calibration: {
    zeroMeter: { x: 0.1, y: 0.5 },
    fiveMeter: { x: 0.5, y: 0.5 },
    waterSurface: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    travelDirection: "left-to-right",
  },
  events,
  rightsCleared: true,
  minorConsentConfirmed: true,
  footageStoredOutsideRepository: true,
  notes: "",
};

describe("Start annotation V1", () => {
  it("normalizes and deterministically exports a complete anonymous annotation", () => {
    const parsed = parseStartAnnotationV1(sample);
    expect(parsed).toEqual(sample);
    expect(exportStartAnnotationJson(sample, { pretty: false })).toBe(
      exportStartAnnotationJson(structuredClone(sample), { pretty: false }),
    );
    expect(exportStartAnnotationJson(sample, { pretty: false })).not.toContain(
      "filename",
    );
  });

  it("rejects unknown identifying fields and out-of-range points", () => {
    expect(() =>
      parseStartAnnotationV1({ ...sample, athleteName: "person" }),
    ).toThrow(/forbidden/);
    expect(() =>
      parseStartAnnotationV1({
        ...sample,
        calibration: { ...sample.calibration, zeroMeter: { x: 2, y: 0.5 } },
      }),
    ).toThrow(/normalized/);
  });

  it("accepts a reasoned invalid low-quality capture without labels", () => {
    expect(
      parseStartAnnotationV1({
        ...sample,
        validity: "invalid",
        invalidReason: "camera moved",
        capture: {
          ...sample.capture,
          fps: 30,
          fixedCamera: false,
          sideOn: false,
          singleSwimmer: false,
        },
        calibration: null,
        events: null,
      }).validity,
    ).toBe("invalid");
  });

  it("requires the clicked head-entry point for valid labels", () => {
    expect(() =>
      parseStartAnnotationV1({
        ...sample,
        events: events.map((event) =>
          event.type === "head-entry" ? { ...event, point: null } : event,
        ),
      }),
    ).toThrow(/head-entry requires/);
  });

  it("requires rear-foot-off to remain null for backstroke", () => {
    expect(() =>
      parseStartAnnotationV1({
        ...sample,
        athlete: { ...sample.athlete, strokeStyle: "backstroke" },
      }),
    ).toThrow(/rear-foot-off must be null/);
  });

  it("requires the same non-degenerate, directionally valid calibration as analysis", () => {
    expect(() =>
      parseStartAnnotationV1({
        ...sample,
        calibration: { ...sample.calibration, fiveMeter: { x: 0.1, y: 0.5 } },
      }),
    ).toThrow(/differ on X/);
    expect(() =>
      parseStartAnnotationV1({
        ...sample,
        calibration: { ...sample.calibration, travelDirection: "right-to-left" },
      }),
    ).toThrow(/match the configured travel direction/);
    expect(() =>
      parseStartAnnotationV1({
        ...sample,
        calibration: {
          ...sample.calibration,
          waterSurface: [
            { x: 0.5, y: 0.5 },
            { x: 0.5, y: 0.5 },
          ],
        },
      }),
    ).toThrow(/water surface points must differ/);
  });
});
