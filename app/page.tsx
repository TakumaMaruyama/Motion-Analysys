import { StartAnalysisWorkspace } from "@/components/start-analysis-workspace";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.12),transparent_34%),radial-gradient(circle_at_88%_70%,rgba(14,165,233,0.10),transparent_30%)]" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-8 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:px-8">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold tracking-wide text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/70 dark:text-indigo-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              POOL-SIDE START ANALYSIS
            </p>
            <h1 className="mt-5 text-balance text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl lg:text-6xl">
              1本のスタートを、
              <span className="text-indigo-600 dark:text-indigo-400">
                前方速度と入水
              </span>
              で返す。
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300 sm:text-lg">
              目的に合わせて、30fps以上の「簡易タイムモード」と、60fps以上・ほぼ真横の「精密モード」を選べます。撮影条件と時系列のポリシーを満たすイベントは未検証ベータの自動判定として反映し、低スコアや遮蔽などはコーチ確認へ回します。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["2モード", "撮影条件を選択"],
              ["30fps", "簡易タイムの最低速度"],
              ["120fps", "推奨撮影速度"],
              ["0–5m", "対象画角"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/80"
              >
                <p className="text-xl font-black text-slate-950 dark:text-white">
                  {value}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="analysis" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
        <StartAnalysisWorkspace />
      </section>

      <section className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            [
              "簡易タイムモード",
              "30fps以上なら、斜め撮影も使えます。初動・離台・飛行は条件を満たせば自動判定し、入水・5mは手動確認を前提に時間指標だけを参考表示します。距離・速度・角度・百分位は表示しません。",
            ],
            [
              "精密モード",
              "60fps以上・固定・ほぼ真横で撮影します。120fpsを推奨し、0m・5m・水面を校正したうえで、現行の時間・距離・2D速度・体幹角度・条件成立時の百分位を参考表示します。",
            ],
            [
              "共通の撮影条件",
              "1レーン・1選手を撮影し、0m壁・5m位置・水面が見える画角を用意してください。自動判定できないイベントはコーチが1フレーム単位で確認・修正できます。",
            ],
          ].map(([title, body], index) => (
            <article
              key={title}
              className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800"
            >
              <p className="text-xs font-black tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
                0{index + 1}
              </p>
              <h2 className="mt-3 font-bold text-slate-950 dark:text-white">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
