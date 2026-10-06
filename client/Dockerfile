FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
RUN npm ci --workspace client --include-workspace-root
COPY shared shared
COPY client client
ARG VITE_COLYSEUS_URL
ENV VITE_COLYSEUS_URL=$VITE_COLYSEUS_URL
RUN npm run client:build

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
