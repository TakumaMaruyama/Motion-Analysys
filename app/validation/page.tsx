import type { Metadata } from "next";

import { StartValidationWorkspace } from "@/components/start-validation-workspace";

export const metadata: Metadata = {
  title: "スタート検証ラベル作成 | MotionAnalysys Beta",
  description:
    "競泳スタート動画を、コーチが自動結果を見ずにフレーム単位でラベル付けする端末内検証ツールです。",
};

export default function ValidationPage() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
      <StartValidationWorkspace />
    </section>
  );
}
