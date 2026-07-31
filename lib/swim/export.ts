import type {
  CompetitionAnalysisResultV2,
  EventSource,
} from "../../types/competition";

export interface CompetitionJsonExportOptions {
  readonly pretty?: boolean;
}

export interface CompetitionAnalysisExportBundle {
  readonly json: string;
  readonly csv: string;
}

type CsvCell = string | number | null;

export const COMPETITION_CSV_HEADERS = [
  "session_label",
  "mode",
  "stroke_style",
  "record_type",
  "key",
  "value",
  "unit",
  "timestamp_ms",
  "confidence",
  "status",
  "source",
] as const;

function finiteNumberReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(
      "Competition analysis export contains a non-finite number.",
    );
  }
  return value;
}

function protectSpreadsheetFormula(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvCell(value: CsvCell): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Competition analysis CSV contains a non-finite number.",
      );
    }
    return String(value);
  }
  const safeValue = protectSpreadsheetFormula(value);
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}

/** V2全体を、欠落なく再読込できるJSONにする。 */
export function exportCompetitionAnalysisJson(
  result: CompetitionAnalysisResultV2,
  options: CompetitionJsonExportOptions = {},
): string {
  return JSON.stringify(
    result,
    finiteNumberReplacer,
    options.pretty === false ? undefined : 2,
  );
}

function measurementSource(
  status: CompetitionAnalysisResultV2["measurements"][number]["status"],
): EventSource {
  return status === "verified" ? "manual" : "automatic";
}

/** 指定された11列のlong形式で、校正・イベント・主要指標を出力する。 */
export function exportCompetitionAnalysisCsv(
  result: CompetitionAnalysisResultV2,
): string {
  const rows: CsvCell[][] = [[...COMPETITION_CSV_HEADERS]];
  const appendRow = (
    recordType: string,
    key: string,
    value: CsvCell,
    unit: string,
    timestampMs: number | null,
    confidence: number,
    status: string,
    source: EventSource,
  ) => {
    rows.push([
      result.sessionLabel,
      result.mode,
      result.strokeStyle,
      recordType,
      key,
      value,
      unit,
      timestampMs,
      confidence,
      status,
      source,
    ]);
  };

  for (const gate of result.calibration.gates) {
    appendRow(
      "calibration-gate",
      gate.id,
      gate.distanceMeters,
      "m",
      null,
      1,
      "verified",
      "manual",
    );
  }

  for (const event of result.events) {
    appendRow(
      "event",
      event.id,
      event.type,
      "",
      event.timestampMs,
      event.confidence,
      event.status,
      event.source,
    );
  }

  for (const measurement of result.measurements) {
    const toEvent =
      measurement.toEventId === null
        ? null
        : result.events.find(
            (event) => event.id === measurement.toEventId,
          );
    appendRow(
      "measurement",
      measurement.type,
      measurement.value,
      measurement.unit,
      toEvent?.timestampMs ?? null,
      measurement.confidence,
      measurement.status,
      measurementSource(measurement.status),
    );
  }

  return rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\r\n");
}

export function createCompetitionAnalysisExportBundle(
  result: CompetitionAnalysisResultV2,
  jsonOptions?: CompetitionJsonExportOptions,
): CompetitionAnalysisExportBundle {
  return {
    json: exportCompetitionAnalysisJson(result, jsonOptions),
    csv: exportCompetitionAnalysisCsv(result),
  };
}
