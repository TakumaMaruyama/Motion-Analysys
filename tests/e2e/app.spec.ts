import { expect, test } from "@playwright/test";

test("ホーム画面からローカル姿勢分析を開始できる", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/MotionAnalysys/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.locator('input[type="file"][accept*="video"]')).toHaveCount(1);
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

  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toMatch(/googleapis|google-analytics|doubleclick/);
});

for (const licenseFile of [
  "/licenses/mediapipe/APACHE-2.0.txt",
  "/licenses/next/MIT.txt",
  "/licenses/react/MIT.txt",
  "/licenses/lucide/ISC.txt",
]) {
  test(`${licenseFile} を公開している`, async ({ request }) => {
    const response = await request.get(licenseFile);

    expect(response.status()).toBe(200);
    expect((await response.text()).length).toBeGreaterThan(500);
  });
}

test("カメラ権限を拒否した場合に復帰可能な案内を表示する", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException(
            "Camera permission denied by end-to-end test",
            "NotAllowedError",
          );
        },
      },
    });
  });
  await page.goto("/");

  await page
    .getByRole("button", {
      name: /(カメラ.*(?:開始|使う|撮影)|撮影.*カメラ)/,
    })
    .first()
    .click();

  const permissionMessage = page
    .getByRole("alert")
    .or(
      page.getByText(
        /カメラ.*(?:許可|拒否|アクセス|利用でき)|(?:許可|拒否|アクセス).*カメラ/,
      ),
    )
    .first();
  await expect(permissionMessage).toBeVisible();
});

test("非対応ファイルを動画として受け付けない", async ({ page }) => {
  await page.goto("/");

  await page.locator('input[type="file"]').setInputFiles({
    name: "not-a-video.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is not a video."),
  });

  const unsupportedMessage = page
    .getByRole("alert")
    .or(
      page.getByText(
        /(?:対応していない|対応外|使用できない).*(?:ファイル|形式)|(?:ファイル|形式).*(?:対応していない|対応外|使用できない)/,
      ),
    )
    .first();
  await expect(unsupportedMessage).toBeVisible();
});
