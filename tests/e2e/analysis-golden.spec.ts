import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { CompetitionAnalysisResultV2 } from "../../types/competition";

const goldenVideoPath = process.env.MOTION_ANALYSIS_GOLDEN_VIDEO;
const CSV_HEADER =
  "session_label,mode,stroke_style,record_type,key,value,unit,timestamp_ms,confidence,status,source";

async function openResults(page: Page, videoPath: string): Promise<void> {
  await expect(page.getByTestId("swim-analysis-workspace")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  const backstroke = page.getByRole("button", { name: "背泳ぎ", exact: true });
  await backstroke.click();
  await expect(backstroke).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "自由形", exact: true }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "動画を選ぶ" }).click();
  await (await fileChooserPromise).setFiles(videoPath);
  await expect(page.getByText("Swim精密解析に使用できます")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "距離校正へ進む" }).click();
  await page.getByRole("button", { name: "校正を確定して解析" }).click();
  await expect(page.getByText("解析完了", { exact: true })).toBeVisible({
    timeout: 180_000,
  });
}

async function downloadText(page: Page, buttonName: string): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const path = await (await downloadPromise).path();
  if (!path) {
    throw new Error(`Playwright did not provide the ${buttonName} download path.`);
  }
  return readFile(path, "utf8");
}

async function analyzeAndDownloadResult(
  page: Page,
  videoPath: string,
): Promise<{
  result: CompetitionAnalysisResultV2;
  decodedFrameFingerprints: readonly number[];
  csv: string;
}> {
  await openResults(page, videoPath);

  for (const metricKey of [
    "intervalTimeSec",
    "averageSpeedMps",
    "strokeCount",
    "cycleCount",
    "cycleRateCpm",
    "distancePerCycleM",
  ]) {
    await expect(page.getByTestId(`swim-metric-${metricKey}`)).toBeVisible();
  }

  const result = JSON.parse(
    await downloadText(page, "JSON"),
  ) as CompetitionAnalysisResultV2;
  const csv = await downloadText(page, "CSV");
  const csvWithoutBom = csv.replace(/^\uFEFF/, "");
  expect(csvWithoutBom.split(/\r?\n/, 1)[0]).toBe(CSV_HEADER);
  expect(csvWithoutBom).toContain(",measurement,");

  const pngDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
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
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
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

  return { result, decodedFrameFingerprints, csv };
}

function stableEvents(result: CompetitionAnalysisResultV2) {
  return result.automaticEvents.map((event) => ({
    type: event.type,
    timestampMs: event.timestampMs,
    frameIndex: event.frameIndex,
    side: event.side,
    gateId: event.gateId,
    status: event.status,
  }));
}

function stableMeasurements(result: CompetitionAnalysisResultV2) {
  return result.measurements.map((measurement) => ({
    type: measurement.type,
    value: measurement.value,
    unit: measurement.unit,
    status: measurement.status,
    fromEventId: measurement.fromEventId,
    toEventId: measurement.toEventId,
  }));
}

test("同一動画の再解析はV2イベントと主要6指標を再現する", async ({
  page,
  browserName,
}) => {
  test.skip(!goldenVideoPath, "Set MOTION_ANALYSIS_GOLDEN_VIDEO to a rights-cleared swim video.");
  test.skip(browserName !== "chromium", "精密動画解析にはWebCodecsが必要です。");
  test.setTimeout(420_000);

  await page.goto("/");
  const firstRun = await analyzeAndDownloadResult(page, goldenVideoPath!);
  await page.getByRole("button", { name: "新しい動画を解析" }).click();
  await expect(
    page.getByRole("heading", { name: "コーチが見たい局面を先に決める" }),
  ).toBeVisible();
  const secondRun = await analyzeAndDownloadResult(page, goldenVideoPath!);

  expect(firstRun.result.schemaVersion).toBe("2.0");
  expect(firstRun.result.input.name).toBe(basename(goldenVideoPath!));
  expect(secondRun.result.input.name).toBe(basename(goldenVideoPath!));
  expect(firstRun.result.videoInput.effectiveFps).not.toBeNull();
  expect(secondRun.decodedFrameFingerprints).toEqual(
    firstRun.decodedFrameFingerprints,
  );
  expect(secondRun.result.sampling.timestampsMs).toEqual(
    firstRun.result.sampling.timestampsMs,
  );
  expect(stableEvents(secondRun.result)).toEqual(stableEvents(firstRun.result));
  expect(stableMeasurements(secondRun.result)).toEqual(
    stableMeasurements(firstRun.result),
  );
  expect(secondRun.csv).toBe(firstRun.csv);
});

test("コーチがストロークとゲート通過を追加・移動・削除できる", async ({
  page,
  browserName,
}) => {
  test.skip(!goldenVideoPath, "Set MOTION_ANALYSIS_GOLDEN_VIDEO to a rights-cleared swim video.");
  test.skip(browserName !== "chromium", "精密動画解析にはWebCodecsが必要です。");
  test.setTimeout(240_000);

  await page.goto("/");
  await openResults(page, goldenVideoPath!);
  const timeline = page.getByTestId("event-timeline");
  const initialCount = await timeline.getByTestId("timeline-event").count();

  const eventType = timeline.getByLabel("イベントを追加");
  await eventType.selectOption("leftStroke");
  await timeline.getByRole("button", { name: "現在位置に追加" }).click();
  await expect(
    timeline.getByTestId("timeline-event").filter({ hasText: "左ストローク" }).last(),
  ).toContainText("手動確認済み");

  await eventType.selectOption("gateCrossing");
  const gate = timeline.getByLabel("通過ゲート");
  await gate.selectOption("gate-a");
  await timeline.getByRole("button", { name: "現在位置に追加" }).click();
  await gate.selectOption("gate-b");
  await timeline.getByRole("button", { name: "現在位置に追加" }).click();
  await expect(timeline.getByTestId("timeline-event")).toHaveCount(initialCount + 3);

  const gateBEvent = timeline
    .getByTestId("timeline-event")
    .filter({ hasText: "ゲートB通過" })
    .last();
  const moveSlider = gateBEvent.getByRole("slider");
  const maximum = Number(await moveSlider.getAttribute("max"));
  await moveSlider.fill(String(maximum));

  const edited = JSON.parse(
    await downloadText(page, "JSON"),
  ) as CompetitionAnalysisResultV2;
  expect(edited.manualOverrides.some((override) => override.action === "add")).toBe(true);
  expect(edited.manualOverrides.some((override) => override.action === "update")).toBe(true);
  expect(edited.events.filter((event) => event.source === "manual"))
    .toHaveLength(3);
  expect(
    edited.events
      .filter((event) => event.source === "manual")
      .every((event) => event.status === "verified"),
  ).toBe(true);

  for (const addedLabel of ["左ストローク", "ゲートA通過", "ゲートB通過"]) {
    const event = timeline
      .getByTestId("timeline-event")
      .filter({ hasText: addedLabel })
      .last();
    await event.getByRole("button", { name: new RegExp(`${addedLabel}を削除`) }).click();
  }
  await expect(timeline.getByTestId("timeline-event")).toHaveCount(initialCount);
});
