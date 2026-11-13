# Signboard-Duo

A split-flap / LED board for your RSS & Atom feeds — each feed is a platform, and every topic arrives like a train or a plane.

RSS / Atom フィードを空港のフラップ盤／駅の LED 盤で眺める VS Code 拡張です。フィードが「番線／滑走路」、届いたトピックが「電車／飛行機」になります。

## Features / 機能

- Up to 5 RSS 1.0 / RSS 2.0 / Atom feeds, shown one platform per page
- Feed topics arrive with a flap / LED animation; click a row to open the link
- Long headlines scroll (LED) or flip through in segments (flap)
- Conditional fetching (ETag / Last-Modified), read-only polling of the URLs you configure — no telemetry, no other traffic
- Tokens for authenticated feeds are stored in VS Code SecretStorage, never in settings

## Settings / 設定

```jsonc
"signboardDuo.feeds": [
  { "id": "nhk-social", "name": "NHK社会", "url": "https://www.nhk.or.jp/rss/news/cat0.xml" },
  { "id": "vscode-releases", "name": "VS Code リリース", "url": "https://github.com/microsoft/vscode/releases.atom" },
  { "id": "jma-extra", "name": "気象庁 随時", "url": "https://www.data.jma.go.jp/developer/xml/feed/extra.xml", "kind": "jma" },
  { "id": "bamboo-failed", "name": "Bamboo 失敗ビルド", "url": "https://bamboo.example/rss/...",
    "kind": "bamboo", "auth": { "type": "basic", "user": "you" } }
],
"signboardDuo.pollMinutes": 15
```

For feeds with `auth`, run **Signboard-Duo: Set Feed Token** to store the secret.

認証が必要なフィードは、設定に方式だけを書き、コマンド **Signboard-Duo: Set Feed Token** でトークンを SecretStorage に保存します。

## Version

0.1.0 — first working version: feed engine, platform paging, both renderers.
