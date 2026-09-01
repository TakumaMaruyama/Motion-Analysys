import type { Point2D } from "../../types/analysis";
import type { StartCalibrationV1 } from "../../types/start";

function finitePoint(point: Point2D, name: string): void {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1
  ) {
    throw new TypeError(`${name} must contain normalized coordinates between 0 and 1.`);
  }
}

/** 校正値を検査する。距離が不足する映像は値を捏造せず拒否する。 */
export function validateStartCalibration(
  calibration: StartCalibrationV1,
): void {
  if (
    !Number.isFinite(calibration.imageWidth) ||
    !Number.isFinite(calibration.imageHeight) ||
    calibration.imageWidth <= 0 ||
    calibration.imageHeight <= 0
  ) {
    throw new RangeError("image dimensions must be finite positive numbers.");
  }
  finitePoint(calibration.zeroMeter, "zeroMeter");
  finitePoint(calibration.fiveMeter, "fiveMeter");
  finitePoint(calibration.waterSurface[0], "waterSurface[0]");
  finitePoint(calibration.waterSurface[1], "waterSurface[1]");
  if (Math.abs(calibration.fiveMeter.x - calibration.zeroMeter.x) < 1e-9) {
    throw new RangeError("0m and 5m calibration points must differ on X.");
  }
  if (
    (calibration.travelDirection === "left-to-right" && calibration.fiveMeter.x <= calibration.zeroMeter.x) ||
    (calibration.travelDirection === "right-to-left" && calibration.fiveMeter.x >= calibration.zeroMeter.x)
  ) {
    throw new RangeError("0m and 5m positions must match the configured travel direction.");
  }
  const [first, second] = calibration.waterSurface;
  if (Math.hypot(second.x - first.x, second.y - first.y) < 1e-9) {
    throw new RangeError("water surface points must differ.");
  }
}

/** 画面正規化Xを、進行方向を考慮した0m基準の距離へ変換する。 */
export function calibratedDistanceMeters(
  normalizedX: number,
  calibration: StartCalibrationV1,
): number | null {
  try {
    validateStartCalibration(calibration);
  } catch {
    return null;
  }
  if (!Number.isFinite(normalizedX)) return null;
  const deltaX = calibration.fiveMeter.x - calibration.zeroMeter.x;
  const meters =
    ((normalizedX - calibration.zeroMeter.x) / deltaX) * 5;
  return Number.isFinite(meters) ? meters : null;
}

/** 入水点などの画面Xから、0mを起点にした前方距離を返す。 */
export function forwardDistanceMeters(
  point: Point2D,
  calibration: StartCalibrationV1,
): number | null {
  const distance = calibratedDistanceMeters(point.x, calibration);
  return distance === null || distance < 0 ? null : distance;
}

export function waterSurfaceAngleRadians(
  calibration: StartCalibrationV1,
): number | null {
  try {
    validateStartCalibration(calibration);
  } catch {
    return null;
  }
  const [first, second] = calibration.waterSurface;
  return Math.atan2(second.y - first.y, second.x - first.x);
}
