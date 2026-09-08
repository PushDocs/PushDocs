# Public synthetic fixture only. Production runtime must match the project's own lockfile.
FROM node:20.19.6-bookworm-slim
WORKDIR /opt/fixture
COPY tests/fixtures/docusaurus/package.json tests/fixtures/docusaurus/yarn.lock ./
COPY output/playwright/yarn-cache /opt/yarn-cache
ENV YARN_CACHE_FOLDER=/opt/yarn-cache
RUN yarn install --offline --frozen-lockfile --ignore-scripts && chmod -R a+rX /opt/yarn-cache
