import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const LOW_FPS_BLANK_VIDEO = Buffer.from(
  readFileSync(
    join(process.cwd(), "tests/fixtures/no-person.webm.base64"),
    "utf8",
  ).trim(),
  "base64",
);

function lowFpsBlankVideo() {
  return {
    name: "low-fps-no-person.webm",
    mimeType: "video/webm",
    buffer: LOW_FPS_BLANK_VIDEO,
  };
}

async function blankVideo30Fps(
  page: Page,
  options: { readonly width?: number; readonly height?: number } = {},
) {
  const width = options.width ?? 320;
  const height = options.height ?? 180;
  const bytes = await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context || typeof MediaRecorder === "undefined") {
      throw new Error("Synthetic WebM recording is unavailable.");
    }
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
    const stream = canvas.captureStream(60);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 180_000,
    });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener(
        "error",
        () => reject(new Error("Synthetic WebM recording failed.")),
        { once: true },
      );
    });

    recorder.start();
    let frame = 0;
    const timer = window.setInterval(() => {
      context.fillStyle = `rgb(${8 + (frame % 5)}, 15, 28)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgb(20, 35, 55)";
      context.fillRect(frame % canvas.width, 0, 2, 2);
      frame += 1;
    }, 1000 / 60);
    await new Promise((resolve) => window.setTimeout(resolve, 1_250));
    window.clearInterval(timer);
    recorder.stop();
    await stopped;
    for (const track of stream.getTracks()) track.stop();

    const blob = new Blob(chunks, { type: mimeType });
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { width, height });

  return {
    name: "no-person-30fps.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  };
}

test.describe.configure({ mode: "serial" });

async function waitForWorkspaceHydration(page: Page) {
  await expect(page.getByTestId("swim-analysis-workspace")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

async function openCalibration(page: Page) {
  await waitForWorkspaceHydration(page);
  const backstroke = page.getByRole("button", { name: "背泳ぎ", exact: true });
  await backstroke.click();
  await expect(backstroke).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "自由形", exact: true }).click();
  const video = await blankVideo30Fps(page);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "動画を選ぶ" }).click();
  await (await fileChooserPromise).setFiles(video);
  await expect(page.getByText("Swim精密解析に使用できます")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "距離校正へ進む" }).click();
  await expect(
    page.getByRole("heading", { name: "既知の距離を2本の線で挟む" }),
  ).toBeVisible();
}

test("30fps未満の動画はプレビューだけ許可し精密解析を無効にする", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "WebCodecs判定はChromiumで確認します。");
  await page.goto("/");
  await waitForWorkspaceHydration(page);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "動画を選ぶ" }).click();
  await (await fileChooserPromise).setFiles(lowFpsBlankVideo());

  await expect(page.getByText("実効fps")).toBeVisible();
  await expect(
    page.getByText("Swim解析には30fps以上の固定撮影動画が必要です。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "距離校正へ進む" }).click();
  await expect(
    page.getByRole("button", { name: "校正を確定して解析" }),
  ).toBeDisabled();
});

test("縦動画でも表示領域と距離ゲートを元映像の比率へ合わせる", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "WebM生成はChromiumで確認します。");
  test.setTimeout(45_000);
  await page.goto("/");
  await waitForWorkspaceHydration(page);
  const video = await blankVideo30Fps(page, { width: 180, height: 320 });
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "動画を選ぶ" }).click();
  await (await fileChooserPromise).setFiles({
    ...video,
    name: "portrait-no-person-30fps.webm",
  });

  await expect(page.getByText("180×320")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("source-video-stage")).toHaveCSS(
    "aspect-ratio",
    "180 / 320",
  );
  await page.getByRole("button", { name: "距離校正へ進む" }).click();
  await expect(page.getByTestId("calibration-video-stage")).toHaveCSS(
    "aspect-ratio",
    "180 / 320",
  );
});

test("人物がいない動画では数値を作らず再撮影を案内する", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "精密動画解析にはWebCodecsが必要です。");
  test.setTimeout(60_000);
  await page.goto("/");
  await openCalibration(page);

  await page.getByRole("button", { name: "校正を確定して解析" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "泳者を検出できませんでした" }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole("heading", { name: "既知の距離を2本の線で挟む" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "校正を確定して解析" }).click();
  await expect(
    page.getByRole("button", { name: "解析をキャンセル" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "解析をキャンセル" }).click();
  await expect(
    page.getByRole("heading", { name: "既知の距離を2本の線で挟む" }),
  ).toBeVisible();
});

test("動画解析をキャンセルして距離校正へ戻れる", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "精密動画解析にはWebCodecsが必要です。");
  test.setTimeout(60_000);
  await page.goto("/");
  await openCalibration(page);
  await page.getByRole("button", { name: "校正を確定して解析" }).click();
  await page
    .getByRole("button", { name: "解析をキャンセル" })
    .click();

  await expect(
    page.getByRole("heading", { name: "既知の距離を2本の線で挟む" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "校正を確定して解析" }).click();
  await expect(
    page.getByRole("button", { name: "解析をキャンセル" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "解析をキャンセル" }).click();
  await expect(
    page.getByRole("heading", { name: "既知の距離を2本の線で挟む" }),
  ).toBeVisible();
});

test("校正を明示保存し次の動画で再利用できる", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "精密動画解析にはWebCodecsが必要です。");
  test.setTimeout(90_000);
  await page.goto("/");
  await openCalibration(page);
  const remember = page.getByRole("checkbox", {
    name: /この端末に校正を保存する/,
  });
  await expect(remember).not.toBeChecked();
  await remember.check();
  await page.getByRole("button", { name: "校正を確定して解析" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("motionanalysys.swim-calibration.v2"),
      ),
    )
    .not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(window.localStorage)
          .filter((key) => key.startsWith("motionanalysys."))
          .sort(),
      ),
    )
    .toEqual(["motionanalysys.swim-calibration.v2"]);
  await page.getByRole("button", { name: "解析をキャンセル" }).click();

  await page.reload();
  await openCalibration(page);
  await expect(page.getByText("保存済みの校正があります")).toBeVisible();
  await expect(page.getByText("解析完了", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "この校正を適用" }).click();
  await page.getByRole("button", { name: "保存済み校正を削除" }).click();
  await expect(page.getByText("保存済みの校正があります")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("motionanalysys.swim-calibration.v2"),
      ),
    )
    .toBeNull();
});

test("旧校正データをV2へ移行し不正な旧キーを残さない", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem(
      "motionanalysys.swim-calibration.v1",
      JSON.stringify({
        version: 1,
        firstGateX: 0.2,
        secondGateX: 0.8,
        distanceMeters: 5,
      }),
    );
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        legacy: window.localStorage.getItem(
          "motionanalysys.swim-calibration.v1",
        ),
        current: JSON.parse(
          window.localStorage.getItem(
            "motionanalysys.swim-calibration.v2",
          ) ?? "null",
        ) as { version?: number } | null,
      })),
    )
    .toEqual({ legacy: null, current: expect.objectContaining({ version: 2 }) });
});
