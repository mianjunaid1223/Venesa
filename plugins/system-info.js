/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-system-info
 *  Get CPU, RAM, battery, and uptime info.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const powershell = require('../src/lib/powershell');
const runPowerShell = (script, args, timeout = 30000) => powershell.execute(script, args || [], timeout);

module.exports = {
    schema: z.object({}),
    name: 'getSystemInfo',
    description: 'Get CPU, RAM, battery, and uptime info',
    tags: ['system', 'info', 'monitor'],

    returnType: 'data',
    marker: 'silently',
    ui: 'key-value',

    examples: [

        { user: 'how is my PC doing', action: '[action: getSystemInfo]' },

        { user: 'check battery level', action: '[action: getSystemInfo]' },

    ],


    async handler() {
        const psScript = `
$os = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime,Caption
$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -ErrorAction SilentlyContinue -Property PercentProcessorTime | Where-Object { $_.Name -eq '_Total' }
$battery = Get-CimInstance Win32_Battery -Property EstimatedChargeRemaining -ErrorAction SilentlyContinue
@{
    cpu = if ($cpu) { "$($cpu.PercentProcessorTime)%" } else { "N/A" }
    ramUsed = "$([math]::round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)) GB"
    ramTotal = "$([math]::round($os.TotalVisibleMemorySize / 1MB, 1)) GB"
    battery = if ($battery) { "$($battery.EstimatedChargeRemaining)%" } else { "N/A" }
    uptime = "$([math]::round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)) hours"
} | ConvertTo-Json -Compress
`;
        try {
            return await runPowerShell(psScript);
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    },
};
