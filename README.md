# 技術書スターターキット

Vivliostyle による技術書の最小構成です。同じ原稿から通常版 PDF、印刷用 PDF、EPUB を作れます。PDF の既定の判型は A5 です。

原稿では画像、表、数式、言語指定のコードブロック、Mermaid 図を使えます。[`manuscript/02_examples.md`](manuscript/02_examples.md) にそれぞれの記述例があります。自分の本を作るときは、不要なサンプル章を `vivliostyle.config.js` の `entry` から外してください。

この README は使える機能とセットアップ方法を案内します。原稿を編集するときの手順と短い記法例は [`AGENTS.md`](AGENTS.md)、PDF に組版される完成例は [`manuscript/02_examples.md`](manuscript/02_examples.md) を参照してください。

## はじめに

Node.js 22.12 以上と npm を使用します。`vivliostyle.config.js` のタイトル、著者、判型（`size`）、章順を変更し、`manuscript/01.md` を原稿に置き換えてください。章を増やしたら `entry` にファイルを追加します。`npm run check:pdf` は `size` に設定した判型で検証します。

```sh
npm ci
npx playwright install chromium-headless-shell
npm run build
npm run check:pdf
```

通常版は `output/pdf/book.pdf` に生成されます。プレビューは `npm run preview`、共通の体裁の調整は `custom.css` で行います。

原稿の日本語を校正する場合は `npm run lint` を実行します。コードブロック（Mermaid を含む）とブロック数式は校正対象から除外します。

Docker を使う場合は、WSL または Linux で `npm run build:docker` を実行します。通常版と印刷版の PDF を `output/pdf/`、EPUB を `output/epub/` に生成し、両形式を検証します。ローカルで全形式をまとめて作る場合は `npm run build:all` を実行します。印刷用 PDF のツールも必要です。

## 原稿・画像・表紙を編集する

画像などの素材は `assets/` に入れることを推奨します。`manuscript/` の原稿からは `![図の説明](../assets/example.png)` のように参照します。

Mermaid 図は原稿内の `mermaid` コードブロックに直接書きます。ビルド時に画像として描画し、PDF と EPUB に含めます。記述例は [`manuscript/02_examples.md`](manuscript/02_examples.md) を参照してください。

表紙と裏表紙は `assets/front-cover.svg` と `assets/back-cover.svg` にあります。本に合わせて文字と色を編集してください。通常版 PDF には両方を含め、印刷用 PDF からは除外します。

## 印刷用 PDF を作る

印刷用のグレースケール PDF は `npm run build:print` で作成します。Windows でも実行できますが、Ghostscript（`gswin64c` または `gswin32c`）と Xpdf または Poppler の `pdffonts`、`pdfinfo` を PATH に追加してください。Ubuntu や WSL では `ghostscript` と `poppler-utils` をインストールします。出力先は `output/pdf/book_print.pdf` です。

## EPUB を作る

```sh
npm run build:epub
npm run check:epub
```

出力先は `output/epub/book.epub` です。EPUB のビルドは npm と Playwright で行えます。Mermaid 図の描画には Playwright の Chromium が必要です。メタデータ、章順、表紙・裏表紙は `vivliostyle.config.js`、EPUB の出力設定は `vivliostyle.epub.config.js`、体裁は `epub.css` で調整します。表紙・裏表紙の SVG はビルド時に PNG へ自動変換し、`epub-cover.css` で表示を調整します。数式は MathML に変換し、数式用の Latin Modern Math・Temml 字体、コード用の Noto Sans Mono 字体と配色 CSS を EPUB に同梱します。注釈は章末に表示します。数式のために JavaScript や外部サービスへ接続する必要はありません。

検証には公式の [EPUBCheck](https://github.com/w3c/epubcheck) を使います。Ubuntu や WSL では `sudo apt-get install epubcheck` で導入できます。それ以外の環境では公式の配布案内に従い `epubcheck` コマンドを PATH に追加するか、Java をインストールして `EPUBCHECK_JAR` 環境変数に公式 JAR ファイルのパスを設定してください。Windows では Java と `EPUBCHECK_JAR` を利用できます。CI と `build:docker` ではセットアップ時に自動で導入します。

`npm run check:epub` は既定の `output/epub/book.epub` を検証します。別のファイルは `npm run check:epub -- path/to/book.epub` のように指定できます。

EPUB は画面や文字サイズに応じて本文が流れるリフロー形式です。数式、SVG、表、コードブロック、フォントや CSS の表示にはリーダーごとの差があります。配布前に対象の EPUB リーダーで開き、目次からの移動、日本語、図表や数式の表示を確認してください。

`check:epub` は EPUBCheck でパッケージ構造や EPUB 仕様への適合を検証し、エラーがある場合は失敗します。リーダーでの表示確認を置き換えるものではありません。

EPUB.js と Playwright で全ページを確認用の画像にするには、次を実行します。画面幅 600px と 360px の画像と `report.json` を出力し、画像の読み込み失敗、コードや数式のはみ出しなどを検出します。出力画像で表紙・図表・数式を目視確認してください。

```sh
npm run check:epub:render -- output/epub/book.epub output/epub-render
```
