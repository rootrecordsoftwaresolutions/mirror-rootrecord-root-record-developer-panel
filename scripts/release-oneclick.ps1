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
git push origin main

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
try {
  gh release view $tag | Out-Null
  gh release edit $tag --title $title --notes $ReleaseNotes
  gh release upload $tag $installer --clobber
}
catch {
  gh release create $tag $installer --title $title --notes $ReleaseNotes
}

$releaseUrl = gh release view $tag --json url --jq ".url"
Write-Host ""
Write-Host "Release complete: $releaseUrl"
