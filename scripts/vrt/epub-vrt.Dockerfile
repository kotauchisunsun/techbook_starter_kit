# Match the existing VRT OS/Node environment; only add the pinned uv binary.
FROM ghcr.io/astral-sh/uv:0.13.4 AS uv
FROM node:24-trixie-slim
COPY --from=uv /uv /uvx /usr/local/bin/
# Never reuse a host checkout's virtual environment inside the container.
ENV UV_PROJECT_ENVIRONMENT=/tmp/epub-vrt-python
