import { describe, expect, it } from "vitest";

import {
  evaluateSwimAcceptance,
  formatSwimAcceptanceText,
  parseSwimAcceptanceManifest,
  SwimAcceptanceManifestError,
  type SwimAcceptanceManifestV1,
  type SwimAcceptanceMeasurements,
  type SwimAcceptancePrediction,
  type SwimAcceptanceStrokeStyle,
} from "../../lib/validation/swim-acceptance";

const STYLES: readonly SwimAcceptanceStrokeStyle[] = [
  "freestyle",
  "backstroke",
  "breaststroke",
  "butterfly",
];

const UNKNOWN_MEASUREMENTS: SwimAcceptanceMeasurements = {
  strokeCount: null,
  strokeEventFrames: null,
  cycleRateCpm: null,
  averageSpeedMps: null,
  gateCrossings: {
    firstFrame: null,
    secondFrame: null,
  },
};

function knownMeasurements(
  strokeCount = 20,
  cycleRateCpm = 60,
  averageSpeedMps = 1,
  firstFrame = 0,
  secondFrame = 300,
): SwimAcceptanceMeasurements {
  const strokeEventFrames = Array.from(
    { length: strokeCount },
    (_, index) =>
      Math.round(
        firstFrame +
          ((index + 1) * (secondFrame - firstFrame)) /
            (strokeCount + 1),
      ),
  );
  return {
    strokeCount,
    strokeEventFrames,
    cycleRateCpm,
    averageSpeedMps,
    gateCrossings: { firstFrame, secondFrame },
  };
}

interface ManifestOptions {
  readonly validPerStroke?: number;
  readonly invalidCount?: number;
  readonly validPrediction?: (
    index: number,
    reference: SwimAcceptanceMeasurements,
  ) => SwimAcceptancePrediction;
  readonly invalidPrediction?: (index: number) => SwimAcceptancePrediction;
}

function buildManifest(
  options: ManifestOptions = {},
): SwimAcceptanceManifestV1 {
  const validPerStroke = options.validPerStroke ?? 20;
  const invalidCount = options.invalidCount ?? 1;
  let validIndex = 0;
  const validCases = STYLES.flatMap((strokeStyle) =>
    Array.from({ length: validPerStroke }, (_, styleIndex) => {
      const reference = knownMeasurements(
        18 + (styleIndex % 5),
        58 + (styleIndex % 7),
        1 + (styleIndex % 4) * 0.05,
      );
      const prediction = options.validPrediction?.(
        validIndex,
        reference,
      ) ?? {
        status: "valid" as const,
        measurements: reference,
      };
      const entry = {
        id: `valid-${strokeStyle}-${styleIndex}`,
        strokeStyle,
        captureCondition: "supported" as const,
        capture: {
          fps: styleIndex % 2 === 0 ? 60 : 30,
          durationMs: 10_000,
          fixedCamera: true,
          sideOn: true,
          singleSwimmer: true,
        },
        coachLabels: [
          {
            coachId: "coach-a",
            validity: "valid" as const,
            measurements: reference,
          },
          {
            coachId: "coach-b",
            validity: "valid" as const,
            measurements: {
              ...reference,
              cycleRateCpm: reference.cycleRateCpm! + 0.2,
            },
          },
        ] as const,
        adjudicated: {
          validity: "valid" as const,
          measurements: reference,
        },
        prediction,
      };
      validIndex += 1;
      return entry;
    }),
  );
  const invalidCases = Array.from({ length: invalidCount }, (_, index) => ({
    id: `invalid-${index}`,
    strokeStyle: STYLES[index % STYLES.length],
    captureCondition: "intentionally-invalid" as const,
    capture: {
      fps: 15,
      durationMs: 10_000,
      fixedCamera: true,
      sideOn: true,
      singleSwimmer: true,
    },
    coachLabels: [
      {
        coachId: "coach-a",
        validity: "invalid" as const,
        measurements: UNKNOWN_MEASUREMENTS,
      },
      {
        coachId: "coach-b",
        validity: "invalid" as const,
        measurements: UNKNOWN_MEASUREMENTS,
      },
    ] as const,
    adjudicated: {
      validity: "invalid" as const,
      measurements: UNKNOWN_MEASUREMENTS,
    },
    prediction: options.invalidPrediction?.(index) ?? {
      status: "unavailable" as const,
      measurements: UNKNOWN_MEASUREMENTS,
    },
  }));

  return {
    schemaVersion: "1.0",
    dataset: {
      label: "synthetic acceptance fixture",
      rightsCleared: true,
      adultParticipantsOnly: true,
      footageStoredOutsideRepository: true,
    },
    labeling: {
      coachIds: ["coach-a", "coach-b"],
      adjudicationMethod: "independent labels followed by consensus",
    },
    cases: [...validCases, ...invalidCases],
  };
}

describe("Swim acceptance manifest", () => {
  it("passes a complete 80-clip, four-stroke reference set", () => {
    const result = evaluateSwimAcceptance(buildManifest());

    expect(result.passed).toBe(true);
    expect(result.observed.referenceValidClipCount).toBe(80);
    expect(result.observed.referenceValidByStroke).toEqual({
      freestyle: 20,
      backstroke: 20,
      breaststroke: 20,
      butterfly: 20,
    });
    expect(result.observed.gateMedianErrorFrames).toBe(0);
    expect(result.observed.falseValidRatePercent).toBe(0);
    expect(formatSwimAcceptanceText(result)).toContain(
      "Swim acceptance: PASS",
    );
  });

  it("uses inclusive accuracy boundaries and an exclusive false-valid boundary", () => {
    const atExactCountBoundary = evaluateSwimAcceptance(
      buildManifest({
        validPrediction: (index, reference) => ({
          status: "valid",
          measurements: {
            ...reference,
            strokeCount:
              reference.strokeCount! + (index < 4 ? 1 : 0),
            strokeEventFrames:
              index < 4
                ? [
                    ...reference.strokeEventFrames!,
                    reference.gateCrossings.secondFrame! - 1,
                  ]
                : reference.strokeEventFrames,
            cycleRateCpm: reference.cycleRateCpm! + 3,
            averageSpeedMps: reference.averageSpeedMps! * 1.03,
            gateCrossings: {
              firstFrame: reference.gateCrossings.firstFrame! + 1,
              secondFrame: reference.gateCrossings.secondFrame! + 1,
            },
          },
        }),
      }),
    );

    expect(atExactCountBoundary.observed.exactStrokeCountRatePercent).toBe(
      95,
    );
    expect(atExactCountBoundary.checks.exactStrokeCount).toBe(true);
    expect(atExactCountBoundary.checks.cycleRate).toBe(true);
    expect(atExactCountBoundary.checks.averageSpeed).toBe(true);
    expect(atExactCountBoundary.checks.gateMedian).toBe(true);
    expect(atExactCountBoundary.checks.gateP90).toBe(true);

    const exactlyOnePercentFalseValid = evaluateSwimAcceptance(
      buildManifest({
        invalidCount: 100,
        invalidPrediction: (index) =>
          index === 0
            ? { status: "valid", measurements: knownMeasurements() }
            : {
                status: "unavailable",
                measurements: UNKNOWN_MEASUREMENTS,
              },
      }),
    );
    expect(
      exactlyOnePercentFalseValid.observed.falseValidRatePercent,
    ).toBe(1);
    expect(exactlyOnePercentFalseValid.checks.falseValidRate).toBe(false);

    const belowOnePercentFalseValid = evaluateSwimAcceptance(
      buildManifest({
        invalidCount: 101,
        invalidPrediction: (index) =>
          index === 0
            ? { status: "valid", measurements: knownMeasurements() }
            : {
                status: "unavailable",
                measurements: UNKNOWN_MEASUREMENTS,
              },
      }),
    );
    expect(belowOnePercentFalseValid.checks.falseValidRate).toBe(true);
    expect(belowOnePercentFalseValid.passed).toBe(true);
  });

  it("fails every accuracy check when predictions exceed the thresholds", () => {
    const result = evaluateSwimAcceptance(
      buildManifest({
        validPrediction: (index, reference) => ({
          status: "valid",
          measurements: {
            strokeCount: reference.strokeCount! + (index < 5 ? 1 : 0),
            strokeEventFrames:
              index < 5
                ? [
                    ...reference.strokeEventFrames!,
                    reference.gateCrossings.secondFrame! - 1,
                  ]
                : reference.strokeEventFrames,
            cycleRateCpm: reference.cycleRateCpm! + 3.01,
            averageSpeedMps: reference.averageSpeedMps! * 1.0301,
            gateCrossings: {
              firstFrame: reference.gateCrossings.firstFrame! + 2,
              secondFrame: reference.gateCrossings.secondFrame! + 3,
            },
          },
        }),
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.checks.exactStrokeCount).toBe(false);
    expect(result.checks.cycleRate).toBe(false);
    expect(result.checks.averageSpeed).toBe(false);
    expect(result.checks.gateMedian).toBe(false);
    expect(result.checks.gateP90).toBe(false);
    expect(result.failures).toHaveLength(5);
  });

  it("keeps unavailable observations null instead of substituting zero", () => {
    const result = evaluateSwimAcceptance(
      buildManifest({
        validPrediction: () => ({
          status: "unavailable",
          measurements: UNKNOWN_MEASUREMENTS,
        }),
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.observed.completeValidPredictionCount).toBe(0);
    expect(result.observed.cycleRateSampleCount).toBe(0);
    expect(result.observed.cycleRateMaeCpm).toBeNull();
    expect(result.observed.averageSpeedMapePercent).toBeNull();
    expect(result.observed.gateMedianErrorFrames).toBeNull();
    expect(result.observed.gateP90ErrorFrames).toBeNull();
    expect(formatSwimAcceptanceText(result)).toContain("未計測");

    const partial = evaluateSwimAcceptance(
      buildManifest({
        validPrediction: (_index, reference) => ({
          status: "needs-review",
          measurements: {
            ...reference,
            cycleRateCpm: null,
          },
        }),
      }),
    );
    expect(partial.observed.cycleRateSampleCount).toBe(0);
    expect(partial.observed.cycleRateMaeCpm).toBeNull();
    expect(partial.checks.completeValidPredictions).toBe(false);
    expect(partial.checks.cycleRate).toBe(false);
  });

  it("enforces coverage by total count, stroke, and invalid cases", () => {
    const underfilled = evaluateSwimAcceptance(
      buildManifest({ validPerStroke: 19, invalidCount: 0 }),
    );

    expect(underfilled.checks.minimumReferenceClipCount).toBe(false);
    expect(underfilled.checks.minimumReferenceClipsPerStroke).toBe(false);
    expect(underfilled.checks.invalidCaseCoverage).toBe(false);
    expect(underfilled.checks.falseValidRate).toBe(false);
    expect(underfilled.observed.falseValidRatePercent).toBeNull();
  });

  it("rejects unconfirmed rights, incomplete labels, duplicate IDs, and zero sentinels", () => {
    const manifest = buildManifest();
    expect(() =>
      parseSwimAcceptanceManifest({
        ...manifest,
        dataset: { ...manifest.dataset, rightsCleared: false },
      }),
    ).toThrowError(SwimAcceptanceManifestError);

    expect(() =>
      parseSwimAcceptanceManifest({
        ...manifest,
        cases: [
          {
            ...manifest.cases[0],
            coachLabels: [manifest.cases[0].coachLabels[0]],
          },
        ],
      }),
    ).toThrow(/exactly two independent labels/);

    expect(() =>
      parseSwimAcceptanceManifest({
        ...manifest,
        cases: [
          manifest.cases[0],
          { ...manifest.cases[1], id: manifest.cases[0].id },
        ],
      }),
    ).toThrow(/duplicates case ID/);

    expect(() =>
      parseSwimAcceptanceManifest(
        buildManifest({
          invalidPrediction: () => ({
            status: "unavailable",
            measurements: {
              strokeCount: 0,
              strokeEventFrames: [0],
              cycleRateCpm: 0,
              averageSpeedMps: 0,
              gateCrossings: { firstFrame: 0, secondFrame: 0 },
            },
          }),
        }),
      ),
    ).toThrow(/unknown values must never use 0/);
  });

  it("requires each coach to provide ordered stroke-event frame labels", () => {
    const manifest = buildManifest();
    const firstCase = manifest.cases[0];
    const firstLabel = firstCase.coachLabels[0];

    expect(() =>
      parseSwimAcceptanceManifest({
        ...manifest,
        cases: [
          {
            ...firstCase,
            coachLabels: [
              {
                ...firstLabel,
                measurements: {
                  ...firstLabel.measurements,
                  strokeEventFrames: null,
                },
              },
              firstCase.coachLabels[1],
            ],
          },
        ],
      }),
    ).toThrow(/strokeEventFrames/);

    expect(() =>
      parseSwimAcceptanceManifest({
        ...manifest,
        cases: [
          {
            ...firstCase,
            coachLabels: [
              {
                ...firstLabel,
                measurements: {
                  ...firstLabel.measurements,
                  strokeEventFrames: [10, 10],
                },
              },
              firstCase.coachLabels[1],
            ],
          },
        ],
      }),
    ).toThrow(/strictly increasing/);
  });

  it("is deterministic when manifest cases are reordered", () => {
    const manifest = buildManifest();
    const first = evaluateSwimAcceptance(manifest);
    const second = evaluateSwimAcceptance({
      ...manifest,
      cases: [...manifest.cases].reverse(),
    });

    expect(second).toEqual(first);
  });
});
