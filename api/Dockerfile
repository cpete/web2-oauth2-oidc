FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3001
EXPOSE 3001

USER node
CMD ["node", "server.js"]
