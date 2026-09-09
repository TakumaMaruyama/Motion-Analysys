"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  Check,
  FileJson,
  FileSpreadsheet,
  ImageDown,
  Pause,
  Redo2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { runStartCandidateAnalysis } from "@/components/start/analysis-adapter";
import {
  buildStartAnalysisResult,
  exportStartAnalysisCsv,
  exportStartAnalysisJson,
  validateStartCalibration,
} from "@/lib/start";
import {
  getStartFpsAssessment,
  inspectCompetitionVideo,
  type CompetitionVideoMetadata,
} from "@/lib/video/competition-frame-source";
import type { PoseFrame } from "@/types/analysis";
import type {
  StartAnalysisResultV1,
  StartAnalysisMode,
  StartCalibrationV1,
  StartEvent,
  StartEventSource,
  StartEventRevision,
  StartEventStatus,
  StartEventType,
} from "@/types/start";

type Stroke = "freestyle" | "butterfly" | "breaststroke" | "backstroke";
type Direction = "left-to-right" | "right-to-left";
type CalibrationTarget = "zero" | "five" | "water1" | "water2";
type Point = { x: number; y: number };

interface EventValue {
  readonly id: string;
  readonly timestampMs: number | null;
  readonly frameIndex: number | null;
  readonly point: Point | null;
  readonly confidence: number;
  readonly status: StartEventStatus;
  readonly source: StartEventSource;
}

type EventMap = Record<StartEventType, EventValue>;
type CalibrationMarks = Partial<{
  zeroMeter: Point;
  fiveMeter: Point;
  waterFirst: Point;
  waterSecond: Point;
}>;
type HistorySnapshot = {
  readonly events: EventMap;
  readonly manualHeadEntryPoint: boolean;
};

const CALIBRATION_STORAGE_KEY = "motionanalysys.start-calibration.v1";
const precisionSteps = ["動画と選手区分", "0m・5m・水面校正", "候補イベント確認", "局面別結果"] as const;
const timingOnlySteps = ["動画と選手区分", "進行方向", "候補イベント確認", "時間結果"] as const;
const timingOnlyMetricIds = new Set([
  "movement-onset-time",
  "block-contact-time",
  "push-off-time",
  "flight-time",
  "entry-time",
  "five-meter-time",
]);

const eventLabels: Record<StartEventType, string> = {
  signal: "号砲／スタート信号",
  "movement-onset": "初動",
  "hands-off": "手の離台",
  "rear-foot-off": "後足の離台",
  takeoff: "離台",
  "head-entry": "頭頂入水",
  "five-meter-head-crossing": "5m頭頂通過（任意）",
};

const eventOrder: readonly StartEventType[] = [
  "signal",
  "movement-onset",
  "hands-off",
  "rear-foot-off",
  "takeoff",
  "head-entry",
  "five-meter-head-crossing",
];

function emptyEvents(): EventMap {
  return Object.fromEntries(eventOrder.map((type) => [type, {
    id: `start:${type}:unavailable`,
    timestampMs: null,
    frameIndex: null,
    point: null,
    confidence: 0,
    status: "unavailable" as const,
    source: "manual" as const,
  }])) as EventMap;
}

function clampPoint(point: Point): Point {
  return {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y)),
  };
}

function timestampId(type: StartEventType, timestampMs: number | null): string {
  return `start:${type}:${timestampMs === null ? "unavailable" : timestampMs.toFixed(3)}`;
}

function makeFrameIndex(timestampMs: number, frameMs: number): number {
  return Math.max(0, Math.round(timestampMs / frameMs));
}

function downloadText(contents: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function statusLabel(status: StartEventStatus): string {
  if (status === "verified") return "確認済み";
  if (status === "candidate") return "自動候補";
  if (status === "needs-review") return "要確認";
  return "未取得";
}

function pointFromVideoEvent(event: MouseEvent<HTMLVideoElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return clampPoint({
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  });
}

function safeCalibration(
  marks: CalibrationMarks,
  metadata: CompetitionVideoMetadata | null,
  direction: Direction,
): StartCalibrationV1 | null {
  if (!metadata || !marks.zeroMeter || !marks.fiveMeter || !marks.waterFirst || !marks.waterSecond) return null;
  const candidate: StartCalibrationV1 = {
    schemaVersion: "1.0",
    imageWidth: metadata.displayWidth,
    imageHeight: metadata.displayHeight,
    zeroMeter: marks.zeroMeter,
    fiveMeter: marks.fiveMeter,
    waterSurface: [marks.waterFirst, marks.waterSecond],
    travelDirection: direction,
  };
  try {
    validateStartCalibration(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function eventMapFromCandidates(candidates: readonly StartEvent[]): EventMap {
  const next = emptyEvents();
  for (const candidate of candidates) {
    next[candidate.type] = {
      id: candidate.id,
      timestampMs: candidate.timestampMs,
      frameIndex: candidate.frameIndex,
      point: candidate.point,
      confidence: candidate.confidence,
      status: candidate.status === "verified" ? "needs-review" : candidate.status,
      source: candidate.source,
    };
  }
  return next;
}

function toCoreEvents(events: EventMap): readonly StartEvent[] {
  return eventOrder.map((type) => ({ type, ...events[type] }));
}

export function StartAnalysisWorkspace() {
  const [activeStep, setActiveStep] = useState(0);
  const [analysisMode, setAnalysisMode] = useState<StartAnalysisMode>("precision");
  const [stroke, setStroke] = useState<Stroke>("freestyle");
  const [age, setAge] = useState(13);
  const [sex, setSex] = useState<"male" | "female">("male");
  // 撮影品質は、利用者が映像を確認して明示するまで未確認として扱う。
  // StartVideoInfo はbooleanなので、未確認はcoreへfalseとして渡す。
  const [fixedCamera, setFixedCamera] = useState<boolean | null>(null);
  const [sideOn, setSideOn] = useState<boolean | null>(null);
  const [singleSwimmer, setSingleSwimmer] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<CompetitionVideoMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("left-to-right");
  const [calibrationMarks, setCalibrationMarks] = useState<CalibrationMarks>({});
  const [calibrationTarget, setCalibrationTarget] = useState<CalibrationTarget | null>(null);
  const [events, setEvents] = useState<EventMap>(emptyEvents);
  const [poseFrames, setPoseFrames] = useState<readonly PoseFrame[]>([]);
  const [manualHeadEntryPoint, setManualHeadEntryPoint] = useState(false);
  const [pointSelectionMode, setPointSelectionMode] = useState<"head-entry" | null>(null);
  const [past, setPast] = useState<readonly HistorySnapshot[]>([]);
  const [future, setFuture] = useState<readonly HistorySnapshot[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState<{ percentage: number; message: string } | null>(null);
  const [externalFiveMeterTimeMs, setExternalFiveMeterTimeMs] = useState<number | null>(null);
  const [revisionHistory, setRevisionHistory] = useState<readonly StartEventRevision[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const fileRequestRef = useRef(0);

  const fps = metadata?.effectiveFps ?? null;
  const frameMs = 1000 / (fps && fps > 0 ? fps : 60);
  const isDiveStart = stroke !== "backstroke";
  const visibleEventTypes = useMemo(
    () => eventOrder.filter((type) => isDiveStart || type !== "rear-foot-off"),
    [isDiveStart],
  );
  const requiredEventTypes = useMemo(
    () => visibleEventTypes.filter((type) => type !== "five-meter-head-crossing"),
    [visibleEventTypes],
  );
  const calibration = useMemo(
    () => safeCalibration(calibrationMarks, metadata, direction),
    [calibrationMarks, direction, metadata],
  );
  const steps = analysisMode === "precision" ? precisionSteps : timingOnlySteps;
  const resultCalibration = analysisMode === "precision" ? calibration : null;
  const captureAllowed = Boolean(
    file && age >= 13 && fps !== null && singleSwimmer === true && (
      analysisMode === "precision"
        ? fps + 0.05 >= 60 && fixedCamera === true && sideOn === true
        : fps + 0.05 >= 30
    ),
  );
  const allRequiredEventsVerified = requiredEventTypes.every((type) => {
    const event = events[type];
    return event.status === "verified" && event.timestampMs !== null && (
      type !== "head-entry" || analysisMode === "timing-only" || manualHeadEntryPoint
    );
  });

  const calculatedResult: StartAnalysisResultV1 = useMemo(
    () => buildStartAnalysisResult({
      analysisMode,
      travelDirection: direction,
      athlete: { age, strokeStyle: stroke, researchSexCategory: sex },
      video: {
        name: metadata?.fileName ?? null,
        mimeType: metadata?.detectedMimeType ?? null,
        width: metadata?.displayWidth ?? 0,
        height: metadata?.displayHeight ?? 0,
        durationMs: metadata?.durationMs ?? null,
        effectiveFps: fps,
        fixedCamera: fixedCamera === true,
        sideOn: sideOn === true,
        singleSwimmer: singleSwimmer === true,
      },
      calibration: resultCalibration,
      events: toCoreEvents(events),
      poseFrames,
      externalFiveMeterTimeMs,
    }),
    [
      age,
      analysisMode,
      direction,
      events,
      externalFiveMeterTimeMs,
      fixedCamera,
      fps,
      metadata,
      poseFrames,
      sex,
      sideOn,
      singleSwimmer,
      stroke,
      resultCalibration,
    ],
  );
  const coreResult: StartAnalysisResultV1 = useMemo(
    () => ({ ...calculatedResult, revisionHistory }),
    [calculatedResult, revisionHistory],
  );

  useEffect(() => () => {
    analysisAbortRef.current?.abort();
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  const rememberEvents = useCallback((nextEvents: EventMap, nextManualHeadEntryPoint = manualHeadEntryPoint) => {
    setPast((previous) => [...previous.slice(-49), { events, manualHeadEntryPoint }]);
    setFuture([]);
    setEvents(nextEvents);
    setManualHeadEntryPoint(nextManualHeadEntryPoint);
  }, [events, manualHeadEntryPoint]);

  const updateEvent = useCallback((type: StartEventType, patch: Partial<EventValue>, options?: { resetHeadPoint?: boolean }) => {
    const existing = events[type];
    const next: EventMap = {
      ...events,
      [type]: {
        ...existing,
        ...patch,
        id: patch.timestampMs === undefined ? existing.id : timestampId(type, patch.timestampMs ?? null),
      },
    };
    rememberEvents(next, type === "head-entry" && options?.resetHeadPoint ? false : manualHeadEntryPoint);
    const previousEvent = { type, ...existing } as StartEvent;
    const nextEvent = { type, ...next[type] } as StartEvent;
    setRevisionHistory((previous) => [...previous, {
      revision: (previous.at(-1)?.revision ?? 0) + 1,
      eventId: nextEvent.id,
      previous: previousEvent,
      next: nextEvent,
    }]);
  }, [events, manualHeadEntryPoint, rememberEvents]);

  /** 校正・種目・動画が変わった時に、旧条件で作られた解析証拠を残さない。 */
  const clearAnalysisEvidence = useCallback(() => {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setEvents(emptyEvents());
    setPoseFrames([]);
    setManualHeadEntryPoint(false);
    setPointSelectionMode(null);
    setPast([]);
    setFuture([]);
    setAnalysisProgress(null);
    setRevisionHistory([]);
  }, []);

  const resetForNewVideo = useCallback(() => {
    clearAnalysisEvidence();
    setMetadata(null);
    setError(null);
    setCalibrationMarks({});
    setCalibrationTarget(null);
    setExternalFiveMeterTimeMs(null);
    setFixedCamera(null);
    setSideOn(null);
    setSingleSwimmer(null);
  }, [clearAnalysisEvidence]);

  const handleStrokeChange = useCallback((nextStroke: Stroke) => {
    if (nextStroke === stroke) return;
    // 飛び込み／背泳ぎの切替後に、旧条件の候補やPoseを誤って確定させない。
    clearAnalysisEvidence();
    setStroke(nextStroke);
  }, [clearAnalysisEvidence, stroke]);

  const handleAnalysisModeChange = useCallback((nextMode: StartAnalysisMode) => {
    if (nextMode === analysisMode) return;
    clearAnalysisEvidence();
    setCalibrationMarks({});
    setCalibrationTarget(null);
    setExternalFiveMeterTimeMs(null);
    setAnalysisMode(nextMode);
  }, [analysisMode, clearAnalysisEvidence]);

  const handleFile = useCallback(async (nextFile: File | null) => {
    resetForNewVideo();
    const requestId = fileRequestRef.current + 1;
    fileRequestRef.current = requestId;
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    const nextUrl = nextFile ? URL.createObjectURL(nextFile) : null;
    videoUrlRef.current = nextUrl;
    setVideoUrl(nextUrl);
    setFile(nextFile);
    if (!nextFile) return;
    try {
      const inspected = await inspectCompetitionVideo(nextFile);
      if (fileRequestRef.current === requestId) setMetadata(inspected);
    } catch (reason) {
      if (fileRequestRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : "動画を読み込めませんでした。");
      }
    }
  }, [resetForNewVideo]);

  const handleCalibrationClick = useCallback((event: MouseEvent<HTMLVideoElement>) => {
    if (!calibrationTarget) return;
    clearAnalysisEvidence();
    const point = pointFromVideoEvent(event);
    setCalibrationMarks((current) => {
      if (calibrationTarget === "zero") return { ...current, zeroMeter: point };
      if (calibrationTarget === "five") return { ...current, fiveMeter: point };
      if (calibrationTarget === "water1") return { ...current, waterFirst: point };
      return { ...current, waterSecond: point };
    });
    setCalibrationTarget(null);
  }, [calibrationTarget, clearAnalysisEvidence]);

  const handleDirectionChange = useCallback((nextDirection: Direction) => {
    if (nextDirection === direction) return;
    clearAnalysisEvidence();
    setDirection(nextDirection);
  }, [clearAnalysisEvidence, direction]);

  const handleEventVideoClick = useCallback((event: MouseEvent<HTMLVideoElement>) => {
    if (pointSelectionMode !== "head-entry") return;
    const timestampMs = event.currentTarget.currentTime * 1000;
    const next = {
      ...events,
      "head-entry": {
        ...events["head-entry"],
        id: timestampId("head-entry", timestampMs),
        timestampMs,
        frameIndex: makeFrameIndex(timestampMs, frameMs),
        point: pointFromVideoEvent(event),
        confidence: 1,
        status: "needs-review" as const,
        source: "manual" as const,
      },
    };
    rememberEvents(next, true);
    const previousEvent = { type: "head-entry" as const, ...events["head-entry"] };
    const nextEvent = { type: "head-entry" as const, ...next["head-entry"] };
    setRevisionHistory((previous) => [...previous, {
      revision: (previous.at(-1)?.revision ?? 0) + 1,
      eventId: nextEvent.id,
      previous: previousEvent,
      next: nextEvent,
    }]);
    setPointSelectionMode(null);
  }, [events, frameMs, pointSelectionMode, rememberEvents]);

  const setEventAtCurrentFrame = useCallback((type: StartEventType) => {
    const timestampMs = (videoRef.current?.currentTime ?? 0) * 1000;
    const current = events[type];
    if (type === "head-entry" && analysisMode === "precision" && !manualHeadEntryPoint) {
      setPointSelectionMode("head-entry");
      return;
    }
    updateEvent(type, {
      timestampMs,
      frameIndex: makeFrameIndex(timestampMs, frameMs),
      status: "needs-review",
      source: "manual",
      confidence: 1,
    }, { resetHeadPoint: type === "head-entry" && current.timestampMs !== timestampMs });
  }, [analysisMode, events, frameMs, manualHeadEntryPoint, updateEvent]);

  const verifyEvent = useCallback((type: StartEventType) => {
    const current = events[type];
    if (current.timestampMs === null || (type === "head-entry" && analysisMode === "precision" && !manualHeadEntryPoint)) return;
    updateEvent(type, {
      status: "verified",
      source: "manual",
      confidence: 1,
      frameIndex: current.frameIndex ?? makeFrameIndex(current.timestampMs, frameMs),
    });
  }, [analysisMode, events, frameMs, manualHeadEntryPoint, updateEvent]);

  const moveEventByFrame = useCallback((type: StartEventType, delta: number) => {
    const baseTimestamp = events[type].timestampMs ?? (videoRef.current?.currentTime ?? 0) * 1000;
    const timestampMs = Math.max(0, baseTimestamp + delta * frameMs);
    if (videoRef.current) videoRef.current.currentTime = timestampMs / 1000;
    updateEvent(type, {
      timestampMs,
      frameIndex: makeFrameIndex(timestampMs, frameMs),
      status: "needs-review",
      source: "manual",
    }, { resetHeadPoint: type === "head-entry" });
  }, [events, frameMs, updateEvent]);

  const changeEventTime = useCallback((type: StartEventType, seconds: string) => {
    if (!seconds.trim()) {
      updateEvent(type, {
        timestampMs: null,
        frameIndex: null,
        point: type === "head-entry" ? null : events[type].point,
        status: "unavailable",
        source: "manual",
        confidence: 0,
      }, { resetHeadPoint: type === "head-entry" });
      return;
    }
    const numericSeconds = Number(seconds);
    if (!Number.isFinite(numericSeconds) || numericSeconds < 0) return;
    const timestampMs = numericSeconds * 1000;
    updateEvent(type, {
      timestampMs,
      frameIndex: makeFrameIndex(timestampMs, frameMs),
      status: "needs-review",
      source: "manual",
    }, { resetHeadPoint: type === "head-entry" });
  }, [events, frameMs, updateEvent]);

  const undo = useCallback(() => {
    const latest = past.at(-1);
    if (!latest) return;
    setFuture((current) => [...current, { events, manualHeadEntryPoint }]);
    setPast((current) => current.slice(0, -1));
    setEvents(latest.events);
    setManualHeadEntryPoint(latest.manualHeadEntryPoint);
  }, [events, manualHeadEntryPoint, past]);

  const redo = useCallback(() => {
    const latest = future.at(-1);
    if (!latest) return;
    setPast((current) => [...current, { events, manualHeadEntryPoint }]);
    setFuture((current) => current.slice(0, -1));
    setEvents(latest.events);
    setManualHeadEntryPoint(latest.manualHeadEntryPoint);
  }, [events, future, manualHeadEntryPoint]);

  const runCandidates = useCallback(async () => {
    if (!file || !metadata || (analysisMode === "precision" && !calibration)) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setError(null);
    setAnalysisProgress({ percentage: 0, message: "自動候補を準備しています" });
    try {
      const result = await runStartCandidateAnalysis({
        sourceFile: file,
        analysisMode,
        calibration: analysisMode === "precision" ? calibration : null,
        travelDirection: direction,
        startStyle: stroke === "backstroke" ? "backstroke" : "dive",
        startMs: 0,
        endMs: Math.min(metadata.durationMs, 30000),
      }, {
        signal: controller.signal,
        onProgress: (percentage, message) => setAnalysisProgress({ percentage, message }),
      });
      if (controller.signal.aborted) return;
      setMetadata(result.metadata);
      setEvents(eventMapFromCandidates(result.events));
      setPoseFrames(result.poseFrames);
      setManualHeadEntryPoint(false);
      setPointSelectionMode(null);
      setPast([]);
      setFuture([]);
      setRevisionHistory([]);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "候補解析に失敗しました。");
      }
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
        setAnalysisProgress(null);
      }
    }
  }, [analysisMode, calibration, direction, file, metadata, stroke]);

  const cancelCandidateAnalysis = useCallback(() => {
    analysisAbortRef.current?.abort();
  }, []);

  const saveCalibration = useCallback(() => {
    if (!calibration) return;
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
  }, [calibration]);

  const loadCalibration = useCallback(() => {
    try {
      const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as StartCalibrationV1;
      validateStartCalibration(saved);
      clearAnalysisEvidence();
      setDirection(saved.travelDirection);
      setCalibrationMarks({
        zeroMeter: saved.zeroMeter,
        fiveMeter: saved.fiveMeter,
        waterFirst: saved.waterSurface[0],
        waterSecond: saved.waterSurface[1],
      });
      setError(null);
    } catch {
      setError("保存済み校正は無効なため読み込めませんでした。");
    }
  }, [clearAnalysisEvidence]);

  const exportPng = useCallback(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 840;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#c7d2fe";
    context.font = "700 26px sans-serif";
    context.fillText("MOTIONANALYSYS START · 未検証ベータ", 64, 70);
    context.fillStyle = "#ffffff";
    context.font = "700 46px sans-serif";
    context.fillText(analysisMode === "precision" ? "競泳スタート精密分析" : "競泳スタート簡易タイム", 64, 130);
    context.font = "24px sans-serif";
    context.fillStyle = "#dbeafe";
    context.fillText(`${stroke} · ${age}歳 · ${sex === "male" ? "男子基準" : "女子基準"}`, 64, 174);
    context.fillText(`品質: ${coreResult.quality.status}`, 64, 214);
    context.font = "700 22px sans-serif";
    const displayedMetrics = analysisMode === "precision"
      ? coreResult.metrics
      : coreResult.metrics.filter((metric) => timingOnlyMetricIds.has(metric.id));
    displayedMetrics.forEach((metric, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 64 + column * 650;
      const y = 280 + row * 80;
      context.fillStyle = "#94a3b8";
      context.fillText(metric.label, x, y);
      context.fillStyle = metric.value === null ? "#fbbf24" : "#ffffff";
      context.fillText(metric.value === null ? "—" : `${metric.value.toFixed(2)} ${metric.unit}`, x, y + 30);
    });
    context.fillStyle = "#fbbf24";
    context.font = "18px sans-serif";
    context.fillText(
      analysisMode === "precision"
        ? "2D参考計測。水中・3D・力・パワー・公式反応時間は測定しません。"
        : "時間のみの参考計測。距離・速度・角度・百分位は測定しません。",
      64,
      790,
    );
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, "start-analysis.png");
    }, "image/png");
  }, [age, analysisMode, coreResult, sex, stroke]);

  return (
    <section
      ref={(node) => node?.setAttribute("data-hydrated", "true")}
      data-testid="start-analysis-workspace"
      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="border-b px-5 py-5 sm:px-7">
        <p className="text-xs font-black tracking-[.18em] text-indigo-600">START ANALYSIS BETA</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black">競泳スタートを局面別に確認</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              30fpsから使える簡易タイムと、60fps以上・ほぼ真横で測る精密分析を選べます。
            </p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-950">未検証ベータ</span>
        </div>
      </header>

      <nav className="grid gap-2 border-b bg-slate-50 p-4 dark:bg-slate-950/30 sm:grid-cols-4" aria-label="スタート分析の手順">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setActiveStep(index)}
            className={`rounded-xl border p-3 text-left transition ${activeStep === index ? "border-indigo-300 bg-white text-indigo-700 dark:bg-slate-900" : "border-transparent text-slate-500 hover:border-slate-200"}`}
          >
            <span className="text-[10px] font-black">0{index + 1}</span>
            <span className="mt-1 block text-sm font-bold">{label}</span>
          </button>
        ))}
      </nav>

      {error ? <p role="alert" className="mx-5 mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}

      <div className="p-5 sm:p-7">
        {activeStep === 0 ? (
          <VideoAndProfileStep
            age={age}
            analysisMode={analysisMode}
            fixedCamera={fixedCamera}
            fps={fps}
            metadata={metadata}
            onFile={handleFile}
            onModeChange={handleAnalysisModeChange}
            onNext={() => setActiveStep(1)}
            setAge={setAge}
            setFixedCamera={setFixedCamera}
            setSex={setSex}
            setSideOn={setSideOn}
            setSingleSwimmer={setSingleSwimmer}
            setStroke={handleStrokeChange}
            sex={sex}
            sideOn={sideOn}
            singleSwimmer={singleSwimmer}
            stroke={stroke}
          />
        ) : null}

        {activeStep === 1 ? (
          <CalibrationStep
            analysisMode={analysisMode}
            calibration={calibration}
            calibrationMarks={calibrationMarks}
            direction={direction}
            onBack={() => setActiveStep(0)}
            onClickVideo={handleCalibrationClick}
            onLoad={loadCalibration}
            onNext={() => setActiveStep(2)}
            onSave={saveCalibration}
            setDirection={handleDirectionChange}
            setTarget={setCalibrationTarget}
            target={calibrationTarget}
            videoRef={videoRef}
            videoUrl={videoUrl}
          />
        ) : null}

        {activeStep === 2 ? (
          <EventReviewStep
            analysisMode={analysisMode}
            analysisProgress={analysisProgress}
            calibrationReady={analysisMode === "timing-only" || calibration !== null}
            canAnalyze={captureAllowed && (analysisMode === "timing-only" || calibration !== null) && metadata !== null}
            events={events}
            frameMs={frameMs}
            manualHeadEntryPoint={manualHeadEntryPoint}
            onBack={() => setActiveStep(1)}
            onChangeTime={changeEventTime}
            onClickVideo={handleEventVideoClick}
            onMoveFrame={moveEventByFrame}
            onNext={() => setActiveStep(3)}
            onCancelCandidates={cancelCandidateAnalysis}
            onRedo={redo}
            onRunCandidates={runCandidates}
            onSelectEntryPoint={() => setPointSelectionMode("head-entry")}
            onSetCurrentFrame={setEventAtCurrentFrame}
            onUndo={undo}
            onVerify={verifyEvent}
            pointSelectionMode={pointSelectionMode}
            redoEnabled={future.length > 0}
            undoEnabled={past.length > 0}
            videoRef={videoRef}
            videoUrl={videoUrl}
            visibleEventTypes={visibleEventTypes}
          />
        ) : null}

        {activeStep === 3 ? (
          <ResultsStep
            analysisMode={analysisMode}
            allRequiredEventsVerified={allRequiredEventsVerified}
            externalFiveMeterTimeMs={externalFiveMeterTimeMs}
            onBack={() => setActiveStep(2)}
            onCsv={() => downloadText(exportStartAnalysisCsv(coreResult), "start-analysis.csv", "text/csv")}
            onExternalFiveMeterTimeChange={setExternalFiveMeterTimeMs}
            onJson={() => downloadText(exportStartAnalysisJson(coreResult), "start-analysis.json", "application/json")}
            onPng={exportPng}
            result={coreResult}
            showBands={analysisMode === "precision" && age >= 13 && age <= 32}
          />
        ) : null}
      </div>
    </section>
  );
}

function VideoAndProfileStep({
  age,
  analysisMode,
  fixedCamera,
  fps,
  metadata,
  onFile,
  onModeChange,
  onNext,
  setAge,
  setFixedCamera,
  setSex,
  setSideOn,
  setSingleSwimmer,
  setStroke,
  sex,
  sideOn,
  singleSwimmer,
  stroke,
}: {
  readonly age: number;
  readonly analysisMode: StartAnalysisMode;
  readonly fixedCamera: boolean | null;
  readonly fps: number | null;
  readonly metadata: CompetitionVideoMetadata | null;
  readonly onFile: (file: File | null) => void;
  readonly onModeChange: (mode: StartAnalysisMode) => void;
  readonly onNext: () => void;
  readonly setAge: (value: number) => void;
  readonly setFixedCamera: (value: boolean | null) => void;
  readonly setSex: (value: "male" | "female") => void;
  readonly setSideOn: (value: boolean | null) => void;
  readonly setSingleSwimmer: (value: boolean | null) => void;
  readonly setStroke: (value: Stroke) => void;
  readonly sex: "male" | "female";
  readonly sideOn: boolean | null;
  readonly singleSwimmer: boolean | null;
  readonly stroke: Stroke;
}) {
  const assessment = metadata ? getStartFpsAssessment(metadata, analysisMode) : null;
  const canContinue = Boolean(
    metadata && assessment?.allowed && age >= 13 && singleSwimmer === true && (
      analysisMode === "timing-only" || (fixedCamera === true && sideOn === true)
    ),
  );

  return (
    <div>
      <h3 className="font-bold">1. 動画と選手区分</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">先に測定モードを選びます。対象は13歳以上です。</p>
      <fieldset className="mt-4 grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">測定モード</legend>
        <label className={`cursor-pointer rounded-2xl border-2 p-4 transition ${analysisMode === "precision" ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/30" : "border-slate-200 dark:border-slate-700"}`}>
          <span className="flex items-center gap-2">
            <input type="radio" name="start-analysis-mode" value="precision" checked={analysisMode === "precision"} onChange={() => onModeChange("precision")} />
            <span className="font-black">精密モード</span>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">推奨</span>
          </span>
          <span className="mt-2 block text-sm text-slate-600 dark:text-slate-300">60fps以上・固定・ほぼ真横。離台／入水の距離・速度・角度まで測定します。</span>
        </label>
        <label className={`cursor-pointer rounded-2xl border-2 p-4 transition ${analysisMode === "timing-only" ? "border-sky-600 bg-sky-50 dark:bg-sky-950/30" : "border-slate-200 dark:border-slate-700"}`}>
          <span className="flex items-center gap-2">
            <input type="radio" name="start-analysis-mode" value="timing-only" checked={analysisMode === "timing-only"} onChange={() => onModeChange("timing-only")} />
            <span className="font-black">簡易タイムモード</span>
          </span>
          <span className="mt-2 block text-sm text-slate-600 dark:text-slate-300">30fps以上・斜め撮影可。時間だけを参考計測し、距離・速度・角度・百分位は表示しません。</span>
        </label>
      </fieldset>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 text-sm font-bold">
          種目
          <select value={stroke} onChange={(event) => setStroke(event.target.value as Stroke)} className="h-11 rounded-xl border px-3">
            <option value="freestyle">自由形（飛び込み）</option>
            <option value="butterfly">バタフライ（飛び込み）</option>
            <option value="breaststroke">平泳ぎ（飛び込み）</option>
            <option value="backstroke">背泳ぎ（壁スタート）</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-bold">
          年齢
          <input type="number" min={0} value={age} onChange={(event) => setAge(Number(event.target.value))} className="h-11 rounded-xl border px-3" />
        </label>
        <label className="grid gap-2 text-sm font-bold">
          研究比較区分{analysisMode === "timing-only" ? "（記録のみ）" : ""}
          <select value={sex} onChange={(event) => setSex(event.target.value as "male" | "female")} className="h-11 rounded-xl border px-3">
            <option value="male">男子基準</option>
            <option value="female">女子基準</option>
          </select>
        </label>
      </div>

      <label className="mt-5 grid gap-2 text-sm font-bold">
        スタート動画
        <input
          data-testid="start-video-input"
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="rounded-xl border border-dashed px-4 py-6"
          onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        />
      </label>

      {age < 13 ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">13歳未満は本アプリの解析対象外です。</p> : null}
      {metadata ? (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/30">
          <p>{metadata.fileName} · {fps?.toFixed(1) ?? "不明"} fps</p>
          {!assessment?.allowed ? <p className="mt-1 text-rose-700">{assessment?.message}</p> : null}
          {assessment?.allowed && assessment.message ? <p className="mt-1 text-amber-800">{assessment.message}</p> : null}
        </div>
      ) : null}
      {analysisMode === "precision" && age > 32 ? <p className="mt-3 text-sm text-amber-800">33歳以上は解析できますが、Born 2026の参考帯は表示しません。</p> : null}

      <div className="mt-4 grid gap-2 text-sm">
        <label><input type="checkbox" checked={fixedCamera === true} onChange={(event) => setFixedCamera(event.target.checked)} /> 固定カメラを確認{analysisMode === "timing-only" ? "（推奨）" : ""}</label>
        <label><input type="checkbox" checked={sideOn === true} onChange={(event) => setSideOn(event.target.checked)} /> 真横撮影を確認{analysisMode === "timing-only" ? "（任意）" : ""}</label>
        <label><input type="checkbox" checked={singleSwimmer === true} onChange={(event) => setSingleSwimmer(event.target.checked)} /> 1レーン・1選手を確認</label>
      </div>
      {analysisMode === "precision" && (fixedCamera !== true || sideOn !== true || singleSwimmer !== true) ? <p className="mt-3 text-sm text-rose-700">固定・真横・1選手を確認するまで、精密解析へ進めません。</p> : null}
      {analysisMode === "timing-only" && singleSwimmer !== true ? <p className="mt-3 text-sm text-rose-700">1レーン・1選手を確認してから進んでください。</p> : null}
      <p className="mt-3 text-xs text-slate-500">年齢・研究比較区分は結果ファイルにだけ含め、端末へ保存しません。</p>
      <div className="mt-6 flex justify-end"><Button onClick={onNext} disabled={!canContinue}>{analysisMode === "precision" ? "次へ：校正" : "次へ：進行方向"}</Button></div>
    </div>
  );
}

function CalibrationStep({
  analysisMode,
  calibration,
  calibrationMarks,
  direction,
  onBack,
  onClickVideo,
  onLoad,
  onNext,
  onSave,
  setDirection,
  setTarget,
  target,
  videoRef,
  videoUrl,
}: {
  readonly analysisMode: StartAnalysisMode;
  readonly calibration: StartCalibrationV1 | null;
  readonly calibrationMarks: CalibrationMarks;
  readonly direction: Direction;
  readonly onBack: () => void;
  readonly onClickVideo: (event: MouseEvent<HTMLVideoElement>) => void;
  readonly onLoad: () => void;
  readonly onNext: () => void;
  readonly onSave: () => void;
  readonly setDirection: (value: Direction) => void;
  readonly setTarget: (target: CalibrationTarget | null) => void;
  readonly target: CalibrationTarget | null;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly videoUrl: string | null;
}) {
  const marks = [
    ["zero", "0m壁", calibrationMarks.zeroMeter],
    ["five", "5m位置", calibrationMarks.fiveMeter],
    ["water1", "水面点1", calibrationMarks.waterFirst],
    ["water2", "水面点2", calibrationMarks.waterSecond],
  ] as const;

  if (analysisMode === "timing-only") {
    return (
      <div>
        <h3 className="font-bold">2. 進行方向</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          泳者が進む方向を選びます。簡易タイムでは距離校正を行わず、頭頂入水と5m通過は映像を見て手動で確定します。
        </p>
        {videoUrl ? <video ref={videoRef} src={videoUrl} controls className="mt-4 max-h-[28rem] w-full rounded-xl bg-black" /> : null}
        <label className="mt-4 grid max-w-xs gap-2 text-sm font-bold">
          進行方向
          <select aria-label="進行方向" value={direction} onChange={(event) => setDirection(event.target.value as Direction)} className="h-11 rounded-md border px-3 text-sm">
            <option value="left-to-right">左から右</option>
            <option value="right-to-left">右から左</option>
          </select>
        </label>
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          30fpsでは1フレーム約33msです。自動候補の位置を必ず1フレームずつ確認してください。
        </p>
        <div className="mt-6 flex justify-between">
          <Button variant="outline" onClick={onBack}>戻る</Button>
          <Button onClick={onNext}>次へ：候補イベント</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-bold">2. 0m・5m・水面校正</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">ボタンで点を選び、動画上を1回クリックします。仮の既定座標は使いません。</p>
      {videoUrl ? <video ref={videoRef} src={videoUrl} controls onClick={onClickVideo} className="mt-4 max-h-[28rem] w-full rounded-xl bg-black" /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {marks.map(([value, label, point]) => (
          <Button key={value} size="sm" variant={target === value ? "default" : "outline"} onClick={() => setTarget(value)}>
            {point ? "✓ " : ""}{label}
          </Button>
        ))}
        <select aria-label="進行方向" value={direction} onChange={(event) => setDirection(event.target.value as Direction)} className="h-9 rounded-md border px-2 text-sm">
          <option value="left-to-right">左から右</option>
          <option value="right-to-left">右から左</option>
        </select>
      </div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        {calibration ? "0m・5m・水面2点の校正が有効です。" : "4点すべてを指定し、0m→5mが進行方向と整合する必要があります。"}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onSave} disabled={!calibration}>この端末へ校正のみ保存</Button>
        <Button size="sm" variant="outline" onClick={onLoad}>保存済み校正を読込</Button>
        <Button size="sm" variant="ghost" onClick={() => localStorage.removeItem(CALIBRATION_STORAGE_KEY)}>保存を削除</Button>
      </div>
      <div className="mt-6 flex justify-between">
        <Button variant="outline" onClick={onBack}>戻る</Button>
        <Button onClick={onNext} disabled={!calibration}>次へ：候補イベント</Button>
      </div>
    </div>
  );
}

function EventReviewStep({
  analysisMode,
  analysisProgress,
  calibrationReady,
  canAnalyze,
  events,
  frameMs,
  manualHeadEntryPoint,
  onBack,
  onChangeTime,
  onClickVideo,
  onMoveFrame,
  onNext,
  onCancelCandidates,
  onRedo,
  onRunCandidates,
  onSelectEntryPoint,
  onSetCurrentFrame,
  onUndo,
  onVerify,
  pointSelectionMode,
  redoEnabled,
  undoEnabled,
  videoRef,
  videoUrl,
  visibleEventTypes,
}: {
  readonly analysisMode: StartAnalysisMode;
  readonly analysisProgress: { percentage: number; message: string } | null;
  readonly calibrationReady: boolean;
  readonly canAnalyze: boolean;
  readonly events: EventMap;
  readonly frameMs: number;
  readonly manualHeadEntryPoint: boolean;
  readonly onBack: () => void;
  readonly onChangeTime: (type: StartEventType, seconds: string) => void;
  readonly onClickVideo: (event: MouseEvent<HTMLVideoElement>) => void;
  readonly onMoveFrame: (type: StartEventType, delta: number) => void;
  readonly onNext: () => void;
  readonly onCancelCandidates: () => void;
  readonly onRedo: () => void;
  readonly onRunCandidates: () => void;
  readonly onSelectEntryPoint: () => void;
  readonly onSetCurrentFrame: (type: StartEventType) => void;
  readonly onUndo: () => void;
  readonly onVerify: (type: StartEventType) => void;
  readonly pointSelectionMode: "head-entry" | null;
  readonly redoEnabled: boolean;
  readonly undoEnabled: boolean;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly videoUrl: string | null;
  readonly visibleEventTypes: readonly StartEventType[];
}) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-bold">3. 候補イベント確認</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">自動解析は候補までです。各イベントは動画とフレームを確認してから確定してください。</p>
        </div>
        {analysisProgress ? (
          <Button size="sm" variant="outline" onClick={onCancelCandidates}>
            <Pause className="mr-1 h-4 w-4" />中断
          </Button>
        ) : (
          <Button size="sm" onClick={onRunCandidates} disabled={!canAnalyze || !calibrationReady}>候補を解析</Button>
        )}
      </div>
      {analysisProgress ? <p className="mt-3 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-950">{analysisProgress.percentage.toFixed(0)}% · {analysisProgress.message}</p> : null}
      {analysisMode === "timing-only" ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-950">簡易タイムでは頭頂入水と5m通過の自動候補を出しません。該当フレームで「現在フレーム」を押して確定してください。</p> : null}
      {videoUrl ? <video ref={videoRef} src={videoUrl} controls onClick={onClickVideo} className="mt-4 max-h-[28rem] w-full rounded-xl bg-black" /> : null}
      {analysisMode === "precision" && pointSelectionMode === "head-entry" ? <p className="mt-3 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-950">動画上の頭頂入水位置を1回クリックしてください。その点と現在フレームを候補にします。</p> : null}

      <div className="mt-4 space-y-3">
        {visibleEventTypes.map((type) => {
          const event = events[type];
          const requiresPoint = analysisMode === "precision" && type === "head-entry";
          const canVerify = event.timestampMs !== null && (!requiresPoint || manualHeadEntryPoint);
          return (
            <div key={type} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{eventLabels[type]}</p>
                  <p className="text-xs text-slate-500">
                    {statusLabel(event.status)}{event.status !== "unavailable" ? ` · 信頼度 ${(event.confidence * 100).toFixed(0)}%` : ""}
                    {requiresPoint ? ` · ${manualHeadEntryPoint ? "点指定済み" : "コーチの点指定が必要"}` : ""}
                  </p>
                </div>
                <span className="text-xs text-slate-500">{event.frameIndex === null ? "frame —" : `frame ${event.frameIndex}`}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <label className="sr-only" htmlFor={`start-event-${type}`}>{eventLabels[type]}時刻</label>
                <input
                  id={`start-event-${type}`}
                  type="number"
                  min={0}
                  step={0.001}
                  value={event.timestampMs === null ? "" : (event.timestampMs / 1000).toFixed(3)}
                  onChange={(input) => onChangeTime(type, input.target.value)}
                  className="h-9 rounded-lg border px-2 text-right"
                  placeholder="秒"
                />
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => onMoveFrame(type, -1)}>−1f</Button>
                  <Button size="sm" variant="outline" onClick={() => onMoveFrame(type, 1)}>+1f</Button>
                </div>
                <Button size="sm" variant="outline" onClick={() => onSetCurrentFrame(type)}>
                  現在フレーム
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {requiresPoint ? <Button size="sm" variant="outline" onClick={onSelectEntryPoint}>動画で頭頂点を指定</Button> : null}
                <Button size="sm" onClick={() => onVerify(type)} disabled={!canVerify}>
                  {event.status === "verified" ? <><Check className="mr-1 h-4 w-4" />確認済み</> : "確認して確定"}
                </Button>
                {event.timestampMs !== null ? <span className="self-center text-xs text-slate-500">{(event.timestampMs / 1000).toFixed(3)} s · 1f = {(frameMs / 1000).toFixed(4)} s</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="outline" onClick={onUndo} disabled={!undoEnabled}><Undo2 className="mr-1 h-4 w-4" />Undo</Button>
        <Button size="sm" variant="outline" onClick={onRedo} disabled={!redoEnabled}><Redo2 className="mr-1 h-4 w-4" />Redo</Button>
      </div>
      <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-950"><AlertTriangle className="h-4 w-4 shrink-0" />候補・要確認イベントは、確認済みになるまで数値の依存条件を満たしません。画面外・飛沫・遮蔽は未取得のままにしてください。</p>
      <div className="mt-6 flex justify-between">
        <Button variant="outline" onClick={onBack}>戻る</Button>
        <Button onClick={onNext}>結果を見る</Button>
      </div>
    </div>
  );
}

function ResultsStep({
  analysisMode,
  allRequiredEventsVerified,
  externalFiveMeterTimeMs,
  onBack,
  onCsv,
  onExternalFiveMeterTimeChange,
  onJson,
  onPng,
  result,
  showBands,
}: {
  readonly analysisMode: StartAnalysisMode;
  readonly allRequiredEventsVerified: boolean;
  readonly externalFiveMeterTimeMs: number | null;
  readonly onBack: () => void;
  readonly onCsv: () => void;
  readonly onExternalFiveMeterTimeChange: (value: number | null) => void;
  readonly onJson: () => void;
  readonly onPng: () => void;
  readonly result: StartAnalysisResultV1;
  readonly showBands: boolean;
}) {
  const bands: Record<NonNullable<StartAnalysisResultV1["percentiles"][number]["band"]>, string> = {
    "below-p3": "P3未満",
    "p3-p10": "P3〜P10",
    "p10-p25": "P10〜P25",
    "p25-p50": "P25〜P50",
    "p50-p75": "P50〜P75",
    "p75-p90": "P75〜P90",
    "p90-p97": "P90〜P97",
    "above-p97": "P97超",
  };
  const displayedMetrics = analysisMode === "precision"
    ? result.metrics
    : result.metrics.filter((metric) => timingOnlyMetricIds.has(metric.id));

  return (
    <div>
      <h3 className="font-bold">4. {analysisMode === "precision" ? "局面別結果" : "簡易タイム結果"}</h3>
      {analysisMode === "timing-only" ? <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-950">30fps以上の時間専用参考計測です。距離・速度・角度・百分位は表示しません。</p> : null}
      {!allRequiredEventsVerified ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">必要イベントをコーチがすべて確認するまで、値は確定しません。以下の「—」は欠測または未確定です。</p> : null}
      {result.quality.warnings.length > 0 ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-950/30 dark:text-slate-200"><p className="font-bold">品質・制約</p><ul className="mt-1 list-disc pl-5">{result.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {displayedMetrics.map((metric) => (
          <div key={metric.id} className="rounded-xl border p-3">
            <p className="text-xs font-bold text-slate-500">{metric.label}</p>
            <p className="mt-1 text-xl font-black">{metric.value === null ? "—" : `${metric.value.toFixed(2)} ${metric.unit}`}</p>
            <p className="mt-1 text-xs text-slate-500">{metric.note ?? ""}</p>
          </div>
        ))}
      </div>
      {analysisMode === "precision" ? <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-950">
        <p className="font-bold">Born et al. 2026 エリート参考帯</p>
        {!showBands ? <p className="mt-1">33歳以上は研究比較年齢範囲外のため表示しません。</p> : null}
        {showBands && result.percentiles.length === 0 ? <p className="mt-1">ブロック／壁接触時間・入水時間・入水距離・5m時間は、条件を満たした確認済み値だけに表示します。</p> : null}
        {showBands ? result.percentiles.map((percentile) => <p key={percentile.metric} className="mt-1">{percentile.metric}：{percentile.band ? bands[percentile.band] : percentile.note ?? "比較対象外"}</p>) : null}
        <p className="mt-2 text-xs">時間は小さいほど、距離は大きいほど高パフォーマンス側として表示形式を変換しています。合否・総合点・才能判定ではありません。</p>
      </div> : null}
      <label className="mt-5 grid max-w-sm gap-2 rounded-xl border p-3 text-sm font-bold">
        外部ストップウォッチ5m（記録のみ・参考帯には不使用）
        <input
          type="number"
          min={0}
          step={0.001}
          value={externalFiveMeterTimeMs === null ? "" : (externalFiveMeterTimeMs / 1000).toFixed(3)}
          onChange={(event) => {
            if (!event.target.value.trim()) {
              onExternalFiveMeterTimeChange(null);
              return;
            }
            const seconds = Number(event.target.value);
            onExternalFiveMeterTimeChange(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null);
          }}
          className="h-9 rounded-lg border px-2 text-right"
          placeholder="秒"
        />
        <span className="text-xs font-normal text-slate-500">動画上の5m頭頂通過が確認できない場合の記録です。JSON/CSVへ保存しますが、5m指標・研究参考帯の計算には使いません。</span>
      </label>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" onClick={onJson}><FileJson className="mr-1 h-4 w-4" />JSON</Button>
        <Button variant="outline" onClick={onCsv}><FileSpreadsheet className="mr-1 h-4 w-4" />CSV</Button>
        <Button variant="outline" onClick={onPng}><ImageDown className="mr-1 h-4 w-4" />PNG</Button>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        {analysisMode === "precision"
          ? "水中速度、最大深度、キック、ブレイクアウト、3D速度、力、パワー、仕事量、公式反応時間、失格判定は扱いません。"
          : "簡易タイムでは距離、速度、角度、百分位、水中局面、公式反応時間、失格判定を扱いません。"}
      </p>
      <Button className="mt-5" variant="outline" onClick={onBack}>イベントを修正</Button>
    </div>
  );
}
