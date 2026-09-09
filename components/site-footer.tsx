import Link from "next/link";

const legalLinks = [
  { href: "/research", label: "研究根拠" },
  { href: "/validation", label: "検証ラベル" },
  { href: "/privacy", label: "プライバシー" },
  { href: "/terms", label: "利用規約" },
  { href: "/licenses", label: "ライセンス" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-300 dark:border-slate-800">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)] md:items-start">
          <div className="max-w-2xl">
            <Link
              href="/"
              className="inline-flex rounded-md text-lg font-bold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-4 focus-visible:ring-offset-slate-950"
            >
              MotionAnalysys
            </Link>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              30fps以上・斜め撮影可の簡易タイムモードと、60fps以上・ほぼ真横の精密モードで、競泳スタートを端末内で参考計測する無料ベータです。
              動画や分析履歴をクラウドへ保存しません。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">
              ご利用前に
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              自動候補はコーチの確認後にだけ計算へ使います。公式反応時間・失格判定・力・パワー・水中局面は測定できません。
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-slate-800 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} MotionAnalysys</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="法務情報">
            {legalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-4 focus-visible:ring-offset-slate-950"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
