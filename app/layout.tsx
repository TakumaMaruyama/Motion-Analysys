import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "../styles/globals.css";

const DEFAULT_TITLE = "MotionAnalysys Beta | 端末内競泳計測";
const DESCRIPTION =
  "固定カメラで撮影した競泳動画ファイルを端末内で処理する、無料・検証中のローカル計測ベータ版です。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProtocol ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const origin = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", origin);

  return {
    metadataBase: origin,
    title: {
      default: DEFAULT_TITLE,
      template: "%s | MotionAnalysys",
    },
    description: DESCRIPTION,
    applicationName: "MotionAnalysys",
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    },
    openGraph: {
      type: "website",
      locale: "ja_JP",
      siteName: "MotionAnalysys",
      title: DEFAULT_TITLE,
      description: DESCRIPTION,
      images: [
        {
          url: socialImage,
          width: 1536,
          height: 1024,
          alt: "MotionAnalysys Beta — 競泳動画を端末内で参考計測する無料ベータ版。",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DESCRIPTION,
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="ja" className="scroll-smooth" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased dark:bg-slate-950 dark:text-slate-50">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="w-full flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
