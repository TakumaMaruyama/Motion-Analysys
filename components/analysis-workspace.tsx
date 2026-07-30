"use client";

import {
  Activity,
  Camera,
  Check,
  ChevronLeft,
  CircleStop,
  FileJson,
  FileSpreadsheet,
  ImageDown,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCcw,
  ShieldCheck,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { buildAnalysisResult, getTrajectoryPoints, TRAJECTORY_LABELS } from "@/lib/pose/analysis";
import {
  drawPoseOverlay,
  drawSourceFrame,
  drawTrajectory,
  drawWorldPose,
} from "@/lib/pose/drawing";
import {
  createAnalysisExportBundle,
} from "@/lib/pose/export";
import { createFixedSampleTimestamps } from "@/lib/pose/metrics";
import { WorkerPoseEstimator } from "@/lib/pose/worker-estimator";
import type {
  AnalysisInputInfo,
  AnalysisResultV1,
  MetricValue,
  PoseFrame,
} from "@/types/analysis";

const VIDEO_SAMPLE_RATE_HZ = 15;
const LIVE_SAMPLE_RATE_HZ = 15;
const MAX_VIDEO_DURATION_MS = 3 * 60 * 1000;

type AnalysisStep = "input" | "preview" | "analyzing" | "results";

interface LocalSource {
  readonly kind: "camera" | "video";
  readonly name: string | null;
  readonly mimeType: string | null;
  readonly objectUrl: string | null;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number | null;
  readonly mirrored: boolean;
}

const STEP_LABELS = [
  { id: "input", label: "撮影・動画選択" },
  { id: "preview", label: "全身確認" },
  { id: "analyzing", label: "解析" },
  { id: "results", label: "結果" },
] as const satisfies readonly {
  id: AnalysisStep;
  label: string;
}[];

const TRAJECTORY_COLORS: Record<keyof typeof TRAJECTORY_LABELS, string> = {
  leftWrist: "#818cf8",
  rightWrist: "#38bdf8",
  leftAnkle: "#f472b6",
  rightAnkle: "#fb923c",
  hipCenter: "#34d399",
};

function stepIndex(step: AnalysisStep): number {
  return STEP_LABELS.findIndex((item) => item.id === step);
}

function formatTime(timestampMs: number | null): string {
  if (timestampMs === null || !Number.isFinite(timestampMs)) {
    return "—";
  }
  const seconds = timestampMs / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function formatMetric(metric: MetricValue | undefined): string {
  if (!metric || metric.status !== "valid" || metric.value === null) {
    return "—";
  }
  if (metric.unit === "deg") {
    return `${metric.value.toFixed(1)}°`;
  }
  if (metric.unit === "normalized") {
    return metric.value.toFixed(3);
  }
  return `${metric.value.toFixed(2)} ${metric.unit}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "カメラを利用できません。ブラウザのカメラ許可を確認するか、動画を選択してください。";
    }
    if (error.name === "NotFoundError") {
      return "利用できるカメラが見つかりませんでした。";
    }
    if (error.name === "AbortError") {
      return "解析をキャンセルしました。";
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "処理中に予期しないエラーが発生しました。";
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked" | "loadeddata",
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("動画を読み込めませんでした。対応するMP4またはWebMを選んでください。"));
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Analysis cancelled", "AbortError"));
    };
    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener("error", handleError, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function seekVideo(
  video: HTMLVideoElement,
  timestampMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new DOMException("Analysis cancelled", "AbortError");
  }
  const seconds = timestampMs / 1000;
  if (Math.abs(video.currentTime - seconds) < 0.0005 && video.readyState >= 2) {
    await waitForVideoPaint(signal);
    await waitForVideoPaint(signal);
    return;
  }
  const seeked = waitForVideoEvent(video, "seeked", signal);
  video.currentTime = seconds;
  await seeked;
  // Safariではseeked直後のcanvas描画がひとつ前の合成フレームを参照する
  // 場合がある。2回のpaintを待ち、同じ時刻から同じ画素を取得する。
  await waitForVideoPaint(signal);
  await waitForVideoPaint(signal);
}

function waitForVideoPaint(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Analysis cancelled", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      cancelAnimationFrame(requestId);
      reject(new DOMException("Analysis cancelled", "AbortError"));
    };
    const requestId = requestAnimationFrame(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    });
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function bitmapFromVideo(video: HTMLVideoElement): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("このブラウザは映像フレームの解析に対応していません。ChromeまたはSafariの現行版をお使いください。");
  }
  try {
    return await createImageBitmap(video);
  } catch {
    // Safari can reject HTMLVideoElement even after `seeked`. Drawing to a
    // short-lived canvas avoids retaining ImageData while keeping the worker
    // contract as a transferable ImageBitmap.
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
      throw new Error("動画フレームを読み取れませんでした。別の動画形式をお試しください。");
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      return await createImageBitmap(canvas);
    } catch {
      throw new Error("動画フレームを読み取れませんでした。ChromeまたはSafariの現行版で、MP4またはWebMをお試しください。");
    }
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function resultFileStem(result: AnalysisResultV1): string {
  const base = result.input.name?.replace(/\.[^.]+$/, "") ?? "camera";
  const safe = base.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80);
  return `motion-analysis-${safe || "result"}`;
}

export function AnalysisWorkspace() {
  const [step, setStep] = useState<AnalysisStep>("input");
  const [source, setSource] = useState<LocalSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [detectedCount, setDetectedCount] = useState(0);
  const [latestFrame, setLatestFrame] = useState<PoseFrame | null>(null);
  const [result, setResult] = useState<AnalysisResultV1 | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [cameraElapsedMs, setCameraElapsedMs] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const worldCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const estimatorRef = useRef<WorkerPoseEstimator | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cameraLoopActiveRef = useRef(false);
  const cameraFrameRequestRef = useRef<number | null>(null);
  const cameraFallbackRequestRef = useRef<number | null>(null);
  const framesRef = useRef<PoseFrame[]>([]);
  const sampleTimestampsRef = useRef<number[]>([]);
  const sourceRef = useRef<LocalSource | null>(null);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const currentFrame = useMemo(() => {
    if (!result) {
      return latestFrame;
    }
    return result.frames[selectedFrameIndex] ?? null;
  }, [latestFrame, result, selectedFrameIndex]);

  const clearFrameRequest = useCallback(() => {
    const video = videoRef.current;
    if (
      video &&
      cameraFrameRequestRef.current !== null &&
      "cancelVideoFrameCallback" in video
    ) {
      video.cancelVideoFrameCallback(cameraFrameRequestRef.current);
    }
    if (cameraFallbackRequestRef.current !== null) {
      cancelAnimationFrame(cameraFallbackRequestRef.current);
    }
    cameraFrameRequestRef.current = null;
    cameraFallbackRequestRef.current = null;
  }, []);

  const closeEstimator = useCallback(async () => {
    const estimator = estimatorRef.current;
    estimatorRef.current = null;
    if (estimator) {
      await estimator.close().catch(() => undefined);
    }
  }, []);

  const stopCameraLoop = useCallback(() => {
    cameraLoopActiveRef.current = false;
    clearFrameRequest();
  }, [clearFrameRequest]);

  const releaseSource = useCallback(() => {
    stopCameraLoop();
    stopStream(streamRef.current);
    streamRef.current = null;
    const currentSource = sourceRef.current;
    if (currentSource?.objectUrl) {
      URL.revokeObjectURL(currentSource.objectUrl);
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }
  }, [stopCameraLoop]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      releaseSource();
      void closeEstimator();
    };
  }, [closeEstimator, releaseSource]);

  const reset = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    releaseSource();
    await closeEstimator();
    framesRef.current = [];
    sampleTimestampsRef.current = [];
    setSource(null);
    setResult(null);
    setLatestFrame(null);
    setSelectedFrameIndex(0);
    setProgress(0);
    setProcessedCount(0);
    setDetectedCount(0);
    setCameraElapsedMs(0);
    setError(null);
    setStep("input");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [closeEstimator, releaseSource]);

  const configureVideoSource = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith("video/")) {
        setError("対応していないファイル形式です。MP4またはWebMなどの動画を選んでください。");
        return;
      }
      const video = videoRef.current;
      if (!video) {
        return;
      }

      releaseSource();
      await closeEstimator();
      const objectUrl = URL.createObjectURL(file);
      video.srcObject = null;
      video.src = objectUrl;
      video.muted = true;
      video.playsInline = true;

      try {
        if (video.readyState < 1) {
          await waitForVideoEvent(video, "loadedmetadata");
        }
        const durationMs = video.duration * 1000;
        if (
          !Number.isFinite(durationMs) ||
          durationMs <= 0 ||
          video.videoWidth <= 0 ||
          video.videoHeight <= 0
        ) {
          throw new Error("動画の長さまたはサイズを読み取れませんでした。");
        }
        if (durationMs > MAX_VIDEO_DURATION_MS) {
          throw new Error("v1では3分以内の動画を選んでください。");
        }
        const nextSource: LocalSource = {
          kind: "video",
          name: file.name,
          mimeType: file.type,
          objectUrl,
          width: video.videoWidth,
          height: video.videoHeight,
          durationMs,
          mirrored: false,
        };
        setSource(nextSource);
        setResult(null);
        setLatestFrame(null);
        setStep("preview");
      } catch (caughtError) {
        URL.revokeObjectURL(objectUrl);
        video.removeAttribute("src");
        video.load();
        setError(errorMessage(caughtError));
      }
    },
    [closeEstimator, releaseSource],
  );

  const onFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void configureVideoSource(file);
      }
    },
    [configureVideoSource],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) {
        void configureVideoSource(file);
      }
    },
    [configureVideoSource],
  );

  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("このブラウザではカメラを利用できません。動画ファイルを選択してください。");
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }

    releaseSource();
    await closeEstimator();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      video.removeAttribute("src");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      if (video.readyState < 1) {
        await waitForVideoEvent(video, "loadedmetadata");
      }
      setSource({
        kind: "camera",
        name: null,
        mimeType: null,
        objectUrl: null,
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
        durationMs: null,
        mirrored: true,
      });
      setStep("preview");
    } catch (caughtError) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setError(errorMessage(caughtError));
    }
  }, [closeEstimator, releaseSource]);

  const prepareEstimator = useCallback(async () => {
    await closeEstimator();
    const estimator = new WorkerPoseEstimator();
    estimatorRef.current = estimator;
    await estimator.init();
    return estimator;
  }, [closeEstimator]);

  const updateOverlay = useCallback(
    (
      frame: PoseFrame | null,
      trajectoryResult: AnalysisResultV1 | null = null,
    ) => {
      const canvas = overlayRef.current;
      const activeSource = sourceRef.current;
      if (!canvas || !activeSource) {
        return;
      }
      if (
        canvas.width !== activeSource.width ||
        canvas.height !== activeSource.height
      ) {
        canvas.width = activeSource.width;
        canvas.height = activeSource.height;
      }
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      const dimensions = { width: canvas.width, height: canvas.height };
      if (trajectoryResult) {
        (
          Object.keys(TRAJECTORY_LABELS) as (keyof typeof TRAJECTORY_LABELS)[]
        ).forEach((key) => {
          drawTrajectory(
            context,
            getTrajectoryPoints(trajectoryResult.frames, key),
            dimensions,
            TRAJECTORY_COLORS[key],
            activeSource.mirrored,
          );
        });
      }
      drawPoseOverlay(context, frame, dimensions, {
        mirrored: activeSource.mirrored,
      });
    },
    [],
  );

  useEffect(() => {
    updateOverlay(currentFrame, result);
  }, [currentFrame, result, updateOverlay]);

  useEffect(() => {
    const canvas = worldCanvasRef.current;
    if (!canvas || step !== "results") {
      return;
    }
    canvas.width = 360;
    canvas.height = 300;
    const context = canvas.getContext("2d");
    if (context) {
      drawWorldPose(context, currentFrame, {
        width: canvas.width,
        height: canvas.height,
      });
    }
  }, [currentFrame, step]);

  const runVideoAnalysis = useCallback(async () => {
    const activeSource = sourceRef.current;
    const video = videoRef.current;
    if (
      !activeSource ||
      activeSource.kind !== "video" ||
      activeSource.durationMs === null ||
      !video
    ) {
      return;
    }

    setError(null);
    setStep("analyzing");
    setProgress(0);
    setProcessedCount(0);
    setDetectedCount(0);
    setResult(null);
    framesRef.current = [];
    sampleTimestampsRef.current = [];
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const estimator = await prepareEstimator();
      const timestamps = createFixedSampleTimestamps(
        activeSource.durationMs,
        VIDEO_SAMPLE_RATE_HZ,
      );
      sampleTimestampsRef.current = [...timestamps];
      video.pause();

      for (let index = 0; index < timestamps.length; index += 1) {
        if (controller.signal.aborted) {
          throw new DOMException("Analysis cancelled", "AbortError");
        }
        const timestampMs = timestamps[index];
        await seekVideo(video, timestampMs, controller.signal);
        const bitmap = await bitmapFromVideo(video);
        const frame = await estimator.estimate(bitmap, timestampMs);
        if (frame) {
          framesRef.current.push(frame);
          setLatestFrame(frame);
          setDetectedCount(framesRef.current.length);
          updateOverlay(frame);
        }
        setProcessedCount(index + 1);
        setProgress(((index + 1) / timestamps.length) * 100);
      }

      if (framesRef.current.length === 0) {
        throw new Error("人物を検出できませんでした。全身が入った明るい動画で、もう一度お試しください。");
      }
      const input: AnalysisInputInfo = {
        kind: activeSource.kind,
        name: activeSource.name,
        mimeType: activeSource.mimeType,
        width: activeSource.width,
        height: activeSource.height,
        durationMs: activeSource.durationMs,
        mirrored: activeSource.mirrored,
      };
      const nextResult = buildAnalysisResult(
        framesRef.current,
        input,
        VIDEO_SAMPLE_RATE_HZ,
        sampleTimestampsRef.current,
      );
      const firstResultFrame = nextResult.frames[0];
      if (firstResultFrame) {
        await seekVideo(
          video,
          firstResultFrame.timestampMs,
          controller.signal,
        );
      }
      // 結果画面を表示する前にWorkerとLandmarkerを完全に閉じる。
      // 続けて同じ動画を解析した場合も、前回のruntime状態を残さない。
      await closeEstimator();
      setResult(nextResult);
      setSelectedFrameIndex(0);
      setLatestFrame(nextResult.frames[0] ?? null);
      setStep("results");
    } catch (caughtError) {
      if (controller.signal.aborted) {
        setStep("preview");
      } else {
        setError(errorMessage(caughtError));
        setStep("preview");
      }
    } finally {
      abortRef.current = null;
      await closeEstimator();
    }
  }, [closeEstimator, prepareEstimator, updateOverlay]);

  const scheduleCameraFrame = useCallback(
    (callback: (mediaTimeMs: number) => void) => {
      const video = videoRef.current;
      if (!video || !cameraLoopActiveRef.current) {
        return;
      }
      const requestVideoFrame = (
        video as unknown as {
          requestVideoFrameCallback?: (
            callback: VideoFrameRequestCallback,
          ) => number;
        }
      ).requestVideoFrameCallback;
      if (requestVideoFrame) {
        cameraFrameRequestRef.current = requestVideoFrame.call(
          video,
          (_now, metadata) => callback(metadata.mediaTime * 1000),
        );
      } else {
        cameraFallbackRequestRef.current = requestAnimationFrame(() =>
          callback(video.currentTime * 1000),
        );
      }
    },
    [],
  );

  const startCameraAnalysis = useCallback(async () => {
    const activeSource = sourceRef.current;
    const video = videoRef.current;
    if (!activeSource || activeSource.kind !== "camera" || !video) {
      return;
    }
    setError(null);
    setStep("analyzing");
    setProcessedCount(0);
    setDetectedCount(0);
    setCameraElapsedMs(0);
    setResult(null);
    framesRef.current = [];
    sampleTimestampsRef.current = [];
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const estimator = await prepareEstimator();
      cameraLoopActiveRef.current = true;
      let originMediaTimeMs: number | null = null;
      let lastSampleTimestampMs = Number.NEGATIVE_INFINITY;

      const processFrame = async (mediaTimeMs: number): Promise<void> => {
        if (
          !cameraLoopActiveRef.current ||
          controller.signal.aborted ||
          !videoRef.current
        ) {
          return;
        }
        originMediaTimeMs ??= mediaTimeMs;
        const timestampMs = Math.max(0, mediaTimeMs - originMediaTimeMs);
        if (
          timestampMs - lastSampleTimestampMs <
          1000 / LIVE_SAMPLE_RATE_HZ - 0.5
        ) {
          scheduleCameraFrame((nextTime) => {
            void processFrame(nextTime);
          });
          return;
        }
        lastSampleTimestampMs = timestampMs;
        sampleTimestampsRef.current.push(timestampMs);

        try {
          const bitmap = await bitmapFromVideo(videoRef.current);
          const frame = await estimator.estimate(bitmap, timestampMs);
          setProcessedCount((count) => count + 1);
          setCameraElapsedMs(timestampMs);
          if (frame) {
            framesRef.current.push(frame);
            setDetectedCount(framesRef.current.length);
            setLatestFrame(frame);
            updateOverlay(frame);
          }
        } catch (caughtError) {
          if (!controller.signal.aborted) {
            stopCameraLoop();
            setError(errorMessage(caughtError));
          }
          return;
        }

        scheduleCameraFrame((nextTime) => {
          void processFrame(nextTime);
        });
      };

      scheduleCameraFrame((mediaTimeMs) => {
        void processFrame(mediaTimeMs);
      });
    } catch (caughtError) {
      stopCameraLoop();
      setError(errorMessage(caughtError));
      setStep("preview");
      abortRef.current = null;
      await closeEstimator();
    }
  }, [
    closeEstimator,
    prepareEstimator,
    scheduleCameraFrame,
    stopCameraLoop,
    updateOverlay,
  ]);

  const finishCameraAnalysis = useCallback(async () => {
    const activeSource = sourceRef.current;
    if (!activeSource || activeSource.kind !== "camera") {
      return;
    }
    stopCameraLoop();
    abortRef.current?.abort();
    abortRef.current = null;
    await closeEstimator();
    if (framesRef.current.length === 0) {
      setError("人物を検出できませんでした。全身を画面に入れ、明るい場所でもう一度お試しください。");
      setStep("preview");
      return;
    }
    const input: AnalysisInputInfo = {
      kind: activeSource.kind,
      name: activeSource.name,
      mimeType: activeSource.mimeType,
      width: activeSource.width,
      height: activeSource.height,
      durationMs: cameraElapsedMs,
      mirrored: activeSource.mirrored,
    };
    const nextResult = buildAnalysisResult(
      framesRef.current,
      input,
      LIVE_SAMPLE_RATE_HZ,
      sampleTimestampsRef.current,
    );
    setResult(nextResult);
    setSelectedFrameIndex(Math.max(0, nextResult.frames.length - 1));
    setLatestFrame(nextResult.frames.at(-1) ?? null);
    stopStream(streamRef.current);
    streamRef.current = null;
    setStep("results");
  }, [cameraElapsedMs, closeEstimator, stopCameraLoop]);

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
    stopCameraLoop();
    if (sourceRef.current?.kind === "camera") {
      void reset();
    } else {
      setStep("preview");
    }
  }, [reset, stopCameraLoop]);

  const chooseResultFrame = useCallback(
    (index: number) => {
      if (!result) {
        return;
      }
      const bounded = Math.max(0, Math.min(index, result.frames.length - 1));
      setSelectedFrameIndex(bounded);
      const frame = result.frames[bounded];
      setLatestFrame(frame);
      const video = videoRef.current;
      if (video && result.input.kind === "video") {
        video.currentTime = frame.timestampMs / 1000;
      }
    },
    [result],
  );

  const chooseTimestamp = useCallback(
    (timestampMs: number | null) => {
      if (!result || timestampMs === null) {
        return;
      }
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      result.frames.forEach((frame, index) => {
        const distance = Math.abs(frame.timestampMs - timestampMs);
        if (distance < nearestDistance) {
          nearestIndex = index;
          nearestDistance = distance;
        }
      });
      chooseResultFrame(nearestIndex);
    },
    [chooseResultFrame, result],
  );

  const exportData = useCallback(
    (kind: "json" | "csv") => {
      if (!result) {
        return;
      }
      const bundle = createAnalysisExportBundle(result);
      const contents = kind === "json" ? bundle.json : bundle.csv;
      const type =
        kind === "json"
          ? "application/json;charset=utf-8"
          : "text/csv;charset=utf-8";
      const prefix = kind === "csv" ? "\uFEFF" : "";
      downloadBlob(
        new Blob([prefix, contents], { type }),
        `${resultFileStem(result)}.${kind}`,
      );
    },
    [result],
  );

  const exportPng = useCallback(async () => {
    if (!result || !currentFrame || !sourceRef.current) {
      return;
    }
    const video = videoRef.current;
    const activeSource = sourceRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = activeSource.width;
    canvas.height = activeSource.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let canDrawSourceFrame = Boolean(video && video.readyState >= 2);
    if (video && canDrawSourceFrame && result.input.kind === "video") {
      try {
        await seekVideo(
          video,
          currentFrame.timestampMs,
          new AbortController().signal,
        );
      } catch {
        canDrawSourceFrame = false;
      }
    }

    if (video && canDrawSourceFrame) {
      drawSourceFrame(
        context,
        video,
        currentFrame,
        { width: canvas.width, height: canvas.height },
        activeSource.mirrored,
      );
    } else {
      context.fillStyle = "#020617";
      context.fillRect(0, 0, canvas.width, canvas.height);
      drawPoseOverlay(
        context,
        currentFrame,
        { width: canvas.width, height: canvas.height },
        { mirrored: activeSource.mirrored },
      );
    }
    (
      Object.keys(TRAJECTORY_LABELS) as (keyof typeof TRAJECTORY_LABELS)[]
    ).forEach((key) => {
      drawTrajectory(
        context,
        getTrajectoryPoints(result.frames, key),
        { width: canvas.width, height: canvas.height },
        TRAJECTORY_COLORS[key],
        activeSource.mirrored,
      );
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (blob) {
      downloadBlob(blob, `${resultFileStem(result)}-${Math.round(currentFrame.timestampMs)}ms.png`);
    }
  }, [currentFrame, result]);

  const activeStepIndex = stepIndex(step);

  return (
    <div className="space-y-6" id="analysis">
      <nav
        aria-label="解析の進行状況"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <ol className="grid grid-cols-4">
          {STEP_LABELS.map((item, index) => {
            const completed = index < activeStepIndex;
            const active = index === activeStepIndex;
            return (
              <li
                key={item.id}
                aria-current={active ? "step" : undefined}
                className={`relative flex min-h-16 items-center gap-2 border-r border-slate-200 px-2 last:border-r-0 dark:border-slate-800 sm:px-4 ${
                  active
                    ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${
                    completed
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800"
                  }`}
                >
                  {completed ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className="hidden text-xs font-bold leading-tight sm:block lg:text-sm">
                  {item.label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200"
        >
          <X className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="rounded p-1 hover:bg-rose-100 dark:hover:bg-rose-900"
            aria-label="エラーを閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
        {step === "input" && (
          <div className="grid gap-0 lg:grid-cols-2">
            <div className="p-6 sm:p-8 lg:p-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                <Camera className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-2xl font-black tracking-tight">
                カメラでフォームを撮る
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">
                映像を見ながらその場で解析します。未処理フレームを溜めず、常に1枚ずつ端末内で推論します。
              </p>
              <Button
                type="button"
                size="lg"
                onClick={() => void startCamera()}
                className="mt-7 h-12 w-full rounded-xl bg-slate-950 text-white hover:bg-indigo-700 dark:bg-white dark:text-slate-950 dark:hover:bg-indigo-100"
              >
                <Camera className="mr-2 h-5 w-5" />
                カメラ撮影を開始
              </Button>
              <p className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
                <LockKeyhole className="h-3.5 w-3.5" />
                許可したときだけカメラを使用
              </p>
            </div>

            <div className="border-t border-slate-200 p-6 dark:border-slate-800 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                <Video className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-2xl font-black tracking-tight">
                動画を選んで解析
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">
                同じ動画は15Hzの固定時刻列で解析します。v1では3分以内の単一人物動画に対応します。
              </p>
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                className={`mt-7 rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${
                  isDragging
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                    : "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/50"
                }`}
              >
                <Upload className="mx-auto h-6 w-6 text-slate-500" />
                <p className="mt-2 text-sm font-semibold">
                  動画をドロップ、または選択
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-sm ring-1 ring-slate-200 hover:bg-indigo-50 dark:bg-slate-900 dark:text-indigo-300 dark:ring-slate-700"
                >
                  動画ファイルを選ぶ
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/*"
                  onChange={onFileChange}
                  className="sr-only"
                  aria-label="解析する動画ファイル"
                />
              </div>
            </div>
          </div>
        )}

        <div
          className={`gap-0 xl:grid-cols-[minmax(0,1.7fr)_minmax(19rem,0.8fr)] ${
            source && step !== "input" ? "grid" : "hidden"
          }`}
        >
              <div className="relative min-w-0 bg-slate-950">
                <div
                  className="relative mx-auto w-full overflow-hidden"
                  style={{
                    aspectRatio: source
                      ? `${source.width} / ${source.height}`
                      : "16 / 9",
                    maxHeight: "min(72vh, 760px)",
                  }}
                >
                  <video
                    ref={videoRef}
                    className={`h-full w-full object-contain ${
                      source?.mirrored ? "-scale-x-100" : ""
                    }`}
                    playsInline
                    muted
                    controls={
                      step === "preview" && source?.kind === "video"
                    }
                    preload="metadata"
                  />
                  <canvas
                    ref={overlayRef}
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                    aria-label="姿勢ランドマーク表示"
                  />
                  {step === "preview" && source && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="h-[86%] w-[48%] rounded-[45%_45%_24%_24%] border-2 border-dashed border-white/70 shadow-[0_0_0_9999px_rgba(2,6,23,0.15)]" />
                      <span className="absolute bottom-4 rounded-full bg-slate-950/75 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">
                        頭から足先まで枠内に
                      </span>
                    </div>
                  )}
                  {step === "analyzing" && source && (
                    <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-slate-950/80 px-3 py-2 text-xs font-bold text-white backdrop-blur">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                      {source.kind === "camera"
                        ? `LIVE ${formatTime(cameraElapsedMs)}`
                        : `解析中 ${Math.round(progress)}%`}
                    </div>
                  )}
                </div>
              </div>

              <aside className="border-t border-slate-200 p-5 dark:border-slate-800 sm:p-7 xl:border-l xl:border-t-0">
                {step === "preview" && source && (
                  <PreviewPanel
                    source={source}
                    onBack={() => void reset()}
                    onStart={() =>
                      source.kind === "camera"
                        ? void startCameraAnalysis()
                        : void runVideoAnalysis()
                    }
                  />
                )}

                {step === "analyzing" && source && (
                  <AnalyzingPanel
                    source={source}
                    progress={progress}
                    processedCount={processedCount}
                    detectedCount={detectedCount}
                    cameraElapsedMs={cameraElapsedMs}
                    onCancel={cancelAnalysis}
                    onFinish={
                      source.kind === "camera"
                        ? () => void finishCameraAnalysis()
                        : undefined
                    }
                  />
                )}

                {step === "results" && result && (
                  <ResultSidebar
                    result={result}
                    selectedFrameIndex={selectedFrameIndex}
                    onSelectFrame={chooseResultFrame}
                    onExportJson={() => exportData("json")}
                    onExportCsv={() => exportData("csv")}
                    onExportPng={() => void exportPng()}
                    onReset={() => void reset()}
                  />
                )}
              </aside>
            </div>
      </div>

      {step === "results" && result && (
        <ResultsPanel
          result={result}
          selectedFrameIndex={selectedFrameIndex}
          worldCanvasRef={worldCanvasRef}
          onChooseTimestamp={chooseTimestamp}
        />
      )}
    </div>
  );
}

function PreviewPanel({
  source,
  onBack,
  onStart,
}: {
  source: LocalSource;
  onBack: () => void;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
        STEP 2 / 全身確認
      </p>
      <h2 className="mt-3 text-2xl font-black">この映像で解析します</h2>
      <div className="mt-6 space-y-3">
        {[
          "頭から足先まで画面に入っている",
          "体が大きく隠れていない",
          "逆光を避け、関節が見える明るさ",
          "画面内には分析する人が1人だけ",
        ].map((item) => (
          <div
            key={item}
            className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/60"
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <dt className="text-slate-500">入力</dt>
          <dd className="mt-1 truncate font-bold">
            {source.kind === "camera" ? "ライブカメラ" : source.name}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <dt className="text-slate-500">サイズ</dt>
          <dd className="mt-1 font-bold">
            {source.width} × {source.height}
          </dd>
        </div>
      </dl>
      <div className="mt-auto grid gap-3 pt-7">
        <Button
          type="button"
          size="lg"
          onClick={onStart}
          className="h-12 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
        >
          <Play className="mr-2 h-5 w-5 fill-current" />
          解析を開始
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="rounded-xl"
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          入力を選び直す
        </Button>
      </div>
    </div>
  );
}

function AnalyzingPanel({
  source,
  progress,
  processedCount,
  detectedCount,
  cameraElapsedMs,
  onCancel,
  onFinish,
}: {
  source: LocalSource;
  progress: number;
  processedCount: number;
  detectedCount: number;
  cameraElapsedMs: number;
  onCancel: () => void;
  onFinish?: () => void;
}) {
  const detectionRate =
    processedCount > 0 ? Math.round((detectedCount / processedCount) * 100) : 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          <LoaderCircle className="h-6 w-6 animate-spin" />
        </span>
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
            STEP 3 / 解析
          </p>
          <h2 className="mt-1 text-xl font-black">
            {source.kind === "camera" ? "フォームを解析中" : "動画を解析中"}
          </h2>
        </div>
      </div>
      {source.kind === "video" ? (
        <div className="mt-7">
          <div className="flex justify-between text-xs font-bold">
            <span>{processedCount} フレーム処理</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width]"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
            計測時間
          </p>
          <p className="mt-1 text-3xl font-black tabular-nums">
            {formatTime(cameraElapsedMs)}
          </p>
        </div>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
          <dt className="text-xs text-slate-500">人物検出</dt>
          <dd className="mt-1 font-black">{detectedCount} フレーム</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
          <dt className="text-xs text-slate-500">検出率</dt>
          <dd className="mt-1 font-black">{detectionRate}%</dd>
        </div>
      </dl>
      <p className="mt-5 text-xs leading-5 text-slate-500">
        元フレームは保存せず、推定した33点だけをページ内メモリに保持します。
      </p>
      <div className="mt-auto grid gap-3 pt-7">
        {onFinish && (
          <Button
            type="button"
            size="lg"
            onClick={onFinish}
            className="h-12 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <CircleStop className="mr-2 h-5 w-5" />
            撮影を終了して結果を見る
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="rounded-xl"
        >
          <X className="mr-2 h-4 w-4" />
          解析をキャンセル
        </Button>
      </div>
    </div>
  );
}

function ResultSidebar({
  result,
  selectedFrameIndex,
  onSelectFrame,
  onExportJson,
  onExportCsv,
  onExportPng,
  onReset,
}: {
  result: AnalysisResultV1;
  selectedFrameIndex: number;
  onSelectFrame: (index: number) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onExportPng: () => void;
  onReset: () => void;
}) {
  const selectedFrame = result.frames[selectedFrameIndex];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Check className="h-6 w-6" />
        </span>
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
            STEP 4 / 結果
          </p>
          <h2 className="mt-1 text-xl font-black">解析できました</h2>
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
          <dt className="text-xs text-slate-500">検出フレーム</dt>
          <dd className="mt-1 font-black">{result.frames.length}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
          <dt className="text-xs text-slate-500">現在時点</dt>
          <dd className="mt-1 font-black">
            {formatTime(selectedFrame?.timestampMs ?? null)}
          </dd>
        </div>
      </dl>
      {result.frames.length > 1 && (
        <label className="mt-6 block">
          <span className="flex justify-between text-xs font-bold text-slate-500">
            <span>フレームを移動</span>
            <span>
              {selectedFrameIndex + 1} / {result.frames.length}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={result.frames.length - 1}
            value={selectedFrameIndex}
            onChange={(event) => onSelectFrame(Number(event.target.value))}
            className="mt-3 w-full accent-indigo-600"
          />
        </label>
      )}
      <div className="mt-6 space-y-2">
        <p className="text-xs font-black tracking-[0.16em] text-slate-500">
          書き出し
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onExportJson}
            className="rounded-xl border border-slate-200 p-3 text-center text-xs font-bold hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-950/50"
          >
            <FileJson className="mx-auto mb-1.5 h-5 w-5" />
            JSON
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            className="rounded-xl border border-slate-200 p-3 text-center text-xs font-bold hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-950/50"
          >
            <FileSpreadsheet className="mx-auto mb-1.5 h-5 w-5" />
            CSV
          </button>
          <button
            type="button"
            onClick={onExportPng}
            className="rounded-xl border border-slate-200 p-3 text-center text-xs font-bold hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-950/50"
          >
            <ImageDown className="mx-auto mb-1.5 h-5 w-5" />
            PNG
          </button>
        </div>
      </div>
      <div className="mt-auto pt-7">
        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          className="w-full rounded-xl"
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          新しい映像を解析
        </Button>
      </div>
    </div>
  );
}

function ResultsPanel({
  result,
  selectedFrameIndex,
  worldCanvasRef,
  onChooseTimestamp,
}: {
  result: AnalysisResultV1;
  selectedFrameIndex: number;
  worldCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onChooseTimestamp: (timestampMs: number | null) => void;
}) {
  const validMetrics = Object.values(result.metrics).filter(
    (series) => series.values.some((value) => value.status === "valid"),
  ).length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="有効な指標"
          value={`${validMetrics} / ${Object.keys(result.metrics).length}`}
          detail="信頼度0.5以上"
          icon={<Activity className="h-5 w-5" />}
        />
        <SummaryCard
          label="固定サンプル"
          value={`${result.sampling.targetFps} Hz`}
          detail={`${result.sampling.detectedFrameCount} / ${result.sampling.frameCount} フレーム検出`}
          icon={<Video className="h-5 w-5" />}
        />
        <SummaryCard
          label="処理場所"
          value="この端末"
          detail="クラウド保存なし"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
              JOINT METRICS
            </p>
            <h2 className="mt-2 text-2xl font-black">関節角度と可動域</h2>
          </div>
          <p className="text-xs text-slate-500">
            2D映像平面 / 「—」は低信頼度または取得不可
          </p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(result.metrics).map(([key, series]) => {
            const current = series.values[selectedFrameIndex];
            return (
              <article
                key={key}
                className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{series.label}</h3>
                    <p
                      className={`mt-2 text-3xl font-black tabular-nums ${
                        current?.status === "valid"
                          ? "text-slate-950 dark:text-white"
                          : "text-slate-400"
                      }`}
                    >
                      {formatMetric(current)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-black ${
                      current?.status === "valid"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {current?.status === "valid"
                      ? `${Math.round(current.confidence * 100)}%`
                      : "LOW"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <ExtremaButton
                    label="最小"
                    metric={series.summary.minimum}
                    timestampMs={series.summary.minimumTimestampMs}
                    onChoose={onChooseTimestamp}
                  />
                  <ExtremaButton
                    label="最大"
                    metric={series.summary.maximum}
                    timestampMs={series.summary.maximumTimestampMs}
                    onChoose={onChooseTimestamp}
                  />
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60">
                    <p className="text-slate-500">可動域</p>
                    <p className="mt-1 font-black">
                      {formatMetric(series.summary.range)}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
          <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
            TRAJECTORIES
          </p>
          <h2 className="mt-2 text-2xl font-black">手首・足首・腰の軌跡</h2>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950/60">
                <tr>
                  <th className="px-4 py-3 font-bold">部位</th>
                  <th className="px-4 py-3 font-bold">経路長</th>
                  <th className="hidden px-4 py-3 font-bold sm:table-cell">
                    横幅
                  </th>
                  <th className="hidden px-4 py-3 font-bold sm:table-cell">
                    縦幅
                  </th>
                  <th className="px-4 py-3 text-right font-bold">有効点</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(
                  Object.keys(
                    TRAJECTORY_LABELS,
                  ) as (keyof typeof TRAJECTORY_LABELS)[]
                ).map((key) => {
                  const trajectory = result.trajectories[key];
                  return (
                    <tr key={key}>
                      <td className="px-4 py-3 font-bold">
                        <span
                          className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: TRAJECTORY_COLORS[key] }}
                        />
                        {TRAJECTORY_LABELS[key]}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {formatMetric(trajectory.pathLength)}
                      </td>
                      <td className="hidden px-4 py-3 tabular-nums sm:table-cell">
                        {formatMetric(trajectory.rangeX)}
                      </td>
                      <td className="hidden px-4 py-3 tabular-nums sm:table-cell">
                        {formatMetric(trajectory.rangeY)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {trajectory.validSampleCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            距離は画面幅・高さに対する正規化値で、cmやmではありません。低信頼度の区間をまたいで線を結びません。
          </p>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-800">
          <div className="border-b border-slate-800 px-5 py-4">
            <p className="text-xs font-black tracking-[0.18em] text-indigo-300">
              AUXILIARY VIEW
            </p>
            <h2 className="mt-1 font-bold text-white">補助姿勢表示</h2>
          </div>
          <canvas
            ref={worldCanvasRef}
            className="aspect-[6/5] w-full"
            aria-label="world座標による補助姿勢表示"
          />
          <p className="border-t border-slate-800 px-5 py-4 text-xs leading-5 text-slate-400">
            world座標を姿勢の向き確認だけに使用しています。単眼推定のため、奥行きや距離の実測値ではありません。
          </p>
        </section>
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <summary className="cursor-pointer font-bold">解析データの互換性情報</summary>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">schema</dt>
          <dd className="font-mono">{result.schemaVersion}</dd>
          <dt className="text-slate-500">model</dt>
          <dd className="font-mono">{result.model.id}</dd>
          <dt className="text-slate-500">runtime</dt>
          <dd className="font-mono">
            {result.model.runtime}@{result.model.runtimeVersion}
          </dd>
          <dt className="text-slate-500">model SHA-256</dt>
          <dd className="break-all font-mono text-xs">{result.model.sha256}</dd>
        </dl>
      </details>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-black">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {icon}
        </span>
      </div>
    </article>
  );
}

function ExtremaButton({
  label,
  metric,
  timestampMs,
  onChoose,
}: {
  label: string;
  metric: MetricValue;
  timestampMs: number | null;
  onChoose: (timestampMs: number | null) => void;
}) {
  return (
    <button
      type="button"
      disabled={timestampMs === null}
      onClick={() => onChoose(timestampMs)}
      className="rounded-lg bg-slate-50 p-2 text-left hover:bg-indigo-50 disabled:cursor-default dark:bg-slate-950/60 dark:hover:bg-indigo-950/60"
    >
      <span className="text-slate-500">{label}</span>
      <span className="mt-1 block font-black">{formatMetric(metric)}</span>
      {timestampMs !== null && (
        <span className="mt-1 block text-[10px] text-indigo-600 dark:text-indigo-400">
          {formatTime(timestampMs)}
        </span>
      )}
    </button>
  );
}
