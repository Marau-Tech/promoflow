FROM node:20-alpine

RUN apk add --no-cache tzdata

WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/app/data/promoflow.db \
    TZ=America/Sao_Paulo

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "src/server.js"]