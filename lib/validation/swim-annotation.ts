export const SWIM_ANNOTATION_SCHEMA_VERSION = "1.0" as const;

export const SWIM_ANNOTATION_STROKE_STYLES = [
  "freestyle",
  "backstroke",
  "breaststroke",
  "butterfly",
] as const;

export type SwimAnnotationStrokeStyle =
  (typeof SWIM_ANNOTATION_STROKE_STYLES)[number];

export type SwimAnnotationValidity = "valid" | "invalid";

export interface SwimAnnotationSourceV1 {
  readonly fps: number;
  readonly frameCount: number;
}

/** A source-frame reference that remains exact for variable frame-rate video. */
export interface SwimAnnotationFramePointV1 {
  readonly frameIndex: number;
  readonly timestampMs: number;
}

export interface SwimAnnotationGateCrossingsV1 {
  readonly first: SwimAnnotationFramePointV1;
  readonly second: SwimAnnotationFramePointV1;
}

/**
 * The three booleans map directly to SwimAcceptanceCase.capture. Tags are
 * local, non-identifying quality labels such as "splash-obscured".
 */
export interface SwimAnnotationConditionsV1 {
  readonly fixedCamera: boolean;
  readonly sideOn: boolean;
  readonly singleSwimmer: boolean;
  readonly tags: readonly string[];
}

interface SwimAnnotationExportV1Base {
  readonly schemaVersion: typeof SWIM_ANNOTATION_SCHEMA_VERSION;
  /** Opaque ID generated independently of the local source filename. */
  readonly anonymousVideoId: string;
  readonly strokeStyle: SwimAnnotationStrokeStyle;
  readonly source: SwimAnnotationSourceV1;
  readonly annotatorLabel: string;
  readonly conditions: SwimAnnotationConditionsV1;
  readonly notes: string;
}

export interface SwimValidAnnotationExportV1
  extends SwimAnnotationExportV1Base {
  readonly validity: "valid";
  readonly distanceMeters: number;
  readonly gateCrossings: SwimAnnotationGateCrossingsV1;
  readonly strokeEvents: readonly SwimAnnotationFramePointV1[];
  readonly invalidReason: null;
}

export interface SwimInvalidAnnotationExportV1
  extends SwimAnnotationExportV1Base {
  readonly validity: "invalid";
  readonly distanceMeters: number | null;
  readonly gateCrossings: SwimAnnotationGateCrossingsV1 | null;
  readonly strokeEvents: readonly SwimAnnotationFramePointV1[] | null;
  readonly invalidReason: string;
}

/**
 * A local coach annotation that deliberately excludes filenames and paths.
 * Invalid clips preserve unknown values as null instead of numeric sentinels.
 */
export type SwimAnnotationExportV1 =
  | SwimValidAnnotationExportV1
  | SwimInvalidAnnotationExportV1;

export interface SwimAnnotationJsonExportOptions {
  readonly pretty?: boolean;
}

export class SwimAnnotationValidationError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid swim annotation at ${path}: ${message}`);
    this.name = "SwimAnnotationValidationError";
    this.path = path;
  }
}

type JsonObject = Record<string, unknown>;

const ROOT_KEYS = [
  "schemaVersion",
  "anonymousVideoId",
  "strokeStyle",
  "validity",
  "source",
  "distanceMeters",
  "gateCrossings",
  "strokeEvents",
  "annotatorLabel",
  "invalidReason",
  "conditions",
  "notes",
] as const;

const SOURCE_KEYS = ["fps", "frameCount"] as const;
const FRAME_POINT_KEYS = ["frameIndex", "timestampMs"] as const;
const GATE_KEYS = ["first", "second"] as const;
const CONDITION_KEYS = [
  "fixedCamera",
  "sideOn",
  "singleSwimmer",
  "tags",
] as const;

const FORBIDDEN_FILE_FIELD =
  /^(?:file(?:name|path|url)|video(?:file)?(?:name|path|url)|inputName|sourceFile)$/i;

function fail(path: string, message: string): never {
  throw new SwimAnnotationValidationError(path, message);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as JsonObject;
}

function assertOnlyKeys(
  value: JsonObject,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FILE_FIELD.test(key)) {
      fail(
        `${path}.${key}`,
        "identifying filename, file path, and file URL fields are forbidden",
      );
    }
    if (!allowed.has(key)) {
      fail(`${path}.${key}`, "is not part of the V1 annotation schema");
    }
  }
}

function finitePositiveNumber(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    fail(path, "must be a finite number greater than 0");
  }
  return value;
}

function finiteNonNegativeNumber(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail(path, "must be a finite number greater than or equal to 0");
  }
  return value;
}

function frameIndex(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail(path, "must be a safe integer greater than or equal to 0");
  }
  return value;
}

function positiveFrameCount(value: unknown, path: string): number {
  const parsed = frameIndex(value, path);
  if (parsed === 0) {
    fail(path, "must be greater than 0");
  }
  return parsed;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "must be a boolean");
  }
  return value;
}

function stringAt(
  value: unknown,
  path: string,
  options: { readonly allowEmpty: boolean; readonly maximumLength: number },
): string {
  if (typeof value !== "string") {
    fail(path, "must be a string");
  }
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!options.allowEmpty && normalized.length === 0) {
    fail(path, "must be a non-empty string");
  }
  if (normalized.length > options.maximumLength) {
    fail(path, `must be ${options.maximumLength} characters or fewer`);
  }
  return normalized;
}

function nullablePositiveNumber(
  value: unknown,
  path: string,
): number | null {
  return value === null ? null : finitePositiveNumber(value, path);
}

function anonymousVideoId(value: unknown, path: string): string {
  const parsed = stringAt(value, path, {
    allowEmpty: false,
    maximumLength: 64,
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(parsed)) {
    fail(
      path,
      "must be an opaque 3-64 character ID using only letters, numbers, _ or -; never use a filename",
    );
  }
  return parsed;
}

function parseStrokeStyle(
  value: unknown,
  path: string,
): SwimAnnotationStrokeStyle {
  if (
    typeof value !== "string" ||
    !SWIM_ANNOTATION_STROKE_STYLES.includes(
      value as SwimAnnotationStrokeStyle,
    )
  ) {
    fail(
      path,
      `must be one of: ${SWIM_ANNOTATION_STROKE_STYLES.join(", ")}`,
    );
  }
  return value as SwimAnnotationStrokeStyle;
}

function parseValidity(
  value: unknown,
  path: string,
): SwimAnnotationValidity {
  if (value !== "valid" && value !== "invalid") {
    fail(path, "must be one of: valid, invalid");
  }
  return value;
}

function parseSource(
  value: unknown,
  path: string,
): SwimAnnotationSourceV1 {
  const object = objectAt(value, path);
  assertOnlyKeys(object, SOURCE_KEYS, path);
  return {
    fps: finitePositiveNumber(object.fps, `${path}.fps`),
    frameCount: positiveFrameCount(
      object.frameCount,
      `${path}.frameCount`,
    ),
  };
}

function parseFramePoint(
  value: unknown,
  frameCount: number,
  path: string,
): SwimAnnotationFramePointV1 {
  const object = objectAt(value, path);
  assertOnlyKeys(object, FRAME_POINT_KEYS, path);
  const parsedFrameIndex = frameIndex(
    object.frameIndex,
    `${path}.frameIndex`,
  );
  if (parsedFrameIndex >= frameCount) {
    fail(`${path}.frameIndex`, "must be within source.frameCount");
  }
  return {
    frameIndex: parsedFrameIndex,
    timestampMs: finiteNonNegativeNumber(
      object.timestampMs,
      `${path}.timestampMs`,
    ),
  };
}

function parseGateCrossings(
  value: unknown,
  frameCount: number,
  path: string,
): SwimAnnotationGateCrossingsV1 {
  const object = objectAt(value, path);
  assertOnlyKeys(object, GATE_KEYS, path);
  const first = parseFramePoint(
    object.first,
    frameCount,
    `${path}.first`,
  );
  const second = parseFramePoint(
    object.second,
    frameCount,
    `${path}.second`,
  );
  if (second.frameIndex <= first.frameIndex) {
    fail(`${path}.second.frameIndex`, "must be after first.frameIndex");
  }
  if (second.timestampMs <= first.timestampMs) {
    fail(
      `${path}.second.timestampMs`,
      "must be after first.timestampMs",
    );
  }
  return { first, second };
}

function nullableGateCrossings(
  value: unknown,
  frameCount: number,
  path: string,
): SwimAnnotationGateCrossingsV1 | null {
  return value === null
    ? null
    : parseGateCrossings(value, frameCount, path);
}

function parseStrokeEvents(
  value: unknown,
  frameCount: number,
  path: string,
): readonly SwimAnnotationFramePointV1[] {
  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }
  const events = value.map((entry, index) =>
    parseFramePoint(entry, frameCount, `${path}[${index}]`),
  );
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].frameIndex <= events[index - 1].frameIndex) {
      fail(path, "frameIndex values must be strictly increasing");
    }
    if (events[index].timestampMs <= events[index - 1].timestampMs) {
      fail(path, "timestampMs values must be strictly increasing");
    }
  }
  return events;
}

function nullableStrokeEvents(
  value: unknown,
  frameCount: number,
  path: string,
): readonly SwimAnnotationFramePointV1[] | null {
  return value === null ? null : parseStrokeEvents(value, frameCount, path);
}

function validateValidEventRange(
  events: readonly SwimAnnotationFramePointV1[],
  gates: SwimAnnotationGateCrossingsV1,
): void {
  if (events.length === 0) {
    fail("$.strokeEvents", "valid annotations require at least one stroke event");
  }
  if (
    events.some(
      (event) =>
        event.frameIndex <= gates.first.frameIndex ||
        event.frameIndex > gates.second.frameIndex ||
        event.timestampMs <= gates.first.timestampMs ||
        event.timestampMs > gates.second.timestampMs,
    )
  ) {
    fail(
      "$.strokeEvents",
      "valid stroke events must be after the first gate and at or before the second gate",
    );
  }
}

function parseConditions(
  value: unknown,
  path: string,
): SwimAnnotationConditionsV1 {
  const object = objectAt(value, path);
  assertOnlyKeys(object, CONDITION_KEYS, path);
  if (!Array.isArray(object.tags)) {
    fail(`${path}.tags`, "must be an array");
  }
  const tags = object.tags.map((entry, index) =>
    stringAt(entry, `${path}.tags[${index}]`, {
      allowEmpty: false,
      maximumLength: 80,
    }),
  );
  if (new Set(tags).size !== tags.length) {
    fail(`${path}.tags`, "must not contain duplicate tags");
  }
  tags.sort((first, second) =>
    first < second ? -1 : first > second ? 1 : 0,
  );
  return {
    fixedCamera: booleanAt(
      object.fixedCamera,
      `${path}.fixedCamera`,
    ),
    sideOn: booleanAt(object.sideOn, `${path}.sideOn`),
    singleSwimmer: booleanAt(
      object.singleSwimmer,
      `${path}.singleSwimmer`,
    ),
    tags,
  };
}

function parseSharedFields(root: JsonObject): SwimAnnotationExportV1Base {
  return {
    schemaVersion: SWIM_ANNOTATION_SCHEMA_VERSION,
    anonymousVideoId: anonymousVideoId(
      root.anonymousVideoId,
      "$.anonymousVideoId",
    ),
    strokeStyle: parseStrokeStyle(root.strokeStyle, "$.strokeStyle"),
    source: parseSource(root.source, "$.source"),
    annotatorLabel: stringAt(
      root.annotatorLabel,
      "$.annotatorLabel",
      { allowEmpty: false, maximumLength: 100 },
    ),
    conditions: parseConditions(root.conditions, "$.conditions"),
    notes: stringAt(root.notes, "$.notes", {
      allowEmpty: true,
      maximumLength: 2_000,
    }),
  };
}

/**
 * Validates untrusted UI/import data and returns the normalized V1 shape.
 * Unknown fields are rejected so a local filename cannot leak into an export.
 */
export function parseSwimAnnotationV1(
  value: unknown,
): SwimAnnotationExportV1 {
  const root = objectAt(value, "$");
  assertOnlyKeys(root, ROOT_KEYS, "$");
  if (root.schemaVersion !== SWIM_ANNOTATION_SCHEMA_VERSION) {
    fail("$.schemaVersion", 'must equal "1.0"');
  }

  const validity = parseValidity(root.validity, "$.validity");
  const shared = parseSharedFields(root);
  const distanceMeters = nullablePositiveNumber(
    root.distanceMeters,
    "$.distanceMeters",
  );
  const gateCrossings = nullableGateCrossings(
    root.gateCrossings,
    shared.source.frameCount,
    "$.gateCrossings",
  );
  const strokeEvents = nullableStrokeEvents(
    root.strokeEvents,
    shared.source.frameCount,
    "$.strokeEvents",
  );

  if (validity === "valid") {
    if (distanceMeters === null) {
      fail("$.distanceMeters", "valid annotations require a known distance");
    }
    if (gateCrossings === null) {
      fail("$.gateCrossings", "valid annotations require two gate crossings");
    }
    if (strokeEvents === null) {
      fail("$.strokeEvents", "valid annotations require stroke events");
    }
    if (root.invalidReason !== null) {
      fail("$.invalidReason", "must be null for valid annotations");
    }
    validateValidEventRange(strokeEvents, gateCrossings);
    return {
      schemaVersion: shared.schemaVersion,
      anonymousVideoId: shared.anonymousVideoId,
      strokeStyle: shared.strokeStyle,
      validity,
      source: shared.source,
      distanceMeters,
      gateCrossings,
      strokeEvents,
      annotatorLabel: shared.annotatorLabel,
      invalidReason: null,
      conditions: shared.conditions,
      notes: shared.notes,
    };
  }

  const invalidReason = stringAt(
    root.invalidReason,
    "$.invalidReason",
    { allowEmpty: false, maximumLength: 500 },
  );
  return {
    schemaVersion: shared.schemaVersion,
    anonymousVideoId: shared.anonymousVideoId,
    strokeStyle: shared.strokeStyle,
    validity,
    source: shared.source,
    distanceMeters,
    gateCrossings,
    strokeEvents,
    annotatorLabel: shared.annotatorLabel,
    invalidReason,
    conditions: shared.conditions,
    notes: shared.notes,
  };
}

/**
 * Produces stable JSON with canonical key and condition-tag order. The default
 * pretty format is intended for coach review and checked validation artifacts.
 */
export function exportSwimAnnotationJson(
  value: unknown,
  options: SwimAnnotationJsonExportOptions = {},
): string {
  const annotation = parseSwimAnnotationV1(value);
  return JSON.stringify(
    annotation,
    undefined,
    options.pretty === false ? undefined : 2,
  );
}
