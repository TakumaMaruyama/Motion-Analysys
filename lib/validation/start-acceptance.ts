const START_STROKES = [
  "freestyle",
  "butterfly",
  "breaststroke",
  "backstroke",
] as const;

export const START_ACCEPTANCE_THRESHOLDS = {
  minimumReferenceClipCount: 80,
  minimumReferenceClipsPerStroke: 20,
  maximumFrameMedianError120: 1,
  maximumFrameP90Error120: 2,
  maximumFrameMedianError60: 2,
  maximumFrameP90Error60: 4,
  maximumEntryDistanceMaeMeters: 0.25,
  maximumVelocityMapePercent: 5,
  maximumFalseValidRatePercentExclusive: 5,
} as const;

type StartStroke = (typeof START_STROKES)[number];
type PredictionStatus = "valid" | "needs-review" | "unavailable";

interface StartAcceptanceMeasurements {
  readonly takeoffFrame: number | null;
  readonly headEntryFrame: number | null;
  readonly entryDistanceM: number | null;
  readonly forwardVelocityMps: number | null;
}

export interface StartAcceptanceCase {
  readonly id: string;
  readonly strokeStyle: StartStroke;
  readonly fps: number;
  readonly validity: "valid" | "invalid";
  readonly reference: StartAcceptanceMeasurements;
  readonly prediction: StartAcceptanceMeasurements & {
    readonly status: PredictionStatus;
  };
}

export interface StartAcceptanceManifestV1 {
  readonly schemaVersion: "1.0";
  readonly dataset: {
    readonly label: string;
    readonly rightsCleared: true;
    readonly minorConsentConfirmed: true;
    readonly footageStoredOutsideRepository: true;
  };
  readonly labeling: {
    readonly coachIds: readonly [string, string];
    readonly adjudicationMethod: string;
  };
  readonly cases: readonly StartAcceptanceCase[];
}

export type StartAcceptanceCheck =
  | "minimumReferenceClipCount"
  | "minimumReferenceClipsPerStroke"
  | "frameErrors"
  | "entryDistanceMae"
  | "velocityMape"
  | "falseValidRate";

export interface StartAcceptanceResult {
  readonly schemaVersion: "1.0";
  readonly datasetLabel: string;
  readonly passed: boolean;
  readonly thresholds: typeof START_ACCEPTANCE_THRESHOLDS;
  readonly observed: {
    readonly totalCaseCount: number;
    readonly validCaseCount: number;
    readonly invalidCaseCount: number;
    readonly validByStroke: Record<StartStroke, number>;
    readonly frameMedianError120: number | null;
    readonly frameP90Error120: number | null;
    readonly frameMedianError60: number | null;
    readonly frameP90Error60: number | null;
    readonly entryDistanceMaeMeters: number | null;
    readonly velocityMapePercent: number | null;
    readonly falseValidRatePercent: number | null;
  };
  readonly checks: Record<StartAcceptanceCheck, boolean>;
  readonly failures: readonly StartAcceptanceCheck[];
}

export class StartAcceptanceManifestError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid Start acceptance manifest at ${path}: ${message}`);
    this.name = "StartAcceptanceManifestError";
    this.path = path;
  }
}

type JsonObject = Record<string, unknown>;
const IDENTIFYING_FIELD = /(?:file|path|url|name|participant|athlete|swimmer|email|phone)/i;

function fail(path: string, message: string): never {
  throw new StartAcceptanceManifestError(path, message);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (allowedSet.has(key)) continue;
    fail(
      `${path}.${key}`,
      IDENTIFYING_FIELD.test(key) ? "identifying fields are forbidden" : "unknown field",
    );
  }
  for (const key of allowed) {
    if (!(key in value)) fail(`${path}.${key}`, "is required");
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "must be a non-empty string");
  }
  return value.trim();
}

function finiteNumber(value: unknown, path: string, nullable = false): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, nullable ? "must be a finite number or null" : "must be a finite number");
  }
  return value;
}

function frame(value: unknown, path: string): number | null {
  const parsed = finiteNumber(value, path, true);
  if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed < 0)) {
    fail(path, "must be a non-negative integer or null");
  }
  return parsed;
}

function nonNegativeNullable(value: unknown, path: string): number | null {
  const parsed = finiteNumber(value, path, true);
  if (parsed !== null && parsed < 0) fail(path, "must be non-negative or null");
  return parsed;
}

function measurements(value: unknown, path: string): StartAcceptanceMeasurements {
  const source = objectAt(value, path);
  exactKeys(
    source,
    ["takeoffFrame", "headEntryFrame", "entryDistanceM", "forwardVelocityMps"],
    path,
  );
  return {
    takeoffFrame: frame(source.takeoffFrame, `${path}.takeoffFrame`),
    headEntryFrame: frame(source.headEntryFrame, `${path}.headEntryFrame`),
    entryDistanceM: nonNegativeNullable(source.entryDistanceM, `${path}.entryDistanceM`),
    forwardVelocityMps: nonNegativeNullable(
      source.forwardVelocityMps,
      `${path}.forwardVelocityMps`,
    ),
  };
}

function parseCase(
  value: unknown,
  index: number,
  seenIds: Set<string>,
): StartAcceptanceCase {
  const path = `$.cases[${index}]`;
  const source = objectAt(value, path);
  exactKeys(
    source,
    ["id", "strokeStyle", "fps", "validity", "reference", "prediction"],
    path,
  );
  const id = nonEmptyString(source.id, `${path}.id`);
  if (seenIds.has(id)) fail(`${path}.id`, "must be unique");
  seenIds.add(id);
  if (
    typeof source.strokeStyle !== "string" ||
    !START_STROKES.includes(source.strokeStyle as StartStroke)
  ) {
    fail(`${path}.strokeStyle`, "must be a supported stroke");
  }
  const fps = finiteNumber(source.fps, `${path}.fps`);
  if (fps === null || fps < 60) fail(`${path}.fps`, "must be at least 60");
  const validity =
    source.validity === "valid" || source.validity === "invalid"
      ? source.validity
      : fail(`${path}.validity`, "must be valid or invalid");
  const reference = measurements(source.reference, `${path}.reference`);
  const predictionSource = objectAt(source.prediction, `${path}.prediction`);
  exactKeys(
    predictionSource,
    ["status", "takeoffFrame", "headEntryFrame", "entryDistanceM", "forwardVelocityMps"],
    `${path}.prediction`,
  );
  const status: PredictionStatus =
    predictionSource.status === "valid" ||
    predictionSource.status === "needs-review" ||
    predictionSource.status === "unavailable"
      ? predictionSource.status
      : fail(`${path}.prediction.status`, "must be valid, needs-review, or unavailable");
  const prediction = measurements(
    {
      takeoffFrame: predictionSource.takeoffFrame,
      headEntryFrame: predictionSource.headEntryFrame,
      entryDistanceM: predictionSource.entryDistanceM,
      forwardVelocityMps: predictionSource.forwardVelocityMps,
    },
    `${path}.predictionMeasurements`,
  );
  if (validity === "valid" && status !== "valid") {
    fail(
      `${path}.prediction.status`,
      "must be valid for a valid reference case; needs-review and unavailable predictions cannot count toward acceptance coverage",
    );
  }
  if (
    validity === "valid" &&
    (reference.takeoffFrame === null ||
      reference.headEntryFrame === null ||
      reference.entryDistanceM === null ||
      reference.forwardVelocityMps === null ||
      reference.forwardVelocityMps <= 0)
  ) {
    fail(
      `${path}.reference`,
      "a valid case requires event frames, entry distance, and positive forward velocity",
    );
  }
  if (
    validity === "valid" &&
    (prediction.takeoffFrame === null ||
      prediction.headEntryFrame === null ||
      prediction.entryDistanceM === null ||
      prediction.forwardVelocityMps === null ||
      prediction.forwardVelocityMps <= 0)
  ) {
    fail(
      `${path}.prediction`,
      "a valid prediction requires event frames, entry distance, and positive forward velocity",
    );
  }
  return {
    id,
    strokeStyle: source.strokeStyle as StartStroke,
    fps,
    validity,
    reference,
    prediction: { ...prediction, status },
  };
}

export function parseStartAcceptanceManifest(value: unknown): StartAcceptanceManifestV1 {
  const root = objectAt(value, "$");
  exactKeys(root, ["schemaVersion", "dataset", "labeling", "cases"], "$");
  if (root.schemaVersion !== "1.0") fail("$.schemaVersion", "must be 1.0");

  const dataset = objectAt(root.dataset, "$.dataset");
  exactKeys(
    dataset,
    ["label", "rightsCleared", "minorConsentConfirmed", "footageStoredOutsideRepository"],
    "$.dataset",
  );
  if (
    dataset.rightsCleared !== true ||
    dataset.minorConsentConfirmed !== true ||
    dataset.footageStoredOutsideRepository !== true
  ) {
    fail(
      "$.dataset",
      "rights, minor consent, and external-footage declarations must all be true",
    );
  }

  const labeling = objectAt(root.labeling, "$.labeling");
  exactKeys(labeling, ["coachIds", "adjudicationMethod"], "$.labeling");
  const coachIds = Array.isArray(labeling.coachIds)
    ? labeling.coachIds.map((entry, index) =>
        nonEmptyString(entry, `$.labeling.coachIds[${index}]`),
      )
    : fail("$.labeling.coachIds", "must contain two anonymous IDs");
  if (coachIds.length !== 2 || coachIds[0] === coachIds[1]) {
    fail("$.labeling.coachIds", "must contain two distinct anonymous coach IDs");
  }

  const rawCases = Array.isArray(root.cases)
    ? root.cases
    : fail("$.cases", "must be an array");
  const seenIds = new Set<string>();
  const cases = rawCases.map((entry, index) => parseCase(entry, index, seenIds));
  return {
    schemaVersion: "1.0",
    dataset: {
      label: nonEmptyString(dataset.label, "$.dataset.label"),
      rightsCleared: true,
      minorConsentConfirmed: true,
      footageStoredOutsideRepository: true,
    },
    labeling: {
      coachIds: [coachIds[0], coachIds[1]],
      adjudicationMethod: nonEmptyString(
        labeling.adjudicationMethod,
        "$.labeling.adjudicationMethod",
      ),
    },
    cases,
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function within(value: number | null, maximum: number): boolean {
  return value !== null && value <= maximum;
}

export function evaluateStartAcceptance(value: unknown): StartAcceptanceResult {
  const manifest = parseStartAcceptanceManifest(value);
  const validCases = manifest.cases.filter((entry) => entry.validity === "valid");
  const invalidCases = manifest.cases.filter((entry) => entry.validity === "invalid");
  const validByStroke = Object.fromEntries(
    START_STROKES.map((stroke) => [
      stroke,
      validCases.filter((entry) => entry.strokeStyle === stroke).length,
    ]),
  ) as Record<StartStroke, number>;

  const frameErrors120: number[] = [];
  const frameErrors60: number[] = [];
  const distanceErrors: number[] = [];
  const velocityPercentageErrors: number[] = [];
  for (const entry of validCases) {
    const frameErrors = [
      entry.prediction.takeoffFrame !== null && entry.reference.takeoffFrame !== null
        ? Math.abs(entry.prediction.takeoffFrame - entry.reference.takeoffFrame)
        : null,
      entry.prediction.headEntryFrame !== null && entry.reference.headEntryFrame !== null
        ? Math.abs(entry.prediction.headEntryFrame - entry.reference.headEntryFrame)
        : null,
    ].filter((error): error is number => error !== null);
    // 120fps基準は実際に120fps以上の動画だけ。60〜119.999fpsは60fps群で評価する。
    (entry.fps >= 120 ? frameErrors120 : frameErrors60).push(...frameErrors);
    if (
      entry.prediction.entryDistanceM !== null &&
      entry.reference.entryDistanceM !== null
    ) {
      distanceErrors.push(
        Math.abs(entry.prediction.entryDistanceM - entry.reference.entryDistanceM),
      );
    }
    if (
      entry.prediction.forwardVelocityMps !== null &&
      entry.reference.forwardVelocityMps !== null &&
      entry.reference.forwardVelocityMps > 0
    ) {
      velocityPercentageErrors.push(
        (Math.abs(
          entry.prediction.forwardVelocityMps - entry.reference.forwardVelocityMps,
        ) /
          entry.reference.forwardVelocityMps) *
          100,
      );
    }
  }

  const observed: StartAcceptanceResult["observed"] = {
    totalCaseCount: manifest.cases.length,
    validCaseCount: validCases.length,
    invalidCaseCount: invalidCases.length,
    validByStroke,
    frameMedianError120: quantile(frameErrors120, 0.5),
    frameP90Error120: quantile(frameErrors120, 0.9),
    frameMedianError60: quantile(frameErrors60, 0.5),
    frameP90Error60: quantile(frameErrors60, 0.9),
    entryDistanceMaeMeters: mean(distanceErrors),
    velocityMapePercent: mean(velocityPercentageErrors),
    falseValidRatePercent:
      invalidCases.length === 0
        ? null
        : (invalidCases.filter((entry) => entry.prediction.status === "valid").length /
            invalidCases.length) *
          100,
  };
  const checks: StartAcceptanceResult["checks"] = {
    minimumReferenceClipCount:
      validCases.length >= START_ACCEPTANCE_THRESHOLDS.minimumReferenceClipCount,
    minimumReferenceClipsPerStroke: START_STROKES.every(
      (stroke) =>
        validByStroke[stroke] >=
        START_ACCEPTANCE_THRESHOLDS.minimumReferenceClipsPerStroke,
    ),
    frameErrors:
      frameErrors120.length === validCases.filter((entry) => entry.fps >= 120).length * 2 &&
      frameErrors60.length === validCases.filter((entry) => entry.fps < 120).length * 2 &&
      frameErrors120.length > 0 &&
      frameErrors60.length > 0 &&
      within(
        observed.frameMedianError120,
        START_ACCEPTANCE_THRESHOLDS.maximumFrameMedianError120,
      ) &&
      within(
        observed.frameP90Error120,
        START_ACCEPTANCE_THRESHOLDS.maximumFrameP90Error120,
      ) &&
      within(
        observed.frameMedianError60,
        START_ACCEPTANCE_THRESHOLDS.maximumFrameMedianError60,
      ) &&
      within(
        observed.frameP90Error60,
        START_ACCEPTANCE_THRESHOLDS.maximumFrameP90Error60,
      ),
    entryDistanceMae:
      distanceErrors.length === validCases.length &&
      within(
        observed.entryDistanceMaeMeters,
        START_ACCEPTANCE_THRESHOLDS.maximumEntryDistanceMaeMeters,
      ),
    velocityMape:
      velocityPercentageErrors.length === validCases.length &&
      within(
        observed.velocityMapePercent,
        START_ACCEPTANCE_THRESHOLDS.maximumVelocityMapePercent,
      ),
    falseValidRate:
      observed.falseValidRatePercent !== null &&
      observed.falseValidRatePercent <
        START_ACCEPTANCE_THRESHOLDS.maximumFalseValidRatePercentExclusive,
  };
  const failures = (Object.keys(checks) as StartAcceptanceCheck[]).filter(
    (check) => !checks[check],
  );
  return {
    schemaVersion: "1.0",
    datasetLabel: manifest.dataset.label,
    passed: failures.length === 0,
    thresholds: START_ACCEPTANCE_THRESHOLDS,
    observed,
    checks,
    failures,
  };
}

export function formatStartAcceptanceText(result: StartAcceptanceResult): string {
  return [
    `Start acceptance: ${result.passed ? "PASS" : "FAIL"}`,
    `Cases: ${result.observed.totalCaseCount} total / ${result.observed.validCaseCount} valid / ${result.observed.invalidCaseCount} invalid`,
    `Frame 120fps median/p90: ${result.observed.frameMedianError120 ?? "n/a"}/${result.observed.frameP90Error120 ?? "n/a"}`,
    `Frame 60fps median/p90: ${result.observed.frameMedianError60 ?? "n/a"}/${result.observed.frameP90Error60 ?? "n/a"}`,
    `Entry distance MAE: ${result.observed.entryDistanceMaeMeters ?? "n/a"}m`,
    `Forward velocity MAPE: ${result.observed.velocityMapePercent ?? "n/a"}%`,
    `False-valid rate: ${result.observed.falseValidRatePercent ?? "n/a"}%`,
    ...result.failures.map((failure) => `FAIL ${failure}`),
  ].join("\n");
}
