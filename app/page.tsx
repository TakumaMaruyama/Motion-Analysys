import { AnalysisWorkspace } from "@/components/analysis-workspace";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.12),transparent_34%),radial-gradient(circle_at_88%_70%,rgba(14,165,233,0.10),transparent_30%)]" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-8 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:px-8">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold tracking-wide text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/70 dark:text-indigo-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              LOCAL POSE ANALYSIS
            </p>
            <h1 className="mt-5 text-balance text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl lg:text-6xl">
              フォームを、
              <span className="text-indigo-600 dark:text-indigo-400">
                数字と軌跡
              </span>
              で見返す。
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300 sm:text-lg">
              カメラまたは動画から33点の姿勢を推定し、関節角度・体幹の傾き・可動域を確認します。映像はアップロードせず、このブラウザだけで処理します。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["33", "姿勢ポイント"],
              ["15 Hz", "動画の固定解析"],
              ["0", "クラウド保存"],
              ["3形式", "JSON / CSV / PNG"],
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

      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
        <AnalysisWorkspace />
      </section>

      <section className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            [
              "撮影面をそろえる",
              "主要な数値は映像平面の2D角度です。毎回なるべく同じ向き・距離で撮ると比較しやすくなります。",
            ],
            [
              "全身を画面に入れる",
              "頭から足先まで見える明るい映像を使ってください。必要な点の信頼度が0.5未満なら値を表示しません。",
            ],
            [
              "傾向の確認に使う",
              "単眼カメラによる推定値です。医療診断や、cm・m単位の校正済み3D計測には使用できません。",
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
