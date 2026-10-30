# 5作品の箱庭展示

> 2026-10-24: Nuxt Layer 化に伴いURLと配信の責務が変わりました。現行の導入・URL・noindex方針は [Nuxt Layer の利用ガイド](nuxt-layer.md) を優先してください。以下は以前の実装記録です。

2026-10-17。`origin/work` の `ed6219f` を基点とし、ユーザー提供の `origin/hakoniwa` (`8b4dd06`) の `hakoniwa-series-code.zip` を取り込む。ZIPは974,936 bytes。SHA-256: `3f3901bc1fe69b59f3cdde6dbb28a49c1a8d1d25f97c25a0f6ad9aadb4acb924`。対象は5作品のみ。既存の海はユーザーの最新方針により置換し、旧URLは島と海へ案内する。100作品の構成案や他の企画資料は変更しない。

## 構成

- `/`: 5作品の一覧。画像は取り込んだ作品そのものの描画から生成する。
- `/hakoniwa/sand-pedestal`: 島と海
- `/hakoniwa/nyc-diorama`: ニューヨーク
- `/hakoniwa/library-diorama`: 図書館
- `/hakoniwa/dino-diorama`: ジュラ紀の川辺（元素材と同様、恐竜自体は未配置）
- `/hakoniwa/electric-town-diorama`: 電気街
- `/exhibits/<slug>/index.html`: 各作品を単独で開けるページ。

`exhibits/` に原作のソース、README、制作手順書、書体ライセンスを保持する。台座、カメラ、照明、地形、街の配置を再制作せず原作を使う。原作READMEの各フォルダでのnpm実行手順に代わり、統合版は以下のルートコマンドを使う。

Nuxtが展示室とナビゲーションを担当。各作品はiframeに1つだけ表示し、DOM・CSS・イベントの衝突を防ぐ。Viteの複数HTMLビルドでThree.js 0.186.1を共通chunkにまとめる。CDNや外部画像・外部フォントへの通信は不要。出力`public/exhibits/`は生成物としてgitignoreする。`dev` / `build` / `generate` の前段で必ず作成する。展示ソースを編集した際は開発サーバーを再起動するか `npm run build:exhibits` を実行する。

## ライフサイクル・負荷

`exhibits/shared/lifecycle.ts` がrequestAnimationFrameを管理し、非表示中は更新を保留する。Nuxtのページを離れる前と単独ページのpagehideで破棄。ResizeObserver、操作イベント、タイマー、描画ループを止め、geometry/material/textureをdisposeし、WebGL contextの明示解放で水面のrender targetなど残りのGPU資源も解放する。iframe自体を取り外してdocumentに登録された残りのイベントも終了する。

画面幅700px以下またはソフトウェアGPUでは原作のlowPower設定を使用する。`?quality=low` / `?quality=high` で比較可能。通常は開発用シーンオブジェクトを公開せず、`?inspect=1` の検証時だけ公開する。操作はドラッグ、ホイール、タッチの回転・ピンチ、矢印キー、＋・−、0。reduced-motionは原作の挙動を維持。

## 開発・確認

```sh
npm ci
npm run typecheck:exhibits
npm run typecheck
npm run build
node .output/server/index.mjs
# 別のターミナルで。Chromiumの場所は環境に合わせる。
CHROMIUM_PATH=/usr/bin/chromium npm run test:exhibits
```

ブラウザテストはPC 1440×1000、スマートフォン390×844の5作品を対象とする。テストはソフトウェアGPUの負荷を抑えて比較するためreduced-motionで実行する。通常アニメーションの島と海でもPCの表示・回転・終了処理を別途確認した。画像とJSON結果は `test-results/evidence/` （`EVIDENCE_DIR`で変更可能）に保存する。本番配信で静的出力が必要な場合は `npm run generate` を使用する。今回push、PR、merge、デプロイは実施しない。

## 配信サイズとライセンス

Three.jsを含む共通chunkは約572kB（gzip約144kB）。各作品は約171〜259kB（gzip約62〜127kB）。一覧用WebPは5枚合計約428kB。ビルド時に500kBを超える共通chunkへの警告が出るが、Three.jsは作品間でキャッシュを共有し、一覧では3Dコードを読み込まない。Three.jsと看板書体のライセンスは生成先の `public/exhibits/licenses/` に同梱する。

## 確認結果（2026-10-17）

- `npm run typecheck:exhibits`: 成功（5作品のstrict TypeScript）。
- `npm run typecheck`: 成功（Nuxt）。
- `npm run build`: 成功。共通chunkのサイズ警告のみ。
- `npm run generate`: 成功。展示一覧と5作品を含む14ルート（payload等を含む）を生成。
- `npm run test:exhibits -- collection.spec.ts --max-failures=1`: PC・スマホ各5作品、10件成功。
- `npm run test:exhibits -- navigation.spec.ts fallback.spec.ts zoom.spec.ts --max-failures=1`: 6件成功。
- `git diff --cached --check`: 成功。書体ライセンスの本文は保持し、改行と行末空白だけ正規化。

ブラウザ確認はLinux Chromium / SwiftShader。PC 1440×1000、スマホ390×844。表示・キーボード回転・マウス/タッチ回転・リセット・ホイール/2本指ピンチ拡大・別作品への切替・WebGL context解放・画像の読み込み・横幅・旧URL・404・WebGL非対応の説明を確認。PC/スマホの各作品、一覧、拡大操作後の図書館のスクリーンショットを保存。

実機Safari/iPhone/Android、ハードウェアGPUの高品質モード、Cloudflare本番での確認は未実施。5作品の静的な形状や見た目を変える変更はしていない。初回生成、とくに島の光と影はソフトウェアGPUでは重く、準備表示を出す。高品質の実機描画性能は別途確認が必要。

## 操作開始・停止時の描画安定化（2026-10-18）

5作品の操作中だけ内部解像度を下げる処理を廃止し、静止時と同じDPRを維持する。以前は `setPixelRatio` / `setSize` がcanvasを消去しても、そのフレームの `doRender` がfalseのままとなり、島・ニューヨーク・川辺で次の水更新まで背景だけになることがあった。操作中のリサイズをなくすことで、この未描画経路と開始・停止時の細部の解像度変化を除く。画面サイズ変更への追従、既存の品質別DPR上限（low=1、high=2）、非表示時停止、切替時の破棄は維持する。

静止時の画素数は同じだが、従来の操作時半解像度に比べて画素数は最大4倍になる。390×600・DPR3・quality=low・Chromium/SwiftShaderで、同じマウス移動のRAF描画開始から1pixelの `readPixels` 完了までを比較した中央値は次のとおり（各9〜11サンプル）。

| 作品 | 旧版 | 修正後 | 比率 |
| --- | ---: | ---: | ---: |
| 島と海 | 969ms | 1,380ms | 1.42倍 |
| ニューヨーク | 211ms | 356ms | 1.69倍 |
| 図書館 | 725ms | 1,130ms | 1.56倍 |
| ジュラ紀の川辺 | 478ms | 727ms | 1.52倍 |
| 電気街 | 120ms | 220ms | 1.83倍 |

これはソフトウェアGPUで同期読み戻しを入れた人工計測であり、実機FPSではない。モバイル実機・Safari・ハードウェアGPUの高品質性能は未検証。中間MSAAを追加して負荷を上げる変更はしない。水面の周期的な変化や細線のすべてのaliasingを解消する変更ではない。

`tests/exhibits/stable-rendering.spec.ts` は通常motion・DPR3・quality=lowで、PC960×640とスマホ390×600の5作品を対象に、2回の押下保持・drag・wheelまたはpinch・reset・停止を検証する。RAFごとの内部サイズ、サイズ変更呼出、描画呼出、JSエラーを記録し、連続JPEGを保存する。既存の静止後スクリーンショット検証とは分けて扱う。

```sh
npm run build:exhibits
# Nuxtを起動した別ターミナルで
npx playwright test --config playwright.exhibits.config.ts stable-rendering
```

上記10ケースは成功。連続画像313枚のうち、コンテンツ表示後に中央の箱庭領域が背景だけとなるフレームは0、操作中のサイズ変更呼出0、JSエラー0。静止時の完成画像もPC・スマホ各5作品を保存した。微細なaliasingの完全解消や実機性能を保証する結果ではない。
