# 開発・検証ガイド

テンプレート本体の設定・スクリプト・CI を変更する人向けのガイドです。本を作るための最小手順は [`README.md`](README.md)、執筆手順は [`AGENTS.md`](AGENTS.md) を参照してください。原稿の編集だけなら lint 専用環境や追加の描画ツールは不要です。

## システム全体を検査する

原稿校正の `npm run lint` とは別に、`npm run lint:system` で出版システムを検査します。本文や文章の内容によって CI が失敗しないよう、原稿・文書・コード例・表紙などの素材は対象にしません。整形や自動修正は行いません。

`npm ci` に加えて、Python 3.10 以上で lint 専用の環境を一度作成します。ShellCheck の配布パッケージは `requirements-lint.txt` で固定しています。PDF・EPUB のビルドだけなら、この追加環境は不要です。

Linux / macOS / WSL:

```sh
python3 -m venv .venv-lint
. .venv-lint/bin/activate
python -m pip install -r requirements-lint.txt
npm run lint:system
npm run test:lint
npm test
```

Windows PowerShell:

```powershell
py -3 -m venv .venv-lint
.\.venv-lint\Scripts\Activate.ps1
python -m pip install -r requirements-lint.txt
npm run lint:system
npm run test:lint
npm test
```

次回も同じ仮想環境を有効にして実行してください。`shellcheck` を PATH から呼び出すため、未導入・未有効の場合も検査をスキップせず失敗します。PowerShell の設定で有効化が禁止されている場合は、設定を変更せず WSL で上の手順を使用できます。

対象はルート直下の設定・スタイル・コードと、`scripts/`・`.github/` 以下のシステム用ファイルです。対象ディレクトリ内の新しいファイルは、次の拡張子なら自動で含まれます。

- `.js` / `.mjs` / `.cjs`: ESLint の推奨ルール。
- `.json`: ESLint の公式 `@eslint/json` で構文・重複キーなどを検査。
- `.yaml` / `.yml`: `eslint-plugin-yml` の推奨ルールで構文・空の値などを検査。GitHub Actions の `on` は YAML 1.2 のキーとして扱います。
- `.css`: 公式 `@eslint/css` で構文・プロパティ・値などを検査。Vivliostyle の脚注構文を許可します。印刷・EPUB 互換のため、ブラウザー Baseline と `!important` の制限は適用しません。
- `.sh`: 既存の ShellCheck で検査。
- `.py`: 既存の Python 環境の `ast.parse` で構文だけを確認。コードの import・実行やキャッシュ作成はしません。Ruff は使いません。意味解析やスタイルの検査ではなく、EPUB レンダラーと描画テストは引き続き別途実行します。

`.github/workflows/` の `run`（bash/sh）と `actions/github-script` の `with.script` も抽出して検査します。前者は ShellCheck、後者は ESLint を使い、スクリプト自体は実行しません。GitHub の `${{ ... }}` は仮の文字列に置き換えます。ログはワークフロー名とジョブ・ステップを示します。JS の行番号は抽出したコードにラッパーの 1 行を加えた番号です。

この検査は GitHub Actions のスキーマ・式・権限・参照先の正しさを検証するものではありません。bash/sh 以外の埋め込み言語はスキップを表示します。複合アクション内のコード、コマンド内で生成するコード、他のアクションに渡すスクリプトは抽出しません。動的な shell 指定も解決しません。これらと PDF・EPUB の動作は、既存のテストとビルドで確認します。

`manuscript/`、README・AGENTS を含む Markdown、`scripts/fixtures/`、`assets/` は対象外です。`node_modules/`、`output/`、`.vivliostyle/`、`tmp/`、`release/`、仮想環境・キャッシュ・Git 管理データも除外し、シンボリックリンクはたどりません。生成される `package-lock.json` は npm ci で整合性を確認します。依存リストの `requirements-lint.txt` は pip のインストールで検証します。SVG・画像・フォントなどの素材や、上記以外の拡張子は言語 lint の対象外です。新しいシステム用ディレクトリや言語を追加する場合は、対象と設定も更新してください。

PR と main の CI では `lint:system` と `test:lint` の失敗をエラーにします。`npm test` は Node.js の回帰テストです。`test:lint` は実際の検査に正常・異常ファイルと除外対象を渡し、本文に依存しないことも確認します。ログには意図的なエラーが出るため、テスト自体の成功・失敗で判定してください。

既存の `lint:code` はルートの JavaScript と `scripts/` 内の JavaScript・シェルだけを検査するコマンドとして残します。原稿校正の `npm run lint` は任意の別コマンドのままです。PR の原稿校正コメントも従来どおりで、原稿の指摘を必須の CI ゲートにはしません。

## EPUB の生成と表示を確認する

メタデータ・章順・表紙は `vivliostyle.config.js`、EPUB の出力設定は `vivliostyle.epub.config.js`、本文の体裁は `epub.css`、表紙の体裁は `epub-cover.css` で調整します。

- PDF・EPUB 共通の `scripts/mermaid.js` は Playwright の Chromium で Mermaid 図を画像化します。README の初期インストールで導入済みなら、EPUB 用に入れ直す必要はありません。
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

MuPDF でも確認する場合は、Python の仮想環境を有効にして次を実行します。

```sh
python -m pip install PyMuPDF==1.26.6
python scripts/render-epub-mupdf.test.py
python scripts/render-epub-mupdf.py output/epub/book.epub output/epub-mupdf
```

これらは実機の読書アプリそのものの検証ではありません。EPUB は画面や文字サイズで本文が流れる形式で、数式・SVG・表・コード・フォント・CSS の表示にはリーダーごとの差があります。出力画像を目視確認し、配布前は対象リーダーでも目次・日本語・図表・数式を確認してください。

## PDF / EPUB のビジュアル回帰テスト

PDF は変更前後の PDF 同士、EPUB は変更前後の EPUB 同士を比較します。
PR に `vrt` ラベルを付けると、既存の PDF 比較と EPUB 比較を実行します。
ラベル付き PR の更新でも再実行します。他のラベルの追加では開始も実行中の比較のキャンセルもしません。
比較元は PR の base と head の merge-base です。それぞれのソースと lockfile で出版物を生成し、
EPUB の描画だけは head 側の同じスクリプト・依存関係・同じコンテナーで両方を処理します。

- EPUB.js 0.3.93 + lockfile の Playwright Chromium / WebKit: 600 × 780px と 360 × 780px、device scale factor 1。
- PyMuPDF 1.26.6 同梱の MuPDF（実際の両バージョンは report.json に記録）: 420 × 595pt と 240 × 595pt、font size 11pt、scale 2。
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
ローカルで実行する場合は ImageMagick、PyMuPDF 1.26.6、Playwright の Chromium / WebKit を用意し、
`node scripts/epub-vrt.integration.js` を実行してください。
