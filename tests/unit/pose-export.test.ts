import { describe, expect, it } from "vitest";

import {
  createAnalysisExportBundle,
  escapeCsvCell,
  exportAnalysisCsv,
  exportAnalysisJson,
} from "../../lib/pose/export";
import {
  summarizeRangeOfMotion,
  summarizeTrajectory,
} from "../../lib/pose/metrics";
import {
  POSE_LANDMARKER_FULL_MODEL,
  type AnalysisResultV1,
  type PoseLandmark,
  type PoseLandmarks,
  type TimedMetricValue,
} from "../../types/analysis";

function createLandmarks(): PoseLandmarks {
  return Array.from(
    { length: 33 },
    (_, index): PoseLandmark => ({
      x: index / 32,
      y: index / 64,
      z: 0,
      visibility: 0.9,
    }),
  ) as unknown as PoseLandmarks;
}

function createResult(): AnalysisResultV1 {
  const values: readonly TimedMetricValue[] = [
    {
      timestampMs: 0,
      value: 90,
      unit: "deg",
      confidence: 0.9,
      status: "valid",
    },
    {
      timestampMs: 33.333333,
      value: null,
      unit: "deg",
      confidence: 0.3,
      status: "low-confidence",
    },
  ];

  return {
    schemaVersion: "1.0",
    analyzedAt: "2026-07-30T00:00:00.000Z",
    input: {
      kind: "video",
      name: '=SUM(1,1), "clip".mp4',
      mimeType: "video/mp4",
      width: 1280,
      height: 720,
      durationMs: 1000,
      mirrored: false,
    },
    sampling: {
      targetFps: 30,
      frameCount: 1,
      detectedFrameCount: 1,
      timestampsMs: [0],
      startTimestampMs: 0,
      endTimestampMs: 0,
    },
    model: POSE_LANDMARKER_FULL_MODEL,
    frames: [
      {
        timestampMs: 0,
        imageSize: { width: 1280, height: 720 },
        landmarks: createLandmarks(),
        worldLandmarks: null,
      },
    ],
    metrics: {
      leftElbowAngle: {
        label: "左ひじ",
        values,
        summary: summarizeRangeOfMotion(values),
      },
    },
    trajectories: {
      leftWrist: summarizeTrajectory([
        { timestampMs: 0, x: 0.1, y: 0.2, visibility: 0.9 },
        { timestampMs: 33.333333, x: 0.2, y: 0.3, visibility: 0.8 },
      ]),
    },
  };
}

describe("exportAnalysisJson", () => {
  it("retains schema, timestamps and model provenance", () => {
    const parsed = JSON.parse(
      exportAnalysisJson(createResult(), { pretty: false }),
    ) as AnalysisResultV1;

    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.frames[0].timestampMs).toBe(0);
    expect(parsed.model.sha256).toBe(
      "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad",
    );
  });

  it("rejects non-finite numbers instead of silently exporting null", () => {
    const result = createResult();
    const invalidResult = {
      ...result,
      input: { ...result.input, width: Number.NaN },
    } satisfies AnalysisResultV1;

    expect(() => exportAnalysisJson(invalidResult)).toThrow(
      "non-finite number",
    );
  });
});

describe("exportAnalysisCsv", () => {
  it("exports landmarks, timed metrics and summaries as long-form rows", () => {
    const csv = exportAnalysisCsv(createResult());
    const rows = csv.split("\r\n");

    expect(rows[0]).toBe(
      "schemaVersion,analyzedAt,inputKind,inputName,modelId,recordType,timestampMs,key,landmarkIndex,x,y,z,visibility,worldX,worldY,worldZ,worldVisibility,value,unit,status,confidence",
    );
    expect(
      rows.filter((row) => row.includes(",landmark,")).length,
    ).toBe(33);
    expect(rows.filter((row) => row.includes(",metric,")).length).toBe(2);
    expect(
      rows.filter((row) => row.includes(",metric-summary,")).length,
    ).toBe(4);
    expect(
      rows.filter((row) => row.includes(",trajectory-summary,")).length,
    ).toBe(4);
    expect(csv).toContain(
      `"\'=SUM(1,1), ""clip"".mp4"`,
    );
    expect(csv).not.toContain("undefined");
  });

  it("quotes CSV cells and prevents spreadsheet formula injection", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
    expect(escapeCsvCell("=2+2")).toBe("'=2+2");
    expect(escapeCsvCell(null)).toBe("");
  });
});

describe("createAnalysisExportBundle", () => {
  it("produces both supported local export formats", () => {
    const bundle = createAnalysisExportBundle(createResult(), {
      pretty: false,
    });

    expect(bundle.json.startsWith('{"schemaVersion":"1.0"')).toBe(true);
    expect(bundle.csv.startsWith("schemaVersion,")).toBe(true);
  });
});
