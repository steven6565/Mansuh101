# Visitor - Windows (RDP) provisioner
# Usage (PowerShell as Administrator, inside the project folder):
#   powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1
# Re-runnable: keeps an existing .env and the data\ folder.

[CmdletBinding()]
param(
  [int]$Port = 4000,
  [string]$ChromiumPath = '',
  [switch]$SkipFirewall
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step($Message) { Write-Host "`n==> $Message" -ForegroundColor Magenta }
function Write-Ok($Message)   { Write-Host "[ok] $Message" -ForegroundColor Green }
function Write-Warn2($Message){ Write-Host "[warn] $Message" -ForegroundColor Yellow }

Write-Host "Visitor - Windows setup" -ForegroundColor Magenta
Write-Host "Project: $Root"

# ---------------------------------------------------------------- Node.js ----
Write-Step 'Checking Node.js'
$nodeVersion = $null
try { $nodeVersion = (& node -v) 2>$null } catch { $nodeVersion = $null }

if (-not $nodeVersion) {
  Write-Warn2 'Node.js not found. Trying winget...'
  try {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $nodeVersion = (& node -v)
  } catch {
    throw 'Install Node.js 22+ manually from https://nodejs.org/en/download then re-run this script.'
  }
}

$major = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
if ($major -lt 22) {
  throw "Node.js $nodeVersion is too old. Visitor needs Node 22.5+ (node:sqlite). Install the LTS build and re-run."
}
Write-Ok "Node $nodeVersion"

# ------------------------------------------------------------------- pnpm ----
Write-Step 'Checking pnpm and PM2'
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  try { corepack enable; corepack prepare pnpm@latest --activate } catch { npm install -g pnpm@latest }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { npm install -g pnpm@latest }
Write-Ok "pnpm $(pnpm -v)"

# --------------------------------------------------------------- Chromium ----
Write-Step 'Locating Google Chrome / Edge'
$browser = $null
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
if ($ChromiumPath) {
  if (Test-Path $ChromiumPath) { $browser = (Resolve-Path $ChromiumPath).Path }
  else { throw "ChromiumPath not found: $ChromiumPath" }
} else {
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { $browser = $candidate; break }
  }
}
if ($browser) { Write-Ok "Browser: $browser" }
else {
  Write-Warn2 'Chrome/Edge not found. Install Google Chrome, then set CHROMIUM_PATH in .env.'
  Write-Warn2 'The dashboard will still start; automation stays disabled until a browser exists.'
}

# ------------------------------------------------------------------ .env ----
Write-Step 'Writing environment file'
$envFile = Join-Path $Root '.env'
$generatedPassword = $null
if (-not (Test-Path $envFile)) {
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $generatedPassword = -join (1..24 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
  Copy-Item (Join-Path $Root '.env.example') $envFile
  $content = Get-Content $envFile -Raw
  $content = $content -replace '(?m)^APP_PASSWORD=.*$', "APP_PASSWORD=$generatedPassword"
  $content = $content -replace '(?m)^NODE_ENV=.*$', 'NODE_ENV=production'
  $content = $content -replace '(?m)^PORT=.*$', "PORT=$Port"
  $content = $content -replace '(?m)^PUBLIC_URL=.*$', 'PUBLIC_URL='
  if ($browser) {
    $content = $content -replace '(?m)^CHROMIUM_PATH=.*$', "CHROMIUM_PATH=$browser"
  }
  Set-Content -Path $envFile -Value $content -Encoding UTF8
  Write-Ok 'Generated .env with a random dashboard password'
} else {
  Write-Warn2 '.env already exists - leaving it untouched'
  if ($browser) {
    $existing = Get-Content $envFile -Raw
    if ($existing -notmatch '(?m)^CHROMIUM_PATH=.+') {
      $existing = $existing -replace '(?m)^CHROMIUM_PATH=.*$', "CHROMIUM_PATH=$browser"
      Set-Content -Path $envFile -Value $existing -Encoding UTF8
      Write-Ok 'Set CHROMIUM_PATH in the existing .env'
    }
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data\logs')        | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data\screenshots') | Out-Null

# -------------------------------------------------------- install + build ----
Write-Step 'Installing dependencies'
pnpm install --allow-build=esbuild
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }

Write-Step 'Building the dashboard'
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'pnpm build failed' }

# -------------------------------------------------------------- firewall ----
if (-not $SkipFirewall) {
  Write-Step "Opening firewall port $Port"
  try {
    $ruleName = "Visitor dashboard ($Port)"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
      Write-Ok "Firewall rule created for TCP $Port"
    } else {
      Write-Ok 'Firewall rule already present'
    }
  } catch {
    Write-Warn2 "Could not add firewall rule: $($_.Exception.Message)"
  }
}

# ------------------------------------------------------------------ start ----
Write-Step 'Starting Visitor'
$pm2Available = $false
try { $null = pm2 -v; $pm2Available = $true } catch { $pm2Available = $false }

if ($pm2Available) {
  pm2 delete visitor 2>$null | Out-Null
  pm2 start server/src/index.js --name visitor --time
  pm2 save
  Write-Ok 'Running under PM2 (pm2 logs visitor)'
} else {
  Write-Warn2 'PM2 not installed. Starting in this window (closing it stops the server).'
  Write-Warn2 'For a permanent service: npm install -g pm2; then pm2 start server/src/index.js --name visitor; pm2 save'
  Start-Process -FilePath 'node' -ArgumentList 'server/src/index.js' -WorkingDirectory $Root
}

# ---------------------------------------------------------------- verify ----
Write-Step 'Verifying health'
$healthy = $false
for ($i = 0; $i -lt 25; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Milliseconds 800 }
}
if ($healthy) { Write-Ok "Backend healthy on 127.0.0.1:$Port" }
else { Write-Warn2 'Health check failed - run: node server/src/index.js and read the console output' }

$ips = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress) -join ', '
if (-not $ips) { $ips = '<this-server-IP>' }

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host '  Visitor installed' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
Write-Host "  Local URL : http://127.0.0.1:$Port"
Write-Host "  Remote URL: http://$ips`:$Port"
if ($generatedPassword) {
  Write-Host "  Password  : $generatedPassword" -ForegroundColor Yellow
  Write-Host '  (stored in .env - change it anytime)'
} else {
  Write-Host '  Password  : unchanged (see .env)'
}
Write-Host ''
Write-Host '  Next: open the URL in your browser, log in, add URLs, press Start run.'
Write-Host '  Browser self-test: pnpm run doctor --launch'
Write-Host ''
