import {
  POSE_LANDMARK_NAMES,
  type AnalysisResultV1,
  type MetricValue,
  type TrajectorySummary,
} from "../../types/analysis";

export interface JsonExportOptions {
  readonly pretty?: boolean;
}

export interface AnalysisExportBundle {
  readonly json: string;
  readonly csv: string;
}

type CsvCell = string | number | null;

const CSV_HEADERS = [
  "schemaVersion",
  "analyzedAt",
  "inputKind",
  "inputName",
  "modelId",
  "recordType",
  "timestampMs",
  "key",
  "landmarkIndex",
  "x",
  "y",
  "z",
  "visibility",
  "worldX",
  "worldY",
  "worldZ",
  "worldVisibility",
  "value",
  "unit",
  "status",
  "confidence",
] as const;

function finiteNumberReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Analysis export contains a non-finite number.");
  }
  return value;
}

/**
 * AnalysisResultV1を、そのまま再読込できるJSONへ変換する。
 * Infinity/NaNを暗黙にnullへ変えないよう、検出時は明示的に失敗させる。
 */
export function exportAnalysisJson(
  result: AnalysisResultV1,
  options: JsonExportOptions = {},
): string {
  return JSON.stringify(
    result,
    finiteNumberReplacer,
    options.pretty === false ? undefined : 2,
  );
}

function protectSpreadsheetFormula(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

/** RFC 4180互換の引用と、表計算ソフトでの数式注入対策を行う。 */
export function escapeCsvCell(value: CsvCell): string {
  if (value === null) {
    return "";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Analysis CSV contains a non-finite number.");
    }
    return String(value);
  }

  const safeValue = protectSpreadsheetFormula(value);
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}

function metricCells(
  metric: MetricValue,
): readonly [number | null, string, string, number] {
  return [metric.value, metric.unit, metric.status, metric.confidence];
}

function trajectoryMetricEntries(
  trajectory: TrajectorySummary,
): readonly (readonly [string, MetricValue])[] {
  return [
    ["pathLength", trajectory.pathLength],
    ["displacement", trajectory.displacement],
    ["rangeX", trajectory.rangeX],
    ["rangeY", trajectory.rangeY],
  ];
}

/**
 * ランドマーク、時系列指標、指標要約、軌跡要約をlong形式のCSVへ変換する。
 * recordTypeとkeyで行種別を判別できるため、列構成を変えずに指標を追加できる。
 */
export function exportAnalysisCsv(result: AnalysisResultV1): string {
  const rows: CsvCell[][] = [[...CSV_HEADERS]];
  const baseCells: readonly CsvCell[] = [
    result.schemaVersion,
    result.analyzedAt,
    result.input.kind,
    result.input.name,
    result.model.id,
  ];
  const appendRow = (
    recordType: string,
    timestampMs: number | null,
    key: string,
    landmarkIndex: number | null,
    coordinates: readonly CsvCell[],
    metric: readonly CsvCell[],
  ) => {
    rows.push([
      ...baseCells,
      recordType,
      timestampMs,
      key,
      landmarkIndex,
      ...coordinates,
      ...metric,
    ]);
  };
  const emptyCoordinates: readonly CsvCell[] = [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];

  for (const frame of result.frames) {
    POSE_LANDMARK_NAMES.forEach((name, index) => {
      const landmark = frame.landmarks[index];
      const worldLandmark = frame.worldLandmarks?.[index] ?? null;
      appendRow(
        "landmark",
        frame.timestampMs,
        name,
        index,
        [
          landmark.x,
          landmark.y,
          landmark.z,
          landmark.visibility,
          worldLandmark?.x ?? null,
          worldLandmark?.y ?? null,
          worldLandmark?.z ?? null,
          worldLandmark?.visibility ?? null,
        ],
        [null, "", "", landmark.visibility],
      );
    });
  }

  for (const metricKey of Object.keys(result.metrics).sort()) {
    const series = result.metrics[metricKey];
    for (const value of series.values) {
      appendRow(
        "metric",
        value.timestampMs,
        metricKey,
        null,
        emptyCoordinates,
        metricCells(value),
      );
    }

    const summaryEntries = [
      [
        "minimum",
        series.summary.minimum,
        series.summary.minimumTimestampMs,
      ],
      [
        "maximum",
        series.summary.maximum,
        series.summary.maximumTimestampMs,
      ],
      ["range", series.summary.range, null],
      ["mean", series.summary.mean, null],
    ] as const;

    for (const [summaryKey, value, timestampMs] of summaryEntries) {
      appendRow(
        "metric-summary",
        timestampMs,
        `${metricKey}.${summaryKey}`,
        null,
        emptyCoordinates,
        metricCells(value),
      );
    }
  }

  for (const trajectoryKey of Object.keys(result.trajectories).sort()) {
    const trajectory = result.trajectories[trajectoryKey];
    for (const [summaryKey, value] of trajectoryMetricEntries(trajectory)) {
      appendRow(
        "trajectory-summary",
        null,
        `${trajectoryKey}.${summaryKey}`,
        null,
        emptyCoordinates,
        metricCells(value),
      );
    }
  }

  return rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\r\n");
}

export function createAnalysisExportBundle(
  result: AnalysisResultV1,
  jsonOptions?: JsonExportOptions,
): AnalysisExportBundle {
  return {
    json: exportAnalysisJson(result, jsonOptions),
    csv: exportAnalysisCsv(result),
  };
}
