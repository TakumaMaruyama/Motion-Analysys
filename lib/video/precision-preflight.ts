import { WorkerPoseEstimator } from "@/lib/pose/worker-estimator";
import {
  diagnosePrecisionAnalysisCapabilities,
  type PrecisionAnalysisCapabilityDiagnostic,
} from "@/lib/video/capability-diagnostics";
import {
  decodeCompetitionFrames,
  type DecodedCompetitionFrame,
} from "@/lib/video/competition-frame-source";

export type PrecisionPreflightStage =
  | "capabilities"
  | "model"
  | "decode"
  | "inference";

export interface PrecisionPreflightResult {
  readonly diagnostic: PrecisionAnalysisCapabilityDiagnostic;
  readonly decodedFrameCount: number;
  readonly modelInitialized: true;
  readonly inferenceCompleted: true;
}

export interface PrecisionPreflightEstimator {
  init(): Promise<void>;
  estimate(bitmap: ImageBitmap, timestampMs: number): Promise<unknown>;
  close(): Promise<void>;
}

export interface PrecisionPreflightDependencies {
  readonly diagnose?: () => PrecisionAnalysisCapabilityDiagnostic;
  readonly createEstimator?: () => PrecisionPreflightEstimator;
  readonly decodeFrames?: (
    file: File,
    options: {
      readonly startMs: number;
      readonly endMs: number;
      readonly targetFps: number | null;
      readonly mode: "swim";
      readonly signal?: AbortSignal;
      readonly onFrame: (frame: DecodedCompetitionFrame) => Promise<void>;
    },
  ) => Promise<unknown>;
}

export class PrecisionPreflightError extends Error {
  constructor(
    message: string,
    readonly stage: PrecisionPreflightStage,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PrecisionPreflightError";
  }
}

function stageMessage(stage: Exclude<PrecisionPreflightStage, "capabilities">) {
  if (stage === "model") {
    return "姿勢推定モデルを準備できませんでした。ページを再読み込みして、もう一度お試しください。";
  }
  if (stage === "inference") {
    return "動画フレームを姿勢推定モデルで処理できませんでした。最新版のChromeまたはSafariでお試しください。";
  }
  return "選択した動画のフレームを精密デコードできませんでした。対応するMP4またはWebMへ変換してください。";
}

/**
 * Runs the real Worker/model path and one decoded frame before calibration.
 * A missing swimmer is still a successful preflight; only runtime failures
 * block analysis.
 */
export async function runPrecisionAnalysisPreflight(
  file: File,
  options: {
    readonly startMs: number;
    readonly endMs: number;
    readonly signal?: AbortSignal;
  },
  dependencies: PrecisionPreflightDependencies = {},
): Promise<PrecisionPreflightResult> {
  const diagnostic = (
    dependencies.diagnose ?? diagnosePrecisionAnalysisCapabilities
  )();
  if (!diagnostic.supported) {
    throw new PrecisionPreflightError(
      diagnostic.reasons.map((reason) => reason.message).join(" "),
      "capabilities",
    );
  }
  if (
    !Number.isFinite(options.startMs) ||
    !Number.isFinite(options.endMs) ||
    options.endMs <= options.startMs
  ) {
    throw new RangeError("Preflight window must have a positive duration.");
  }

  const estimator = (
    dependencies.createEstimator ?? (() => new WorkerPoseEstimator())
  )();
  const decodeFrames = dependencies.decodeFrames ?? decodeCompetitionFrames;
  let stage: Exclude<PrecisionPreflightStage, "capabilities"> = "model";
  let decodedFrameCount = 0;
  let inferenceCompleted = false;

  try {
    await estimator.init();
    stage = "decode";
    await decodeFrames(file, {
      startMs: options.startMs,
      endMs: options.endMs,
      targetFps: 1,
      mode: "swim",
      signal: options.signal,
      onFrame: async (frame) => {
        if (decodedFrameCount > 0) {
          return;
        }
        decodedFrameCount += 1;
        stage = "inference";
        await estimator.estimate(frame.bitmap, frame.timestampMs);
        inferenceCompleted = true;
        stage = "decode";
      },
    });
    if (decodedFrameCount === 0) {
      throw new PrecisionPreflightError(
        "動画から確認用フレームを取得できませんでした。別の対応動画でお試しください。",
        "decode",
      );
    }
    if (!inferenceCompleted) {
      throw new PrecisionPreflightError(stageMessage("inference"), "inference");
    }
    return {
      diagnostic,
      decodedFrameCount,
      modelInitialized: true,
      inferenceCompleted: true,
    };
  } catch (error) {
    if (error instanceof PrecisionPreflightError) {
      throw error;
    }
    if (options.signal?.aborted) {
      throw error;
    }
    throw new PrecisionPreflightError(stageMessage(stage), stage, error);
  } finally {
    await estimator.close().catch(() => undefined);
  }
}
