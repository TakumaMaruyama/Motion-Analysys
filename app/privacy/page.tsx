import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "プライバシーポリシー | MotionAnalysys",
  description:
    "MotionAnalysys無料ベータ版における競泳動画、校正プロファイル、分析結果の取扱いについて説明します。",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="プライバシーポリシー"
      description="MotionAnalysysは、利用者が選んだ競泳動画をブラウザ内で処理する無料ベータ版のローカル計測ツールです。ここでは、分析時に扱う情報と、その保存・送信について説明します。"
      lastUpdated="2026年8月1日"
    >
      <LegalSection id="local-processing" title="1. 映像は端末内で処理します">
        <p>
          利用者が端末から明示的に選択した動画ファイル、姿勢ランドマーク、競泳向け計測値などの分析結果は、利用中のブラウザ内で処理します。本アプリには、動画または分析結果を運営者のサーバーへアップロードする機能はありません。無料ベータ版はライブカメラ入力を使用しません。
        </p>
        <p>
          分析中の動画と結果は原則としてページを開いている間だけメモリに保持され、ページの再読み込みやタブを閉じる操作によって破棄されます。過去の分析を再表示する履歴機能はありません。
        </p>
        <p>
          撮影位置などの条件を再利用するための校正プロファイルだけは、現在のブラウザの
          <code>localStorage</code>
          に保存します。運営者のサーバーや別の端末へ同期しません。
        </p>
      </LegalSection>

      <LegalSection id="data" title="2. 本アプリが扱う情報">
        <ul>
          <li>
            <strong>動画ファイル：</strong>
            利用者が端末から明示的に選択したファイルだけを読み込みます。
          </li>
          <li>
            <strong>泳法と校正プロファイル：</strong>
            選択した泳法と撮影条件の設定を、同じ条件で比較しやすくするためにブラウザ内で使用します。校正プロファイルは
            <code>localStorage</code>
            に保存されます。
          </li>
          <li>
            <strong>分析結果：</strong>
            姿勢ランドマーク、角度、軌跡、競泳向け参考計測値、信頼度などを、現在のセッション内で生成します。
          </li>
          <li>
            <strong>書き出しデータ：</strong>
            JSON、CSV、PNGは利用者の操作によって端末へ保存されます。保存後の管理は利用者ご自身で行ってください。
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="not-collected" title="3. 収集しない情報">
        <p>
          本アプリは、アカウント登録、クラウド履歴、映像・分析結果のサーバー保存、広告トラッキングを提供していません。映像、姿勢ランドマーク、校正プロファイル、分析値を外部へ送信する処理も実装していません。
        </p>
        <p>
          外部LLM・生成AI、外部の画像・動画解析API、サーバー側推論は使用していません。分析のために第三者サービスへ動画やプロンプトを送信することはありません。
        </p>
        <p>
          ただし、ウェブサイトの配信基盤では、セキュリティ維持や障害対応のため、IPアドレス、ブラウザ情報、アクセス日時などの一般的なアクセスログが記録される場合があります。これらのログに、分析対象の映像や分析結果は含まれません。
        </p>
      </LegalSection>

      <LegalSection id="local-storage" title="4. 動画選択とブラウザ保存">
        <p>
          本アプリは、利用者がファイル選択画面で指定した動画だけを読み込みます。端末内の他の写真、動画、ファイルへ自動的にアクセスすることはありません。
        </p>
        <p>
          校正プロファイルは、利用者が同じ撮影条件を再利用できるよう、現在のオリジンに対するブラウザの
          <code>localStorage</code>
          に残ります。別のブラウザや端末には共有されません。消去する場合は、本アプリの削除操作またはブラウザのサイトデータ削除機能を使用してください。
        </p>
      </LegalSection>

      <LegalSection id="runtime" title="5. 姿勢推定ランタイム">
        <p>
          姿勢推定にはMediaPipe Pose Landmarkerを使用します。モデルと実行ファイルは本サイトから配信し、分析対象の映像をモデル提供者へ送信しません。採用しているモデルとライセンスは
          <a href="/licenses">ライセンスページ</a>
          で確認できます。
        </p>
        <p>
          MediaPipe Tasksの配布ランタイムには、性能・利用状況メトリクスをGoogleへ送信する機能が含まれます。本アプリの配信設定は
          <code>Content-Security-Policy: connect-src &apos;self&apos;</code>
          により、Googleを含む第三者ドメインへの接続をブラウザ側で遮断します。ランタイム提供元の説明は
          <a
            href="https://github.com/google-ai-edge/mediapipe#privacy-notice"
            target="_blank"
            rel="noreferrer"
          >
            MediaPipe Privacy Notice
          </a>
          で確認できます。この設定を外したり、同じヘッダーを付けない別の配信方法へ変更したりする場合は、事前に送信内容、同意の要否、ポリシーを再確認する必要があります。
        </p>
        <p>
          本アプリ独自のアクセス解析や広告SDKは組み込んでいません。サイト配信基盤の一般的なアクセスログについては、前項の説明が適用されます。
        </p>
      </LegalSection>

      <LegalSection id="your-control" title="6. 利用者が管理できること">
        <ul>
          <li>第三者が映る動画は、必要な同意を得てから使用してください。</li>
          <li>共有端末では、書き出したファイルを置き忘れないようご注意ください。</li>
          <li>現在の分析データを消去するには、分析を終了してページを閉じてください。</li>
          <li>校正プロファイルを消去するには、本アプリの削除操作またはブラウザのサイトデータ削除機能を使用してください。</li>
          <li>ブラウザやOSの機能から、ダウンロード済みのJSON、CSV、PNGを管理できます。</li>
        </ul>
      </LegalSection>

      <LegalSection id="changes" title="7. 変更とお問い合わせ">
        <p>
          機能や法令の変更に応じて、このポリシーを更新することがあります。重要な変更は、本ページの最終更新日とともにお知らせします。
        </p>
        <p>
          本ポリシーやデータの取扱いに関する連絡は、
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
