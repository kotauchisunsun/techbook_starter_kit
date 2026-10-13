# 技術書スターターキット

Vivliostyle による A5 技術書の最小構成です。

Node.js 22.12 以上と npm を使用します。`vivliostyle.config.js` のタイトル、著者、章順を変更し、`manuscript/01.md` を原稿に置き換えてください。章を増やしたら `entry` にファイルを追加します。

```sh
npm ci
npm run build
npm run check:pdf
```

通常版は `output/pdf/book.pdf` に生成されます。プレビューは `npm run preview`、共通の体裁の調整は `custom.css` で行います。

画像などの素材は `assets/` に入れることを推奨します。`manuscript/` の原稿からは `![図の説明](../assets/example.png)` のように参照します。

印刷用のグレースケール PDF は `npm run build:print` で作成します。Windows でも実行できますが、Ghostscript（`gswin64c` または `gswin32c`）と Xpdf または Poppler の `pdffonts`、`pdfinfo` を PATH に追加してください。Ubuntu や WSL では `ghostscript` と `poppler-utils` をインストールします。出力先は `output/pdf/book_print.pdf` です。表紙を追加する場合は通常版の `entry` に cover エントリを追加します。印刷用設定は cover エントリを除外します。
