/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: launch-app
 *  Search for and launch an application by name.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { runPowerShell, escapeForPowerShell } = require('./_shared');

module.exports = {
    schema: z.object({ appName: z.string().describe('The exact name of the application to launch') }),
    name: 'launchApplication',
    description: 'Search for and launch an application by name',
    tags: ['app', 'launch', 'open'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const appName = params?.appName;
        if (!appName || typeof appName !== 'string') {
            return JSON.stringify({ success: false, error: 'No app name provided.' });
        }

        const safeName = escapeForPowerShell(appName.trim());
        const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$found = $null

# 1. Search Start Menu shortcuts
$startPaths = @(
    [Environment]::GetFolderPath('CommonStartMenu'),
    [Environment]::GetFolderPath('StartMenu')
)
foreach ($sp in $startPaths) {
    $shortcuts = Get-ChildItem -Path $sp -Recurse -Include '*.lnk' -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -match '${safeName}' } |
        Select-Object -First 1
    if ($shortcuts) {
        $found = $shortcuts.FullName
        break
    }
}

# 2. Search PATH
if (-not $found) {
    $cmd = Get-Command -Name '*${safeName}*' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $found = $cmd.Source }
}

# 3. Search registry
if (-not $found) {
    $regPaths = @(
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\*',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\*'
    )
    foreach ($rp in $regPaths) {
        $match = Get-ItemProperty -Path $rp -ErrorAction SilentlyContinue |
            Where-Object { $_.PSChildName -match '${safeName}' } |
            Select-Object -First 1
        if ($match -and $match.'(default)') {
            $found = $match.'(default)'
            break
        }
    }
}

if ($found) {
    Start-Process $found
    @{ success = $true; launched = '${safeName}'; path = $found } | ConvertTo-Json -Compress
} else {
    @{ success = $false; error = "Could not find application: ${safeName}" } | ConvertTo-Json -Compress
}
`;
        try {
            return await runPowerShell(psScript, 15000);
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
