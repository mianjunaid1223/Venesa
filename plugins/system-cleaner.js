/**
 * ═══════════════════════════════════════════════════════════════
 *  PLUGIN: system-cleaner
 *  Clean temp files, browser caches, recycle bin, logs.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const powershell = require('../src/lib/powershell');
const runPowerShell = (script, args, timeout = 30000) => powershell.execute(script, args || [], timeout);

module.exports = {
    name: 'systemCleaner',
    description: 'Clean temp files, browser caches, recycle bin. Recovers disk space. Operations: scan, clean, empty-recycle-bin',
    tags: ['clean', 'temp', 'cache', 'recycle', 'space', 'junk'],

    returnType: 'hybrid',
    marker: 'announce',
    ui: 'key-value',

    schema: z.object({
        operation: z.enum(['scan', 'clean', 'empty-recycle-bin']).describe('scan to preview, clean to delete, empty-recycle-bin to empty trash'),
    }),

    async handler(params) {
        const { operation } = params;

        if (operation === 'empty-recycle-bin') {
            const ps = `
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
@{ success = $true; action = 'Recycle bin emptied' } | ConvertTo-Json -Compress
`;
            return await runPowerShell(ps, [], 15000);
        }

        const targetsBlock = `
$targets = @(
    @{ name = 'Windows Temp';       path = "$env:TEMP" },
    @{ name = 'System Temp';        path = "C:\\Windows\\Temp" },
    @{ name = 'Prefetch';           path = "C:\\Windows\\Prefetch" },
    @{ name = 'Thumbnails';         path = "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer" },
    @{ name = 'Chrome Cache';       path = "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Cache" },
    @{ name = 'Edge Cache';         path = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Cache" },
    @{ name = 'Recent Files';       path = "$env:APPDATA\\Microsoft\\Windows\\Recent" }
)
`;

        if (operation === 'scan') {
            const ps = targetsBlock + `
$results = @()
$totalSize = 0
foreach ($t in $targets) {
    if (Test-Path $t.path) {
        $size = (Get-ChildItem -Path $t.path -Recurse -Force -ErrorAction SilentlyContinue |
                 Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        if ($null -eq $size) { $size = 0 }
        $totalSize += $size
        $results += @{ name = $t.name; sizeMB = [math]::Round($size / 1MB, 2); path = $t.path }
    }
}
@{ operation = 'scan'; targets = $results; totalRecoverableMB = [math]::Round($totalSize / 1MB, 2) } | ConvertTo-Json -Compress -Depth 3
`;
            return await runPowerShell(ps, [], 30000);
        }

        if (operation === 'clean') {
            const ps = targetsBlock + `
$deletedFiles = 0
$freedBytes = 0
foreach ($t in $targets) {
    if (Test-Path $t.path) {
        $files = Get-ChildItem -Path $t.path -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer }
        foreach ($f in $files) {
            try {
                $fSize = $f.Length
                Remove-Item $f.FullName -Force -ErrorAction Stop
                $deletedFiles++
                $freedBytes += $fSize
            } catch { }
        }
    }
}
@{ operation = 'clean'; deletedFiles = $deletedFiles; freedMB = [math]::Round($freedBytes / 1MB, 2) } | ConvertTo-Json -Compress
`;
            return await runPowerShell(ps, [], 60000);
        }

        return JSON.stringify({ error: 'Unknown operation' });
    },
};
