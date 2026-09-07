FROM node:20.19.6-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml tsconfig.base.json turbo.json biome.json ./
COPY apps/realtime/package.json ./apps/realtime/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/content/package.json ./packages/content/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/providers/package.json ./packages/providers/package.json
COPY packages/ui/package.json ./packages/ui/package.json

RUN yarn install --immutable

COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN yarn build
RUN cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

FROM node:20.19.6-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_HOME=/corepack
WORKDIR /app

RUN mkdir /corepack \
  && corepack enable \
  && corepack prepare yarn@4.17.1 --activate \
  && useradd --create-home --uid 1001 pushdocs \
  && chown -R pushdocs:pushdocs /corepack

COPY --from=build --chown=pushdocs:pushdocs /app /app

USER pushdocs
EXPOSE 3000 4100
CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]
