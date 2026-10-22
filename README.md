# 技術書スターターキット

Vivliostyle による技術書の最小構成です。既定の判型は A5 です。

原稿では画像、表、数式、言語指定のコードブロック、Mermaid 図を使えます。`manuscript/02_examples.md` にそれぞれの記述例があります。自分の本を作るときは、不要なサンプル章を `vivliostyle.config.js` の `entry` から外してください。

この README は使える機能とセットアップ方法を案内します。原稿を編集するときの手順と短い記法例は `AGENTS.md`、PDF に組版される完成例は `manuscript/02_examples.md` を参照してください。

Node.js 22.12 以上と npm を使用します。`vivliostyle.config.js` のタイトル、著者、判型（`size`）、章順を変更し、`manuscript/01.md` を原稿に置き換えてください。章を増やしたら `entry` にファイルを追加します。`npm run check:pdf` は `size` に設定した判型で検証します。

```sh
npm ci
npx playwright install chromium-headless-shell
npm run build
npm run check:pdf
```

通常版は `output/pdf/book.pdf` に生成されます。プレビューは `npm run preview`、共通の体裁の調整は `custom.css` で行います。

原稿の日本語を校正する場合は `npm run lint` を実行します。コードブロック（Mermaid を含む）とブロック数式は校正対象から除外します。

Docker を使う場合は、WSL または Linux で `npm run build:docker` を実行します。通常版と印刷版の PDF を `output/pdf/` に生成します。

画像などの素材は `assets/` に入れることを推奨します。`manuscript/` の原稿からは `![図の説明](../assets/example.png)` のように参照します。

Mermaid 図は原稿内の `mermaid` コードブロックに直接書きます。ビルド時に PDF 用の画像として描画します。記述例は `manuscript/02_examples.md` を参照してください。

表紙と裏表紙は `assets/front-cover.svg` と `assets/back-cover.svg` にあります。本に合わせて文字と色を編集してください。通常版 PDF には両方を含め、印刷用 PDF からは除外します。

印刷用のグレースケール PDF は `npm run build:print` で作成します。Windows でも実行できますが、Ghostscript（`gswin64c` または `gswin32c`）と Xpdf または Poppler の `pdffonts`、`pdfinfo` を PATH に追加してください。Ubuntu や WSL では `ghostscript` と `poppler-utils` をインストールします。出力先は `output/pdf/book_print.pdf` です。

GitHub Actions は push 用の `build.yml` と pull request 用の `pr.yml` に分かれています。pull request では PDF ビルドとは別に textlint を実行し、校正の指摘があってもビルドを続けます。Docker 版のビルドも実行します。同じリポジトリ内のブランチから作った pull request には、textlint の結果と通常版・印刷版 PDF のリンクを固定コメントで案内します。`main` への push でビルドが成功すると、日時付きの通常版と印刷版を GitHub Release に公開します。

Dependabot の pull request では、更新前後の PDF の表示を比較します。差分があれば CI が失敗し、該当ページと画像一式へのリンクを固定コメントで案内します。

PR でアップロードする通常版・印刷版 PDF と、Dependabot の表示比較で失敗した際の画像一式は、アップロードから 3 日間保持します。PR を閉じた際の削除処理は引き続き有効です。期限切れまたは削除後は、コメント内の Artifact リンクからファイルを取得できなくなります。この保持期間は新しくアップロードする Artifact に適用され、既存の Artifact や手動実行の保持期間は変更しません。

PR の PDF は、アップロード時のみ `pr-<PR番号>-pdf.pdf` と `pr-<PR番号>-print-pdf.pdf` にコピーします。ZIP 化せず直接 PDF をダウンロードできる動作と、ビルド元の `book.pdf` / `book_print.pdf` は維持します。PR を閉じると、その PR 番号を含む完全一致名の Artifact のみ削除します。従来の PR 番号付き ZIP・比較画像も対象です。他 PR と区別できない既存の `book.pdf` / `book_print.pdf` は推測で削除せず、元の保持期限に任せます。PR を閉じた時点の一覧取得後にアップロードされた Artifact は、この終了時処理では削除されず、3 日の保持期限で失効します。
