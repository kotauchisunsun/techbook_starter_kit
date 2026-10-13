# 技術書スターターキット

Vivliostyle による A5 技術書の最小構成です。

原稿では画像、表、数式、言語指定のコードブロック、Mermaid 図を使えます。`manuscript/02_examples.md` にそれぞれの記述例があります。自分の本を作るときは、不要なサンプル章を `vivliostyle.config.js` の `entry` から外してください。

この README は使える機能とセットアップ方法を案内します。原稿を編集するときの手順と短い記法例は `AGENTS.md`、PDF に組版される完成例は `manuscript/02_examples.md` を参照してください。

Node.js 22.12 以上と npm を使用します。`vivliostyle.config.js` のタイトル、著者、章順を変更し、`manuscript/01.md` を原稿に置き換えてください。章を増やしたら `entry` にファイルを追加します。

```sh
npm ci
npx playwright install chromium-headless-shell
npm run build
npm run check:pdf
```

通常版は `output/pdf/book.pdf` に生成されます。プレビューは `npm run preview`、共通の体裁の調整は `custom.css` で行います。

画像などの素材は `assets/` に入れることを推奨します。`manuscript/` の原稿からは `![図の説明](../assets/example.png)` のように参照します。

Mermaid 図は原稿内の `mermaid` コードブロックに直接書きます。ビルド時に PDF 用の画像として描画します。記述例は `manuscript/02_examples.md` を参照してください。

表紙と裏表紙は `assets/front-cover.svg` と `assets/back-cover.svg` にあります。本に合わせて文字と色を編集してください。通常版 PDF には両方を含め、印刷用 PDF からは除外します。

印刷用のグレースケール PDF は `npm run build:print` で作成します。Windows でも実行できますが、Ghostscript（`gswin64c` または `gswin32c`）と Xpdf または Poppler の `pdffonts`、`pdfinfo` を PATH に追加してください。Ubuntu や WSL では `ghostscript` と `poppler-utils` をインストールします。出力先は `output/pdf/book_print.pdf` です。

GitHub Actions は push と pull request で両方の PDF をビルドして確認します。`main` への push でビルドが成功すると、日時付きの通常版と印刷版を GitHub Release に公開します。
