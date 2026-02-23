/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: close-app
 *  Close a specific application by name.
 * ═══════════════════════════════════════════════════════════════
 */

const { runPowerShell, escapeForPowerShell } = require('./_shared');

module.exports = {
    name: 'closeApp',
    description: 'Close a specific running application by name',
    tags: ['app', 'close', 'kill'],
    permission: 'normal',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const appName = params?.appName;
        if (!appName || typeof appName !== 'string') {
            return JSON.stringify({ success: false, error: 'No app name provided.' });
        }

        const safeName = escapeForPowerShell(appName.trim());
        const psScript = `
$procs = Get-Process | Where-Object { $_.ProcessName -like '*${safeName}*' -or $_.MainWindowTitle -like '*${safeName}*' } | Where-Object { $_.MainWindowHandle -ne 0 }
if ($procs) {
    $procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    @{ success = $true; closed = '${safeName}'; count = $procs.Count } | ConvertTo-Json -Compress
} else {
    @{ success = $false; error = "No running app found matching: ${safeName}" } | ConvertTo-Json -Compress
}
`;
        try {
            return await runPowerShell(psScript, 10000);
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
