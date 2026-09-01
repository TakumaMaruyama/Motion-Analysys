import type { Point2D } from "../../types/analysis";
import type {
  ResearchSexCategory,
  StartEventType,
  StartStrokeStyle,
} from "../../types/start";
import { validateStartCalibration } from "../start/calibration";

export const START_STROKES = [
  "freestyle",
  "butterfly",
  "breaststroke",
  "backstroke",
] as const satisfies readonly StartStrokeStyle[];

export const START_ANNOTATION_EVENTS = [
  "signal",
  "movement-onset",
  "hands-off",
  "rear-foot-off",
  "takeoff",
  "head-entry",
  "five-meter-head-crossing",
] as const satisfies readonly StartEventType[];

export type StartAnnotationValidity = "valid" | "invalid" | "unassessable";

export interface StartAnnotationEventV1 {
  readonly type: StartEventType;
  readonly frameIndex: number | null;
  readonly timestampMs: number | null;
  readonly point: Point2D | null;
}

export interface StartAnnotationCalibrationV1 {
  readonly zeroMeter: Point2D | null;
  readonly fiveMeter: Point2D | null;
  readonly waterSurface: readonly [Point2D | null, Point2D | null];
  readonly travelDirection: "left-to-right" | "right-to-left";
}

export interface StartAnnotationV1 {
  readonly schemaVersion: "1.0";
  readonly anonymousVideoId: string;
  readonly annotatorId: string;
  readonly validity: StartAnnotationValidity;
  readonly invalidReason: string | null;
  readonly athlete: {
    readonly strokeStyle: StartStrokeStyle;
    readonly age: number | null;
    readonly researchSexCategory: ResearchSexCategory | null;
  };
  readonly capture: {
    readonly fps: number | null;
    readonly durationMs: number | null;
    readonly fixedCamera: boolean;
    readonly sideOn: boolean;
    readonly singleSwimmer: boolean;
  };
  readonly calibration: StartAnnotationCalibrationV1 | null;
  readonly events: readonly StartAnnotationEventV1[] | null;
  readonly rightsCleared: true;
  readonly minorConsentConfirmed: true;
  readonly footageStoredOutsideRepository: true;
  readonly notes: string;
}

export class StartAnnotationValidationError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid Start annotation at ${path}: ${message}`);
    this.name = "StartAnnotationValidationError";
    this.path = path;
  }
}

type JsonObject = Record<string, unknown>;
const IDENTIFYING_FIELD = /(?:file|path|url|name|participant|athlete|swimmer|email|phone)/i;

function fail(path: string, message: string): never {
  throw new StartAnnotationValidationError(path, message);
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
    const reason = IDENTIFYING_FIELD.test(key)
      ? "forbidden identifying field"
      : "unknown field";
    fail(`${path}.${key}`, reason);
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

function finiteNullable(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite number or null");
  }
  return value;
}

function parsePoint(value: unknown, path: string, nullable = true): Point2D | null {
  if (value === null && nullable) return null;
  const point = objectAt(value, path);
  exactKeys(point, ["x", "y"], path);
  const x = finiteNullable(point.x, `${path}.x`);
  const y = finiteNullable(point.y, `${path}.y`);
  if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) {
    fail(path, "must contain normalized x/y values from 0 through 1");
  }
  return { x, y };
}

function parseEvent(value: unknown, index: number): StartAnnotationEventV1 {
  const path = `$.events[${index}]`;
  const event = objectAt(value, path);
  exactKeys(event, ["type", "frameIndex", "timestampMs", "point"], path);
  if (
    typeof event.type !== "string" ||
    !START_ANNOTATION_EVENTS.includes(event.type as StartEventType)
  ) {
    fail(`${path}.type`, "must be a supported Start event");
  }
  const frameIndex = finiteNullable(event.frameIndex, `${path}.frameIndex`);
  const timestampMs = finiteNullable(event.timestampMs, `${path}.timestampMs`);
  if (
    frameIndex !== null &&
    (!Number.isSafeInteger(frameIndex) || frameIndex < 0)
  ) {
    fail(`${path}.frameIndex`, "must be a non-negative integer or null");
  }
  if (timestampMs !== null && timestampMs < 0) {
    fail(`${path}.timestampMs`, "must be non-negative or null");
  }
  if ((frameIndex === null) !== (timestampMs === null)) {
    fail(path, "frameIndex and timestampMs must either both be present or both be null");
  }
  return {
    type: event.type as StartEventType,
    frameIndex,
    timestampMs,
    point: parsePoint(event.point, `${path}.point`),
  };
}

function eventTime(
  events: ReadonlyMap<StartEventType, StartAnnotationEventV1>,
  type: StartEventType,
): number | null {
  return events.get(type)?.timestampMs ?? null;
}

function requireOrdered(
  events: ReadonlyMap<StartEventType, StartAnnotationEventV1>,
  earlier: StartEventType,
  later: StartEventType,
): void {
  const earlierTime = eventTime(events, earlier);
  const laterTime = eventTime(events, later);
  if (earlierTime !== null && laterTime !== null && earlierTime > laterTime) {
    fail("$.events", `${earlier} must not occur after ${later}`);
  }
}

function parseCalibration(
  value: unknown,
  validity: StartAnnotationValidity,
): StartAnnotationCalibrationV1 | null {
  if (value === null) {
    if (validity === "valid") fail("$.calibration", "is required for a valid annotation");
    return null;
  }
  const calibration = objectAt(value, "$.calibration");
  exactKeys(
    calibration,
    ["zeroMeter", "fiveMeter", "waterSurface", "travelDirection"],
    "$.calibration",
  );
  const rawWaterSurface = Array.isArray(calibration.waterSurface)
    ? calibration.waterSurface
    : fail("$.calibration.waterSurface", "must contain exactly two points");
  if (rawWaterSurface.length !== 2) {
    fail("$.calibration.waterSurface", "must contain exactly two points");
  }
  if (
    calibration.travelDirection !== "left-to-right" &&
    calibration.travelDirection !== "right-to-left"
  ) {
    fail("$.calibration.travelDirection", "must be left-to-right or right-to-left");
  }
  const parsed: StartAnnotationCalibrationV1 = {
    zeroMeter: parsePoint(calibration.zeroMeter, "$.calibration.zeroMeter"),
    fiveMeter: parsePoint(calibration.fiveMeter, "$.calibration.fiveMeter"),
    waterSurface: [
      parsePoint(rawWaterSurface[0], "$.calibration.waterSurface[0]"),
      parsePoint(rawWaterSurface[1], "$.calibration.waterSurface[1]"),
    ],
    travelDirection: calibration.travelDirection,
  };
  if (
    validity === "valid" &&
    (!parsed.zeroMeter ||
      !parsed.fiveMeter ||
      !parsed.waterSurface[0] ||
      !parsed.waterSurface[1])
  ) {
    fail("$.calibration", "all calibration points are required for a valid annotation");
  }
  if (validity === "valid") {
    // 注釈用JSONは画像寸法を保持しないため、正規化座標系(1×1)で本体と同じ
    // 幾何検査を行う。これにより0m/5mの左右関係と水面直線の退化を防ぐ。
    try {
      validateStartCalibration({
        schemaVersion: "1.0",
        imageWidth: 1,
        imageHeight: 1,
        zeroMeter: parsed.zeroMeter!,
        fiveMeter: parsed.fiveMeter!,
        waterSurface: [parsed.waterSurface[0]!, parsed.waterSurface[1]!],
        travelDirection: parsed.travelDirection,
      });
    } catch (error) {
      fail(
        "$.calibration",
        error instanceof Error ? error.message : "is geometrically invalid",
      );
    }
  }
  return parsed;
}

function parseEvents(
  value: unknown,
  validity: StartAnnotationValidity,
  strokeStyle: StartStrokeStyle,
): readonly StartAnnotationEventV1[] | null {
  if (value === null) {
    if (validity === "valid") fail("$.events", "are required for a valid annotation");
    return null;
  }
  const rawEvents = Array.isArray(value)
    ? value
    : fail("$.events", "must be an array or null");
  if (rawEvents.length !== START_ANNOTATION_EVENTS.length) {
    fail("$.events", "must contain every Start event exactly once");
  }
  const events = rawEvents.map(parseEvent);
  const byType = new Map<StartEventType, StartAnnotationEventV1>();
  for (const event of events) {
    if (byType.has(event.type)) fail("$.events", `contains duplicate ${event.type}`);
    byType.set(event.type, event);
  }
  for (const type of START_ANNOTATION_EVENTS) {
    if (!byType.has(type)) fail("$.events", `is missing ${type}`);
  }
  if (validity !== "valid") return events;

  const required: StartEventType[] = [
    "signal",
    "movement-onset",
    "hands-off",
    "takeoff",
    "head-entry",
  ];
  if (strokeStyle !== "backstroke") required.push("rear-foot-off");
  for (const type of required) {
    if (eventTime(byType, type) === null) {
      fail("$.events", `${type} is required for a valid ${strokeStyle} annotation`);
    }
  }
  const rearFootOff = byType.get("rear-foot-off");
  if (
    strokeStyle === "backstroke" &&
    (rearFootOff?.frameIndex !== null || rearFootOff.timestampMs !== null || rearFootOff.point !== null)
  ) {
    fail("$.events", "rear-foot-off must be null for backstroke");
  }
  if (!byType.get("head-entry")?.point) {
    fail("$.events", "head-entry requires a normalized point for a valid annotation");
  }
  requireOrdered(byType, "signal", "movement-onset");
  requireOrdered(byType, "movement-onset", "hands-off");
  if (strokeStyle !== "backstroke") {
    requireOrdered(byType, "movement-onset", "rear-foot-off");
    requireOrdered(byType, "rear-foot-off", "takeoff");
  }
  requireOrdered(byType, "hands-off", "takeoff");
  requireOrdered(byType, "takeoff", "head-entry");
  requireOrdered(byType, "head-entry", "five-meter-head-crossing");
  return events;
}

export function parseStartAnnotationV1(value: unknown): StartAnnotationV1 {
  const root = objectAt(value, "$");
  exactKeys(
    root,
    [
      "schemaVersion",
      "anonymousVideoId",
      "annotatorId",
      "validity",
      "invalidReason",
      "athlete",
      "capture",
      "calibration",
      "events",
      "rightsCleared",
      "minorConsentConfirmed",
      "footageStoredOutsideRepository",
      "notes",
    ],
    "$",
  );
  if (root.schemaVersion !== "1.0") fail("$.schemaVersion", "must be 1.0");
  const validity =
    root.validity === "valid" ||
    root.validity === "invalid" ||
    root.validity === "unassessable"
      ? root.validity
      : fail("$.validity", "must be valid, invalid, or unassessable");
  const invalidReason =
    root.invalidReason === null
      ? null
      : nonEmptyString(root.invalidReason, "$.invalidReason");
  if (validity === "valid" && invalidReason !== null) {
    fail("$.invalidReason", "must be null for a valid annotation");
  }
  if (validity !== "valid" && invalidReason === null) {
    fail("$.invalidReason", "is required when an annotation is not valid");
  }

  const athlete = objectAt(root.athlete, "$.athlete");
  exactKeys(athlete, ["strokeStyle", "age", "researchSexCategory"], "$.athlete");
  if (
    typeof athlete.strokeStyle !== "string" ||
    !START_STROKES.includes(athlete.strokeStyle as StartStrokeStyle)
  ) {
    fail("$.athlete.strokeStyle", "must be a supported stroke");
  }
  const age = finiteNullable(athlete.age, "$.athlete.age");
  if (age !== null && (!Number.isSafeInteger(age) || age < 13)) {
    fail("$.athlete.age", "must be an integer of at least 13 or null");
  }
  const researchSexCategory =
    athlete.researchSexCategory === null ||
    athlete.researchSexCategory === "male" ||
    athlete.researchSexCategory === "female"
      ? athlete.researchSexCategory
      : fail("$.athlete.researchSexCategory", "must be male, female, or null");

  const capture = objectAt(root.capture, "$.capture");
  exactKeys(
    capture,
    ["fps", "durationMs", "fixedCamera", "sideOn", "singleSwimmer"],
    "$.capture",
  );
  const fps = finiteNullable(capture.fps, "$.capture.fps");
  const durationMs = finiteNullable(capture.durationMs, "$.capture.durationMs");
  if (fps !== null && fps <= 0) fail("$.capture.fps", "must be positive or null");
  if (durationMs !== null && durationMs < 0) {
    fail("$.capture.durationMs", "must be non-negative or null");
  }
  for (const key of ["fixedCamera", "sideOn", "singleSwimmer"] as const) {
    if (typeof capture[key] !== "boolean") fail(`$.capture.${key}`, "must be boolean");
  }
  if (
    validity === "valid" &&
    (fps === null ||
      fps < 60 ||
      capture.fixedCamera !== true ||
      capture.sideOn !== true ||
      capture.singleSwimmer !== true)
  ) {
    fail(
      "$.capture",
      "a valid annotation requires at least 60 fps, a fixed side-on camera, and one swimmer",
    );
  }

  if (
    root.rightsCleared !== true ||
    root.minorConsentConfirmed !== true ||
    root.footageStoredOutsideRepository !== true
  ) {
    fail(
      "$",
      "rights, minor consent, and external-footage declarations must all be true",
    );
  }
  if (typeof root.notes !== "string") fail("$.notes", "must be a string");

  const strokeStyle = athlete.strokeStyle as StartStrokeStyle;
  return {
    schemaVersion: "1.0",
    anonymousVideoId: nonEmptyString(root.anonymousVideoId, "$.anonymousVideoId"),
    annotatorId: nonEmptyString(root.annotatorId, "$.annotatorId"),
    validity,
    invalidReason,
    athlete: { strokeStyle, age, researchSexCategory },
    capture: {
      fps,
      durationMs,
      fixedCamera: capture.fixedCamera as boolean,
      sideOn: capture.sideOn as boolean,
      singleSwimmer: capture.singleSwimmer as boolean,
    },
    calibration: parseCalibration(root.calibration, validity),
    events: parseEvents(root.events, validity, strokeStyle),
    rightsCleared: true,
    minorConsentConfirmed: true,
    footageStoredOutsideRepository: true,
    notes: root.notes,
  };
}

export function exportStartAnnotationJson(
  value: unknown,
  options: { readonly pretty?: boolean } = {},
): string {
  const annotation = parseStartAnnotationV1(value);
  return `${JSON.stringify(annotation, null, options.pretty === false ? undefined : 2)}\n`;
}
