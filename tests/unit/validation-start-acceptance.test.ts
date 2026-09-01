import { describe, expect, it } from "vitest";
import {
  evaluateStartAcceptance,
  parseStartAcceptanceManifest,
} from "../../lib/validation/start-acceptance";

const caseFor = (
  index: number,
  strokeStyle: "freestyle" | "butterfly" | "breaststroke" | "backstroke",
  fps: number,
  invalid = false,
) => ({
  id: `case-${index}`,
  strokeStyle,
  fps,
  validity: invalid ? "invalid" : "valid",
  reference: {
    takeoffFrame: invalid ? null : 10,
    headEntryFrame: invalid ? null : 30,
    entryDistanceM: invalid ? null : 3,
    forwardVelocityMps: invalid ? null : 4,
  },
  prediction: {
    status: invalid ? "unavailable" : "valid",
    takeoffFrame: invalid ? null : 10,
    headEntryFrame: invalid ? null : 30,
    entryDistanceM: invalid ? null : 3,
    forwardVelocityMps: invalid ? null : 4,
  },
});

function manifest() {
  const strokes = [
    "freestyle",
    "butterfly",
    "breaststroke",
    "backstroke",
  ] as const;
  const validCases = Array.from({ length: 80 }, (_, index) =>
    caseFor(index, strokes[Math.floor(index / 20)], index % 2 ? 60 : 120),
  );
  return {
    schemaVersion: "1.0",
    dataset: {
      label: "test",
      rightsCleared: true,
      minorConsentConfirmed: true,
      footageStoredOutsideRepository: true,
    },
    labeling: {
      coachIds: ["coach-a", "coach-b"],
      adjudicationMethod: "independent labels followed by adjudication",
    },
    cases: [...validCases, caseFor(81, "freestyle", 60, true)],
  };
}

describe("Start acceptance", () => {
  it("passes all published thresholds with 80 balanced reference clips", () => {
    const result = evaluateStartAcceptance(manifest());
    expect(result.passed).toBe(true);
    expect(result.observed.validCaseCount).toBe(80);
    expect(result.checks.minimumReferenceClipsPerStroke).toBe(true);
    expect(result.observed.falseValidRatePercent).toBe(0);
  });

  it("keeps sub-120fps material in the 60fps acceptance group", () => {
    const source = manifest();
    for (let index = 0; index < 20; index += 2) {
      source.cases[index] = {
        ...source.cases[index],
        fps: 119.9,
        prediction: {
          ...source.cases[index].prediction,
          takeoffFrame: 12,
          headEntryFrame: 32,
        },
      };
    }
    const result = evaluateStartAcceptance(source);
    expect(result.observed.frameP90Error120).toBe(0);
    expect(result.observed.frameP90Error60).toBeGreaterThan(0);
  });

  it("rejects schema drift and identifying fields", () => {
    expect(() =>
      parseStartAcceptanceManifest({ ...manifest(), schemaVersion: "2.0" }),
    ).toThrow(/schemaVersion/);
    expect(() =>
      parseStartAcceptanceManifest({ ...manifest(), sourceFilePath: "/private/video" }),
    ).toThrow(/forbidden/);
  });

  it("requires two distinct anonymous coach IDs", () => {
    const source = manifest();
    expect(() =>
      parseStartAcceptanceManifest({
        ...source,
        labeling: { ...source.labeling, coachIds: ["same", "same"] },
      }),
    ).toThrow(/two distinct/);
  });

  it("rejects unverified or incomplete predictions from valid-case coverage", () => {
    for (const status of ["needs-review", "unavailable"] as const) {
      const unverified = manifest();
      unverified.cases[0] = {
        ...unverified.cases[0],
        prediction: { ...unverified.cases[0].prediction, status },
      };
      expect(() => evaluateStartAcceptance(unverified)).toThrow(
        /cannot count toward acceptance coverage/,
      );
    }

    const unknownStatus = manifest();
    unknownStatus.cases[0] = {
      ...unknownStatus.cases[0],
      prediction: { ...unknownStatus.cases[0].prediction, status: "candidate" },
    };
    expect(() => parseStartAcceptanceManifest(unknownStatus)).toThrow(
      /must be valid, needs-review, or unavailable/,
    );

    const incomplete = manifest();
    incomplete.cases[0] = {
      ...incomplete.cases[0],
      prediction: { ...incomplete.cases[0].prediction, entryDistanceM: null },
    };
    expect(() => evaluateStartAcceptance(incomplete)).toThrow(
      /valid prediction requires/,
    );
  });
});
