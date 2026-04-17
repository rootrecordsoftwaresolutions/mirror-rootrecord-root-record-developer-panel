param(
  [string]$ReleaseNotes = ""
)

$ErrorActionPreference = "Stop"

function Bump-PatchVersion([string]$v) {
  $parts = $v.Split(".")
  if ($parts.Length -lt 3) {
    throw "Version '$v' is not semver-like (x.y.z)."
  }
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  $patch = [int]$parts[2]
  $patch += 1
  return "$major.$minor.$patch"
}

function Replace-First([string]$text, [string]$pattern, [string]$replacement) {
  $regex = [regex]::new($pattern)
  return $regex.Replace($text, $replacement, 1)
}

function Invoke-Gh([string[]]$Args) {
  & gh @Args
  if ($LASTEXITCODE -ne 0) {
    throw ("gh " + ($Args -join " ") + " failed with exit code " + $LASTEXITCODE)
  }
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== Root Record Developer Panel One-Click Release ==="

$pkgPath = Join-Path $root "package.json"
$lockPath = Join-Path $root "package-lock.json"
$pkgRaw = Get-Content $pkgPath -Raw
$pkgObj = $pkgRaw | ConvertFrom-Json
$currentVersion = [string]$pkgObj.version
$newVersion = Bump-PatchVersion $currentVersion

$pkgUpdated = Replace-First $pkgRaw '"version"\s*:\s*"[^"]+"' ('"version": "' + $newVersion + '"')
Set-Content -Path $pkgPath -Value $pkgUpdated -NoNewline

$lockRaw = Get-Content $lockPath -Raw
$lockUpdated = Replace-First $lockRaw '"version"\s*:\s*"[^"]+"' ('"version": "' + $newVersion + '"')
$lockUpdated = Replace-First $lockUpdated '(""\s*:\s*\{[\s\S]*?"version"\s*:\s*)"[^"]+"' ('$1"' + $newVersion + '"')
Set-Content -Path $lockPath -Value $lockUpdated -NoNewline

Write-Host "Version bumped: $currentVersion -> $newVersion"

Write-Host ""
Write-Host "Building installer..."
npm run build:installer

$installer = Join-Path $root "dist-installer\RootRecordDeveloperPanelSetup.exe"
if (!(Test-Path $installer)) {
  throw "Installer not found: $installer"
}

Write-Host ""
Write-Host "Committing and pushing..."
git add -A
git commit -m "Release v$newVersion" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "git commit failed. Resolve commit issues and rerun."
}
git push origin main
if ($LASTEXITCODE -ne 0) {
  throw "git push failed. Resolve push issues and rerun."
}

$tag = "v$newVersion"
$title = "Root Record Developer Panel $tag"

if ([string]::IsNullOrWhiteSpace($ReleaseNotes)) {
  Write-Host ""
  Write-Host "Enter release notes (single line)."
  Write-Host "Press Enter for default notes."
  $inputNotes = Read-Host "Release notes"
  if ([string]::IsNullOrWhiteSpace($inputNotes)) {
    $ReleaseNotes = "Automated one-click release build for $tag."
  } else {
    $ReleaseNotes = $inputNotes
  }
}

Write-Host ""
Write-Host "Publishing GitHub release $tag..."
$existing = $null
& gh release view $tag --json url | Out-Null
if ($LASTEXITCODE -eq 0) {
  $existing = $true
}

if ($existing) {
  Invoke-Gh @("release", "edit", $tag, "--title", $title, "--notes", $ReleaseNotes)
  Invoke-Gh @("release", "upload", $tag, $installer, "--clobber")
} else {
  Invoke-Gh @("release", "create", $tag, $installer, "--title", $title, "--notes", $ReleaseNotes)
}

$releaseUrl = gh release view $tag --json url --jq ".url"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releaseUrl)) {
  throw "Release created/updated but URL lookup failed."
}
Write-Host ""
Write-Host "Release complete: $releaseUrl"
