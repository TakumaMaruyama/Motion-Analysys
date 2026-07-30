import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const BLANK_VIDEO = Buffer.from(
  readFileSync(
    join(process.cwd(), "tests/fixtures/no-person.webm.base64"),
    "utf8",
  ).trim(),
  "base64",
);

function blankVideo() {
  return {
    name: "no-person.webm",
    mimeType: "video/webm",
    buffer: BLANK_VIDEO,
  };
}

test.describe.configure({ mode: "serial" });

test("人物がいない動画では数値を作らず再撮影を案内する", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(blankVideo());
  await expect(page.getByText("この映像で解析します")).toBeVisible();

  await page.getByRole("button", { name: "解析を開始" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "人物を検出できませんでした" }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("この映像で解析します")).toBeVisible();
});

test("動画解析をキャンセルして全身確認へ戻れる", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(blankVideo());
  await expect(page.getByText("この映像で解析します")).toBeVisible();
  await page.getByRole("button", { name: "解析を開始" }).click();
  await page
    .getByRole("button", { name: "解析をキャンセル" })
    .click();

  await expect(page.getByText("この映像で解析します")).toBeVisible();
});
