"use client";

import {
  Activity,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileJson,
  FileSpreadsheet,
  FileVideo2,
  Flag,
  Gauge,
  ImageDown,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Scissors,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  applySwimTimelineEditForUi,
  exportSwimAnalysisCsvForUi,
  exportSwimAnalysisJsonForUi,
  runSwimAnalysisForUi,
} from "@/components/swim/analysis-adapter";
import type {
  SwimAnalysisViewResult,
  SwimEventType,
  SwimTimelineEventView,
  SwimWorkflowStep,
} from "@/components/swim/view-models";
import {
  getModeFpsAssessment,
  inspectCompetitionVideo,
  isSupportedCompetitionVideoFile,
  type CompetitionVideoMetadata,
} from "@/lib/video/competition-frame-source";
import type { AnalysisMode, StrokeStyle } from "@/types/competition";

const MAX_TRIM_SECONDS = 30;
const MIN_TRIM_SECONDS = 0.5;
const MIN_GATE_GAP = 0.03;
const CALIBRATION_STORAGE_KEY = "motionanalysys.swim-calibration.v2";
const LEGACY_CALIBRATION_STORAGE_KEY = "motionanalysys.swim-calibration.v1";

const MODE_OPTIONS: readonly {
  id: AnalysisMode;
  label: string;
  description: string;
  available: boolean;
}[] = [
  {
    id: "swim",
    label: "Swim",
    description: "直進泳の速度とストロークを確認",
    available: true,
  },
  {
    id: "turn",
    label: "Turn",
    description: "進入・壁接触・蹴り出しを分析",
    available: false,
  },
  {
    id: "start",
    label: "Start",
    description: "離台・入水・浮き上がりを分析",
    available: false,
  },
];

const STROKE_OPTIONS: readonly { id: StrokeStyle; label: string }[] = [
  { id: "freestyle", label: "自由形" },
  { id: "backstroke", label: "背泳ぎ" },
  { id: "breaststroke", label: "平泳ぎ" },
  { id: "butterfly", label: "バタフライ" },
];

const EVENT_LABELS: Readonly<Record<SwimEventType, string>> = {
  leftStroke: "左ストローク",
  rightStroke: "右ストローク",
  bilateralStroke: "両手ストローク",
  gateCrossing: "ゲート通過",
};

function eventLabel(event: SwimTimelineEventView): string {
  if (event.type !== "gateCrossing") {
    return EVENT_LABELS[event.type];
  }
  return event.gateId === "gate-a"
    ? "ゲートA通過"
    : event.gateId === "gate-b"
      ? "ゲートB通過"
      : EVENT_LABELS.gateCrossing;
}

function eventNeedsReview(event: SwimTimelineEventView): boolean {
  return event.status === "needs-review" || event.status === "unavailable";
}

function eventStatusLabel(event: SwimTimelineEventView): string {
  switch (event.status) {
    case "verified":
      return "手動確認済み";
    case "confirmed":
      return "自動確定";
    case "needs-review":
      return "要確認";
    case "unavailable":
      return "信頼度不足";
  }
}

interface VideoSource {
  readonly file: File;
  readonly url: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
}

interface SavedCalibration {
  readonly version: 2;
  readonly firstGateX: number;
  readonly secondGateX: number;
  readonly distanceMeters: number;
  readonly imageWidth: number | null;
  readonly imageHeight: number | null;
  readonly rotation: number | null;
  readonly savedAt: string;
}

interface LegacySavedCalibration {
  readonly version: 1;
  readonly firstGateX: number;
  readonly secondGateX: number;
  readonly distanceMeters: number;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  readonly rotation?: number;
  readonly savedAt?: string;
}

function formatTime(timestampMs: number): string {
  const safeMs = Number.isFinite(timestampMs) ? Math.max(0, timestampMs) : 0;
  const totalSeconds = safeMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function formatMetric(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const digits =
    unit === "count"
      ? Number.isInteger(value)
        ? 0
        : 1
      : unit === "cycles/min"
        ? 1
        : 2;
  const formatted = value.toFixed(digits);
  return unit === "count" ? formatted : `${formatted} ${unit}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sourceAspectRatio(source: VideoSource): string {
  return source.width > 0 && source.height > 0
    ? `${source.width} / ${source.height}`
    : "16 / 9";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function resultFileStem(sourceName: string, sessionLabel: string | null): string {
  const raw = sessionLabel?.trim() || sourceName.replace(/\.[^.]+$/, "");
  const safe = raw.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 72);
  return `swim-analysis-${safe || "session"}`;
}

function isSavedCalibration(value: unknown): value is SavedCalibration {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SavedCalibration>;
  return (
    candidate.version === 2 &&
    typeof candidate.firstGateX === "number" &&
    candidate.firstGateX >= 0 &&
    candidate.firstGateX <= 1 &&
    typeof candidate.secondGateX === "number" &&
    candidate.secondGateX >= 0 &&
    candidate.secondGateX <= 1 &&
    Math.abs(candidate.secondGateX - candidate.firstGateX) >= MIN_GATE_GAP &&
    typeof candidate.distanceMeters === "number" &&
    candidate.distanceMeters > 0 &&
    (candidate.imageWidth === null ||
      (typeof candidate.imageWidth === "number" && candidate.imageWidth > 0)) &&
    (candidate.imageHeight === null ||
      (typeof candidate.imageHeight === "number" && candidate.imageHeight > 0)) &&
    (candidate.rotation === null ||
      (typeof candidate.rotation === "number" &&
        Number.isFinite(candidate.rotation))) &&
    typeof candidate.savedAt === "string"
  );
}

function migrateLegacyCalibration(value: unknown): SavedCalibration | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<LegacySavedCalibration>;
  if (
    candidate.version !== 1 ||
    typeof candidate.firstGateX !== "number" ||
    candidate.firstGateX < 0 ||
    candidate.firstGateX > 1 ||
    typeof candidate.secondGateX !== "number" ||
    candidate.secondGateX < 0 ||
    candidate.secondGateX > 1 ||
    Math.abs(candidate.secondGateX - candidate.firstGateX) < MIN_GATE_GAP ||
    typeof candidate.distanceMeters !== "number" ||
    candidate.distanceMeters <= 0
  ) {
    return null;
  }

  return {
    version: 2,
    firstGateX: candidate.firstGateX,
    secondGateX: candidate.secondGateX,
    distanceMeters: candidate.distanceMeters,
    imageWidth:
      typeof candidate.imageWidth === "number" && candidate.imageWidth > 0
        ? candidate.imageWidth
        : null,
    imageHeight:
      typeof candidate.imageHeight === "number" && candidate.imageHeight > 0
        ? candidate.imageHeight
        : null,
    rotation:
      typeof candidate.rotation === "number" &&
      Number.isFinite(candidate.rotation)
        ? candidate.rotation
        : null,
    savedAt:
      typeof candidate.savedAt === "string"
        ? candidate.savedAt
        : new Date().toISOString(),
  };
}

export function SwimAnalysisWorkspace() {
  const [step, setStep] = useState<SwimWorkflowStep>("setup");
  const [mode, setMode] = useState<AnalysisMode>("swim");
  const [stroke, setStroke] = useState<StrokeStyle>("freestyle");
  const [sessionLabel, setSessionLabel] = useState("");
  const [source, setSource] = useState<VideoSource | null>(null);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(0);
  const [firstGateX, setFirstGateX] = useState(0.18);
  const [secondGateX, setSecondGateX] = useState(0.82);
  const [distanceMeters, setDistanceMeters] = useState(5);
  const [rememberCalibration, setRememberCalibration] = useState(false);
  const [savedCalibration, setSavedCalibration] =
    useState<SavedCalibration | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("準備しています");
  const [result, setResult] = useState<SwimAnalysisViewResult | null>(null);
  const [videoMetadata, setVideoMetadata] =
    useState<CompetitionVideoMetadata | null>(null);
  const [videoInspectionPending, setVideoInspectionPending] = useState(false);
  const [videoInspectionError, setVideoInspectionError] =
    useState<string | null>(null);
  const [newEventType, setNewEventType] =
    useState<SwimEventType>("leftStroke");
  const [newEventGate, setNewEventGate] =
    useState<"gate-a" | "gate-b">("gate-a");
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<VideoSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inspectionAbortRef = useRef<AbortController | null>(null);
  const manualEventCounterRef = useRef(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sourceFile = source?.file ?? null;

  useEffect(() => {
    workspaceRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    if (!sourceFile) {
      return;
    }
    const controller = new AbortController();
    inspectionAbortRef.current?.abort();
    inspectionAbortRef.current = controller;

    void inspectCompetitionVideo(sourceFile, controller.signal)
      .then((metadata) => {
        if (controller.signal.aborted) {
          return;
        }
        setVideoMetadata(metadata);
        setSource((current) =>
          current?.file === sourceFile
            ? {
                ...current,
                durationMs: metadata.durationMs,
                width: metadata.displayWidth,
                height: metadata.displayHeight,
              }
            : current,
        );
        setTrimEndMs((current) =>
          current > 0
            ? Math.min(current, metadata.durationMs)
            : Math.min(metadata.durationMs, MAX_TRIM_SECONDS * 1000),
        );
      })
      .catch((inspectionError: unknown) => {
        if (!controller.signal.aborted) {
          setVideoInspectionError(
            inspectionError instanceof Error
              ? inspectionError.message
              : "動画情報を確認できませんでした。",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setVideoInspectionPending(false);
          inspectionAbortRef.current = null;
        }
      });

    return () => controller.abort();
  }, [sourceFile]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isSavedCalibration(parsed)) {
            setSavedCalibration(parsed);
            return;
          }
          window.localStorage.removeItem(CALIBRATION_STORAGE_KEY);
        }

        const legacyRaw = window.localStorage.getItem(
          LEGACY_CALIBRATION_STORAGE_KEY,
        );
        if (!legacyRaw) {
          return;
        }
        const migrated = migrateLegacyCalibration(JSON.parse(legacyRaw));
        window.localStorage.removeItem(LEGACY_CALIBRATION_STORAGE_KEY);
        if (migrated) {
          window.localStorage.setItem(
            CALIBRATION_STORAGE_KEY,
            JSON.stringify(migrated),
          );
          setSavedCalibration(migrated);
        }
      } catch {
        window.localStorage.removeItem(CALIBRATION_STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_CALIBRATION_STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      inspectionAbortRef.current?.abort();
      const activeSource = sourceRef.current;
      if (activeSource) {
        URL.revokeObjectURL(activeSource.url);
      }
    };
  }, []);

  const trimDurationMs = Math.max(0, trimEndMs - trimStartMs);
  const trimIsValid =
    source !== null &&
    trimDurationMs >= MIN_TRIM_SECONDS * 1000 &&
    trimDurationMs <= MAX_TRIM_SECONDS * 1000 + 0.5;
  const calibrationIsValid =
    Math.abs(secondGateX - firstGateX) >= MIN_GATE_GAP &&
    Number.isFinite(distanceMeters) &&
    distanceMeters > 0;

  const videoAssessment = useMemo(
    () => (videoMetadata ? getModeFpsAssessment(videoMetadata, "swim") : null),
    [videoMetadata],
  );
  const analysisAllowed = videoAssessment?.allowed === true;

  const orderedEvents = useMemo(
    () =>
      [...(result?.events ?? [])].sort(
        (first, second) => first.timestampMs - second.timestampMs,
      ),
    [result],
  );

  const configureFile = useCallback((file: File) => {
    setError(null);
    if (!isSupportedCompetitionVideoFile(file)) {
      setError("動画ファイルを選択してください。MP4、MOV、WebMに対応します。");
      return;
    }
    inspectionAbortRef.current?.abort();
    const previous = sourceRef.current;
    if (previous) {
      URL.revokeObjectURL(previous.url);
    }
    const nextSource: VideoSource = {
      file,
      url: URL.createObjectURL(file),
      durationMs: 0,
      width: 0,
      height: 0,
    };
    sourceRef.current = nextSource;
    setSource(nextSource);
    setResult(null);
    setVideoMetadata(null);
    setVideoInspectionError(null);
    setVideoInspectionPending(true);
    setTrimStartMs(0);
    setTrimEndMs(0);
    setCurrentTimeMs(0);
  }, []);

  const onFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        configureFile(file);
      }
    },
    [configureFile],
  );

  const onVideoMetadata = useCallback(() => {
    const video = videoRef.current;
    const activeSource = sourceRef.current;
    if (!video || !activeSource) {
      return;
    }
    const durationMs = video.duration * 1000;
    if (
      !Number.isFinite(durationMs) ||
      durationMs < MIN_TRIM_SECONDS * 1000 ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      setError("動画の長さまたは画面サイズを読み取れませんでした。");
      return;
    }
    const readySource = {
      ...activeSource,
      durationMs,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    setSource(readySource);
    if (activeSource.durationMs === 0) {
      setTrimStartMs(0);
      setTrimEndMs(Math.min(durationMs, MAX_TRIM_SECONDS * 1000));
    }
  }, []);

  const setTrimStart = useCallback(
    (nextMs: number) => {
      if (!source) {
        return;
      }
      const upperBound = Math.max(0, trimEndMs - MIN_TRIM_SECONDS * 1000);
      const bounded = clamp(nextMs, 0, upperBound);
      setTrimStartMs(bounded);
      if (trimEndMs - bounded > MAX_TRIM_SECONDS * 1000) {
        setTrimEndMs(bounded + MAX_TRIM_SECONDS * 1000);
      }
      if (videoRef.current) {
        videoRef.current.currentTime = bounded / 1000;
      }
    },
    [source, trimEndMs],
  );

  const setTrimEnd = useCallback(
    (nextMs: number) => {
      if (!source) {
        return;
      }
      const minimum = trimStartMs + MIN_TRIM_SECONDS * 1000;
      const maximum = Math.min(
        source.durationMs,
        trimStartMs + MAX_TRIM_SECONDS * 1000,
      );
      const bounded = clamp(nextMs, minimum, maximum);
      setTrimEndMs(bounded);
      if (videoRef.current) {
        videoRef.current.currentTime = bounded / 1000;
      }
    },
    [source, trimStartMs],
  );

  const moveGate = useCallback(
    (gate: "first" | "second", nextValue: number) => {
      if (gate === "first") {
        setFirstGateX(clamp(nextValue, 0, secondGateX - MIN_GATE_GAP));
      } else {
        setSecondGateX(clamp(nextValue, firstGateX + MIN_GATE_GAP, 1));
      }
    },
    [firstGateX, secondGateX],
  );

  const beginGateDrag = useCallback(
    (gate: "first" | "second", event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const handleMove = (pointerEvent: PointerEvent) => {
        const stage = stageRef.current;
        if (!stage) {
          return;
        }
        const bounds = stage.getBoundingClientRect();
        const normalized = clamp((pointerEvent.clientX - bounds.left) / bounds.width, 0, 1);
        moveGate(gate, normalized);
      };
      const handleEnd = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
        window.removeEventListener("pointercancel", handleEnd);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd, { once: true });
      window.addEventListener("pointercancel", handleEnd, { once: true });
    },
    [moveGate],
  );

  const applySavedCalibration = useCallback(() => {
    if (!savedCalibration) {
      return;
    }
    setFirstGateX(savedCalibration.firstGateX);
    setSecondGateX(savedCalibration.secondGateX);
    setDistanceMeters(savedCalibration.distanceMeters);
  }, [savedCalibration]);

  const deleteSavedCalibration = useCallback(() => {
    window.localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_CALIBRATION_STORAGE_KEY);
    setSavedCalibration(null);
    setRememberCalibration(false);
  }, []);

  const persistCalibration = useCallback(() => {
    if (!rememberCalibration) {
      return;
    }
    const saved: SavedCalibration = {
      version: 2,
      firstGateX,
      secondGateX,
      distanceMeters,
      imageWidth: source?.width ?? 0,
      imageHeight: source?.height ?? 0,
      rotation: Number(videoMetadata?.rotation ?? 0),
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(saved));
    setSavedCalibration(saved);
  }, [
    distanceMeters,
    firstGateX,
    rememberCalibration,
    secondGateX,
    source?.height,
    source?.width,
    videoMetadata?.rotation,
  ]);

  const runAnalysis = useCallback(async () => {
    if (!source || !trimIsValid || !calibrationIsValid || !analysisAllowed) {
      setError(
        videoAssessment?.message ??
          "動画情報、解析区間、距離校正を確認してください。",
      );
      return;
    }
    persistCalibration();
    setError(null);
    setProgress(0);
    setProgressMessage("動画を準備しています");
    setStep("analyzing");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const nextResult = await runSwimAnalysisForUi(
        {
          mode,
          stroke,
          sessionLabel: sessionLabel.trim() || null,
          sourceName: source.file.name,
          sourceFile: source.file,
          sourceWidth: source.width,
          sourceHeight: source.height,
          trimStartMs,
          trimEndMs,
          firstGateX,
          secondGateX,
          distanceMeters,
        },
        {
          signal: controller.signal,
          onProgress: (nextProgress, message) => {
            if (
              controller.signal.aborted ||
              abortRef.current !== controller
            ) {
              return;
            }
            setProgress(clamp(nextProgress, 0, 100));
            setProgressMessage(message);
          },
        },
      );
      if (
        controller.signal.aborted ||
        abortRef.current !== controller
      ) {
        return;
      }
      setResult(nextResult);
      setCurrentTimeMs(nextResult.trim.startMs);
      setStep("results");
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = nextResult.trim.startMs / 1000;
        }
      }, 0);
    } catch (caughtError) {
      if (
        !controller.signal.aborted &&
        abortRef.current === controller
      ) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "解析中に予期しないエラーが発生しました。",
        );
        setStep("calibration");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [
    analysisAllowed,
    calibrationIsValid,
    distanceMeters,
    firstGateX,
    mode,
    persistCalibration,
    secondGateX,
    sessionLabel,
    source,
    stroke,
    trimEndMs,
    trimIsValid,
    trimStartMs,
    videoAssessment?.message,
  ]);

  const cancelAnalysis = useCallback(() => {
    const controller = abortRef.current;
    controller?.abort();
    if (abortRef.current === controller) {
      abortRef.current = null;
    }
    setStep("calibration");
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    const activeSource = sourceRef.current;
    if (activeSource) {
      URL.revokeObjectURL(activeSource.url);
    }
    sourceRef.current = null;
    setSource(null);
    setResult(null);
    inspectionAbortRef.current?.abort();
    inspectionAbortRef.current = null;
    setVideoMetadata(null);
    setVideoInspectionError(null);
    setVideoInspectionPending(false);
    setTrimStartMs(0);
    setTrimEndMs(0);
    setCurrentTimeMs(0);
    setProgress(0);
    setError(null);
    setStep("setup");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const seekVideo = useCallback((timestampMs: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = timestampMs / 1000;
    setCurrentTimeMs(timestampMs);
  }, []);

  const addManualEvent = useCallback(() => {
    if (!result) {
      return;
    }
    manualEventCounterRef.current += 1;
    const timestampMs = clamp(
      currentTimeMs,
      result.trim.startMs,
      result.trim.endMs,
    );
    setResult(
      applySwimTimelineEditForUi(result, {
        action: "add",
        id: `manual-${Date.now()}-${manualEventCounterRef.current}`,
        type: newEventType,
        timestampMs,
        gateId: newEventType === "gateCrossing" ? newEventGate : null,
      }),
    );
  }, [currentTimeMs, newEventGate, newEventType, result]);

  const moveEvent = useCallback(
    (eventId: string, timestampMs: number) => {
      if (!result) {
        return;
      }
      setResult(
        applySwimTimelineEditForUi(result, {
          action: "move",
          eventId,
          timestampMs,
        }),
      );
    },
    [result],
  );

  const verifyEvent = useCallback(
    (eventId: string) => {
      if (!result) {
        return;
      }
      setResult(
        applySwimTimelineEditForUi(result, {
          action: "verify",
          eventId,
        }),
      );
    },
    [result],
  );

  const deleteEvent = useCallback(
    (eventId: string) => {
      if (!result) {
        return;
      }
      setResult(
        applySwimTimelineEditForUi(result, {
          action: "remove",
          eventId,
        }),
      );
    },
    [result],
  );

  const exportJson = useCallback(() => {
    if (!result) {
      return;
    }
    downloadBlob(
      new Blob([exportSwimAnalysisJsonForUi(result)], {
        type: "application/json;charset=utf-8",
      }),
      `${resultFileStem(result.sourceName, result.sessionLabel)}.json`,
    );
  }, [result]);

  const exportCsv = useCallback(() => {
    if (!result) {
      return;
    }
    downloadBlob(
      new Blob(["\uFEFF", exportSwimAnalysisCsvForUi(result)], {
        type: "text/csv;charset=utf-8",
      }),
      `${resultFileStem(result.sourceName, result.sessionLabel)}.csv`,
    );
  }, [result]);

  const exportPng = useCallback(async () => {
    if (!result || !source || !videoRef.current) {
      return;
    }
    const video = videoRef.current;
    if (video.readyState < 2) {
      setError("PNGを書き出す前に動画フレームを読み込んでください。");
      return;
    }
    const canvas = document.createElement("canvas");
    const videoHeight = source.height;
    const summaryHeight = Math.max(210, Math.round(source.height * 0.28));
    canvas.width = source.width;
    canvas.height = videoHeight + summaryHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, videoHeight);
    const drawGate = (x: number, label: string, color: string) => {
      const pixelX = x * canvas.width;
      context.strokeStyle = color;
      context.lineWidth = Math.max(3, canvas.width / 320);
      context.beginPath();
      context.moveTo(pixelX, 0);
      context.lineTo(pixelX, videoHeight);
      context.stroke();
      context.fillStyle = color;
      context.font = `bold ${Math.max(18, canvas.width / 42)}px system-ui`;
      context.fillText(label, pixelX + 10, 36);
    };
    drawGate(result.calibration.firstGateX, "A", "#38bdf8");
    drawGate(result.calibration.secondGateX, "B", "#f472b6");
    context.fillStyle = "#020617";
    context.fillRect(0, videoHeight, canvas.width, summaryHeight);
    context.fillStyle = "#ffffff";
    context.font = `bold ${Math.max(18, canvas.width / 46)}px system-ui`;
    context.fillText(
      `${result.sessionLabel || "Swim分析"}  |  ${formatTime(currentTimeMs)}  |  ${result.stroke}`,
      20,
      videoHeight + 38,
    );
    const columnWidth = canvas.width / 3;
    const metricFontSize = Math.max(14, canvas.width / 64);
    result.metrics.slice(0, 6).forEach((metric, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 20 + column * columnWidth;
      const y = videoHeight + 84 + row * 66;
      context.fillStyle = "#94a3b8";
      context.font = `600 ${Math.max(11, metricFontSize * 0.72)}px system-ui`;
      context.fillText(metric.label, x, y);
      context.fillStyle = "#ffffff";
      context.font = `bold ${metricFontSize}px system-ui`;
      context.fillText(formatMetric(metric.value, metric.unit), x, y + 26);
    });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (blob) {
      downloadBlob(
        blob,
        `${resultFileStem(result.sourceName, result.sessionLabel)}-${Math.round(currentTimeMs)}ms.png`,
      );
    }
  }, [currentTimeMs, result, source]);

  return (
    <div
      ref={workspaceRef}
      className="space-y-6"
      id="swim-analysis"
      data-testid="swim-analysis-workspace"
      data-hydrated="false"
    >
      <WorkflowProgress step={step} />

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

      {step === "setup" && (
        <SetupPanel
          mode={mode}
          stroke={stroke}
          sessionLabel={sessionLabel}
          source={source}
          trimStartMs={trimStartMs}
          trimEndMs={trimEndMs}
          trimIsValid={trimIsValid}
          videoMetadata={videoMetadata}
          videoInspectionPending={videoInspectionPending}
          videoInspectionError={videoInspectionError}
          videoAssessment={videoAssessment}
          videoRef={videoRef}
          fileInputRef={fileInputRef}
          onModeChange={setMode}
          onStrokeChange={setStroke}
          onSessionLabelChange={setSessionLabel}
          onFileChange={onFileChange}
          onVideoMetadata={onVideoMetadata}
          onTrimStartChange={setTrimStart}
          onTrimEndChange={setTrimEnd}
          onNext={() => {
            if (trimIsValid) {
              setError(null);
              setStep("calibration");
              window.setTimeout(() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = trimStartMs / 1000;
                }
              }, 0);
            }
          }}
        />
      )}

      {step === "calibration" && source && (
        <CalibrationPanel
          source={source}
          videoRef={videoRef}
          stageRef={stageRef}
          firstGateX={firstGateX}
          secondGateX={secondGateX}
          distanceMeters={distanceMeters}
          calibrationIsValid={calibrationIsValid}
          analysisAllowed={analysisAllowed}
          assessmentMessage={videoAssessment?.message ?? videoInspectionError}
          savedCalibration={savedCalibration}
          rememberCalibration={rememberCalibration}
          onVideoMetadata={onVideoMetadata}
          onGateChange={moveGate}
          onBeginGateDrag={beginGateDrag}
          onDistanceChange={setDistanceMeters}
          onApplySaved={applySavedCalibration}
          onDeleteSaved={deleteSavedCalibration}
          onRememberChange={setRememberCalibration}
          onBack={() => setStep("setup")}
          onAnalyze={() => void runAnalysis()}
        />
      )}

      {step === "analyzing" && source && (
        <AnalyzingPanel
          source={source}
          progress={progress}
          message={progressMessage}
          onCancel={cancelAnalysis}
        />
      )}

      {step === "results" && source && result && (
        <ResultsPanel
          source={source}
          result={result}
          events={orderedEvents}
          currentTimeMs={currentTimeMs}
          newEventType={newEventType}
          newEventGate={newEventGate}
          videoRef={videoRef}
          onVideoMetadata={onVideoMetadata}
          onTimeUpdate={(timeMs) => setCurrentTimeMs(timeMs)}
          onSeek={seekVideo}
          onNewEventTypeChange={setNewEventType}
          onNewEventGateChange={setNewEventGate}
          onAddEvent={addManualEvent}
          onMoveEvent={moveEvent}
          onVerifyEvent={verifyEvent}
          onDeleteEvent={deleteEvent}
          onExportJson={exportJson}
          onExportCsv={exportCsv}
          onExportPng={() => void exportPng()}
          onReset={reset}
        />
      )}
    </div>
  );
}

function WorkflowProgress({ step }: { step: SwimWorkflowStep }) {
  const steps = [
    { id: "setup", label: "動画と区間" },
    { id: "calibration", label: "距離校正" },
    { id: "analyzing", label: "自動解析" },
    { id: "results", label: "コーチ確認" },
  ] as const;
  const activeIndex = steps.findIndex((item) => item.id === step);
  return (
    <nav
      aria-label="競泳分析の進行状況"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <ol className="grid grid-cols-4">
        {steps.map((item, index) => {
          const completed = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li
              key={item.id}
              aria-current={active ? "step" : undefined}
              className={`flex min-h-16 items-center gap-2 border-r border-slate-200 px-2 last:border-r-0 dark:border-slate-800 sm:px-4 ${
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
                      : "bg-slate-100 dark:bg-slate-800"
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
  );
}

function SetupPanel({
  mode,
  stroke,
  sessionLabel,
  source,
  trimStartMs,
  trimEndMs,
  trimIsValid,
  videoMetadata,
  videoInspectionPending,
  videoInspectionError,
  videoAssessment,
  videoRef,
  fileInputRef,
  onModeChange,
  onStrokeChange,
  onSessionLabelChange,
  onFileChange,
  onVideoMetadata,
  onTrimStartChange,
  onTrimEndChange,
  onNext,
}: {
  mode: AnalysisMode;
  stroke: StrokeStyle;
  sessionLabel: string;
  source: VideoSource | null;
  trimStartMs: number;
  trimEndMs: number;
  trimIsValid: boolean;
  videoMetadata: CompetitionVideoMetadata | null;
  videoInspectionPending: boolean;
  videoInspectionError: string | null;
  videoAssessment: { readonly allowed: boolean; readonly message: string | null } | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onModeChange: (mode: AnalysisMode) => void;
  onStrokeChange: (stroke: StrokeStyle) => void;
  onSessionLabelChange: (label: string) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onVideoMetadata: () => void;
  onTrimStartChange: (timeMs: number) => void;
  onTrimEndChange: (timeMs: number) => void;
  onNext: () => void;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20 sm:p-7 lg:p-9">
      <div className="max-w-3xl">
        <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
          STEP 1 / 分析の準備
        </p>
        <h2 className="mt-3 text-2xl font-black sm:text-3xl">
          コーチが見たい局面を先に決める
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">
          現在は直進泳のSwim分析に対応しています。解析する動画はこの端末内だけで処理します。
        </p>
      </div>

      <fieldset className="mt-7">
        <legend className="text-sm font-black">分析モード</legend>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {MODE_OPTIONS.map((option) => {
            const selected = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={!option.available}
                aria-pressed={option.available ? selected : undefined}
                onClick={() => option.available && onModeChange(option.id)}
                className={`relative rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100 dark:bg-indigo-950/50 dark:ring-indigo-950"
                    : "border-slate-200 dark:border-slate-800"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-lg font-black">{option.label}</span>
                  {option.available ? (
                    selected && <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      検証中
                    </span>
                  )}
                </div>
                <span className="mt-2 block text-xs leading-5 text-slate-500">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.6fr)]">
        <fieldset>
          <legend className="text-sm font-black">泳法</legend>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STROKE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={stroke === option.id}
                onClick={() => onStrokeChange(option.id)}
                className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                  stroke === option.id
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-slate-200 hover:border-indigo-300 dark:border-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-sm font-black">
            セッション名 <span className="font-medium text-slate-500">（任意）</span>
          </span>
          <input
            type="text"
            value={sessionLabel}
            maxLength={80}
            onChange={(event) => onSessionLabelChange(event.target.value)}
            placeholder="例：8/1 午前 100m Fr"
            className="mt-3 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
      </div>

      <div className="mt-7 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/50">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              <FileVideo2 className="h-6 w-6" />
            </span>
            <div>
              <p className="font-black">固定カメラの動画を選択</p>
              <p className="mt-1 text-xs text-slate-500">
                泳者を横から撮り、ズームやカメラ移動のない動画を推奨
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl bg-slate-950 text-white hover:bg-indigo-700 dark:bg-white dark:text-slate-950 sm:w-auto"
          >
            <Upload className="mr-2 h-4 w-4" />
            動画を選ぶ
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/*"
            onChange={onFileChange}
            className="sr-only"
            aria-label="競泳分析に使う動画"
          />
        </div>
      </div>

      {source && (
        <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(19rem,0.6fr)]">
          <div className="space-y-3">
            <div
              data-testid="source-video-stage"
              className="overflow-hidden rounded-2xl bg-slate-950"
              style={{ aspectRatio: sourceAspectRatio(source) }}
            >
              <video
                ref={videoRef}
                src={source.url}
                controls
                playsInline
                muted
                preload="metadata"
                onLoadedMetadata={onVideoMetadata}
                className="h-full w-full object-contain"
              />
            </div>
            <VideoInspectionPanel
              metadata={videoMetadata}
              pending={videoInspectionPending}
              error={videoInspectionError}
              assessment={videoAssessment}
            />
          </div>
          <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Scissors className="h-5 w-5 text-indigo-600" />
              <h3 className="font-black">解析区間</h3>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              30秒以内で、泳者が2本の基準線を通過する区間を選びます。
            </p>
            {source.durationMs > 0 ? (
              <div className="mt-5 space-y-5">
                <label className="block">
                  <span className="flex justify-between text-xs font-bold">
                    <span>開始</span>
                    <span>{formatTime(trimStartMs)}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, source.durationMs - MIN_TRIM_SECONDS * 1000)}
                    step={100}
                    value={trimStartMs}
                    onChange={(event) => onTrimStartChange(Number(event.target.value))}
                    className="mt-2 w-full accent-indigo-600"
                  />
                </label>
                <label className="block">
                  <span className="flex justify-between text-xs font-bold">
                    <span>終了</span>
                    <span>{formatTime(trimEndMs)}</span>
                  </span>
                  <input
                    type="range"
                    min={Math.min(source.durationMs, trimStartMs + MIN_TRIM_SECONDS * 1000)}
                    max={Math.min(source.durationMs, trimStartMs + MAX_TRIM_SECONDS * 1000)}
                    step={100}
                    value={trimEndMs}
                    onChange={(event) => onTrimEndChange(Number(event.target.value))}
                    className="mt-2 w-full accent-indigo-600"
                  />
                </label>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
                  <p className="text-xs text-slate-500">選択した長さ</p>
                  <p className={`mt-1 text-xl font-black ${trimIsValid ? "text-emerald-600" : "text-rose-600"}`}>
                    {((trimEndMs - trimStartMs) / 1000).toFixed(1)} 秒
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-500">動画情報を読み込んでいます…</p>
            )}
            <Button
              type="button"
              size="lg"
              disabled={!trimIsValid}
              onClick={onNext}
              className="mt-6 h-12 w-full rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              距離校正へ進む
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function VideoInspectionPanel({
  metadata,
  pending,
  error,
  assessment,
}: {
  metadata: CompetitionVideoMetadata | null;
  pending: boolean;
  error: string | null;
  assessment: { readonly allowed: boolean; readonly message: string | null } | null;
}) {
  if (pending) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
      >
        <LoaderCircle className="h-4 w-4 animate-spin text-indigo-600" />
        コーデック・fps・回転を確認しています
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200"
      >
        <p className="font-black">動画情報を確認できません</p>
        <p className="mt-1">{error}</p>
        <p className="mt-1">30fps以上のMP4（H.264）またはWebMへ変換してください。</p>
      </div>
    );
  }

  if (!metadata) {
    return null;
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${assessment?.allowed ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"}`}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">実効fps</dt>
          <dd className="mt-0.5 font-black">
            {metadata.effectiveFps === null
              ? "確認不可"
              : metadata.effectiveFps.toFixed(1)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">表示解像度</dt>
          <dd className="mt-0.5 font-black">
            {metadata.displayWidth}×{metadata.displayHeight}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">回転</dt>
          <dd className="mt-0.5 font-black">{metadata.rotation}°</dd>
        </div>
        <div>
          <dt className="text-slate-500">コーデック</dt>
          <dd className="mt-0.5 truncate font-black" title={metadata.codecParameterString ?? metadata.codec ?? undefined}>
            {metadata.codecParameterString ?? metadata.codec ?? "不明"}
          </dd>
          <dd className={`mt-0.5 font-black ${metadata.canDecode ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200"}`}>
            {metadata.canDecode ? "精密デコード対応" : "精密デコード非対応"}
          </dd>
        </div>
      </dl>
      <p className={`mt-3 text-xs font-black ${assessment?.allowed ? "text-emerald-700 dark:text-emerald-300" : "text-amber-900 dark:text-amber-200"}`}>
        {assessment?.allowed ? "Swim精密解析に使用できます" : assessment?.message}
      </p>
      {!assessment?.allowed && (
        <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">
          プレビューは確認できます。30fps以上のMP4（H.264）またはWebMで撮り直すか変換してください。
        </p>
      )}
    </div>
  );
}

function CalibrationPanel({
  source,
  videoRef,
  stageRef,
  firstGateX,
  secondGateX,
  distanceMeters,
  calibrationIsValid,
  analysisAllowed,
  assessmentMessage,
  savedCalibration,
  rememberCalibration,
  onVideoMetadata,
  onGateChange,
  onBeginGateDrag,
  onDistanceChange,
  onApplySaved,
  onDeleteSaved,
  onRememberChange,
  onBack,
  onAnalyze,
}: {
  source: VideoSource;
  videoRef: RefObject<HTMLVideoElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  firstGateX: number;
  secondGateX: number;
  distanceMeters: number;
  calibrationIsValid: boolean;
  analysisAllowed: boolean;
  assessmentMessage: string | null;
  savedCalibration: SavedCalibration | null;
  rememberCalibration: boolean;
  onVideoMetadata: () => void;
  onGateChange: (gate: "first" | "second", value: number) => void;
  onBeginGateDrag: (
    gate: "first" | "second",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onDistanceChange: (distance: number) => void;
  onApplySaved: () => void;
  onDeleteSaved: () => void;
  onRememberChange: (remember: boolean) => void;
  onBack: () => void;
  onAnalyze: () => void;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
      <div className="border-b border-slate-200 p-5 dark:border-slate-800 sm:p-7">
        <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
          STEP 2 / 距離校正
        </p>
        <h2 className="mt-2 text-2xl font-black">既知の距離を2本の線で挟む</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          レーンロープの印やプールサイドの目印など、実距離が分かる2点へA・Bを合わせます。カメラと泳者が同じ位置関係のときだけ再利用してください。
        </p>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.65fr)]">
        <div className="bg-slate-950 p-3 sm:p-5">
          <div
            ref={stageRef}
            data-testid="calibration-video-stage"
            className="relative mx-auto overflow-hidden rounded-xl bg-black"
            style={{ aspectRatio: sourceAspectRatio(source) }}
          >
            <video
              ref={videoRef}
              src={source.url}
              controls
              playsInline
              muted
              preload="metadata"
              onLoadedMetadata={onVideoMetadata}
              className="h-full w-full object-contain"
            />
            <GateHandle
              gate="first"
              label="A"
              value={firstGateX}
              color="bg-sky-400"
              onChange={onGateChange}
              onPointerDown={onBeginGateDrag}
            />
            <GateHandle
              gate="second"
              label="B"
              value={secondGateX}
              color="bg-pink-400"
              onChange={onGateChange}
              onPointerDown={onBeginGateDrag}
            />
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            線をドラッグ、またはキーボードの左右キーで移動
          </p>
        </div>

        <aside className="border-t border-slate-200 p-5 dark:border-slate-800 sm:p-7 xl:border-l xl:border-t-0">
          {savedCalibration && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/40">
              <p className="text-xs font-black text-sky-800 dark:text-sky-200">
                保存済みの校正があります
              </p>
              <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">
                {savedCalibration.distanceMeters.toFixed(2)} m・
                {savedCalibration.imageWidth !== null &&
                savedCalibration.imageHeight !== null
                  ? `${savedCalibration.imageWidth}×${savedCalibration.imageHeight}`
                  : "旧形式から移行"}
                {savedCalibration.rotation !== null
                  ? `・${savedCalibration.rotation}°`
                  : ""}
              </p>
              {savedCalibration.imageWidth !== null &&
                savedCalibration.imageHeight !== null &&
                (savedCalibration.imageWidth !== source.width ||
                  savedCalibration.imageHeight !== source.height) && (
                <p className="mt-2 text-xs font-bold text-amber-800 dark:text-amber-200">
                  前回と表示解像度が異なります。適用後、映像上の目印へ線を合わせ直してください。
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={onApplySaved}
                  className="text-xs font-black text-indigo-700 underline underline-offset-4 dark:text-indigo-300"
                >
                  この校正を適用
                </button>
                <button
                  type="button"
                  onClick={onDeleteSaved}
                  className="inline-flex items-center gap-1 text-xs font-black text-rose-700 underline underline-offset-4 dark:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  保存済み校正を削除
                </button>
              </div>
            </div>
          )}

          <label className="mt-5 block">
            <span className="text-sm font-black">A–B間の実距離</span>
            <span className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={distanceMeters}
                onChange={(event) => onDistanceChange(Number(event.target.value))}
                className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-lg font-black outline-none ring-indigo-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              />
              <span className="font-black">m</span>
            </span>
          </label>

          <div className="mt-5 space-y-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-950/60">
            <GateRange
              label="ゲートA"
              value={firstGateX}
              onChange={(value) => onGateChange("first", value)}
            />
            <GateRange
              label="ゲートB"
              value={secondGateX}
              onChange={(value) => onGateChange("second", value)}
            />
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              checked={rememberCalibration}
              onChange={(event) => onRememberChange(event.target.checked)}
              className="mt-1 h-4 w-4 accent-indigo-600"
            />
            <span>
              この端末に校正を保存する
              <span className="block text-xs text-slate-500">
                映像や分析結果は保存しません
              </span>
            </span>
          </label>

          {!analysisAllowed && (
            <div
              data-testid="result-video-stage"
              role="alert"
              className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p className="font-black">この動画では解析を開始できません</p>
              <p className="mt-1">
                {assessmentMessage ??
                  "動画情報の確認後に解析できるか判定します。"}
              </p>
              <p className="mt-1">
                30fps以上のMP4（H.264）またはWebMで撮り直すか変換してください。
              </p>
            </div>
          )}

          <div className="mt-7 grid gap-3">
            <Button
              type="button"
              size="lg"
              disabled={!calibrationIsValid || !analysisAllowed}
              onClick={onAnalyze}
              className="h-12 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <CheckCircle2 className="mr-2 h-5 w-5" />
              校正を確定して解析
            </Button>
            <Button type="button" variant="outline" onClick={onBack} className="rounded-xl">
              <ArrowLeft className="mr-2 h-4 w-4" />
              動画と区間へ戻る
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function GateHandle({
  gate,
  label,
  value,
  color,
  onChange,
  onPointerDown,
}: {
  gate: "first" | "second";
  label: string;
  value: number;
  color: string;
  onChange: (gate: "first" | "second", value: number) => void;
  onPointerDown: (
    gate: "first" | "second",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  return (
    <button
      type="button"
      role="slider"
      aria-label={`距離校正ゲート${label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`画面左から${Math.round(value * 100)}パーセント`}
      onPointerDown={(event) => onPointerDown(gate, event)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.02 : 0.005;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onChange(gate, value - step);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onChange(gate, value + step);
        }
      }}
      className="absolute inset-y-0 z-10 w-9 -translate-x-1/2 cursor-ew-resize touch-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{ left: `${value * 100}%` }}
    >
      <span className={`absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 ${color}`} />
      <span className={`absolute left-1/2 top-3 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full ${color} text-xs font-black text-slate-950 shadow-lg`}>
        {label}
      </span>
    </button>
  );
}

function GateRange({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs font-bold">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-indigo-600"
      />
    </label>
  );
}

function AnalyzingPanel({
  source,
  progress,
  message,
  onCancel,
}: {
  source: VideoSource;
  progress: number;
  message: string;
  onCancel: () => void;
}) {
  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-10">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </span>
      <p className="mt-6 text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
        STEP 3 / 自動解析
      </p>
      <h2 className="mt-2 text-2xl font-black">ストロークと通過時間を確認中</h2>
      <p className="mt-2 truncate text-sm text-slate-500">{source.file.name}</p>
      <div className="mt-8">
        <div className="flex justify-between text-xs font-bold">
          <span>{message}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4" />
        動画と姿勢推定はこの端末内で処理
      </p>
      <Button type="button" variant="outline" onClick={onCancel} className="mt-8 rounded-xl">
        <X className="mr-2 h-4 w-4" />
        解析をキャンセル
      </Button>
    </section>
  );
}

function ResultsPanel({
  source,
  result,
  events,
  currentTimeMs,
  newEventType,
  newEventGate,
  videoRef,
  onVideoMetadata,
  onTimeUpdate,
  onSeek,
  onNewEventTypeChange,
  onNewEventGateChange,
  onAddEvent,
  onMoveEvent,
  onVerifyEvent,
  onDeleteEvent,
  onExportJson,
  onExportCsv,
  onExportPng,
  onReset,
}: {
  source: VideoSource;
  result: SwimAnalysisViewResult;
  events: readonly SwimTimelineEventView[];
  currentTimeMs: number;
  newEventType: SwimEventType;
  newEventGate: "gate-a" | "gate-b";
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoMetadata: () => void;
  onTimeUpdate: (timeMs: number) => void;
  onSeek: (timeMs: number) => void;
  onNewEventTypeChange: (type: SwimEventType) => void;
  onNewEventGateChange: (gate: "gate-a" | "gate-b") => void;
  onAddEvent: () => void;
  onMoveEvent: (id: string, timestampMs: number) => void;
  onVerifyEvent: (id: string) => void;
  onDeleteEvent: (id: string) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onExportPng: () => void;
  onReset: () => void;
}) {
  const metrics = result.metrics.slice(0, 6);
  const coveragePercent = Math.round(result.quality.coverage * 100);
  const timelineDuration = Math.max(1, result.trim.endMs - result.trim.startMs);
  const eventStepMs = result.competition.videoInput.effectiveFps
    ? 1000 / result.competition.videoInput.effectiveFps
    : 1;
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                解析完了
              </span>
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                {STROKE_OPTIONS.find((item) => item.id === result.stroke)?.label ?? result.stroke}
              </span>
            </div>
            <h2 className="mt-4 text-2xl font-black sm:text-3xl">
              {result.sessionLabel || "Swim分析結果"}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {formatTime(result.trim.startMs)}–{formatTime(result.trim.endMs)} ・ 検出率 {coveragePercent}%
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ExportButton label="JSON" icon={<FileJson className="h-5 w-5" />} onClick={onExportJson} />
            <ExportButton label="CSV" icon={<FileSpreadsheet className="h-5 w-5" />} onClick={onExportCsv} />
            <ExportButton label="PNG" icon={<ImageDown className="h-5 w-5" />} onClick={onExportPng} />
          </div>
        </div>
      </section>

      <section aria-labelledby="swim-metrics-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
              COACH METRICS
            </p>
            <h2 id="swim-metrics-heading" className="mt-2 text-2xl font-black">
              この1本を6つの数字で見る
            </h2>
          </div>
          <p className="hidden text-xs text-slate-500 sm:block">推定値はタイムラインで確認できます</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metrics.map((metric, index) => (
            <article
              key={metric.key}
              data-testid={`swim-metric-${metric.key}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-500">{metric.label}</p>
                  <p className="mt-2 text-3xl font-black tabular-nums">
                    {formatMetric(metric.value, metric.unit)}
                  </p>
                </div>
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${index < 2 ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"}`}>
                  {index === 0 ? <Clock3 className="h-5 w-5" /> : index === 1 ? <Gauge className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-500">{metric.detail}</span>
                <span className={`rounded-full px-2 py-1 font-black ${metric.quality === "verified" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : metric.quality === "confirmed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : metric.quality === "needs-review" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
                  {metric.quality === "verified" ? "確認済み" : metric.quality === "confirmed" ? "確定" : metric.quality === "needs-review" ? "要確認" : "—"}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
          <div className="bg-slate-950 p-3 sm:p-5">
            <div
              className="relative overflow-hidden rounded-xl bg-black"
              style={{ aspectRatio: sourceAspectRatio(source) }}
            >
              <video
                ref={videoRef}
                src={source.url}
                controls
                playsInline
                muted
                preload="metadata"
                onLoadedMetadata={onVideoMetadata}
                onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime * 1000)}
                className="h-full w-full object-contain"
              />
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400"
                style={{ left: `${result.calibration.firstGateX * 100}%` }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-pink-400"
                style={{ left: `${result.calibration.secondGateX * 100}%` }}
              />
            </div>
          </div>
          <aside className="border-t border-slate-200 p-5 dark:border-slate-800 sm:p-7 xl:border-l xl:border-t-0">
            <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
              REVIEW
            </p>
            <h3 className="mt-2 text-xl font-black">映像とイベントを照合</h3>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
                <dt className="text-xs text-slate-500">現在時点</dt>
                <dd className="mt-1 font-black">{formatTime(currentTimeMs)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
                <dt className="text-xs text-slate-500">校正距離</dt>
                <dd className="mt-1 font-black">{result.calibration.distanceMeters.toFixed(2)} m</dd>
              </div>
            </dl>
            {result.quality.warnings.length > 0 && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-black">確認ポイント</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {result.quality.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section data-testid="event-timeline" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
              EVENT TIMELINE
            </p>
            <h2 className="mt-2 text-2xl font-black">自動検出をコーチが確定する</h2>
          </div>
          <p className="text-xs text-slate-500">移動・追加・削除後の内容を書き出せます</p>
        </div>

        <div className="mt-6 rounded-2xl bg-slate-950 px-4 py-6">
          <div className="relative h-12">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-700" />
            {events.map((event) => {
              const position = clamp(
                (event.timestampMs - result.trim.startMs) / timelineDuration,
                0,
                1,
              );
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onSeek(event.timestampMs)}
                  aria-label={`${eventLabel(event)} ${formatTime(event.timestampMs)}へ移動`}
                  className={`absolute top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-950 focus-visible:outline-none focus-visible:ring-white ${event.status === "verified" ? "bg-indigo-400" : eventNeedsReview(event) ? "bg-amber-400" : "bg-emerald-400"}`}
                  style={{ left: `${position * 100}%` }}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-bold text-slate-400">
            <span>{formatTime(result.trim.startMs)}</span>
            <span>{formatTime(result.trim.endMs)}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-[1fr_0.7fr_auto] sm:items-end">
          <label>
            <span className="text-xs font-bold text-slate-500">イベントを追加</span>
            <select
              value={newEventType}
              onChange={(event) => onNewEventTypeChange(event.target.value as SwimEventType)}
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-950"
            >
              {(Object.keys(EVENT_LABELS) as SwimEventType[]).map((eventType) => (
                <option key={eventType} value={eventType}>
                  {EVENT_LABELS[eventType]}
                </option>
              ))}
            </select>
          </label>
          <label className={newEventType === "gateCrossing" ? "block" : "invisible"}>
            <span className="text-xs font-bold text-slate-500">通過ゲート</span>
            <select
              value={newEventGate}
              disabled={newEventType !== "gateCrossing"}
              onChange={(event) => onNewEventGateChange(event.target.value as "gate-a" | "gate-b")}
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="gate-a">ゲートA</option>
              <option value="gate-b">ゲートB</option>
            </select>
          </label>
          <Button type="button" onClick={onAddEvent} className="h-11 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
            <Plus className="mr-2 h-4 w-4" />
            現在位置に追加
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              イベントはまだありません。動画を移動して手動イベントを追加できます。
            </div>
          ) : (
            events.map((event) => (
              <article
                key={event.id}
                data-testid="timeline-event"
                className="grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 lg:grid-cols-[minmax(9rem,0.6fr)_minmax(14rem,1.4fr)_auto] lg:items-center"
              >
                <button type="button" onClick={() => onSeek(event.timestampMs)} className="text-left">
                  <span className="flex items-center gap-2">
                    <Flag className={`h-4 w-4 ${event.status === "verified" ? "text-indigo-500" : eventNeedsReview(event) ? "text-amber-500" : "text-emerald-500"}`} />
                    <span className="font-black">{eventLabel(event)}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatTime(event.timestampMs)}・{event.source === "automatic" ? "自動" : "手動"}
                  </span>
                </button>
                <label className="block">
                  <span className="sr-only">{eventLabel(event)}の時刻を移動</span>
                  <input
                    type="range"
                    min={result.trim.startMs}
                    max={result.trim.endMs}
                    step={eventStepMs}
                    value={event.timestampMs}
                    onChange={(changeEvent) => {
                      const timestampMs = Number(changeEvent.target.value);
                      onMoveEvent(event.id, timestampMs);
                      onSeek(timestampMs);
                    }}
                    className="w-full accent-indigo-600"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onVerifyEvent(event.id)}
                    disabled={event.status === "verified"}
                    aria-pressed={event.status === "verified"}
                    className={`min-h-10 flex-1 rounded-xl px-3 text-xs font-black disabled:cursor-default lg:flex-none ${event.status === "verified" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : eventNeedsReview(event) ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}
                  >
                    {event.status === "verified" ? eventStatusLabel(event) : `${eventStatusLabel(event)}・手動確認`}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteEvent(event.id)}
                    className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:hover:bg-rose-950"
                    aria-label={`${eventLabel(event)}を削除`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <div className="flex justify-center">
        <Button type="button" variant="outline" onClick={onReset} className="rounded-xl">
          <RefreshCcw className="mr-2 h-4 w-4" />
          新しい動画を解析
        </Button>
      </div>
    </div>
  );
}

function ExportButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-16 rounded-xl border border-slate-200 p-3 text-center text-xs font-bold hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-950/50"
    >
      <span className="mx-auto mb-1.5 grid place-items-center">{icon}</span>
      <Download className="sr-only" />
      {label}
    </button>
  );
}
