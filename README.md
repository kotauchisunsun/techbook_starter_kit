# 技術書スターターキット

Vivliostyle による技術書の最小構成です。同じ原稿から通常版 PDF、印刷用 PDF、EPUB を作れます。PDF の既定の判型は A5 です。

原稿では画像、表、数式、言語指定のコードブロック、Mermaid 図を使えます。[`manuscript/02_examples.md`](manuscript/02_examples.md) にそれぞれの記述例があります。自分の本を作るときは、不要なサンプル章を `vivliostyle.config.js` の `entry` から外してください。

この README は使える機能とセットアップ方法を案内します。原稿を編集するときの手順と短い記法例は [`AGENTS.md`](AGENTS.md)、PDF に組版される完成例は [`manuscript/02_examples.md`](manuscript/02_examples.md) を参照してください。

## はじめに

Node.js 24 以上（推奨）、または Node.js 22.13 以上の 22 系と npm を使用します。`vivliostyle.config.js` のタイトル、著者、判型（`size`）、章順を変更し、`manuscript/01.md` を原稿に置き換えてください。章を増やしたら `entry` にファイルを追加します。`npm run check:pdf` は `size` に設定した判型で検証します。

```sh
npm ci
npx playwright install chromium-headless-shell
npm run build
npm run check:pdf
```

通常版は `output/pdf/book.pdf` に生成されます。プレビューは `npm run preview`、共通の体裁の調整は `custom.css` で行います。

原稿の日本語を校正する場合は `npm run lint` を実行します。コードブロック（Mermaid を含む）とブロック数式は校正対象から除外します。

Docker を使う場合は、WSL または Linux で `npm run build:docker` を実行します。通常版と印刷版の PDF を `output/pdf/`、EPUB を `output/epub/` に生成し、両形式を検証します。ローカルで全形式をまとめて作る場合は `npm run build:all` を実行します。印刷用 PDF のツールも必要です。

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
```

Windows PowerShell:

```powershell
py -3 -m venv .venv-lint
.\.venv-lint\Scripts\Activate.ps1
python -m pip install -r requirements-lint.txt
npm run lint:system
npm run test:lint
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

出力先は `output/epub/book.epub` です。EPUB のビルドは npm と Playwright で行えます。Mermaid 図の描画には Playwright の Chromium が必要です。メタデータ、章順、表紙・裏表紙は `vivliostyle.config.js`、EPUB の出力設定は `vivliostyle.epub.config.js`、体裁は `epub.css` で調整します。表紙・裏表紙の SVG はビルド時に PNG へ自動変換し、`epub-cover.css` で表示を調整します。数式は MathJax の TeX 字体を使った SVG に変換し、上付き文字・分数・根号・複数行の配置を保存します。長い単純な数式は演算子の位置で折り返せます。本文用の Noto Sans JP、コード用の Noto Sans Mono 字体と配色 CSS を EPUB に同梱します。注釈は章末に表示します。数式のために JavaScript や外部サービスへ接続する必要はありません。

検証には公式の [EPUBCheck](https://github.com/w3c/epubcheck) を使います。Ubuntu や WSL では `sudo apt-get install epubcheck` で導入できます。それ以外の環境では公式の配布案内に従い `epubcheck` コマンドを PATH に追加するか、Java をインストールして `EPUBCHECK_JAR` 環境変数に公式 JAR ファイルのパスを設定してください。Windows では Java と `EPUBCHECK_JAR` を利用できます。CI と `build:docker` ではセットアップ時に自動で導入します。

`npm run check:epub` は既定の `output/epub/book.epub` を検証します。別のファイルは `npm run check:epub -- path/to/book.epub` のように指定できます。

EPUB は画面や文字サイズに応じて本文が流れるリフロー形式です。数式、SVG、表、コードブロック、フォントや CSS の表示にはリーダーごとの差があります。配布前に対象の EPUB リーダーで開き、目次からの移動、日本語、図表や数式の表示を確認してください。

`check:epub` は EPUBCheck でパッケージ構造や EPUB 仕様への適合を検証し、エラーがある場合は失敗します。リーダーでの表示確認を置き換えるものではありません。

EPUB.js と Playwright で全ページを確認用の画像にするには、次を実行します。画面幅 600px と 360px の画像と `report.json` を出力し、画像の読み込み失敗、コードや数式のはみ出しなどを検出します。出力画像で表紙・図表・数式を目視確認してください。

```sh
npm run check:epub:render -- output/epub/book.epub output/epub-render
```

WebKit でも確認する場合は `npx playwright install --with-deps webkit` の後、同じコマンドの末尾に `--browser=webkit` を付けます。MuPDF の EPUB 描画でも確認できます。Python に `PyMuPDF==1.26.6` を導入して `python scripts/render-epub-mupdf.py output/epub/book.epub output/epub-mupdf` を実行すると、全ページの画像と警告・配置情報を出力します。これらは実機の読書アプリそのものの検証ではありません。
