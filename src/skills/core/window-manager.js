/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: window-manager
 *  Move, resize, snap, and control application windows.
 *  PowerToys FancyZones replacement — voice-controlled.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { runPowerShell } = require('./_shared');

const COMMANDS = [
    'snap-left', 'snap-right', 'snap-top', 'snap-bottom',
    'snap-top-left', 'snap-top-right', 'snap-bottom-left', 'snap-bottom-right',
    'maximize', 'minimize', 'restore', 'center',
    'close', 'always-on-top', 'move-to-monitor',
];

module.exports = {
    schema: z.object({
        appName: z.string().describe('Window/app name to control'),
        command: z.enum(COMMANDS).describe('Window command'),
        monitor: z.number().optional().describe('Target monitor number for move-to-monitor'),
    }),
    name: 'windowManager',
    description: 'Snap, resize, move, minimize, maximize, pin windows. Commands: ' + COMMANDS.join(', '),
    tags: ['window', 'snap', 'resize', 'move', 'tile', 'minimize', 'maximize', 'always-on-top'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'snap Chrome to the left', action: '[action: windowManager, appName: Chrome, command: snap-left]' },

        { user: 'maximize Notepad', action: '[action: windowManager, appName: Notepad, command: maximize]' },

    ],


    async handler(params) {
        const { appName, command, monitor } = params;

        const psScript = `
param($AppName, $Command, $Monitor)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int W, int H, bool repaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern int SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

Add-Type -AssemblyName System.Windows.Forms

# Find window
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$AppName*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) {
    @{ success = $false; error = "No window found matching '$AppName'" } | ConvertTo-Json -Compress
    return
}

$hwnd = $proc.MainWindowHandle

# Get screen info
$screens = [System.Windows.Forms.Screen]::AllScreens
$currentScreen = [System.Windows.Forms.Screen]::FromHandle($hwnd)
$wa = $currentScreen.WorkingArea

# Restore if minimized
if ([WinAPI]::IsIconic($hwnd)) { [WinAPI]::ShowWindow($hwnd, 9) }

switch ($Command) {
    'snap-left'         { [WinAPI]::MoveWindow($hwnd, $wa.X, $wa.Y, [int]($wa.Width/2), $wa.Height, $true) }
    'snap-right'        { [WinAPI]::MoveWindow($hwnd, $wa.X + [int]($wa.Width/2), $wa.Y, [int]($wa.Width/2), $wa.Height, $true) }
    'snap-top'          { [WinAPI]::MoveWindow($hwnd, $wa.X, $wa.Y, $wa.Width, [int]($wa.Height/2), $true) }
    'snap-bottom'       { [WinAPI]::MoveWindow($hwnd, $wa.X, $wa.Y + [int]($wa.Height/2), $wa.Width, [int]($wa.Height/2), $true) }
    'snap-top-left'     { [WinAPI]::MoveWindow($hwnd, $wa.X, $wa.Y, [int]($wa.Width/2), [int]($wa.Height/2), $true) }
    'snap-top-right'    { [WinAPI]::MoveWindow($hwnd, $wa.X + [int]($wa.Width/2), $wa.Y, [int]($wa.Width/2), [int]($wa.Height/2), $true) }
    'snap-bottom-left'  { [WinAPI]::MoveWindow($hwnd, $wa.X, $wa.Y + [int]($wa.Height/2), [int]($wa.Width/2), [int]($wa.Height/2), $true) }
    'snap-bottom-right' { [WinAPI]::MoveWindow($hwnd, $wa.X + [int]($wa.Width/2), $wa.Y + [int]($wa.Height/2), [int]($wa.Width/2), [int]($wa.Height/2), $true) }
    'maximize'          { [WinAPI]::ShowWindow($hwnd, 3) }
    'minimize'          { [WinAPI]::ShowWindow($hwnd, 6) }
    'restore'           { [WinAPI]::ShowWindow($hwnd, 9) }
    'center' {
        $rect = New-Object WinAPI+RECT
        [WinAPI]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
        $ww = $rect.Right - $rect.Left
        $wh = $rect.Bottom - $rect.Top
        $cx = $wa.X + [int](($wa.Width - $ww) / 2)
        $cy = $wa.Y + [int](($wa.Height - $wh) / 2)
        [WinAPI]::MoveWindow($hwnd, $cx, $cy, $ww, $wh, $true)
    }
    'close' {
        $proc.CloseMainWindow() | Out-Null
    }
    'always-on-top' {
        $TOPMOST = [IntPtr]::new(-1)
        $SWP_NOSIZE = 0x0001; $SWP_NOMOVE = 0x0002
        [WinAPI]::SetWindowPos($hwnd, $TOPMOST, 0, 0, 0, 0, $SWP_NOSIZE -bor $SWP_NOMOVE)
    }
    'move-to-monitor' {
        $targetIdx = if ($Monitor) { $Monitor - 1 } else { 0 }
        if ($targetIdx -ge 0 -and $targetIdx -lt $screens.Count) {
            $twa = $screens[$targetIdx].WorkingArea
            $rect = New-Object WinAPI+RECT
            [WinAPI]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
            $ww = $rect.Right - $rect.Left
            $wh = $rect.Bottom - $rect.Top
            [WinAPI]::MoveWindow($hwnd, $twa.X + 50, $twa.Y + 50, $ww, $wh, $true)
        } else {
            @{ success = $false; error = "Invalid monitor $Monitor. Available: 1-$($screens.Count)" } | ConvertTo-Json -Compress
            return
        }
    }
}

# Only bring to foreground for actions that need it (not close/minimize)
if ($Command -ne 'close' -and $Command -ne 'minimize') {
    [WinAPI]::SetForegroundWindow($hwnd) | Out-Null
}
@{ success = $true; window = $proc.MainWindowTitle; command = $Command } | ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript, [appName, command, String(monitor ?? 1)], 10000);
        } catch (e) {
            return JSON.stringify({ success: false, error: e?.message ?? String(e) });
        }
    },
};
