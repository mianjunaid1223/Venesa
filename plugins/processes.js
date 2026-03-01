/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: list-processes
 *  List top 10 CPU-heavy processes.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const powershell = require('../src/lib/powershell');
const runPowerShell = (script, args, timeout = 30000) => powershell.execute(script, args || [], timeout);

module.exports = {
    schema: z.object({}),
    name: 'listProcesses',
    description: 'List top 10 CPU-heavy processes',
    tags: ['system', 'processes'],

    returnType: 'data',
    marker: 'silently',
    ui: 'table',

    examples: [

        { user: 'what processes are using the most CPU', action: '[action: listProcesses]' },

    ],


    async handler() {
        try {
            return await runPowerShell(
                'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 -Property Id, ProcessName, CPU, WorkingSet | ConvertTo-Json -Compress'
            );
        } catch (e) {
            throw e;
        }
    },
};
