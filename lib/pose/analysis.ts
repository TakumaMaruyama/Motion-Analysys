import {
  POSE_LANDMARK_INDEX,
  POSE_LANDMARKER_FULL_MODEL,
  type AnalysisInputInfo,
  type AnalysisMetricSeries,
  type AnalysisResultV1,
  type PoseFrame,
} from "../../types/analysis";
import {
  calculateStandardPoseMetrics,
  landmarkTrajectoryPoints,
  midpointTrajectoryPoints,
  summarizeLandmarkTrajectory,
  summarizeRangeOfMotion,
  summarizeTrajectory,
  type StandardPoseMetricKey,
} from "./metrics";

const METRIC_LABELS: Record<StandardPoseMetricKey, string> = {
  leftElbowAngle: "左ひじ",
  rightElbowAngle: "右ひじ",
  leftShoulderAngle: "左肩",
  rightShoulderAngle: "右肩",
  leftHipAngle: "左股関節",
  rightHipAngle: "右股関節",
  leftKneeAngle: "左ひざ",
  rightKneeAngle: "右ひざ",
  leftAnkleAngle: "左足首",
  rightAnkleAngle: "右足首",
  trunkLean: "体幹傾斜",
  shoulderTilt: "肩の傾き",
  hipTilt: "腰の傾き",
};

export const TRAJECTORY_LABELS = {
  leftWrist: "左手首",
  rightWrist: "右手首",
  leftAnkle: "左足首",
  rightAnkle: "右足首",
  hipCenter: "腰中心",
} as const;

export function buildAnalysisResult(
  sourceFrames: readonly PoseFrame[],
  input: AnalysisInputInfo,
  targetFps: number,
  sourceSampleTimestampsMs?: readonly number[],
): AnalysisResultV1 {
  const frames = [...sourceFrames].sort(
    (first, second) => first.timestampMs - second.timestampMs,
  );
  const timestampsMs = [
    ...(sourceSampleTimestampsMs ??
      frames.map((frame) => frame.timestampMs)),
  ].sort((first, second) => first - second);
  const metricValues: Partial<
    Record<StandardPoseMetricKey, ReturnType<typeof calculateStandardPoseMetrics>[StandardPoseMetricKey][]>
  > = {};

  for (const frame of frames) {
    const frameMetrics = calculateStandardPoseMetrics(frame);
    for (const key of Object.keys(frameMetrics) as StandardPoseMetricKey[]) {
      (metricValues[key] ??= []).push(frameMetrics[key]);
    }
  }

  const metrics = Object.fromEntries(
    (Object.keys(METRIC_LABELS) as StandardPoseMetricKey[]).map((key) => {
      const values = metricValues[key] ?? [];
      const series: AnalysisMetricSeries = {
        label: METRIC_LABELS[key],
        values,
        summary: summarizeRangeOfMotion(values),
      };
      return [key, series];
    }),
  ) as AnalysisResultV1["metrics"];

  return {
    schemaVersion: "1.0",
    analyzedAt: new Date().toISOString(),
    input,
    sampling: {
      targetFps,
      frameCount: timestampsMs.length,
      detectedFrameCount: frames.length,
      timestampsMs,
      startTimestampMs: timestampsMs[0] ?? null,
      endTimestampMs: timestampsMs.at(-1) ?? null,
    },
    model: POSE_LANDMARKER_FULL_MODEL,
    frames,
    metrics,
    trajectories: {
      leftWrist: summarizeLandmarkTrajectory(
        frames,
        POSE_LANDMARK_INDEX.left_wrist,
      ),
      rightWrist: summarizeLandmarkTrajectory(
        frames,
        POSE_LANDMARK_INDEX.right_wrist,
      ),
      leftAnkle: summarizeLandmarkTrajectory(
        frames,
        POSE_LANDMARK_INDEX.left_ankle,
      ),
      rightAnkle: summarizeLandmarkTrajectory(
        frames,
        POSE_LANDMARK_INDEX.right_ankle,
      ),
      hipCenter: summarizeTrajectory(
        midpointTrajectoryPoints(
          frames,
          POSE_LANDMARK_INDEX.left_hip,
          POSE_LANDMARK_INDEX.right_hip,
        ),
      ),
    },
  };
}

export function getTrajectoryPoints(
  frames: readonly PoseFrame[],
  key: keyof typeof TRAJECTORY_LABELS,
) {
  switch (key) {
    case "leftWrist":
      return landmarkTrajectoryPoints(frames, POSE_LANDMARK_INDEX.left_wrist);
    case "rightWrist":
      return landmarkTrajectoryPoints(frames, POSE_LANDMARK_INDEX.right_wrist);
    case "leftAnkle":
      return landmarkTrajectoryPoints(frames, POSE_LANDMARK_INDEX.left_ankle);
    case "rightAnkle":
      return landmarkTrajectoryPoints(frames, POSE_LANDMARK_INDEX.right_ankle);
    case "hipCenter":
      return midpointTrajectoryPoints(
        frames,
        POSE_LANDMARK_INDEX.left_hip,
        POSE_LANDMARK_INDEX.right_hip,
      );
  }
}
