<#
.SYNOPSIS
Start Joggl from source on a machine that may have nothing installed.

.DESCRIPTION
Node is the one thing Joggl needs that Windows does not ship. Rather than asking
each colleague to install it, this fetches a *portable* Node into `.node\` inside
the project:

  - no administrator rights, which a managed laptop may well not grant;
  - nothing outside this folder changes, so deleting the folder undoes all of it;
  - everyone ends up on the same Node, so "works on mine" means something.

A Node already on PATH is used instead, if it is new enough, so nobody who has
one downloads thirty megabytes for nothing.

The download is checked against the SHA-256 in nodejs.org's own SHASUMS256.txt.
That catches a truncated or mirrored-stale file; it is not a signature check, and
does not defend against nodejs.org itself or a TLS-intercepting proxy serving a
consistent pair. Verifying the release signatures needs the Node GPG keys, which
is more than this is worth — but say so rather than imply more than it does.

.PARAMETER BootstrapOnly
Fetch Node and stop. Used by the tests, and handy when diagnosing the download.

.PARAMETER ForceBootstrap
Ignore any Node on PATH and fetch the portable one regardless.

.PARAMETER NodeDir
Where the portable Node goes. Defaults to `.node` beside the project.
#>
[CmdletBinding()]
param(
  [switch]$BootstrapOnly,
  [switch]$ForceBootstrap,
  [string]$NodeDir
)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest's progress bar makes a 30 MB download take minutes.
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
if (-not $NodeDir) { $NodeDir = Join-Path $root '.node' }

# Node 20 is the floor: it is the oldest LTS whose bundled npm handles this
# project's lockfile format. Electron brings its own Node at runtime, so the host
# copy only ever runs npm.
$MinMajor = 20
$Channel = 'latest-v22.x'

function Write-Step { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Note { param([string]$Text) Write-Host "    $Text" -ForegroundColor DarkGray }

function Get-NodeMajor {
  param([string]$Exe)
  try {
    $v = & $Exe --version 2>$null
    if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
  } catch { }
  return 0
}

function Find-UsableNode {
  # The portable copy wins: if it is there, a previous run put it there for a
  # reason, and mixing it with a system Node mid-project invites version drift.
  $portable = Join-Path $NodeDir 'node.exe'
  if (Test-Path $portable) { return (Split-Path -Parent $portable) }
  if ($ForceBootstrap) { return $null }

  $onPath = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  if ($onPath) {
    $major = Get-NodeMajor $onPath.Source
    if ($major -ge $MinMajor) { return (Split-Path -Parent $onPath.Source) }
    Write-Note "Found Node v$major on PATH, but v$MinMajor or newer is needed."
  }
  return $null
}

function Install-PortableNode {
  Write-Step 'Fetching a portable Node into .node\ (a 30 MB download, once)'
  Write-Note 'About 95 MB on disk. Nothing is installed system-wide, and deleting'
  Write-Note 'the .node folder undoes all of it.'

  # The channel alias avoids pinning a version that may not exist yet, and the
  # manifest names the exact file, so one request settles both.
  $base = "https://nodejs.org/dist/$Channel"
  Write-Note "Reading $base/SHASUMS256.txt"
  $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content

  $line = ($sums -split "`n") |
    Where-Object { $_ -match 'node-v[\d.]+-win-x64\.zip\s*$' } |
    Select-Object -First 1
  if (-not ($line -match '^([0-9a-f]{64})\s+(\S+)\s*$')) {
    throw "Could not find a Windows x64 build in $base/SHASUMS256.txt"
  }
  $expected = $Matches[1]
  $file = $Matches[2]

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("joggl-node-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp $file
    Write-Note "Downloading $file"
    Invoke-WebRequest -Uri "$base/$file" -OutFile $zip -UseBasicParsing

    Write-Note 'Verifying SHA-256'
    $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      throw "Checksum mismatch for $file.`n  expected $expected`n  got      $actual`nThe download was corrupted or tampered with; nothing has been installed."
    }

    Write-Note 'Extracting'
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    # The archive holds one top-level directory; its contents are what we want.
    $inner = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
    if (-not $inner) { throw "Unexpected archive layout in $file" }

    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item -Path $inner.FullName -Destination $NodeDir

    $version = & (Join-Path $NodeDir 'node.exe') --version
    Write-Note "Node $version ready in $NodeDir"
    return $NodeDir
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

# ── Run ─────────────────────────────────────────────────────────────────────

Push-Location $root
try {
  $nodeBin = Find-UsableNode
  if (-not $nodeBin) { $nodeBin = Install-PortableNode }

  # Prepended so this Node wins over anything else for the rest of the session.
  # Only this process's environment changes.
  $env:PATH = "$nodeBin;$env:PATH"

  if ($BootstrapOnly) {
    Write-Step "Node ready: $(& node --version) at $nodeBin"
    exit 0
  }

  if (-not (Test-Path 'node_modules\.bin\electron.cmd')) {
    Write-Step 'Installing dependencies (once, a couple of minutes)'
    & npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed. If you are behind a corporate proxy, npm needs it configured:`n  npm config set proxy http://your-proxy:port"
    }
  }

  Write-Step 'Starting Joggl. Closing this window quits the app.'
  & 'node_modules\.bin\electron.cmd' .
  exit $LASTEXITCODE
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
} finally {
  Pop-Location
}
