$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
. (Join-Path $repository 'scripts/bookmark-completion.ps1')
$contract = Get-Content -Raw (Join-Path $PSScriptRoot 'completion-contract.json') | ConvertFrom-Json

function Assert-SameSet($label, $actual, $expected) {
    $actualSet = @($actual | Sort-Object -Unique)
    $expectedSet = @($expected | Sort-Object -Unique)
    if (($actualSet | ConvertTo-Json -Compress) -cne ($expectedSet | ConvertTo-Json -Compress)) {
        throw "Completion drift for ${label}: PowerShell=[$($actualSet -join ', ')] JavaScript=[$($expectedSet -join ', ')]. Update scripts/bookmark-completion.ps1."
    }
}
Assert-SameSet 'top-level commands' $bookmarkCommands $contract.commands
Assert-SameSet 'vault commands' $bookmarkVaultCommands $contract.vaultCommands
Assert-SameSet 'project commands' $bookmarkProjectCommands $contract.projectCommands
Assert-SameSet 'command option scopes' $bookmarkOptions.Keys $contract.options.PSObject.Properties.Name
foreach ($property in $contract.options.PSObject.Properties) {
    Assert-SameSet "$($property.Name) options" $bookmarkOptions[$property.Name] $property.Value
}
Assert-SameSet 'value-taking options' $bookmarkValueOptions $contract.valueOptions
Assert-SameSet 'saved-within values' $bookmarkValues['--saved-within'] $contract.periods
$platform = if ($IsMacOS) { 'darwin' } elseif ($env:OS -eq 'Windows_NT') { 'win32' } else { 'linux' }
Assert-SameSet 'browser aliases' $bookmarkValues['--with'] $contract.browsers.$platform

. (Join-Path $repository 'scripts/bookmark.ps1')
function Completions($line) {
    @((TabExpansion2 -inputScript $line -cursorColumn $line.Length).CompletionMatches | ForEach-Object { $_.CompletionText })
}
Assert-SameSet 'project note subcommands' (Completions 'bookmark project note ') $contract.noteCommands
foreach ($case in $contract.completionCases) {
    Assert-SameSet $case.line (Completions $case.line) $case.expected
}

# Prove the drift check detects both added and removed flags and changed value types.
$original = $bookmarkOptions['find']
foreach ($mutated in @(@($original + '--fake-option'), @($original | Where-Object { $_ -ne '--fuzzy' }))) {
    $caught = $false
    try { Assert-SameSet 'mutation' $mutated $contract.options.find } catch { $caught = $_.Exception.Message -like 'Completion drift*' }
    if (-not $caught) { throw 'Drift check failed to reject a changed option list' }
}
$caught = $false
try { Assert-SameSet 'mutation' (@($bookmarkValueOptions) + '--fuzzy') $contract.valueOptions } catch { $caught = $true }
if (-not $caught) { throw 'Drift check failed to reject a changed option type' }
Write-Output 'PowerShell/JavaScript completion consistency tests passed.'
