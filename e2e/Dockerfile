FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /e2e
COPY e2e/package.json ./package.json
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --no-audit --no-fund
COPY e2e/test.mjs ./test.mjs
COPY e2e/all-tests.sh ./all-tests.sh
COPY extension ./extension
COPY src ./src
COPY test ./test
COPY skills ./skills
CMD ["sh", "-c", "VAULT_PATH=/vault PORT=8787 node src/server.js & xvfb-run -a node test.mjs"]
