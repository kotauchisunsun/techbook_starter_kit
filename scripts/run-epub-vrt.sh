#!/bin/sh
# Invoked inside the read-only-token VRT build container, from the head checkout.
set -eu
sh scripts/setup.sh
apt-get install -y --no-install-recommends imagemagick python3-venv
python3 -m venv /tmp/epub-vrt-python
/tmp/epub-vrt-python/bin/pip install PyMuPDF==1.26.6
node scripts/run-epub-vrt.js
