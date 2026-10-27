FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/app.db
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
