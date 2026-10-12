$ErrorActionPreference = 'Stop'

function Assert-Equal($actual, $expected, $label) {
    if (($actual | ConvertTo-Json -Compress) -cne ($expected | ConvertTo-Json -Compress)) {
        throw "$label failed: actual=$($actual | ConvertTo-Json -Compress) expected=$($expected | ConvertTo-Json -Compress)"
    }
}

# Mock only runtime executables; exercise the real wrapper and PowerShell binding.
function global:docker { $global:invocation = @('docker') + $args; $global:LASTEXITCODE = 23; 'runtime output' }
function global:container { $global:invocation = @('container') + $args; $global:LASTEXITCODE = 23; 'runtime output' }
function global:wslc { $global:invocation = @('wslc') + $args; $global:LASTEXITCODE = 23; 'runtime output' }
function global:node { $global:invocation = @('node') + $args; $global:LASTEXITCODE = 23; 'runtime output' }
function global:testCompanion { $global:invocation = @('testCompanion') + $args; $global:LASTEXITCODE = 23; 'runtime output' }

$repository = Split-Path -Parent $PSScriptRoot
. (Join-Path $repository 'scripts/bookmark.ps1')
# Invoking from another directory must still select this repository's Compose file.
Set-Location /tmp
$env:BOOKMARK_CONTAINER_TOOL = ''
$env:BOOKMARK_CONTAINER_NAME = ''
$output = bookmark find 'amiga music' --saved-within week
Assert-Equal $global:invocation @('docker', 'compose', '--project-directory', $repository, 'exec', 'bookmarkd', 'node', 'src/cli.js', 'find', 'amiga music', '--saved-within', 'week') 'Docker forwarding'
Assert-Equal $output 'runtime output' 'Output forwarding'
Assert-Equal $LASTEXITCODE 23 'Exit code forwarding'

foreach ($tool in @('container', 'wslc')) {
    $env:BOOKMARK_CONTAINER_TOOL = $tool
    $env:BOOKMARK_CONTAINER_NAME = ''
    bookmark save --title 'Quoted "title"; $(literal)' --url 'https://example.test/?a=1&b=2' | Out-Null
    Assert-Equal $global:invocation @($tool, 'exec', 'markdown-bookmarks', 'node', 'src/cli.js', 'save', '--title', 'Quoted "title"; $(literal)', '--url', 'https://example.test/?a=1&b=2') "$tool forwarding"
    $env:BOOKMARK_CONTAINER_NAME = 'custom-name'
    bookmark | Out-Null
    Assert-Equal $global:invocation @($tool, 'exec', 'custom-name', 'node', 'src/cli.js') "$tool custom name and empty arguments"
}

$env:BOOKMARK_CONTAINER_TOOL = 'native'
$env:BOOKMARK_EXECUTABLE = ''
bookmark vault init --path '/tmp/Vault with spaces' | Out-Null
Assert-Equal $global:invocation @('node', (Join-Path $repository 'src/cli.js'), 'vault', 'init', '--path', '/tmp/Vault with spaces') 'Native prototype forwarding'
$env:BOOKMARK_EXECUTABLE = 'testCompanion'
bookmark open '--' -alpha | Out-Null
Assert-Equal $global:invocation @('testCompanion', 'open', '--', '-alpha') 'Standalone executable forwarding'
Assert-Equal (Get-Location).Path '/tmp' 'Caller directory preserved'

# Verify actual native-process argument serialization and nonzero exit handling.
$env:BOOKMARK_EXECUTABLE = '/bin/sh'
$output = bookmark -c 'printf "%s\n" "$@"; exit 17' fixture 'with spaces' 'literal "$(not code)"' '' '--'
Assert-Equal $output @('with spaces', 'literal "$(not code)"', '', '--') 'Native process argument boundaries'
Assert-Equal $LASTEXITCODE 17 'Native process exit code'

$env:BOOKMARK_CONTAINER_TOOL = 'unknown'
$rejected = $false
try { bookmark help } catch { $rejected = $_.Exception.Message -like 'Unknown BOOKMARK_CONTAINER_TOOL:*' }
Assert-Equal $rejected $true 'Unknown runtime rejected'
Write-Output 'PowerShell wrapper tests passed.'
