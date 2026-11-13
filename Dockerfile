FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    AURALIS_PORT=4317 \
    AURALIS_DATA_DIR=/home/auralis/.auralis

RUN addgroup -S auralis && adduser -S auralis -G auralis \
    && mkdir -p /home/auralis/.auralis \
    && chown -R auralis:auralis /home/auralis /app

COPY --from=deps --chown=auralis:auralis /app/node_modules ./node_modules
COPY --from=builder --chown=auralis:auralis /app/dist ./dist
COPY --from=builder --chown=auralis:auralis /app/server ./server
COPY --from=builder --chown=auralis:auralis /app/package.json ./package.json

USER auralis

EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.AURALIS_PORT || 4317) + '/', { method: 'HEAD' }).then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["./node_modules/.bin/tsx", "server/index.ts"]
