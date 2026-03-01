/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-installed-apps
 *  List installed applications.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const powershell = require('../src/lib/powershell');
const runPowerShell = (script, args, timeout = 30000) => powershell.execute(script, args || [], timeout);

module.exports = {
    schema: z.object({}),
    name: 'getInstalledApps',
    description: 'List installed applications',
    tags: ['app', 'installed', 'list'],

    returnType: 'data',
    marker: 'silently',
    ui: 'card-list',

    examples: [

        { user: 'what apps are installed', action: '[action: getInstalledApps]' },

    ],


    async handler() {
        const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$paths = @(
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
@($paths | ForEach-Object { Get-ItemProperty $_ } |
Where-Object { $_.DisplayName -ne $null -and $_.DisplayName -ne '' } |
Select-Object @{N='Name';E={$_.DisplayName}}, @{N='Version';E={$_.DisplayVersion}}, Publisher |
Sort-Object Name -Unique |
Select-Object -First 50) | ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript, [], 30000);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    },
};
