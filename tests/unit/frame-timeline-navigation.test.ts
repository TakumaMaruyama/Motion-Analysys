import { describe, expect, it } from "vitest";

import {
  adjacentFrameTimestamp,
  snapToFrameTimestamp,
} from "../../lib/video/frame-timeline-navigation";

const VFR_TIMESTAMPS = [0, 16.68, 33.37, 50.2, 83.6, 100.25] as const;

describe("frame timeline navigation", () => {
  it("snaps to the nearest real VFR presentation timestamp", () => {
    expect(snapToFrameTimestamp(VFR_TIMESTAMPS, 47, 0, 100)).toBe(50.2);
    expect(snapToFrameTimestamp(VFR_TIMESTAMPS, 75, 0, 100)).toBe(83.6);
  });

  it("never snaps outside the selected trim", () => {
    expect(snapToFrameTimestamp(VFR_TIMESTAMPS, 0, 20, 90)).toBe(33.37);
    expect(snapToFrameTimestamp(VFR_TIMESTAMPS, 100, 20, 90)).toBe(83.6);
  });

  it("steps through exact adjacent timestamps", () => {
    expect(
      adjacentFrameTimestamp(VFR_TIMESTAMPS, 50.2, 1, 0, 100, 16.67),
    ).toBe(83.6);
    expect(
      adjacentFrameTimestamp(VFR_TIMESTAMPS, 50.2, -1, 0, 100, 16.67),
    ).toBe(33.37);
  });

  it("handles small media-time rounding differences", () => {
    expect(
      adjacentFrameTimestamp(VFR_TIMESTAMPS, 50.21, -1, 0, 100, 16.67),
    ).toBe(33.37);
    expect(
      adjacentFrameTimestamp(VFR_TIMESTAMPS, 50.19, 1, 0, 100, 16.67),
    ).toBe(83.6);
  });

  it("falls back to a fixed step when no source timeline is available", () => {
    expect(adjacentFrameTimestamp([], 100, 1, 0, 200, 25)).toBe(125);
    expect(snapToFrameTimestamp([], 250, 0, 200)).toBe(200);
  });
});
