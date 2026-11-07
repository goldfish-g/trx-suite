# Builds the page, then runs the server with only its own dependencies.
# Mount the data (catalog.json, game archives, flyby levels, engine builds)
# at /data; see data/README.md. The build needs the converter submodule
# checked out (git submodule update --init).

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STATIC_DIR=/app/dist
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && rm -rf /root/.cache /root/.local/share/pnpm
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
EXPOSE 8080
VOLUME /data
USER node
CMD ["node", "server/src/main.ts"]
