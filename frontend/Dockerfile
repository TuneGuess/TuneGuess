FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# Image sans root : nginx tourne en utilisateur non privilégié et écoute sur 8080.
FROM nginxinc/nginx-unprivileged:1.30-alpine

# L'image amont suit les correctifs alpine avec du retard : on les applique au build.
USER root
RUN apk upgrade --no-cache
USER 101

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
