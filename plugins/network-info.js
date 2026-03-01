/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-network-info
 *  Get network adapter and IP address info.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const powershell = require('../src/lib/powershell');
const runPowerShell = (script, args, timeout = 30000) => powershell.execute(script, args || [], timeout);

module.exports = {
    schema: z.object({}),
    name: 'getNetworkInfo',
    description: 'Get network adapter and IP address info',
    tags: ['system', 'network', 'wifi'],

    returnType: 'data',
    marker: 'silently',
    ui: 'key-value',

    examples: [

        { user: 'show my network info', action: '[action: getNetworkInfo]' },

    ],


    async handler() {
        const psScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name, InterfaceDescription, Status, LinkSpeed
$ipConfig = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object IPAddress, InterfaceAlias
@{
    adapters = $adapters
    ip = $ipConfig
} | ConvertTo-Json -Compress -Depth 3
`;
        try {
            return await runPowerShell(psScript, [], 10000);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    },
};
