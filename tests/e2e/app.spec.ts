import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const LOW_FPS_BLANK_VIDEO = Buffer.from(
  readFileSync(join(process.cwd(), "tests/fixtures/no-person.webm.base64"), "utf8").trim(),
  "base64",
);

test("ホーム画面はStart専用で4種目を選べる", async ({ page }) => {
  await page.goto("/");
  const workspace = page.getByTestId("start-analysis-workspace");
  await expect(workspace).toHaveAttribute("data-hydrated", "true");
  await expect(page).toHaveTitle(/MotionAnalysys/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("スタート");
  await expect(page.getByRole("button", { name: /Swim|Turn/ })).toHaveCount(0);
  await expect(page.locator('input[type="file"][accept*="video"]')).toHaveCount(1);
  const stroke = page.getByLabel("種目");
  await expect(stroke).toBeVisible();
  await expect(stroke.locator("option")).toHaveCount(4);
});

test("13歳未満は解析を開始できない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  const age = page.getByLabel("年齢");
  await age.fill("12");
  await expect(page.getByText("13歳未満は本アプリの解析対象外です。", { exact: true })).toBeVisible();
});

test("33歳以上は解析可能だが参考帯を表示しない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("年齢").fill("33");
  await expect(page.getByText("33歳以上は解析できますが、Born 2026の参考帯は表示しません。", { exact: true })).toBeVisible();
});

test("撮影品質は明示確認されるまで解析条件を満たさない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByText("固定・真横・1選手を確認するまで、距離・速度を含む解析へ進めません。", { exact: true })).toBeVisible();
  for (const label of ["固定カメラを確認", "真横撮影を確認", "1レーン・1選手を確認"]) {
    const checkbox = page.getByLabel(label);
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  }
});

test("新しい動画を選ぶと撮影品質の確認をやり直す", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  const qualityLabels = ["固定カメラを確認", "真横撮影を確認", "1レーン・1選手を確認"];
  for (const label of qualityLabels) await page.getByLabel(label).check();
  await page.getByTestId("start-video-input").setInputFiles({
    name: "new-video-requires-quality-confirmation.webm",
    mimeType: "video/webm",
    buffer: LOW_FPS_BLANK_VIDEO,
  });
  for (const label of qualityLabels) await expect(page.getByLabel(label)).not.toBeChecked();
});

test("背泳ぎでは後足離れだけを除外する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("種目").selectOption("backstroke");
  await page.getByRole("button", { name: /候補イベント確認/ }).click();
  await expect(page.getByText("手の離台", { exact: true })).toBeVisible();
  await expect(page.getByText("後足の離台", { exact: true })).toHaveCount(0);
  await expect(page.getByText("5m頭頂通過（任意）", { exact: true })).toBeVisible();
});

test("種目切替は飛び込み候補を残さず、背泳ぎへ後足離台を持ち込まない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: /候補イベント確認/ }).click();
  const rearFoot = page.getByLabel("後足の離台時刻");
  await rearFoot.fill("0.200");
  await page.getByRole("button", { name: /動画と選手区分/ }).click();
  await page.getByLabel("種目").selectOption("backstroke");
  await page.getByRole("button", { name: /候補イベント確認/ }).click();
  await expect(page.getByText("後足の離台", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /動画と選手区分/ }).click();
  await page.getByLabel("種目").selectOption("freestyle");
  await page.getByRole("button", { name: /候補イベント確認/ }).click();
  await expect(page.getByLabel("後足の離台時刻")).toHaveValue("");
});

test("候補未実行のUIはイベントを未取得として手動確認を求める", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: /候補イベント確認/ }).click();
  await expect(page.getByText("号砲／スタート信号", { exact: true }).locator("..").getByText("未取得", { exact: true })).toBeVisible();
  await expect(page.getByText("後足の離台", { exact: true }).locator("..").getByText("未取得", { exact: true })).toBeVisible();
  await expect(page.getByText("候補・要確認イベントは、verifiedになるまで数値と百分位の依存条件を満たしません。画面外・飛沫・遮蔽は未取得のままにしてください。", { exact: true })).toBeVisible();
});

test("撮影品質UIの確認を外すと解析条件を満たさない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("固定カメラを確認").check();
  await page.getByLabel("真横撮影を確認").check();
  await page.getByLabel("1レーン・1選手を確認").check();
  await page.getByLabel("固定カメラを確認").uncheck();
  await page.getByLabel("1レーン・1選手を確認").uncheck();
  await expect(page.getByText("固定・真横・1選手を確認するまで、距離・速度を含む解析へ進めません。", { exact: true })).toBeVisible();
});

test("5m任意イベントが未取得でも結果を開ける", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: /候補イベント確認/ }).click();
  await expect(page.getByLabel("5m頭頂通過（任意）時刻")).toHaveValue("");
  await page.getByRole("button", { name: /局面別結果/ }).click();
  const metric = page.getByText("5m時間", { exact: true }).locator("..");
  await expect(metric.getByText("—", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/外部ストップウォッチ5m/)).toBeVisible();
});

test("未確認イベントは結果を作らずUndoで戻せる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: /候補イベント確認/ }).click();
  const signal = page.getByLabel("号砲／スタート信号時刻");
  await signal.fill("0.100");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(signal).toHaveValue("");
  await signal.fill("0.100");
  await page.getByRole("button", { name: /局面別結果/ }).click();
  const blockMetric = page.getByText("ブロック／壁接触時間", { exact: true }).locator("..");
  await expect(blockMetric.getByText("—", { exact: true })).toBeVisible();
});

test("60fps未満の動画ではStart解析へ進めない", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebMコンテナ検査はChromiumで確認します。");
  await page.goto("/");
  await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByTestId("start-video-input").setInputFiles({
    name: "low-fps-no-person.webm",
    mimeType: "video/webm",
    buffer: LOW_FPS_BLANK_VIDEO,
  });
  await expect(page.getByText("最低60fpsの動画が必要です。", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "次へ：校正" })).toBeDisabled();
});

for (const legalPage of [
  { path: "/privacy", heading: "プライバシーポリシー" },
  { path: "/terms", heading: "利用規約" },
  { path: "/licenses", heading: "ライセンス" },
  { path: "/research", heading: "研究根拠と測定境界" },
]) {
  test(`${legalPage.heading}を直接開ける`, async ({ page }) => {
    await page.goto(legalPage.path);

    await expect(
      page.getByRole("heading", { name: legalPage.heading, exact: true }).first(),
    ).toBeVisible();
  });
}

test("検証ラベル作成画面を直接開ける", async ({ page }) => {
  await page.goto("/validation");
  const workspace = page.getByTestId("start-validation-workspace");
  await expect(workspace).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("スタート");
  await expect(workspace.getByText(/自動結果は表示しません|自動検出は表示しません/)).toBeVisible();
  await expect(workspace.getByText(/候補/)).toHaveCount(0);
  await expect(page.locator('input[type="file"][accept*="video"]')).toHaveCount(1);
});

test("検証画面で有効・無効・判定不能を選べる", async ({ page }) => {
  await page.goto("/validation");
  await expect(page.getByTestId("start-validation-workspace")).toHaveAttribute("data-hydrated", "true");
  const validity = page.getByLabel("判定", { exact: true });
  await expect(validity).toHaveValue("valid");
  await validity.selectOption("invalid");
  await expect(page.getByLabel(/理由/)).toBeVisible();
  await validity.selectOption("unassessable");
  await expect(page.getByLabel(/理由/)).toBeVisible();
});

test("低品質動画を無効ラベルとして匿名JSONへ保存できる", async ({ page }) => {
  await page.goto("/validation");
  await expect(page.getByTestId("start-validation-workspace")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("検証ラベル用動画").setInputFiles({
    name: "identifying-source-name.webm",
    mimeType: "video/webm",
    buffer: LOW_FPS_BLANK_VIDEO,
  });
  await expect(page.getByRole("button", { name: /匿名スタート注釈JSONを保存/ })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("匿名動画ID").fill("invalid-start-001");
  await page.getByLabel("匿名注釈者ID").fill("coach-a");
  await page.getByLabel("判定", { exact: true }).selectOption("invalid");
  await page.getByLabel("判定不能理由", { exact: true }).fill("60fps未満");
  await page.getByLabel("権利処理済み").check();
  await page.getByLabel("未成年同意を確認済み").check();
  await page.getByLabel("動画はリポジトリ外で管理").check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /匿名スタート注釈JSONを保存/ }).click();
  const downloadPath = await (await downloadPromise).path();
  expect(downloadPath).not.toBeNull();
  const contents = readFileSync(downloadPath!, "utf8");
  const annotation = JSON.parse(contents) as {
    validity: string;
    invalidReason: string | null;
    events: readonly { frameIndex: number | null; timestampMs: number | null }[];
  };
  expect(annotation.validity).toBe("invalid");
  expect(annotation.invalidReason).toBe("60fps未満");
  expect(annotation.events).toHaveLength(7);
  expect(annotation.events.every((event) => event.frameIndex === null && event.timestampMs === null)).toBe(true);
  expect(contents).not.toContain("identifying-source-name");
});

for (const removedPath of [
  "/motion-analysis",
  "/dashboard",
  "/auth/login",
]) {
  test(`${removedPath} から旧画面は公開されない`, async ({ page }) => {
    await page.goto(removedPath);
    await expect(page.getByTestId("start-analysis-workspace")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByRole("button", { name: /Swim|Turn/ })).toHaveCount(0);
  });
}

test("旧動画アップロードAPIは公開されていない", async ({ request }) => {
  const response = await request.post("/api/process-video", {
    data: { test: true },
  });

  expect(response.status()).toBe(404);
});

test("本番の通信先を同一オリジンへ制限する", async ({ request }) => {
  const response = await request.get("/");
  const policy = response.headers()["content-security-policy"];
  const permissionsPolicy = response.headers()["permissions-policy"];

  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toMatch(/googleapis|google-analytics|doubleclick/);
  expect(permissionsPolicy).toContain("camera=()");
  expect(permissionsPolicy).toContain("microphone=()");
});

for (const licenseFile of [
  "/licenses/mediapipe/APACHE-2.0.txt",
  "/licenses/next/MIT.txt",
  "/licenses/react/MIT.txt",
  "/licenses/lucide/ISC.txt",
  "/licenses/mediabunny/MPL-2.0.txt",
]) {
  test(`${licenseFile} を公開している`, async ({ request }) => {
    const response = await request.get(licenseFile);

    expect(response.status()).toBe(200);
    expect((await response.text()).length).toBeGreaterThan(500);
  });
}
