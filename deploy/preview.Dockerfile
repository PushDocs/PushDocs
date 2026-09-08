FROM docker:28-cli AS docker-cli
FROM node:20.19.6-bookworm-slim
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
RUN corepack enable
COPY . .
RUN yarn install --immutable
CMD ["yarn", "workspace", "@pushdocs/preview", "start"]
