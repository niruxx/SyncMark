# Debian-based (not Alpine): better-sqlite3 is a native module, and prebuilt
# binaries are far more reliably available for glibc than for musl. python3/
# make/g++ are kept as a fallback in case npm has to compile it from source.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server.js"]
