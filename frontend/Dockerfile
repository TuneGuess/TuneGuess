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

# L'image amont suit les correctifs avec du retard : on les applique au build. nginx est figé
# par les modules nginx.org (njs, geoip, xslt, image-filter) à la version exacte : jamais chargés ici, on les
# retire, puis `apk add --upgrade nginx` passe nginx au paquet alpine corrigé (version volontairement non figée).
USER 0
# hadolint ignore=DL3018
RUN apk del --no-cache nginx-module-geoip nginx-module-image-filter nginx-module-njs nginx-module-xslt \
 && apk upgrade --no-cache \
 && apk add --no-cache --upgrade nginx
USER 101

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
