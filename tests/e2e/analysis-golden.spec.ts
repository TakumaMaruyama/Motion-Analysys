import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { AnalysisResultV1 } from "../../types/analysis";

const goldenVideoPath = process.env.MOTION_ANALYSIS_GOLDEN_VIDEO;

async function analyzeAndDownloadResult(
  page: Page,
  videoPath: string,
): Promise<{
  result: AnalysisResultV1;
  decodedFrameFingerprints: readonly number[];
}> {
  await page.locator('input[type="file"]').setInputFiles(videoPath);
  await expect(page.getByText("この映像で解析します")).toBeVisible();
  await page.getByRole("button", { name: "解析を開始" }).click();
  await expect(page.getByText("解析できました")).toBeVisible({
    timeout: 120_000,
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Playwright did not provide the JSON download path.");
  }
  const result = JSON.parse(
    await readFile(downloadPath, "utf8"),
  ) as AnalysisResultV1;

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  const csvPath = await (await csvDownloadPromise).path();
  if (!csvPath) {
    throw new Error("Playwright did not provide the CSV download path.");
  }
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain("schemaVersion,analyzedAt,inputKind");
  expect(csv).toContain(",metric,");

  const pngDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG" }).click();
  const pngPath = await (await pngDownloadPromise).path();
  if (!pngPath) {
    throw new Error("Playwright did not provide the PNG download path.");
  }
  const png = await readFile(pngPath);
  expect([...png.subarray(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);

  const decodedFrameFingerprints = await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (!video || !Number.isFinite(video.duration)) {
      throw new Error("Result video is unavailable for fingerprinting.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }

    const nextPaint = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    const seek = (seconds: number) =>
      new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          video.removeEventListener("error", onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener("seeked", onSeeked);
          reject(new Error("Video seek failed."));
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        video.currentTime = seconds;
      });

    const fingerprints = [];
    for (const fraction of [0, 0.25, 0.5, 0.75, 0.95]) {
      await seek(video.duration * fraction);
      await nextPaint();
      await nextPaint();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let hash = 2_166_136_261;
      for (let index = 0; index < pixels.length; index += 64) {
        hash ^= pixels[index];
        hash = Math.imul(hash, 16_777_619);
      }
      fingerprints.push(hash >>> 0);
    }
    return fingerprints;
  });

  return { result, decodedFrameFingerprints };
}

function commonValidAngleDifferences(
  first: AnalysisResultV1,
  second: AnalysisResultV1,
): {
  metric: string;
  timestampMs: number;
  firstDeg: number;
  secondDeg: number;
  differenceDeg: number;
}[] {
  const differences = [];
  for (const [metricKey, firstSeries] of Object.entries(first.metrics)) {
    const secondSeries = second.metrics[metricKey];
    if (!secondSeries) {
      continue;
    }
    const secondByTimestamp = new Map(
      secondSeries.values.map((value) => [value.timestampMs, value]),
    );
    for (const firstValue of firstSeries.values) {
      const secondValue = secondByTimestamp.get(firstValue.timestampMs);
      if (
        firstValue.unit === "deg" &&
        firstValue.status === "valid" &&
        firstValue.value !== null &&
        secondValue?.status === "valid" &&
        secondValue.value !== null
      ) {
        differences.push({
          metric: metricKey,
          timestampMs: firstValue.timestampMs,
          firstDeg: firstValue.value,
          secondDeg: secondValue.value,
          differenceDeg: Math.abs(firstValue.value - secondValue.value),
        });
      }
    }
  }
  return differences;
}

test("同一動画の再解析は固定時刻と主要角度を再現する", async ({ page }) => {
  test.skip(
    !goldenVideoPath,
    "Set MOTION_ANALYSIS_GOLDEN_VIDEO to a rights-cleared person video.",
  );
  test.setTimeout(300_000);

  await page.goto("/");
  const firstRun = await analyzeAndDownloadResult(page, goldenVideoPath!);
  await page
    .getByRole("button", { name: "新しい映像を解析" })
    .click();
  await expect(
    page.getByRole("heading", { name: "動画を選んで解析" }),
  ).toBeVisible();
  const secondRun = await analyzeAndDownloadResult(page, goldenVideoPath!);
  const first = firstRun.result;
  const second = secondRun.result;

  expect(first.input.name).toBe(basename(goldenVideoPath!));
  expect(second.input.name).toBe(basename(goldenVideoPath!));
  expect(secondRun.decodedFrameFingerprints).toEqual(
    firstRun.decodedFrameFingerprints,
  );
  expect(second.sampling.timestampsMs).toEqual(first.sampling.timestampsMs);
  expect(second.sampling.frameCount).toBe(first.sampling.frameCount);

  const angleDifferences = commonValidAngleDifferences(first, second);
  expect(angleDifferences.length).toBeGreaterThan(0);
  const largestDifference = angleDifferences.sort(
    (left, right) => right.differenceDeg - left.differenceDeg,
  )[0];
  expect(
    largestDifference.differenceDeg,
    JSON.stringify(angleDifferences.slice(0, 10)),
  ).toBeLessThanOrEqual(2);
});
