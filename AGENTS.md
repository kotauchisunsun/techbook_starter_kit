# このリポジトリでの作業

Vivliostyle で A5 の技術書を作るためのテンプレートです。原稿は `manuscript/`、画像などの素材は `assets/` に置きます。

## インストール時

1. Node.js 22 以上と Bun 1.4.2 を用意し、`bun install --frozen-lockfile` を実行する。
2. `vivliostyle.config.js` の `title` と `author` を本に合わせて変更する。
3. `bun run build` と `bun run check:pdf` で通常版を確認する。
4. 印刷用 PDF が必要な場合だけ、Ghostscript と `pdffonts`・`pdfinfo` をインストールして `bun run build:print` を実行する。Windows では各コマンドを PATH に追加する。Ubuntu や WSL では `ghostscript` と `poppler-utils` を使う。

## 原稿を追加するとき

1. `manuscript/` に Markdown ファイルを作る。章の順番が分かる名前を付ける。
2. `vivliostyle.config.js` の `entry` にファイルパスを読ませたい順に追加する。目次はここから生成される。
3. `bun run build` と `bun run check:pdf` を実行し、必要に応じて `bun run preview` で改ページや図表の配置を確認する。

## 画像を追加するとき

1. 画像を `assets/` に置き、内容が分かるファイル名を付ける。
2. 原稿から `![図の説明](../assets/example.png)` の形式で参照する。代替テキストには図の内容を書く。
3. `bun run build` で参照切れやページからのはみ出しがないか確認する。印刷用 PDF を作る場合は、グレースケールで図が読めるかも確認する。

生成物の `output/` と `.vivliostyle/`、依存関係の `node_modules/` は編集・コミットしない。
