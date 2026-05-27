FROM node:18.20.0-alpine3.18 AS base
# 참고 https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED 1

# RUN yarn build

# If using npm comment out above and use below instead
RUN npm run build

# Production image, copy all the files and run next
# Production image, copy all the files and run next
# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Force FFmpeg to use the modern Intel Media Driver
ENV LIBVA_DRIVER_NAME=iHD

#Install the more modern drivers from the community repository
RUN apk update && \
    apk add --no-cache \
    ffmpeg \
    python3 \
    --repository=https://dl-cdn.alpinelinux.org/alpine/v3.18/community \
    intel-media-driver \
    mesa-va-gallium

RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Create groups and users (and handle existing groups gracefully)
RUN addgroup -g ${GID:-1001} nodejs && \
    adduser -u ${UID:-1001} -G nodejs -D nextjs && \
    (addgroup -g 44 video2 || true) && \
    (addgroup -g 107 render2 || true) && \
    addgroup nextjs video2 && \
    addgroup nextjs render2

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]