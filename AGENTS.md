# AGENTS.md

このファイルは、本リポジトリで作業を行うAIエージェント向けの開発・運用ガイドラインです。

## 📌 バージョン更新およびリリースルール（必須）

コードやドキュメント（VSIXに含まれる全ファイル）に修正・機能拡張・不具合修正を行う際、**必ず適切なバージョン昇格（インクリメント）を行うこと**。

- **マイナーバージョン (`X.Y.Z` -> `X.(Y+1).0`)**: 新機能の追加、既存機能の拡張、仕様変更
- **パッチバージョン (`X.Y.Z` -> `X.Y.(Z+1)`)**: 不具合修正、軽微なUI調整、`README.md` などのパッケージ包含ドキュメントの更新

※例外：`.vscode/`, `.github/`, `scripts/`, `.gitignore` 等のVSIXパッケージ外の開発用設定・ドキュメントのみの更新は昇格不要。

`package.json` の `version` と `CHANGELOG.md`（`## [X.Y.Z] - YYYY-MM-DD` 見出し、英語の箇条書きの後に日本語の要約、Keep a Changelog 式）を揃えること。

## 🔒 設計原則（Duo の約束）

- **読み取り専用連携**： ネットワーク通信は、利用者が設定したフィード URL へのポーリング（GET）のみ。送信・トラッキング・テレメトリは行わない。
- **トークンは SecretStorage**： フィードの認証情報は settings.json に書かせない。設定には方式（none/bearer/basic/header）だけを置き、実物はコマンド経由で SecretStorage に保管する。
- **フィードは最大20件**： 番線は20本まで。1フィードの失敗が他の番線や本体を止めない。
- **依存ゼロ**： 実行時依存パッケージを持たない。バニラ JS と VS Code API のみ（ビルド工程なし）。
- **軽さ**： ポーリングはタイマー1本に集約し、条件付き取得（ETag / Last-Modified）を使う。非表示時は描画しない。

## 🏗️ プロジェクト構成

- `src/extension.js` — 拡張ホスト：フィードエンジン（取得・認証・差分検出）、Webview プロバイダ、コマンド
- `src/model.js` — 純粋モジュール：番線・行の組み立て、新着／更新検出、保持期限、番線の状態判定
- `src/feedparse.js` — 純粋モジュール：RSS 1.0 / RSS 2.0 / Atom の正規化パーサ（外部実体は解決しない）
- `src/net.js` — 純粋モジュール：取得層（直接／プロキシ経由、CONNECT トンネル、絶対期限、失敗の症状分類）
- `media/board.js` / `board.css` — フラップ盤面（Signboard-Solo から fork）
- `media/led.js` / `led.css` — LED盤面（マスク方式、Signboard-Solo から fork）
- `media/stock.js` / `stock.css` — 株価盤面（区画ごとに役割と色を分ける証券ボード方式。kind: "stock" の JSON 相場フィード用）
- `test/` — `src/model.js` / `src/feedparse.js` の単体テスト（node:test、実フィードのフィクスチャ）

## ⚙️ 開発コマンド

```bash
npm run check        # 全 JS の構文チェック
npm test             # node --test
npm run package      # VSIX 生成（vsce）
```

## 📝 コーディング規約

- 言語はバニラ JavaScript（CommonJS）。ビルドなしで `src/extension.js` がそのまま動く。
- `src/model.js` と `src/feedparse.js` は `vscode` に依存させない（単体テスト可能に保つ）。
- README / CHANGELOG の体裁は Solo シリーズ共通の型に従う（英語→日本語）。
