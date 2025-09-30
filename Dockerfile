# syntax=docker/dockerfile:1.6
# Multi-stage build for linux/arm64 (RPi5)

FROM --platform=linux/arm64 node:20-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock* .npmrc* ./
RUN apk add --no-cache python3 make g++ git pkgconfig sqlite-dev && \
	yarn install --frozen-lockfile

FROM --platform=linux/arm64 node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM --platform=linux/arm64 node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN adduser -D -u 10001 nodeusr
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist
COPY drizzle ./drizzle
VOLUME ["/app/data"]
USER nodeusr
EXPOSE 8787
CMD ["node", "dist/index.js"]
