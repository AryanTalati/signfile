# syntax=docker/dockerfile:1

# ---- os: system tools shared by runtime and the scripts/test toolbox ----
FROM node:22-bookworm-slim AS os
# LibreOffice Writer (no GUI) for DOCX -> PDF; qpdf to strip permission-only
# encryption from PDFs; metric-compatible fonts so Word documents (Calibri,
# Cambria, Arial, Times) keep their layout.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui qpdf \
      fonts-liberation fonts-liberation2 fonts-dejavu-core \
      fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-noto-core \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && soffice --version && qpdf --version | head -1
# Pre-build LibreOffice's user profile so the first conversion after a deploy
# doesn't pay the profile-initialization cost (~30% of a run on 0.1 CPU).
ENV LO_PROFILE_DIR=/opt/lo-profile \
    HOME=/tmp
RUN soffice -env:UserInstallation=file://$LO_PROFILE_DIR --headless --norestore --terminate_after_init \
 && test -d $LO_PROFILE_DIR/user \
 && chown -R node:node $LO_PROFILE_DIR

# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- tools: LibreOffice + qpdf + full source, for scripts (detection eval) ----
#   docker build --target tools -t signfile:tools .
#   docker run --rm -v "$PWD/fixtures:/app/fixtures" signfile:tools npx tsx scripts/eval-detection.ts
FROM os AS tools
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ---- runtime (default target; what Render builds) ----
FROM os AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=10000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# pdf.js loads its worker and @napi-rs/canvas dynamically, which Next's file
# tracing misses: ship both packages whole.
COPY --from=deps --chown=node:node /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
COPY --from=deps --chown=node:node /app/node_modules/@napi-rs ./node_modules/@napi-rs
COPY --from=build --chown=node:node /app/fixtures ./fixtures

USER node
EXPOSE 10000
CMD ["node", "server.js"]
