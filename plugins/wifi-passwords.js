/**
 * ═══════════════════════════════════════════════════════════════
 *  PLUGIN: wifi-passwords
 *  Retrieve saved WiFi network passwords.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const powershell = require('../src/lib/powershell');
const logger = require('../src/lib/logger');
const runPowerShell = (script, args, timeout = 30000) => powershell.execute(script, args || [], timeout);

module.exports = {
    name: 'wifiPasswords',
    description: 'Retrieve saved WiFi passwords. Use without params to list all networks, or specify a network name.',
    tags: ['wifi', 'password', 'network', 'internet'],

    returnType: 'data',
    marker: 'confirm',
    ui: 'table',

    schema: z.object({
        networkName: z.string().optional().describe('Specific WiFi network name, or empty for all'),
    }),

    examples: [

        { user: 'show saved wifi passwords', action: '[action: wifiPasswords]' },

    ],


    async handler(params) {
        const { networkName } = params || {};

        logger.info(`[wifi-passwords] Retrieving WiFi passwords (network: ${networkName || 'all'})`);

        const psScript = networkName
            ? `
param($NetName)
$profile = netsh wlan show profile name="$NetName" key=clear 2>&1
$keyLine = ($profile | Where-Object { $_ -match ':\\s' } | Where-Object { $_ -match 'Key Content|Contenu de la|Schlüsselinhalt|Contenido de la clave|Clé de sécurité' }) -replace '.*:\\s*', ''
if (-not $keyLine) {
    $keyLine = 'UNKNOWN'
}
if ($keyLine -and $keyLine -ne 'UNKNOWN') {
    @{ network = $NetName; hasPassword = $true; password = '***REDACTED***' } | ConvertTo-Json -Compress
} else {
    @{ network = $NetName; hasPassword = $false; password = '(could not determine)' } | ConvertTo-Json -Compress
}
`
            : `
$profileLines = netsh wlan show profiles
$profiles = @()
foreach ($line in $profileLines) {
    if ($line -match ':\\s*(.+)$' -and $line -notmatch '^-') {
        $name = $Matches[1].Trim()
        if ($name -and $name.Length -gt 0 -and $name -ne '') {
            $profiles += $name
        }
    }
}
# Filter to actual profile names (skip header lines)
$profiles = $profiles | Where-Object { $_.Length -gt 1 -and $_ -notmatch 'Version|WirelessLAN|Wireless LAN' }

$results = @()
foreach ($p in $profiles) {
    $detail = netsh wlan show profile name="$p" key=clear 2>&1
    $key = ($detail | Where-Object { $_ -match 'Key Content|Contenu de la|Schlüsselinhalt|Contenido de la clave|Clé de sécurité' }) -replace '.*:\\s*', ''
    if (-not $key) { $key = $null }
    $results += @{ network = $p; hasPassword = [bool]$key; password = if ($key) { '***REDACTED***' } else { '(open/enterprise)' } }
}
if ($results.Count -eq 0) {
    '[]'
} elseif ($results.Count -eq 1) {
    '[' + ($results[0] | ConvertTo-Json -Compress) + ']'
} else {
    $results | ConvertTo-Json -Compress
}
`;
        try {
            const timeout = networkName ? 15000 : 30000;
            return await runPowerShell(psScript, networkName ? [networkName] : [], timeout);
        } catch (e) {
            return JSON.stringify({ error: e?.message ?? String(e) });
        }
    },
};
