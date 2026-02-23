/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-system-info
 *  Get CPU, RAM, battery, and uptime info.
 * ═══════════════════════════════════════════════════════════════
 */

const { runPowerShell } = require('./_shared');

module.exports = {
    name: 'getSystemInfo',
    description: 'Get CPU, RAM, battery, and uptime info',
    tags: ['system', 'info', 'monitor'],
    permission: 'safe',
    marker: 'silently',
    ui: 'key-value',

    async handler() {
        const psScript = `
$os = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime,Caption
$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Property PercentProcessorTime | Where-Object { $_.Name -eq '_Total' }
$battery = Get-CimInstance Win32_Battery -Property EstimatedChargeRemaining -ErrorAction SilentlyContinue
@{
    cpu = "$($cpu.PercentProcessorTime)%"
    ramUsed = [math]::round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)
    ramTotal = [math]::round($os.TotalVisibleMemorySize / 1MB, 1)
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
