# Changelog

## [0.1.1] - 2026-11-14

- View-title commands now show icons instead of raw text labels (refresh, LED / flap toggles)
- The board shows it is alive: last successful fetch time in the flap footer and in the LED ticker, and a guidance platform when no feeds are configured

- ビュータイトルのコマンドが文字列ではなくアイコン表示になった（更新、LED／フラップ切替）
- 盤面が取得中であることを見せるようにした：最終取得時刻をフラップのフッターと LED のテロップに表示し、フィード未設定のときは案内の番線を出す

## [0.1.0] - 2026-11-14

- First working version: RSS 1.0 / RSS 2.0 / Atom feed engine with conditional fetching (ETag / Last-Modified) and per-feed auth (bearer / basic / custom header) via SecretStorage
- Platforms = feeds (max 5), topics = arrivals; platform paging on both the flap and LED boards forked from Signboard-Solo
- Long headlines scroll on the LED board and flip through in segments on the flap board; rows open their link on click
- Icon in the Duo palette: deep-green ground with white flap tiles and a coral accent tile (the Solo shape language, Duo colours)

- 初版：RSS 1.0 / RSS 2.0 / Atom の取得エンジン（ETag / Last-Modified の条件付き取得、SecretStorage によるフィード別認証）
- フィード＝番線（最大5）、トピック＝到着として両盤面でページ送り表示
- 長い見出しは LED ではスクロール、フラップでは区切りのめくりで表示し、行クリックでリンクを開く
