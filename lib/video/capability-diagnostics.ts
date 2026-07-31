/**
 * Browser features required before starting local precision video analysis.
 *
 * This module deliberately checks runtime primitives only. Whether a specific
 * video codec can be decoded is still determined from the selected video's
 * track metadata by `inspectCompetitionVideo`.
 */

export type FrameBitmapPath =
  | "offscreen-canvas"
  | "dom-canvas"
  | "none";

export type PrecisionAnalysisBlockingReasonCode =
  | "secure-context-unknown"
  | "insecure-context"
  | "video-decoder-unavailable"
  | "video-decoder-config-check-unavailable"
  | "video-frame-unavailable"
  | "worker-unavailable"
  | "frame-bitmap-path-unavailable";

export type PrecisionAnalysisWarningCode =
  | "offscreen-canvas-unavailable"
  | "offscreen-canvas-transfer-unavailable"
  | "create-image-bitmap-unavailable";

export interface PrecisionAnalysisCapabilityMessage<
  Code extends string = string,
> {
  readonly code: Code;
  readonly message: string;
}

export interface PrecisionAnalysisCapabilityFacts {
  /** null means that the runtime does not expose its secure-context state. */
  readonly isSecureContext: boolean | null;
  readonly hasVideoDecoder: boolean;
  readonly hasVideoDecoderConfigSupport: boolean;
  readonly hasVideoFrame: boolean;
  readonly hasWorker: boolean;
  readonly hasOffscreenCanvas: boolean;
  readonly hasOffscreenCanvasBitmapTransfer: boolean;
  readonly hasCreateImageBitmap: boolean;
  readonly hasDocumentCanvas: boolean;
  readonly frameBitmapPath: FrameBitmapPath;
}

export interface PrecisionAnalysisCapabilityDiagnostic {
  /** true only when all primitives required by precision analysis are usable. */
  readonly supported: boolean;
  readonly facts: PrecisionAnalysisCapabilityFacts;
  readonly reasons: readonly PrecisionAnalysisCapabilityMessage<PrecisionAnalysisBlockingReasonCode>[];
  readonly warnings: readonly PrecisionAnalysisCapabilityMessage<PrecisionAnalysisWarningCode>[];
}

/**
 * Minimal browser surface used by the probe. Passing a synthetic source makes
 * capability tests deterministic without mutating globalThis.
 */
export interface PrecisionAnalysisCapabilitySource {
  readonly isSecureContext?: unknown;
  readonly VideoDecoder?: unknown;
  readonly VideoFrame?: unknown;
  readonly Worker?: unknown;
  readonly OffscreenCanvas?: unknown;
  readonly createImageBitmap?: unknown;
  readonly document?: {
    readonly createElement?: unknown;
  };
}

function hasConstructor(value: unknown): boolean {
  return typeof value === "function";
}

function hasPrototypeMethod(value: unknown, methodName: string): boolean {
  if (typeof value !== "function") return false;
  const prototype = (value as { readonly prototype?: unknown }).prototype;
  if (typeof prototype !== "object" || prototype === null) return false;
  return (
    typeof (prototype as Record<string, unknown>)[methodName] === "function"
  );
}

function hasStaticMethod(value: unknown, methodName: string): boolean {
  return (
    (typeof value === "function" ||
      (typeof value === "object" && value !== null)) &&
    typeof (value as Record<string, unknown>)[methodName] === "function"
  );
}

/** Collects capability facts without constructing decoders, workers, or canvases. */
export function collectPrecisionAnalysisCapabilityFacts(
  source: PrecisionAnalysisCapabilitySource =
    globalThis as unknown as PrecisionAnalysisCapabilitySource,
): PrecisionAnalysisCapabilityFacts {
  const isSecureContext =
    typeof source.isSecureContext === "boolean"
      ? source.isSecureContext
      : null;
  const hasVideoDecoder = hasConstructor(source.VideoDecoder);
  const hasVideoFrame = hasConstructor(source.VideoFrame);
  const hasWorker = hasConstructor(source.Worker);
  const hasOffscreenCanvas = hasConstructor(source.OffscreenCanvas);
  const hasOffscreenCanvasBitmapTransfer =
    hasOffscreenCanvas &&
    hasPrototypeMethod(source.OffscreenCanvas, "transferToImageBitmap");
  const hasCreateImageBitmap =
    typeof source.createImageBitmap === "function";
  const hasDocumentCanvas =
    typeof source.document?.createElement === "function";

  let frameBitmapPath: FrameBitmapPath = "none";
  if (hasOffscreenCanvasBitmapTransfer) {
    frameBitmapPath = "offscreen-canvas";
  } else if (hasCreateImageBitmap && hasDocumentCanvas) {
    frameBitmapPath = "dom-canvas";
  }

  return {
    isSecureContext,
    hasVideoDecoder,
    hasVideoDecoderConfigSupport:
      hasVideoDecoder &&
      hasStaticMethod(source.VideoDecoder, "isConfigSupported"),
    hasVideoFrame,
    hasWorker,
    hasOffscreenCanvas,
    hasOffscreenCanvasBitmapTransfer,
    hasCreateImageBitmap,
    hasDocumentCanvas,
    frameBitmapPath,
  };
}

/**
 * Diagnoses browser-level readiness for local precision analysis.
 *
 * Actual container, codec, and fps checks remain video-specific and must run
 * after this preflight succeeds.
 */
export function diagnosePrecisionAnalysisCapabilities(
  source: PrecisionAnalysisCapabilitySource =
    globalThis as unknown as PrecisionAnalysisCapabilitySource,
): PrecisionAnalysisCapabilityDiagnostic {
  const facts = collectPrecisionAnalysisCapabilityFacts(source);
  const reasons: PrecisionAnalysisCapabilityMessage<PrecisionAnalysisBlockingReasonCode>[] = [];
  const warnings: PrecisionAnalysisCapabilityMessage<PrecisionAnalysisWarningCode>[] = [];

  if (facts.isSecureContext === null) {
    reasons.push({
      code: "secure-context-unknown",
      message:
        "安全な接続か確認できないため、精密解析を開始できません。HTTPSで開き直してください。",
    });
  } else if (!facts.isSecureContext) {
    reasons.push({
      code: "insecure-context",
      message:
        "精密解析には安全な接続が必要です。HTTPSで開き直してください。",
    });
  }

  if (!facts.hasVideoDecoder) {
    reasons.push({
      code: "video-decoder-unavailable",
      message:
        "このブラウザはWebCodecs VideoDecoderに対応していません。最新版のChromeまたはSafariを使用してください。",
    });
  } else if (!facts.hasVideoDecoderConfigSupport) {
    reasons.push({
      code: "video-decoder-config-check-unavailable",
      message:
        "動画コーデックの対応確認機能を利用できないため、精密解析を開始できません。最新版のChromeまたはSafariを使用してください。",
    });
  }

  if (!facts.hasVideoFrame) {
    reasons.push({
      code: "video-frame-unavailable",
      message:
        "このブラウザはWebCodecs VideoFrameに対応していないため、精密解析を開始できません。",
    });
  }

  if (!facts.hasWorker) {
    reasons.push({
      code: "worker-unavailable",
      message:
        "バックグラウンド解析を利用できないため、精密解析を開始できません。",
    });
  }

  if (facts.frameBitmapPath === "none") {
    reasons.push({
      code: "frame-bitmap-path-unavailable",
      message:
        "動画フレームを解析画像へ変換できないため、精密解析を開始できません。",
    });
  } else if (facts.frameBitmapPath === "dom-canvas") {
    warnings.push({
      code: facts.hasOffscreenCanvas
        ? "offscreen-canvas-transfer-unavailable"
        : "offscreen-canvas-unavailable",
      message:
        "OffscreenCanvasを利用できないため、解析が通常より遅くなる可能性があります。",
    });
  }

  if (
    facts.frameBitmapPath === "offscreen-canvas" &&
    !facts.hasCreateImageBitmap
  ) {
    warnings.push({
      code: "create-image-bitmap-unavailable",
      message:
        "createImageBitmapを利用できません。OffscreenCanvas経路で解析しますが、代替描画経路は使用できません。",
    });
  }

  return {
    supported: reasons.length === 0,
    facts,
    reasons,
    warnings,
  };
}
