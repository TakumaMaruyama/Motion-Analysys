export function assertSinglePoseCount(poseCount: number): void {
  if (!Number.isInteger(poseCount) || poseCount < 0) {
    throw new RangeError("poseCount must be a non-negative integer.");
  }
  if (poseCount > 1) {
    throw new Error(
      "複数の人物を検出しました。1レーン・1選手だけが映る区間を選んでください。",
    );
  }
}
