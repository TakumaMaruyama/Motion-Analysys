import { WorkerPoseEstimator } from "@/lib/pose/worker-estimator";
import { findAudioSignalWindow } from "@/lib/start/audio-signal";
import { autoConfirmStartEvents } from "@/lib/start/auto-confirmation";
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
  readonly fixedCamera: boolean;
  readonly sideOn: boolean;
  readonly singleSwimmer: boolean;
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
  /** 校正済み確率ではなく、音声ピークの明瞭さを表す判定スコア。 */
  readonly audioSignalConfidence: number | null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("解析を中断しました。", "AbortError");
  }
}

function timestampKey(timestampMs: number): string {
  return timestampMs.toFixed(3);
}

/**
 * 音声の大きな瞬間を信号候補として返す。最終的な自動判定は、明瞭さに加えて
 * Pose初動との時間窓、撮影条件、他イベントとの依存関係も検査する。
 */
interface AudioSignalDetection {
  readonly timestampMs: number;
  readonly confidence: number;
}

async function detectAudioSignal(
  file: File,
  startMs: number,
  endMs: number,
  signal: AbortSignal,
): Promise<AudioSignalDetection | null> {
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
    const startSample = Math.max(0, Math.floor((startMs / 1000) * decoded.sampleRate));
    const endSample = Math.min(decoded.length, Math.ceil((endMs / 1000) * decoded.sampleRate));
    if (endSample <= startSample) return null;
    const windows: number[] = [];
    for (let offset = startSample; offset < endSample; offset += windowSize) {
      let sum = 0;
      let count = 0;
      const end = Math.min(endSample, offset + windowSize);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        for (let index = offset; index < end; index += 1) {
          sum += data[index] * data[index];
          count += 1;
        }
      }
      windows.push(count > 0 ? Math.sqrt(sum / count) : 0);
    }
    const candidate = findAudioSignalWindow(windows);
    if (!candidate) return null;
    return {
      timestampMs: ((startSample + candidate.windowIndex * windowSize) * 1000) / decoded.sampleRate,
      confidence: candidate.confidence,
    };
  } catch {
    // 音声トラックなし、codec非対応、ユーザーによる中断以外はPose候補にフォールバックする。
    if (signal.aborted) throw new DOMException("解析を中断しました。", "AbortError");
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/**
 * 既存のWebCodecs+Worker Pose経路を元fpsで再利用し、Startイベントを返す。
 * 撮影・スコア・時系列ポリシーを満たすイベントは未検証ベータの自動判定、
 * それ以外はコーチ確認へ安全側に倒す。
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
  const audioSignal = detectAudioSignal(request.sourceFile, request.startMs, request.endMs, signal);

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

  const audioSignalDetection = await audioSignal;
  const audioSignalTimestampMs = audioSignalDetection?.timestampMs ?? null;
  const audioSignalConfidence = audioSignalDetection?.confidence ?? null;
  throwIfAborted(signal);
  const poseFrames = [...frames.values()].sort((first, second) =>
    first.timestampMs - second.timestampMs ||
    (first.sourceFrameIndex ?? 0) - (second.sourceFrameIndex ?? 0),
  );
  const candidates = deriveStartEventCandidates({
    frames: poseFrames,
    calibration: request.calibration,
    travelDirection: request.travelDirection,
    startStyle: request.startStyle,
    signalTimestampMs: audioSignalTimestampMs,
    signalFrameIndex: audioSignalTimestampMs === null || metadata.effectiveFps === null
      ? null
      : Math.max(0, Math.round(audioSignalTimestampMs / (1000 / metadata.effectiveFps))),
    signalConfidence: audioSignalConfidence ?? 0,
  });
  const events = autoConfirmStartEvents(candidates, {
    analysisMode: request.analysisMode,
    effectiveFps: metadata.effectiveFps,
    fixedCamera: request.fixedCamera,
    sideOn: request.sideOn,
    singleSwimmer: request.singleSwimmer,
    calibration: request.calibration,
    startStyle: request.startStyle,
  });
  const automaticCount = events.filter((event) => event.status === "confirmed").length;
  const reviewCount = events.filter((event) => event.status === "candidate" || event.status === "needs-review").length;
  onProgress?.(100, `自動判定 ${automaticCount}件・コーチ確認 ${reviewCount}件`);
  return { metadata, poseFrames, events, audioSignalTimestampMs, audioSignalConfidence };
}
