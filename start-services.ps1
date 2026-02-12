param(
  [switch]$Install
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$services = @(
  @{ Name = "ws-service"; Path = "ws-service" },
  @{ Name = "web-service"; Path = "web-service" },
  @{ Name = "gateway"; Path = "gateway" }
)

function Assert-CommandExists([string]$commandName) {
  if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
    throw "Command not found: $commandName. Please install it and add to PATH."
  }
}

function Start-ServiceWindow([string]$serviceName, [string]$servicePath, [bool]$installDeps) {
  $fullPath = Join-Path $root $servicePath
  if (-not (Test-Path $fullPath)) {
    throw "Directory not found: $fullPath"
  }

  $startupCommands = @(
    "Set-Location -Path '$fullPath'",
    "`$host.UI.RawUI.WindowTitle = 'mosecat :: $serviceName'"
  )

  if ($installDeps) {
    $startupCommands += "npm install"
  }

  $startupCommands += "npm start"
  $commandText = $startupCommands -join "; "

  Write-Host "Starting $serviceName ..."
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $commandText
  ) | Out-Null
}

try {
  Assert-CommandExists "npm"
  Assert-CommandExists "powershell.exe"

  foreach ($service in $services) {
    Start-ServiceWindow -serviceName $service.Name -servicePath $service.Path -installDeps:$Install
    Start-Sleep -Milliseconds 300
  }

  Write-Host ""
  Write-Host "Started 3 service windows."
  Write-Host "Gateway: http://localhost:19923/"
  Write-Host "Web: http://localhost:19924/"
  Write-Host "WS: http://localhost:19925/"
  if ($Install) {
    Write-Host "npm install was executed in each service directory."
  }
} catch {
  Write-Error $_
  exit 1
}
