import type {
  Input,
  InputVideoTrack,
  Rotation,
  VideoSample,
} from "mediabunny";

import type { AnalysisMode } from "@/types/competition";

const SUPPORTED_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
const SUPPORTED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export const MAX_ANALYSIS_DURATION_MS = 30_000;
export const MIN_SWIM_FPS = 30;
export const MIN_TURN_FPS = 60;
export const MIN_START_FPS = 60;
export const RECOMMENDED_START_FPS = 120;

export type CompetitionVideoIssue =
  | "unsupported-container"
  | "missing-video-track"
  | "webcodecs-unavailable"
  | "unsupported-codec"
  | "fps-unavailable"
  | "fps-below-swim-minimum";

export interface CompetitionVideoMetadata {
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly declaredMimeType: string;
  readonly detectedMimeType: string;
  readonly codec: string | null;
  readonly codecParameterString: string | null;
  readonly durationMs: number;
  readonly firstTimestampMs: number;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly rotation: Rotation;
  /** コンテナ内packet時刻から求めた平均実効fps。 */
  readonly effectiveFps: number | null;
  readonly estimatedFrameCount: number | null;
  readonly canDecode: boolean;
  readonly precisionAnalysisAllowed: boolean;
  readonly issues: readonly CompetitionVideoIssue[];
}

export interface CompetitionVideoFrameTimeline {
  /** 動画先頭を0とした、全フレームのpresentation timestamp。 */
  readonly timestampsMs: readonly number[];
  readonly firstTimestampMs: number;
}

export interface AnalysisWindow {
  readonly startMs: number;
  readonly endMs: number;
}

export interface DecodedCompetitionFrame {
  /** 回転を適用済みの表示向きのbitmap。callback完了直後に解放される。 */
  readonly bitmap: ImageBitmap;
  /** 動画先頭を0としたpresentation timestamp。 */
  readonly timestampMs: number;
  /** コンテナに格納された未補正のpresentation timestamp。 */
  readonly sourceTimestampMs: number;
  readonly durationMs: number;
  readonly frameIndex: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
}

export interface DecodeCompetitionFramesOptions extends AnalysisWindow {
  /** nullなら元fps。数値ならpresentation timestampをその頻度で間引く。 */
  readonly targetFps: number | null;
  readonly mode?: AnalysisMode;
  readonly signal?: AbortSignal;
  readonly onFrame: (
    frame: DecodedCompetitionFrame,
  ) => void | Promise<void>;
}

export interface TwoPassDecodeOptions extends AnalysisWindow {
  readonly mode?: AnalysisMode;
  readonly coarseFps?: number;
  readonly finePaddingMs?: number;
  readonly signal?: AbortSignal;
  readonly onCoarseFrame: DecodeCompetitionFramesOptions["onFrame"];
  /** 粗解析結果から、ゲート通過やストローク候補の時刻を返す。 */
  readonly getCandidateTimestampsMs: () =>
    | readonly number[]
    | Promise<readonly number[]>;
  readonly onFineFrame: DecodeCompetitionFramesOptions["onFrame"];
}

interface OpenCompetitionVideo {
  readonly input: Input;
  readonly track: InputVideoTrack;
}

const frameTimelineCache = new WeakMap<
  File,
  Promise<CompetitionVideoFrameTimeline>
>();

export class CompetitionVideoError extends Error {
  constructor(
    message: string,
    readonly code:
      | CompetitionVideoIssue
      | "invalid-analysis-window"
      | "analysis-window-too-long"
      | "analysis-canceled",
  ) {
    super(message);
    this.name = "CompetitionVideoError";
  }
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isSupportedCompetitionVideoFile(
  file: Pick<File, "name" | "type">,
): boolean {
  const mimeType = file.type.toLowerCase().split(";", 1)[0];
  return (
    SUPPORTED_EXTENSIONS.has(fileExtension(file.name)) ||
    SUPPORTED_MIME_TYPES.has(mimeType)
  );
}

function abortError(): CompetitionVideoError {
  return new CompetitionVideoError("解析を中断しました。", "analysis-canceled");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function normalizeWindow(
  window: AnalysisWindow,
  durationMs: number,
): AnalysisWindow {
  const startMs = Math.max(0, window.startMs);
  const endMs = Math.min(durationMs, window.endMs);

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    throw new CompetitionVideoError(
      "解析区間の開始と終了を確認してください。",
      "invalid-analysis-window",
    );
  }

  if (endMs - startMs > MAX_ANALYSIS_DURATION_MS + 0.001) {
    throw new CompetitionVideoError(
      "解析区間は30秒以内にしてください。",
      "analysis-window-too-long",
    );
  }

  return { startMs, endMs };
}

export function buildSampleTimestampsMs(
  window: AnalysisWindow,
  targetFps: number,
): number[] {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new RangeError("targetFps must be a positive finite number.");
  }

  const durationMs = window.endMs - window.startMs;
  if (durationMs <= 0) {
    return [];
  }

  const intervalMs = 1_000 / targetFps;
  const timestamps: number[] = [];
  for (
    let timestampMs = window.startMs;
    timestampMs < window.endMs - 0.001;
    timestampMs += intervalMs
  ) {
    timestamps.push(timestampMs);
  }
  return timestamps;
}

export function buildFineAnalysisWindows(
  candidateTimestampsMs: readonly number[],
  bounds: AnalysisWindow,
  paddingMs = 350,
): AnalysisWindow[] {
  if (!Number.isFinite(paddingMs) || paddingMs < 0) {
    throw new RangeError("paddingMs must be a non-negative finite number.");
  }

  const windows = candidateTimestampsMs
    .filter(Number.isFinite)
    .map((timestampMs) => ({
      startMs: Math.max(bounds.startMs, timestampMs - paddingMs),
      endMs: Math.min(bounds.endMs, timestampMs + paddingMs),
    }))
    .filter(({ startMs, endMs }) => endMs > startMs)
    .sort((left, right) => left.startMs - right.startMs);

  const merged: AnalysisWindow[] = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (!previous || window.startMs > previous.endMs) {
      merged.push(window);
      continue;
    }

    merged[merged.length - 1] = {
      startMs: previous.startMs,
      endMs: Math.max(previous.endMs, window.endMs),
    };
  }

  return merged;
}

function requiredFps(mode: AnalysisMode): number {
  if (mode === "turn") return MIN_TURN_FPS;
  if (mode === "start") return MIN_START_FPS;
  return MIN_SWIM_FPS;
}

export function getModeFpsAssessment(
  metadata: Pick<CompetitionVideoMetadata, "effectiveFps" | "canDecode">,
  mode: AnalysisMode,
): { readonly allowed: boolean; readonly message: string | null } {
  if (!metadata.canDecode) {
    return {
      allowed: false,
      message:
        "このブラウザでは動画コーデックを精密解析できません。MP4（H.264）またはWebMで撮り直してください。",
    };
  }

  if (metadata.effectiveFps === null) {
    return {
      allowed: false,
      message: "動画のfpsを確認できないため、精密解析は実行できません。",
    };
  }

  const minimum = requiredFps(mode);
  if (metadata.effectiveFps + 0.05 < minimum) {
    return {
      allowed: false,
      message: `${mode === "swim" ? "Swim" : mode === "turn" ? "Turn" : "Start"}解析には${minimum}fps以上の固定撮影動画が必要です。`,
    };
  }

  if (mode === "start" && metadata.effectiveFps < RECOMMENDED_START_FPS) {
    return {
      allowed: true,
      message:
        "Start解析は実行できますが、入水・離台の確認には120fpsを推奨します。",
    };
  }

  return { allowed: true, message: null };
}

async function openCompetitionVideo(
  file: File,
  signal?: AbortSignal,
): Promise<OpenCompetitionVideo> {
  throwIfAborted(signal);

  if (!isSupportedCompetitionVideoFile(file)) {
    throw new CompetitionVideoError(
      "MP4・MOV・WebMの動画を選択してください。",
      "unsupported-container",
    );
  }

  const { ALL_FORMATS, BlobSource, Input: MediabunnyInput } = await import(
    "mediabunny"
  );
  throwIfAborted(signal);

  const input = new MediabunnyInput({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });

  try {
    if (!(await input.canRead())) {
      throw new CompetitionVideoError(
        "動画コンテナを読み取れません。MP4・MOV・WebMへ変換してください。",
        "unsupported-container",
      );
    }

    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new CompetitionVideoError(
        "動画トラックが見つかりません。",
        "missing-video-track",
      );
    }

    return { input, track };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

export async function inspectCompetitionVideo(
  file: File,
  signal?: AbortSignal,
): Promise<CompetitionVideoMetadata> {
  const { input, track } = await openCompetitionVideo(file, signal);
  const abortListener = () => input.dispose();
  signal?.addEventListener("abort", abortListener, { once: true });

  try {
    const webCodecsAvailable =
      typeof globalThis.VideoDecoder !== "undefined" &&
      typeof globalThis.VideoFrame !== "undefined";

    const [
      detectedMimeType,
      codec,
      codecParameterString,
      durationSeconds,
      firstTimestampSeconds,
      codedWidth,
      codedHeight,
      displayWidth,
      displayHeight,
      rotation,
      packetStats,
      trackCanDecode,
    ] = await Promise.all([
      input.getMimeType(),
      track.getCodec(),
      track.getCodecParameterString(),
      track.computeDuration(),
      track.getFirstTimestamp(),
      track.getCodedWidth(),
      track.getCodedHeight(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getRotation(),
      track.computePacketStats(600),
      webCodecsAvailable ? track.canDecode() : Promise.resolve(false),
    ]);
    throwIfAborted(signal);

    const effectiveFps =
      Number.isFinite(packetStats.averagePacketRate) &&
      packetStats.averagePacketRate > 0
        ? packetStats.averagePacketRate
        : null;
    const canDecode = webCodecsAvailable && trackCanDecode;
    const issues: CompetitionVideoIssue[] = [];
    if (!webCodecsAvailable) issues.push("webcodecs-unavailable");
    else if (!trackCanDecode) issues.push("unsupported-codec");
    if (effectiveFps === null) issues.push("fps-unavailable");
    else if (effectiveFps + 0.05 < MIN_SWIM_FPS) {
      issues.push("fps-below-swim-minimum");
    }

    const durationMs = Math.max(
      0,
      (durationSeconds - firstTimestampSeconds) * 1_000,
    );

    return {
      fileName: file.name,
      fileSizeBytes: file.size,
      declaredMimeType: file.type,
      detectedMimeType,
      codec,
      codecParameterString,
      durationMs,
      firstTimestampMs: firstTimestampSeconds * 1_000,
      codedWidth,
      codedHeight,
      displayWidth,
      displayHeight,
      rotation,
      effectiveFps,
      estimatedFrameCount:
        effectiveFps === null
          ? null
          : Math.max(0, Math.round((durationMs / 1_000) * effectiveFps)),
      canDecode,
      precisionAnalysisAllowed:
        canDecode && effectiveFps !== null && effectiveFps + 0.05 >= MIN_SWIM_FPS,
      issues,
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortListener);
    if (!input.disposed) input.dispose();
  }
}

async function readCompetitionFrameTimeline(
  file: File,
  signal?: AbortSignal,
): Promise<CompetitionVideoFrameTimeline> {
  const { input, track } = await openCompetitionVideo(file, signal);
  const abortListener = () => input.dispose();
  signal?.addEventListener("abort", abortListener, { once: true });

  try {
    const { EncodedPacketSink } = await import("mediabunny");
    const sink = new EncodedPacketSink(track);
    const firstTimestampMs = (await track.getFirstTimestamp()) * 1_000;
    const sourceTimestampsMs: number[] = [];
    for await (const packet of sink.packets(undefined, undefined, {
      metadataOnly: true,
    })) {
      throwIfAborted(signal);
      sourceTimestampsMs.push(packet.timestamp * 1_000);
    }
    sourceTimestampsMs.sort((left, right) => left - right);

    return {
      firstTimestampMs,
      timestampsMs: sourceTimestampsMs.map(
        (timestampMs) => timestampMs - firstTimestampMs,
      ),
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortListener);
    if (!input.disposed) input.dispose();
  }
}

/** raw frameを保持せず、元動画の表示時刻列だけを取得・再利用する。 */
export function getCompetitionVideoFrameTimeline(
  file: File,
  signal?: AbortSignal,
): Promise<CompetitionVideoFrameTimeline> {
  throwIfAborted(signal);
  const cached = frameTimelineCache.get(file);
  if (cached) return cached;

  const pending = readCompetitionFrameTimeline(file, signal).catch((error) => {
    frameTimelineCache.delete(file);
    throw error;
  });
  frameTimelineCache.set(file, pending);
  return pending;
}

export function findNearestFrameIndex(
  timestampsMs: readonly number[],
  timestampMs: number,
  fallbackFps: number | null,
): number {
  if (timestampsMs.length === 0) {
    return fallbackFps === null
      ? 0
      : Math.max(0, Math.round((timestampMs / 1_000) * fallbackFps));
  }

  let low = 0;
  let high = timestampsMs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestampsMs[middle] < timestampMs) low = middle + 1;
    else high = middle;
  }

  if (low === 0) return 0;
  if (low === timestampsMs.length) return timestampsMs.length - 1;
  return timestampMs - timestampsMs[low - 1] <= timestampsMs[low] - timestampMs
    ? low - 1
    : low;
}

async function sampleToImageBitmap(sample: VideoSample): Promise<ImageBitmap> {
  const width = sample.displayWidth;
  const height = sample.displayHeight;

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvasを初期化できません。");
    sample.draw(context, 0, 0, width, height);
    return canvas.transferToImageBitmap();
  }

  if (typeof document === "undefined") {
    throw new Error("動画フレームを描画できる環境ではありません。");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvasを初期化できません。");
  sample.draw(context, 0, 0, width, height);
  return createImageBitmap(canvas);
}

async function consumeSample(
  sample: VideoSample,
  metadata: CompetitionVideoMetadata,
  frameTimeline: CompetitionVideoFrameTimeline,
  onFrame: DecodeCompetitionFramesOptions["onFrame"],
  signal?: AbortSignal,
): Promise<void> {
  let bitmap: ImageBitmap | null = null;
  try {
    throwIfAborted(signal);
    bitmap = await sampleToImageBitmap(sample);
    throwIfAborted(signal);
    const sourceTimestampMs = sample.timestamp * 1_000;
    const relativeTimestampMs = sourceTimestampMs - metadata.firstTimestampMs;
    const frameIndex = findNearestFrameIndex(
      frameTimeline.timestampsMs,
      relativeTimestampMs,
      metadata.effectiveFps,
    );

    await onFrame({
      bitmap,
      timestampMs: relativeTimestampMs,
      sourceTimestampMs,
      durationMs: sample.duration * 1_000,
      frameIndex,
      displayWidth: sample.displayWidth,
      displayHeight: sample.displayHeight,
    });
  } finally {
    try {
      bitmap?.close();
    } catch {
      // Workerへtransfer済みの場合もあり、所有側ですでに解放済みなら何もしない。
    }
    sample.close();
  }
}

export async function decodeCompetitionFrames(
  file: File,
  options: DecodeCompetitionFramesOptions,
): Promise<CompetitionVideoMetadata> {
  const metadata = await inspectCompetitionVideo(file, options.signal);
  const frameTimeline = await getCompetitionVideoFrameTimeline(
    file,
    options.signal,
  );
  const assessment = getModeFpsAssessment(metadata, options.mode ?? "swim");
  if (!assessment.allowed) {
    throw new CompetitionVideoError(
      assessment.message ?? "この動画は精密解析できません。",
      metadata.issues[0] ?? "unsupported-codec",
    );
  }

  const analysisWindow = normalizeWindow(options, metadata.durationMs);
  const { input, track } = await openCompetitionVideo(file, options.signal);
  const abortListener = () => input.dispose();
  options.signal?.addEventListener("abort", abortListener, { once: true });

  try {
    const { VideoSampleSink } = await import("mediabunny");
    const sink = new VideoSampleSink(track);
    const firstTimestampSeconds = metadata.firstTimestampMs / 1_000;
    const startSeconds = firstTimestampSeconds + analysisWindow.startMs / 1_000;
    const endSeconds = firstTimestampSeconds + analysisWindow.endMs / 1_000;

    if (options.targetFps === null) {
      for await (const sample of sink.samples(startSeconds, endSeconds)) {
        await consumeSample(
          sample,
          metadata,
          frameTimeline,
          options.onFrame,
          options.signal,
        );
      }
    } else {
      const timestampsSeconds = buildSampleTimestampsMs(
        analysisWindow,
        options.targetFps,
      ).map((timestampMs) => firstTimestampSeconds + timestampMs / 1_000);
      let previousTimestamp = Number.NEGATIVE_INFINITY;
      for await (const sample of sink.samplesAtTimestamps(timestampsSeconds)) {
        if (!sample) continue;
        if (sample.timestamp <= previousTimestamp + Number.EPSILON) {
          sample.close();
          continue;
        }
        previousTimestamp = sample.timestamp;
        await consumeSample(
          sample,
          metadata,
          frameTimeline,
          options.onFrame,
          options.signal,
        );
      }
    }

    throwIfAborted(options.signal);
    return metadata;
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortListener);
    if (!input.disposed) input.dispose();
  }
}

/**
 * 15〜30fpsの粗解析後、候補前後だけを元fpsで再解析する共通デコード経路。
 * 候補がない場合はfine passを行わない。
 */
export async function decodeCompetitionVideoTwoPasses(
  file: File,
  options: TwoPassDecodeOptions,
): Promise<CompetitionVideoMetadata> {
  const coarseFps = Math.min(30, Math.max(15, options.coarseFps ?? 20));
  const metadata = await decodeCompetitionFrames(file, {
    startMs: options.startMs,
    endMs: options.endMs,
    targetFps: coarseFps,
    mode: options.mode,
    signal: options.signal,
    onFrame: options.onCoarseFrame,
  });

  const candidateTimestampsMs = await options.getCandidateTimestampsMs();
  throwIfAborted(options.signal);
  const windows = buildFineAnalysisWindows(
    candidateTimestampsMs,
    normalizeWindow(options, metadata.durationMs),
    options.finePaddingMs,
  );

  for (const window of windows) {
    await decodeCompetitionFrames(file, {
      ...window,
      targetFps: null,
      mode: options.mode,
      signal: options.signal,
      onFrame: options.onFineFrame,
    });
  }

  return metadata;
}
