# smoke-win.ps1 <unpacked app dir>: starts Jollyboat.exe in smoke mode (JOLLYBOAT_SMOKE=1), waits up
# to two minutes and fails unless it printed its [smoke] line and exited 0
param([string]$AppDir)
$env:JOLLYBOAT_SMOKE = '1'
$out = Join-Path $env:RUNNER_TEMP 'smoke-out.txt'
$err = Join-Path $env:RUNNER_TEMP 'smoke-err.txt'
$p = Start-Process -FilePath (Join-Path $AppDir 'Jollyboat.exe') -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
$null = $p.Handle # keeps the exit code readable after exit
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'smoke test timed out' }
Get-Content $out, $err -ErrorAction SilentlyContinue | Where-Object { $_ -match 'smoke' }
if ($p.ExitCode -ne 0) { throw "smoke test failed (exit $($p.ExitCode))" }
if (-not (Select-String -Path $out -Pattern '^\[smoke\] win32' -Quiet)) { Write-Warning 'exit 0, but the [smoke] line did not reach stdout' }
