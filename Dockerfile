# ──────────────────────────────────────────────────────────────
# IGFlow — Production Dockerfile (multi-stage)
# ──────────────────────────────────────────────────────────────

# ── مرحله ۱: وابستگی‌ها ───────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── مرحله ۲: بیلد ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# مقادیر ساختگی فقط برای عبور از اعتبارسنجی env در زمان بیلد.
# مقادیر واقعی در زمان اجرا از محیط خوانده می‌شوند.
ENV AUTH_JWT_SECRET="build-time-placeholder-value-min-32-chars-long"
ENV TOKEN_ENCRYPTION_KEY="YnVpbGQtdGltZS1wbGFjZWhvbGRlci0zMmJ5dGVz"
ENV NODE_ENV=production

RUN npm run build

# ── مرحله ۳: اجرا ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# اجرا با کاربر غیر-root
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=deps    /app/node_modules  ./node_modules
COPY --from=builder /app/.next         ./.next
COPY --from=builder /app/public        ./public
COPY --from=builder /app/package.json  ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

# لازم برای worker و اسکریپت‌های مهاجرت (با tsx اجرا می‌شوند)
COPY --from=builder /app/src           ./src
COPY --from=builder /app/scripts       ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
