# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/
# Railway injects NODE_ENV=production into the build; --include=dev still installs tsc/vite.
RUN npm ci --include=dev --prefix server && npm ci --include=dev --prefix client

COPY server ./server
COPY client ./client
RUN npm run build --prefix client && npm run build --prefix server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S dnos && adduser -S dnos -G dnos \
  && mkdir -p /data \
  && chown dnos:dnos /data

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

USER dnos
ENV DATA_DIR=/data
ENV PORT=3847
EXPOSE 3847

CMD ["node", "server/dist/index.js"]
