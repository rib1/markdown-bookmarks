FROM node:26-alpine AS quality
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY eslint.config.js ./
COPY src ./src
COPY templates ./templates
COPY test ./test
COPY e2e/test.mjs ./e2e/test.mjs
COPY extension ./extension
COPY skills ./skills
CMD ["npm", "run", "quality"]

FROM node:26-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY templates ./templates
COPY test ./test
COPY skills ./skills
CMD ["node", "src/server.js"]
