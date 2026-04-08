FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --production
COPY server/ ./
COPY --from=frontend /app/frontend/dist ./public
EXPOSE 3000
CMD ["node", "index.js"]
