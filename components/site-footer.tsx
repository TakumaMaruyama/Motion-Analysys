import Link from "next/link";

const legalLinks = [
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
              カメラ映像や動画から、スポーツフォームの傾向を端末内で確認するためのツールです。
              映像や分析結果をクラウドへ保存しません。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">
              ご利用前に
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              表示する角度や位置は姿勢推定による目安です。医療・診断目的ではなく、単眼映像から得る3D情報も校正済み機器による実測値ではありません。
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
