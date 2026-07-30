import {
  POSE_LANDMARKER_FULL_MODEL,
  type PoseEstimator,
  type PoseFrame,
  type PoseModelInfo,
} from "../../types/analysis";

export interface SerializedWorkerError {
  readonly name: string;
  readonly message: string;
}

export type PoseWorkerRequest =
  | {
      readonly type: "init";
      readonly id: number;
    }
  | {
      readonly type: "estimate";
      readonly id: number;
      readonly bitmap: ImageBitmap;
      /** 呼び出し元の動画・カメラ時刻（ミリ秒）。 */
      readonly timestampMs: number;
    }
  | {
      readonly type: "close";
      readonly id: number;
    };

export type PoseWorkerResponse =
  | {
      readonly type: "ready";
      readonly id: number;
    }
  | {
      readonly type: "result";
      readonly id: number;
      readonly frame: PoseFrame | null;
    }
  | {
      readonly type: "closed";
      readonly id: number;
    }
  | {
      readonly type: "error";
      readonly id: number;
      readonly error: SerializedWorkerError;
    };

export type PoseWorkerFactory = () => Worker;

export interface WorkerPoseEstimatorOptions {
  readonly workerFactory?: PoseWorkerFactory;
}

interface PendingRequest {
  readonly expectedType: "ready" | "result" | "closed";
  readonly resolve: (value: PoseFrame | null | void) => void;
  readonly reject: (reason: Error) => void;
}

export class PoseEstimatorBusyError extends Error {
  constructor() {
    super("Pose estimator is already processing a frame.");
    this.name = "PoseEstimatorBusyError";
  }
}

export class PoseEstimatorClosedError extends Error {
  constructor() {
    super("Pose estimator is closed.");
    this.name = "PoseEstimatorClosedError";
  }
}

export class PoseEstimatorNotInitializedError extends Error {
  constructor() {
    super("Pose estimator has not been initialized.");
    this.name = "PoseEstimatorNotInitializedError";
  }
}

export class PoseEstimatorWorkerError extends Error {
  constructor(
    message: string,
    readonly workerErrorName = "Error",
  ) {
    super(message);
    this.name = "PoseEstimatorWorkerError";
  }
}

function defaultWorkerFactory(): Worker {
  return new Worker(
    new URL("../../workers/pose-estimator.worker.ts", import.meta.url),
    {
      type: "module",
      name: "pose-estimator",
    },
  );
}

function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    // transfer済みや既にclose済みでも、後続のエラーを隠さない。
  }
}

function isFiniteTimestamp(timestampMs: number): boolean {
  return Number.isFinite(timestampMs) && timestampMs >= 0;
}

/**
 * ImageBitmapをworkerへ所有権移譲するPoseEstimator adapter。
 *
 * estimate()へ渡したbitmapは、成功・失敗・busyを問わずこのadapterが
 * 所有権を引き受ける。呼び出し側は再利用・closeしないこと。
 */
export class WorkerPoseEstimator implements PoseEstimator<ImageBitmap> {
  readonly model: PoseModelInfo = POSE_LANDMARKER_FULL_MODEL;

  private readonly workerFactory: PoseWorkerFactory;
  private readonly pending = new Map<number, PendingRequest>();
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private busy = false;
  private closed = false;

  constructor(options: WorkerPoseEstimatorOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  async init(): Promise<void> {
    if (this.closed) {
      throw new PoseEstimatorClosedError();
    }
    if (this.initialized) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    const worker = this.ensureWorker();
    const id = this.takeRequestId();
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        expectedType: "ready",
        resolve: () => resolve(),
        reject,
      });

      try {
        const request: PoseWorkerRequest = { type: "init", id };
        worker.postMessage(request);
      } catch (error) {
        this.pending.delete(id);
        reject(this.asError(error));
      }
    })
      .then(() => {
        if (this.closed) {
          throw new PoseEstimatorClosedError();
        }
        this.initialized = true;
      })
      .finally(() => {
        this.initPromise = null;
      });

    return this.initPromise;
  }

  estimate(bitmap: ImageBitmap, timestampMs: number): Promise<PoseFrame | null> {
    if (this.closed) {
      closeBitmap(bitmap);
      return Promise.reject(new PoseEstimatorClosedError());
    }
    if (!this.initialized || !this.worker) {
      closeBitmap(bitmap);
      return Promise.reject(new PoseEstimatorNotInitializedError());
    }
    if (!isFiniteTimestamp(timestampMs)) {
      closeBitmap(bitmap);
      return Promise.reject(
        new RangeError("timestampMs must be a non-negative finite number."),
      );
    }
    if (this.busy) {
      closeBitmap(bitmap);
      return Promise.reject(new PoseEstimatorBusyError());
    }

    this.busy = true;
    const worker = this.worker;
    const id = this.takeRequestId();

    return new Promise<PoseFrame | null>((resolve, reject) => {
      this.pending.set(id, {
        expectedType: "result",
        resolve: (value) => resolve((value as PoseFrame | null) ?? null),
        reject,
      });

      try {
        const request: PoseWorkerRequest = {
          type: "estimate",
          id,
          bitmap,
          timestampMs,
        };
        worker.postMessage(request, [bitmap]);
      } catch (error) {
        this.pending.delete(id);
        closeBitmap(bitmap);
        reject(this.asError(error));
      }
    }).finally(() => {
      this.busy = false;
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.initialized = false;
    this.busy = false;
    const worker = this.worker;
    if (!worker) {
      this.rejectAllPending(new PoseEstimatorClosedError());
      return;
    }

    this.rejectAllPending(new PoseEstimatorClosedError());
    const id = this.takeRequestId();

    try {
      await new Promise<void>((resolve, reject) => {
        this.pending.set(id, {
          expectedType: "closed",
          resolve: () => resolve(),
          reject,
        });

        try {
          const request: PoseWorkerRequest = { type: "close", id };
          worker.postMessage(request);
        } catch (error) {
          this.pending.delete(id);
          reject(this.asError(error));
        }
      });
    } finally {
      this.pending.delete(id);
      worker.terminate();
      if (this.worker === worker) {
        this.worker = null;
      }
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = this.workerFactory();
    worker.onmessage = (event: MessageEvent<PoseWorkerResponse>) => {
      this.handleMessage(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      this.handleFatalWorkerError(
        new PoseEstimatorWorkerError(
          event.message || "Pose estimator worker failed.",
          "WorkerError",
        ),
      );
    };
    worker.onmessageerror = () => {
      this.handleFatalWorkerError(
        new PoseEstimatorWorkerError(
          "Pose estimator worker returned an unreadable message.",
          "DataCloneError",
        ),
      );
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(response: PoseWorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);

    if (response.type === "error") {
      pending.reject(
        new PoseEstimatorWorkerError(
          response.error.message,
          response.error.name,
        ),
      );
      return;
    }

    if (response.type !== pending.expectedType) {
      pending.reject(
        new PoseEstimatorWorkerError(
          `Unexpected worker response: expected ${pending.expectedType}, received ${response.type}.`,
          "ProtocolError",
        ),
      );
      return;
    }

    if (response.type === "result") {
      pending.resolve(response.frame);
    } else {
      pending.resolve();
    }
  }

  private handleFatalWorkerError(error: Error): void {
    this.rejectAllPending(error);
    this.busy = false;
    this.initialized = false;
    this.closed = true;
    this.worker?.terminate();
    this.worker = null;
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private takeRequestId(): number {
    const id = this.nextRequestId;
    this.nextRequestId =
      this.nextRequestId === Number.MAX_SAFE_INTEGER
        ? 1
        : this.nextRequestId + 1;
    return id;
  }

  private asError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error("Unknown pose estimator worker error.");
  }
}
