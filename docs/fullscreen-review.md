# 箱庭の全画面表示・ヘッダーレビュー

対象は既存5作品の `/hakoniwa/[slug]`。`/dev/assets/[slug]/[object]` の単体オブジェクト画面は対象外。

- iframeを画面の全幅・全高に配置し、100dvhと100vhフォールバックを使用する。
- 展示室へ戻るリンクとサイト名、操作・箱庭メニューだけを上に重ねる。説明と作品切替はメニュー内に保持する。
- 詳細画面だけdocumentのスクロールを止め、退出時に解除する。小さい画面で開いた操作メニューはパネル内でスクロールできる。
- viewport-fit=coverとsafe-area-insetで操作部を画面の安全な範囲に配置する。
- 元のモデル・材質・カメラ操作・リサイズ時の構図調整には変更を加えない。重複する自動ヒントだけをhint=0で抑え、メニューから操作説明を読めるようにする。
- サイト名を共通MuseumBrandコンポーネントにし、M PLUS Rounded 1c MediumでMIRAI MUSEUMと表示する。トップ、箱庭詳細、本探しのヘッダーで共用する。
- Google Fonts公式リポジトリのフォントをサイト名の文字だけにサブセット化。2652 bytesのWOFFを1回読み込み、ランタイムの外部フォント通信は不要。ライセンス・出典・元ファイルのハッシュをpublic/fonts/m-plus-rounded-1cに同梱。

検証:

```sh
npm run typecheck
npm run build
# 別ターミナルで .output/server/index.mjs を3023番で起動
EVIDENCE_DIR=/tmp/fullscreen-evidence npx playwright test --config playwright.fullscreen.config.ts
```

PC/スマホで実描画と回転、メニュー、戻る操作とGPU解放、ページのスクロール復帰を確認する。スマホの縦・横・高さ変更、全5ルートの全画面配置、個別オブジェクト画面との分離、404、フォント読み込み1回も対象。実機Safariと実際のノッチ端末は未確認。

この変更は画像レビュー前のためローカルに留め、PR #5へpushせず、マージ・公開しない。

## PR #4と#5のCloudflareチェック比較

2026-10-18にGitHubから取得した情報:

| 対象 | commit | Workers Builds: miraimuseum |
|---|---|---|
| PR #4の最終preview | ad33eec6ea2e2b12b9f5022ec88f728371669919 | failure |
| PR #4をworkへマージした本番 | ae3576a3d310be26dfad280099419ce708db8bcf | success / Version f7137183-8b33-41ff-b3f3-1755e3555b8b |
| PR #5のpreview | 655ac175e6766d90295ff655a06f2a0e924a9ec8 | failure |

PR #4のpreviewと本番はGit treeが両方とも `ee5173febd0d213e1d70828156f39db15a28e85f`。つまり全ファイル内容が同一でも、preview失敗・work成功となったことを確認できる。両PRの失敗チェックには具体的なエラーテキストもannotationもなく、Cloudflareダッシュボードのログへのリンクだけがある。

観測された失敗パターンは同じ。previewと本番の実行環境・設定差を調べる根拠にはなるが、PR #5の根本原因まで同じとは断定できない。PR #5にはnoindexのビルドフックやアセットページ等の差分もあるため、PR #4が本番成功した事実だけではPR #5の成功を保証できない。

リポジトリには.githubワークフローがなく、Cloudflare側のpreview/productionビルドコマンドやブランチ設定は収録されていない。Worker名miraimuseumとnpmのbuildスクリプトはPR #4成功時から維持されている。Cloudflareへログインせず、Forbiddenだったブランチ保護情報の再取得・迂回も行っていない。PR #5はopen・未マージ、head655ac17のまま保持する。

チェックURL:
- PR #4 preview: https://github.com/sakutakajp/miraimuseum/runs/117579651486
- work成功: https://github.com/sakutakajp/miraimuseum/runs/117579932300
- PR #5 preview: https://github.com/sakutakajp/miraimuseum/runs/117695570044

実施結果: 型チェック、本番ビルド、関連ブラウザ3ケースすべて成功。PC/スマホの全画面・メニュー・ヘッダーとスマホ横画面のスクリーンショット計7枚を作成。フォントのロード成功と通信1回、退出後のGPU解放と通常ページのスクロール復帰を確認した。
