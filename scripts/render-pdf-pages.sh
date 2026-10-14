#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: sh scripts/render-pdf-pages.sh PDF_DIR IMAGE_DIR" >&2
  exit 2
fi

mkdir -p "$2"
rm -f "$2"/book-*.png "$2"/book_print-*.png
for name in book book_print; do
  test -f "$1/$name.pdf"
  pdftoppm -r 144 -png "$1/$name.pdf" "$2/$name"
done
