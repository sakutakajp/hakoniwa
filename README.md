# みらい博物館 / MIRAI MUSEUM

地球と生命のはじまりから、世界各地の人々の発想と営みへ。100個の箱庭を共通の順路で旅し、その経験を自分の世界を育てる体験へつなぐプロジェクトです。

## 企画・設計ドキュメント

| ドキュメント | 内容 |
|---|---|
| [全体コンセプト](docs/concept.md) | 体験の軸、決定済みの方針、検討中の項目 |
| [100の箱庭の構成案](docs/dioramas-100-overview.md) | 10章・100個の題材、舞台と時代、地域配分、参照資料 |
| [001〜100の個別設計案](docs/dioramas-100-details.md) | 見せ場、入口の景色、観察案、発見、次へのつながり |
| [ビジュアル方針](docs/visual-direction.md) | 箱庭の質感、光、水、岩、001〜010の画像検討 |
| [海のジオラマの実装・引き継ぎ](docs/ocean-diorama.md) | 現在の実装、起動方法、操作、検証状況 |

100個の題材は採用した暫定構成です。個別の操作・演出は検討案として記載しており、現在の実装は5作品の統合資料で確認できます。

## Nuxt Layer

このリポジトリは Nuxt 3/4 の再利用可能な Layer です。展示一覧は **`/ja/hakoniwa/`**、各箱庭は `/ja/hakoniwa/<slug>` にあります。ホストの `/`、アプリシェル、共通スタイル、SEO、配信先設定を置き換えません。

導入方法・URL移行表・ビルド要件・検証方法は [Nuxt Layer の利用ガイド](docs/nuxt-layer.md) を参照してください。

## 現在の実装

5つの箱庭を統合した展示室です。実装・起動・操作・検証方法は [5作品の統合資料](docs/hakoniwa-integration.md) を参照してください。

## 起動

```sh
npm ci
npm run dev
```

`http://localhost:3000/ja/hakoniwa/` から5つの箱庭を選べます。Layer内の旧海URL `/ja/hakoniwa/ocean-diorama/index.html` は島と海へ案内します。
