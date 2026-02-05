
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build:release

EXPOSE 3600

CMD ["npm", "start"]
