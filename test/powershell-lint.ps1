$ErrorActionPreference = 'Stop'
Import-Module PSScriptAnalyzer -RequiredVersion 1.25.0
$repository = Split-Path -Parent $PSScriptRoot
$settings = Join-Path $repository 'PSScriptAnalyzerSettings.psd1'
$diagnostics = @(
    Invoke-ScriptAnalyzer -Path (Join-Path $repository 'scripts') -Recurse -Settings $settings
    Invoke-ScriptAnalyzer -Path $settings -Settings $settings
    # Test helpers deliberately use native command names and global mock state.
    Invoke-ScriptAnalyzer -Path $PSScriptRoot -Recurse -Settings $settings `
        -ExcludeRule PSUseApprovedVerbs, PSAvoidGlobalVars
)
if ($diagnostics.Count) {
    $diagnostics | Format-Table ScriptName, Line, Severity, RuleName, Message -Wrap | Out-Host
    throw "PowerShell lint failed with $($diagnostics.Count) diagnostic(s)."
}
Write-Output 'PowerShell lint passed (PSScriptAnalyzer 1.25.0).'
