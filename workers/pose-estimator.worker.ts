import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

import type {
  PoseWorkerRequest,
  PoseWorkerResponse,
  SerializedWorkerError,
} from "../lib/pose/worker-estimator";
import type {
  PoseFrame,
  PoseLandmarks,
  PoseWorldLandmarks,
} from "../types/analysis";
import { assertSinglePoseCount } from "../lib/pose/quality";

const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_ASSET_PATH = "/models/pose_landmarker_full.task";
const LANDMARK_COUNT = 33;
const MINIMUM_CONFIDENCE = 0.5;
const MINIMUM_TIMESTAMP_STEP_MS = 0.001;

interface WorkerMessageScope {
  onmessage:
    | ((event: MessageEvent<PoseWorkerRequest>) => void)
    | null;
  postMessage(message: PoseWorkerResponse): void;
}

const workerScope = self as unknown as WorkerMessageScope;

let landmarker: PoseLandmarker | null = null;
let initialization: Promise<void> | null = null;
let processing = false;
let closing = false;
let closed = false;
let timestampOffsetMs = 0;
let lastMediaPipeTimestampMs = Number.NEGATIVE_INFINITY;

function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: "Unknown pose estimator error." };
}

function postError(id: number, error: unknown): void {
  workerScope.postMessage({
    type: "error",
    id,
    error: serializeError(error),
  });
}

function closeBitmap(bitmap: ImageBitmap | undefined): void {
  try {
    bitmap?.close();
  } catch {
    // ImageBitmapはこのworkerが所有する。既にclose済みなら何もしない。
  }
}

async function initialize(): Promise<void> {
  if (closed || closing) {
    throw new Error("Pose estimator worker is closing.");
  }
  if (landmarker) {
    return;
  }
  if (initialization) {
    return initialization;
  }

  const currentInitialization = (async () => {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is required for pose estimation.");
    }

    // Vite emits this worker as an ES module. Ask MediaPipe for its module
    // loader so dynamic import installs globalThis.ModuleFactory correctly.
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH, true);
    const createdLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET_PATH,
      },
      canvas: new OffscreenCanvas(1, 1),
      runningMode: "VIDEO",
      // 解析対象は1人だが、2人目を検知して品質不良として止めるため2枠使う。
      numPoses: 2,
      minPoseDetectionConfidence: MINIMUM_CONFIDENCE,
      minPosePresenceConfidence: MINIMUM_CONFIDENCE,
      minTrackingConfidence: MINIMUM_CONFIDENCE,
      outputSegmentationMasks: false,
    });

    if (closed || closing) {
      createdLandmarker.close();
      throw new Error("Pose estimator worker was closed during setup.");
    }

    landmarker = createdLandmarker;
    timestampOffsetMs = 0;
    lastMediaPipeTimestampMs = Number.NEGATIVE_INFINITY;
  })();

  initialization = currentInitialization;
  try {
    await currentInitialization;
  } finally {
    if (initialization === currentInitialization) {
      initialization = null;
    }
  }
}

/**
 * MediaPipe VIDEO modeには単調増加するmsが必要。
 * 呼び出し側の動画時刻が0へ戻った場合もoffsetだけを進め、結果には元の
 * timestampMsを残す。
 */
function toMonotonicMediaPipeTimestamp(timestampMs: number): number {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new RangeError("timestampMs must be a non-negative finite number.");
  }

  let mediaPipeTimestampMs = timestampMs + timestampOffsetMs;
  if (mediaPipeTimestampMs <= lastMediaPipeTimestampMs) {
    timestampOffsetMs +=
      lastMediaPipeTimestampMs -
      mediaPipeTimestampMs +
      MINIMUM_TIMESTAMP_STEP_MS;
    mediaPipeTimestampMs = timestampMs + timestampOffsetMs;
  }
  lastMediaPipeTimestampMs = mediaPipeTimestampMs;
  return mediaPipeTimestampMs;
}

function copyPoseResult(
  result: PoseLandmarkerResult,
  timestampMs: number,
  imageSize: { readonly width: number; readonly height: number },
): PoseFrame | null {
  assertSinglePoseCount(result.landmarks.length);
  const pose = result.landmarks[0];
  if (!pose) {
    return null;
  }
  if (pose.length !== LANDMARK_COUNT) {
    throw new Error(
      `Pose Landmarker returned ${pose.length} landmarks; expected ${LANDMARK_COUNT}.`,
    );
  }

  const landmarks = pose.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  })) as unknown as PoseLandmarks;

  const worldPose = result.worldLandmarks[0];
  let worldLandmarks: PoseWorldLandmarks | null = null;
  if (worldPose) {
    if (worldPose.length !== LANDMARK_COUNT) {
      throw new Error(
        `Pose Landmarker returned ${worldPose.length} world landmarks; expected ${LANDMARK_COUNT}.`,
      );
    }
    worldLandmarks = worldPose.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility,
    })) as unknown as PoseWorldLandmarks;
  }

  return {
    timestampMs,
    imageSize,
    landmarks,
    worldLandmarks,
  };
}

async function handleInit(id: number): Promise<void> {
  try {
    await initialize();
    workerScope.postMessage({ type: "ready", id });
  } catch (error) {
    postError(id, error);
  }
}

function handleEstimate(
  id: number,
  bitmap: ImageBitmap,
  timestampMs: number,
): void {
  try {
    if (closed || closing) {
      throw new Error("Pose estimator worker is closed.");
    }
    if (!landmarker) {
      throw new Error("Pose estimator worker is not initialized.");
    }
    if (processing) {
      throw new Error("Pose estimator worker is already processing a frame.");
    }

    processing = true;
    const imageSize = { width: bitmap.width, height: bitmap.height };
    if (imageSize.width <= 0 || imageSize.height <= 0) {
      throw new RangeError("ImageBitmap dimensions must be positive.");
    }

    const mediaPipeTimestampMs =
      toMonotonicMediaPipeTimestamp(timestampMs);
    const result = landmarker.detectForVideo(
      bitmap,
      mediaPipeTimestampMs,
    );
    const frame = copyPoseResult(result, timestampMs, imageSize);
    workerScope.postMessage({ type: "result", id, frame });
  } catch (error) {
    postError(id, error);
  } finally {
    processing = false;
    closeBitmap(bitmap);
  }
}

async function handleClose(id: number): Promise<void> {
  if (closed) {
    workerScope.postMessage({ type: "closed", id });
    return;
  }

  closing = true;
  try {
    if (initialization) {
      await initialization.catch(() => undefined);
    }
    landmarker?.close();
    landmarker = null;
    closed = true;
    workerScope.postMessage({ type: "closed", id });
  } catch (error) {
    postError(id, error);
  } finally {
    closing = false;
    timestampOffsetMs = 0;
    lastMediaPipeTimestampMs = Number.NEGATIVE_INFINITY;
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "init":
      void handleInit(request.id);
      break;
    case "estimate":
      handleEstimate(
        request.id,
        request.bitmap,
        request.timestampMs,
      );
      break;
    case "close":
      void handleClose(request.id);
      break;
  }
};
