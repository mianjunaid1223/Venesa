/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: list-processes
 *  List top 10 CPU-heavy processes.
 * ═══════════════════════════════════════════════════════════════
 */

const { runPowerShell } = require('./_shared');

module.exports = {
    name: 'listProcesses',
    description: 'List top 10 CPU-heavy processes',
    tags: ['system', 'processes'],
    permission: 'safe',
    marker: 'silently',
    ui: 'table',

    async handler() {
        try {
            return await runPowerShell(
                'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 -Property Id, ProcessName, CPU, WorkingSet | ConvertTo-Json -Compress'
            );
        } catch (e) {
            console.error('list-processes skill error:', e);
            return '[]';
        }
    },
};
