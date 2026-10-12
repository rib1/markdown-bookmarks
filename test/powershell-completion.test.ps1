$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
. (Join-Path $repository 'scripts/bookmark.ps1')
# Completion must never invoke the companion or a runtime executable.
function global:docker { throw 'Completion invoked Docker' }
function global:container { throw 'Completion invoked container' }
function global:wslc { throw 'Completion invoked WSLc' }
function global:node { throw 'Completion invoked Node' }
function global:npm { throw 'Completion invoked npm' }

function Complete($line, $cursor = $line.Length) {
    @((TabExpansion2 -inputScript $line -cursorColumn $cursor).CompletionMatches | ForEach-Object { $_.CompletionText })
}
function Assert-Completion($line, $expected) {
    $results = @(Complete $line)
    foreach ($item in $expected) {
        if ($results -notcontains $item) { throw "Missing '$item' for '$line': $($results -join ', ')" }
    }
}
function Assert-NoCompletion($line, $unexpected) {
    $results = @(Complete $line)
    foreach ($item in $unexpected) {
        if ($results -contains $item) { throw "Unexpected '$item' for '$line'" }
    }
}

Assert-Completion 'bookmark ' @('find', 'open', 'save', 'vault', 'project', 'help')
Assert-Completion 'bookmark va' @('vault')
Assert-Completion 'bookmark vault sta' @('status')
Assert-Completion 'bookmark vault ' @('init', 'git-help', 'tag-fix')
Assert-Completion 'bookmark project ' @('create', 'list', 'note', 'open')
Assert-Completion 'bookmark project note ' @('add', 'remove')
Assert-Completion 'bookmark project note remove talk abc --p' @('--pick')
Assert-NoCompletion 'bookmark project note remove talk abc --' @('--note', '--with')
Assert-Completion 'bookmark vault tag-lint --' @('--full', '--check', '--help')
Assert-NoCompletion 'bookmark vault status --' @('--full', '--check', '--apply')
Assert-Completion 'bookmark save --' @('--url', '--title', '--tags', '--shared-by', '--via')
Assert-Completion 'bookmark find amiga --saved-w' @('--saved-within')
Assert-Completion 'bookmark find --saved-within ' @('day', 'week', 'month', 'year')
Assert-Completion 'bookmark find --saved-within w' @('week')
Assert-Completion 'bookmark find --saved-within=w' @('--saved-within=week')
Assert-Completion 'bookmark open amiga --with f' @('firefox')
Assert-Completion 'bookmark open amiga --with=fi' @('--with=firefox')
Assert-Completion 'bookmark find "amiga music" --browser --' @('--with', '--dry-run')
Assert-NoCompletion 'bookmark find "amiga music" --browser --' @('--browser', '--expand')
Assert-NoCompletion 'bookmark find amiga --' @('--with', '--dry-run')
Assert-NoCompletion 'bookmark find amiga --expand --' @('--browser', '--with', '--dry-run')
Assert-NoCompletion 'bookmark find amiga --saved-within week --' @('--saved-within', '--saved-since')
Assert-Completion 'bookmark find amiga --saved-within week --' @('--fuzzy')
Assert-NoCompletion 'bookmark find amiga --saved-since 2026-01-01 --' @('--saved-within', '--saved-since')
Assert-Completion 'bookmark help va' @('vault')
Assert-Completion 'bookmark help vault sta' @('status')
Assert-NoCompletion "bookmark find '--' --" @('--browser', '--help', '--fuzzy')
# Completing in the middle of an edited command ignores tokens after the cursor.
$line = 'bookmark find amiga --saved-w --fuzzy'
$results = @(Complete $line $line.IndexOf(' --fuzzy'))
if ($results -notcontains '--saved-within') { throw 'Cursor-aware completion failed' }
# Registration is repeatable when the user reloads their profile.
. (Join-Path $repository 'scripts/bookmark.ps1')
Assert-Completion 'bookmark vault sta' @('status')
Write-Output 'PowerShell completion tests passed.'
