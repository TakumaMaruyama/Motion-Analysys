import { StartAnalysisWorkspace } from "@/components/start-analysis-workspace";

export default function HomePage() {
  return (
    <>
      <section id="analysis" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
        <StartAnalysisWorkspace />
      </section>

      <section className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            [
              "簡易タイムモード",
              "30fps以上なら、斜め撮影も使えます。時間に加え、0m・5mの簡易校正から離台直後・入水直前の前方速度を低精度の参考値として表示します。入水・5mは手動確認を前提とし、研究百分位は表示しません。",
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
