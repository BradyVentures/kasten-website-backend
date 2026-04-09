FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/package.json ./

RUN mkdir -p uploads/originals uploads/results

EXPOSE 4000
CMD ["node", "dist/index.js"]
