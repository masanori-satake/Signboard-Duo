# Changelog

## [0.1.0] - 2026-11-14

- First working version: RSS 1.0 / RSS 2.0 / Atom feed engine with conditional fetching (ETag / Last-Modified) and per-feed auth (bearer / basic / custom header) via SecretStorage
- Platforms = feeds (max 5), topics = arrivals; platform paging on both the flap and LED boards forked from Signboard-Solo
- Long headlines scroll on the LED board and flip through in segments on the flap board; rows open their link on click
- Icon in the Duo palette: deep-green ground with white flap tiles and a coral accent tile (the Solo shape language, Duo colours)

- 初版：RSS 1.0 / RSS 2.0 / Atom の取得エンジン（ETag / Last-Modified の条件付き取得、SecretStorage によるフィード別認証）
- フィード＝番線（最大5）、トピック＝到着として両盤面でページ送り表示
- 長い見出しは LED ではスクロール、フラップでは区切りのめくりで表示し、行クリックでリンクを開く
