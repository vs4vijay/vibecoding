# DRFT PowerShell entry point — forwards to the bash scripts.
#
# Usage:
#   .\scripts\make.ps1 fetch
#   .\scripts\make.ps1 patch
#   .\scripts\make.ps1 build               # uses DRFT_VARIANT from versions.env
#   .\scripts\make.ps1 build focusRelease
#   .\scripts\make.ps1 all                 # fetch + patch + build
#   .\scripts\make.ps1 clean
#
# Windows requires a POSIX shell to run the canonical bash scripts. Detection
# order:
#   1. $env:DRFT_BASH (explicit override path)
#   2. Git Bash (bash.exe shipped with Git for Windows)
#   3. WSL (`wsl bash`)
# If none are found, the script prints install instructions and exits 1.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('fetch', 'patch', 'build', 'all', 'clean')]
    [string]$Command = 'all',

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

function Find-Bash {
    # 1) Explicit override.
    if ($env:DRFT_BASH -and (Test-Path $env:DRFT_BASH)) {
        return @{ Kind = 'native'; Path = $env:DRFT_BASH }
    }

    # 2) Git Bash. The bash.exe that ships with Git for Windows works fine
    #    with our scripts (curl, tar, patch, python3 all available).
    $gitBash = @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "$env:ProgramFiles\Git\usr\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($gitBash) { return @{ Kind = 'native'; Path = $gitBash } }

    # PATH lookup (works if Git's bin is on PATH).
    $cmd = Get-Command bash.exe -ErrorAction SilentlyContinue
    if ($cmd) { return @{ Kind = 'native'; Path = $cmd.Source } }

    # 3) WSL fallback. Note: paths must be translated to /mnt/c/... when
    #    invoking, since WSL has a separate filesystem view.
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($wsl) { return @{ Kind = 'wsl'; Path = $wsl.Source } }

    return $null
}

$bash = Find-Bash
if (-not $bash) {
    Write-Error @"
No POSIX shell found. DRFT scripts require bash. Install one of:
  - Git for Windows (recommended):  https://git-scm.com/download/win
  - WSL (Ubuntu/Debian):            wsl --install
  - Or set `$env:DRFT_BASH to an explicit bash.exe path.
"@
    exit 1
}

# Translate a Windows path to a WSL path: C:\src\DRFT → /mnt/c/src/DRFT
function ConvertTo-WslPath([string]$winPath) {
    $full = (Resolve-Path -LiteralPath $winPath).Path
    $drive = $full.Substring(0, 1).ToLower()
    $rest  = $full.Substring(2) -replace '\\', '/'
    return "/mnt/$drive$rest"
}

$scriptName = switch ($Command) {
    'fetch' { 'fetch.sh' }
    'patch' { 'patch.sh' }
    'build' { 'build.sh' }
    'all'   { 'all.sh'   }
    'clean' { 'clean.sh' }
}

$scriptWinPath = Join-Path $ScriptDir $scriptName

if ($bash.Kind -eq 'native') {
    # Git Bash understands Windows paths fine.
    & $bash.Path $scriptWinPath @Args
} else {
    # WSL needs translated paths and access to the repo via /mnt/.
    $scriptWslPath = ConvertTo-WslPath $scriptWinPath
    & $bash.Path bash $scriptWslPath @Args
}

exit $LASTEXITCODE
