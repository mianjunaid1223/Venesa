/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-disk-info
 *  Get disk usage information.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const powershell = require('../src/lib/powershell');
const runPowerShell = (script, args, timeout = 30000) => powershell.execute(script, args || [], timeout);

module.exports = {
    schema: z.object({}),
    name: 'getDiskInfo',
    description: 'Get disk usage information',
    tags: ['system', 'disk', 'storage'],
    returnType: 'data',
    marker: 'silently',
    ui: 'key-value',

    examples: [

        { user: 'how much disk space do I have', action: '[action: getDiskInfo]' },

    ],


    async handler() {
        const psScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
Select-Object DeviceID,
  @{N='SizeGB';E={[math]::round($_.Size/1GB,1)}},
  @{N='FreeGB';E={[math]::round($_.FreeSpace/1GB,1)}},
  @{N='UsedPercent';E={if($_.Size -gt 0){[math]::round((($_.Size-$_.FreeSpace)/$_.Size)*100,1)}else{0}}}) |
ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript, [], 10000);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    },
};
