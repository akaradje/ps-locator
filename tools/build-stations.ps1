<#
.SYNOPSIS
  แปลงข้อมูลดิบจากสำนักงานตำรวจแห่งชาติ (stations-raw.json) เป็น data/stations.js
  พร้อมผูก "ภาค" (region) และประเภทสถานี และสร้าง stations.json สำหรับดาวน์โหลด

.DESCRIPTION
  ใช้: pwsh tools\build-stations.ps1 [-Raw ..\data\stations-raw.json]
  ไม่ต้องใช้ Node/Python — ใช้ PowerShell ล้วน
#>
param(
  [string]$Raw = "$PSScriptRoot\..\data\stations-raw.json",
  [string]$OutJs = "$PSScriptRoot\..\data\stations.js",
  [string]$OutJson = "$PSScriptRoot\..\data\stations.json"
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---- ตารางจังหวัด → ภาค (ตามประกาศสำนักงานตำรวจแห่งชาติ เรื่องเขตพื้นที่การปกครองของ ตร.) ----
$regionOf = @{}
@('กรุงเทพมหานคร') | ForEach-Object { $regionOf[$_] = 'bkk' }
@('ชัยนาท','นนทบุรี','ปทุมธานี','พระนครศรีอยุธยา','ลพบุรี','สมุทรปราการ','สระบุรี','สิงห์บุรี','อ่างทอง') | ForEach-Object { $regionOf[$_] = 'p1' }
@('จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ตราด','นครนายก','ปราจีนบุรี','ระยอง','สระแก้ว') | ForEach-Object { $regionOf[$_] = 'p2' }
@('ชัยภูมิ','นครราชสีมา','บุรีรัมย์','ยโสธร','ศรีสะเกษ','สุรินทร์','อำนาจเจริญ','อุบลราชธานี') | ForEach-Object { $regionOf[$_] = 'p3' }
@('กาฬสินธุ์','ขอนแก่น','นครพนม','บึงกาฬ','มหาสารคาม','มุกดาหาร','ร้อยเอ็ด','เลย','สกลนคร','หนองคาย','หนองบัวลำภู','อุดรธานี') | ForEach-Object { $regionOf[$_] = 'p4' }
@('เชียงราย','เชียงใหม่','น่าน','พะเยา','แพร่','แม่ฮ่องสอน','ลำปาง','ลำพูน') | ForEach-Object { $regionOf[$_] = 'p5' }
@('กำแพงเพชร','ตาก','นครสวรรค์','พิจิตร','พิษณุโลก','เพชรบูรณ์','สุโขทัย','อุตรดิตถ์','อุทัยธานี') | ForEach-Object { $regionOf[$_] = 'p6' }
@('กาญจนบุรี','นครปฐม','ประจวบคีรีขันธ์','เพชรบุรี','ราชบุรี','สมุทรสงคราม','สมุทรสาคร','สุพรรณบุรี') | ForEach-Object { $regionOf[$_] = 'p7' }
@('กระบี่','ชุมพร','นครศรีธรรมราช','พังงา','ภูเก็ต','ระนอง','สุราษฎร์ธานี') | ForEach-Object { $regionOf[$_] = 'p8' }
@('ตรัง','นราธิวาส','ปัตตานี','พัทลุง','ยะลา','สงขลา','สตูล') | ForEach-Object { $regionOf[$_] = 'p9' }

Write-Output "Reading: $Raw"
$raw = [System.IO.File]::ReadAllText($Raw, [System.Text.Encoding]::UTF8)
$data = $raw | ConvertFrom-Json
Write-Output ("raw records: " + $data.Count)

$clean = foreach ($s in $data) {
  $addr = ($s.address -replace '\s+', ' ').Trim()
  $name = ($s.name -replace '\s+', ' ').Trim()
  $web  = ($s.website -replace '\s+', '').Trim()
  $prov = ($s.province_th -replace '\s+', ' ').Trim()
  $region = $regionOf[$prov]
  if (-not $region) { Write-Warning "ไม่พบภาคสำหรับจังหวัด: '$prov' (id=$($s.id))" }
  [PSCustomObject]@{
    id          = [int]$s.id
    name        = $name
    address     = $addr
    phone       = ($s.phone -replace '\D', '')
    fax         = ($s.fax   -replace '\D', '')
    website     = $web
    province_th = $prov
    region      = $region
  }
}

$ordered = $clean | Sort-Object { $_.region }, province_th, name
$json = $ordered | ConvertTo-Json -Compress -Depth 3
[System.IO.File]::WriteAllText($OutJson, $json, $utf8NoBom)
[System.IO.File]::WriteAllText($OutJs, "window.STATIONS = $json;" + [Environment]::NewLine, $utf8NoBom)

$props = ($ordered | Group-Object province_th).Count
Write-Output ("stations.js/stations.json written. records={0} provinces={1}" -f $ordered.Count, $props)
