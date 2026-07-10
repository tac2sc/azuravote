FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /data && chown -R node:node /app /data

EXPOSE 3099
VOLUME ["/data"]

CMD ["sh", "-c", "mkdir -p /data && chown -R node:node /data && su node -s /bin/sh -c 'npm start'"]
