# Dot-source this file to make bookmark available in the current PowerShell session.
# Keep this a simple function: CLI options belong to the companion, not PowerShell.
$bookmarkRepository = Split-Path -Parent $PSScriptRoot
Set-Item -Path Function:global:bookmark -Value {
    $bookmarkArguments = @($args)
    $tool = $env:BOOKMARK_CONTAINER_TOOL
    if ([string]::IsNullOrWhiteSpace($tool)) { $tool = 'docker' }
    $tool = $tool.Trim().ToLowerInvariant()

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
        default {
            throw "Unknown BOOKMARK_CONTAINER_TOOL: $tool. Use docker, container, wslc, or native."
        }
    }
    $global:LASTEXITCODE = $LASTEXITCODE
}.GetNewClosure()
