import { describe, expect, it } from "vitest";

import {
  exportSwimAnnotationJson,
  parseSwimAnnotationV1,
  SwimAnnotationValidationError,
  type SwimInvalidAnnotationExportV1,
  type SwimValidAnnotationExportV1,
} from "../../lib/validation/swim-annotation";

function validAnnotation(): SwimValidAnnotationExportV1 {
  return {
    schemaVersion: "1.0",
    anonymousVideoId: "clip-0001",
    strokeStyle: "freestyle",
    validity: "valid",
    source: {
      fps: 59.94,
      frameCount: 600,
    },
    distanceMeters: 10,
    gateCrossings: {
      first: { frameIndex: 120, timestampMs: 2_004.6 },
      second: { frameIndex: 480, timestampMs: 8_013.2 },
    },
    strokeEvents: [
      { frameIndex: 150, timestampMs: 2_506.7 },
      { frameIndex: 210, timestampMs: 3_509.4 },
      { frameIndex: 270, timestampMs: 4_512.8 },
      { frameIndex: 330, timestampMs: 5_514.1 },
      { frameIndex: 390, timestampMs: 6_511.9 },
      { frameIndex: 450, timestampMs: 7_512.6 },
    ],
    annotatorLabel: "coach-a",
    invalidReason: null,
    conditions: {
      fixedCamera: true,
      sideOn: true,
      singleSwimmer: true,
      tags: ["clear-view", "indoor-pool"],
    },
    notes: "Complete cycles only.",
  };
}

function invalidAnnotation(): SwimInvalidAnnotationExportV1 {
  return {
    schemaVersion: "1.0",
    anonymousVideoId: "clip-0002",
    strokeStyle: "backstroke",
    validity: "invalid",
    source: {
      fps: 24,
      frameCount: 240,
    },
    distanceMeters: null,
    gateCrossings: null,
    strokeEvents: null,
    annotatorLabel: "coach-b",
    invalidReason: "Camera moved during the interval.",
    conditions: {
      fixedCamera: false,
      sideOn: true,
      singleSwimmer: true,
      tags: ["camera-motion", "low-fps"],
    },
    notes: "",
  };
}

describe("Swim annotation V1", () => {
  it("validates VFR-safe gate and stroke references for a valid clip", () => {
    const annotation = validAnnotation();
    const parsed = parseSwimAnnotationV1({
      ...annotation,
      annotatorLabel: "  coach-a  ",
      conditions: {
        ...annotation.conditions,
        tags: ["indoor-pool", "clear-view"],
      },
      notes: "Complete cycles only.\r\n",
    });

    expect(parsed).toEqual(annotation);
    expect(parsed.validity).toBe("valid");
    if (parsed.validity === "valid") {
      expect(parsed.strokeEvents[0]).toEqual({
        frameIndex: 150,
        timestampMs: 2_506.7,
      });
      expect(parsed.gateCrossings.second.timestampMs).toBe(8_013.2);
    }
  });

  it("allows an invalid clip to preserve unavailable measurements as null", () => {
    expect(parseSwimAnnotationV1(invalidAnnotation())).toEqual(
      invalidAnnotation(),
    );
    expect(
      parseSwimAnnotationV1({
        ...invalidAnnotation(),
        strokeEvents: [],
      }),
    ).toMatchObject({
      validity: "invalid",
      distanceMeters: null,
      gateCrossings: null,
      strokeEvents: [],
    });
  });

  it("requires complete measurements for valid clips", () => {
    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        distanceMeters: null,
      }),
    ).toThrow(/require a known distance/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        gateCrossings: null,
      }),
    ).toThrow(/require two gate crossings/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        strokeEvents: null,
      }),
    ).toThrow(/require stroke events/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        strokeEvents: [],
      }),
    ).toThrow(/at least one stroke event/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        invalidReason: "Not valid after all",
      }),
    ).toThrow(/must be null for valid/);
  });

  it("requires a non-empty reason for invalid clips", () => {
    expect(() =>
      parseSwimAnnotationV1({
        ...invalidAnnotation(),
        invalidReason: "   ",
      }),
    ).toThrow(/non-empty string/);

    expect(() =>
      parseSwimAnnotationV1({
        ...invalidAnnotation(),
        invalidReason: null,
      }),
    ).toThrow(/must be a string/);
  });

  it("exports deterministic JSON independent of input object and tag order", () => {
    const annotation = validAnnotation();
    const reordered = {
      notes: annotation.notes,
      conditions: {
        tags: ["indoor-pool", "clear-view"],
        singleSwimmer: true,
        sideOn: true,
        fixedCamera: true,
      },
      invalidReason: null,
      annotatorLabel: annotation.annotatorLabel,
      strokeEvents: annotation.strokeEvents,
      gateCrossings: {
        second: {
          timestampMs: 8_013.2,
          frameIndex: 480,
        },
        first: {
          timestampMs: 2_004.6,
          frameIndex: 120,
        },
      },
      distanceMeters: 10,
      source: {
        frameCount: 600,
        fps: 59.94,
      },
      validity: "valid",
      strokeStyle: annotation.strokeStyle,
      anonymousVideoId: annotation.anonymousVideoId,
      schemaVersion: annotation.schemaVersion,
    };

    expect(exportSwimAnnotationJson(reordered)).toBe(
      exportSwimAnnotationJson(annotation),
    );
    expect(JSON.parse(exportSwimAnnotationJson(reordered))).toEqual(
      annotation,
    );
    expect(exportSwimAnnotationJson(reordered, { pretty: false })).not.toContain(
      "\n",
    );
  });

  it("rejects filename and path fields instead of silently exporting them", () => {
    const annotation = validAnnotation();

    expect(() =>
      parseSwimAnnotationV1({
        ...annotation,
        fileName: "Jane-Doe-50m.mov",
      }),
    ).toThrow(/filename, file path, and file URL fields are forbidden/);

    expect(() =>
      parseSwimAnnotationV1({
        ...annotation,
        source: {
          ...annotation.source,
          videoPath: "/private/videos/Jane-Doe-50m.mov",
        },
      }),
    ).toThrow(SwimAnnotationValidationError);

    expect(() =>
      parseSwimAnnotationV1({
        ...annotation,
        athleteName: "Jane Doe",
      }),
    ).toThrow(/not part of the V1 annotation schema/);
  });

  it("requires an opaque anonymous video ID rather than a filename", () => {
    for (const anonymousVideoId of [
      "Jane Doe 50m.mov",
      "../Jane-Doe.mov",
      "a",
    ]) {
      expect(() =>
        parseSwimAnnotationV1({
          ...validAnnotation(),
          anonymousVideoId,
        }),
      ).toThrow(/never use a filename/);
    }
  });

  it("requires ordered frame and timestamp pairs within the source", () => {
    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        gateCrossings: {
          first: { frameIndex: 120, timestampMs: 2_004.6 },
          second: { frameIndex: 600, timestampMs: 8_013.2 },
        },
      }),
    ).toThrow(/within source.frameCount/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        gateCrossings: {
          first: { frameIndex: 120, timestampMs: 2_004.6 },
          second: { frameIndex: 480, timestampMs: 1_900 },
        },
      }),
    ).toThrow(/after first.timestampMs/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        strokeEvents: [
          { frameIndex: 150, timestampMs: 2_506.7 },
          { frameIndex: 150, timestampMs: 3_509.4 },
        ],
      }),
    ).toThrow(/frameIndex values must be strictly increasing/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        strokeEvents: [
          { frameIndex: 150, timestampMs: 3_509.4 },
          { frameIndex: 210, timestampMs: 2_506.7 },
        ],
      }),
    ).toThrow(/timestampMs values must be strictly increasing/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        strokeEvents: [
          { frameIndex: 120, timestampMs: 2_004.6 },
          { frameIndex: 210, timestampMs: 3_509.4 },
        ],
      }),
    ).toThrow(/after the first gate/);
  });

  it("rejects invalid distance, source, style, annotator, and conditions", () => {
    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        distanceMeters: 0,
      }),
    ).toThrow(/finite number greater than 0/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        source: { fps: Number.NaN, frameCount: 600 },
      }),
    ).toThrow(/finite number greater than 0/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        strokeStyle: "medley",
      }),
    ).toThrow(/must be one of/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        annotatorLabel: "   ",
      }),
    ).toThrow(/non-empty string/);

    expect(() =>
      parseSwimAnnotationV1({
        ...validAnnotation(),
        conditions: {
          ...validAnnotation().conditions,
          tags: ["clear-view", "clear-view"],
        },
      }),
    ).toThrow(/duplicate tags/);
  });
});
