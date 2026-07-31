export const SWIM_STYLES = [
  "freestyle",
  "backstroke",
  "breaststroke",
  "butterfly",
] as const;

export type SwimAcceptanceStrokeStyle = (typeof SWIM_STYLES)[number];

export const SWIM_ACCEPTANCE_THRESHOLDS = {
  minimumReferenceClipCount: 80,
  minimumReferenceClipsPerStroke: 20,
  minimumExactStrokeCountRatePercent: 95,
  maximumCycleRateMaeCpm: 3,
  maximumAverageSpeedMapePercent: 3,
  maximumGateMedianErrorFrames: 1,
  maximumGateP90ErrorFrames: 2,
  maximumFalseValidRatePercentExclusive: 1,
} as const;

export interface SwimAcceptanceMeasurements {
  readonly strokeCount: number | null;
  readonly strokeEventFrames: readonly number[] | null;
  readonly cycleRateCpm: number | null;
  readonly averageSpeedMps: number | null;
  readonly gateCrossings: {
    readonly firstFrame: number | null;
    readonly secondFrame: number | null;
  };
}

export interface SwimAcceptanceCoachLabel {
  readonly coachId: string;
  readonly validity: "valid" | "invalid";
  readonly measurements: SwimAcceptanceMeasurements;
}

export interface SwimAcceptanceReference {
  readonly validity: "valid" | "invalid";
  readonly measurements: SwimAcceptanceMeasurements;
}

export interface SwimAcceptancePrediction {
  readonly status: "valid" | "needs-review" | "unavailable";
  readonly measurements: SwimAcceptanceMeasurements;
}

export interface SwimAcceptanceCase {
  readonly id: string;
  readonly strokeStyle: SwimAcceptanceStrokeStyle;
  readonly captureCondition: "supported" | "intentionally-invalid";
  readonly capture: {
    readonly fps: number;
    readonly durationMs: number;
    readonly fixedCamera: boolean;
    readonly sideOn: boolean;
    readonly singleSwimmer: boolean;
  };
  readonly coachLabels: readonly [
    SwimAcceptanceCoachLabel,
    SwimAcceptanceCoachLabel,
  ];
  readonly adjudicated: SwimAcceptanceReference;
  readonly prediction: SwimAcceptancePrediction;
}

export interface SwimAcceptanceManifestV1 {
  readonly schemaVersion: "1.0";
  readonly dataset: {
    readonly label: string;
    readonly rightsCleared: true;
    readonly adultParticipantsOnly: true;
    readonly footageStoredOutsideRepository: true;
  };
  readonly labeling: {
    readonly coachIds: readonly [string, string];
    readonly adjudicationMethod: string;
  };
  readonly cases: readonly SwimAcceptanceCase[];
}

export interface SwimAcceptanceObserved {
  readonly totalCaseCount: number;
  readonly referenceValidClipCount: number;
  readonly referenceInvalidClipCount: number;
  readonly referenceValidByStroke: Readonly<
    Record<SwimAcceptanceStrokeStyle, number>
  >;
  readonly completeValidPredictionCount: number;
  readonly exactStrokeCountMatches: number;
  readonly exactStrokeCountRatePercent: number | null;
  readonly cycleRateSampleCount: number;
  readonly cycleRateMaeCpm: number | null;
  readonly averageSpeedSampleCount: number;
  readonly averageSpeedMapePercent: number | null;
  readonly gateSampleCount: number;
  readonly gateMedianErrorFrames: number | null;
  readonly gateP90ErrorFrames: number | null;
  readonly falseValidCount: number;
  readonly falseValidRatePercent: number | null;
}

export interface SwimAcceptanceChecks {
  readonly minimumReferenceClipCount: boolean;
  readonly minimumReferenceClipsPerStroke: boolean;
  readonly completeValidPredictions: boolean;
  readonly exactStrokeCount: boolean;
  readonly cycleRate: boolean;
  readonly averageSpeed: boolean;
  readonly gateMedian: boolean;
  readonly gateP90: boolean;
  readonly invalidCaseCoverage: boolean;
  readonly falseValidRate: boolean;
}

export interface SwimAcceptanceResult {
  readonly schemaVersion: "1.0";
  readonly datasetLabel: string;
  readonly passed: boolean;
  readonly thresholds: typeof SWIM_ACCEPTANCE_THRESHOLDS;
  readonly observed: SwimAcceptanceObserved;
  readonly checks: SwimAcceptanceChecks;
  readonly failures: readonly string[];
}

export class SwimAcceptanceManifestError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid Swim acceptance manifest at ${path}: ${message}`);
    this.name = "SwimAcceptanceManifestError";
    this.path = path;
  }
}

type JsonObject = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new SwimAcceptanceManifestError(path, message);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as JsonObject;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function literal<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(path, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite number");
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path);
  if (parsed <= 0) {
    fail(path, "must be greater than 0");
  }
  return parsed;
}

function frameIndex(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(path, "must be an integer greater than or equal to 0");
  }
  return parsed;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "must be a boolean");
  }
  return value;
}

function confirmedTrue(value: unknown, path: string): true {
  if (value !== true) {
    fail(path, "must be true");
  }
  return true;
}

function nullAt(value: unknown, path: string): null {
  if (value !== null) {
    fail(path, "must be null; unknown values must never use 0 or another sentinel");
  }
  return null;
}

type MeasurementAvailability = "known" | "partial" | "unknown";

function nullablePositiveNumber(
  value: unknown,
  path: string,
): number | null {
  return value === null ? null : positiveNumber(value, path);
}

function nullableStrokeCount(
  value: unknown,
  path: string,
): number | null {
  if (value === null) {
    return null;
  }
  const parsed = finiteNumber(value, path);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(path, "must be a positive integer or null");
  }
  return parsed;
}

function nullableFrameIndex(
  value: unknown,
  path: string,
): number | null {
  return value === null ? null : frameIndex(value, path);
}

function nullableStrokeEventFrames(
  value: unknown,
  path: string,
): readonly number[] | null {
  if (value === null) return null;
  const values = arrayAt(value, path).map((entry, index) =>
    frameIndex(entry, `${path}[${index}]`),
  );
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      fail(path, "must be strictly increasing without duplicate frames");
    }
  }
  return values;
}

function validateStrokeEventFrames(
  strokeCount: number | null,
  strokeEventFrames: readonly number[] | null,
  firstFrame: number | null,
  secondFrame: number | null,
  path: string,
): void {
  if (strokeCount === null || strokeEventFrames === null) return;
  if (strokeEventFrames.length !== strokeCount) {
    fail(path, "length must equal strokeCount");
  }
  if (
    firstFrame !== null &&
    secondFrame !== null &&
    strokeEventFrames.some(
      (frame) => frame <= firstFrame || frame > secondFrame,
    )
  ) {
    fail(path, "every event must be after firstFrame and at or before secondFrame");
  }
}

function parseMeasurements(
  value: unknown,
  path: string,
  availability: MeasurementAvailability,
): SwimAcceptanceMeasurements {
  const object = objectAt(value, path);
  const gates = objectAt(object.gateCrossings, `${path}.gateCrossings`);

  if (availability === "unknown") {
    return {
      strokeCount: nullAt(object.strokeCount, `${path}.strokeCount`),
      strokeEventFrames: nullAt(
        object.strokeEventFrames,
        `${path}.strokeEventFrames`,
      ),
      cycleRateCpm: nullAt(object.cycleRateCpm, `${path}.cycleRateCpm`),
      averageSpeedMps: nullAt(
        object.averageSpeedMps,
        `${path}.averageSpeedMps`,
      ),
      gateCrossings: {
        firstFrame: nullAt(
          gates.firstFrame,
          `${path}.gateCrossings.firstFrame`,
        ),
        secondFrame: nullAt(
          gates.secondFrame,
          `${path}.gateCrossings.secondFrame`,
        ),
      },
    };
  }

  if (availability === "partial") {
    const firstFrame = nullableFrameIndex(
      gates.firstFrame,
      `${path}.gateCrossings.firstFrame`,
    );
    const secondFrame = nullableFrameIndex(
      gates.secondFrame,
      `${path}.gateCrossings.secondFrame`,
    );
    if (
      firstFrame !== null &&
      secondFrame !== null &&
      secondFrame <= firstFrame
    ) {
      fail(
        `${path}.gateCrossings.secondFrame`,
        "must be after firstFrame",
      );
    }
    const strokeCount = nullableStrokeCount(
      object.strokeCount,
      `${path}.strokeCount`,
    );
    const strokeEventFrames = nullableStrokeEventFrames(
      object.strokeEventFrames,
      `${path}.strokeEventFrames`,
    );
    validateStrokeEventFrames(
      strokeCount,
      strokeEventFrames,
      firstFrame,
      secondFrame,
      `${path}.strokeEventFrames`,
    );
    return {
      strokeCount,
      strokeEventFrames,
      cycleRateCpm: nullablePositiveNumber(
        object.cycleRateCpm,
        `${path}.cycleRateCpm`,
      ),
      averageSpeedMps: nullablePositiveNumber(
        object.averageSpeedMps,
        `${path}.averageSpeedMps`,
      ),
      gateCrossings: { firstFrame, secondFrame },
    };
  }

  const strokeCount = finiteNumber(
    object.strokeCount,
    `${path}.strokeCount`,
  );
  if (!Number.isInteger(strokeCount) || strokeCount <= 0) {
    fail(`${path}.strokeCount`, "must be a positive integer");
  }
  const firstFrame = frameIndex(
    gates.firstFrame,
    `${path}.gateCrossings.firstFrame`,
  );
  const secondFrame = frameIndex(
    gates.secondFrame,
    `${path}.gateCrossings.secondFrame`,
  );
  if (secondFrame <= firstFrame) {
    fail(
      `${path}.gateCrossings.secondFrame`,
      "must be after firstFrame",
    );
  }
  const strokeEventFrames = nullableStrokeEventFrames(
    object.strokeEventFrames,
    `${path}.strokeEventFrames`,
  );
  if (strokeEventFrames === null) {
    fail(`${path}.strokeEventFrames`, "must be an array for a known measurement");
  }
  validateStrokeEventFrames(
    strokeCount,
    strokeEventFrames,
    firstFrame,
    secondFrame,
    `${path}.strokeEventFrames`,
  );

  return {
    strokeCount,
    strokeEventFrames,
    cycleRateCpm: positiveNumber(
      object.cycleRateCpm,
      `${path}.cycleRateCpm`,
    ),
    averageSpeedMps: positiveNumber(
      object.averageSpeedMps,
      `${path}.averageSpeedMps`,
    ),
    gateCrossings: { firstFrame, secondFrame },
  };
}

function parseReference(
  value: unknown,
  path: string,
): SwimAcceptanceReference {
  const object = objectAt(value, path);
  const validity = literal(
    object.validity,
    ["valid", "invalid"] as const,
    `${path}.validity`,
  );
  return {
    validity,
    measurements: parseMeasurements(
      object.measurements,
      `${path}.measurements`,
      validity === "valid" ? "known" : "unknown",
    ),
  };
}

function parseCoachLabel(
  value: unknown,
  path: string,
): SwimAcceptanceCoachLabel {
  const object = objectAt(value, path);
  const reference = parseReference(object, path);
  return {
    coachId: nonEmptyString(object.coachId, `${path}.coachId`),
    ...reference,
  };
}

function parsePrediction(
  value: unknown,
  path: string,
): SwimAcceptancePrediction {
  const object = objectAt(value, path);
  const status = literal(
    object.status,
    ["valid", "needs-review", "unavailable"] as const,
    `${path}.status`,
  );
  return {
    status,
    measurements: parseMeasurements(
      object.measurements,
      `${path}.measurements`,
      status === "valid"
        ? "known"
        : status === "needs-review"
          ? "partial"
          : "unknown",
    ),
  };
}

function parseCase(
  value: unknown,
  path: string,
  expectedCoachIds: readonly [string, string],
): SwimAcceptanceCase {
  const object = objectAt(value, path);
  const captureCondition = literal(
    object.captureCondition,
    ["supported", "intentionally-invalid"] as const,
    `${path}.captureCondition`,
  );
  const captureObject = objectAt(object.capture, `${path}.capture`);
  const fps = positiveNumber(captureObject.fps, `${path}.capture.fps`);
  const durationMs = positiveNumber(
    captureObject.durationMs,
    `${path}.capture.durationMs`,
  );
  const capture = {
    fps,
    durationMs,
    fixedCamera: booleanAt(
      captureObject.fixedCamera,
      `${path}.capture.fixedCamera`,
    ),
    sideOn: booleanAt(captureObject.sideOn, `${path}.capture.sideOn`),
    singleSwimmer: booleanAt(
      captureObject.singleSwimmer,
      `${path}.capture.singleSwimmer`,
    ),
  };

  if (captureCondition === "supported") {
    if (fps < 30) {
      fail(`${path}.capture.fps`, "supported clips require at least 30 fps");
    }
    if (durationMs > 30_000) {
      fail(
        `${path}.capture.durationMs`,
        "supported clips must be 30 seconds or shorter",
      );
    }
    if (!capture.fixedCamera || !capture.sideOn || !capture.singleSwimmer) {
      fail(
        `${path}.capture`,
        "supported clips require fixedCamera, sideOn, and singleSwimmer",
      );
    }
  }

  const rawCoachLabels = arrayAt(
    object.coachLabels,
    `${path}.coachLabels`,
  );
  if (rawCoachLabels.length !== 2) {
    fail(`${path}.coachLabels`, "must contain exactly two independent labels");
  }
  const firstLabel = parseCoachLabel(
    rawCoachLabels[0],
    `${path}.coachLabels[0]`,
  );
  const secondLabel = parseCoachLabel(
    rawCoachLabels[1],
    `${path}.coachLabels[1]`,
  );
  if (firstLabel.coachId === secondLabel.coachId) {
    fail(`${path}.coachLabels`, "coachId values must be different");
  }
  const actualCoachIds = [firstLabel.coachId, secondLabel.coachId].sort();
  const configuredCoachIds = [...expectedCoachIds].sort();
  if (
    actualCoachIds[0] !== configuredCoachIds[0] ||
    actualCoachIds[1] !== configuredCoachIds[1]
  ) {
    fail(
      `${path}.coachLabels`,
      "must contain one label from each configured coachId",
    );
  }

  const adjudicated = parseReference(
    object.adjudicated,
    `${path}.adjudicated`,
  );
  if (
    (captureCondition === "supported") !==
    (adjudicated.validity === "valid")
  ) {
    fail(
      `${path}.adjudicated.validity`,
      "must be valid for supported clips and invalid for intentionally-invalid clips",
    );
  }

  return {
    id: nonEmptyString(object.id, `${path}.id`),
    strokeStyle: literal(
      object.strokeStyle,
      SWIM_STYLES,
      `${path}.strokeStyle`,
    ),
    captureCondition,
    capture,
    coachLabels: [firstLabel, secondLabel],
    adjudicated,
    prediction: parsePrediction(object.prediction, `${path}.prediction`),
  };
}

/**
 * Parses the external manifest and rejects ambiguous sentinel values. A metric
 * that was not measured must be JSON null; zero is never interpreted as null.
 */
export function parseSwimAcceptanceManifest(
  value: unknown,
): SwimAcceptanceManifestV1 {
  const root = objectAt(value, "$" );
  if (root.schemaVersion !== "1.0") {
    fail("$.schemaVersion", 'must equal "1.0"');
  }
  const datasetObject = objectAt(root.dataset, "$.dataset");
  const labelingObject = objectAt(root.labeling, "$.labeling");
  const rawCoachIds = arrayAt(
    labelingObject.coachIds,
    "$.labeling.coachIds",
  );
  if (rawCoachIds.length !== 2) {
    fail("$.labeling.coachIds", "must contain exactly two coach IDs");
  }
  const coachIds: [string, string] = [
    nonEmptyString(rawCoachIds[0], "$.labeling.coachIds[0]"),
    nonEmptyString(rawCoachIds[1], "$.labeling.coachIds[1]"),
  ];
  if (coachIds[0] === coachIds[1]) {
    fail("$.labeling.coachIds", "must identify two different coaches");
  }

  const rawCases = arrayAt(root.cases, "$.cases");
  const ids = new Set<string>();
  const cases = rawCases.map((entry, index) => {
    const parsed = parseCase(entry, `$.cases[${index}]`, coachIds);
    if (ids.has(parsed.id)) {
      fail(`$.cases[${index}].id`, `duplicates case ID ${JSON.stringify(parsed.id)}`);
    }
    ids.add(parsed.id);
    return parsed;
  });

  return {
    schemaVersion: "1.0",
    dataset: {
      label: nonEmptyString(datasetObject.label, "$.dataset.label"),
      rightsCleared: confirmedTrue(
        datasetObject.rightsCleared,
        "$.dataset.rightsCleared",
      ),
      adultParticipantsOnly: confirmedTrue(
        datasetObject.adultParticipantsOnly,
        "$.dataset.adultParticipantsOnly",
      ),
      footageStoredOutsideRepository: confirmedTrue(
        datasetObject.footageStoredOutsideRepository,
        "$.dataset.footageStoredOutsideRepository",
      ),
    },
    labeling: {
      coachIds,
      adjudicationMethod: nonEmptyString(
        labelingObject.adjudicationMethod,
        "$.labeling.adjudicationMethod",
      ),
    },
    cases,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(
  values: readonly number[],
  quantile: number,
): number | null {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((first, second) => first - second);
  const position = (ordered.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return ordered[lowerIndex];
  }
  const weight = position - lowerIndex;
  return (
    ordered[lowerIndex] * (1 - weight) +
    ordered[upperIndex] * weight
  );
}

function withinMaximum(value: number | null, maximum: number): boolean {
  return value !== null && value <= maximum + 1e-12;
}

function failureMessages(
  checks: SwimAcceptanceChecks,
): readonly string[] {
  const messages: Record<keyof SwimAcceptanceChecks, string> = {
    minimumReferenceClipCount: "80件以上の有効な基準映像が必要です。",
    minimumReferenceClipsPerStroke: "各泳法20件以上の有効な基準映像が必要です。",
    completeValidPredictions: "有効な基準映像の予測値またはゲートが欠けています。",
    exactStrokeCount: "ストローク数完全一致率が95%未満です。",
    cycleRate: "サイクルレート平均絶対誤差が3 cycles/minを超えています。",
    averageSpeed: "平均速度の平均絶対パーセント誤差が3%を超えています。",
    gateMedian: "ゲート通過誤差の中央値が1フレームを超えています。",
    gateP90: "ゲート通過誤差のp90が2フレームを超えています。",
    invalidCaseCoverage: "false-valid率を判定する無効映像がありません。",
    falseValidRate: "無効映像のfalse-valid率が1%未満ではありません。",
  };
  return (Object.keys(checks) as Array<keyof SwimAcceptanceChecks>)
    .filter((key) => !checks[key])
    .map((key) => messages[key]);
}

/** Evaluates a manifest deterministically; manifest order does not affect it. */
export function evaluateSwimAcceptance(
  value: unknown,
): SwimAcceptanceResult {
  const manifest = parseSwimAcceptanceManifest(value);
  const cases = [...manifest.cases].sort((first, second) =>
    first.id.localeCompare(second.id),
  );
  const validCases = cases.filter(
    (entry) => entry.adjudicated.validity === "valid",
  );
  const invalidCases = cases.filter(
    (entry) => entry.adjudicated.validity === "invalid",
  );
  const validByStroke: Record<SwimAcceptanceStrokeStyle, number> = {
    freestyle: 0,
    backstroke: 0,
    breaststroke: 0,
    butterfly: 0,
  };

  let completeValidPredictionCount = 0;
  let exactStrokeCountMatches = 0;
  const cycleRateErrors: number[] = [];
  const averageSpeedPercentageErrors: number[] = [];
  const gateFrameErrors: number[] = [];

  for (const entry of validCases) {
    validByStroke[entry.strokeStyle] += 1;
    const reference = entry.adjudicated.measurements;
    const prediction = entry.prediction.measurements;
    const complete =
      prediction.strokeCount !== null &&
      prediction.cycleRateCpm !== null &&
      prediction.averageSpeedMps !== null &&
      prediction.gateCrossings.firstFrame !== null &&
      prediction.gateCrossings.secondFrame !== null;
    if (complete) {
      completeValidPredictionCount += 1;
    }

    if (
      prediction.strokeCount !== null &&
      prediction.strokeCount === reference.strokeCount
    ) {
      exactStrokeCountMatches += 1;
    }
    if (
      prediction.cycleRateCpm !== null &&
      reference.cycleRateCpm !== null
    ) {
      cycleRateErrors.push(
        Math.abs(prediction.cycleRateCpm - reference.cycleRateCpm),
      );
    }
    if (
      prediction.averageSpeedMps !== null &&
      reference.averageSpeedMps !== null
    ) {
      averageSpeedPercentageErrors.push(
        (Math.abs(
          prediction.averageSpeedMps - reference.averageSpeedMps,
        ) /
          reference.averageSpeedMps) *
          100,
      );
    }
    if (
      prediction.gateCrossings.firstFrame !== null &&
      reference.gateCrossings.firstFrame !== null
    ) {
      gateFrameErrors.push(
        Math.abs(
          prediction.gateCrossings.firstFrame -
            reference.gateCrossings.firstFrame,
        ),
      );
    }
    if (
      prediction.gateCrossings.secondFrame !== null &&
      reference.gateCrossings.secondFrame !== null
    ) {
      gateFrameErrors.push(
        Math.abs(
          prediction.gateCrossings.secondFrame -
            reference.gateCrossings.secondFrame,
        ),
      );
    }
  }

  const falseValidCount = invalidCases.filter(
    (entry) => entry.prediction.status === "valid",
  ).length;
  const exactStrokeCountRatePercent =
    validCases.length === 0
      ? null
      : (exactStrokeCountMatches / validCases.length) * 100;
  const falseValidRatePercent =
    invalidCases.length === 0
      ? null
      : (falseValidCount / invalidCases.length) * 100;
  const cycleRateMaeCpm = mean(cycleRateErrors);
  const averageSpeedMapePercent = mean(averageSpeedPercentageErrors);
  const gateMedianErrorFrames = percentile(gateFrameErrors, 0.5);
  const gateP90ErrorFrames = percentile(gateFrameErrors, 0.9);
  const completeValidPredictions =
    completeValidPredictionCount === validCases.length &&
    validCases.length > 0;

  const checks: SwimAcceptanceChecks = {
    minimumReferenceClipCount:
      validCases.length >=
      SWIM_ACCEPTANCE_THRESHOLDS.minimumReferenceClipCount,
    minimumReferenceClipsPerStroke: SWIM_STYLES.every(
      (style) =>
        validByStroke[style] >=
        SWIM_ACCEPTANCE_THRESHOLDS.minimumReferenceClipsPerStroke,
    ),
    completeValidPredictions,
    exactStrokeCount:
      completeValidPredictions &&
      exactStrokeCountRatePercent !== null &&
      exactStrokeCountRatePercent >=
        SWIM_ACCEPTANCE_THRESHOLDS.minimumExactStrokeCountRatePercent,
    cycleRate:
      cycleRateErrors.length === validCases.length &&
      withinMaximum(
        cycleRateMaeCpm,
        SWIM_ACCEPTANCE_THRESHOLDS.maximumCycleRateMaeCpm,
      ),
    averageSpeed:
      averageSpeedPercentageErrors.length === validCases.length &&
      withinMaximum(
        averageSpeedMapePercent,
        SWIM_ACCEPTANCE_THRESHOLDS.maximumAverageSpeedMapePercent,
      ),
    gateMedian:
      gateFrameErrors.length === validCases.length * 2 &&
      withinMaximum(
        gateMedianErrorFrames,
        SWIM_ACCEPTANCE_THRESHOLDS.maximumGateMedianErrorFrames,
      ),
    gateP90:
      gateFrameErrors.length === validCases.length * 2 &&
      withinMaximum(
        gateP90ErrorFrames,
        SWIM_ACCEPTANCE_THRESHOLDS.maximumGateP90ErrorFrames,
      ),
    invalidCaseCoverage: invalidCases.length > 0,
    falseValidRate:
      falseValidRatePercent !== null &&
      falseValidRatePercent <
        SWIM_ACCEPTANCE_THRESHOLDS.maximumFalseValidRatePercentExclusive,
  };
  const failures = failureMessages(checks);

  return {
    schemaVersion: "1.0",
    datasetLabel: manifest.dataset.label,
    passed: failures.length === 0,
    thresholds: SWIM_ACCEPTANCE_THRESHOLDS,
    observed: {
      totalCaseCount: cases.length,
      referenceValidClipCount: validCases.length,
      referenceInvalidClipCount: invalidCases.length,
      referenceValidByStroke: validByStroke,
      completeValidPredictionCount,
      exactStrokeCountMatches,
      exactStrokeCountRatePercent,
      cycleRateSampleCount: cycleRateErrors.length,
      cycleRateMaeCpm,
      averageSpeedSampleCount: averageSpeedPercentageErrors.length,
      averageSpeedMapePercent,
      gateSampleCount: gateFrameErrors.length,
      gateMedianErrorFrames,
      gateP90ErrorFrames,
      falseValidCount,
      falseValidRatePercent,
    },
    checks,
    failures,
  };
}

function displayNumber(
  value: number | null,
  fractionDigits: number,
  suffix = "",
): string {
  return value === null ? "未計測" : `${value.toFixed(fractionDigits)}${suffix}`;
}

/** Human-readable companion to the stable JSON result. */
export function formatSwimAcceptanceText(
  result: SwimAcceptanceResult,
): string {
  const observed = result.observed;
  const lines = [
    `Swim acceptance: ${result.passed ? "PASS" : "FAIL"}`,
    `Dataset: ${result.datasetLabel}`,
    `Cases: ${observed.totalCaseCount} total / ${observed.referenceValidClipCount} valid / ${observed.referenceInvalidClipCount} invalid`,
    `By stroke: freestyle ${observed.referenceValidByStroke.freestyle}, backstroke ${observed.referenceValidByStroke.backstroke}, breaststroke ${observed.referenceValidByStroke.breaststroke}, butterfly ${observed.referenceValidByStroke.butterfly}`,
    `Stroke exact: ${displayNumber(observed.exactStrokeCountRatePercent, 2, "%")}`,
    `Cycle-rate MAE: ${displayNumber(observed.cycleRateMaeCpm, 3, " cycles/min")}`,
    `Average-speed MAPE: ${displayNumber(observed.averageSpeedMapePercent, 3, "%")}`,
    `Gate error: median ${displayNumber(observed.gateMedianErrorFrames, 3, " frames")} / p90 ${displayNumber(observed.gateP90ErrorFrames, 3, " frames")}`,
    `False valid: ${displayNumber(observed.falseValidRatePercent, 3, "%")} (${observed.falseValidCount}/${observed.referenceInvalidClipCount})`,
    "Checks:",
    ...(Object.entries(result.checks) as Array<[string, boolean]>).map(
      ([name, passed]) => `  ${passed ? "PASS" : "FAIL"} ${name}`,
    ),
  ];
  if (result.failures.length > 0) {
    lines.push("Failures:", ...result.failures.map((message) => `  - ${message}`));
  }
  return lines.join("\n");
}
