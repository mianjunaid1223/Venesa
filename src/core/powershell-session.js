const { spawn } = require("child_process");
const logger = require('./logger');

class PowerShellSession {
    constructor() {
        this.process = null;
        this.queue = [];
        this.working = false;
        // Use a unique marker that is unlikely to appear in normal output
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
                // Collect errors but don't fail immediately, some PS commands write to stderr for warnings
                this.errorBuffer += data;
            });

            this.process.on('close', (code) => {
                logger.warn(`PowerShell process closed with code ${code}. Restarting session...`);
                this.process = null;
                this.working = false;
                // Verify if we had a pending task
                if (this.currentTask) {
                    this.currentTask.reject(new Error("PowerShell process terminated unexpectedly"));
                    this.currentTask = null;
                }
                // Restart after a small delay to prevent loops
                setTimeout(() => this.init(), 1000);
            });

            this.process.on('error', (err) => {
                logger.error(`PowerShell process error: ${err.message}`);
                // Retry logic consistent with close handler
                if (!this.process) {
                    setTimeout(() => this.init(), 1000);
                }
            });

            // Initial robust check to ensure shell is ready? 
            // Not strictly necessary as the first command will just wait in the pipe

        } catch (error) {
            logger.error(`Failed to initialize PowerShell session: ${error.message}`);
        }
    }

    checkOutput() {
        if (!this.currentTask) return;

        if (this.outputBuffer.includes(this.endMarker)) {
            const parts = this.outputBuffer.split(this.endMarker);
            // The result is everything before the marker.
            // Note: If multiple markers appear (unlikely), split takes the first one.
            // We assume the buffer contains [Result][Marker][NextResult...]

            const result = parts[0];

            // Update buffer to contain any remainder (handling potential chunk boundary issues)
            // If parts has more than 2 elements, it means we somehow got two markers?
            // Just take the rest.
            this.outputBuffer = parts.slice(1).join(this.endMarker);

            const task = this.currentTask;
            this.currentTask = null;
            this.working = false;

            // Decide if error or success
            // We resolve with the text output. The caller parses JSON if needed.
            // Use errorBuffer only if result is empty? 
            // PowerShell often writes to stderr but still succeeds.
            // We return both if both exist? Or just stdout.
            // Usually users want stdout. If stdout is empty and stderr has content, strictly it might be error.

            // Return an object with stdout and stderr, or handle stderr if helpful
            // For backward compatibility, we'll log stderr if present and resolve with stdout
            if (this.errorBuffer && this.errorBuffer.trim().length > 0) {
                logger.warn(`PowerShell stderr: ${this.errorBuffer}`);
                // Optionally append stderr to result if critical, but for now we trust stdout
                // result += `\n[Stderr]: ${this.errorBuffer}`; 
            }

            task.resolve(result.trim());

            // Clean error buffer for next run
            this.errorBuffer = "";

            this.processQueue();
        }
    }

    execute(command, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            // Add to queue
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

        // Set a safety timeout for this specific task
        const taskAtStart = this.currentTask;
        const timeoutId = setTimeout(() => {
            if (this.currentTask === taskAtStart) { // Check if still same task
                // Kill and restart
                logger.warn("PowerShell command timed out. Restarting shell.");
                this.currentTask.reject(new Error(`Command timed out after ${timeout}ms`));
                this.process.kill();
                // process.on('close') will handle restart and state cleanup
            }
        }, timeout);

        // Attach timeout ID to task so we can clear it if needed (though we rely on closure)
        // Wrap resolve/reject to clear timeout
        const originalResolve = this.currentTask.resolve;
        const originalReject = this.currentTask.reject;

        this.currentTask.resolve = (val) => { clearTimeout(timeoutId); originalResolve(val); };
        this.currentTask.reject = (err) => { clearTimeout(timeoutId); originalReject(err); };

        try {
            // Enforce UTF8 encoding for input/output to avoid encoding, 
            // Although we set node stream encoding, explicit PS encoding helps 
            // But in persistent mode, we set Console encoding once likely better.
            // For now just sending command.

            // Ensure command catches exceptions to avoid crashing the session?
            // We wrap in try/catch in PS?

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
