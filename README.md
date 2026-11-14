# Signboard-Duo

A split-flap / LED / stock board for your RSS & Atom feeds — each feed is a platform, and every topic arrives like a train or a plane.

RSS / Atom フィードを空港のフラップ盤／駅の LED 盤／証券の株価ボードで眺める VS Code 拡張です。フィードが「番線／滑走路」、届いたトピックが「電車／飛行機」になります。

## Features / 機能

- Up to 5 RSS 1.0 / RSS 2.0 / Atom feeds, shown one platform per page
- Three board styles: split-flap, LED, and a stock board for quote feeds — one title-bar button rotates flap → LED → stock
- Feed topics arrive with a flap / LED animation; click a row to open the link
- Long headlines scroll one way (LED) or flip through in segments (flap); remarks flip in plate-sized segments too
- The flap logo cell shows each site's own favicon; the LED ticker greets you in the name of the line on screen
- Colour themes (title-bar palette button): Duo Green / Lime / Ice
- The stock board carries a small "just for looking (no trading)" badge, so nobody at the office mistakes it for real trading — the flap and LED boards need no such note: their motifs give the joke away at a glance
- Conditional fetching (ETag / Last-Modified), read-only polling of the URLs you configure — no telemetry, no other traffic
- Tokens for authenticated feeds are stored in VS Code SecretStorage, never in settings

## Starter feeds — 日本語圏のおすすめ

Copy the whole block into your `settings.json` and the board starts moving right away.

そのまま `settings.json` にコピペすれば、すぐに盤面が動き出します。

```jsonc
"signboardDuo.feeds": [
  { "id": "nhk-top", "name": "NHK 主要", "url": "https://www.nhk.or.jp/rss/news/cat0.xml", "maxItems": 5, "keepHours": 12 },
  { "id": "itmedia-bursts", "name": "ITmedia 速報", "url": "https://rss.itmedia.co.jp/rss/1.0/news_bursts.xml", "maxItems": 5, "keepHours": 12 },
  { "id": "yahoo-topics", "name": "Yahoo!ニュース", "url": "https://news.yahoo.co.jp/rss/topics/top-picks.xml", "maxItems": 5, "keepHours": 12 },
  { "id": "hatena-it", "name": "はてな 人気IT", "url": "https://b.hatena.ne.jp/hotentry/it.rss", "maxItems": 4, "keepHours": 48 },
  { "id": "jma-extra", "name": "気象庁 随時", "url": "https://www.data.jma.go.jp/developer/xml/feed/extra.xml", "kind": "jma", "maxItems": 5, "keepHours": 24 }
],
"signboardDuo.pollMinutes": 15
```

## Starter feeds — recommended for English readers

A different mix for a different feed culture: link culture, world news, and tech press. Copy the whole block into your `settings.json`.

```jsonc
"signboardDuo.feeds": [
  { "id": "hacker-news", "name": "Hacker News", "url": "https://news.ycombinator.com/rss", "maxItems": 5, "keepHours": 12 },
  { "id": "bbc-news", "name": "BBC News", "url": "https://feeds.bbci.co.uk/news/rss.xml", "maxItems": 5, "keepHours": 12 },
  { "id": "the-verge", "name": "The Verge", "url": "https://www.theverge.com/rss/index.xml", "maxItems": 5, "keepHours": 24 },
  { "id": "github-blog", "name": "GitHub Blog", "url": "https://github.blog/feed/", "maxItems": 4, "keepHours": 48 },
  { "id": "vscode-releases", "name": "VS Code Releases", "url": "https://github.com/microsoft/vscode/releases.atom", "maxItems": 4, "keepHours": 72 }
],
"signboardDuo.pollMinutes": 15
```

## Stock quotes / 株価ボード

Set `"kind": "stock"` on a feed that returns quotes as JSON (CNBC quote shape) and rotate the board to the stock style with the board-style button. Each instrument is a royal-blue panel like the boards at securities firms: name and symbol in the head, the current price big and white, the change coloured by direction (red up / green down, Japanese convention), and a quiet Open / High / Low strip.

`kind: "stock"` のフィード（CNBC 形式の JSON）を追加し、盤面切替ボタンで株価ボードに切り替えます。証券会社のボードのような青いパネル表示で、銘柄とシンボル、大きな現在値、色で語る前日比（日本の慣例で、上昇＝赤、下落＝緑）、そして始値・高値・安値の帯が付きます。

日本向け（日経平均・TOPIX・ドル円・ソフトバンクグループ）:

```jsonc
{ "id": "markets-jp", "name": "東京市場", "kind": "stock", "maxItems": 10,
  "url": "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=.N225%7C.TOPX%7CJPY%3D%7C9984-JP&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json" }
```

For US markets (S&P 500, Dow, Nasdaq, Apple, USD/JPY):

```jsonc
{ "id": "markets-us", "name": "US Markets", "kind": "stock", "maxItems": 10,
  "url": "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=SPX%7C.DJI%7C.IXIC%7CAAPL%7CJPY%3D&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json" }
```

Note: that endpoint is a public, unofficial one — it may change or stop without notice, and quotes may be delayed. Symbols use CNBC's notation (`.N225`, `.TOPX`, `SPX`, `JPY=`, `9984-JP`, …); a symbol the provider does not know is simply skipped.

注意：上記エンドポイントは非公式の公開エンドポイントで、予告なく変わったり止まったりすることがあります。価格は遅延配信の場合があります。

## Authenticated feeds / 認証フィード

For feeds with `auth`, run **Signboard-Duo: Set Feed Token** to store the secret in SecretStorage; only the auth type lives in settings.

認証が必要なフィードは、設定に方式だけを書き、コマンド **Signboard-Duo: Set Feed Token** でトークンを SecretStorage に保存します。Bamboo build-result feeds use `"kind": "bamboo"` (failed builds show as cancelled).

## Version

0.7.1 — the joke badge is stock-board-only, the stock header is STOCK BOARD only, and the stock footer wraps instead of clipping at narrow widths.
