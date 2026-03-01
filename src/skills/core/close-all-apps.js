/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: close-all-apps
 *  Close all visible user applications.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { runPowerShell } = require('./_shared');

module.exports = {
    schema: z.object({}),
    name: 'closeAllApps',
    description: 'Close all visible user applications',
    tags: ['app', 'close', 'all'],

    returnType: 'action',
    marker: 'confirm',
    ui: null,

    examples: [

        { user: 'close all apps', action: '[action: closeAllApps]' },

        { user: 'shut down everything', action: '[action: closeAllApps]' },

    ],


    async handler() {
        const psScript = `
$excluded = @('explorer', 'venesa', 'powershell', 'pwsh', 'conhost', 'cmd', 'svchost', 'System', 'Idle', 'dwm', 'taskhostw', 'sihost', 'ctfmon', 'RuntimeBroker', 'ShellExperienceHost', 'StartMenuExperienceHost', 'SearchHost', 'TextInputHost', 'SecurityHealthTray', 'SystemSettings')
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $excluded -notcontains $_.ProcessName }
$count = 0
foreach ($p in $procs) {
    try { if ($p.CloseMainWindow()) { $count++ } } catch {}
}
@{ success = $true; closed = $count } | ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript, 15000);
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
