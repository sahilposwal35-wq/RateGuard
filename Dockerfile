FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY console/ ./console/

RUN npm run build

CMD ["node", "dist/server.js"]
