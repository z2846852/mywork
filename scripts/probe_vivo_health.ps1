# Windows PowerShell: vivo Health read-only provider probe for BodyTrace.
# Run -Grant only if you explicitly want to attempt an ADB permission grant.
param([switch]$Grant, [string]$Serial = "")
$ErrorActionPreference = "Stop"
$package = "com.z2846852.bodytrace"
$permission = "com.vivo.health.widget.permission"
$authority = "com.vivo.health.provider"
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { throw "adb not found" }
$deviceArgs = @()
if ($Serial) { $deviceArgs = @("-s", $Serial) }
$devices = @(adb devices | Select-String "^\S+\s+device$" | ForEach-Object { ($_.Line -split "\s+")[0] })
if ($devices.Count -ne 1 -and -not $Serial) { throw "Connect one device or use -Serial" }
Write-Host "Phone: $(& adb @deviceArgs shell getprop ro.product.model)"
Write-Host "Android: $(& adb @deviceArgs shell getprop ro.build.version.release)"
$installed = (& adb @deviceArgs shell pm path $package) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0 -or $installed -notmatch "package:") { throw "Install BodyTrace APK first" }
$providerInfo = (& adb @deviceArgs shell dumpsys package providers) -join [Environment]::NewLine
if ($providerInfo -notmatch [regex]::Escape($authority)) {
  Write-Host "UNSUPPORTED: Provider not present"
  exit 2
}
Write-Host "Provider found: $authority"
if ($Grant) {
  Write-Host "Attempting owner ADB grant. ROM may refuse signature permissions."
  & adb @deviceArgs shell pm grant $package $permission
  Write-Host "Command exit code: $LASTEXITCODE (not proof of grant)"
}
$state = (& adb @deviceArgs shell dumpsys package $package) -join [Environment]::NewLine
$lines = @($state -split "\r?\n" | Where-Object { $_ -match [regex]::Escape($permission) })
$grants = @($lines | Where-Object { $_ -match "granted=(true|false)" -and $_ -notmatch "userId=" })
$success = @($grants | Where-Object { $_ -match "granted=true" }).Count -gt 0
if ($success) {
  Write-Host "PASS: private-provider permission granted for the primary user."
  Write-Host "Open BodyTrace > Sleep > vivo WATCH 5 and tap read."
} else {
  Write-Host "NOT_GRANTED: cannot verify private-provider permission."
  Write-Host "If -Grant failed, no third-party read path is confirmed on this ROM."
}
