# ローカル統合状態（2026-10-18）

> 2026-10-24: Nuxt Layer 化に伴いURLと配信の責務が変わりました。現行の導入・URL・noindex方針は [Nuxt Layer の利用ガイド](nuxt-layer.md) を優先してください。以下は以前の実装記録です。

確認時のremote workは `ae3576a`、mainは `2cbdd76`。以下はそのworkに対するローカルの追加であり、push・PR・マージ・配信はしていない。リポジトリ可視性の変更は別作業。

| 項目 | 状態・対象 |
|---|---|
| チラつき修正 | `301b64e`を祖先として保持。5作品の操作中DPRを固定。描画コードの再実装なし |
| 図書館比較 | 元の10mと20m実験を保持。20mは標準化しない |
| アセット確認 | `/dev/assets`を直接閲覧可能。トップ・サイトマップに追加せずnoindex。生成元は公開用の説明のみ |
| 本探し | `/play/library-books`。10mの既存図書館を使用。鑑賞モードへ復帰可能 |
| 検索登録 | `/`以外は既定noindex。SSR・静的HTML・生成404・将来のページを対象 |
| 縮尺規範 | 10m・100m・500m・2km。図書館10mのみ確定。他作品は変更しない |
| データセンター | 正式ソースの転送失敗で未統合。横幅10mは比較候補であり未確定 |
| 里山 | 正式ZIP/HTMLの転送失敗で未統合。代替再実装は行わない |

今回の補強は、アセット・比較画面が履歴キャッシュから復元された際の再初期化、および引用符なしrobots metaとnoindexの競合除去。モデル・配置・通常時の見た目は変更しない。解放済みのメッシュIDや停止済みの比較ループをそのまま再利用しないよう、復元時にページを読み直す。

## 確認手順

```sh
npm run typecheck
npm run typecheck:exhibits
npm run test:indexing
npm run build
# 本番プレビューを別ターミナルで起動後
MUSEUM_URL=http://127.0.0.1:3017 npx playwright test --config playwright.integration.config.ts
BOOK_HUNT_URL=http://127.0.0.1:3017 npx playwright test --config playwright.book-hunt.config.ts --project=mobile
```

静的配信を確認する場合は `npm run generate`。トップ以外の生成HTMLにrobots noindexがあることを確認する。

前回の履歴復元修正時点では5作品の描画コードは301b64eと同一で、PC/スマホ全10ケースのチラつき検証を実施済み。今回の種類別アセット追加は抽出用メタデータと確認モードを追加するため、別途通常シーンの形状・色・配置を変更前ビルドと照合する。履歴復元テストはブラウザーがBFCacheを採用するかに依存しないようpersisted付きpagehide/pageshowを発火させる。実機Safari/GPU、Cloudflare本番の確認とは区別する。

ローカル成功は本番反映を意味しない。外部書込みの再開前に最新remoteとの差分・可視性・対象範囲・必須チェックを改めて確認する。

## 種類別アセット確認（追記）

`/dev/assets` → `/dev/assets/<箱庭>` → `/dev/assets/<箱庭>/<種類>` の3段階。旧メッシュ確認は `/dev/assets/mesh-review` に保持。無効な箱庭・種類は404。トップ導線は増やさず、引き続きnoindex。

種類ごとに最初の実オブジェクトを1つ表示する。図書館は本棚1区画・らせん階段・閲覧椅子・ラウンジチェア・机・読書灯など。島と太古の森は植物の葉と幹を同じ配置単位で組み合わせ、電気街は車両、NYCは橋・桟橋・フェリーを取り出す。全シーンの全ての建築部品を網羅する一覧ではない。

結合メッシュは生成関数の前後の索引範囲を記録する。乱数やMeshBuilderのgroup、モデル生成の手順を変えない。単体表示用のコピーは元の位置・UV・色・焼込み属性・インスタンス属性を保持し、材質とテクスチャを共有する。単体のカメラ調整と水面合成停止は確認モードだけに適用する。表示切替時にはコピーのみを解放し、退出時は元の展示ライフサイクルでGPUを解放する。

寸法は元の配置方向でのワールド外接箱。図書館10mは1 unit=1m、20m試作は1 unit=2m。他作品の実距離換算は未確定。20mを標準に変更していない。初回表示では元の箱庭を生成するため、単独モデルファイルの読み込みより準備時間がかかる。

農村の `libfile_d4d92de2b0a881919b352ad58c15f84f`（ZIP）と `libfile_78f08e9dbee08191b8516df63b1edf80`（HTML）は再開後も正式取得に失敗。Libraryの対象解決は成功したが、両方のバイト転送が `download failed`。取得済みソースなし。代替モデルの制作や、取得できない資産の追加は行っていない。

検証コマンド（プレビューを起動してから実行）:

```sh
npm run typecheck
npm run typecheck:exhibits
npm run test:indexing
npm run build
MUSEUM_URL=http://127.0.0.1:3022 EVIDENCE_DIR=/tmp/asset-evidence npx playwright test --config playwright.assets.config.ts objects.spec.ts touch.spec.ts
# 変更前ビルドを別ポートで起動した場合のみ、元シーンの一致を照合
BASELINE_URL=http://127.0.0.1:3017 MUSEUM_URL=http://127.0.0.1:3022 EVIDENCE_DIR=/tmp/asset-evidence npx playwright test --config playwright.assets.config.ts parity.spec.ts
NITRO_PRESET=cloudflare_module npx nuxt build
```

通常の図書館10m・20mとNYCについて、全メッシュの頂点属性・索引・インスタンス配置・色・ワールド行列が変更前と一致した。図書館10mの通常表示のスクリーンショットもSHA-256が一致。PC/スマホ幅の表示はChromium/SwiftShaderで検証する。実機SafariやCloudflare本番の検証・公開は行わない。

初期の単体表示では別iframe由来の型付き配列が描画エラーを起こしたため、抽出を同じiframe内へ移して修正。404のnoindexテストはHTML本文だけを見て失敗したが、実装が返すX-Robots-Tagも判定するよう修正して該当テストが成功した。過去ログの失敗は修正後の結果と区別する。

最終確認: 型チェック2種、noindexの5テスト、Node/Cloudflare向けビルドは成功。6展示（既存5作品＋20m比較）の55種類の抽出・寸法とPC/スマホ幅、退出時の解放、直リンク/404/noindex、スマホのタッチ回転・拡大・履歴復元、3シーンの元データ一致を確認した（関連11ケース）。タッチの拡大テストはタップ直後の同期判定から状態更新を待つ判定に直して成功。履歴復元はpersistedイベントの契約検証であり、実機SafariのBFCache採用確認ではない。
