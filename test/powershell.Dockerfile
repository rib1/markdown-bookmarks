FROM node:26-bookworm-slim AS completion-contract
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY test/completion-contract.js ./test/completion-contract.js
RUN node test/completion-contract.js > /completion-contract.json

FROM mcr.microsoft.com/dotnet/sdk:8.0
RUN ["pwsh", "-NoLogo", "-NoProfile", "-Command", "$ErrorActionPreference = 'Stop'; Install-Module -Name PSScriptAnalyzer -RequiredVersion 1.25.0 -Scope AllUsers -Repository PSGallery -Force -AllowClobber; Import-Module PSScriptAnalyzer -RequiredVersion 1.25.0"]
WORKDIR /app
COPY scripts ./scripts
COPY PSScriptAnalyzerSettings.psd1 ./PSScriptAnalyzerSettings.psd1
COPY test/powershell-lint.ps1 ./test/powershell-lint.ps1
COPY test/powershell-wrapper.test.ps1 ./test/powershell-wrapper.test.ps1
COPY test/powershell-completion.test.ps1 ./test/powershell-completion.test.ps1
COPY test/powershell-completion-contract.test.ps1 ./test/powershell-completion-contract.test.ps1
COPY --from=completion-contract /completion-contract.json ./test/completion-contract.json
CMD ["pwsh", "-NoLogo", "-NoProfile", "-Command", "& /app/test/powershell-lint.ps1; if (-not $?) { exit 1 }; & /app/test/powershell-wrapper.test.ps1; if (-not $?) { exit 1 }; & /app/test/powershell-completion.test.ps1; if (-not $?) { exit 1 }; & /app/test/powershell-completion-contract.test.ps1; if (-not $?) { exit 1 }"]
