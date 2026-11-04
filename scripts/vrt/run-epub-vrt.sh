#!/bin/sh
# Invoked inside the read-only-token VRT build container, from the head checkout.
set -eu
sh scripts/setup.sh
apt-get install -y --no-install-recommends imagemagick
uv sync --locked --only-group vrt
# Bootstrap tsx before the runner installs each source with its own lockfile.
npm ci
uv run --locked --only-group vrt node --import tsx scripts/vrt/run-epub-vrt.ts
