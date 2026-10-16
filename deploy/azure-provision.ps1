<#
.SYNOPSIS
  One-time setup of the Azure App Service (Linux, Node 24) that hosts the client portal.

.DESCRIPTION
  Creates the web app (plus a resource group and Linux App Service plan, unless
  -ExistingPlan is given), copies the AroFlo credentials from .env into the app's App
  Settings, and locks the app down (HTTPS only, TLS 1.2+, FTP off, health check).
  Safe to re-run. With -ExistingPlan, the plan and any other apps on it are not changed.

  Run azure-deploy.ps1 afterwards (and on every code change) to publish the code.

.EXAMPLE
  .\deploy\azure-provision.ps1 -AppName tts-client-portal

.EXAMPLE
  # Add to an existing Linux plan
  .\deploy\azure-provision.ps1 -AppName app-aroflo-client-portal-tts-prod -ResourceGroup rg-tts-integrations -ExistingPlan plan-aroflo-dashboards-prod
#>
param(
  [Parameter(Mandatory = $true)] [string] $AppName,          # becomes https://<AppName>.azurewebsites.net (must be globally unique)
  [string] $ResourceGroup = 'rg-client-portal',
  [string] $Location = 'australiaeast',
  [string] $PlanSku = 'B1',                                     # B1 is the smallest tier with Always On
  [string] $Runtime = 'NODE:24-lts',
  [string] $ExistingPlan = ''                                   # name of a Linux plan in $ResourceGroup to reuse
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Windows PowerShell treats anything az writes to stderr as a fatal error under 'Stop',
# so rely on az's exit code instead.
function Invoke-Az {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & az @args --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw "az $($args[0..2] -join ' ') failed (exit $LASTEXITCODE)" }
  } finally {
    $ErrorActionPreference = $previous
  }
}

# Runs an az lookup that may legitimately fail (e.g. "not found"); returns its output or $null.
function Get-AzValue {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & az @args --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $out
  } finally {
    $ErrorActionPreference = $previous
  }
}

$account = az account show --query "{sub:name, user:user.name}" -o tsv
if ($LASTEXITCODE -ne 0) { throw 'Not signed in. Run "az login" first.' }
Write-Host "Azure subscription: $account" -ForegroundColor Cyan

# --- Read AroFlo settings from .env ---------------------------------------------------
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { throw ".env not found at $envFile" }
$dotenv = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $dotenv[$Matches[1]] = $Matches[2].Trim('"', "'") }
}
$required = 'AROFLO_SECRET_KEY', 'AROFLO_UENCODED', 'AROFLO_PENCODED', 'AROFLO_ORG_ENCODED'
foreach ($key in $required) { if (-not $dotenv[$key]) { throw "$key is missing from .env" } }

# --- Resources ------------------------------------------------------------------------
if ($ExistingPlan) {
  $plan = $ExistingPlan
  $planKind = Get-AzValue appservice plan show --resource-group $ResourceGroup --name $plan --query kind -o tsv
  if (-not $planKind) { throw "Plan $plan not found in resource group $ResourceGroup." }
  if ($planKind -notmatch 'linux') { throw "Plan $plan is a Windows plan ($planKind); this app needs a Linux plan." }
  Write-Host "Using existing Linux plan $plan (not modified)." -ForegroundColor Cyan
} else {
  $plan = "$AppName-plan"
  Write-Host "Creating resource group $ResourceGroup ($Location)..." -ForegroundColor Cyan
  Invoke-Az group create --name $ResourceGroup --location $Location --output none

  Write-Host "Creating Linux App Service plan $plan ($PlanSku)..." -ForegroundColor Cyan
  Invoke-Az appservice plan create --resource-group $ResourceGroup --name $plan --is-linux --sku $PlanSku --number-of-workers 1 --output none
}

Write-Host "Creating web app $AppName ($Runtime)..." -ForegroundColor Cyan
$exists = Get-AzValue webapp show --resource-group $ResourceGroup --name $AppName --query name -o tsv
if (-not $exists) {
  Invoke-Az webapp create --resource-group $ResourceGroup --plan $plan --name $AppName --runtime $Runtime --output none
}

# --- App settings (written to a temp file so secrets never appear on a command line) ---
$settings = [ordered]@{
  AROFLO_API_BASE_URL                 = $(if ($dotenv['AROFLO_API_BASE_URL']) { $dotenv['AROFLO_API_BASE_URL'] } else { 'https://api.aroflo.com/' })
  AROFLO_SECRET_KEY                   = $dotenv['AROFLO_SECRET_KEY']
  AROFLO_UENCODED                     = $dotenv['AROFLO_UENCODED']
  AROFLO_PENCODED                     = $dotenv['AROFLO_PENCODED']
  AROFLO_ORG_ENCODED                  = $dotenv['AROFLO_ORG_ENCODED']
  DEMO_MODE                           = 'false'
  NODE_ENV                            = 'production'
  DATA_DIR                            = '/home/data'           # persistent across restarts and deploys
  WEBSITES_ENABLE_APP_SERVICE_STORAGE = 'true'
  SCM_DO_BUILD_DURING_DEPLOYMENT      = 'true'                 # runs "npm install" on Azure during deploy; keep on
}
if ($dotenv['AROFLO_HOST_IP']) { $settings['AROFLO_HOST_IP'] = $dotenv['AROFLO_HOST_IP'] }

# One-time code needed to create the first admin account on the public site.
$setupToken = Get-AzValue webapp config appsettings list --resource-group $ResourceGroup --name $AppName --query "[?name=='SETUP_TOKEN'].value" -o tsv
if (-not $setupToken) {
  $bytes = New-Object byte[] 18
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $setupToken = [Convert]::ToBase64String($bytes).Replace('+', 'x').Replace('/', 'y')
}
$settings['SETUP_TOKEN'] = $setupToken

$tmp = [System.IO.Path]::GetTempFileName()
try {
  $list = foreach ($k in $settings.Keys) { [pscustomobject]@{ name = $k; value = $settings[$k]; slotSetting = $false } }
  [System.IO.File]::WriteAllText($tmp, (ConvertTo-Json @($list)), (New-Object System.Text.UTF8Encoding $false))
  Write-Host 'Saving App Settings (AroFlo credentials etc.)...' -ForegroundColor Cyan
  Invoke-Az webapp config appsettings set --resource-group $ResourceGroup --name $AppName --settings "@$tmp" --output none
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

# --- Hardening & runtime config ---------------------------------------------------------
Write-Host 'Configuring HTTPS-only, TLS 1.2, Always On, health check...' -ForegroundColor Cyan
Invoke-Az webapp update --resource-group $ResourceGroup --name $AppName --https-only true --output none
Invoke-Az webapp config set --resource-group $ResourceGroup --name $AppName `
  --always-on true --ftps-state Disabled --min-tls-version 1.2 --http20-enabled true `
  --startup-file 'npm start' --output none
Invoke-Az webapp config set --resource-group $ResourceGroup --name $AppName --generic-configurations healthCheckPath=/healthz --output none
Invoke-Az webapp log config --resource-group $ResourceGroup --name $AppName `
  --docker-container-logging filesystem --output none

$hostName = az webapp show --resource-group $ResourceGroup --name $AppName --query defaultHostName -o tsv
Write-Host ''
Write-Host "Done. App: https://$hostName" -ForegroundColor Green
Write-Host "Setup code for creating the first admin at /login: $setupToken" -ForegroundColor Yellow
Write-Host "Next: .\deploy\azure-deploy.ps1 -AppName $AppName -ResourceGroup $ResourceGroup" -ForegroundColor Green
