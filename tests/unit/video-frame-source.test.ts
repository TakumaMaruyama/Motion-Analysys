import { describe, expect, it } from "vitest";

import {
  buildFineAnalysisWindows,
  buildSampleTimestampsMs,
  findNearestFrameIndex,
  getModeFpsAssessment,
  isSupportedCompetitionVideoFile,
} from "@/lib/video/competition-frame-source";

describe("competition video file validation", () => {
  it.each([
    ["race.mp4", ""],
    ["race.MOV", "application/octet-stream"],
    ["race.webm", "video/webm"],
    ["recording", "video/quicktime"],
  ])("accepts %s (%s)", (name, type) => {
    expect(isSupportedCompetitionVideoFile({ name, type })).toBe(true);
  });

  it("rejects containers outside the supported list", () => {
    expect(
      isSupportedCompetitionVideoFile({ name: "race.avi", type: "video/avi" }),
    ).toBe(false);
  });
});

describe("presentation timestamp sampling", () => {
  it("builds a deterministic half-open sequence", () => {
    expect(
      buildSampleTimestampsMs({ startMs: 1_000, endMs: 1_200 }, 20),
    ).toEqual([1_000, 1_050, 1_100, 1_150]);
  });

  it("returns no timestamps for an empty window", () => {
    expect(buildSampleTimestampsMs({ startMs: 5, endMs: 5 }, 30)).toEqual([]);
  });

  it("maps variable-rate timestamps to the exact nearest source frame", () => {
    const timestamps = [0, 16.7, 50, 83.3, 100];
    expect(findNearestFrameIndex(timestamps, 48.5, 30)).toBe(2);
    expect(findNearestFrameIndex(timestamps, 90, 30)).toBe(3);
  });
});

describe("fine-pass windows", () => {
  it("clips, sorts, and merges overlapping candidate neighborhoods", () => {
    expect(
      buildFineAnalysisWindows(
        [2_600, 1_000, 1_300, Number.NaN, 9_900],
        { startMs: 500, endMs: 10_000 },
        400,
      ),
    ).toEqual([
      { startMs: 600, endMs: 1_700 },
      { startMs: 2_200, endMs: 3_000 },
      { startMs: 9_500, endMs: 10_000 },
    ]);
  });

  it("merges directly touching windows", () => {
    expect(
      buildFineAnalysisWindows(
        [1_000, 1_400],
        { startMs: 0, endMs: 3_000 },
        200,
      ),
    ).toEqual([{ startMs: 800, endMs: 1_600 }]);
  });
});

describe("mode fps requirements", () => {
  it("requires 30fps for Swim and 60fps for Turn and Start", () => {
    expect(
      getModeFpsAssessment({ canDecode: true, effectiveFps: 30 }, "swim")
        .allowed,
    ).toBe(true);
    expect(
      getModeFpsAssessment({ canDecode: true, effectiveFps: 59.9 }, "turn")
        .allowed,
    ).toBe(false);
    expect(
      getModeFpsAssessment({ canDecode: true, effectiveFps: 60 }, "start")
        .allowed,
    ).toBe(true);
  });

  it("never allows precision analysis for an unsupported decoder", () => {
    expect(
      getModeFpsAssessment({ canDecode: false, effectiveFps: 120 }, "swim")
        .allowed,
    ).toBe(false);
  });
});
