# Changelog

## [0.7.1] - 2026-11-14

- The "just for looking" joke badge is now stock-board-only: the flap and LED boards give the joke away by their motifs, so their badge / ticker note from 0.7.0 are reverted. The stock board keeps it — that is the one that could be mistaken for real trading at work
- Stock board: the header is STOCK BOARD only (no Japanese twin), and the footer wraps at narrow widths instead of clipping the badge

- 「眺める専用のジョークです」の表示は株価ボードだけに絞った：フラップと LED はモチーフ自体でジョークと分かるので、0.7.0 で入れたバッジ／テロップの一文を取り下げた。誤解（仕事中の売買に見える）があり得るのは株価だけなので、そちらは残す
- 株価ボード：見出しを STOCK BOARD のみにし（和文の併記をやめた）、狭幅でフッターが切れないよう折り返すようにした

## [0.7.0] - 2026-11-14

- The board-style rotate button's glyph now follows the current style (plane / dashboard / graph), like the old two-style toggle did
- Fixed: switching width in Auto mode no longer changes the platform you were watching — renderers hand the current platform number to each other through the host
- Every board now identifies itself as a joke at a glance: a "just for looking" badge in the flap and stock footers (the stock one adds "no trading"), and a note in the LED ticker — so colleagues never mistake it for a serious tool
- Stock board header is now bilingual like real quote boards （株価ボード / STOCK BOARD) with an accent rule

- 盤面ローテートボタンのグリフが、現在のスタイルに追従するようにした（飛行機／ダッシュボード／グラフ。以前の2スタイル切替と同じ流儀）
- 修正：Auto モードで幅を変えても、見ていた番線が切り替わらないようにした（現在の番線番号をホスト経由でレンダラ同士が引き継ぐ）
- 盤面がジョークだと一目で分かるようにした：フラップと株価のフッターに「眺める専用のジョークです」バッジ（株価は「売買はできません」付き）、LED はテロップに一文を追加。同僚に真面目なツールと誤解されないため
- 株価ボードの見出しを実物のように日英併記（株価ボード／STOCK BOARD）にし、アクセントの罫を引いた

## [0.6.0] - 2026-11-14

- One title-bar button now rotates the board style (flap → LED → stock), replacing the three separate style buttons; the per-style commands remain available in the Command Palette
- Stock board restyled after real securities-firm boards: each instrument is a royal-blue panel with name + symbol, a big white current price, a direction-coloured change zone, and an Open / High / Low strip (the quote parser now carries those fields)

- 盤面切替を1つのボタンに統合（フラップ→LED→株価のローテート）。スタイル別のコマンドはコマンドパレットに残した
- 株価ボードを実物の証券ボードの見た目に寄せた：銘柄ごとの青いパネルに、銘柄名とシンボル、大きな白い現在値、方向で色が変わる前日比、始値・高値・安値の帯（パーサが OHLC も運ぶようにした）

## [0.5.0] - 2026-11-14

- New stock board style (third renderer): zoned rows like a securities board — fixed name zone, large price zone, change zone coloured by direction (red up / green down, Japanese convention), quiet time zone. Quote feeds use the new "stock" kind (CNBC-shaped JSON); non-stock feeds fall back to a simple list in this style
- Title bar: the renderer switchers (stock / flap / LED) now form the rightmost cluster, matching Signboard-Solo's arrangement
- README: copy-paste starter feed sets for Japanese and English readers (different mixes per region), plus stock-feed examples for JP and US markets

- 株価ボード（第3のレンダラ）を追加：証券ボードのように区画で分けた行表示（銘柄は固定、現在値は大きく、前日比は色で語る＝日本の慣例で上昇は赤・下落は緑、時刻は静かに）。相場フィードは新しい kind "stock"（CNBC 形式 JSON）。株価でないフィードはこの盤面では簡易リスト表示にフォールバック
- タイトルバー：モード切替（株価／フラップ／LED）を右端のクラスタに移動し、Signboard-Solo の配置と対称にした
- README：日本語圏と英語圏で別のおすすめスターターフィード（コピペ可能）を掲載し、日米市場の株価フィード例も追加

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
