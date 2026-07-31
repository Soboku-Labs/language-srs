# The account API, containerised.
#
# Built from the repository root rather than from this directory, because the
# server depends on `@language-srs/core` through the npm workspace — the same
# source the app and the widgets use. A context of `apps/server` alone would
# resolve that import to nothing.
#
#   docker build -f apps/server/Dockerfile -t language-srs-api .
#   docker run -p 4000:4000 -v $PWD/.data:/data language-srs-api
#
# One image, every host: Render, Fly, Koyeb and Railway all take a Dockerfile,
# so this is the piece that keeps the deployment from being tied to one of them.
FROM node:22-alpine

WORKDIR /app

# The one thing that has to be installed.
#
# The server has no runtime dependencies — node:http, node:crypto, and
# `@language-srs/core`, which is source in this repository. What it does need is
# a way to run TypeScript, and that is tsx. Pinned to the version in the
# lockfile so the image is reproducible.
#
# `npm ci` is deliberately not used here. Installing a single workspace out of a
# graph that also contains an Expo app makes npm fail with "Exit handler never
# called", and the workaround — installing the whole graph — would pull React
# Native into an image that serves JSON.
RUN npm install --global tsx@4.23.1

COPY packages/core packages/core
COPY apps/server apps/server

# What `npm install` would have created for the workspace, made explicitly.
# Without it `@language-srs/core` resolves to nothing: Node walks up from the
# importing file looking for node_modules, and in this image there is none.
RUN mkdir -p node_modules/@language-srs \
 && ln -s ../../packages/core node_modules/@language-srs/core

ENV NODE_ENV=production
ENV PORT=4000
# Mount a volume here to keep accounts across restarts. Without one, the file
# lives in the container's writable layer and goes when the container does —
# see docs/API.md, which says so in the place somebody deploying will read.
ENV DATA_DIR=/data

EXPOSE 4000

# Run as the node user rather than root, and give it the data directory.
RUN mkdir -p /data && chown -R node:node /data
USER node

CMD ["tsx", "apps/server/src/index.ts"]
