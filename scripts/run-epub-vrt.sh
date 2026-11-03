#!/bin/sh
# Invoked inside the read-only-token VRT build container, from the head checkout.
set -eu
sh scripts/setup.sh
apt-get install -y --no-install-recommends imagemagick
uv sync --locked --only-group vrt
uv run --locked --only-group vrt node scripts/run-epub-vrt.js
