FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/app/data/promoflow.db

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "src/server.js"]