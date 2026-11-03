# 技術書スターターキット

Vivliostyle で、同じ原稿から通常版 PDF・印刷用 PDF・EPUB を作る最小構成です。PDF の既定の判型は A5 です。

原稿では画像、表、数式、言語指定のコードブロック、Mermaid 図を使えます。[`manuscript/02_examples.md`](manuscript/02_examples.md) にそれぞれの記述例があります。自分の本を作るときは、不要なサンプル章を `vivliostyle.config.js` の `entry` から外してください。

## はじめる

Node.js 24 以上（推奨）、または Node.js 22.13 以上の 22 系と npm を用意し、リポジトリのディレクトリで実行します。

```sh
npm ci
npx playwright install chromium-headless-shell
npm run build
npm run check:pdf
```

通常版 PDF は `output/pdf/book.pdf` に生成されます。`check:pdf` はページの存在と判型を検査するので、PDF を開いて見た目も確認してください。

Playwright の Chromium は Mermaid 図の描画用です。PDF・EPUB で共通のため、形式ごとの再インストールは不要です。

自分の本にするには、次のファイルを編集します。

- `vivliostyle.config.js`: タイトル、著者、判型（`size`）、章順（`entry`）。
- `manuscript/01.md`: 自分の原稿に置き換えます。章を増やすときは `manuscript/` に Markdown ファイルを作り、そのパスを `entry` に読みたい順で追加します。
- `assets/`: 画像。表紙・裏表紙は `assets/front-cover.svg`・`assets/back-cover.svg` です。体裁は PDF 用の `custom.css`、EPUB 用の `epub.css` で調整します。

編集後も `npm run build` と `npm run check:pdf` で確認します。プレビューは `npm run preview`、任意の日本語校正は `npm run lint` です。詳しい執筆手順は [`AGENTS.md`](AGENTS.md) を参照してください。

## EPUB を作る

検証用に [EPUBCheck](https://github.com/w3c/epubcheck) を導入します。Ubuntu / WSL は `sudo apt-get install epubcheck`、ほかの環境は `epubcheck` コマンドを PATH に追加するか、Java と `EPUBCHECK_JAR`（公式 JAR ファイルのパス）を用意します。Windows でも後者を使えます。

```sh
npm run build:epub
npm run check:epub
```

出力先は `output/epub/book.epub` です。EPUBCheck は構造を検証するため、配布前に対象の EPUB リーダーでも目次・日本語・図表・数式を確認してください。

## 印刷用 PDF・全形式を作る

- `npm run build:print`: 表紙・裏表紙を除いたグレースケール PDF を `output/pdf/book_print.pdf` に生成します。Ghostscript と `pdffonts`・`pdfinfo` が必要です。Ubuntu / WSL は `ghostscript`・`poppler-utils` を導入し、Windows は Ghostscript（`gswin64c` または `gswin32c`）と Xpdf または Poppler のコマンドを PATH に追加します。
- `npm run build:all`: 通常版 PDF・印刷用 PDF・EPUB をまとめて生成します。上記の印刷用ツールも必要です。生成後は `npm run check:pdf -- output/pdf/book.pdf output/pdf/book_print.pdf` と `npm run check:epub` で検証します。
- `npm run build:docker`: Docker がある WSL / Linux で全形式の生成・検証をまとめて実行します。印刷用ツールと EPUBCheck はコンテナー内で導入します。

テンプレート本体を変更するときの lint・テスト・描画検証は [`DEVELOPMENT.md`](DEVELOPMENT.md) を参照してください。
