// PowerShell — persistent PowerShell session with queued command execution.
const { spawn } = require("child_process");
const logger = require('./logger');

class PowerShellSession {
    constructor() {
        this.process = null;
        this.queue = [];
        this.working = false;
        this.closed = false;

        this.endMarker = "VENESA_PS_END_" + Math.random().toString(36).slice(2);
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.currentTask = null;

        this.init();
    }

    init() {
        if (this.closed) return;
        try {
            const cleanEnv = { ...process.env };
            delete cleanEnv.VIRTUAL_ENV;
            delete cleanEnv.PYTHONHOME;

            const path = require('path');
            const fs = require('fs');
            const systemRoot = process.env.SystemRoot || 'C:\\Windows';
            const psSystemPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            const psPath = fs.existsSync(psSystemPath) ? psSystemPath : "powershell";

            this.process = spawn(psPath, [
                "-NoLogo",
                "-NoExit",
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-Command",
                "-"
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
                env: cleanEnv
            });

            this.process.stdout.setEncoding('utf8');
            this.process.stderr.setEncoding('utf8');

            this.process.stdout.on('data', (data) => {
                this.outputBuffer += data;
                this.checkOutput();
            });

            this.process.stderr.on('data', (data) => {
                this.errorBuffer += data;
            });

            this.process.on('close', (code) => {
                logger.warn(`PowerShell process closed with code ${code}. Restarting session...`);
                this.process = null;
                this.working = false;

                if (this.currentTask) {
                    this.currentTask.reject(new Error("PowerShell process terminated unexpectedly"));
                    this.currentTask = null;
                }
                for (const t of this.queue) {
                    t.reject(new Error("PowerShell process terminated unexpectedly"));
                }
                this.queue = [];

                if (!this.closed) {
                    setTimeout(() => this.init(), 1000);
                }
            });

            this.process.on('error', (err) => {
                logger.error(`PowerShell process error: ${err.message}`);
            });

        } catch (error) {
            logger.error(`Failed to initialize PowerShell session: ${error.message}`);
            if (!this.closed) {
                setTimeout(() => this.init(), 1000);
            }
        }
    }

    checkOutput() {
        if (!this.currentTask) return;

        if (this.outputBuffer.includes(this.endMarker)) {
            const parts = this.outputBuffer.split(this.endMarker);
            const result = parts[0];
            this.outputBuffer = parts.slice(1).join(this.endMarker);

            const task = this.currentTask;
            this.currentTask = null;
            this.working = false;

            if (this.errorBuffer && this.errorBuffer.trim().length > 0) {
                logger.warn(`PowerShell stderr: ${this.errorBuffer}`);
            }

            task.resolve(result.trim());
            this.errorBuffer = "";
            this.processQueue();
        }
    }

    execute(command, args = [], timeoutMs = 30000) {
        if (typeof args === 'number') {
            timeoutMs = args;
            args = [];
        }
        return new Promise((resolve, reject) => {
            this.queue.push({
                command,
                args,
                resolve,
                reject,
                timeout: timeoutMs
            });
            this.processQueue();
        });
    }

    processQueue() {
        if (this.working || this.queue.length === 0 || !this.process) return;

        this.working = true;
        this.currentTask = this.queue.shift();
        this.outputBuffer = "";
        this.errorBuffer = "";

        const { command, args, timeout } = this.currentTask;

        const taskAtStart = this.currentTask;
        const timeoutId = setTimeout(() => {
            if (this.currentTask === taskAtStart) {
                logger.warn("PowerShell command timed out. Restarting shell.");
                const timedOutTask = this.currentTask;
                this.currentTask = null;
                timedOutTask.reject(new Error(`Command timed out after ${timeout}ms`));
                if (this.process) this.process.kill();
            }
        }, timeout);

        const originalResolve = this.currentTask.resolve;
        const originalReject = this.currentTask.reject;

        this.currentTask.resolve = (val) => { clearTimeout(timeoutId); originalResolve(val); };
        this.currentTask.reject = (err) => { clearTimeout(timeoutId); originalReject(err); };

        try {
            let argString = '';
            if (args && args.length > 0) {
                argString = " " + args.map(a =>
                    `([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(String(a)).toString('base64')}')))`
                ).join(' ');
            }

            const wrappedCommand = `
        $ErrorActionPreference = 'Continue'
        try {
            & {
${command}
            }${argString}
        } catch {
            Write-Error $_
        }
        Write-Output "${this.endMarker}"
        `;

            this.process.stdin.write(wrappedCommand + "\n");
        } catch (e) {
            this.currentTask.reject(e);
            this.working = false;
            this.processQueue();
        }
    }

    close() {
        this.closed = true;
        if (this.process) {
            this.process.removeAllListeners();
            this.process.kill('SIGINT');
            setTimeout(() => {
                if (this.process) {
                    try { this.process.kill('SIGKILL'); } catch (e) { }
                }
                this.process = null;
            }, 500);
        }
        if (this.currentTask) {
            this.currentTask.reject(new Error("Session closed"));
            this.currentTask = null;
        }
        this.queue.forEach(t => t.reject(new Error("Session closed")));
        this.queue = [];
        this.working = false;
    }
}

module.exports = new PowerShellSession();
