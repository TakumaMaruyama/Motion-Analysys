# MotionAnalysys Start

プールサイドの水上スマートフォン1台で撮影した動画から、競泳スタートの
離台・飛行・入水を局面別に確認する、ブラウザ内処理の未検証ベータです。

公開画面はStart専用です。従来のSwim／Turn／ストローク計測コードは
内部互換と回帰確認のため残していますが、公開経路からは読み込みません。

## 対象

- 自由形、バタフライ、平泳ぎ：飛び込みスタート
- 背泳ぎ：壁からの背泳ぎスタート
- 年齢：13歳以上
- 研究比較区分：男子／女子
- 研究参考帯：Born et al. (2026)の対象範囲に合わせ13〜32歳だけ表示
- 33歳以上：解析可能、研究参考帯は非表示

撮影条件は次の2モードに分かれます。

- 簡易タイム：30fps以上、斜め撮影可。時間6指標と低精度の離台・入水速度を参考計測
- 精密：60fps以上、固定・ほぼ真横。120fpsを推奨し、時間・距離・2D速度・角度を参考計測

どちらも1レーン・1人で、0m壁・5m位置・水面が見える画角を前提とします。

## 4段階ワークフロー

1. 精密／簡易タイム、種目、年齢、研究比較区分、動画を選ぶ。
2. 精密では0m、5m、水面の2点、進行方向を校正する。簡易タイムでは0m・5mの水面位置と進行方向を簡易校正する。
3. 信号、初動、手の離台、後足の離台、離台、頭頂入水、任意の5m通過を
   1フレーム単位で確認する。背泳ぎでは飛び込み専用イベントを除く。
4. 自動判定またはコーチ確認済みイベントから局面別結果、品質・制約、JSON／CSV／PNGを表示・保存する。
   研究参考帯は精密モードだけに表示する。

自動解析は未検証ベータのヒューリスティック判定です。イベントごとの判定スコアに加え、
fps、固定カメラ、泳者数、精密モードの真横条件と校正、イベントの時系列を検査し、
ポリシーを満たしたイベントは`confirmed`として数値に使用します。スコア不足、遮蔽、
飛沫、画面外、不成立などは`needs-review`へ回り、コーチが映像を確認して`verified`に
するか、手動でフレームを修正できます。`candidate`または`needs-review`のままの
イベントは計算しません。`confidence`は確率ではなく、複数の映像根拠を合成した
判定スコアです。画面外、遮蔽、飛沫、不成立は`null`で表し、0で代用しません。
研究参考帯は、コーチが確認した`verified`イベントだけから算出します。
MediaPipe Poseには頭頂ランドマークがないため、自動判定時の頭頂点は、鼻・両目・両耳と
肩中心の身体軸から外挿した2D推定点です。顔点不足や遮蔽、フレーム欠測では自動判定せず、
コーチ確認へ回します。

## 表示指標

簡易タイムでは、初動、ブロック／壁接触、押し出し、飛行の時間は条件を満たせば
自動判定を使います。入水と5m通過は手動確認を前提とし、0m・5mの2点校正から
離台直後・入水直前の前方速度を低精度2D推定として表示します。入水距離、体幹角度、
0〜5m平均速度、研究参考帯は計算・表示しません。精密モードは下表の全指標を対象にします。

| 指標 | 定義 | 研究参考帯 |
| --- | --- | --- |
| 初動時間 | 信号→最初の身体動作 | なし |
| ブロック／壁接触時間 | 信号→最後の足が台／壁を離れる | あり |
| 動作開始後の押し出し時間 | 初動→離台 | なし |
| 飛行時間 | 離台→頭頂入水 | なし |
| 入水時間 | 信号→頭頂入水 | 測定法差あり |
| 入水距離 | 壁0m→頭頂入水位置 | 測定法差あり |
| 離台直後の推定前方速度 | 離台後100msの校正済み体幹中心XをTheil–Sen回帰 | なし |
| 入水直前の推定前方速度 | 入水前100msを同じ方法で回帰 | なし |
| 入水時体幹角度 | 体幹線と校正水面の2D角度 | なし |
| 5m時間 | 信号→頭頂5m通過 | 条件成立時のみ |
| 0〜5m平均速度 | 5m÷確認済み5m時間 | 条件成立時のみ |

5mが水上映像で確認できない場合、外部同期計時値は記録用に保存できますが、
研究参考帯には使用しません。

## 研究参考帯

[`lib/start/references.ts`](lib/start/references.ts)には、Born et al. (2026)
Appendix A Tables A1–A8のうち、v1で比較する4指標を種目×研究比較区分別に
静的収録しています。

- P3／P10／P25／P50／P75／P90／P97の原表値を保持
- 時間は短い方向、距離は長い方向を高パフォーマンスとして明示
- 表示は`P25–P50`のような帯のみ
- A〜E評価、合否、才能判定、総合スコアは作らない
- 著者、論文名、DOI、CC BY 4.0、表示変更内容をアプリ内に掲載

研究の使い方と限界は[`docs/research-sources.md`](docs/research-sources.md)と
`/research`にあります。

## 対象外

- 水中速度、最大深度、キック、ブレイクアウト、7.5m／10m／15m
- 力、パワー、仕事量、力学的加速度
- 正確な3D重心速度、公式反応時間、失格判定
- 医療、診断、治療、けが予測、才能判定

Thng et al.の研究では水平離台速度だけでなく、平均パワー、力、仕事量も
15m成績と強く関係します。スマホ映像だけでは後者を測れないため、
MotionAnalysysはそれらを推定値として作りません。

## ローカル処理と保存

- 動画、復号フレーム、Pose、分析結果はブラウザ内で処理
- 動画アップロード、アカウント、DB、クラウド履歴、外部解析APIなし
- 年齢と研究比較区分はサーバーにも`localStorage`にも保存しない
- 年齢と研究比較区分は利用者が保存した結果ファイルにだけ再現情報として含む
- 校正プロファイルのみ、同一撮影条件の再利用用に同一オリジンの
  `localStorage`へ保存可能

詳細は`/privacy`を参照してください。

## 開発

```bash
npm ci
npm run dev
```

主な確認コマンド：

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run verify
npm run test:e2e
npm run audit:prod
npm run validation:start -- /absolute/path/to/start-validation.json
```

`validation:start`は、外部で保管した匿名検証manifestを決定論的に検査する
コマンドです。実映像、同意、独立注釈、ground truthの正しさを自動で証明する
ものではありません。

## Start専用構成

- [`types/start.ts`](types/start.ts) — Start V1の型、イベント、指標、参考帯
- [`lib/start/analysis.ts`](lib/start/analysis.ts) — 自動判定／コーチ確認依存、時間・2D速度・角度、品質、修正履歴
- [`lib/start/calibration.ts`](lib/start/calibration.ts) — 0m／5m／水面／進行方向の校正
- [`lib/start/references.ts`](lib/start/references.ts) — Born 2026の版付き静的参考値と帯判定
- [`lib/start/export.ts`](lib/start/export.ts) — 決定的JSON／CSV
- [`components/start-analysis-workspace.tsx`](components/start-analysis-workspace.tsx) — 公開4段階UI
- [`components/start-validation-workspace.tsx`](components/start-validation-workspace.tsx) — 自動候補を隠した独立注釈UI
- [`lib/validation/start-annotation.ts`](lib/validation/start-annotation.ts) — 匿名注釈schemaと安全な出力
- [`lib/validation/start-acceptance.ts`](lib/validation/start-acceptance.ts) — 80動画の暫定受入基準
- [`scripts/check-start-acceptance.mjs`](scripts/check-start-acceptance.mjs) — manifest検査CLI

従来の`components/swim/**`、`lib/swim/**`、Swimテストは公開画面では使いません。

## Start検証ゲート

公開時点の表示は「未検証ベータ」です。精密モードの妥当性表示を変更するには
以下の外部証拠が必要です。

- 権利処理済み80動画以上、各種目20本以上
- 2人のコーチが自動候補を見ずに独立注釈
- 120fps：離台・入水候補の中央値1フレーム以内、p90 2フレーム以内
- 60fps：中央値2フレーム以内、p90 4フレーム以内
- 入水距離MAE 0.25m以内
- 2D速度MAPE 5%以内
- 低品質映像のfalse-valid率5%未満

詳細と記録欄は[`docs/release-validation.md`](docs/release-validation.md)にあります。
自動テスト合格だけでは、競泳計測の妥当性や検証ゲート通過を意味しません。

## モデルと動画ランタイム

本番は公式MediaPipe Pose Landmarker Fullを自己ホストします。ビルド時に
固定generationから取得し、サイズとSHA-256を検証します。実行時の外部CDN
フォールバックはありません。

| 項目 | 値 |
| --- | --- |
| runtime | `@mediapipe/tasks-vision@1.0.0` |
| model | `pose_landmarker_full.task` |
| size | `9,398,198` bytes |
| SHA-256 | `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` |
| video reader | `mediabunny@1.51.0` |

モデル変更時はファイル、期待サイズ、SHA-256、モデルID、
[`docs/model-sources.md`](docs/model-sources.md)、
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)を同時に更新してください。

## 対応ブラウザ

対象はリリース時点の現行ChromeとSafariです。動画形式を選択できても、
OSやブラウザのデコーダーが非対応なら解析できません。高解像度・長時間動画は
モバイル端末のメモリ制約を受けます。

## 公開

このリポジトリはReplit Autoscale向けに、Build=`npm run build`、
Run=`npm run start`を設定しています。GitHub push、Replitワークスペース同期、
Replit公開、本番動作確認はそれぞれ区別して実施・記録します。

## ライセンス

- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
- `/licenses` — アプリ内帰属表示
- Born et al. (2026)の参考データ：CC BY 4.0
- MediaPipe Tasks Vision／Pose Landmarker Full：Apache License 2.0
- Mediabunny：MPL-2.0

本リポジトリ独自コードのライセンスは、ルートに別途`LICENSE`が追加されるまで
未指定です。第三者コンポーネント、モデル、研究データには個別の条件が適用されます。
