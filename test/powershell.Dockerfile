FROM mcr.microsoft.com/dotnet/sdk:8.0
WORKDIR /app
COPY scripts/bookmark.ps1 ./scripts/bookmark.ps1
COPY test/powershell-wrapper.test.ps1 ./test/powershell-wrapper.test.ps1
CMD ["pwsh", "-NoLogo", "-NoProfile", "-File", "test/powershell-wrapper.test.ps1"]
