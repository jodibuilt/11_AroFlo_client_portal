<#
.SYNOPSIS
  Publishes the portal code to the Azure web app created by azure-provision.ps1.

.DESCRIPTION
  Zips server/, public/ and package files (never .env, data/ or node_modules), uploads
  the zip, lets Azure run "npm install", then checks /healthz. Users, settings and
  cached photos live in /home/data on Azure and are untouched by deploys.

.EXAMPLE
  .\deploy\azure-deploy.ps1 -AppName tts-client-portal
#>
param(
  [Parameter(Mandatory = $true)] [string] $AppName,
  [string] $ResourceGroup = 'rg-client-portal'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$zip = Join-Path ([System.IO.Path]::GetTempPath()) "client-portal-$([guid]::NewGuid().ToString('N')).zip"

try {
  # Windows' bundled tar writes zip entries with forward slashes, which Linux needs
  # (PowerShell 5's Compress-Archive uses backslashes and breaks the deploy).
  Push-Location $root
  try {
    & "$env:SystemRoot\System32\tar.exe" -a -c -f $zip server public package.json package-lock.json
    if ($LASTEXITCODE -ne 0) { throw 'Creating the deployment zip failed.' }
  } finally {
    Pop-Location
  }
  Write-Host "Package: $([math]::Round((Get-Item $zip).Length / 1KB)) KB" -ForegroundColor Cyan

  Write-Host "Deploying to $AppName (Azure runs npm install, this takes a minute or two)..." -ForegroundColor Cyan
  # 'Continue' so az progress output on stderr isn't treated as a failure; the exit code decides.
  $ErrorActionPreference = 'Continue'
  & az webapp deploy --resource-group $ResourceGroup --name $AppName --src-path $zip --type zip --track-status false --only-show-errors --output none
  $deployExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($deployExit -ne 0) { throw 'az webapp deploy failed. Check: az webapp log tail -g ' + $ResourceGroup + ' -n ' + $AppName }
} finally {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

$hostName = az webapp show --resource-group $ResourceGroup --name $AppName --query defaultHostName -o tsv
$url = "https://$hostName"
Write-Host 'Waiting for the app to start...' -ForegroundColor Cyan
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "$url/healthz" -UseBasicParsing -TimeoutSec 20
    if ($r.StatusCode -eq 200) {
      Write-Host "Live: $url" -ForegroundColor Green
      Write-Host "First time? Open $url/login to create the admin account." -ForegroundColor Green
      exit 0
    }
  } catch { Start-Sleep -Seconds 5 }
}
Write-Warning "The app didn't answer /healthz yet. Check the logs: az webapp log tail -g $ResourceGroup -n $AppName"
exit 1
