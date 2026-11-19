FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
# npm et corepack ne servent qu'à l'installation : retirés de l'image finale (leurs dépendances ont des CVE)
RUN npm ci --omit=dev \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=builder /app/dist ./dist
# DATA_DIR du compose : un volume nommé vide reprend le propriétaire de ce dossier
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

USER 1000:1000

CMD ["node", "dist/server.js"]
