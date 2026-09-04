FROM node:26-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY test ./test
COPY skills ./skills
CMD ["node", "src/server.js"]
