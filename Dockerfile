# syntax=docker/dockerfile:1

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

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=10000 \
    HOSTNAME=0.0.0.0 \
    HOME=/tmp

# LibreOffice Writer (no GUI) for DOCX -> PDF, plus metric-compatible fonts
# so Word documents (Calibri, Cambria, Arial, Times) keep their layout.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui \
      fonts-liberation fonts-liberation2 fonts-dejavu-core \
      fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-noto-core \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && soffice --version

# Pre-build LibreOffice's user profile so the first conversion after a deploy
# doesn't pay the profile-initialization cost (~30% of a run on 0.1 CPU).
ENV LO_PROFILE_DIR=/opt/lo-profile
RUN soffice -env:UserInstallation=file://$LO_PROFILE_DIR --headless --norestore --terminate_after_init \
 && test -d $LO_PROFILE_DIR/user \
 && chown -R node:node $LO_PROFILE_DIR

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/fixtures ./fixtures

USER node
EXPOSE 10000
CMD ["node", "server.js"]
