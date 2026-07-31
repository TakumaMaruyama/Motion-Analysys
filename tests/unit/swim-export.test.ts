import { describe, expect, it } from "vitest";

import { buildAnalysisResult } from "../../lib/pose/analysis";
import {
  buildCompetitionAnalysisResult,
  createCompetitionAnalysisExportBundle,
  exportCompetitionAnalysisCsv,
  exportCompetitionAnalysisJson,
} from "../../lib/swim";
import {
  POSE_LANDMARK_INDEX,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarks,
} from "../../types/analysis";
import type {
  CalibrationProfileV1,
  CompetitionAnalysisResultV2,
} from "../../types/competition";

function frame(timestampMs: number, x: number): PoseFrame {
  const point = (): PoseLandmark => ({
    x,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  });
  const landmarks = Array.from(
    { length: 33 },
    point,
  ) as unknown as PoseLandmarks;
  const mutable = landmarks as unknown as PoseLandmark[];
  mutable[POSE_LANDMARK_INDEX.left_hip] = { ...point(), x: x - 0.01 };
  mutable[POSE_LANDMARK_INDEX.right_hip] = { ...point(), x: x + 0.01 };
  return {
    timestampMs,
    imageSize: { width: 640, height: 360 },
    landmarks,
    worldLandmarks: null,
  };
}

const CALIBRATION: CalibrationProfileV1 = {
  schemaVersion: "1.0",
  id: "export-calibration",
  label: "Export",
  imageWidth: 640,
  imageHeight: 360,
  poolLengthMeters: 25,
  travelDirection: "left-to-right",
  visibilityThreshold: 0.5,
  gates: [
    {
      id: "start",
      label: "Start",
      normalizedX: 0.2,
      distanceMeters: 0,
      role: "start",
    },
    {
      id: "five",
      label: "5m",
      normalizedX: 0.6,
      distanceMeters: 5,
      role: "split",
    },
  ],
};

function result(
  sessionLabel: string | null = '=SUM(1,1), "Heat"',
): CompetitionAnalysisResultV2 {
  const frames = [frame(0, 0.1), frame(1000, 0.3), frame(2000, 0.7)];
  const source = buildAnalysisResult(
    frames,
    {
      kind: "video",
      name: "export.mp4",
      mimeType: "video/mp4",
      width: 640,
      height: 360,
      durationMs: 2000,
      mirrored: false,
    },
    30,
    frames.map((value) => value.timestampMs),
  );
  return buildCompetitionAnalysisResult(source, {
    sessionLabel,
    mode: "swim",
    strokeStyle: "freestyle",
    calibration: CALIBRATION,
  });
}

describe("competition V2 export", () => {
  it("exports the complete V2 object as JSON", () => {
    const parsed = JSON.parse(
      exportCompetitionAnalysisJson(result(), { pretty: false }),
    ) as CompetitionAnalysisResultV2;

    expect(parsed.schemaVersion).toBe("2.0");
    expect(parsed.source.schemaVersion).toBe("1.0");
    expect(parsed.rawPoseFrames).toHaveLength(3);
    expect(parsed.videoInput).toMatchObject({
      container: "mp4",
      detectedMimeType: "video/mp4",
      displayWidth: 640,
      effectiveFps: 30,
    });
  });

  it("uses the exact CSV header and protects the optional session label", () => {
    const csv = exportCompetitionAnalysisCsv(result());
    const rows = csv.split("\r\n");

    expect(rows[0]).toBe(
      "session_label,mode,stroke_style,record_type,key,value,unit,timestamp_ms,confidence,status,source",
    );
    expect(
      rows[1].startsWith(
        `"'=SUM(1,1), ""Heat""",swim,freestyle,calibration-gate`,
      ),
    ).toBe(true);
    expect(csv).toContain(",event,");
    expect(csv).toContain(",measurement,average-speed,");
    expect(
      exportCompetitionAnalysisCsv(result(null))
        .split("\r\n")[1]
        .startsWith(",swim,freestyle,"),
    ).toBe(true);
  });

  it("creates both formats and rejects non-finite values", () => {
    const valid = result();
    const bundle = createCompetitionAnalysisExportBundle(valid, {
      pretty: false,
    });
    expect(bundle.json.startsWith('{"schemaVersion":"2.0"')).toBe(true);
    expect(bundle.csv.startsWith("session_label,")).toBe(true);

    const invalid = {
      ...valid,
      quality: { ...valid.quality, confidence: Number.NaN },
    } satisfies CompetitionAnalysisResultV2;
    expect(() => exportCompetitionAnalysisJson(invalid)).toThrow(
      "non-finite number",
    );
  });
});
