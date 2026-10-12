# Static, offline completion for the simple bookmark forwarding function.
$bookmarkCommands = @('find', 'open', 'save', 'vault', 'project', 'help')
$bookmarkVaultCommands = @('init', 'skill-install', 'status', 'git-help', 'open', 'tag-lint', 'tag-fix')
$bookmarkProjectCommands = @('create', 'list', 'show', 'add', 'remove', 'move', 'note', 'open')
$bookmarkOptions = @{
    'find' = @('--saved-within', '--saved-since', '--fuzzy', '--expand', '--browser', '--with', '--dry-run')
    'open' = @('--pick', '--saved-within', '--saved-since', '--fuzzy', '--with', '--dry-run')
    'save' = @('--url', '--title', '--tags', '--shared-by', '--via')
    'vault init' = @('--path')
    'vault skill-install' = @('--path')
    'vault status' = @()
    'vault git-help' = @('--full')
    'vault open' = @('--dry-run')
    'vault tag-lint' = @('--full', '--check')
    'vault tag-fix' = @('--from', '--to', '--apply')
    'project create' = @('--title', '--id', '--status', '--contexts', '--tags', '--purpose', '--notes')
    'project list' = @()
    'project show' = @()
    'project add' = @('--note')
    'project remove' = @()
    'project move' = @('--to')
    'project note' = @('--note')
    'project note add' = @('--note')
    'project note remove' = @('--pick')
    'project open' = @('--with', '--dry-run')
}
$bookmarkValueOptions = @('--saved-within', '--saved-since', '--with', '--pick', '--url', '--title',
    '--tags', '--shared-by', '--via', '--path', '--from', '--to', '--id', '--status', '--contexts',
    '--purpose', '--notes', '--note')
$bookmarkValues = @{
    '--saved-within' = @('day', 'week', 'month', 'year')
    '--with' = @('chrome', 'edge', 'firefox', 'brave')
}
if ($IsMacOS) { $bookmarkValues['--with'] += 'safari' }

Register-ArgumentCompleter -Native -CommandName bookmark -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    # Parse the shell AST; never evaluate input or split quoted queries on spaces.
    $completionStart = $cursorPosition - $wordToComplete.Length
    $tokens = @($commandAst.CommandElements | Select-Object -Skip 1 | Where-Object {
        $_.Extent.EndOffset -le $completionStart
    } | ForEach-Object {
        if ($_ -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $_.Value }
        else { $_.Extent.Text }
    })
    $positionals = @()
    $usedOptions = @()
    $pendingValue = $null
    foreach ($token in $tokens) {
        if ($token -eq '--') { return }
        if ($pendingValue) { $pendingValue = $null; continue }
        if ($token.StartsWith('-')) {
            $option = ($token -split '=', 2)[0]
            $usedOptions += $option
            if ($bookmarkValueOptions -contains $option -and -not $token.Contains('=')) {
                $pendingValue = $option
            }
        } else { $positionals += $token }
    }

    $inlinePrefix = ''
    $prefix = $wordToComplete
    if ($wordToComplete -match '^(--[^=]+)=(.*)$') {
        $pendingValue = $Matches[1]
        $inlinePrefix = "$pendingValue="
        $prefix = $Matches[2]
    }
    $candidates = @()
    if ($pendingValue) {
        # Leave free-text values and paths to PowerShell's normal completion.
        if ($bookmarkValues.ContainsKey($pendingValue)) { $candidates = $bookmarkValues[$pendingValue] }
    } else {
        if ($positionals.Count -gt 0 -and $positionals[0] -eq 'help') {
            $positionals = @($positionals | Select-Object -Skip 1)
        }
        if ($positionals.Count -eq 0) {
            $candidates = $bookmarkCommands
            if ($prefix.StartsWith('-')) { $candidates = @('--help', '-h') }
        } elseif ($positionals[0] -in 'vault', 'project' -and $positionals.Count -eq 1) {
            if ($positionals[0] -eq 'vault') { $candidates = $bookmarkVaultCommands }
            else { $candidates = $bookmarkProjectCommands }
            if ($prefix.StartsWith('-')) { $candidates = @('--help', '-h') }
        } else {
            $key = $positionals[0]
            if ($key -in 'vault', 'project') { $key += ' ' + $positionals[1] }
            if ($key -eq 'project note' -and $positionals.Count -ge 3 -and $positionals[2] -in 'add', 'remove') {
                $key += ' ' + $positionals[2]
            }
            if ($bookmarkOptions.ContainsKey($key) -and ($prefix -eq '' -or $prefix.StartsWith('-'))) {
                $candidates = @($bookmarkOptions[$key]) + @('--help', '-h')
                $candidates = @($candidates | Where-Object { $usedOptions -notcontains $_ })
                if ($usedOptions -contains '--saved-since') { $candidates = @($candidates | Where-Object { $_ -ne '--saved-within' }) }
                if ($usedOptions -contains '--saved-within') { $candidates = @($candidates | Where-Object { $_ -ne '--saved-since' }) }
                if ($key -eq 'find') {
                    if ($usedOptions -notcontains '--browser') {
                        $candidates = @($candidates | Where-Object { $_ -notin '--with', '--dry-run' })
                    }
                    if ($usedOptions -contains '--browser') { $candidates = @($candidates | Where-Object { $_ -ne '--expand' }) }
                    if ($usedOptions -contains '--expand') { $candidates = @($candidates | Where-Object { $_ -notin '--browser', '--with', '--dry-run' }) }
                }
            }
            if ($key -eq 'project note' -and $positionals.Count -eq 2 -and -not $prefix.StartsWith('-')) {
                $candidates = @('add', 'remove')
            }
        }
    }
    foreach ($candidate in $candidates) {
        if ($candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            $completion = $inlinePrefix + $candidate
            [System.Management.Automation.CompletionResult]::new($completion, $candidate, 'ParameterValue', $candidate)
        }
    }
}.GetNewClosure()
