# 開発・検証ガイド

テンプレート本体の設定・スクリプト・CI を変更する人向けのガイドです。本を作るための最小手順は [`README.md`](README.md)、執筆手順は [`AGENTS.md`](AGENTS.md) を参照してください。原稿の編集だけなら uv や追加の描画ツールは不要です。

## テンプレート本体を変更する

Node.js の回帰テストを実行し、PDF・EPUB の生成と検証を確認します。全形式のビルドには README に記載した印刷用ツールと EPUBCheck が必要です。

```sh
npm test
npm run build:all
npm run check:pdf -- output/pdf/book.pdf output/pdf/book_print.pdf
npm run check:epub
```

`npm run lint` は原稿の日本語校正です。コードブロック（Mermaid を含む）とブロック数式は対象外で、出版システムのコードを検査するコマンドではありません。

## scripts の構成

- `scripts/epub/`: EPUB の生成・検証・描画と、表示確認用の `fixtures/`。
- `scripts/pdf/`: PDF の検証・ページ画像化。
- `scripts/vrt/`: PDF / EPUB の画像比較、比較の実行と結果の集約。
- `scripts/ci/`: PR artifact の通知、VRT 結果の投稿、ワークフローと構成の回帰テスト。
- `scripts/mermaid.ts` と `scripts/setup.sh`: PDF / EPUB 共通の図の処理と環境セットアップ。

ユニットテストは対象のスクリプトと同じディレクトリに置き、`npm test` で `scripts/**/*.test.{js,ts}` をまとめて実行します。公開している npm コマンドは変わりません。

## scripts のコードを検査する

`npm run lint:code` は `scripts/` 配下の実装コードと既存テストコードを検査します。JavaScript / TypeScript は ESLint、シェルは ShellCheck を使います。独自のファイル探索やワークフロー解析は行いません。自動整形・修正もしません。

[uv の公式手順](https://docs.astral.sh/uv/getting-started/installation/)で uv 0.13.4 以上を導入し、`npm ci` の後に実行します。Linux・macOS・WSL・Windows PowerShell で同じコマンドを使えます。

```sh
npm run lint:code
npm run typecheck
```

Python は `.python-version` の 3.12 系、ShellCheck と PyMuPDF は `pyproject.toml` と `uv.lock` で管理します。npm の検証コマンドは `uv run --locked` を使い、必要な Python と依存関係を `.venv/` に自動で準備します。仮想環境を手動で有効にする必要はありません。

開発用の依存関係をまとめて準備する場合は `uv sync --locked` を使います。`lint` グループが ShellCheck、`vrt` グループが MuPDF 描画用です。依存を更新するときは `pyproject.toml` の変更後に `uv lock` を実行し、両ファイルをコミットしてください。CI は lockfile の不整合で失敗し、自動では更新しません。Dependabot の Python 依存更新にも `vrt` ラベルを付けて描画を検証します。

通常の PDF・EPUB ビルドには uv は不要です。`.venv/` はコミットしません。

- `lint:js`: ESLint が `scripts/` の `.js` / `.mjs` / `.cjs` / `.ts` を検査します。`*.test.ts`・`*.integration.ts` と、JavaScript の同名テストも含めます。lint 自体の動作確認テストは追加しません。`scripts/epub/fixtures/` の例と、`scripts/` 内の依存関係・生成物は除外します。
- `lint:shell`: `scripts/setup.sh`・`scripts/pdf/render-pdf-pages.sh`・`scripts/vrt/run-epub-vrt.sh` を ShellCheck に直接渡します。シェルを追加したら、このコマンドの対象にも追加してください。Windows でもワイルドカード展開に依存しません。
- ルートの設定 JS・CSS、JSON・YAML、CI 内の埋め込みコード、Python は対象外です。原稿・文書・コード例・素材・生成物も対象にしません。Ruff は不要です。

TypeScript は `scripts/tsconfig.json` の strict / noEmit で実装とテストを検査します。移行中の JavaScript やルート設定は型検査の対象にしません。実行は tsx に任せ、事前コンパイルやグローバルインストールは不要です。型検査と実行テストは別々に維持します。ルートの Vivliostyle 設定は編集しやすい JavaScript のまま維持します。`scripts/` の JavaScript は tsx を登録する `register-typescript.js` だけです。設定はこの共通入口を読み込んだ後、`await import()` で TypeScript 実装を直接読み込みます。個別の JS ラッパーは置きません。静的な TS import はローダー登録前に解決されるため使いません。`npx vivliostyle` に追加のローダー指定は不要で、Node.js 22.13 でも同じ実装・モジュールキャッシュを共有します。

書き込み権限を持つVRTレポーターだけは、`actions/github-script@v9` のNode.js 24による型除去でヘルパーを直接読み込みます。信頼済みのworkflow SHAからscriptsだけを取得し、npm installやtsxを必要としない境界を維持します。TypeScriptは型除去可能な構文に制限し、この依存なし読み込みも回帰テストで検証します。

PR と main の CI で Node.js 22.13.0 / 24 の `typecheck`・`lint:code`・回帰テストを実行します。ビルド・EPUB 描画・既存回帰テストは別に維持します。原稿校正の `npm run lint` は任意の別機能です。

## 依存関係のセキュリティ更新

`package.json` の対象範囲付き overrides は、影響する系列の `glob` を 14.0.3、`minimatch` を 11.0.4 に固定しています。対応する advisory は [glob の走査キャンセル不備](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) と [minimatch のパターン展開による DoS](https://github.com/advisories/GHSA-g3hv-75wg-m249) です。上流の依存指定が修正版を採用したら、overrides を外せるか確認してください。

Node.js 22.13.0 に同梱される npm 10.9.2 の Arborist は、overrides の対象範囲を置換後の `edge.spec` でも再評価します（npm 11.9.0 は置換前の `edge.rawSpec` を使います）。修正版が範囲外だと一部の依存で override が外れ、`npm ci` が lockfile 不整合になります。このため範囲の上限には固定先の 14.0.3 / 11.0.4 も含めています。脆弱性の影響範囲が広がったという意味ではなく、glob 7 と minimatch 3 / 5 は引き続き対象外です。

2026-11-04 更新の GitHub advisory は minimatch の影響範囲を `>=7.0.0 <11.0.1` に限定しています。このため `readdir-glob` の minimatch 5.1.9 と、`shelljs` の glob 7 経由の minimatch 3.1.5 は維持しています。旧 API を壊す一括更新や監査の抑制は行いません。更新後の npm audit は 0 件です。新しい advisory が出た場合は再評価してください。

PyMuPDF は 2.1 に更新しています。[CVE-2026-3029](https://github.com/advisories/GHSA-cxqh-p2w9-fmr7) の修正だけでなく、[公式変更履歴](https://pymupdf.readthedocs.io/en/latest/changes.html) が 2.0 での修正を示す CVE-2026-82035 も含めるためです。どちらも CLI のファイル抽出に関する問題で、このリポジトリの描画スクリプトはその機能を呼び出しません。描画エンジンも更新されるため、依存更新時は既存の EPUB VRT を実行します。

## EPUB の生成と表示を確認する

メタデータ・章順・表紙は `vivliostyle.config.js`、EPUB の出力設定は `vivliostyle.epub.config.js`、本文の体裁は `epub.css`、表紙の体裁は `epub-cover.css` で調整します。

- PDF・EPUB 共通の `scripts/mermaid.ts` は Playwright の Chromium で Mermaid 図を画像化します。README の初期インストールで導入済みなら、EPUB 用に入れ直す必要はありません。
- 表紙・裏表紙の SVG はビルド時に PNG へ変換します。編集するのは `assets/front-cover.svg`・`assets/back-cover.svg` などの元画像です。
- 数式は MathJax の TeX 字体を使った SVG に変換し、上付き文字・分数・根号・複数行の配置を保持します。長い単純な数式は演算子の位置で折り返せます。
- 本文用の Noto Sans JP、コード用の Noto Sans Mono と配色 CSS を同梱し、注釈は章末に表示します。読書時の数式表示には JavaScript や外部サービスへの接続は不要です。

生成される `assets/epub-generated/`・`output/`・`.vivliostyle/` と、依存関係の `node_modules/` は編集・コミットしません。

`npm run check:epub` は既定の EPUB を公式 EPUBCheck で検証し、エラーがあれば失敗します。別のファイルは `npm run check:epub -- path/to/book.epub` のように指定します。CI と `build:docker` は EPUBCheck を自動導入します。

### 全ページを画像で確認する

EPUB.js と Playwright で幅 600px・360px の全ページ画像と `report.json` を出力します。画像の読み込み失敗や、コード・数式のはみ出しなどを確認できます。Chromium は初期セットアップのものを使います。

```sh
npm run build:epub
npm run check:epub
npm run check:epub:render -- output/epub/book.epub output/epub-render
```

Linux / WSL で Chromium の OS 依存ライブラリが不足する場合は、`npx playwright install --with-deps chromium-headless-shell` を実行します。

WebKit でも確認する場合だけ、追加のブラウザーを導入します。

```sh
npx playwright install --with-deps webkit
npm run check:epub:render -- output/epub/book.epub output/epub-render-webkit --browser=webkit
```

MuPDF でも確認する場合は、uv を導入して次を実行します。PyMuPDF は lockfile のバージョンが自動で使われます。

```sh
npm run test:python
npm run check:epub:mupdf -- output/epub/book.epub output/epub-mupdf
```

これらは実機の読書アプリそのものの検証ではありません。EPUB は画面や文字サイズで本文が流れる形式で、数式・SVG・表・コード・フォント・CSS の表示にはリーダーごとの差があります。出力画像を目視確認し、配布前は対象リーダーでも目次・日本語・図表・数式を確認してください。

## PDF / EPUB のビジュアル回帰テスト

PDF は変更前後の PDF 同士、EPUB は変更前後の EPUB 同士を比較します。

PR に `vrt` ラベルを付けると、既存の PDF 比較と EPUB 比較を実行します。
ラベル付き PR の更新でも再実行します。他のラベルの追加では開始も実行中の比較のキャンセルもしません。
比較元は PR の base と head の merge-base です。それぞれのソースと lockfile で出版物を生成し、
EPUB の描画だけは head 側の同じスクリプト・依存関係・同じコンテナーで両方を処理します。

- EPUB.js 0.3.93 + lockfile の Playwright Chromium / WebKit: 600 × 780px と 360 × 780px、device scale factor 1。
- PyMuPDF 2.1 同梱の MuPDF（実際の両バージョンは report.json に記録）: 420 × 595pt と 240 × 595pt、font size 11pt、scale 2。
- ImageMagick で sRGB に正規化した AE 比較を行い、色差の fuzz 4%、各ページ 100 pixels 以下を許容します。異なるリーダー同士は比較しません。
- 完了レポート、リーダーバージョン、全ページ、PNG の実寸を検証します。ページ数変更は差分です。
  比較元に EPUB ビルド機能がない、描画が途中で止まった、画像が欠けた場合は失敗であり「差分なし」にはなりません。
  本文依存のはみ出し・コード配色の診断は描画レポートに残しますが、VRT は本文内容を固定する検査ではありません。

失敗時の画像 artifact に PDF と EPUB の before / after / diff、各リーダーの描画レポートを保存します。
EPUB の画像は `epub/{before,after,diff}/{chromium,webkit,mupdf}/{幅}x{高さ}/` にあります。
保持期間は 7 日、既存の PR artifact 削除規則も維持します。
コメント投稿は引き続き default branch の信頼済み reporter だけが行い、PR の実行には書き込み権限を付与しません。
workflow 名とコメント識別子は互換性のため旧 PDF 名を維持します。新しい EPUB のコメント表示対応は reporter の main へのマージ後に有効です。

`Test EPUB visual comparison` CI は原稿とは独立した小さな EPUB を実際に各リーダーで二度描画し、
同一内容が成功すること、24px の検証用テキストの文字色を黒から赤へ意図的に変更した EPUB が画像差分で失敗することを確認します。
ローカルで実行する場合は uv、ImageMagick、Playwright の Chromium / WebKit を用意し、
`npm run test:vrt` を実行してください。CI の EPUB 比較コンテナーも同じ lockfile を使い、
ホストの `.venv/` と混ざらない一時環境で両方の EPUB を描画します。
