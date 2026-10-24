# Hakoniwa Nuxt Layer

このリポジトリ自体が Nuxt Layer です。元のトップを `/ja/hakoniwa/` へ移し、展示・試作・静的ファイルを同じ名前空間へまとめています。別サイトのルートを置き換える `app.vue` や `/` ページは含みません。

## ホストへの導入

Nuxt `^3.14.1592 || ^4.0.0`、Vue `^3.5.13`、ビルドには Node 20.19 以降（hirameki.dev のCIと同じ Node 22を推奨）を使用します。生成済みNitroサーバーにVite/Three.js/kitのビルド依存は入りません。Node 20の本番ランタイムを変更するための設定は追加しません。ホスト側の `app.baseURL` は `/` を前提にしています。`/ja/hakoniwa/` はアプリ全体の baseURL ではなく、この Layer が所有するルートです。

既存のnpm lockfileとCIに組み込む場合は、Git依存をコミットSHAで固定する方法を推奨します。

```sh
npm install --save-exact --install-links 'git+https://github.com/sakutakajp/hakoniwa.git#<確認済みのコミットSHA>'
```

```ts
export default defineNuxtConfig({
  extends: ['@sakutakajp/hakoniwa'],
})
```

この方法はnpmの `files` 一覧で必要なLayerファイルだけをインストールし、ホストの `npm ci --install-links` で再現できます。GitHubのアーカイブAPIではなく、許可されたGit接続が使える環境にも対応します。既存依存のバージョンは維持し、追加したLayerと必要な依存だけをlockfileに記録してください。

GitHub source archiveを直接 extends する場合は次の設定も使用できます（アーカイブAPIへの接続が必要）。

```ts
// ホストの nuxt.config.ts。既存の設定は維持する。
export default defineNuxtConfig({
  extends: [
    ['github:sakutakajp/hakoniwa#<確認済みのコミットSHA>', { install: true }],
  ],
})
```

ブランチ名ではなく確認済みの完全なコミットSHAを固定してください。`install: true` は Layer のビルド依存（`@nuxt/kit`、Vite、Three.js と型）をインストールするために必要です。ビルド環境には GitHub/npm レジストリへのアクセスが必要です。Nuxt/Vue は peer dependencies で、ホストが提供します。Layer はclassicなルート階層の `pages/` を使用し、Nuxt 3/4の両方で読み込めます。単独開発環境もNuxt 3.14.1592 / Vue 3.5.13に合わせています。既存ホストのNuxtやNodeを更新する必要はありません。Layer のインストール時に Nuxt の postinstall は実行しません。

ローカルの兄弟ディレクトリで試す場合は、ホストを基準とした絶対パスを渡せます。

```ts
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  extends: [fileURLToPath(new URL('../hakoniwa/', import.meta.url))],
})
```

ホストの `app.vue` は通常どおり `<NuxtLayout><NuxtPage /></NuxtLayout>` を描画します。既存の `extends`、modules、SSR、デプロイ設定は維持してください。ホストのルートやレイアウトが Layer より優先されるため、同じ `/ja/hakoniwa/**` をホスト側で定義すると上書きになります。

## URL移行

| 以前 | LayerのURL |
| --- | --- |
| `/` | `/ja/hakoniwa/` |
| `/hakoniwa/<slug>` | `/ja/hakoniwa/<slug>` |
| `/dev/assets/**` | `/ja/hakoniwa/dev/assets/**` |
| `/play/library-books` | `/ja/hakoniwa/play/library-books` |
| `/library-comparison.html` | `/ja/hakoniwa/library-comparison.html` |
| `/ocean-diorama/index.html` | `/ja/hakoniwa/ocean-diorama/index.html` → 島と海 |
| `/exhibits/**` | `/ja/hakoniwa/exhibits/**` |
| `/images/hakoniwa/**` | `/ja/hakoniwa/images/hakoniwa/**` |
| `/fonts/**` | `/ja/hakoniwa/fonts/**` |

以前のルートをホストから奪わないため、名前空間の外にはリダイレクトを追加していません。旧ドメインからの転送が必要な場合は、その旧配信元で別途設定します。

## 3D読み込みと副作用の分離

- 一覧は既存のWebPサムネイルだけを使用し、Three.jsやcanvasを読み込みません。
- 各作品の Three.js と関連コードは独立した Vite の HTML/chunk 出力です。ビューア・アセット画面・本探し・比較ページが iframe を作ったときだけ読み込みます。Nuxt のプラグインや共通エントリには Three.js を import しません。
- 既存の回転・拡大・メニュー・品質指定・非表示中の停止・破棄処理を維持しています。遷移時に iframe の描画ループとGPU資源を解放します。
- ページの親コンポーネントが `layout: false` と独立したシェルを持ち、ホストの既定レイアウトで全画面ビューアを囲まないようにします。
- 共通CSSはその親ページからだけ読み込み、すべて `.hakoniwa-shell` 配下に限定しています。ページ用bodyクラス、言語、robotsは `useHead` のライフサイクルで除去されます。読み込まれたCSSがクライアント遷移後も残ってもホストには作用しません。
- Layer内のimportは明示的なalias `#hakoniwa` を使用し、ホストの `~/` へ誤解決しません。

## ビルドと静的配信

`modules/hakoniwa.ts` が Nuxt の `build:before` で展示を自動ビルドし、ホストの `buildDir/hakoniwa-exhibits` に出力します（Nuxt の設定によって `.nuxt` または `node_modules/.cache/nuxt/.nuxt` 配下）。インストール済み Layer のディレクトリには書き込みません。Nuxt CLIの buildDir クリーンアップ後に生成するため、別のビルドスクリプトや手動コピーは不要です。

Nitroは生成したファイルを `/ja/hakoniwa/exhibits/` として公開し、`build` / `generate` の最終公開出力へ含めます。写真・書体・比較HTMLは Layer の `public/ja/hakoniwa/` から取り込みます。Three.js・書体ライセンスも展示出力に同梱します。`npm run build:exhibits` は単独確認用に `public/ja/hakoniwa/exhibits/` へ出力しますが、生成物はGitやnpmパッケージには含めません。

展示のソースを変更したら開発サーバーを再起動します。ホストの `nuxt dev` / `nuxt build` / `nuxt generate` だけで生成されます。Cloudflare Worker名・プリセット・デプロイ処理を Layer は指定しません。

単独開発とテストのlockfileでは既存ホストに合わせてNitro 2.10.4、Rollup 4.34.9、nuxi 3.22.3、unstorage 1.15.0、および互換性のある `@rollup/plugin-replace` 6.0.2を固定しています。6.0.3の置換ルール変更は古いNitroの静的ファイル読込を壊すためです。この開発用overrideはホストへ継承されません。ホストは既存の検証済みlockfileを維持してください。

## 検索登録

公開一覧 `/ja/hakoniwa/` は Layer 自身では noindex にしません。その子ページだけに `noindex, follow` を付けます。SSRのレスポンスヘッダー、ページmeta、生成・静的HTMLで同じ範囲に適用します。ホストの `/`、他ページ、404/200用HTML、既存robots、`_headers` は変更しません。静的配信でNitroを通らないHTMLにもmetaが入るため、ホスト全体を対象にする `_headers` は同梱しません。ホストのstaging全体のnoindex方針はホストが管理します。

## 開発・検証

単独開発のNuxt型チェック設定は `tsconfig.dev.json` です。`npm run typecheck` がprepare後に明示的に読み込みます。source archiveのルートで自動検出される `tsconfig.json` から、存在しないLayer自身の `.nuxt` を参照しない構成です。消費側の型チェックから除くのはこのLayerの `tests/` だけで、ホストのテストや型設定は変更しません。

```sh
npm ci
npm run dev:prepare
npm run dev
# http://localhost:3000/ja/hakoniwa/

npm run test:indexing
npm run typecheck:exhibits
npm run typecheck
npm run build
npm run generate
npm run build:consumer
npm run test:layer:http
CHROMIUM_PATH=/usr/bin/chromium npm run test:layer
```

`tests/fixtures/consumer` は Nuxt 3.14.1592 / Vue 3.5.13 / Nitro 2.10.4 / Vite 5.4.14 を固定し、別の app/layout/root/about/dev ページ・CSS・静的アセットを持つ消費側アプリです。`npm run build:consumer` は既定でGitHub source archiveと同じ全追跡ファイルのクリーンな `git archive` を作り、Layerの `.nuxt` を一度も生成せずに別プロジェクトをprepare/build/typecheckします。開発テストや設定をnpmの `files` 一覧で隠さないため、リポジトリ配布固有の問題も検出します。`LAYER_PACKAGE_MODE=npm npm run build:consumer` ではnpm tarballのインストール経路も検証できます。消費側の既定ディレクトリは `/tmp/hakoniwa-consumer-nuxt3` です。`LAYER_CONSUMER_DIR` で保存先を変更できます。生成物がインストール済みLayerへ混入しないことも確認します。HTTP/SSR検証はホストとLayerのルート、SEO、生成ファイルとJS依存を検査します。Playwright検証はホスト→一覧→ビューア→別ビューア→履歴→ホストの遷移、CSS/head復元、リクエスト分離、および実際のWebGL作品の操作・破棄を検査します。

既存の各Playwrightスイートも新URLへ更新済みです。GPU/Chromiumが利用できる環境で実行してください。ビルド成功やHTTP検証は、実機Safari・モバイルGPUの見た目/操作の検証を代替しません。
