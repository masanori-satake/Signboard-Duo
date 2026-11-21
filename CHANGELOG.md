# Changelog

## [1.18.9] - 2026-11-22

### Fixed

- **Security hardening (defence in depth) from a follow-up audit; no behaviour change for typical setups.**
  - The network layer now enforces an http/https allowlist itself: `fetchOnce` refuses any other protocol at entry and on redirect targets, and the setup form's project / plan / workflow load actions apply the same URL scheme check as the save path.
  - Proxy settings are read from the user (global) values only, mirroring feed definitions: a workspace can no longer route feed traffic through its own proxy, and a workspace-sourced `http.proxyStrictSSL: false` can no longer disable TLS verification.
  - A feed that has an auth type configured and an `http:` URL is now shown as a configuration error instead of sending its token over plaintext HTTP. Remove the auth type (or switch the feed to https) to use an http feed.
  - Webview CSP nonces are generated with `crypto.randomBytes` instead of timestamps and `Math.random`.
  - GitHub repository coordinates are percent-encoded per segment when adapter URLs are built, and repo validation now accepts only the characters GitHub allows in owner/repo names (shared by the feed check and the setup form).
  - `package.json` now declares Workspace Trust support explicitly: feeds come only from user settings and the extension never reads workspace files, so it works the same in Restricted Mode.

### 日本語

- **追補監査に基づく多層防御の硬化を行いました。通常の使い方では動作は変わりません。**
  - ネットワーク層自体が http/https の許可リストを持つようになりました。`fetchOnce` は入口とリダイレクト先の両方でそれ以外のプロトコルを拒否し、セットアップフォームのプロジェクト／プラン／ワークフローの読み込みにも、保存時と同じ URL スキーム検証を追加しました。
  - プロキシ設定はフィード定義と同じ方針で、ユーザー（global）設定の値だけを読むようになりました。ワークスペースがフィード取得を自前プロキシ経由にしたり、ワークスペース由来の `http.proxyStrictSSL: false` で TLS 検証を無効化したりすることはできなくなります。
  - 認証方式が設定されたフィードの URL が `http:` の場合、トークンを平文で送る代わりに設定エラーとして表示するようになりました。http のフィードを使う場合は認証方式を外すか、https に切り替えてください。
  - Webview の CSP nonce を、時刻と `Math.random` ではなく `crypto.randomBytes` で生成するようになりました。
  - GitHub のリポジトリ指定は、アダプタの URL 組み立て時にセグメントごとにパーセントエンコードし、検証も GitHub が owner/repo 名に許可する文字だけに締めました（フィードの検査とセットアップフォームで共用）。
  - `package.json` に Workspace Trust の対応を明記しました。フィードはユーザー設定からしか読まず、ワークスペースファイルには一切アクセスしないため、制限モードでも同じように動作します。

## [1.18.8] - 2026-11-20

### Fixed

- **Saves of the same feed are now serialized.** The edit-save drops the stored token before the settings update and restores it if the update fails (1.18.7); with two saves of one feed running concurrently, the second save could repoint the feed while the first was still awaiting its update, and the first save's restore then put the old server's token back under an id whose settings now pointed at the new server. Saves for the same feed id now run one after another, so each save reads the settings the previous save left behind.

### 日本語

- **同じフィードの保存を直列化しました。** 編集保存は設定の更新前に保存済みトークンを削除し、更新が失敗したら復元します（1.18.7）。同じフィードの保存が並行すると、2回目の保存がフィードを向け替えたあとに1回目の保存の復元が走り、旧サーバーのトークンが新しい接続先の ID に戻ってしまうことがありました。同じフィード ID の保存は順番に実行されるようになり、各保存は直前の保存が残した設定を読みます。

## [1.18.7] - 2026-11-20

### Fixed

- **If saving a repointed feed fails, the dropped token is now restored.** Repointing a feed at another server with the token field left empty drops the stored token before the settings update (1.18.6); when that update was rejected, the settings kept pointing at the old server while its token was already gone, leaving the old feed unable to authenticate until the token was re-entered. The old token is now kept until the update succeeds and restored if the update fails. `TokenStore.delete` is hardened the same way: if its index update fails after the secret is dropped, the secret is put back before the error surfaces. If restoring the token also fails, the user is told to re-enter it instead of failing silently.

### 日本語

- **フィードを向け替えた保存が失敗したとき、削除したトークンを復元するようにしました。** 保存先を別サーバーへ変えてトークン欄を空で保存すると、設定の更新前に保存済みトークンを削除します（1.18.6）。設定の更新が拒否されると、設定は旧サーバーのままトークンだけが消え、旧サーバーのフィードはトークンを再入力するまで認証できない状態でした。削除したトークンは設定の更新が成功するまで保持し、更新が失敗したら復元します。`TokenStore.delete` も同じ作りにし、秘密値を削除した後の索引の更新に失敗した場合は、エラーを返す前に秘密値を戻します。復元自体にも失敗した場合は、黙って失敗せず、トークンの再入力を促す通知を出します。

## [1.18.6] - 2026-11-20

### Fixed

- **Repointing a feed at another server with the token field left empty no longer carries the old server's token over.** Stored tokens are keyed by feed id, not by URL, so an edit-save that changed the destination kept the previous server's token under the same id — where the 1.18.4/1.18.5 fill-in check would then match it against the new server. When an edit-save changes the destination and no new token is typed, the stored token is now deleted before the settings update; if the deletion fails, the save is aborted with an error. Saving with the destination unchanged keeps the stored token, and typing a new token replaces it, as before.

### 日本語

- **フィードを別サーバーへ向け替えてトークン欄を空のまま保存しても、旧サーバーのトークンが引き継がれないようにしました。** 保存済みトークンはフィード ID に紐づいており URL には紐づいていないため、保存先を変える編集保存では旧サーバーのトークンが同じ ID のまま残り、1.18.4／1.18.5 の補完チェックが新サーバーに対して一致してしまう状態でした。保存先が変わり、かつ新しいトークンが入力されていない場合は、設定の更新前に保存済みトークンを削除します。削除に失敗した場合はエラーを出して保存自体を中止します。保存先が同じならトークンは保持され、新しいトークンを入力すれば置き換わる、従来の動作はそのままです。

## [1.18.5] - 2026-11-20

### Fixed

- **After repointing an edited feed at another server, the stored token could still be sent to the old server.** The 1.18.4 change compares the form's base URL against the URL the token was saved for, but the edit form kept comparing against the pre-edit entry: after saving a feed whose URL changed from A to B (with B's token), pointing the form back at A matched the stale entry and B's token was sent to A. The edit form's target is now re-synced to the saved entry on every edit-save, so the comparison always uses the URL that was actually saved.

### 日本語

- **編集したフィードを別サーバーへ向け替えた後、保存済みトークンが旧サーバーへ送られうる問題を直しました。** 1.18.4 の変更は「トークンの保存先 URL」とフォームの URL を比べるものですが、編集フォーム側の比較対象が編集前のエントリのままでした。URL を A から B に変えて B のトークンと一緒に保存した後、フォームを A に戻すと古いエントリに一致してしまい、B のトークンが A へ送られていました。編集保存のたびにフォームの対象を保存済みエントリに同期し直すようにし、比較は常に実際に保存された URL で行われます。

## [1.18.4] - 2026-11-20

### Fixed

- **A feed full of non-matching close tags could freeze the whole editor.** The XML parser matched each close tag by scanning the entire open-element stack, so a feed of n opened elements followed by n closes that match nothing cost quadratic time — measured 81 s at 273 KB, well inside the 1 MB body cap. Open elements are now indexed by name, the match lookup is O(1), and parsing stays linear (the audit shape above now parses in well under a second). Well-formed feeds parse exactly as before.
- **A stored token could be sent to a different server while editing a feed.** When an existing CI feed is edited and the token field is left empty, the setup form fills in the stored token for project / plan / workflow loads. That fill-in now applies only while the form's base URL still names the server the token was saved for; after the form is repointed at another instance, loads go out without the token and a 401 surfaces as an error instead of silently sending the old server's token to the new one.

### 日本語

- **不一致な閉じタグだらけのフィードでエディタ全体が固まる問題を直しました。** XML パーサが閉じタグの対応を探すたびに、開いている要素のスタック全体を走査していたため、「n 個の開始タグ＋対応しない n 個の閉じタグ」で二乗時間になっていました（本文上限 1MB の内側で、273KB で実測 81 秒）。開いている要素を名前で索引化し、対応付けを O(1) にして解析全体を線形に保ちます（上記の形状は1秒未満で解析できます）。正しいフィードの解析結果は従来どおりです。
- **フィード編集中、保存済みトークンが別サーバーへ送られうる問題を直しました。** 既存の CI フィードを編集し、トークン欄を空のままプロジェクト／プラン／ワークフローを読み込むと、保存済みトークンが自動で補われます。この補完は、フォームのベース URL がトークンの保存先サーバーを指している場合に限るようにしました。フォームを別インスタンスへ向け替えた後はトークンなしで読み込み、認証が必要なら 401 がエラーとして表示されます（旧サーバーのトークンが無言で新サーバーへ送られることはありません）。

## [1.18.3] - 2026-11-17

### Fixed

- **Feeds larger than 1 MB (e.g. Think IT) failed with "response too large".** The 1.18.1 change aborted responses at the size cap — but truncation at the cap was load-bearing: feeds are newest-first, so the first 1 MB carries everything the board shows, and such feeds had always worked by reading that prefix. Prefix reading is restored, with the download now stopping at the cap instead of being consumed to the end (an endless body still cannot hold a fetch open), and the log notes once when a feed is being read this way. REST adapter JSON keeps its clear "response too large" error at its own cap, since a truncated JSON body has no usable prefix.

### 日本語

- **1MBを超えるフィード（Think IT など）が「response too large」で失敗する問題を直しました。** 1.18.1 で導入した「上限で打ち切り」が、実は効いていた切り捨てを壊していました。フィードは新しい順なので、先頭1MBに盤面表示に必要なものがすべて入っており、この種のフィードはその接頭辞を読むことで従来から動いていました。接頭辞を読む方式に戻しつつ、ダウンロード自体は上限で止めるようにしました（無限の本文が取得を掴み続けることもありません）。この読み方になったことはログに一度だけ残します。REST アダプタの JSON は接頭辞が使えないため、専用上限での明確なエラーのままにしています。

## [1.18.2] - 2026-11-17

### Fixed

- **GitHub Actions feeds failed with "response too large".** A regression from the audit changes themselves: 1.17.1 widened the run window to 100 (each run is a sizeable JSON object, so a busy repository's listing legitimately exceeds 1 MB), and 1.18.1 then aborted responses at the 1 MB feed cap instead of truncating them. REST adapter responses now have their own 8 MB cap; RSS / Atom feeds keep the 1 MB cap.

### 日本語

- **GitHub Actions のフィードが「response too large」で取得エラーになる問題を直しました。** 監査の変更同士が組み合わさった回帰です：1.17.1 で取得窓を100件に広げた結果（ラン1件の JSON が大きいため、忙しいリポジトリの一覧は正当に1MBを超えます）、1.18.1 で導入した「1MB上限で打ち切り」がそれを止めるようになっていました。REST アダプタの応答には専用の8MB上限を設け、RSS / Atom フィードの1MB上限はそのまま維持します。

## [1.18.1] - 2026-11-17

### Fixed

- More audit hardening, this round from an independent security review of the fetch → parse → render path (no behaviour changes for well-formed feeds and settings):
  - **A single hostile feed could freeze the whole editor.** The XML attribute scanner used a regex that backtracks quadratically on a tag full of word characters with no `=` (measured 33 s at 160 KB; a tag can approach the 1 MB body cap). It is now a linear hand-written scanner. Deeply nested descriptions (~20k levels) no longer overflow the call stack either — the text walk is iterative now.
  - **A REST feed's refresh now has one 30-second budget in total**, instead of a fresh 30 seconds per request in its sequence (a Bamboo project walk could previously stretch to ~10 minutes against a slow server).
  - **Responses past the 1 MB cap are aborted** with a clear "response too large" error instead of being silently truncated into a parse error (or downloaded endlessly until the deadline).
  - **HTTPS → HTTP redirect downgrades are refused** (credentials were already stripped on any origin change; the content now gets the same protection). A feed that truly lives on HTTP can still be configured with its HTTP URL directly.
  - TLS identity checking for proxied HTTPS connections is now stated explicitly against the target host, and a custom auth header name outside the HTTP token grammar is treated as a settings error instead of failing every request.

### 日本語

- 独立したセキュリティレビュー（取得→解析→描画の経路）に基づく堅牢化の続きです（正しいフィードと設定では挙動は変わりません）：
  - **悪意あるフィード1件でエディタ全体が固まる問題を直しました。** XML の属性読み取りに使っていた正規表現が、「= のない長い英字列」を含むタグで二乗時間のバックトラックを起こしていました（160KBで実測33秒。本文上限の1MB近くまで伸ばせました）。線形時間の手書きスキャナに置き換えました。あわせて、約2万段の深い入れ子の説明文でもスタックオーバーフローしないよう、テキスト収集を反復処理に変えました。
  - **REST フィードの取得全体で30秒の予算を1つにしました。** リクエストごとに30秒を数え直していたため、Bamboo のプロジェクト走査が遅いサーバー相手に約10分まで伸びることがありました。
  - **1MB上限を超えた応答は、その場で打ち切ります。** 静かに切り捨てて解析エラーに見せたり、無限の本文を期限まで読み続けたりしません。
  - **HTTPS から HTTP へのリダイレクト（ダウングレード）を拒否します。** 資格情報は従来どおり別オリジンへは渡しませんが、本文についても同じ保護を効かせました。本当に HTTP で運用されているフィードは、HTTP の URL を直接設定すれば従来どおり使えます。
  - プロキシ経由 HTTPS の TLS 本人確認を対象ホストに対して明示し、HTTP のトークン文法に合わないカスタム認証ヘッダ名は、毎回失敗する代わりに設定エラーとして扱うようにしました。

## [1.18.0] - 2026-11-17

### Changed

- **Feeds are now read from your user settings only.** Previously the engine honoured `signboardDuo.feeds` from any settings scope, including a workspace's `.vscode/settings.json` — which travels with a cloned repository. A workspace could therefore add feeds on your machine, and a workspace feed reusing one of your feed ids would have been handed that feed's stored token to send to a workspace-chosen URL. Workspace-defined feeds are now ignored (the ignore is logged), and the setup form, the edit flow and the engine all read the same user-settings list. If you kept feeds in a workspace file, move them to your user settings.

### 日本語

- **フィードはユーザー設定からのみ読むようにしました。** これまではワークスペースの `.vscode/settings.json` を含む全スコープの `signboardDuo.feeds` を読んでいたため、クローンしたリポジトリがフィードを追加できてしまう状態でした。さらに、ワークスペース側のフィードが個人のフィードと同じ `id` を使うと、そのフィードの保存済みトークンがワークスペースの指定した URL へ送られていました。ワークスペースで定義されたフィードは無視し（無視したことはログに残します）、エンジン・設定フォーム・編集の入口すべてが同じユーザー設定のリストを読むように揃えました。ワークスペース側にフィードを置いていた場合は、ユーザー設定へ移してください。

## [1.17.2] - 2026-11-17

### Fixed

- **One hanging feed no longer delays the whole board.** Poll cycles were strictly serial, so a feed that used its full 30-second deadline held up every platform behind it; with several unreachable feeds a cycle could take minutes. Up to four feeds now refresh in parallel (each feed is still handled by exactly one worker, and a server still sees only one request at a time per feed).
- **The board's idle cost is lower.** The per-second change check used to stringify the entire board state; it now digests only the fields a renderer can actually show.

### 日本語

- **応答しないフィードが盤面全体を遅らせる問題を直しました。** 取得は直列だったため、30秒の期限いっぱいまで応答しないフィードがあると、後ろの番線が全部待たされていました（届かないフィードが複数あると、1サイクルに数分かかることも）。最大4フィードまで並行して取得するようにしました（1つのフィードを扱うのは常に1ワーカーだけで、サーバー側から見た同時リクエスト数は変わりません）。
- **盤面の待機時コストを下げました。** 毎秒の変更チェックで盤面全体を文字列化していたのを、描画に必要な項目だけの要約で比べるようにしました。

## [1.17.1] - 2026-11-17

### Fixed

- Hardening from a full audit (no behaviour changes for well-formed settings and feeds):
  - Feed `maxItems` / `keepHours` from settings are now clamped to the documented ranges (1–20 / 1–168), and the LED pitch / hole settings are clamped to their schema ranges before the renderer uses them — the schema ranges alone did not stop a hand-edited settings file.
  - The XML parser no longer lets a stray close tag evict a legitimate parent element (it closes the nearest matching element instead), and numeric character references in the surrogate range are no longer decoded into lone surrogates.
  - The GitHub Actions adapter now reads the widest run window the API allows (100 instead of 30), so a quiet workflow's latest run can no longer be pushed out of the listing — and silently off the board — by a busy repository.

### 日本語

- 全体監査による堅牢化です（正しい設定とフィードでは挙動は変わりません）：
  - 設定の `maxItems` / `keepHours` を、文書化された範囲（1〜20／1〜168）に収めるようにしました。LED のピッチと穴の大きさも、描画側に渡す前にスキーマの範囲へ収めます。スキーマの範囲だけでは、手で編集した設定ファイルを止められなかったためです。
  - XML パーサで、閉じタグの乱れが正規の親要素を巻き込まないようにしました（最も近い一致する要素を閉じます）。サロゲート範囲の数値文字参照を、孤立サロゲートとしてデコードしないようにしました。
  - GitHub Actions アダプタの取得窓を API の上限（30件→100件）に広げました。忙しいリポジトリに押し出されて、静かなワークフローの最新ランが盤面から静かに消えることがなくなります。

## [1.17.0] - 2026-11-17

### Changed

- **Title-bar buttons now all say what happens when you press them.** One convention across the board (and across Signboard-Solo, which adopts the same): a button's glyph and tooltip name the action, never the current state. Edit Feed gets the pencil glyph (it was a checklist); auto-rotation start/stop get play / pause glyphs (both were the same circular arrow, indistinguishable from Refresh and from each other — seeing Play tells you rotation is stopped); the board-style button shows the *next* style's glyph and names it ("Switch to LED Board" / "Switch to Stock Board" / "Switch to Flap Board") instead of showing the style currently on screen.

### 日本語

- **タイトルバーのボタンは、すべて「押すと起きること」を表す形に統一しました。** Signboard-Solo も含めた共通の約束事として、グリフとツールチップは今の状態ではなく、押したときの動作を表します。「フィードを編集」はチェックリストから鉛筆のグリフに変更。自動巡回の開始／停止は再生／一時停止のグリフに変えました（これまでは両方とも同じ円弧の矢印で、「更新」とも見分けがつきませんでした。再生が見えれば、今は止まっていると分かります）。盤面スタイルのボタンは、今表示しているスタイルではなく、切り替え先のグリフと名前（「LED ボードに切り替え」など）を出すようにしました。

## [1.16.0] - 2026-11-17

### Changed

- **The setup form is rebuilt around visible categories.** Each category is now a card with a large heading, a rule under it, and a one-line description of what it decides; field labels are smaller and bolder, hints smaller and lighter and closer to their field, so what belongs where reads at a glance. Categories were also renamed and reworded in Japanese: "Finish" is now "Name and display", the RSS kind is "How the feed is read", the auth choices carry their English terms with a Japanese gloss ("Bearer トークン", "Basic 認証", "カスタムヘッダー", "認証なし") so no mapping has to be guessed, and stiff or over-long hints were rewritten shorter.

### 日本語

- **設定フォームを、カテゴリーが見える形に作り直しました。** カテゴリーごとにカード化し、大きな見出し＋下線＋「ここで決めること」の1行説明を付けました。項目ラベルは小さく太く、ヒントはさらに小さく薄くして対象の欄に寄せ、どこからどこまでが1つのカテゴリーか、どのヒントがどの欄のものかが一目で分かるようにしています。あわせて日本語も見直しました：「仕上げ」は「名前と表示」に、RSS の kind は「RSS の解釈」に改め、認証方式は英語の語を残した「Bearer トークン」「Basic 認証」「カスタムヘッダー」「認証なし」とし、対応関係を考えなくて済む形にしました。硬い・長いヒント類も短く書き直しています。

## [1.15.0] - 2026-11-17

### Changed

- **The setup form's save button is now "Apply changes", and the form stays usable.** Previously the button disabled itself permanently after the first save, so correcting a value meant reopening the form. It is now enabled exactly when there is something unapplied: in the edit form it stays disabled until a field changes, applies, and disables again until the next change. A form that just added a feed becomes that feed's edit form, so a further apply updates it instead of adding a duplicate.
- **"All results" now shows what it contains.** While the all-results news item is checked, every individual news item shows as checked and disabled — all of them are included — and unchecking "all" makes them editable again. Saving still stores `all` on its own.

### 日本語

- **設定フォームの保存ボタンを「設定変更を適用する」に変え、適用後もフォームを使い続けられるようにしました。** 以前は一度保存するとボタンが二度と押せなくなり、値の直しにはフォームの開き直しが必要でした。今は、未適用の変更があるときだけ押せる形です（編集フォームでは変更するまで無効、適用すると再び無効に）。追加した直後のフォームはそのフィードの編集フォームになるので、続けて適用しても重複して追加されることはありません。
- **「全結果」が何を含むかを表示するようにしました。** 「全結果」にチェックが入っている間、個別のニュース項目はすべてチェック済みかつ変更不可で表示されます（全部が含まれているため）。「全結果」のチェックを外すと、個別に編集できる状態に戻ります。保存される値は従来どおり `all` 単独です。

## [1.14.1] - 2026-11-16

### Changed

- Documentation only: completed the English README note for the 1.14.0 news-items row reset (the Japanese note already shipped in 1.14.0). No behaviour changes; this patch also restores the per-commit version-bump check on `main`.

### 日本語

- ドキュメントのみの更新です。1.14.0 のニュース項目リセットについて、英語 README の注記を補いました（日本語の注記は 1.14.0 に含まれています）。動作の変更はありません。あわせて、`main` のコミット単位のバージョンバンプチェックが通る状態に戻しました。

## [1.14.0] - 2026-11-16

### Changed

- **Changing a feed's news items now resets that feed's rows.** `interests` decide which fetched runs become rows, so rows left over from a previous selection used to age out over `keepHours` — which read as "the change did not take" (an all-green board kept showing old successes after switching to `failed` only). The board now rebuilds under the new selection from the next fetch.

### 日本語

- **ニュース項目を変更すると、そのフィードの行をリセットするようにしました。** `interests` は取得したランのうちどれを行にするかを決めるものなので、以前の選択で載った行が `keepHours` いっぱい残り続け、「設定が効いていない」ように見えました（`all` から `failed` のみに変えても、古い成功の行が残る等）。変更後の盤面は、次回の取得から新しい選択だけで組み直されます。

## [1.13.0] - 2026-11-16

### Added

- **Blocked lines and recovery rows**: when a feed cannot be reached twice in a row (name resolution, connection, timeout, proxy, or HTTP 5xx), its platform is shown as **blocked** — LED `不通` / flap `BLOCKED` — with the last known topics, instead of a plain fetch error. Auth, format and other HTTP failures are not treated as blockages. When the feed answers again, one **recovered** row announces it with the blocked duration. The streak survives restarts.
- **Auto-rotation, replacing the pin**: the pin button is gone; one rotate-glyph toggle starts/stops auto-rotation. Each feed has a **Include in auto-rotation** checkbox in its form (`rotate` in settings). Rotation visits opted-in feeds only; moving by hand to an opted-out feed parks the board there, and moving back to an opted-in feed resumes from it. A single opted-in feed means no movement.
- **Delete the stored token inside the edit form**: when a token is stored for the feed being edited, a **Delete the stored token** button sits next to the token field. Delete and re-register without leaving the form — a token swap completes on one screen.
- **Position selector in the feed form**: pick the slot the feed should occupy; the feeds around it shift. Works for both adding and editing.

### Removed

- Commands `signboardDuo.pinPlatform` / `signboardDuo.unpinPlatform` (superseded by `signboardDuo.startRotation` / `signboardDuo.stopRotation`).

### 日本語

- **不通と復旧行**：フィードに2回続けて届かない場合（名前解決・接続・タイムアウト・プロキシ・HTTP 5xx）、その番線を単なる取得エラーではなく **不通**（LED「不通」／フラップ「BLOCKED」）として、前回の到着情報を残して表示します。認証・形式・その他の HTTP 失敗は不通に数えません。フィードが応答を返すと、不通だった時間とともに **復旧** の行が1本出ます。連続失敗の数えは再起動をまたいで保持されます。
- **ピンを廃し、自動巡回に集約**：ピンボタンをなくし、ローテートのグリフのトグル1つで自動巡回を開始／停止します。各フィードのフォームに「自動巡回の対象にする」チェック（設定では `rotate`）を追加。巡回は対象のフィードだけを回り、対象外へ手動で移るとそこで止まり、対象に戻るとそこから再開します。対象が1つだけなら動きません。
- **編集フォームでトークン削除**：編集対象のフィードにトークンが保存されていれば、トークン欄の隣に「保存されているトークンを削除」ボタンが出ます。削除して入れ直すまでがフォームで完結し、トークン交換が1画面で済みます。
- **フォームに順番プルダウン**：フィードの位置を選んで挿入できます（追加・編集の両方）。周りのフィードは前後にずれます。

## [1.12.2] - 2026-11-16

### Changed

- README lead rewritten to foreground what is unique: RSS/Atom feeds and live CI state (GitHub Actions / Bamboo over REST) side by side on one board. Wording unified on "board".
- Feed form polish: the type field is labelled **Feed type** (not "CI type"), the RSS option reads just "RSS", selects and inputs no longer stretch the full form width, and in edit mode the type is shown as fixed text instead of a select that looks changeable.

### 日本語

- README のリードを、RSS/Atom フィードと CI のライブ状態（GitHub Actions / Bamboo を REST で取得）が同じボードに横並びになるという独自性が前に出る文面に書き換えました。用語は「ボード」に統一。
- フォームの調整：種類のラベルを「フィードの種類」に変更、RSS の選択肢は「RSS」とだけ表示、プルダウンや入力欄がフォーム幅いっぱいに伸びないようにし、編集時は種類をプルダウンではなく固定のテキストで表示するようにしました。

## [1.12.1] - 2026-11-16

### Removed

- Dead code from the QuickPick era: `presetInterests` / `catalogFor` in `src/wizard.js` were only used by the retired QuickPick wizard (the form applies presets itself). Audit result: no other leftovers — every declared command is registered, no orphaned localisation keys, and the remaining QuickPick uses are selection-only dialogs (token commands, feed picking), which is what QuickPick is for.

### 日本語

- QuickPick 時代の残骸を除去。`src/wizard.js` の `presetInterests` / `catalogFor` は廃止した QuickPick ウィザード専用だったため削除しました（プリセットの適用はフォーム側が行います）。精査の結果、他の残骸はありませんでした。宣言したコマンドはすべて登録済み、孤児になった文言キーもなし。残っている QuickPick の利用は、トークン系コマンドやフィード選択のような「選ぶだけ」の用途で、これは QuickPick の本来の領分です。

## [1.12.0] - 2026-11-16

### Added

- **Delete from the edit form**: the feed form (in edit mode) ends with a clearly separated **Delete this feed** button. One modal confirmation, then the feed is removed from the settings; if a token was stored for it, the existing flow asks whether to delete that too.

### 日本語

- **編集フォームから削除可能に**。フィードのフォーム（編集時）の末尾に、区切りの下に**このフィードを削除**ボタンを置きました。確認はモーダルで1回。削除は設定から項目を外す形で行い、トークンが保存されていた場合は既存の仕組みが一緒に消すか尋ねます。

## [1.11.1] - 2026-11-16

### Changed

- The feed form's type list now starts with **RSS feed** — the core feed kind — followed by GitHub Actions and Bamboo (REST).

### 日本語

- フィードフォームの種類リストの先頭を、核である **RSS フィード** に変更しました（GitHub Actions、Bamboo (REST) が続きます）。

## [1.11.0] - 2026-11-16

### Added

- **The form now covers every feed**: RSS feeds can be added and edited in the same one-screen form (URL, kind, auth including header auth, max rows, keep hours, enabled), not just CI platforms — no settings.json editing is needed for counts and the like. The edit button now appears for whatever feed is on the board, and the commands were renamed to **Add Feed** / **Edit Feed** to match.

### 日本語

- **フォームが全フィードに対応**。RSS フィードも同じ1画面フォームで追加・編集できるようになりました（URL・kind・認証（ヘッダ認証含む）・最大行数・保持時間・有効/無効）。件数のような設定のために settings.json を書く必要はもうありません。編集ボタンは表示中のフィード全般で現れるようになり、コマンド名も実態に合わせて**フィードを追加**／**フィードを編集**に改称しました。

## [1.10.0] - 2026-11-16

### Added

- **Edit the displayed CI feed in the form**: while the board shows a Bamboo / GitHub Actions feed, the **Change News Items** title-bar button is enabled and opens that feed in the setup form, pre-filled — target, branch scope, news items, name and limits are all editable, and saving updates the feed in place (its token stays attached; the stored token is used to load the lists, so it does not need re-entering). From the Command Palette, the command picks a feed first, then opens the same form.
- **Title-bar layout**: Add CI Feed and Change News Items sit at the far left of the board title bar; the board-style switcher (flap / LED / stock) sits at the far right.

### 日本語

- **表示中の CI フィードをフォームで編集可能に**。盤面が Bamboo / GitHub Actions のフィードを表示している間、タイトルバーの**ニュース項目を変更**ボタンが有効になり、そのフィードを追加時と同じフォームに初期値入りで開きます。対象・ブランチの範囲・ニュース項目・名前・上限をすべて変更でき、保存すると同じフィードがその場で更新されます（トークンは紐づいたまま、一覧の読み込みには保存済みトークンを使うので入れ直し不要）。コマンドパレットから開く場合は、先にフィードを選んでから同じフォームを開きます。
- **タイトルバーの配置**：CI フィードを追加とニュース項目を変更を盤面タイトルバーの一番左へ、表示形式の切り替え（フラップ／LED／株価）を一番右へ配置しました。

## [1.9.0] - 2026-11-16

### Added

- **Board title-bar buttons** for Add CI Feed (+) and Change News Items, next to the board-style and theme buttons — no trip to the Command Palette.

### Changed

- **Add CI Feed is now a one-screen form** instead of a chain of QuickPick / input boxes: every field (connection, target, news items, name) is visible at once, can be filled in any order, and survives leaving VS Code to copy a URL or fetch a token — the form is exactly as you left it when you come back. Pasted browser URLs are trimmed to the base URL / `owner/name` automatically, and the token may be left empty and set later. The command was renamed from "Add CI Platform" to **Add CI Feed** (Japanese: CI フィードを追加): the setup side speaks of feeds, whatever board style renders them.

### Fixed

- **Failed REST runs now show as cancelled**: the board's row status only honoured the failure flag for RSS `ci` feeds, so a failed Bamboo / GitHub Actions run arrived as an ordinary row and was easy to miss. Adapter rows carry the same flag and are now rendered as cancelled (LED) / cancelled flight (flap) too.

### 日本語

- CI フィードを追加（+）とニュース項目を変更を、**盤面のタイトルバーのボタン**としても配置。コマンドパレットを経由せずに開けます。
- **CI フィードを追加を、QuickPick の連鎖から1画面のフォームに変更**。接続・対象・ニュース項目・名前の全項目が同時に見え、順不同で埋められ、URL のコピーやトークンの取得で VS Code を離れて戻ってきても入力がそのまま残ります。ブラウザの URL を貼るとベース URL／`owner/name` に自動で切り詰め、トークンは空のまま保存して後から入れることもできます。あわせてコマンド名を「CI 番線を追加」から「**CI フィードを追加**」に改称。設定側の言葉は、表示形式によらない「フィード」に統一します。

- **REST の失敗実行が「運休」表示にならない問題を修正**。行の状態判定が RSS の `ci` フィードの失敗フラグしか見ておらず、Bamboo / GitHub Actions の失敗が通常の「到着」行として出て気づけませんでした。アダプタの行も同じフラグを持つので、LED では運休、フラップでは欠航として表示します。

## [1.7.0] - 2026-11-16

### Added

- **CI platform setup wizard**: the **Add CI Platform** command sets up a Bamboo / GitHub Actions platform by clicking — API base, auth, target (project / repository, plans / workflows), branch scope and news items — and writes only the resulting entry to the settings, so no JSON editing is needed and the choice persists across restarts. Only news items the chosen adapter can serve are offered, and the token entered during setup is stored as the feed's token.
- **Change News Items (Interests)** command: re-pick what becomes news on an existing REST platform.

### 日本語

- **CI 番線のセットアップウィザード**を追加。**CI 番線を追加**コマンドで、API ベース・認証・対象（プロジェクト／リポジトリ、プラン／ワークフロー）・ブランチの範囲・ニュース項目をクリック操作だけで選ぶと、結果だけが設定に書き込まれます。JSON の手編集は不要で、再起動後もそのまま再現されます。選べるニュース項目は、そのアダプタが提供できるものだけに絞られます。途中で入力したトークンは、そのままその番線のトークンとして保存されます。
- **ニュース項目を変更**コマンドを追加。既存の REST 番線について、何をニュースにするかを選び直せます。

## [1.6.0] - 2026-11-16

- Added: the second REST adapter — **GitHub Actions** (`"type": "github-actions"`), proving the adapter pattern is not Bamboo-specific. A platform targets a repository (`target.repo`), aggregates its workflows (one row per workflow), and can narrow to named workflows and a branch scope (`mainline` / `include` / `only` against the repo's default branch). `interests` works as with Bamboo, and this adapter also serves `queued`. The engine's REST path was generalised so adapters plug into shared transport, auth and diagnosis

- 追加：2つ目の REST アダプタ、**GitHub Actions**（`"type": "github-actions"`）。アダプタ方式が Bamboo 固有でないことの証明。対象はリポジトリ（`target.repo`）で、全ワークフローを集約し（行はワークフロー毎の最新）、ワークフロー名の絞り込みとブランチ範囲（`mainline`／`include`／`only`、デフォルトブランチ基準）が使える。`interests` は Bamboo と同じで、このアダプタは `queued` にも対応。エンジンの REST 経路は、アダプタが取得・認証・診断を共有できる形に一般化した

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
