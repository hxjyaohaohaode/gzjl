[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "未找到 pg_dump。请安装与 PostgreSQL 17 兼容的客户端工具后重试。"
}

$resolvedDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $resolvedDirectory "workbench-$stamp.dump"

& pg_dump --format=custom --no-owner --no-privileges --file $target $DatabaseUrl
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $target) -or (Get-Item -LiteralPath $target).Length -eq 0) {
  throw "备份失败或生成了空文件。"
}

$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$target.sha256", "$hash  $([System.IO.Path]::GetFileName($target))`n")
Write-Output "Backup created: $target"
Write-Output "SHA256: $hash"
