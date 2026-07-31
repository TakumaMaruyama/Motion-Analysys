"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileVideo2,
  Flag,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  exportSwimAnnotationJson,
  type SwimAnnotationStrokeStyle,
  type SwimAnnotationValidity,
  SwimAnnotationValidationError,
} from "@/lib/validation/swim-annotation";
import {
  findNearestFrameIndex,
  getCompetitionVideoFrameTimeline,
  inspectCompetitionVideo,
  isSupportedCompetitionVideoFile,
  type CompetitionVideoFrameTimeline,
  type CompetitionVideoMetadata,
} from "@/lib/video/competition-frame-source";

interface ValidationVideoSource {
  readonly file: File;
  readonly url: string;
}

type FrameDisplayState =
  | {
      readonly status: "idle";
      readonly requestedFrame: null;
      readonly displayedFrame: null;
    }
  | {
      readonly status: "seeking";
      readonly requestedFrame: number;
      readonly displayedFrame: number | null;
    }
  | {
      readonly status: "displayed";
      readonly requestedFrame: number;
      readonly displayedFrame: number;
    };

interface PendingFrameRequest {
  readonly token: number;
  readonly frameIndex: number;
}

const IDLE_FRAME_DISPLAY: FrameDisplayState = {
  status: "idle",
  requestedFrame: null,
  displayedFrame: null,
};

const STROKES: readonly {
  readonly id: SwimAnnotationStrokeStyle;
  readonly label: string;
}[] = [
  { id: "freestyle", label: "自由形" },
  { id: "backstroke", label: "背泳ぎ" },
  { id: "breaststroke", label: "平泳ぎ" },
  { id: "butterfly", label: "バタフライ" },
];

const CONDITION_TAGS = [
  ["splash-obscured", "強い水しぶき"],
  ["partial-occlusion", "部分的な遮蔽"],
  ["low-light", "低照度"],
  ["portrait-video", "縦動画"],
  ["camera-motion-suspected", "カメラ移動の疑い"],
  ["no-swimmer", "無人物"],
  ["multiple-swimmers", "複数人物"],
  ["out-of-frame", "画面外"],
  ["low-fps", "低fps"],
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatTime(timestampMs: number): string {
  const seconds = Math.max(0, timestampMs) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
}

function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function frameSeekTargetMs(
  timestampsMs: readonly number[],
  frameIndex: number,
  durationMs: number | null,
): number {
  const frameStartMs = timestampsMs[frameIndex];
  const nextFrameStartMs = timestampsMs[frameIndex + 1];
  const previousFrameStartMs = timestampsMs[frameIndex - 1];
  const intervalMs =
    nextFrameStartMs !== undefined
      ? nextFrameStartMs - frameStartMs
      : previousFrameStartMs !== undefined
        ? frameStartMs - previousFrameStartMs
        : 1000 / 30;
  const targetMs = frameStartMs + Math.max(0.1, intervalMs / 2);
  return durationMs === null
    ? targetMs
    : Math.min(targetMs, Math.max(frameStartMs, durationMs - 0.1));
}

export function SwimValidationWorkspace() {
  const [source, setSource] = useState<ValidationVideoSource | null>(null);
  const [metadata, setMetadata] =
    useState<CompetitionVideoMetadata | null>(null);
  const [timeline, setTimeline] =
    useState<CompetitionVideoFrameTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strokeStyle, setStrokeStyle] =
    useState<SwimAnnotationStrokeStyle>("freestyle");
  const [validity, setValidity] =
    useState<SwimAnnotationValidity>("valid");
  const [distanceMeters, setDistanceMeters] = useState(5);
  const [invalidReason, setInvalidReason] = useState("");
  const [anonymousVideoId, setAnonymousVideoId] = useState("");
  const [annotatorLabel, setAnnotatorLabel] = useState("");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [firstGateFrame, setFirstGateFrame] = useState<number | null>(null);
  const [secondGateFrame, setSecondGateFrame] = useState<number | null>(null);
  const [strokeFrames, setStrokeFrames] = useState<readonly number[]>([]);
  const [fixedCamera, setFixedCamera] = useState(true);
  const [sideOn, setSideOn] = useState(true);
  const [singleSwimmer, setSingleSwimmer] = useState(true);
  const [conditionTags, setConditionTags] = useState<readonly string[]>([]);
  const [notes, setNotes] = useState("");
  const [frameDisplay, setFrameDisplay] =
    useState<FrameDisplayState>(IDLE_FRAME_DISPLAY);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<ValidationVideoSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const frameRequestTokenRef = useRef(0);
  const pendingFrameRequestRef = useRef<PendingFrameRequest | null>(null);
  const videoFrameCallbackIdRef = useRef<number | null>(null);

  useEffect(() => {
    workspaceRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  const cancelVideoFrameConfirmation = useCallback(() => {
    const callbackId = videoFrameCallbackIdRef.current;
    const video = videoRef.current;
    if (
      callbackId !== null &&
      video &&
      typeof video.cancelVideoFrameCallback === "function"
    ) {
      video.cancelVideoFrameCallback(callbackId);
    }
    videoFrameCallbackIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      cancelVideoFrameConfirmation();
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    };
  }, [cancelVideoFrameConfirmation]);

  const resetLabels = useCallback(() => {
    frameRequestTokenRef.current += 1;
    pendingFrameRequestRef.current = null;
    cancelVideoFrameConfirmation();
    setStrokeStyle("freestyle");
    setValidity("valid");
    setDistanceMeters(5);
    setInvalidReason("");
    setAnonymousVideoId("");
    setCurrentFrame(0);
    setFirstGateFrame(null);
    setSecondGateFrame(null);
    setStrokeFrames([]);
    setFixedCamera(true);
    setSideOn(true);
    setSingleSwimmer(true);
    setConditionTags([]);
    setNotes("");
    setFrameDisplay(IDLE_FRAME_DISPLAY);
    setError(null);
  }, [cancelVideoFrameConfirmation]);

  const configureFile = useCallback(
    async (file: File) => {
      if (!isSupportedCompetitionVideoFile(file)) {
        setError("MP4、MOV、WebMの動画を選択してください。");
        return;
      }
      abortRef.current?.abort();
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
      const nextSource = { file, url: URL.createObjectURL(file) };
      sourceRef.current = nextSource;
      setSource(nextSource);
      setMetadata(null);
      setTimeline(null);
      resetLabels();
      setLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const [nextMetadata, nextTimeline] = await Promise.all([
          inspectCompetitionVideo(file, controller.signal),
          getCompetitionVideoFrameTimeline(file, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (nextTimeline.timestampsMs.length === 0) {
          throw new Error("動画のフレーム時刻を取得できませんでした。");
        }
        setMetadata(nextMetadata);
        setTimeline(nextTimeline);
      } catch (caughtError) {
        if (!controller.signal.aborted) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "動画情報を確認できませんでした。",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [resetLabels],
  );

  const onFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void configureFile(file);
    },
    [configureFile],
  );

  const frameAtTimestamp = useCallback(
    (timestampMs: number) => {
      if (!timeline) return null;
      return findNearestFrameIndex(
        timeline.timestampsMs,
        timestampMs,
        metadata?.effectiveFps ?? null,
      );
    },
    [metadata?.effectiveFps, timeline],
  );

  const confirmDisplayedFrame = useCallback(
    (timestampMs: number, requestToken?: number) => {
      const displayedFrame = frameAtTimestamp(timestampMs);
      if (displayedFrame === null) return false;

      const pendingRequest = pendingFrameRequestRef.current;
      if (
        requestToken !== undefined &&
        pendingRequest?.token !== requestToken
      ) {
        return false;
      }
      if (
        pendingRequest &&
        displayedFrame !== pendingRequest.frameIndex
      ) {
        return false;
      }

      const requestedFrame = pendingRequest?.frameIndex ?? displayedFrame;
      pendingFrameRequestRef.current = null;
      setCurrentFrame(displayedFrame);
      setFrameDisplay({
        status: "displayed",
        requestedFrame,
        displayedFrame,
      });
      return true;
    },
    [frameAtTimestamp],
  );

  const requestDisplayedFrameConfirmation = useCallback(() => {
    const video = videoRef.current;
    if (!video || !timeline) return;
    const pendingRequest = pendingFrameRequestRef.current;
    const requestToken = pendingRequest?.token;
    const requestGeneration = frameRequestTokenRef.current;

    cancelVideoFrameConfirmation();
    if (typeof video.requestVideoFrameCallback === "function") {
      let callbackId = 0;
      callbackId = video.requestVideoFrameCallback((_now, frameMetadata) => {
        if (videoFrameCallbackIdRef.current === callbackId) {
          videoFrameCallbackIdRef.current = null;
        }
        if (frameRequestTokenRef.current !== requestGeneration) return;
        confirmDisplayedFrame(frameMetadata.mediaTime * 1000, requestToken);
      });
      videoFrameCallbackIdRef.current = callbackId;
      return;
    }

    if (!video.seeking && video.readyState >= 2) {
      confirmDisplayedFrame(video.currentTime * 1000, requestToken);
    }
  }, [
    cancelVideoFrameConfirmation,
    confirmDisplayedFrame,
    timeline,
  ]);

  const confirmFrameAfterSeek = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.seeking || video.readyState < 2) return;
    const pendingRequest = pendingFrameRequestRef.current;
    if (
      confirmDisplayedFrame(
        video.currentTime * 1000,
        pendingRequest?.token,
      )
    ) {
      cancelVideoFrameConfirmation();
      return;
    }
    requestDisplayedFrameConfirmation();
  }, [
    cancelVideoFrameConfirmation,
    confirmDisplayedFrame,
    requestDisplayedFrameConfirmation,
  ]);

  const seekFrame = useCallback(
    (frameIndex: number) => {
      if (!timeline) return;
      const nextFrame = clamp(
        Math.round(frameIndex),
        0,
        timeline.timestampsMs.length - 1,
      );
      const token = frameRequestTokenRef.current + 1;
      frameRequestTokenRef.current = token;
      pendingFrameRequestRef.current = { token, frameIndex: nextFrame };
      cancelVideoFrameConfirmation();
      setCurrentFrame(nextFrame);
      setFrameDisplay((current) => ({
        status: "seeking",
        requestedFrame: nextFrame,
        displayedFrame:
          current.status === "displayed" ? current.displayedFrame : null,
      }));

      const video = videoRef.current;
      if (video) {
        video.pause();
        const alreadyDisplayedFrame =
          !video.seeking && video.readyState >= 2
            ? frameAtTimestamp(video.currentTime * 1000)
            : null;
        if (alreadyDisplayedFrame === nextFrame) {
          confirmDisplayedFrame(video.currentTime * 1000, token);
          return;
        }
        video.currentTime =
          frameSeekTargetMs(
            timeline.timestampsMs,
            nextFrame,
            metadata?.durationMs ?? null,
          ) / 1000;
        requestDisplayedFrameConfirmation();
      }
    },
    [
      cancelVideoFrameConfirmation,
      confirmDisplayedFrame,
      frameAtTimestamp,
      metadata?.durationMs,
      requestDisplayedFrameConfirmation,
      timeline,
    ],
  );

  useEffect(() => {
    if (!timeline) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target) || event.metaKey || event.ctrlKey) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekFrame(currentFrame - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekFrame(currentFrame + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentFrame, seekFrame, timeline]);

  const syncFrameFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.seeking || pendingFrameRequestRef.current) return;
    confirmDisplayedFrame(video.currentTime * 1000);
  }, [confirmDisplayedFrame]);

  const markVideoSeeking = useCallback(() => {
    const video = videoRef.current;
    if (!video || !timeline || pendingFrameRequestRef.current) return;
    const requestedFrame = frameAtTimestamp(video.currentTime * 1000);
    if (requestedFrame === null) return;
    const token = frameRequestTokenRef.current + 1;
    frameRequestTokenRef.current = token;
    pendingFrameRequestRef.current = { token, frameIndex: requestedFrame };
    cancelVideoFrameConfirmation();
    setCurrentFrame(requestedFrame);
    setFrameDisplay((current) => ({
      status: "seeking",
      requestedFrame,
      displayedFrame:
        current.status === "displayed" ? current.displayedFrame : null,
    }));
  }, [cancelVideoFrameConfirmation, frameAtTimestamp, timeline]);

  useEffect(() => {
    if (!timeline) return;
    const timer = window.setTimeout(() => seekFrame(0), 0);
    return () => window.clearTimeout(timer);
  }, [seekFrame, timeline]);

  const addStrokeFrame = useCallback(() => {
    setStrokeFrames((current) =>
      current.includes(currentFrame)
        ? current
        : [...current, currentFrame].sort((left, right) => left - right),
    );
  }, [currentFrame]);

  const toggleTag = useCallback((tag: string) => {
    setConditionTags((current) =>
      current.includes(tag)
        ? current.filter((candidate) => candidate !== tag)
        : [...current, tag],
    );
  }, []);

  const exportAnnotation = useCallback(() => {
    if (!metadata || !timeline) {
      setError("先に動画を選択してください。");
      return;
    }
    if (
      validity === "valid" &&
      (firstGateFrame === null || secondGateFrame === null)
    ) {
      setError("ゲートAとゲートBの通過フレームを登録してください。");
      return;
    }
    if (metadata.effectiveFps === null) {
      setError("元動画のfpsを確認できないため、ラベルを書き出せません。");
      return;
    }
    try {
      const framePoint = (frameIndex: number) => ({
        frameIndex,
        timestampMs: timeline.timestampsMs[frameIndex],
      });
      const json = exportSwimAnnotationJson({
        schemaVersion: "1.0",
        anonymousVideoId,
        strokeStyle,
        validity,
        source: {
          fps: metadata.effectiveFps,
          frameCount: timeline.timestampsMs.length,
        },
        distanceMeters: validity === "valid" ? distanceMeters : null,
        gateCrossings:
          validity === "valid" &&
          firstGateFrame !== null &&
          secondGateFrame !== null
            ? {
                first: framePoint(firstGateFrame),
                second: framePoint(secondGateFrame),
              }
            : null,
        strokeEvents:
          validity === "valid"
            ? strokeFrames.map(framePoint)
            : null,
        annotatorLabel,
        invalidReason: validity === "valid" ? null : invalidReason,
        conditions: {
          fixedCamera,
          sideOn,
          singleSwimmer,
          tags: conditionTags,
        },
        notes,
      });
      const safeAnnotator = annotatorLabel
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .slice(0, 32);
      downloadText(
        json,
        `swim-annotation-${anonymousVideoId}-${safeAnnotator || "coach"}.json`,
      );
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof SwimAnnotationValidationError
          ? `入力内容を確認してください（${caughtError.path}）。${caughtError.message.replace(/^Invalid swim annotation at [^:]+:\s*/, "")}`
          : "検証ラベルを書き出せませんでした。",
      );
    }
  }, [
    anonymousVideoId,
    annotatorLabel,
    conditionTags,
    distanceMeters,
    firstGateFrame,
    fixedCamera,
    invalidReason,
    metadata,
    notes,
    secondGateFrame,
    sideOn,
    singleSwimmer,
    strokeFrames,
    strokeStyle,
    timeline,
    validity,
  ]);

  const currentTimestampMs = timeline?.timestampsMs[currentFrame] ?? 0;
  const frameCount = timeline?.timestampsMs.length ?? 0;
  const frameRegistrationReady =
    frameDisplay.status === "displayed" &&
    frameDisplay.displayedFrame === currentFrame;

  return (
    <div
      ref={workspaceRef}
      className="space-y-6"
      data-testid="swim-validation-workspace"
      data-hydrated="false"
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
              INDEPENDENT VALIDATION LABEL
            </p>
            <h1 className="mt-3 text-3xl font-black sm:text-4xl">
              自動結果を見ずに正解フレームを作る
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">
              2人のコーチが別々にゲート通過とストロークを登録するための端末内ツールです。動画名はJSONへ含めません。
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <p className="flex items-center font-black">
              <ShieldCheck className="mr-2 h-4 w-4" />
              自動検出は表示しません
            </p>
            <p className="mt-1">ラベルJSONは利用者の操作で端末へ保存されます。</p>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          {error}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <h2 className="text-xl font-black">1. 動画と匿名情報</h2>
            <div className="mt-4 flex flex-col items-start gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/50 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  <FileVideo2 className="h-6 w-6" />
                </span>
                <div>
                  <p className="font-black">権利処理済み動画を選択</p>
                  <p className="mt-1 text-xs text-slate-500">動画とファイル名は送信・出力しません</p>
                </div>
              </div>
              <Button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-xl bg-slate-950 text-white hover:bg-indigo-700 dark:bg-white dark:text-slate-950">
                <Upload className="mr-2 h-4 w-4" />
                動画を選ぶ
              </Button>
              <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/*" onChange={onFileChange} className="sr-only" aria-label="検証ラベル用動画" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label>
              <span className="text-xs font-black">匿名動画ID</span>
              <input value={anonymousVideoId} onChange={(event) => setAnonymousVideoId(event.target.value)} maxLength={64} placeholder="例：adult-fr-001" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label>
              <span className="text-xs font-black">注釈者ラベル</span>
              <input value={annotatorLabel} onChange={(event) => setAnnotatorLabel(event.target.value)} maxLength={100} placeholder="例：coach-a" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
          </div>
        </div>
      </section>

      {source && (
        <>
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="grid xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.55fr)]">
              <div className="bg-slate-950 p-3 sm:p-5">
                <video
                  ref={videoRef}
                  src={source.url}
                  controls
                  playsInline
                  muted
                  preload="metadata"
                  onLoadedData={confirmFrameAfterSeek}
                  onSeeking={markVideoSeeking}
                  onSeeked={confirmFrameAfterSeek}
                  onTimeUpdate={syncFrameFromVideo}
                  className="h-auto w-full rounded-xl bg-black object-contain"
                  style={{
                    aspectRatio: metadata
                      ? `${metadata.displayWidth} / ${metadata.displayHeight}`
                      : "16 / 9",
                  }}
                />
              </div>
              <aside className="p-5 sm:p-7">
                <h2 className="text-xl font-black">2. フレームを確定</h2>
                {loading ? (
                  <p role="status" className="mt-4 flex items-center text-sm font-bold text-slate-500">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    フレーム時刻を読み込んでいます
                  </p>
                ) : timeline && metadata ? (
                  <>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><dt className="text-slate-500">現在フレーム</dt><dd className="mt-1 text-xl font-black">{currentFrame}</dd></div>
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><dt className="text-slate-500">現在時刻</dt><dd className="mt-1 font-black">{formatTime(currentTimestampMs)}</dd></div>
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><dt className="text-slate-500">総フレーム</dt><dd className="mt-1 font-black">{frameCount}</dd></div>
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><dt className="text-slate-500">実効fps</dt><dd className="mt-1 font-black">{metadata.effectiveFps?.toFixed(2) ?? "確認不可"}</dd></div>
                    </dl>
                    <input type="range" min={0} max={Math.max(0, frameCount - 1)} step={1} value={currentFrame} onChange={(event) => seekFrame(Number(event.target.value))} className="mt-5 w-full accent-indigo-600" aria-label="現在フレーム" />
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => seekFrame(currentFrame - 1)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 text-xs font-black dark:border-slate-700"><ChevronLeft className="mr-1 h-4 w-4" />1フレーム戻る</button>
                      <button type="button" onClick={() => seekFrame(currentFrame + 1)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 text-xs font-black dark:border-slate-700">1フレーム進む<ChevronRight className="ml-1 h-4 w-4" /></button>
                    </div>
                    <div
                      data-testid="validation-frame-display-state"
                      data-status={frameDisplay.status}
                      data-frame={
                        frameDisplay.status === "displayed"
                          ? frameDisplay.displayedFrame
                          : undefined
                      }
                      role="status"
                      aria-live="polite"
                      className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${frameRegistrationReady ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}
                    >
                      {frameDisplay.status === "displayed"
                        ? `フレーム ${frameDisplay.displayedFrame} を表示確認済み`
                        : frameDisplay.status === "seeking"
                          ? `フレーム ${frameDisplay.requestedFrame} の表示を確認しています`
                          : "表示フレームを準備しています"}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">左右キーでも移動できます。</p>
                  </>
                ) : null}
              </aside>
            </div>
          </section>

          {timeline && metadata && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div>
                  <h2 className="text-xl font-black">3. 判定と正解イベントを登録</h2>
                  <fieldset className="mt-4">
                    <legend className="text-xs font-black">この映像を計測できるか</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={validity === "valid"}
                        onClick={() => setValidity("valid")}
                        className={`rounded-xl border px-3 py-3 text-sm font-black ${validity === "valid" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 dark:border-slate-700"}`}
                      >
                        計測可能
                      </button>
                      <button
                        type="button"
                        aria-pressed={validity === "invalid"}
                        onClick={() => setValidity("invalid")}
                        className={`rounded-xl border px-3 py-3 text-sm font-black ${validity === "invalid" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 dark:border-slate-700"}`}
                      >
                        無効・判定不能
                      </button>
                    </div>
                  </fieldset>
                  {validity === "valid" ? (
                    <label className="mt-4 block max-w-xs">
                      <span className="text-xs font-black">ゲート間の既知距離（m）</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={distanceMeters}
                        onChange={(event) => setDistanceMeters(Number(event.target.value))}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                  ) : (
                    <label className="mt-4 block">
                      <span className="text-xs font-black">無効・判定不能の理由</span>
                      <textarea
                        value={invalidReason}
                        onChange={(event) => setInvalidReason(event.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="例：泳者が映っていない、複数人物で対象を特定できない"
                        className="mt-2 w-full rounded-xl border border-rose-300 bg-white p-3 text-sm dark:border-rose-800 dark:bg-slate-950"
                      />
                    </label>
                  )}
                  <fieldset className="mt-4">
                    <legend className="text-xs font-black">泳法</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {STROKES.map((stroke) => (
                        <button key={stroke.id} type="button" aria-pressed={strokeStyle === stroke.id} onClick={() => setStrokeStyle(stroke.id)} className={`rounded-xl border px-3 py-3 text-sm font-bold ${strokeStyle === stroke.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 dark:border-slate-700"}`}>{stroke.label}</button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="mt-5 grid gap-2 sm:grid-cols-3">
                    <button type="button" disabled={validity !== "valid" || !frameRegistrationReady} onClick={() => setFirstGateFrame(currentFrame)} className="min-h-12 rounded-xl bg-sky-100 px-4 text-sm font-black text-sky-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-sky-950 dark:text-sky-200"><Flag className="mr-2 inline h-4 w-4" />ゲートAに設定</button>
                    <button type="button" disabled={validity !== "valid" || !frameRegistrationReady} onClick={() => setSecondGateFrame(currentFrame)} className="min-h-12 rounded-xl bg-pink-100 px-4 text-sm font-black text-pink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-pink-950 dark:text-pink-200"><Flag className="mr-2 inline h-4 w-4" />ゲートBに設定</button>
                    <button type="button" disabled={validity !== "valid" || !frameRegistrationReady} onClick={addStrokeFrame} className="min-h-12 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-45"><Plus className="mr-2 inline h-4 w-4" />ストロークを追加</button>
                  </div>
                  <div className="mt-5 rounded-2xl bg-slate-950 px-4 py-6">
                    <div className="relative h-12">
                      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-700" />
                      {firstGateFrame !== null && <span className="absolute top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 bg-sky-400" style={{ left: `${(firstGateFrame / Math.max(1, frameCount - 1)) * 100}%` }} />}
                      {secondGateFrame !== null && <span className="absolute top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 bg-pink-400" style={{ left: `${(secondGateFrame / Math.max(1, frameCount - 1)) * 100}%` }} />}
                      {strokeFrames.map((frame) => <button key={frame} type="button" aria-label={`ストローク フレーム${frame}へ移動`} onClick={() => seekFrame(frame)} className="absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-400" style={{ left: `${(frame / Math.max(1, frameCount - 1)) * 100}%` }} />)}
                    </div>
                  </div>
                </div>
                <aside className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <p className="text-xs font-black text-slate-500">登録内容</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-sky-50 p-2 dark:bg-sky-950/40"><dt>ゲートA</dt><dd className="mt-1 font-black">{firstGateFrame ?? "未設定"}</dd></div>
                    <div className="rounded-lg bg-pink-50 p-2 dark:bg-pink-950/40"><dt>ゲートB</dt><dd className="mt-1 font-black">{secondGateFrame ?? "未設定"}</dd></div>
                  </dl>
                  <p className="mt-4 text-xs font-black">ストローク {strokeFrames.length}件</p>
                  <div className="mt-2 max-h-56 space-y-2 overflow-auto">
                    {strokeFrames.map((frame) => (
                      <div key={frame} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950/60">
                        <button type="button" onClick={() => seekFrame(frame)} className="font-black">Frame {frame}</button>
                        <button type="button" onClick={() => setStrokeFrames((current) => current.filter((candidate) => candidate !== frame))} aria-label={`ストローク フレーム${frame}を削除`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            </section>
          )}

          {timeline && metadata && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
              <h2 className="text-xl font-black">4. 撮影条件を確認してJSON保存</h2>
              <div className="mt-5 grid gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  {[
                    ["カメラ固定", fixedCamera, setFixedCamera],
                    ["横方向から撮影", sideOn, setSideOn],
                    ["1レーン・1選手", singleSwimmer, setSingleSwimmer],
                  ].map(([label, checked, setter]) => (
                    <label key={String(label)} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold dark:border-slate-800">
                      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="h-4 w-4 accent-indigo-600" />
                      {String(label)}
                    </label>
                  ))}
                  <fieldset>
                    <legend className="text-xs font-black">追加条件</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {CONDITION_TAGS.map(([tag, label]) => (
                        <button key={tag} type="button" aria-pressed={conditionTags.includes(tag)} onClick={() => toggleTag(tag)} className={`rounded-full border px-3 py-2 text-xs font-bold ${conditionTags.includes(tag) ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "border-slate-200 dark:border-slate-700"}`}>{label}</button>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <div>
                  <label>
                    <span className="text-xs font-black">注釈メモ（個人情報を入力しない）</span>
                    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={5} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
                  </label>
                  <Button type="button" onClick={exportAnnotation} className="mt-4 h-12 w-full rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                    <Download className="mr-2 h-4 w-4" />
                    匿名ラベルJSONを保存
                  </Button>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
