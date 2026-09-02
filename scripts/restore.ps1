[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl,
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$BackupPath,
  [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) {
  throw "恢复会清空并重建目标库中的对象。仅在已验证备份和目标连接后，加 -ConfirmRestore 执行。"
}
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) {
  throw "未找到 pg_restore。请安装与 PostgreSQL 17 兼容的客户端工具后重试。"
}

$resolvedBackup = [System.IO.Path]::GetFullPath($BackupPath)
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne ".dump") {
  throw "仅接受由 backup.ps1 生成的 .dump 自定义格式备份。"
}

& pg_restore --clean --if-exists --no-owner --no-privileges --dbname $DatabaseUrl $resolvedBackup
if ($LASTEXITCODE -ne 0) { throw "恢复失败；目标库可能处于部分恢复状态，请立即停止业务流量并按运维手册处理。" }
Write-Output "Restore completed: $resolvedBackup"
