/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-network-info
 *  Get network adapter and IP address info.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { runPowerShell } = require('./_shared');

module.exports = {
    schema: z.object({}),
    name: 'getNetworkInfo',
    description: 'Get network adapter and IP address info',
    tags: ['system', 'network', 'wifi'],

    returns: 'data',
    marker: 'silently',
    ui: 'key-value',

    async handler() {
        const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name, InterfaceDescription, Status, LinkSpeed
$ipConfig = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object IPAddress, InterfaceAlias
@{
    adapters = $adapters
    ip = $ipConfig
} | ConvertTo-Json -Compress -Depth 3
`;
        try {
            return await runPowerShell(psScript, 10000);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    },
};
