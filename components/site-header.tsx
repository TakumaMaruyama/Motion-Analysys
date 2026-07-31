import Link from "next/link";
import { Waves } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="group inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 dark:focus-visible:ring-offset-slate-950"
          aria-label="MotionAnalysys ホーム"
        >
          <span
            className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-700 text-white shadow-sm shadow-indigo-500/20 transition-transform group-hover:-rotate-3"
            aria-hidden="true"
          >
            <Waves className="h-5 w-5" />
          </span>
          <span className="flex flex-col">
            <span className="text-base font-bold leading-none tracking-tight text-slate-950 dark:text-white sm:text-lg">
              MotionAnalysys
            </span>
            <span className="mt-1 hidden text-[10px] font-medium leading-none tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:block">
              LOCAL SWIM METRICS · BETA
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3" aria-label="メインナビゲーション">
          <span className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300 md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            映像は端末内で処理
          </span>
          <Link
            href="/validation"
            className="hidden h-10 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:text-slate-200 dark:hover:bg-indigo-950/50 sm:inline-flex"
          >
            検証ラベル
          </Link>
          <Link
            href="/#analysis"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:bg-white dark:text-slate-950 dark:hover:bg-indigo-100 dark:focus-visible:ring-offset-slate-950"
          >
            Swim計測を始める
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default SiteHeader;
