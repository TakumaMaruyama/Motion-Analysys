import { describe, expect, it, vi } from "vitest";

import {
  PrecisionPreflightError,
  runPrecisionAnalysisPreflight,
  type PrecisionPreflightDependencies,
} from "../../lib/video/precision-preflight";
import type { PrecisionAnalysisCapabilityDiagnostic } from "../../lib/video/capability-diagnostics";

const supportedDiagnostic: PrecisionAnalysisCapabilityDiagnostic = {
  supported: true,
  facts: {
    isSecureContext: true,
    hasVideoDecoder: true,
    hasVideoDecoderConfigSupport: true,
    hasVideoFrame: true,
    hasWorker: true,
    hasOffscreenCanvas: true,
    hasOffscreenCanvasBitmapTransfer: true,
    hasCreateImageBitmap: true,
    hasDocumentCanvas: true,
    frameBitmapPath: "offscreen-canvas",
  },
  reasons: [],
  warnings: [],
};

function dependencies(
  overrides: Partial<PrecisionPreflightDependencies> = {},
): PrecisionPreflightDependencies {
  return {
    diagnose: () => supportedDiagnostic,
    createEstimator: () => ({
      init: vi.fn().mockResolvedValue(undefined),
      estimate: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    decodeFrames: async (_file, options) => {
      await options.onFrame({
        bitmap: {} as ImageBitmap,
        timestampMs: 0,
        sourceTimestampMs: 0,
        durationMs: 16.7,
        frameIndex: 0,
        displayWidth: 1920,
        displayHeight: 1080,
      });
      return {};
    },
    ...overrides,
  };
}

const file = {} as File;
const window = { startMs: 0, endMs: 1_000 };

describe("runPrecisionAnalysisPreflight", () => {
  it("実モデル経路相当の1フレーム推論を完了する", async () => {
    const result = await runPrecisionAnalysisPreflight(
      file,
      window,
      dependencies(),
    );
    expect(result).toMatchObject({
      decodedFrameCount: 1,
      modelInitialized: true,
      inferenceCompleted: true,
    });
  });

  it("ブラウザ機能不足ではモデルを初期化しない", async () => {
    const createEstimator = vi.fn();
    await expect(
      runPrecisionAnalysisPreflight(
        file,
        window,
        dependencies({
          diagnose: () => ({
            ...supportedDiagnostic,
            supported: false,
            reasons: [
              {
                code: "worker-unavailable",
                message: "Worker unavailable",
              },
            ],
          }),
          createEstimator,
        }),
      ),
    ).rejects.toMatchObject({ stage: "capabilities" });
    expect(createEstimator).not.toHaveBeenCalled();
  });

  it("モデル初期化失敗をmodel段階として報告する", async () => {
    await expect(
      runPrecisionAnalysisPreflight(
        file,
        window,
        dependencies({
          createEstimator: () => ({
            init: vi.fn().mockRejectedValue(new Error("model failed")),
            estimate: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ stage: "model" }));
  });

  it("フレームがない動画をdecode段階で拒否する", async () => {
    await expect(
      runPrecisionAnalysisPreflight(
        file,
        window,
        dependencies({ decodeFrames: async () => ({}) }),
      ),
    ).rejects.toBeInstanceOf(PrecisionPreflightError);
    await expect(
      runPrecisionAnalysisPreflight(
        file,
        window,
        dependencies({ decodeFrames: async () => ({}) }),
      ),
    ).rejects.toMatchObject({ stage: "decode" });
  });

  it("不正な時間窓を拒否する", async () => {
    await expect(
      runPrecisionAnalysisPreflight(
        file,
        { startMs: 100, endMs: 100 },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
