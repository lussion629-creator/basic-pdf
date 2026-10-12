# Basic PDF 오프라인 설치 — 인터넷 연결 없이 설치합니다.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$parts   = @('data.001', 'data.002', 'data.003', 'data.004')
$sha256  = '__SHA256__'
$src     = Split-Path -Parent $MyInvocation.MyCommand.Path
$target  = Join-Path $env:LOCALAPPDATA 'Programs\Basic PDF'
$tmpZip  = Join-Path $env:TEMP 'basicpdf-offline.zip'

Write-Host ''
Write-Host '  Basic PDF 오프라인 설치' -ForegroundColor Cyan
Write-Host "  설치 위치: $target"
Write-Host ''

function Find-Part($name) {
    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    foreach ($dir in @($src, (Split-Path -Parent $src), $downloads)) {
        if ($dir -and (Test-Path (Join-Path $dir $name))) { return (Join-Path $dir $name) }
    }
    return $null
}

try {
    Write-Host '  [1/4] 설치 파일 확인 중...'
    $found = @()
    $missing = @()
    foreach ($p in $parts) { $f = Find-Part $p; if ($f) { $found += $f } else { $missing += $p } }
    if ($missing.Count) {
        throw ("다음 파일을 찾지 못했습니다: " + ($missing -join ', ') + "`n  받은 data.002 ~ data.004 파일을 '설치.bat'과 같은 폴더(또는 다운로드 폴더)에 넣고 다시 실행하세요.")
    }

    Write-Host '  [2/4] 파일 합치는 중...'
    $out = [IO.File]::Create($tmpZip)
    try { foreach ($f in $found) { $in = [IO.File]::OpenRead($f); try { $in.CopyTo($out) } finally { $in.Close() } } }
    finally { $out.Close() }
    $hash = (Get-FileHash -Path $tmpZip -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $sha256) { throw '파일이 손상되었거나 일부만 받아졌습니다. data.001 ~ data.004를 다시 받아 주세요.' }

    Write-Host '  [3/4] 설치 중...'
    Get-Process -Name 'BasicPDF', 'PaperlinePDF' -ErrorAction SilentlyContinue | Stop-Process -Force
    # 이전 이름(Paperline PDF)으로 설치된 앱 정리 (서명·설정은 새 앱이 처음 실행될 때 옮겨 감)
    $old = Join-Path $env:LOCALAPPDATA 'Programs\Paperline PDF'
    if (Test-Path $old) { Remove-Item -Recurse -Force $old -ErrorAction SilentlyContinue }
    foreach ($l in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Paperline PDF.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Paperline PDF.lnk'))) { Remove-Item -Force $l -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force 'HKCU:\Software\Classes\Applications\PaperlinePDF.exe' -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force 'HKCU:\Software\Classes\.pdf\OpenWithList\PaperlinePDF.exe' -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Expand-Archive -Path $tmpZip -DestinationPath $target -Force
    Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
    foreach ($f in @('uninstall.ps1', '제거.bat')) { $s = Join-Path $src $f; if (Test-Path $s) { Copy-Item $s (Join-Path $target $f) -Force } }

    Write-Host '  [4/4] 바로 가기 만드는 중...'
    $exe   = Join-Path $target 'BasicPDF.exe'
    $shell = New-Object -ComObject WScript.Shell
    foreach ($l in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Basic PDF.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Basic PDF.lnk'))) {
        $s = $shell.CreateShortcut($l)
        $s.TargetPath = $exe
        $s.WorkingDirectory = $target
        $s.IconLocation = "$exe,0"
        $s.Description = 'PDF 리더 및 편집기'
        $s.Save()
    }

    # '연결 프로그램' 목록에 표시 (기본 앱을 바꾸지는 않음)
    $appKey = 'HKCU:\Software\Classes\Applications\BasicPDF.exe'
    New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'Basic PDF'
    Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value "`"$exe`" `"%1`""
    New-Item -Path "$appKey\SupportedTypes" -Force | Out-Null
    Set-ItemProperty -Path "$appKey\SupportedTypes" -Name '.pdf' -Value ''
    New-Item -Path 'HKCU:\Software\Classes\.pdf\OpenWithList\BasicPDF.exe' -Force | Out-Null

    Write-Host ''
    Write-Host '  설치가 끝났습니다. 바탕화면의 Basic PDF 아이콘으로 실행하세요.' -ForegroundColor Green
    Write-Host '  이제 받은 설치 파일(data.001 ~ data.004)은 지워도 됩니다.'
    Write-Host ''
    Start-Process $exe
}
catch {
    if (Test-Path $tmpZip) { Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue }
    Write-Host ''
    Write-Host "  설치하지 못했습니다: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    exit 1
}
