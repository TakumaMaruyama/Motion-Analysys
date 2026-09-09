import { describe, expect, it } from "vitest";

import { findAudioSignalWindow } from "../../lib/start/audio-signal";

describe("start audio signal scoring", () => {
  it("returns a high heuristic score for one isolated, prominent peak", () => {
    const windows = Array.from({ length: 40 }, () => 0.001);
    windows[8] = 0.5;
    const candidate = findAudioSignalWindow(windows);

    expect(candidate).toMatchObject({ windowIndex: 8, peakRms: 0.5 });
    expect(candidate!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps competing peaks below the automatic-confirmation threshold", () => {
    const windows = Array.from({ length: 40 }, () => 0.001);
    windows[8] = 0.5;
    windows[25] = 0.48;
    const candidate = findAudioSignalWindow(windows);

    expect(candidate?.windowIndex).toBe(8);
    expect(candidate!.confidence).toBeLessThan(0.9);
  });

  it("rejects silence and steady background noise", () => {
    expect(findAudioSignalWindow(Array.from({ length: 20 }, () => 0))).toBeNull();
    expect(findAudioSignalWindow(Array.from({ length: 20 }, () => 0.02))).toBeNull();
  });
});
