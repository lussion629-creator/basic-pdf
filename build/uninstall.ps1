# Basic PDF 제거
$ErrorActionPreference = 'SilentlyContinue'
Get-Process -Name 'BasicPDF' | Stop-Process -Force
Start-Sleep -Milliseconds 500
$target = Join-Path $env:LOCALAPPDATA 'Programs\Basic PDF'
Remove-Item -Recurse -Force $target
Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Basic PDF.lnk')
Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Programs')) 'Basic PDF.lnk')
Remove-Item -Recurse -Force 'HKCU:\Software\Classes\Applications\BasicPDF.exe'
Remove-Item -Recurse -Force 'HKCU:\Software\Classes\.pdf\OpenWithList\BasicPDF.exe'
Write-Host ''
Write-Host '  Basic PDF를 제거했습니다. (설정과 서명은 %APPDATA%\Basic PDF 에 남아 있습니다)' -ForegroundColor Green
Write-Host ''
