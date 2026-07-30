import { describe, expect, it, vi } from "vitest";

import {
  PoseEstimatorBusyError,
  PoseEstimatorClosedError,
  PoseEstimatorNotInitializedError,
  WorkerPoseEstimator,
  type PoseWorkerRequest,
  type PoseWorkerResponse,
} from "../../lib/pose/worker-estimator";
import type {
  PoseFrame,
  PoseLandmark,
  PoseLandmarks,
} from "../../types/analysis";

class FakeWorker {
  onmessage: ((event: MessageEvent<PoseWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: PoseWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  readonly terminate = vi.fn();

  postMessage(
    request: PoseWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.requests.push(request);
    this.transfers.push(transfer);
  }

  respond(response: PoseWorkerResponse): void {
    this.onmessage?.({
      data: response,
    } as MessageEvent<PoseWorkerResponse>);
  }
}

function bitmapWithCloseSpy(): {
  readonly bitmap: ImageBitmap;
  readonly close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  return {
    bitmap: {
      width: 640,
      height: 480,
      close,
    } as unknown as ImageBitmap,
    close,
  };
}

function poseFrame(timestampMs: number): PoseFrame {
  const landmarks = Array.from(
    { length: 33 },
    (): PoseLandmark => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0.9,
    }),
  ) as unknown as PoseLandmarks;

  return {
    timestampMs,
    imageSize: { width: 640, height: 480 },
    landmarks,
    worldLandmarks: null,
  };
}

async function initialize(
  estimator: WorkerPoseEstimator,
  worker: FakeWorker,
): Promise<void> {
  const promise = estimator.init();
  const request = worker.requests.at(-1);
  expect(request?.type).toBe("init");
  worker.respond({ type: "ready", id: request!.id });
  await promise;
}

describe("WorkerPoseEstimator", () => {
  it("initializes once and transfers each accepted ImageBitmap", async () => {
    const worker = new FakeWorker();
    const estimator = new WorkerPoseEstimator({
      workerFactory: () => worker as unknown as Worker,
    });

    const firstInit = estimator.init();
    const secondInit = estimator.init();
    expect(worker.requests).toHaveLength(1);
    const initRequest = worker.requests[0];
    worker.respond({ type: "ready", id: initRequest.id });
    await Promise.all([firstInit, secondInit]);

    const { bitmap } = bitmapWithCloseSpy();
    const estimate = estimator.estimate(bitmap, 123.5);
    const estimateRequest = worker.requests.at(-1)!;
    expect(estimateRequest).toMatchObject({
      type: "estimate",
      timestampMs: 123.5,
    });
    expect(worker.transfers.at(-1)).toEqual([bitmap]);

    const frame = poseFrame(123.5);
    worker.respond({
      type: "result",
      id: estimateRequest.id,
      frame,
    });
    await expect(estimate).resolves.toEqual(frame);
    expect(estimator.isBusy).toBe(false);
  });

  it("rejects a second in-flight frame and closes the untransferred bitmap", async () => {
    const worker = new FakeWorker();
    const estimator = new WorkerPoseEstimator({
      workerFactory: () => worker as unknown as Worker,
    });
    await initialize(estimator, worker);

    const first = bitmapWithCloseSpy();
    const second = bitmapWithCloseSpy();
    const firstEstimate = estimator.estimate(first.bitmap, 0);
    const firstRequest = worker.requests.at(-1)!;

    await expect(estimator.estimate(second.bitmap, 1)).rejects.toBeInstanceOf(
      PoseEstimatorBusyError,
    );
    expect(second.close).toHaveBeenCalledOnce();
    expect(
      worker.requests.filter((request) => request.type === "estimate"),
    ).toHaveLength(1);

    worker.respond({
      type: "result",
      id: firstRequest.id,
      frame: null,
    });
    await expect(firstEstimate).resolves.toBeNull();
  });

  it("closes frames rejected before transfer", async () => {
    const worker = new FakeWorker();
    const estimator = new WorkerPoseEstimator({
      workerFactory: () => worker as unknown as Worker,
    });
    const beforeInit = bitmapWithCloseSpy();

    await expect(
      estimator.estimate(beforeInit.bitmap, 0),
    ).rejects.toBeInstanceOf(PoseEstimatorNotInitializedError);
    expect(beforeInit.close).toHaveBeenCalledOnce();

    await initialize(estimator, worker);
    const invalidTimestamp = bitmapWithCloseSpy();
    await expect(
      estimator.estimate(invalidTimestamp.bitmap, Number.NaN),
    ).rejects.toThrow("timestampMs");
    expect(invalidTimestamp.close).toHaveBeenCalledOnce();
  });

  it("maps worker errors back to the matching request", async () => {
    const worker = new FakeWorker();
    const estimator = new WorkerPoseEstimator({
      workerFactory: () => worker as unknown as Worker,
    });
    await initialize(estimator, worker);

    const estimate = estimator.estimate(
      bitmapWithCloseSpy().bitmap,
      50,
    );
    const request = worker.requests.at(-1)!;
    worker.respond({
      type: "error",
      id: request.id,
      error: { name: "RangeError", message: "bad frame" },
    });

    await expect(estimate).rejects.toMatchObject({
      name: "PoseEstimatorWorkerError",
      message: "bad frame",
      workerErrorName: "RangeError",
    });
  });

  it("rejects pending estimates and waits for worker cleanup on close", async () => {
    const worker = new FakeWorker();
    const estimator = new WorkerPoseEstimator({
      workerFactory: () => worker as unknown as Worker,
    });
    await initialize(estimator, worker);

    const estimate = estimator.estimate(
      bitmapWithCloseSpy().bitmap,
      10,
    );
    const estimateRejection = expect(estimate).rejects.toBeInstanceOf(
      PoseEstimatorClosedError,
    );
    const closePromise = estimator.close();
    const closeRequest = worker.requests.at(-1)!;
    expect(closeRequest.type).toBe("close");

    worker.respond({ type: "closed", id: closeRequest.id });
    await closePromise;
    await estimateRejection;
    expect(worker.terminate).toHaveBeenCalledOnce();

    const afterClose = bitmapWithCloseSpy();
    await expect(
      estimator.estimate(afterClose.bitmap, 20),
    ).rejects.toBeInstanceOf(PoseEstimatorClosedError);
    expect(afterClose.close).toHaveBeenCalledOnce();
  });
});
