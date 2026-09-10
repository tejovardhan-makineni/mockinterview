FROM node:22-alpine AS build
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
ENV NEXT_PUBLIC_API_BASE=http://localhost:8080 NEXT_PUBLIC_MOCK=0
RUN npm run build

FROM nginx:1.28-alpine
COPY local/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/out /usr/share/nginx/html
EXPOSE 80
