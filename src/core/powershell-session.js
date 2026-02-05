const { spawn } = require("child_process");
const logger = require('./logger');

class PowerShellSession {
    constructor() {
        this.process = null;
        this.queue = [];
        this.working = false;

        this.endMarker = "VENESA_PS_END_" + Math.random().toString(36).slice(2);
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.currentTask = null;

        this.init();
    }

    init() {
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

                setTimeout(() => this.init(), 1000);
            });

            this.process.on('error', (err) => {
                logger.error(`PowerShell process error: ${err.message}`);

                if (!this.process) {
                    setTimeout(() => this.init(), 1000);
                }
            });




        } catch (error) {
            logger.error(`Failed to initialize PowerShell session: ${error.message}`);
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

    execute(command, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {

            this.queue.push({
                command,
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

        const { command, timeout } = this.currentTask;


        const taskAtStart = this.currentTask;
        const timeoutId = setTimeout(() => {
            if (this.currentTask === taskAtStart) {

                logger.warn("PowerShell command timed out. Restarting shell.");
                this.currentTask.reject(new Error(`Command timed out after ${timeout}ms`));
                this.process.kill();

            }
        }, timeout);



        const originalResolve = this.currentTask.resolve;
        const originalReject = this.currentTask.reject;

        this.currentTask.resolve = (val) => { clearTimeout(timeoutId); originalResolve(val); };
        this.currentTask.reject = (err) => { clearTimeout(timeoutId); originalReject(err); };

        try {








            const wrappedCommand = `
        $ErrorActionPreference = 'Continue'
        try {
            ${command}
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
}

module.exports = new PowerShellSession();
