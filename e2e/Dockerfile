FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /e2e
COPY package.json ./package.json
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN node -e "let v = ''; try { v = '@' + JSON.parse(require('fs').readFileSync('/ms-playwright/.docker-info', 'utf8')).driverVersion; } catch {} require('child_process').execSync('npm install --no-audit --no-fund @playwright/test' + v, { stdio: 'inherit' });"
COPY e2e/test.mjs ./test.mjs
COPY e2e/all-tests.sh ./all-tests.sh
COPY extension ./extension
COPY src ./src
COPY templates ./templates
COPY test ./test
COPY skills ./skills
CMD ["sh", "-c", "VAULT_PATH=/vault PORT=8787 node src/server.js & xvfb-run -a node test.mjs"]
