import { describe, expect, it } from "vitest";

import { autoConfirmStartEvents, buildStartAnalysisResult, createStartEventCandidate, exportStartAnalysisCsv, exportStartAnalysisJson, verifyStartEvent } from "../../lib/start";
import type { StartCalibrationV1, StartVideoInfo } from "../../types/start";

const calibration: StartCalibrationV1 = { schemaVersion: "1.0", imageWidth: 640, imageHeight: 360, zeroMeter: { x: 0.1, y: 0.5 }, fiveMeter: { x: 0.6, y: 0.5 }, waterSurface: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], travelDirection: "left-to-right" };
const video: StartVideoInfo = { name: "=formula.mp4", mimeType: "video/mp4", width: 640, height: 360, durationMs: 1000, effectiveFps: 120, fixedCamera: true, sideOn: true, singleSwimmer: true };

describe("start export", () => {
  it("exports deterministic JSON and a formula-safe long CSV", () => {
    const signal = verifyStartEvent(createStartEventCandidate("signal", { timestampMs: 0, frameIndex: 0, point: null }), { timestampMs: 0, frameIndex: 0, point: null });
    const result = buildStartAnalysisResult({ athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" }, video, calibration, events: [signal] });
    expect(JSON.parse(exportStartAnalysisJson(result, false)).schemaVersion).toBe("1.0");
    const csv = exportStartAnalysisCsv(result);
    expect(csv.split("\r\n")[0]).toBe("record_type,key,value,unit,timestamp_ms,frame_index,status,source");
    expect(csv).toContain("athlete,age,16,years,,,recorded,result");
    expect(csv).toContain("analysis,analysis-mode,precision,,,,recorded,result");
    expect(csv).toContain("analysis,travel-direction,left-to-right,,,,recorded,result");
    expect(csv).toContain("video,effective-fps,120,fps,,,recorded,result");
    expect(csv).toContain("calibration,travel-direction,left-to-right,,,,verified,manual");
    expect(csv).toContain("reference-dataset,id,born-2026-appendix-a,,,,available,static");
    expect(csv).toContain("external-timing,five-meter-stopwatch-time,,ms,,,unavailable,external-stopwatch");
    expect(csv).toContain("event,start:signal:0,signal,,0,0,verified,manual");
    expect(exportStartAnalysisCsv(result)).toBe(csv);
  });

  it("records timing-only mode without exporting percentile rows", () => {
    const result = buildStartAnalysisResult({
      analysisMode: "timing-only",
      travelDirection: "right-to-left",
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video: { ...video, effectiveFps: 30, fixedCamera: false, sideOn: false },
      calibration: null,
    });
    expect(JSON.parse(exportStartAnalysisJson(result, false)).analysisMode).toBe("timing-only");
    expect(JSON.parse(exportStartAnalysisJson(result, false)).travelDirection).toBe("right-to-left");
    const csv = exportStartAnalysisCsv(result);
    expect(csv).toContain("analysis,analysis-mode,timing-only,,,,recorded,result");
    expect(csv).toContain("analysis,travel-direction,right-to-left,,,,recorded,result");
    expect(csv).not.toContain("\r\npercentile,");
    expect(exportStartAnalysisCsv(result)).toBe(csv);
  });

  it("exports automatic decision evidence without labelling derived metrics as manual", () => {
    const candidates = [
      createStartEventCandidate("signal", { timestampMs: 0, frameIndex: 0, point: null, confidence: 0.96 }),
      createStartEventCandidate("movement-onset", { timestampMs: 120, frameIndex: 14, point: null, confidence: 0.96 }),
      createStartEventCandidate("takeoff", { timestampMs: 700, frameIndex: 84, point: null, confidence: 0.96 }),
    ];
    const events = autoConfirmStartEvents(candidates, {
      analysisMode: "precision",
      effectiveFps: 120,
      fixedCamera: true,
      sideOn: true,
      singleSwimmer: true,
      calibration,
      startStyle: "dive",
    });
    const result = buildStartAnalysisResult({
      athlete: { strokeStyle: "freestyle", age: 16, researchSexCategory: "male" },
      video,
      calibration,
      events,
    });
    const csv = exportStartAnalysisCsv(result);

    expect(csv).toContain("event-automation,start:signal:0:policy,start-heuristic-auto-v1,,0,0,confirmed,automatic");
    expect(csv).toContain("event-automation,start:signal:0:method,audio-rms-peak-v1,,0,0,confirmed,automatic");
    expect(csv).toContain("metric,block-contact-time,700,ms,,,confirmed,automatic");
    expect(csv).not.toContain("metric,block-contact-time,700,ms,,,confirmed,manual");
  });
});
