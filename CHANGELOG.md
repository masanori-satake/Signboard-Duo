# Changelog

## [0.4.0] - 2026-11-14

- Colour themes: a new title-bar button cycles Duo Green (default) / Lime / Ice. On the flap board the 7-segment clock and banner take the theme colour; on the LED board the destination, header, ticker and page dots do. The choice is remembered

- 配色テーマ：タイトルバーのボタンで Duoグリーン（既定）／ライム／アイス を切り替えられるようにした。フラップは7セグ時計とバナーが、LED は行先・見出し・テロップ・ページ点がテーマ色になる。選択は記憶される

## [0.3.1] - 2026-11-14

- Flap board: favicons now sit on a light tile (like a browser tab) — dark marks such as GitHub's were invisible on the dark logo cell

- フラップ盤面：ファビコンを明るいタイルの上に載せるようにした（ブラウザのタブと同じ考え方。GitHub のような暗色マークが暗いロゴ欄に沈んで見えなくなっていた）

## [0.3.0] - 2026-11-14

- Flap board: the logo cell now shows the feed site's own favicon (loaded from the feed's origin, no third-party service), falling back to the kind chip when the site has none
- LED board: the ticker speaks for the line on screen — "Thank you for using the OO line" with that feed's arrival count and state notices

- フラップ盤面：ロゴ欄に、フィードのサイト自身のファビコンを表示するようにした（取得先オリジンから読み込み、第三者サービスは使わない。無いサイトは従来の種別チップにフォールバック）
- LED 盤面：テロップが表示中の番線の言葉で流れるようにした（「本日も○○線のご利用ありがとうございます」＋そのフィードの到着件数・状態案内）

## [0.2.3] - 2026-11-14

- Flap board: long feed remarks no longer overflow the remark plate — the plate never wraps, and a long remark flips through in plate-sized segments (page rotation waits for the segments, too); the full remark is in the row tooltip

- フラップ盤面：長い備考がプレートからはみ出さないようにした（プレートは折り返し禁止にし、長い備考はプレート幅の区切りでめくって表示。ページ送りも区切り分待つ）。備考の全文は行のツールチップで読める

## [0.2.2] - 2026-11-14

- LED board: long destinations now scroll one way, snap back to the start, and scroll the same way again, instead of bouncing back and forth

- LED 盤面：長い行先のスクロールを往復から一方向に変更（最後まで流れたら先頭に戻り、同じ向きに流れ直す）

## [0.2.1] - 2026-11-14

- LED board: the status column is only reserved when a row on the screen actually has a status, so destinations get the full width otherwise

- LED 盤面：状態列は、その画面の行に状態があるときだけ幅を取るようにした（通常は行先が幅いっぱいに使える）

## [0.2.0] - 2026-11-14

- Platform navigation in the view title: previous / next platform buttons and a pin button that holds the current platform (auto-rotation and new-arrival jumps pause while pinned)
- Page rotation now waits until the longest title on the page has been read to the end (all flap segments shown once / the LED scroll completed once)

- ビュータイトルに番線の操作を追加：前／次の番線ボタンと、今の番線を固定するピンボタン（固定中は自動送りと新着ジャンプを止める）
- ページ送りが、ページ内の一番長い見出しを最後まで読めるまで待つようになった（フラップは全区切りを一巡、LED はスクロールが一巡するまで）

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
