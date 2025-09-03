FROM node:18-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# create tmp dir for torrent storage
RUN mkdir -p /app/tmp && chown -R node:node /app/tmp
EXPOSE 3000
USER node
CMD ["node", "server.js"]
