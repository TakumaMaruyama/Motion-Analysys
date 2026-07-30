import type { ReactNode } from "react";
import Link from "next/link";

type LegalPageProps = {
  title: string;
  description: string;
  lastUpdated: string;
  children: ReactNode;
};

type LegalSectionProps = {
  id: string;
  title: string;
  children: ReactNode;
};

export function LegalPage({
  title,
  description,
  lastUpdated,
  children,
}: LegalPageProps) {
  return (
    <div className="relative isolate overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.16),transparent_48%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.12),transparent_44%)]"
        aria-hidden="true"
      />
      <article className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md text-sm font-semibold text-indigo-700 transition-colors hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-4 dark:text-indigo-300 dark:hover:text-indigo-100 dark:focus-visible:ring-offset-slate-950"
        >
          <span aria-hidden="true">←</span>
          分析画面へ戻る
        </Link>

        <header className="mt-8 border-b border-slate-200 pb-8 dark:border-slate-800">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
            MotionAnalysys
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-300">
            {description}
          </p>
          <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
            最終更新日：{lastUpdated}
          </p>
        </header>

        <div className="mt-10 space-y-10">{children}</div>
      </article>
    </div>
  );
}

export function LegalSection({ id, title, children }: LegalSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <h2
        id={`${id}-heading`}
        className="text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl"
      >
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 dark:text-slate-300 [&_a]:font-semibold [&_a]:text-indigo-700 [&_a]:underline [&_a]:decoration-indigo-300 [&_a]:underline-offset-4 hover:[&_a]:text-indigo-900 dark:[&_a]:text-indigo-300 dark:hover:[&_a]:text-indigo-100 [&_code]:break-all [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs dark:[&_code]:bg-slate-900 [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export default LegalPage;
