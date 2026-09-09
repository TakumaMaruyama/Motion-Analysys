import type { StartAnalysisResultV1 } from "../../types/start";
import { BORN_2026_REFERENCE_DATASET } from "./references";

type CsvCell = string | number | null;

export const START_CSV_HEADERS = [
  "record_type",
  "key",
  "value",
  "unit",
  "timestamp_ms",
  "frame_index",
  "status",
  "source",
] as const;

function safeCell(value: CsvCell): string {
  if (value === null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Start analysis CSV contains a non-finite number.");
    }
    return String(value);
  }
  const protectedValue = /^[\t\r ]*[=+\-@]/.test(value)
    ? `'${value}`
    : value;
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replace(/"/g, '""')}"`
    : protectedValue;
}

function finiteNumberReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Start analysis export contains a non-finite number.");
  }
  return value;
}

export function exportStartAnalysisJson(
  result: StartAnalysisResultV1,
  pretty = true,
): string {
  return JSON.stringify(result, finiteNumberReplacer, pretty ? 2 : undefined);
}

/** 再現に必要な入力・校正・イベント・品質・指標を決定論的なlong形式で出力する。 */
export function exportStartAnalysisCsv(result: StartAnalysisResultV1): string {
  const rows: CsvCell[][] = [[...START_CSV_HEADERS]];
  const add = (
    recordType: string,
    key: string,
    value: CsvCell,
    unit = "",
    timestampMs: number | null = null,
    frameIndex: number | null = null,
    status = "recorded",
    source = "result",
  ) => rows.push([
    recordType,
    key,
    value,
    unit,
    timestampMs,
    frameIndex,
    status,
    source,
  ]);

  add("analysis", "schema-version", result.schemaVersion);
  add("analysis", "analysis-mode", result.analysisMode);
  add("analysis", "travel-direction", result.travelDirection);
  add("athlete", "stroke-style", result.athlete.strokeStyle);
  add("athlete", "start-style", result.athlete.startStyle);
  add("athlete", "age", result.athlete.age, "years");
  add("athlete", "research-sex-category", result.athlete.researchSexCategory);

  add("video", "name", result.video.name);
  add("video", "mime-type", result.video.mimeType);
  add("video", "width", result.video.width, "px");
  add("video", "height", result.video.height, "px");
  add("video", "duration", result.video.durationMs, "ms");
  add("video", "effective-fps", result.video.effectiveFps, "fps");
  add("video", "fixed-camera", String(result.video.fixedCamera));
  add("video", "side-on", String(result.video.sideOn));
  add("video", "single-swimmer", String(result.video.singleSwimmer));

  if (result.calibration) {
    add("calibration", "schema-version", result.calibration.schemaVersion, "", null, null, "verified", "manual");
    add("calibration", "image-width", result.calibration.imageWidth, "px", null, null, "verified", "manual");
    add("calibration", "image-height", result.calibration.imageHeight, "px", null, null, "verified", "manual");
    add("calibration", "travel-direction", result.calibration.travelDirection, "", null, null, "verified", "manual");
    add("calibration", "zero-meter-x", result.calibration.zeroMeter.x, "normalized", null, null, "verified", "manual");
    add("calibration", "zero-meter-y", result.calibration.zeroMeter.y, "normalized", null, null, "verified", "manual");
    add("calibration", "five-meter-x", result.calibration.fiveMeter.x, "normalized", null, null, "verified", "manual");
    add("calibration", "five-meter-y", result.calibration.fiveMeter.y, "normalized", null, null, "verified", "manual");
    add("calibration", "water-surface-first-x", result.calibration.waterSurface[0].x, "normalized", null, null, "verified", "manual");
    add("calibration", "water-surface-first-y", result.calibration.waterSurface[0].y, "normalized", null, null, "verified", "manual");
    add("calibration", "water-surface-second-x", result.calibration.waterSurface[1].x, "normalized", null, null, "verified", "manual");
    add("calibration", "water-surface-second-y", result.calibration.waterSurface[1].y, "normalized", null, null, "verified", "manual");
  } else {
    add("calibration", "state", null, "", null, null, "unavailable", "manual");
  }

  add("quality", "status", result.quality.status, "", null, null, result.quality.status, "derived");
  result.quality.warnings.forEach((warning, index) =>
    add("quality-warning", String(index + 1), warning, "", null, null, result.quality.status, "derived"),
  );

  add("reference-dataset", "id", BORN_2026_REFERENCE_DATASET.id, "", null, null, BORN_2026_REFERENCE_DATASET.status, "static");
  add("reference-dataset", "citation", BORN_2026_REFERENCE_DATASET.source.citation, "", null, null, BORN_2026_REFERENCE_DATASET.status, "static");
  add("reference-dataset", "url", BORN_2026_REFERENCE_DATASET.source.url, "", null, null, BORN_2026_REFERENCE_DATASET.status, "static");
  add("reference-dataset", "doi", BORN_2026_REFERENCE_DATASET.source.doi, "", null, null, BORN_2026_REFERENCE_DATASET.status, "static");
  add("reference-dataset", "license", BORN_2026_REFERENCE_DATASET.source.license, "", null, null, BORN_2026_REFERENCE_DATASET.status, "static");
  add("reference-dataset", "note", BORN_2026_REFERENCE_DATASET.source.note, "", null, null, BORN_2026_REFERENCE_DATASET.status, "static");

  add("external-timing", "five-meter-stopwatch-time", result.externalTiming.fiveMeterTimeMs, "ms", null, null, result.externalTiming.fiveMeterTimeMs === null ? "unavailable" : "recorded-only", result.externalTiming.source);
  add("external-timing", "used-for-percentile", String(result.externalTiming.usedForPercentile), "", null, null, "recorded-only", result.externalTiming.source);
  add("external-timing", "note", result.externalTiming.note, "", null, null, "recorded-only", result.externalTiming.source);

  for (const event of result.events) {
    add("event", event.id, event.type, "", event.timestampMs, event.frameIndex, event.status, event.source);
    add("event-point", `${event.id}:x`, event.point?.x ?? null, "normalized", event.timestampMs, event.frameIndex, event.status, event.source);
    add("event-point", `${event.id}:y`, event.point?.y ?? null, "normalized", event.timestampMs, event.frameIndex, event.status, event.source);
    add("event-confidence", event.id, event.confidence, "ratio", event.timestampMs, event.frameIndex, event.status, event.source);
    if (event.automaticDecision) {
      add("event-automation", `${event.id}:policy`, event.automaticDecision.policyVersion, "", event.timestampMs, event.frameIndex, event.status, "automatic");
      add("event-automation", `${event.id}:score-kind`, event.automaticDecision.scoreKind, "", event.timestampMs, event.frameIndex, event.status, "automatic");
      add("event-automation", `${event.id}:method`, event.automaticDecision.method, "", event.timestampMs, event.frameIndex, event.status, "automatic");
      add("event-automation", `${event.id}:reasons`, event.automaticDecision.reasons.join("|"), "", event.timestampMs, event.frameIndex, event.status, "automatic");
    }
  }
  for (const item of result.metrics) {
    const dependencies = item.requiredEventIds.flatMap((id) => {
      const event = result.events.find((candidate) => candidate.id === id);
      return event ? [event] : [];
    });
    const source = item.status === "unavailable"
      ? "derived"
      : dependencies.every((event) => event.status === "verified" && event.source === "manual")
        ? "manual"
        : dependencies.every((event) => event.status === "confirmed" && event.source === "automatic")
          ? "automatic"
          : "mixed";
    add("metric", item.id, item.value, item.unit, null, null, item.status, source);
  }
  for (const percentile of result.percentiles) {
    add("percentile", percentile.metric, percentile.band, "", null, null, percentile.referenceStatus, BORN_2026_REFERENCE_DATASET.id);
  }
  return rows.map((row) => row.map(safeCell).join(",")).join("\r\n");
}

export function createStartAnalysisExportBundle(
  result: StartAnalysisResultV1,
): { readonly json: string; readonly csv: string } {
  return {
    json: exportStartAnalysisJson(result),
    csv: exportStartAnalysisCsv(result),
  };
}
