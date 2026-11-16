<#
.SYNOPSIS
  รวมข้อมูลดิบจากหลายไฟล์ (stations-raw.json + stations-part*.json) แบบ dedup ตาม id
  แล้วบันทึกทับ data\stations-raw.json (มี backup) และรัน build-stations.ps1 ต่อ

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-data.ps1
#>
$ErrorActionPreference = 'Stop'
$root = "$PSScriptRoot\.."
$dataDir = "$root\data"
$rawPath = "$dataDir\stations-raw.json"

$files = Get-ChildItem -Path $dataDir -Filter 'stations-*.json' |
  Where-Object { $_.Name -in @('stations-raw.json') -or $_.Name -match '^stations-part\d+\.json$' } |
  Sort-Object Name
Write-Output ("input files: " + (($files | ForEach-Object { $_.Name }) -join ', '))

$utf8 = New-Object System.Text.UTF8Encoding($false)
$byId = @{}
foreach ($f in $files) {
  $recs = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Write-Output ("  {0}: {1} records" -f $f.Name, $recs.Count)
  foreach ($s in $recs) { $byId[[int]$s.id] = $s }  # ไฟล์ที่โหลดทีหลังทับไฟล์ก่อน (ข้อมูลสดกว่า)
}

$merged = $byId.Values | Sort-Object { [int]$_.id }
Copy-Item $rawPath ($rawPath -replace '\.json$', '.backup.json') -Force
[System.IO.File]::WriteAllText($rawPath, ($merged | ConvertTo-Json -Depth 3 -Compress), $utf8)
$provs = ($merged | Group-Object province_th).Count
Write-Output ("merged unique={0} provinces={1} -> {2}" -f $merged.Count, $provs, $rawPath)

& "$PSScriptRoot\build-stations.ps1" -Raw $rawPath
