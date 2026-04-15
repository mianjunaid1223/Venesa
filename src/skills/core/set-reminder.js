const { z } = require('zod');
const { logger } = require('./_shared');
const path = require('path');

const activeReminders = new Map();
let nextReminderId = 1;

function getAssetsPath() {
    try {
        const paths = require('../../lib/paths');
        return paths.getAssetsPath();
    } catch {
        return path.join(__dirname, '../../../assets');
    }
}

module.exports = {
    schema: z.object({
        message: z.string().optional().describe('The reminder message'),
        text: z.string().optional().describe('The reminder message (alias for message)'),
        delay: z.preprocess((val) => Number(val), z.number()).optional(),
        minutes: z.preprocess((val) => Number(val), z.number()).optional().describe('Delay in minutes before reminder fires'),
        time: z.string().optional().describe('Specific time to fire the reminder (HH:MM format)'),
    }),
    name: 'setReminder',
    description: 'Set a timed reminder notification with sound',
    tags: ['reminder', 'timer', 'notification'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'remind me in 5 minutes to check the oven', action: '[action: setReminder, message: check the oven, minutes: 5]' },

        { user: 'set a timer for 30 minutes', action: '[action: setReminder, message: timer done, minutes: 30]' },

    ],


    async handler(params) {
        let message = params.message || params.text || 'Reminder';
        let delaySec = 5;
        if (params.delay !== undefined) {
            delaySec = parseInt(params.delay, 10);
        } else if (params.minutes !== undefined) {
            delaySec = parseInt(params.minutes, 10) * 60;
        } else if (params.time !== undefined) {
            if (params.time.includes(':')) {
                const now = new Date();
                const [h, m] = params.time.split(':');
                const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(h, 10), parseInt(m, 10), 0);
                if (target < now) target.setDate(target.getDate() + 1);
                delaySec = Math.round((target.getTime() - now.getTime()) / 1000);
            } else {
                delaySec = parseInt(params.time, 10);
            }
        }

        if (isNaN(delaySec) || delaySec < 1) {
            return { success: false, message: 'Invalid delay.' };
        }

        const MAX_TIMEOUT = 2147483647;
        const delayMs = delaySec * 1000;
        if (delayMs > MAX_TIMEOUT) {
            logger.warn(`[setReminder] Requested delay ${delaySec}s exceeds maximum safe setTimeout limit`);
            return { success: false, message: `Delay too large (${delaySec}s). Maximum supported delay is ${Math.floor(MAX_TIMEOUT / 1000)} seconds.` };
        }

        const reminderId = nextReminderId++;
        const timerId = setTimeout(() => {
            try {
                const { Notification, BrowserWindow } = require('electron');

                // Play reminder sound
                try {
                    const allWindows = BrowserWindow.getAllWindows();
                    const visibleWindow = allWindows.find(w => !w.isDestroyed() && w.isVisible())
                        || allWindows.find(w => !w.isDestroyed());
                    if (visibleWindow) {
                        visibleWindow.webContents.executeJavaScript(
                            `(function() { try { new Audio('venesa-asset://cue-done.wav').play(); } catch(e) {} })()`
                        ).catch(() => { });
                    }
                } catch (soundErr) {
                    logger.warn(`[setReminder] Sound playback failed: ${soundErr.message}`);
                }                // Show native OS notification with the reminder message
                const notification = new Notification({
                    title: 'Venesa Reminder',
                    body: message,
                    silent: false,
                    urgency: 'critical',
                });
                notification.show();

                // Also notify the main window so the UI can show it
                try {
                    const mainWindows = BrowserWindow.getAllWindows();
                    for (const win of mainWindows) {
                        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                            win.webContents.send('reminder-fired', { message, reminderId });
                        }
                    }
                } catch (e) {
                    logger.warn(`[setReminder] Failed to notify main window: ${e.message}`);
                }

                logger.info(`[setReminder] Reminder ${reminderId} fired: "${message}"`);
            } catch (e) {
                logger.error(`Reminder notification failed: ${e.message}`);
            } finally {
                activeReminders.delete(reminderId);
            }
        }, delaySec * 1000);

        activeReminders.set(reminderId, { timerId, message, fireAt: Date.now() + delaySec * 1000 });

        const displayDelay = delaySec >= 60
            ? `${Math.round(delaySec / 60)} minute${Math.round(delaySec / 60) !== 1 ? 's' : ''}`
            : `${delaySec} second${delaySec !== 1 ? 's' : ''}`;

        logger.info(`Reminder scheduled (ID: ${reminderId}) for ${delaySec}s: "${message}"`);
        return { success: true, message: `Reminder set for ${displayDelay}.`, timerId: reminderId };
    },
    cancel(params) {
        const rawId = params.timerId ?? params.id;
        const id = Number(rawId);
        if (!Number.isFinite(id)) {
            return { success: false, message: 'Invalid or missing reminder id.' };
        }
        if (activeReminders.has(id)) {
            clearTimeout(activeReminders.get(id).timerId);
            activeReminders.delete(id);
            return { success: true, message: `Reminder ${id} cancelled.` };
        }
        return { success: false, message: `Reminder ${id} not found.` };
    }
};

