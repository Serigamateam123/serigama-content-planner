# Serigama Content Planner - Windows launcher.
# Starts a tiny local web server for this folder (no Python/Node needed) and
# opens the planner in its own app window. If the server is already running,
# it just opens the window again.

$ErrorActionPreference = 'Stop'
$Port = 8777
$Url  = "http://localhost:$Port/"
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'

function Open-PlannerWindow {
  $edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { Start-Process $edge "--app=$Url" } else { Start-Process $Url }
}

# Already running? Just open a window.
try {
  Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2 | Out-Null
  Open-PlannerWindow
  exit
} catch {}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.md'   = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Url)
$listener.Start()
Open-PlannerWindow

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $path = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
    # Clean URLs (e.g. /privacy -> public/privacy.html), like the Vercel setup.
    if (-not (Test-Path $path -PathType Leaf)) {
      foreach ($alt in @("$path.html", (Join-Path $Root "public\$rel.html"))) {
        $alt = [System.IO.Path]::GetFullPath($alt)
        if (Test-Path $alt -PathType Leaf) { $path = $alt; break }
      }
    }
    if ($path.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $path -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-store, must-revalidate')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.Close()
  }
}
