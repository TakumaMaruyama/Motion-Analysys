import { SwimAnalysisWorkspace } from "@/components/swim-analysis-workspace";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.12),transparent_34%),radial-gradient(circle_at_88%_70%,rgba(14,165,233,0.10),transparent_30%)]" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-8 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:px-8">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold tracking-wide text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/70 dark:text-indigo-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              POOL-SIDE SWIM ANALYSIS
            </p>
            <h1 className="mt-5 text-balance text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl lg:text-6xl">
              1本の泳ぎを、
              <span className="text-indigo-600 dark:text-indigo-400">
                速度とストローク
              </span>
              で返す。
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300 sm:text-lg">
              固定カメラの動画から、区間タイム・平均速度・ストローク指標を算出します。自動検出したイベントはコーチが映像と照合し、その場で補正できます。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["30秒", "最大解析区間"],
              ["2本", "距離ゲート"],
              ["4泳法", "Swim分析"],
              ["0", "動画アップロード"],
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
        <SwimAnalysisWorkspace />
      </section>

      <section className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            [
              "泳者を横から固定撮影",
              "カメラを動かさず、泳者とレーンロープの目印が同じ画面に入る位置で撮影します。Swim分析は30fps以上を使用してください。",
            ],
            [
              "既知の距離で校正",
              "5mラインなど実距離が分かる2点へゲートA・Bを合わせます。同じカメラ位置なら校正をこの端末で再利用できます。",
            ],
            [
              "最後はコーチが確定",
              "ゲート通過と左右または両手のストロークマーカーを映像で確認し、追加・移動・削除してから記録を書き出します。",
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
