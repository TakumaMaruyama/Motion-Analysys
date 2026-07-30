import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "利用規約 | MotionAnalysys",
  description:
    "MotionAnalysysの用途、姿勢推定値の限界、安全上の注意事項を定める利用規約です。",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="利用規約"
      description="MotionAnalysysを安全に使うための条件と、姿勢推定による数値の限界をまとめています。分析を始める前にご確認ください。"
      lastUpdated="2026年7月30日"
    >
      <LegalSection id="agreement" title="1. 規約への同意">
        <p>
          MotionAnalysys（以下「本アプリ」）を利用することで、本規約に同意したものとします。同意できない場合は、本アプリを利用しないでください。
        </p>
      </LegalSection>

      <LegalSection id="purpose" title="2. 本アプリの目的">
        <p>
          本アプリは、単一人物のカメラ映像または動画から姿勢を推定し、スポーツフォームの傾向を振り返るための補助ツールです。
        </p>
        <p>
          医療機器、診断機器、治療・リハビリテーションの判断手段、安全検査、競技の公式判定を目的としたものではありません。健康や身体に関する判断は、医師、理学療法士、資格を持つ指導者などの専門家へご相談ください。
        </p>
      </LegalSection>

      <LegalSection id="estimates" title="3. 数値は推定値です">
        <p>
          関節角度、体幹や肩・腰の傾き、可動域、軌跡などの表示値は、機械学習モデルが映像から推定した参考値です。精度や完全性、特定目的への適合を保証するものではありません。
        </p>
        <p>
          カメラの角度、レンズ、撮影距離、照明、服装、身体の重なり、動きの速さ、画面外へのはみ出しなどによって結果が変わります。信頼度が低い結果は表示を抑制しますが、表示された値が常に正しいとは限りません。
        </p>
      </LegalSection>

      <LegalSection id="monocular-3d" title="4. 単眼映像の3D情報について">
        <p>
          本アプリの3D姿勢情報は、1台のカメラで撮影した映像から推定した相対的な位置関係です。モーションキャプチャー、距離センサー、複数カメラなどの校正済み機器による実測ではありません。
        </p>
        <p>
          そのため、奥行きや身体部位間の距離をセンチメートル、メートルなどの実寸として扱わないでください。本アプリも単眼3Dの値を実測距離として表示しません。
        </p>
      </LegalSection>

      <LegalSection id="safety" title="5. 安全上の注意">
        <ul>
          <li>撮影前に周囲の人、物、床面との距離を確認してください。</li>
          <li>画面を見ながら危険な動作を行わないでください。</li>
          <li>痛み、しびれ、めまいなどを感じた場合は、直ちに動作を中止してください。</li>
          <li>分析結果だけを根拠に、無理なフォーム変更や運動負荷の増加を行わないでください。</li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="6. 映像を利用する際の責任">
        <p>
          利用者は、自身が撮影・利用する権利を持つ映像だけを本アプリで使用してください。第三者が映る場合は、事前に本人または必要な権限者の同意を得てください。
        </p>
        <p>
          違法な撮影、監視、本人確認、差別的な評価、プライバシー侵害、その他第三者の権利を侵害する目的での利用を禁止します。
        </p>
      </LegalSection>

      <LegalSection id="local-data" title="7. データの保存">
        <p>
          映像と分析結果はブラウザ内で処理され、運営者のサーバーには保存されません。利用者が書き出したJSON、CSV、PNGなどのファイルは、利用者の責任で安全に管理してください。詳しくは
          <a href="/privacy">プライバシーポリシー</a>
          をご覧ください。
        </p>
      </LegalSection>

      <LegalSection id="open-source" title="8. ソフトウェアとモデル">
        <p>
          本アプリはオープンソースのソフトウェアおよび姿勢推定モデルを利用しています。それぞれの権利は各権利者に帰属し、個別のライセンス条件が適用されます。詳細は
          <a href="/licenses">ライセンスページ</a>
          に掲載します。
        </p>
      </LegalSection>

      <LegalSection id="availability" title="9. 提供内容の変更・停止">
        <p>
          安全性、保守、技術上の理由などにより、予告なく機能を変更または停止する場合があります。本アプリの利用や利用できなかったことによって生じた損害について、法令で認められる範囲を超える責任は負いません。
        </p>
      </LegalSection>

      <LegalSection id="law" title="10. 準拠法とお問い合わせ">
        <p>
          本規約は日本法に準拠します。本規約に関する連絡は、
          <a
            href="https://github.com/TakumaMaruyama/Motion-Analysys/issues"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Issues
          </a>
          からお願いします。公開投稿に個人情報や映像を添付しないでください。
        </p>
      </LegalSection>
    </LegalPage>
  );
}
