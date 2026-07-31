import { expect, test } from "@playwright/test";

test("ホーム画面からSwim分析を開始できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("swim-analysis-workspace")).toHaveAttribute(
    "data-hydrated",
    "true",
  );

  await expect(page).toHaveTitle(/MotionAnalysys/);
  await expect(
    page.getByRole("heading", { level: 1, name: /1本の泳ぎを/ }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"][accept*="video"]')).toHaveCount(1);

  await expect(page.getByRole("button", { name: /Swim/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const stroke of ["自由形", "背泳ぎ", "平泳ぎ", "バタフライ"]) {
    await expect(page.getByRole("button", { name: stroke, exact: true })).toBeVisible();
  }
  for (const mode of ["Turn", "Start"]) {
    const modeButton = page.getByRole("button", { name: new RegExp(mode) });
    await expect(modeButton).toBeDisabled();
    await expect(modeButton).toContainText("検証中");
  }
});

for (const legalPage of [
  { path: "/privacy", heading: "プライバシーポリシー" },
  { path: "/terms", heading: "利用規約" },
  { path: "/licenses", heading: "ライセンス" },
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

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "自動結果を見ずに正解フレームを作る",
    }),
  ).toBeVisible();
  await expect(page.getByText("自動検出は表示しません")).toBeVisible();
  await expect(page.locator('input[type="file"][accept*="video"]')).toHaveCount(1);
});

for (const removedPath of [
  "/motion-analysis",
  "/dashboard",
  "/auth/login",
]) {
  test(`${removedPath} はホーム画面へリダイレクトする`, async ({ page }) => {
    await page.goto(removedPath);

    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
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

test("非対応ファイルを動画として受け付けない", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") clientErrors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByTestId("swim-analysis-workspace")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  expect(clientErrors).toEqual([]);
  const backstroke = page.getByRole("button", { name: "背泳ぎ", exact: true });
  await backstroke.click();
  await expect(backstroke).toHaveAttribute("aria-pressed", "true");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "動画を選ぶ" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "not-a-video.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is not a video."),
  });

  const unsupportedMessage = page.getByRole("alert").filter({
    hasText: "MP4、MOV、WebMに対応します",
  });
  await expect(unsupportedMessage).toBeVisible();
});
