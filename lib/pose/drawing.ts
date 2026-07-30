import type {
  ImageDimensions,
  PoseFrame,
  PoseLandmark,
  TimedTrajectoryPoint,
} from "../../types/analysis";
import { normalizedToPixel } from "./metrics";

export const POSE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
] as const;

interface DrawPoseOptions {
  readonly mirrored?: boolean;
  readonly visibilityThreshold?: number;
  readonly lineColor?: string;
  readonly pointColor?: string;
  readonly dimColor?: string;
}

function visible(
  landmark: PoseLandmark | undefined,
  threshold: number,
): landmark is PoseLandmark {
  return Boolean(
    landmark &&
      Number.isFinite(landmark.x) &&
      Number.isFinite(landmark.y) &&
      landmark.visibility >= threshold,
  );
}

export function drawPoseOverlay(
  context: CanvasRenderingContext2D,
  frame: PoseFrame | null,
  dimensions: ImageDimensions,
  options: DrawPoseOptions = {},
): void {
  const {
    mirrored = false,
    visibilityThreshold = 0.5,
    lineColor = "#a5b4fc",
    pointColor = "#ffffff",
    dimColor = "rgba(148, 163, 184, 0.32)",
  } = options;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, dimensions.width / 360);
  context.shadowColor = "rgba(15, 23, 42, 0.65)";
  context.shadowBlur = Math.max(3, dimensions.width / 260);

  if (!frame) {
    context.restore();
    return;
  }

  for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
    const start = frame.landmarks[startIndex];
    const end = frame.landmarks[endIndex];
    const startPoint = normalizedToPixel(start, dimensions, mirrored);
    const endPoint = normalizedToPixel(end, dimensions, mirrored);
    context.strokeStyle =
      visible(start, visibilityThreshold) && visible(end, visibilityThreshold)
        ? lineColor
        : dimColor;
    context.beginPath();
    context.moveTo(startPoint.x, startPoint.y);
    context.lineTo(endPoint.x, endPoint.y);
    context.stroke();
  }

  frame.landmarks.forEach((landmark) => {
    if (!visible(landmark, visibilityThreshold)) {
      return;
    }
    const point = normalizedToPixel(landmark, dimensions, mirrored);
    context.fillStyle = pointColor;
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      Math.max(2.4, dimensions.width / 260),
      0,
      Math.PI * 2,
    );
    context.fill();
  });
  context.restore();
}

export function drawTrajectory(
  context: CanvasRenderingContext2D,
  points: readonly TimedTrajectoryPoint[],
  dimensions: ImageDimensions,
  color: string,
  mirrored = false,
  visibilityThreshold = 0.5,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, dimensions.width / 320);
  context.lineCap = "round";
  let pathOpen = false;

  for (const point of points) {
    if (point.visibility < visibilityThreshold) {
      if (pathOpen) {
        context.stroke();
        pathOpen = false;
      }
      continue;
    }
    const pixel = normalizedToPixel(point, dimensions, mirrored);
    if (!pathOpen) {
      context.beginPath();
      context.moveTo(pixel.x, pixel.y);
      pathOpen = true;
    } else {
      context.lineTo(pixel.x, pixel.y);
    }
  }
  if (pathOpen) {
    context.stroke();
  }
  context.restore();
}

export function drawSourceFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  frame: PoseFrame | null,
  dimensions: ImageDimensions,
  mirrored = false,
): void {
  context.save();
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  if (mirrored) {
    context.translate(dimensions.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
  context.restore();
  drawPoseOverlay(context, frame, dimensions, { mirrored });
}

/**
 * world landmarks are shown only as an orientation aid. No physical unit or
 * distance scale is rendered because monocular depth is not calibrated.
 */
export function drawWorldPose(
  context: CanvasRenderingContext2D,
  frame: PoseFrame | null,
  dimensions: ImageDimensions,
): void {
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  const gradient = context.createLinearGradient(0, 0, 0, dimensions.height);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(1, "#020617");
  context.fillStyle = gradient;
  context.fillRect(0, 0, dimensions.width, dimensions.height);

  const world = frame?.worldLandmarks;
  if (!world) {
    context.fillStyle = "#94a3b8";
    context.textAlign = "center";
    context.font = "13px system-ui";
    context.fillText(
      "補助姿勢を表示できません",
      dimensions.width / 2,
      dimensions.height / 2,
    );
    return;
  }

  const visiblePoints = world.filter(
    (point) => point.visibility >= 0.5 && Number.isFinite(point.x + point.y + point.z),
  );
  if (visiblePoints.length === 0) {
    return;
  }
  const rangeX = Math.max(
    0.6,
    Math.max(...visiblePoints.map((point) => point.x)) -
      Math.min(...visiblePoints.map((point) => point.x)),
  );
  const rangeY = Math.max(
    1.2,
    Math.max(...visiblePoints.map((point) => point.y)) -
      Math.min(...visiblePoints.map((point) => point.y)),
  );
  const scale = Math.min(
    (dimensions.width * 0.64) / rangeX,
    (dimensions.height * 0.7) / rangeY,
  );
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  const project = (point: (typeof world)[number]) => ({
    x: centerX + (point.x + point.z * 0.32) * scale,
    y: centerY + point.y * scale,
  });

  context.save();
  context.lineWidth = 2;
  context.lineCap = "round";
  for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
    const start = world[startIndex];
    const end = world[endIndex];
    if (Math.min(start.visibility, end.visibility) < 0.5) {
      continue;
    }
    const a = project(start);
    const b = project(end);
    const depth = Math.max(-1, Math.min(1, (start.z + end.z) / 2));
    context.strokeStyle =
      depth < 0 ? "rgba(129, 140, 248, 0.95)" : "rgba(56, 189, 248, 0.95)";
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.restore();
}
