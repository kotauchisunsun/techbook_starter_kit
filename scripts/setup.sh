#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends fontconfig fonts-ipafont fonts-noto-cjk poppler-utils ghostscript unzip
