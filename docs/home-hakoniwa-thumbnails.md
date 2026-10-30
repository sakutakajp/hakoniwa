# トップページの箱庭画像の画角・大きさ統一

## 対象と方針

トップページは3Dプレビューではなく `public/images/hakoniwa/*.webp` の5枚を表示している。前回の共通カメラ変更だけでは既存画像に反映されないため、最新work `0f3d77a` を基点に画像を撮り直す。

`exhibits/shared/home-camera.ts` の方位0°・俯角22.8°を利用した、詳細ページと同じ実シーンから撮影する。900×650のニューヨークの初期表示を基準として、各作品の実際の台座メッシュの頂点を画面に投影し、その幅と下端位置を合わせる。台座幅は約483.87px（画像幅の53.76%）、下端は約549.06px（高さの84.47%）。

各作品の既存の全体フィットから縮小・平行移動だけを行い、方位・俯角・距離・注視点やモデル、照明、材質を変えない。縮小倍率が安全範囲外なら撮影を停止する。全体の高さや画素面積をそろえるための変形・切り取りは行わない。建物の高いニューヨークと背の低い電気街などは、台座幅が同じでも上側の余白が異なる。

`app/pages/index.vue` やCSSは変更しない。PC・スマホともカード画像の縦横比900/650が同じなので、台座の幅占有率と下端位置も保たれる。詳細ページのインタラクティブカメラ・操作・リセットは変更しない。

## 再生成

```sh
npm run build:exhibits
# public/ をローカルで配信（またはNuxtを起動）
python3 -m http.server 3010 --bind 127.0.0.1 --directory public
# 別ターミナル
node --import tsx scripts/capture-hakoniwa-thumbnails.mjs http://127.0.0.1:3010
python3 scripts/make-hakoniwa-thumbnails.py test-results/home-thumbnails
```

撮影はChromium / SwiftShader、quality=low、900×650、DPR1。既存の一覧生成と同じ低負荷描画を用い、WebPも従来どおりquality=88。撮影時に共通ホーム方向、台座幅と下端の誤差0.1px未満、JSエラーなしを検証し、`test-results/home-thumbnails/metrics.json` に計測値を保存する。

トップページの確認は `tests/exhibits/home-thumbnails.spec.ts`。5枚の読み込み、900×650の画像サイズ、全カードの同じ表示幅と縦横比、横スクロールなし、詳細ページへのリンク、3Dを読み込まないことを確認する。比較画像は `test-results/home-before/` と `test-results/home-after/` に保存。

初回は作業ブランチ `fix/homepage-hakoniwa-thumbnails` 内で変更準備と確認を完了。その後ユーザーの承認を受け、workへの反映と自動デプロイ確認へ進む。mainは変更しない。実機Safari・公開配信版の実表示は未確認。

## 確認結果

撮影5作品すべて方位0°・俯角22.8°、台座幅483.867033159137px・下端549.058446694189pxで一致。撮影倍率はニューヨーク1、島0.83674、図書館0.86557、川辺0.86125、電気街0.86654。

`npm run build` 成功（既存のchunkサイズ警告あり）。`node --check scripts/capture-hakoniwa-thumbnails.mjs` と `git diff --check` 成功。トップの限定ブラウザテストはPC1440×1000・スマホ390×844の2件成功。変更後の全5画像を両サイズのスクリーンショットで確認し、見切れなし。
