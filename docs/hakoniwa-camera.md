# 箱庭の初期画角をニューヨークに統一

対象は展示一覧の5作品（島と海、ニューヨーク、図書館、ジュラ紀の川辺、電気街）。試作の20m図書館、比較ページ、アセット専用カメラは対象外。

## 基準と変更

`exhibits/shared/home-camera.ts` に最新 work のニューヨークの値を移し、5作品の config から参照する。

- 透視投影、方位0°（+z側から正面）、俯角22.8°。
- 距離は台座幅の4.86倍。注視点は台座中央、土台上面から幅の0.24倍の高さ。
- 基準縦画角13.44°。固定FOVにせず、各作品の投影された外形とアスペクト比から最終FOVとレンズオフセットを求める。
- 台座の左右余白2.9%、縦長では最大5%。台座上30.5%、下15%、建物や木の上端は最低4%の余白。縦長では台座と中身全体を上下中央に寄せる。
- 台座の占有率を共通の目安とし、高い中身が収まらない場合は縮小する。形状の異なる作品の総ピクセル面積を同一にはしない。

旧設定との差は、図書館の方位22°と電気街の−9°を0°へ、島・川辺・電気街の注視点0.165と図書館0.22を0.24へ変更する点。図書館の余白も上記へ統一する。図書館は壁まで含む外形全体を「台座」としてフィットしていたため、ホーム時のみ台座と上部の範囲を分離し、他作品と同じ意味で余白を使う。

回転時の全方位フィット、操作範囲・減衰・ズーム・パンは既存処理を保持。初期状態とリセットは同じ home を参照する。リサイズは操作状態を維持して投影だけを更新する。検証用URLの az/el 指定と電気街の refcam も保持する。形状・照明・材質は変更しない。

## 作業基点

2026-10-23にリモート確認。main=`2cbdd762`、work=`cf0a45e7`。初期チェックアウトはmain相当で変更なし。最新workからローカル `fix/hakoniwa-initial-camera` を作成。AGENTS.mdと開発SKILL.mdは環境・リポジトリに見つからず、README・統合資料・制作手順書の関連項目を参照した。初回の変更準備ではpush・PR・マージ・公開を行わず、その後ユーザーの承認を受けてworkへの反映と自動デプロイ確認へ進む。

## 検証

`npm run typecheck:exhibits`、`npm run typecheck`、`npm run build:exhibits` が成功。ビルドの既存の500kB chunk警告あり。

カメラのブラウザ回帰テストは `tests/exhibits/home-camera.spec.ts`。変更前ニューヨークの位置・投影行列をfixtureに保持。PC1440×1000とスマホ390×844の5作品について、共通ホーム、回転・ズーム、リサイズ後の操作保持、0キーによる完全復元、幅320×568への追従を確認する。

画像は `test-results/camera-before/`（変更前のPCニューヨーク・図書館）と `test-results/camera-after/` に保存する。確認対象は単体展示URL。ヘッダー付きNuxt全画面の再検証は今回未実施。ブラウザはLinux Chromium / SwiftShader、quality=low、reduced-motion。実機iPhone/Safari/Android、高品質GPU、Cloudflare公開環境は未確認。

再現時は `public/` をローカル3000番で配信し、`npx playwright test --config playwright.exhibits.config.ts home-camera --output=/tmp/camera-playwright` を実行する。画像保存先をPlaywrightの自動削除対象から分けるため、outputを指定する。

最終結果: ブラウザテスト10件成功（PC5件・スマホ5件、9.1分）。幅320×568へのリサイズ、操作状態維持、リセットも全件成功。ニューヨークの位置・投影行列はPC/スマホとも変更前と一致。代表比較画像は `test-results/camera-before/desktop-library-diorama.png` と `test-results/camera-after/desktop-library-diorama.png`。画面占有率の比較はカメラと外形で確認し、水面のアニメーションの画素一致は条件にしない。
