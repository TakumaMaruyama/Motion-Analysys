import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "研究根拠 | MotionAnalysys Start",
  description:
    "MotionAnalysys Startの指標、エリート参考帯、測定対象外を決めた研究根拠と解釈上の注意です。",
};

const sources = [
  {
    title: "On-block mechanistic determinants of start performance in high performance swimmers",
    authors: "Thng, Pearson, Mitchell, Meulenbroek & Keogh (2021/2024)",
    doi: "10.1080/14763141.2021.1887342",
    href: "https://pubmed.ncbi.nlm.nih.gov/33666145/",
    use: "離台時の水平速度に加え、力・平均パワー・仕事量も15mスタートタイムと強く関係する根拠です。本アプリは映像だけで測れない力学量を推定しません。",
  },
  {
    title: "Predicting dive start performance from kinematic variables at water entry in (sub-)elite swimmers",
    authors: "van Dijk, Beek & van Soest (2020)",
    doi: "10.1371/journal.pone.0241345",
    href: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0241345",
    use: "入水距離、入水時の水平速度、身体と水面の角度を組み合わせて見る根拠です。前方距離だけを良否判定には使いません。",
  },
  {
    title: "Key parameters of the swimming start and their relationship to start performance",
    authors: "Tor, Pease & Ball (2015)",
    doi: "10.1080/02640414.2014.990486",
    href: "https://pubmed.ncbi.nlm.nih.gov/25555171/",
    use: "離台時の水平速度と水中軌道の双方が全体のスタート成績に関わる根拠です。水上スマホ1台で検証できない水中局面はv1から除外します。",
  },
  {
    title: "Engineering Elite Swimming Start Performance: Key Kinetic and Kinematic Variables with Reference Values",
    authors: "Born, Nussbaumer, Buck, Ruiz-Navarro & Romann (2026)",
    doi: "10.3390/bioengineering13020180",
    href: "https://www.mdpi.com/2306-5354/13/2/180",
    use: "種目・男女別のP3／P10／P25／P50／P75／P90／P97参考値の出所です。対象は13〜32歳のスイス代表選手で、診断や才能判定の基準ではありません。",
  },
  {
    title: "Determining Validity and Reliability of an In-Field Performance Analysis System for Swimming",
    authors: "Born et al. (2024)",
    doi: "10.3390/s24227186",
    href: "https://www.mdpi.com/1424-8220/24/22/7186",
    use: "映像計測と計装システムで比較しやすい時間指標、測定法による差が出る指標を区別する根拠です。",
  },
  {
    title: "Validity and Reliability of 2D Video Analysis for Swimming Kick Start Kinematics",
    authors: "Matúš et al. (2025)",
    doi: "10.3390/jfmk10020184",
    href: "https://pubmed.ncbi.nlm.nih.gov/40407468/",
    use: "2D映像で扱えるスタート運動学と、撮影・イベント定義・計測法を一致させる必要性の根拠です。",
  },
] as const;

export default function ResearchPage() {
  return (
    <LegalPage
      title="研究根拠と測定境界"
      description="スタートを単一スコアへ縮めず、映像から妥当に確認できる局面だけを表示するための設計根拠です。研究結果は個人の合否、才能、将来成績を判定するものではありません。"
      lastUpdated="2026年9月1日"
    >
      <LegalSection id="principles" title="1. 何を重視するか">
        <ul>
          <li>前方速度は重要ですが、入水距離・入水時速度・入水角度と組み合わせて表示します。</li>
          <li>力、パワー、仕事量、正確な3D重心速度は、計装されたスタート台や多方向計測なしには測れないため表示しません。</li>
          <li>撮影条件と時系列ポリシーを満たすイベントは未検証ベータの自動判定として指標に使い、低スコア・遮蔽・飛沫などはコーチ確認へ回します。手動修正も可能です。</li>
          <li>水中軌道、最大深度、キック、ブレイクアウト、7.5m／10m／15mは、水上スマホ1台のv1対象外です。</li>
        </ul>
      </LegalSection>

      <LegalSection id="reference-band" title="2. エリート参考帯の読み方">
        <p>
          参考帯は、60fps以上・固定・ほぼ真横で校正する精密モードだけに表示します。30fps以上の簡易タイムモードでは、撮影条件と時間分解能が異なるため表示しません。
        </p>
        <p>
          Born et al. (2026) Appendix Aの分位点を、種目と研究比較区分ごとの帯へ変換して表示します。時間は短い方向、距離は長い方向を高パフォーマンス側として扱い、単純な数値順の評価にはしません。
        </p>
        <p>
          表示は「P25〜P50」のような位置の説明だけです。百分位はコーチが確認した指標だけに表示し、未検証ベータの自動判定だけで百分位を確定しません。A〜E評価、合否、総合点、才能判定は行いません。研究対象範囲に合わせ、13〜32歳だけに参考帯を表示します。33歳以上は解析できますが、帯は表示しません。
        </p>
        <p>
          収録データは原論文の表をアプリ用の機械可読形式と帯表示へ変更しています。原論文は
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            Creative Commons Attribution 4.0 International
          </a>
          で提供されています。
        </p>
      </LegalSection>

      <LegalSection id="measurement" title="3. 測定値の位置づけ">
        <p>
          簡易タイムモードは初動、ブロック／壁接触、押し出し、飛行、入水、5mの時間だけを参考計測します。初動・離台・飛行は条件を満たせば自動判定し、入水・5mは手動確認を前提とします。距離、速度、角度、0〜5m平均速度は算出しません。
        </p>
        <p>
          ブロック／壁接触時間と、定義が一致する5m時間は比較しやすい指標です。一方、初動、入水イベント、角度、2D速度、入水距離には撮影方向、フレームレート、校正、ランドマーク定義による差が含まれます。画面外、遮蔽、飛沫、複数人物、カメラ移動、判定スコア不足がある場合は数値を
          <code>null</code>
          とし、0で置き換えません。
        </p>
        <p>
          5m通過が水面映像で確認できない場合、外部のストップウォッチ値は記録用として保存できますが、研究参考帯の計算には使用しません。
        </p>
      </LegalSection>

      <LegalSection id="sources" title="4. 参照研究">
        <div className="grid gap-4">
          {sources.map((source) => (
            <article
              key={source.doi}
              className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70"
            >
              <h3 className="font-bold text-slate-950 dark:text-white">
                <a href={source.href} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {source.authors} · DOI {source.doi}
              </p>
              <p className="mt-3">{source.use}</p>
            </article>
          ))}
        </div>
      </LegalSection>

      <LegalSection id="beta" title="5. 未検証ベータ">
        <p>
          研究を実装根拠として掲載することは、本アプリの自動検出精度や現場妥当性が検証済みであることを意味しません。80動画、各種目20本、2コーチ独立注釈によるStart専用検証が完了するまで「未検証ベータ」を維持します。
        </p>
        <p>
          検証手順と暫定合格基準は<a href="/validation">独立注釈画面</a>とリポジトリの
          <code>docs/release-validation.md</code>
          に記載します。
        </p>
      </LegalSection>
    </LegalPage>
  );
}
