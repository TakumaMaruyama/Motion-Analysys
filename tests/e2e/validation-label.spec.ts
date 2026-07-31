import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const LABEL_VIDEO = Buffer.from(
  readFileSync(
    join(process.cwd(), "tests/fixtures/no-person.webm.base64"),
    "utf8",
  ).trim(),
  "base64",
);

async function expectDisplayedFrame(
  page: import("@playwright/test").Page,
  frameIndex: number,
) {
  const displayState = page.getByTestId("validation-frame-display-state");
  await expect(displayState).toHaveAttribute("data-status", "displayed");
  await expect(displayState).toHaveAttribute("data-frame", String(frameIndex));
}

test("自動結果なしで匿名検証ラベルJSONを書き出す", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/validation");
  await expect(page.getByTestId("swim-validation-workspace")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await page.getByLabel("検証ラベル用動画").setInputFiles({
    name: "identifying-source-name.webm",
    mimeType: "video/webm",
    buffer: LABEL_VIDEO,
  });

  await expect(page.getByText("総フレーム")).toBeVisible({ timeout: 30_000 });
  await expectDisplayedFrame(page, 0);
  await page.getByLabel("匿名動画ID").fill("adult-fr-001");
  await page.getByLabel("注釈者ラベル").fill("coach-a");
  await page.getByRole("button", { name: "ゲートAに設定" }).click();
  await page.getByRole("button", { name: "1フレーム進む" }).click();
  await expectDisplayedFrame(page, 1);
  await page.getByRole("button", { name: "ストロークを追加" }).click();
  await page.getByRole("button", { name: "1フレーム進む" }).click();
  await expectDisplayedFrame(page, 2);
  await page.getByRole("button", { name: "ゲートBに設定" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "匿名ラベルJSONを保存" })
    .click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const annotation = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    anonymousVideoId: string;
    annotatorLabel: string;
    validity: "valid" | "invalid";
    distanceMeters: number | null;
    gateCrossings: {
      first: { frameIndex: number; timestampMs: number };
      second: { frameIndex: number; timestampMs: number };
    } | null;
    strokeEvents: { frameIndex: number; timestampMs: number }[] | null;
  };

  expect(annotation).toMatchObject({
    anonymousVideoId: "adult-fr-001",
    annotatorLabel: "coach-a",
    validity: "valid",
    distanceMeters: 5,
    gateCrossings: {
      first: { frameIndex: 0, timestampMs: expect.any(Number) },
      second: { frameIndex: 2, timestampMs: expect.any(Number) },
    },
    strokeEvents: [
      { frameIndex: 1, timestampMs: expect.any(Number) },
    ],
  });
  expect(JSON.stringify(annotation)).not.toContain("identifying-source-name");

  await page.getByLabel(/注釈メモ/).fill("動画固有メモ");
  await page.getByRole("button", { name: "強い水しぶき" }).click();
  await page.getByRole("checkbox", { name: "カメラ固定" }).uncheck();
  await page.getByRole("button", { name: "バタフライ" }).click();

  await page.getByLabel("検証ラベル用動画").setInputFiles({
    name: "second-identifying-source-name.webm",
    mimeType: "video/webm",
    buffer: LABEL_VIDEO,
  });

  await expectDisplayedFrame(page, 0);
  await expect(page.getByLabel("匿名動画ID")).toHaveValue("");
  await expect(page.getByLabel("注釈者ラベル")).toHaveValue("coach-a");
  await expect(page.getByLabel(/注釈メモ/)).toHaveValue("");
  await expect(page.getByRole("button", { name: "強い水しぶき" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("checkbox", { name: "カメラ固定" })).toBeChecked();
  await expect(page.getByRole("button", { name: "自由形" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "計測可能" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("匿名動画ID").fill("invalid-001");
  await page.getByRole("button", { name: "無効・判定不能" }).click();
  await page.getByLabel("無効・判定不能の理由").fill("泳者が映っていない");
  await page.getByRole("button", { name: "無人物" }).click();
  const invalidDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匿名ラベルJSONを保存" }).click();
  const invalidDownload = await invalidDownloadPromise;
  const invalidStream = await invalidDownload.createReadStream();
  const invalidChunks: Buffer[] = [];
  for await (const chunk of invalidStream) {
    invalidChunks.push(Buffer.from(chunk));
  }
  const invalidAnnotation = JSON.parse(
    Buffer.concat(invalidChunks).toString("utf8"),
  );
  expect(invalidAnnotation).toMatchObject({
    anonymousVideoId: "invalid-001",
    validity: "invalid",
    distanceMeters: null,
    gateCrossings: null,
    strokeEvents: null,
    invalidReason: "泳者が映っていない",
    conditions: { tags: ["no-swimmer"] },
  });
  expect(JSON.stringify(invalidAnnotation)).not.toContain(
    "second-identifying-source-name",
  );
});
