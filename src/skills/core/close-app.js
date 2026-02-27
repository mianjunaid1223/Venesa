/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: close-app
 *  Close a specific application by name.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { runPowerShell, escapeForPowerShell } = require('./_shared');

module.exports = {
    schema: z.object({ appName: z.string().trim().min(1).describe('The name of the application to close') }),
    name: 'closeApp',
    description: 'Close a specific running application by name',
    tags: ['app', 'close', 'kill'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const appName = params?.appName;
        if (!appName || typeof appName !== 'string') {
            return JSON.stringify({ success: false, error: 'No app name provided.' });
        }

        const safeName = escapeForPowerShell(appName.trim());
        if (!safeName) return JSON.stringify({ success: false, error: 'Invalid app name provided.' });
        const psScript = `
$appName = '${safeName}'
$procs = Get-Process | Where-Object { $_.ProcessName -like "*$appName*" -or $_.MainWindowTitle -like "*$appName*" } | Where-Object { $_.MainWindowHandle -ne 0 }
if ($procs) {
    $procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    @{ success = $true; closed = $appName; count = $procs.Count } | ConvertTo-Json -Compress
} else {
    @{ success = $false; error = "No running app found matching: $appName" } | ConvertTo-Json -Compress
}
`;
        try {
            return await runPowerShell(psScript, [], 10000);
        } catch (e) {
            return JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    },
};
