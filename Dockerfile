FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4001
WORKDIR /app
RUN apk add --no-cache poppler-utils

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src

EXPOSE 4001
CMD ["bun", "src/index.ts"]
