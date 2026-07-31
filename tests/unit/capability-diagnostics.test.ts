import { describe, expect, it } from "vitest";

import {
  collectPrecisionAnalysisCapabilityFacts,
  diagnosePrecisionAnalysisCapabilities,
  type PrecisionAnalysisCapabilitySource,
} from "@/lib/video/capability-diagnostics";

class VideoDecoderWithConfigSupport {
  static isConfigSupported(): Promise<{ supported: boolean }> {
    return Promise.resolve({ supported: true });
  }
}

class VideoFrameStub {}
class WorkerStub {}

class OffscreenCanvasStub {
  transferToImageBitmap(): object {
    return {};
  }
}

function fullySupportedSource(): PrecisionAnalysisCapabilitySource {
  return {
    isSecureContext: true,
    VideoDecoder: VideoDecoderWithConfigSupport,
    VideoFrame: VideoFrameStub,
    Worker: WorkerStub,
    OffscreenCanvas: OffscreenCanvasStub,
    createImageBitmap: () => Promise.resolve({}),
    document: { createElement: () => ({}) },
  };
}

describe("precision-analysis capability facts", () => {
  it("collects facts from an injected browser surface", () => {
    expect(
      collectPrecisionAnalysisCapabilityFacts(fullySupportedSource()),
    ).toEqual({
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
    });
  });

  it("selects the DOM canvas fallback only when createImageBitmap is present", () => {
    const source = fullySupportedSource();
    expect(
      collectPrecisionAnalysisCapabilityFacts({
        ...source,
        OffscreenCanvas: undefined,
      }).frameBitmapPath,
    ).toBe("dom-canvas");
    expect(
      collectPrecisionAnalysisCapabilityFacts({
        ...source,
        OffscreenCanvas: undefined,
        createImageBitmap: undefined,
      }).frameBitmapPath,
    ).toBe("none");
  });
});

describe("precision-analysis capability diagnostic", () => {
  it("supports a complete browser without warnings", () => {
    expect(
      diagnosePrecisionAnalysisCapabilities(fullySupportedSource()),
    ).toMatchObject({
      supported: true,
      reasons: [],
      warnings: [],
    });
  });

  it("allows the DOM canvas fallback with a performance warning", () => {
    const result = diagnosePrecisionAnalysisCapabilities({
      ...fullySupportedSource(),
      OffscreenCanvas: undefined,
    });

    expect(result.supported).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.warnings.map(({ code }) => code)).toEqual([
      "offscreen-canvas-unavailable",
    ]);
    expect(result.facts.frameBitmapPath).toBe("dom-canvas");
  });

  it("fails closed when the secure-context state is missing or false", () => {
    const source = fullySupportedSource();
    expect(
      diagnosePrecisionAnalysisCapabilities({
        ...source,
        isSecureContext: undefined,
      }).reasons.map(({ code }) => code),
    ).toContain("secure-context-unknown");
    expect(
      diagnosePrecisionAnalysisCapabilities({
        ...source,
        isSecureContext: false,
      }).reasons.map(({ code }) => code),
    ).toContain("insecure-context");
  });

  it("reports every missing required analysis primitive", () => {
    const result = diagnosePrecisionAnalysisCapabilities({
      isSecureContext: true,
      document: { createElement: () => ({}) },
    });

    expect(result.supported).toBe(false);
    expect(result.reasons.map(({ code }) => code)).toEqual([
      "video-decoder-unavailable",
      "video-frame-unavailable",
      "worker-unavailable",
      "frame-bitmap-path-unavailable",
    ]);
  });

  it("blocks when codec support cannot be checked before decoding", () => {
    class VideoDecoderWithoutConfigSupport {}
    const result = diagnosePrecisionAnalysisCapabilities({
      ...fullySupportedSource(),
      VideoDecoder: VideoDecoderWithoutConfigSupport,
    });

    expect(result.supported).toBe(false);
    expect(result.reasons.map(({ code }) => code)).toContain(
      "video-decoder-config-check-unavailable",
    );
  });

  it("accepts OffscreenCanvas while warning that its fallback is absent", () => {
    const result = diagnosePrecisionAnalysisCapabilities({
      ...fullySupportedSource(),
      createImageBitmap: undefined,
      document: undefined,
    });

    expect(result.supported).toBe(true);
    expect(result.facts.frameBitmapPath).toBe("offscreen-canvas");
    expect(result.warnings.map(({ code }) => code)).toContain(
      "create-image-bitmap-unavailable",
    );
  });
});
