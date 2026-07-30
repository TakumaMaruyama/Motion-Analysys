import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "プライバシーポリシー | MotionAnalysys",
  description:
    "MotionAnalysysにおけるカメラ映像、動画ファイル、分析結果の取扱いについて説明します。",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="プライバシーポリシー"
      description="MotionAnalysysは、カメラ映像や動画をブラウザ内で処理するローカルファーストの姿勢分析ツールです。ここでは、分析時に扱う情報と、その保存・送信について説明します。"
      lastUpdated="2026年7月30日"
    >
      <LegalSection id="local-processing" title="1. 映像は端末内で処理します">
        <p>
          カメラ映像、選択した動画ファイル、姿勢ランドマーク、関節角度などの分析結果は、利用中のブラウザ内で処理します。本アプリには、これらを運営者のサーバーへアップロードする機能はありません。
        </p>
        <p>
          分析中のデータは原則としてページを開いている間だけメモリに保持され、ページの再読み込みやタブを閉じる操作によって破棄されます。
        </p>
      </LegalSection>

      <LegalSection id="data" title="2. 本アプリが扱う情報">
        <ul>
          <li>
            <strong>カメラ映像：</strong>
            ブラウザでカメラ利用を許可した場合に限り、リアルタイム分析へ使用します。
          </li>
          <li>
            <strong>動画ファイル：</strong>
            利用者が端末から明示的に選択したファイルだけを読み込みます。
          </li>
          <li>
            <strong>分析結果：</strong>
            姿勢ランドマーク、角度、軌跡、信頼度などを、現在のセッション内で生成します。
          </li>
          <li>
            <strong>書き出しデータ：</strong>
            JSON、CSV、PNGは利用者の操作によって端末へ保存されます。保存後の管理は利用者ご自身で行ってください。
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="not-collected" title="3. 収集しない情報">
        <p>
          本アプリは、アカウント登録、クラウド履歴、映像のサーバー保存、広告トラッキングを提供していません。映像、動画、姿勢ランドマーク、分析値を外部へ送信する処理も実装していません。
        </p>
        <p>
          ただし、ウェブサイトの配信基盤では、セキュリティ維持や障害対応のため、IPアドレス、ブラウザ情報、アクセス日時などの一般的なアクセスログが記録される場合があります。これらのログに、分析対象の映像や分析結果は含まれません。
        </p>
      </LegalSection>

      <LegalSection id="permissions" title="4. カメラ権限">
        <p>
          カメラは、利用者がブラウザの許可画面で承認した場合だけ使用します。権限はブラウザやOSの設定からいつでも取り消せます。カメラを許可しなくても、対応する動画ファイルを選択して分析できます。
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
          <li>分析データを消去するには、分析を終了してページを閉じてください。</li>
          <li>ブラウザ設定から、カメラ権限やダウンロード済みファイルを管理できます。</li>
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
