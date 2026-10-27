#Requires -Version 5.1
# Start the Family Bucket dev server and open Vrbo left/right
# in borderless fullscreen (kiosk) windows:
#   vrbo-left  -> 2nd display to the right of the main screen
#   vrbo-right -> 1st display to the right of the main screen

$ErrorActionPreference = "Stop"
$LogPath = Join-Path $env:TEMP "vrbo-demo-launch.log"

# Per-monitor DPI awareness MUST be set before System.Windows.Forms is loaded.
# Without it, mixed-DPI monitors report scaled (virtual) sizes/positions, and
# Chrome's --window-position then lands both windows on the same screen.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class VrboWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(
    IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

  public static IntPtr FindChromeWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      StringBuilder sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      if (sb.ToString() == "Chrome_WidgetWin_1") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
# -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
[VrboWin]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null

function Write-Step([string]$Message) {
  $line = "[vrbo-demo] $Message"
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format o) $line" -ErrorAction SilentlyContinue
}

try {
  Set-Content -LiteralPath $LogPath -Value "$(Get-Date -Format o) start" -ErrorAction SilentlyContinue

  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  # Dev split: Express API on 3002, Vite SPA on 5188.
  # Browser pages must hit Vite; 3002/vrbo-left returns Cannot GET in dev.
  $ApiPort = 3002
  $VitePort = 5188
  $LeftUrl = "http://localhost:$VitePort/vrbo-left"
  $RightUrl = "http://localhost:$VitePort/vrbo-right"
  $LeftProfile = Join-Path $env:TEMP "vrbo-demo-left"
  $RightProfile = Join-Path $env:TEMP "vrbo-demo-right"

  function Find-Browser {
    $candidates = @(
      "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($path in $candidates) {
      if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
    throw "Chrome or Edge not found. Install Google Chrome or Microsoft Edge."
  }

  function Find-Npm {
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
      "$env:APPDATA\npm\npm.cmd",
      "${env:ProgramFiles}\nodejs\npm.cmd",
      "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
    )
    foreach ($path in $candidates) {
      if (Test-Path -LiteralPath $path) { return $path }
    }
    throw "npm not found. Open a terminal, run npm -v, then try again."
  }

  function Test-PortOpen([int]$PortToCheck) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $iar = $client.BeginConnect("127.0.0.1", $PortToCheck, $null, $null)
      $ok = $iar.AsyncWaitHandle.WaitOne(400)
      if ($ok -and $client.Connected) {
        $client.EndConnect($iar)
        $client.Close()
        return $true
      }
      $client.Close()
    } catch {}
    return $false
  }

  function Wait-ForPort([int]$PortToCheck, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
      if (Test-PortOpen $PortToCheck) { return }
      Start-Sleep -Milliseconds 500
    }
    throw "Port $PortToCheck did not become ready within ${TimeoutSec}s."
  }

  function Get-MonitorBounds {
    Add-Type -AssemblyName System.Windows.Forms
    $screens = [System.Windows.Forms.Screen]::AllScreens
    if (-not $screens -or $screens.Count -eq 0) {
      throw "No displays detected."
    }

    # Windows device names (\\.\DISPLAY5, ...) are NOT stable, so pick by physical
    # position: the monitors to the right of the main screen, nearest first.
    #   1st to the right of main -> vrbo-right (search)
    #   2nd to the right of main -> vrbo-left  (chat)
    $primary = $screens | Where-Object { $_.Primary } | Select-Object -First 1
    $rightOfMain = @(
      $screens |
        Where-Object { -not $_.Primary -and $_.Bounds.X -ge $primary.Bounds.X } |
        Sort-Object { $_.Bounds.X }, { $_.Bounds.Y }
    )
    if ($rightOfMain.Count -lt 2) {
      throw "Need 2 displays to the right of the main screen (found $($rightOfMain.Count)). Connected: $(($screens | ForEach-Object { $_.DeviceName }) -join ', ')"
    }

    $monitorForRight = $rightOfMain[0]
    $monitorForLeft = $rightOfMain[1]

    return @{
      Left  = $monitorForLeft.Bounds
      Right = $monitorForRight.Bounds
      Count = $screens.Count
      Labels = @{
        Left  = $monitorForLeft.DeviceName
        Right = $monitorForRight.DeviceName
      }
    }
  }

  function Start-DevServerIfNeeded {
    $apiUp = Test-PortOpen $ApiPort
    $viteUp = Test-PortOpen $VitePort
    if ($apiUp -and $viteUp) {
      Write-Step "Dev already running (API :$ApiPort, Vite :$VitePort)"
      return
    }

    if (-not $apiUp -or -not $viteUp) {
      $npm = Find-Npm
      Write-Step "Starting npm run dev via $npm"
      Start-Process `
        -FilePath $npm `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Minimized | Out-Null
    }

    Write-Step "Waiting for API :$ApiPort ..."
    Wait-ForPort $ApiPort
    Write-Step "Waiting for Vite :$VitePort ..."
    Wait-ForPort $VitePort
    Write-Step "Ready - opening $LeftUrl and $RightUrl"
  }

  function Start-KioskWindow {
    param(
      [string]$Browser,
      [string]$Url,
      [string]$UserDataDir,
      [System.Drawing.Rectangle]$Bounds
    )

    if (-not (Test-Path -LiteralPath $UserDataDir)) {
      New-Item -ItemType Directory -Path $UserDataDir | Out-Null
    }

    # Size/position here are only a starting hint (Chrome reads them in scaled units).
    # The window is moved to the exact physical monitor rect after launch.
    $w = [Math]::Max(1, $Bounds.Width + 4)
    $h = [Math]::Max(1, $Bounds.Height + 4)
    $argList = @(
      "--user-data-dir=$UserDataDir",
      "--new-window",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--disable-features=TranslateUI",
      "--autoplay-policy=no-user-gesture-required",
      "--window-position=$($Bounds.X),$($Bounds.Y)",
      "--window-size=$w,$h",
      "--kiosk",
      $Url
    )

    $proc = Start-Process -FilePath $Browser -ArgumentList $argList -PassThru
    Move-WindowToMonitor -ProcessId $proc.Id -Bounds $Bounds -Label $Url
  }

  # Chrome ignores/misreads --window-position on mixed-DPI setups, so place the
  # window ourselves in physical pixels (we are per-monitor DPI aware).
  function Move-WindowToMonitor {
    param(
      [int]$ProcessId,
      [System.Drawing.Rectangle]$Bounds,
      [string]$Label
    )
    $SWP_NOZORDER = 0x0004
    $SWP_SHOWWINDOW = 0x0040
    $hwnd = [IntPtr]::Zero
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      $hwnd = [VrboWin]::FindChromeWindow([uint32]$ProcessId)
      if ($hwnd -ne [IntPtr]::Zero) { break }
      Start-Sleep -Milliseconds 200
    }
    if ($hwnd -eq [IntPtr]::Zero) {
      Write-Step "WARN: no Chrome window found for $Label (pid $ProcessId); leaving placement to Chrome."
      return
    }
    # Re-apply a few times: kiosk/fullscreen startup can nudge the window after first show.
    for ($i = 0; $i -lt 6; $i++) {
      [VrboWin]::SetWindowPos(
        $hwnd, [IntPtr]::Zero,
        $Bounds.X, $Bounds.Y, $Bounds.Width, $Bounds.Height,
        ($SWP_NOZORDER -bor $SWP_SHOWWINDOW)
      ) | Out-Null
      Start-Sleep -Milliseconds 400
    }
    Write-Step ("Placed {0} at {1},{2} {3}x{4}" -f $Label, $Bounds.X, $Bounds.Y, $Bounds.Width, $Bounds.Height)
  }

  Write-Step "Repo: $RepoRoot"
  Write-Step "Left URL:  $LeftUrl"
  Write-Step "Right URL: $RightUrl"
  $browser = Find-Browser
  Write-Step "Browser: $browser"

  $monitors = Get-MonitorBounds
  $leftBounds = $monitors.Left
  $rightBounds = $monitors.Right
  Write-Step ("1st right of main ({0}): {1}x{2} at {3},{4} → vrbo-right" -f $monitors.Labels.Right, $rightBounds.Width, $rightBounds.Height, $rightBounds.X, $rightBounds.Y)
  Write-Step ("2nd right of main ({0}): {1}x{2} at {3},{4} → vrbo-left" -f $monitors.Labels.Left, $leftBounds.Width, $leftBounds.Height, $leftBounds.X, $leftBounds.Y)

  Start-DevServerIfNeeded

  Write-Step "Opening vrbo-left on the 2nd display right of main (kiosk)..."
  Start-KioskWindow -Browser $browser -Url $LeftUrl -UserDataDir $LeftProfile -Bounds $monitors.Left
  Start-Sleep -Milliseconds 700
  Write-Step "Opening vrbo-right on the 1st display right of main (kiosk)..."
  Start-KioskWindow -Browser $browser -Url $RightUrl -UserDataDir $RightProfile -Bounds $monitors.Right

  Write-Step "Done. Press Esc in a kiosk window to exit that window."
  exit 0
}
catch {
  $msg = $_.Exception.Message
  Write-Step "ERROR: $msg"
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "Vrbo Demo failed to launch:`n`n$msg`n`nLog: $LogPath",
      "Vrbo Demo",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
    # last resort
  }
  exit 1
}
