# Dot-source this file to make bookmark available in the current PowerShell session.
# Keep this a simple function: CLI options belong to the companion, not PowerShell.
$bookmarkRepository = Split-Path -Parent $PSScriptRoot
Set-Item -Path Function:global:bookmark -Value {
    $bookmarkArguments = @($args)
    $tool = $env:BOOKMARK_CONTAINER_TOOL
    if ([string]::IsNullOrWhiteSpace($tool)) { $tool = 'docker' }
    $tool = $tool.Trim().ToLowerInvariant()

    if ($tool -notin 'docker', 'container', 'wslc', 'native') {
        throw "Unknown BOOKMARK_CONTAINER_TOOL: $tool. Use docker, container, wslc, or native."
    }
    # Prefer the host CLI for browser launches; use existing npm without installing anything.
    # npm.cmd avoids Windows execution-policy restrictions on the npm.ps1 shim.
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
    if ($npmCommand -and $env:BOOKMARK_PREFER_NPM -ne '0' -and
        -not ($tool -eq 'native' -and $env:BOOKMARK_EXECUTABLE)) {
        & $npmCommand --prefix $bookmarkRepository run bookmark '--' @bookmarkArguments
        $global:LASTEXITCODE = $LASTEXITCODE
        return
    }

    switch ($tool) {
        'docker' {
            $service = $env:BOOKMARK_CONTAINER_NAME
            if ([string]::IsNullOrWhiteSpace($service)) { $service = 'bookmarkd' }
            & docker compose --project-directory $bookmarkRepository exec $service node src/cli.js @bookmarkArguments
        }
        { $_ -in 'container', 'wslc' } {
            $containerName = $env:BOOKMARK_CONTAINER_NAME
            if ([string]::IsNullOrWhiteSpace($containerName)) { $containerName = 'markdown-bookmarks' }
            & $tool exec $containerName node src/cli.js @bookmarkArguments
        }
        'native' {
            if ($env:BOOKMARK_EXECUTABLE) {
                & $env:BOOKMARK_EXECUTABLE @bookmarkArguments
            } else {
                & node (Join-Path $bookmarkRepository 'src/cli.js') @bookmarkArguments
            }
        }
    }
    $global:LASTEXITCODE = $LASTEXITCODE
}.GetNewClosure()

. (Join-Path $PSScriptRoot 'bookmark-completion.ps1')
