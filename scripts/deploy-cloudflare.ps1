$ErrorActionPreference = "Stop"

if (-not $env:CLOUDFLARE_API_TOKEN) {
  throw "Missing CLOUDFLARE_API_TOKEN. Set it before running this script."
}

if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
  throw "Missing CLOUDFLARE_ACCOUNT_ID. Set it before running this script."
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
  throw "npm was not found. Install Node.js LTS first, then reopen PowerShell."
}

if (-not (Test-Path ".\node_modules")) {
  npm install
}

npm run deploy
