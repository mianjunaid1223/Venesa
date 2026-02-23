/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: list-running-apps
 *  List currently running visible applications.
 * ═══════════════════════════════════════════════════════════════
 */

const { runPowerShell } = require('./_shared');

module.exports = {
    name: 'listRunningApps',
    description: 'List currently running visible applications',
    tags: ['system', 'apps', 'running'],
    permission: 'safe',
    marker: 'announce',
    ui: 'card-list',

    async handler() {
        const psScript = `
$excluded = @('explorer', 'powershell', 'pwsh', 'conhost', 'cmd', 'svchost', 'System', 'Idle', 'dwm')
@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $excluded -notcontains $_.ProcessName } |
Select-Object ProcessName, MainWindowTitle, @{N='MemoryMB';E={[math]::round($_.WorkingSet64/1MB,1)}} |
Sort-Object MemoryMB -Descending) | ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript, 10000);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    },
};
