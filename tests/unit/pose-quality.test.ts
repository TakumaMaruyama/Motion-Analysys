import { describe, expect, it } from "vitest";

import { assertSinglePoseCount } from "@/lib/pose/quality";

describe("single swimmer quality gate", () => {
  it.each([0, 1])("accepts %i detected people", (count) => {
    expect(() => assertSinglePoseCount(count)).not.toThrow();
  });

  it("rejects a second detected person instead of selecting one silently", () => {
    expect(() => assertSinglePoseCount(2)).toThrow(
      "複数の人物を検出しました",
    );
  });
});
