const { z } = require('zod');
const { runPowerShell } = require('./_shared');

const SAFE_PS_PATTERNS = [
    /^\(?\s*Get-CimInstance\b/i,
    /^\(?\s*Get-Process\b/i,
    /^\(?\s*Get-Service\b/i,
    /^\(?\s*Get-ChildItem\b/i,
    /^\(?\s*Get-Content\b/i,
    /^\(?\s*Get-Date\b/i,
    /^\(?\s*Get-Location\b/i,
    /^\(?\s*Get-NetIPAddress\b/i,
    /^\$env:/i,
    /^\[math\]::/i,
];

const DANGEROUS_PS_PATTERNS = [
    /-enc\b/i, /-encodedcommand\b/i, /-e\s/i,
    /webclient\b/i, /net\./i, /downloadstring\b/i, /downloadfile\b/i,
    /invoke-webrequest\b/i, /iwr\s/i, /curl\b/i, /wget\b/i,
    /invoke-expression\b/i, /iex\s/i, /invoke-command\b/i, /icm\s/i,
    /scriptblock/i, /\[scriptblock\]/i, /::create/i,
    /reflection/i, /\[type\]/i, /gettype/i, /assembly/i,
    /&\s*\$/i, /&\s*\(/i, /&\s*['"]/, /\+\s*['"].*['"]\s*\+/i,
    /remove-/i, /delete-/i, /set-/i, /new-/i, /stop-/i, /start-/i,
    /clear-/i, /install-/i, /uninstall-/i, /update-/i, /add-/i,
    /format-/i, /mount-/i, /dismount-/i, /restart-/i, /shutdown/i,
    /rm\s/i, /del\s/i, /-file\s/i, /-command\s/i,
    /powershell\b/i, /pwsh\b/i, /cmd\.exe/i, /cmd\s/i,
    /out-file\b/i, /copy-item\b/i, /move-item\b/i, /rename-item\b/i,
    /export-csv\b/i, /export-clixml\b/i, /tee-object\b/i,
    />>/, /(?<!-)>/,
    /`/,
    /^\s*\.\s+/,
    /;\s*\.\s+/,
    /\$\([^)]*\$[^)]*\)/,
];

module.exports = {
    schema: z.object({ script: z.string().describe('The PowerShell script to execute') }),
    name: 'runPowerShell',
    description: 'Run a safe read-only PowerShell command',
    tags: ['system', 'powershell', 'advanced'],

    returnType: 'data',
    marker: 'silently',
    ui: null,

    examples: [

        { user: 'check my IP address', action: '[action: runPowerShell, script: (Get-NetIPAddress -AddressFamily IPv4).IPAddress]' },

    ],


    async handler(params) {
        const script = params.script;
        if (!script || typeof script !== 'string') {
            return JSON.stringify({ error: 'No script provided' });
        }

        const trimmed = script.trim();

        for (const pattern of DANGEROUS_PS_PATTERNS) {
            if (pattern.test(trimmed)) {
                return JSON.stringify({ error: 'Command contains blocked pattern' });
            }
        }

        const isAllowed = SAFE_PS_PATTERNS.some(p => p.test(trimmed));
        if (!isAllowed) {
            return JSON.stringify({ error: 'Command not in allowlist' });
        }

        try {
            return await runPowerShell(trimmed, [], 10000);
        } catch (e) {
            return JSON.stringify({ process_error: e instanceof Error ? e.message : String(e) });
        }
    },
};
