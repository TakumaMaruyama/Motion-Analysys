import { WorkerPoseEstimator } from "@/lib/pose/worker-estimator";
import { deriveStartEventCandidates } from "@/lib/start/candidates";
import {
  decodeCompetitionFrames,
  getStartFpsAssessment,
  inspectCompetitionVideo,
  type CompetitionVideoMetadata,
} from "@/lib/video/competition-frame-source";
import type { PoseFrame } from "@/types/analysis";
import type {
  StartCalibrationV1,
  StartAnalysisMode,
  StartEvent,
  StartStyle,
} from "@/types/start";
import { validateStartCalibration } from "@/lib/start/calibration";

export interface StartCandidateAnalysisRequest {
  readonly sourceFile: File;
  readonly analysisMode: StartAnalysisMode;
  readonly calibration: StartCalibrationV1 | null;
  readonly travelDirection: StartCalibrationV1["travelDirection"];
  readonly startStyle: StartStyle;
  /** スタートを含む切り出し範囲。最大30秒、元fpsで精査する。 */
  readonly startMs: number;
  readonly endMs: number;
}

export interface StartCandidateAnalysisCallbacks {
  readonly signal: AbortSignal;
  readonly onProgress?: (percentage: number, message: string) => void;
}

export interface StartCandidateAnalysisResult {
  readonly metadata: CompetitionVideoMetadata;
  readonly poseFrames: readonly PoseFrame[];
  readonly events: readonly StartEvent[];
  /** Web Audio で検出した候補。取得できない場合はnullであり、0ではない。 */
  readonly audioSignalTimestampMs: number | null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("解析を中断しました。", "AbortError");
  }
}

function timestampKey(timestampMs: number): string {
  return timestampMs.toFixed(3);
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * 音声の大きな瞬間を信号「候補」として返す。音色・トラック・開始位置を
 * 仮定できないため、成功してもneeds-reviewとしてのみ使用する。
 */
async function detectAudioSignalTimestamp(
  file: File,
  signal: AbortSignal,
): Promise<number | null> {
  const browser = globalThis as typeof globalThis & {
    readonly webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor = browser.AudioContext ?? browser.webkitAudioContext;
  if (!AudioContextConstructor) return null;

  let context: AudioContext | null = null;
  try {
    throwIfAborted(signal);
    const bytes = await file.arrayBuffer();
    throwIfAborted(signal);
    context = new AudioContextConstructor();
    const decoded = await context.decodeAudioData(bytes);
    throwIfAborted(signal);
    if (decoded.length === 0 || decoded.numberOfChannels === 0) return null;

    const windowSize = Math.max(256, Math.floor(decoded.sampleRate * 0.008));
    const windows: number[] = [];
    for (let offset = 0; offset < decoded.length; offset += windowSize) {
      let sum = 0;
      let count = 0;
      const end = Math.min(decoded.length, offset + windowSize);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        for (let index = offset; index < end; index += 1) {
          sum += data[index] * data[index];
          count += 1;
        }
      }
      windows.push(count > 0 ? Math.sqrt(sum / count) : 0);
    }
    if (windows.length === 0) return null;
    const peak = Math.max(...windows);
    const noiseFloor = median(windows);
    // 無音に近いトラックや、全体が同程度に騒がしい環境音は候補化しない。
    if (!Number.isFinite(peak) || peak < 0.015 || peak < Math.max(0.02, noiseFloor * 2)) return null;
    const peakIndex = windows.findIndex((value) => value >= peak * 0.85);
    return peakIndex < 0 ? null : (peakIndex * windowSize * 1000) / decoded.sampleRate;
  } catch {
    // 音声トラックなし、codec非対応、ユーザーによる中断以外はPose候補にフォールバックする。
    if (signal.aborted) throw new DOMException("解析を中断しました。", "AbortError");
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/**
 * 既存のWebCodecs+Worker Pose経路を元fpsで再利用し、Start候補だけを返す。
 * 確定イベント・数値化はUI側のコーチ確認操作に委ねる。
 */
export async function runStartCandidateAnalysis(
  request: StartCandidateAnalysisRequest,
  callbacks: StartCandidateAnalysisCallbacks,
): Promise<StartCandidateAnalysisResult> {
  const { signal, onProgress } = callbacks;
  throwIfAborted(signal);
  if (request.analysisMode === "precision") {
    if (request.calibration === null) throw new Error("精密モードには0m・5m・水面の校正が必要です。");
    validateStartCalibration(request.calibration);
  } else if (request.calibration !== null) {
    validateStartCalibration(request.calibration);
  }
  if (!Number.isFinite(request.startMs) || !Number.isFinite(request.endMs) || request.endMs <= request.startMs) {
    throw new RangeError("スタート解析範囲は正の長さで指定してください。");
  }

  onProgress?.(2, "動画情報を確認しています");
  const metadata = await inspectCompetitionVideo(request.sourceFile, signal);
  const assessment = getStartFpsAssessment(metadata, request.analysisMode);
  if (!assessment.allowed) {
    throw new Error(assessment.message ?? "この動画ではStart解析を実行できません。");
  }
  if (request.endMs > metadata.durationMs + 1) {
    throw new RangeError("解析範囲が動画の長さを超えています。");
  }

  const estimator = new WorkerPoseEstimator();
  const frames = new Map<string, PoseFrame>();
  const analysisDuration = request.endMs - request.startMs;
  const audioSignal = detectAudioSignalTimestamp(request.sourceFile, signal);

  try {
    onProgress?.(6, "姿勢推定モデルを準備しています");
    await estimator.init();
    throwIfAborted(signal);

    await decodeCompetitionFrames(request.sourceFile, {
      startMs: request.startMs,
      endMs: request.endMs,
      targetFps: null,
      mode: "start",
      startAnalysisMode: request.analysisMode,
      signal,
      onFrame: async (decodedFrame) => {
        throwIfAborted(signal);
        const poseFrame = await estimator.estimate(decodedFrame.bitmap, decodedFrame.timestampMs);
        if (poseFrame) {
          frames.set(timestampKey(decodedFrame.timestampMs), {
            ...poseFrame,
            sourceFrameIndex: decodedFrame.frameIndex,
          });
        }
        const elapsed = decodedFrame.timestampMs - request.startMs;
        onProgress?.(
          8 + 84 * Math.min(1, Math.max(0, elapsed / analysisDuration)),
          `スタート局面を解析中（${frames.size} Poseフレーム）`,
        );
      },
    });
    throwIfAborted(signal);
  } finally {
    await estimator.close().catch(() => undefined);
  }

  const audioSignalTimestampMs = await audioSignal;
  throwIfAborted(signal);
  const poseFrames = [...frames.values()].sort((first, second) =>
    first.timestampMs - second.timestampMs ||
    (first.sourceFrameIndex ?? 0) - (second.sourceFrameIndex ?? 0),
  );
  const events = deriveStartEventCandidates({
    frames: poseFrames,
    calibration: request.calibration,
    travelDirection: request.travelDirection,
    startStyle: request.startStyle,
    signalTimestampMs: audioSignalTimestampMs,
  });
  onProgress?.(100, "自動候補を作成しました。フレームを確認して確定してください。");
  return { metadata, poseFrames, events, audioSignalTimestampMs };
}
