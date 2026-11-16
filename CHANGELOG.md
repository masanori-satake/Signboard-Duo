# Changelog

## [1.5.0] - 2026-11-16

- Added: the first REST adapter — **Bamboo over REST** (`"type": "bamboo-rest"`), for Bamboo servers whose RSS is unavailable (e.g. behind single sign-on, where the RSS layer refuses programmatic auth but the REST API accepts a PAT). A platform targets a project (all its plans aggregated, one row per plan) and/or explicit plans, and `interests` chooses what becomes news: `failed`, `recovered`, `streak`, `running`, `long`, `all` (default `failed` + `recovered`). Transport, auth, proxy handling and failure diagnosis are shared with RSS feeds. Plan branches are not expanded yet

- 追加：最初の REST アダプタ、**Bamboo REST**（`"type": "bamboo-rest"`）。SSO 運用などで RSS が使えない Bamboo（RSS 層はプログラム認証を拒むが、REST は PAT を受ける）向け。対象はプロジェクト（配下の全プランを1番線に集約、行はプラン毎の最新だけ）とプランの明示で、`interests` で何をニュースにするか選べる（`failed`、`recovered`、`streak`、`running`、`long`、`all`。既定は `failed` ＋ `recovered`）。取得・認証・プロキシ・症状診断は RSS と共通。プランブランチの展開はまだ行わない

## [1.4.0] - 2026-11-16

- Added: token lifecycle management. **Show Stored Tokens** lists the feeds that hold a token (values are never shown); removing a feed from the settings now offers to delete its token too; **Delete Unlinked Tokens** retires tokens whose feeds are gone, and **Delete All Tokens** wipes every stored token at once. Deleting a settings entry and deleting its token now work in either order — previously, a token whose feed was removed from the settings first could no longer be deleted at all

- 追加：トークンのライフサイクル管理。**トークンの保存状況**で保存先のフィード一覧を確認でき（値そのものは表示しない）、設定からフィードを消したときはトークンも一緒に消すか尋ねる。**紐づいていないトークンを削除**で設定から消えたフィードのトークンだけを、**すべてのトークンを削除**で一括を削除できる。設定の削除とトークンの削除がどちらが先でもよくなった（従来は、先に設定から消したフィードのトークンは二度と消せなかった）

## [1.3.13] - 2026-11-16

- Improved: `ci` verdicts now also read Bamboo's mid-title phrases — a real feed (verified 2026-11-16) puts "was SUCCESSFUL" / "has FAILED" in the middle of the title with text on both sides, where the trailing-phrase rules missed the success case. The verdict is read and the title is kept whole

- 改善：`ci` の判定が Bamboo の文中フレーズにも対応。実フィード（2026-11-16 確認）では「was SUCCESSFUL」「has FAILED」がタイトルの文中・前後に文字列ありで現れ、末尾前提の規則では成功側を取りこぼしていた。判定だけ読み取り、タイトルはそのまま保持する

## [1.3.12] - 2026-11-16

- Fixed (palette audit): the three title-bar-only board-style variants no longer appear in the Command Palette, where they duplicated "Switch Board Style" four times over; Pin/Unpin now appear only in the state where they apply. All other commands and every setting were audited — registrations, activation and the settings schema all match what the code reads

- 修正（パレット監査）：タイトルバー専用の盤面切替バリアント3つをコマンドパレットに出さないようにした（「盤面スタイルを切り替え」が4つ並んでいた）。ピン留め／解除は、効く状態のときだけ出すようにした。他のコマンドと全設定は監査済みで、登録・起動・設定スキーマとコードの読み取りは一致している

## [1.3.11] - 2026-11-16

- Fixed: commands now carry the "Signboard-Duo" category, so the Command Palette lists them as "Signboard-Duo: …" as the README describes. Without a category the token commands (Set/Delete Feed Token) could not be found by searching for "Signboard-Duo" — they only existed under their bare titles

- 修正：全コマンドに「Signboard-Duo」カテゴリを付け、コマンドパレットで README の表記どおり「Signboard-Duo: …」と表示されるようにした。カテゴリが無いと、トークンの設定・削除コマンドは「Signboard-Duo」で検索しても出てこず、素のタイトルでしか存在しなかった

## [1.3.10] - 2026-11-15

- Docs: the Culture starter feed's display name is now "MSatake Culture", matching the feed's own renamed RSS channel title (the feed dropped 番線 from its name)

- ドキュメント：カルチャーのスターターの表示名を「MSatake Culture」に変更。フィード側の RSS チャンネル名も同名に改称済み（「番線」を名前に含めない形に統一）

## [1.3.9] - 2026-11-15

- Docs: renamed the Culture feed's id in the Japanese starter feeds from `culture` to `msatake-culture`, so starter ids stay namespaced by source like the other entries (nhk-, hatena-, yahoo-) and cannot collide with another culture feed

- ドキュメント：日本語スターターのカルチャー番線の id を `culture` から `msatake-culture` に変更。他のエントリー（nhk-、hatena-、yahoo-）と同じく配信元で名前空間を分け、別のカルチャー系フィードと衝突しないようにした

## [1.3.8] - 2026-11-15

- Docs: added a copy-paste tech feed set to the Japanese starter feeds — Zenn, Qiita, DevelopersIO, ＠IT, Publickey, CodeZine, the AWS Japan blog and Gizmodo Japan (Japanese editions where a source has both), each URL verified live

- ドキュメント：日本語のスターターフィードに、貼り付けるだけのテック系フィード集を追加。Zenn、Qiita、DevelopersIO、＠IT、Publickey、CodeZine、AWS ブログ、ギズモード・ジャパン（英日両版があるものは日本語版）。各 URL は取得できることを確認済み

## [1.3.7] - 2026-11-15

- Docs: added the Culture feed (カルチャー番線) to the Japanese starter feeds — culture anniversaries and trending topics from the Signboard-Feeds repository, refreshed twice a day

- ドキュメント：日本語のスターターフィードに「カルチャー番線」を追加。Signboard-Feeds リポジトリのフィードで、文化の記念日と話題を1日2回更新する

## [1.3.6] - 2026-11-15

- New icon: a deep blue board with a coral signal badge, so the extension reads at a glance as the one that connects outside — unlike the local-only Solo series (teal). The badge is the Duo series mark for external connections of any kind, not only feeds; the design guide and SVG masters live in the common-design repository

- アイコンを変更：深い青の盤面にコーラルの電波バッジを付け、ローカル処理のみの Solo シリーズ（ティール）と並んでも「外部とつながる側」だと一目で分かるようにした。バッジはフィードに限らない外部接続全般を表す Duo シリーズの印。デザインガイドと SVG マスターは common-design リポジトリに置く

## [1.3.5] - 2026-11-15

- Docs: removed a duplicated horizontal rule before the Japanese troubleshooting section in the README (a leftover from moving the licence section to the end), and audited every other separator in the file

- ドキュメント：README の日本語トラブルシュート直前に重複していた水平線を取り除いた（ライセンス節を末尾へ移した際の残り）。あわせてファイル内の他の区切りもすべて点検した

## [1.3.4] - 2026-11-15

- Fixed a crash when fetching an HTTPS feed whose host is an IP address through a proxy: the tunnel's TLS options passed the IP as the SNI servername, which current Node rejects with a TypeError (previously only a deprecation warning). IP targets now omit SNI (verification uses the IP SAN), and a synchronous throw in the CONNECT handler rejects the fetch instead of escaping

- プロキシ経由で、ホストが IP アドレスの HTTPS フィードを取得すると落ちる問題を直した：トンネルの TLS 設定が IP を SNI の servername に渡していて、現在の Node では TypeError になる（以前は非推奨警告のみ）。IP の宛先では SNI を付けず（検証は IP の SAN で行う）、CONNECT ハンドラ内の同期例外は外へ逃げず取得の失敗として扱う

## [1.3.3] - 2026-11-15

- Tests only: the proxy tunnel tests now use a committed self-signed fixture certificate instead of generating one with the system openssl at test time (an uncontrolled variable across CI runners), and a failing leg prints its underlying error code inline in the test log

- テストのみ：プロキシトンネルのテストは、実行時にシステムの openssl で証明書を生成するのをやめ、コミット済みの自己署名フィクスチャ証明書を使うようにした（CI ランナーごとに異なる制御不能な変数を排除）。失敗した脚は、根本のエラーコードをテストログにそのまま出す

## [1.3.2] - 2026-11-15

- Hardening: the TLS handshake over a proxy tunnel now has the same absolute deadline as every other fetch leg (a tunnel that opens but never speaks TLS could previously hold a fetch open), and the proxy integration tests are split into named legs with hard timeouts so a stalled environment fails loudly instead of hanging the release workflow

- 堅牢化：プロキシトンネル上の TLS ハンドシェイクにも取得全体と同じ絶対期限を適用した（トンネルが開いたまま TLS を始めない相手に待ち続けることがあった）。あわせてプロキシ統合テストを脚ごとに分割し、ハードタイムアウトを付けて、環境側の停滞がリリースワークフローを黙って止めないようにした

## [1.3.1] - 2026-11-15

- README: the License section is once again the last section of each language half — Troubleshooting now sits before it (and the tables of contents match)

- README：ライセンスを各言語の最後に戻した。トラブルシュートはその前に置き、目次の並びも合わせた

## [1.3.0] - 2026-11-14

- Proxy support: feeds are fetched through the proxy from VS Code's own `http.proxy` / `http.noProxy` / `http.proxyStrictSSL` settings (environment variables as fallback), with CONNECT tunnelling for HTTPS and per-URL NO_PROXY bypass. PAC files are not evaluated
- Failures are classified by symptom (DNS, connection, timeout, TLS, proxy, proxy auth, HTTP status, feed auth, unreadable feed, settings). A platform that cannot fetch shows the diagnosis as a board article in every mode (flap / LED / stock) — what happened and the likely cause — and clicking it opens the matching per-language, per-symptom troubleshooting anchor in the README, which now ends each language half with a troubleshooting section that separates the external-feed, internal-feed and PAC cases

- プロキシ対応：VS Code 本体の `http.proxy` / `http.noProxy` / `http.proxyStrictSSL` 設定（予備として環境変数）でフィードを取得する。HTTPS は CONNECT トンネル、NO_PROXY は URL ごとに判定する。PAC ファイルは評価しない
- 失敗を症状別に分類する（DNS・接続・タイムアウト・TLS・プロキシ・プロキシ認証・HTTP ステータス・フィード認証・フィードを読めない・設定）。取得できない番線は、全モード（フラップ／LED／株価）で「何が起きたか＋予想される原因」を記事として盤面に表示し、クリックすると README の言語別・症状別トラブルシュートのアンカーが開く。README 各言語の末尾に、外部フィード／社内フィード／PAC のケースを分けたトラブルシュート節を追加した

## [1.2.2] - 2026-11-14

- README: the stock (`kind: "stock"`) settings examples are now written as indented, one-field-per-line JSON instead of a crammed one-liner

- README：株価（`kind: "stock"`）の設定例を、詰め込んだ一行形式から、1フィールド1行のインデント付き JSON に書き直した

## [1.2.1] - 2026-11-14

- README: the Settings section now documents every per-feed field (defaults and ranges, including the `auth` values) and adds a feed-kinds table explaining how each `kind` is treated on the board

- README：設定の節にフィード各フィールドの説明（既定値と範囲、`auth` の値を含む）と、種別ごとに盤面での扱いを説明するフィード種別表を追加した

## [1.2.0] - 2026-11-14

- The `bamboo` feed kind is absorbed into a new generic `ci` kind and removed (existing `"bamboo"` settings are treated as `"ci"`). CI titles are read for their verdict: Jenkins-style `Job #123 (SUCCESS)` and Bamboo-style `Plan #45 was successful` lose their result words on the board — the build number stays — and failed, unstable or aborted runs show as cancelled; titles without a recognised pattern keep the previous failure-word fallback

- フィード種別 `bamboo` を汎用の `ci` に吸収し、廃止した（既存の `"bamboo"` 設定は `"ci"` として扱われる）。CI のタイトルから成否を読む：Jenkins 形式 `Job #123 (SUCCESS)` や Bamboo 形式 `Plan #45 was successful` の結果語は盤面で取り除かれ（ビルド番号は残る）、失敗・不安定・中断の実行は運休表示になる。パターンに合わないタイトルは従来の失敗語フォールバックのまま

## [1.1.2] - 2026-11-14

- Fixed the flap board's header labels drifting left of their columns on wide panels: the arrival count now sits before the time/remark label block, so the labels end at the same right edge as the rows below

- 広いパネルでフラップ盤面の列ラベル（到着時刻・備考）が列より左にずれる問題を直した：件数表示をラベルブロックの前へ移し、ラベルが下の行と同じ右端で揃うようにした

## [1.1.1] - 2026-11-14

- Hardening pass (no behaviour changes): the poll interval is validated and refresh cycles can no longer overlap; feed credentials are no longer forwarded to other hosts on redirects, and fetches have an absolute deadline so a slow feed cannot stall the others; an out-of-range numeric character reference can no longer fail a whole feed; restored state is shape-checked so corrupt data cannot break activation; the snapshot is persisted once per cycle instead of once per feed and is size-bounded; the LED ticker no longer forces a layout measurement 20 times a second; dead code removed

- 堅牢化（挙動の変更なし）：取得間隔の設定値を検証し、取得周期が重ならないようにした。リダイレクト先の別ホストへ認証情報を転送しないようにし、取得に絶対期限を設けて遅いフィードが他を止めないようにした。範囲外の数値文字参照でフィード全体が失敗しないようにし、復元する保存状態の形状チェックで壊れたデータが有効化を止めないようにした。保存はフィード毎ではなく周期に1回にまとめ、上限も設けた。LED テロップの幅測定を毎秒20回から必要時のみに減らし、死んだコードを削除した

## [1.1.0] - 2026-11-14

- The flap board now uses wide panels: the name field gains a tile for every spare cell pitch of panel width (up to 24 CJK / 40 Latin tiles), so long headlines show more per segment, and the time + remark block is pinned to the right edge so the columns align at the right however wide the name field grows

- フラップボードが広いパネルを使い切るようにした：パネル幅の余り1タイル分ごとに名前タイルが増え（和24／英40まで）、長い見出しが1区切りで多く読める。あわせて時刻＋備考を右端に寄せ、名前欄が伸びても列が右端で揃うようにした

## [1.0.10] - 2026-11-14

- Show the README screenshots at half width so the listing stays compact and the text is reached sooner (the image files themselves are unchanged)

- README のスクリーンショットを半分の幅で表示し、掲載ページが間延びしないようにした（画像ファイル自体は無加工）

## [1.0.9] - 2026-11-14

- Added screenshots of the three boards (LED, split-flap, stock) to the README, so the Marketplace listing shows what the boards look like

- README に3つの盤面（LED・フラップ・株価）のスクリーンショットを追加し、Marketplace の掲載ページで見た目が分かるようにした

## [1.0.8] - 2026-11-14

- Fixed the LED ticker going blank when the platform changed: the board rebuild recreates the ticker's scroll element, but the 1.0.7 render cache skipped writing into it whenever the text was unchanged. The cache is now invalidated on rebuilds

- LED テロップが番線切替のあと消えてしまう問題を修正：盤面の再構築でテロップのスクロール要素が作り直されるのに、1.0.7 の描画キャッシュが「文面が同じなら描かない」と判断して新しい要素が空のままになっていた。再構築時にキャッシュを無効化する

## [1.0.7] - 2026-11-14

- LED ticker: the line name, the arrived count and the last-fetched time now stand out in the accent colour and blink once a second. The ticker also scrolls smoothly now — it no longer restarts when a page turns on the same platform or when a fetch updates the text, and its speed is time-based rather than fixed steps

- LED テロップ：線名・到着件数・最終取得時刻をアクセント色で表示し、1秒ごとに点滅するようにした。あわせてスクロールを滑らかにした——同じ番線でのページ送りや取得による文面更新で巻き戻らなくなり、速度も固定ステップ式から時間ベースに変更した

## [1.0.6] - 2026-11-14

- Raised the feed limit from 10 to 20 (signboardDuo.feeds).

- フィードの上限を 10 本から 20 本に引き上げ（signboardDuo.feeds）

## [1.0.5] - 2026-11-14

- LED board: the ticker line is now bottom-aligned to the board area, and the page dots ride on the ticker row instead of overlapping its text. Also fixed the README's Open VSX badge URL — a dot in place of a slash between the namespace and the extension name — which had made the badge render as "badge not found"

- LED 盤面：テロップ行を盤面エリアに対して下寄せにし、ページドットをテロップ行に載せて文字と重ならないようにした。あわせて README の Open VSX バッジ URL の誤り（名前空間と拡張機能名の間のスラッシュがドットになっていた）を修正。このためバッジが「badge not found」と表示されていた

## [1.0.4] - 2026-11-14

- Raised the per-feed maxItems limit from 10 to 20.

- フィードごとの maxItems の上限を 10 から 20 に引き上げ

## [1.0.3] - 2026-11-14

- Raised the feed limit from 5 to 10 (signboardDuo.feeds).

- フィードの上限を 5 本から 10 本に引き上げ（signboardDuo.feeds）

## [1.0.2] - 2026-11-14

- README restructured to the Signboard-Solo format: the full document is collected per language (English first, then Japanese), with the same section skeleton in both — header badges and language switcher, table of contents, key features, installation, how to use, starter feeds, finding feeds, commands, settings, requirements, privacy, security, roadmap, developer documentation, licence. Also added the `repository` field to package.json that vsce asked for

- README を Signboard-Solo と同じ形式に再構成：言語ごとに情報を集め（英語→日本語の順）、両言語で同じ節構成にした——ヘッダのバッジと言語切替、目次、主な機能、インストール、使い方、スターターフィード、フィードの探し方、コマンド、設定、動作要件、プライバシー、セキュリティ、ロードマップ、開発者向けドキュメント、ライセンス。あわせて、vsce に指摘されていた package.json の `repository` フィールドを追加した

## [1.0.1] - 2026-11-14

- Repository infrastructure: added the missing package-lock.json and scripts/check-version.js (ported from Signboard-Solo). Without the lockfile, the shared base CI's `npm ci` step and the security scan's `npm audit` step failed on every push. No behaviour changes

- リポジトリ基盤：欠けていた package-lock.json と scripts/check-version.js（Signboard-Solo から移植）を追加。lockfile が無いため、共通 base CI の `npm ci` とセキュリティスキャンの `npm audit` が push のたびに失敗していた。動作の変更はなし

## [1.0.0] - 2026-11-14

- First stable release. The flap board's platform label is now "GATE n" (gate sign) instead of "Runway n / n番滑走路"
- Full English/Japanese localisation, matching the Solo series: package.nls.json / package.nls.ja.json cover the description, view name, every command title and every setting description, the webview boards were already bilingual, and the host-side token messages (needs-token prompt, token input, deletion notice) now follow VS Code's display language too

- 初の安定版リリース。フラップ盤面の番線表示を「N番滑走路／RUNWAY N」から「GATE N」（ゲートの案内板）に変更
- 英語／日本語の両対応を Solo シリーズと同じ形で完備：package.nls.json / package.nls.ja.json で説明文・ビュー名・全コマンド名・全設定説明を切り替え、盤面側は従来どおり両対応、ホスト側のトークン関連メッセージ（要トークンの通知、入力欄、削除通知）も VS Code の表示言語に追従するようにした

## [0.7.8] - 2026-11-14

- README: added a "Finding feeds" guide (where feed URLs hide: icons, /feed/ patterns, GitHub .atom, the page-source trick, Microsoft 365 Roadmap RSS, and why SharePoint list feeds cannot pass Duo's auth) and a "Security" section documenting how feed content is kept inert (hand-rolled parser with no external entities, text-only rendering, strict CSP, http/https-only links, bounded fetches)

- README：「フィードの探し方」（アイコン、/feed/ の型、GitHub の .atom、ページソースで探す方法、Microsoft 365 ロードマップの RSS、SharePoint リストのフィードが Duo の認証では通せない理由）と「セキュリティ」の節を追加し、フィード内容を無力なテキストに留める対策（外部実体を解決しない自前パーサ、テキストのみの描画、厳格な CSP、http/https のみのリンク、取得の上限）を明記した

## [0.7.7] - 2026-11-14

- Flap board: the remark plate now hides entirely when the panel is too narrow for it to fit, instead of staying half-clipped at the right edge. The board measures the plate's right edge against the rows area on every render and hides it the moment it would cross. Same fix as Signboard-Solo 1.9.2

- フラップ盤面：備考プレートが、幅が足りないときに右端で半分切れたまま残らず、丸ごと非表示になるようにした。描画のたびにプレートの右端と行エリアの右端を実測して比べ、はみ出す時点で隠す。Signboard-Solo 1.9.2 と共通の修正

## [0.7.6] - 2026-11-14

- Stock board: plain (non-quote) rows no longer inherit the quote panels' 4-per-page — their pages now hold as many slim rows as the board height fits (up to 12), so a news platform no longer splits across pages with most of the board empty. Quote panels keep 4 per page. The plain row height is learned once from the first rendered row and frozen

- 株価ボード：通常行（株価でない行）が、株価パネルの「1ページ4件」を引き継いでいたのを修正。背の低い通常行は、盤面の高さに収まる件数（最大12件）まで1ページに載せるようにし、ニュースの番線が盤面の大半を空けたままページ分割されなくなった。株価パネルは4件のまま。通常行の高さは最初の1行から一度だけ学んで固定する

## [0.7.5] - 2026-11-14

- Flap board: at mini panel width the 7-segment header clock now hides entirely instead of clipping its left digits (title + clock no longer fit side by side there). The footer items (page info, fetched-at) now wrap as whole units and never split mid-token across lines. Same fix as Signboard-Solo 1.9.1

- フラップ盤面：最小幅（mini）では、右上の7セグ時計が左の桁から見切れる代わりに丸ごと非表示になるようにした（タイトルと時計が横に並びきらないため）。フッターのページ数と最終取得は、途中で割れずに項目ごと折り返すようにした。Signboard-Solo 1.9.1 と共通の修正

## [0.7.4] - 2026-11-14

- Flap board: the remark plate now shows status words only (arrived / updated / suspended). Feed descriptions flipped through it in segments alongside the headline, and two moving texts in one row both demanded reading — the description remains available in the row tooltip, and page rotation no longer waits for remark segments

- フラップ盤面：備考プレートはステータス表示（到着／更新／運休）に徹するよう変更。フィードの概要文が見出しと同時に区切りめくりされると、1行の中で動く文字が2つになってどちらも読まなければと集中できなかった。概要文は行のツールチップで読めるままにし、ページ送りの待ち時間からも備考区切りを外した

## [0.7.3] - 2026-11-14

- Flap board: fixed the page indicator oscillating between the last pages (e.g. 9/10 → 10/10 → 9/10). Two causes: (1) the row height was re-measured from each page's first row, so a pixel of difference changed the page count and clamped the current page back and forth — the height is now learned once per size tier and frozen, and repagination keeps the page holding the row you were looking at; (2) a row stays flagged new until its feed is fetched again, so every unrelated state push jumped back to the same "new" row — jumps now happen only for rows this board has never displayed

- フラップ盤面：ページ表示が末尾で往復する不具合（9/10 → 10/10 → 9/10）を修正。原因は2つ。(1) 行の高さをページごとに先頭行から測り直していたため、1ピクセルの差で総ページ数が変わり、現在ページがクランプで前後していた → 高さはサイズ段ごとに一度だけ学んで固定し、再分割時も見ていた行のあるページに留まるようにした。(2) 新着フラグはそのフィードの次回取得まで残るため、無関係な状態通知のたびに同じ「新着」行へジャンプしていた → ジャンプはこの盤面がまだ表示したことのない行だけに限定した

## [0.7.2] - 2026-11-14

- Stock board: the badge is now just "No trading" — that is the whole point, and it fits any width

- 株価ボード：バッジを「売買できません」だけに短縮（それが要点であり、どの幅でも収まる）

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
