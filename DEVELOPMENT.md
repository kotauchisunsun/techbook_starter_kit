# 開発・検証ガイド

## PDF / EPUB のビジュアル回帰テスト

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
同一内容が成功すること、背景色を意図的に変更した EPUB が画像差分で失敗することを確認します。
ローカルで実行する場合は ImageMagick、PyMuPDF 1.26.6、Playwright の Chromium / WebKit を用意し、
`node scripts/epub-vrt.integration.js` を実行してください。
