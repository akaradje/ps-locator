<# Static file server สำหรับ PS Locator — ใช้ PowerShell ล้วน ไม่ต้องติดตั้งอะไร #>
param([int]$Port = 8123, [string]$Root = "$PSScriptRoot\..")

$Root = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $Root at http://localhost:$Port/"

$mime = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
  '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'; '.webmanifest'='application/manifest+json';
  '.png'='image/png'; '.ico'='image/x-icon'; '.pdf'='application/pdf'; '.csv'='text/csv; charset=utf-8'; '.md'='text/markdown; charset=utf-8'
}
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
      $path = Join-Path $Root $rel
      if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or -not ([IO.Path]::GetFullPath($path).StartsWith($Root))) {
        $ctx.Response.StatusCode = 404; $ctx.Response.Close(); continue
      }
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
      $ctx.Response.ContentType = $mime[$ext]
      if (-not $ctx.Response.ContentType) { $ctx.Response.ContentType = 'application/octet-stream' }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    } catch { try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {} }
  }
} finally { $listener.Stop() }
