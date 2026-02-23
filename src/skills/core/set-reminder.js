/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: set-reminder
 *  Set a timed reminder notification.
 * ═══════════════════════════════════════════════════════════════
 */

const { logger } = require('./_shared');

const activeReminders = new Map();
let nextReminderId = 1;

module.exports = {
    name: 'setReminder',
    description: 'Set a timed reminder notification',
    tags: ['reminder', 'timer', 'notification'],
    permission: 'normal',
    marker: 'announce',
    ui: null,

    handler(params) {
        const message = params.message || params.text || 'Reminder';
        const delayStr = params.delay || params.time || '5';
        const delaySec = parseInt(delayStr, 10);

        if (isNaN(delaySec) || delaySec < 1 || delaySec > 3600) {
            return { success: false, message: 'Invalid delay. Use 1-3600 seconds.' };
        }

        const reminderId = nextReminderId++;
        const timerId = setTimeout(() => {
            try {
                const { Notification } = require('electron');
                new Notification({ title: 'Venesa Reminder', body: message }).show();
            } catch (e) {
                logger.error(`Reminder notification failed: ${e.message}`);
            } finally {
                activeReminders.delete(reminderId);
            }
        }, delaySec * 1000);

        activeReminders.set(reminderId, timerId);

        logger.info(`Reminder scheduled (TimerID: ${reminderId}) for ${delaySec}s: ${message}`);
        return { success: true, message: `Reminder set: "${message}" in ${delaySec} seconds.`, timerId: reminderId };
    },
    cancel(params) {
        const rawId = params.timerId ?? params.id;
        const id = Number(rawId);
        if (!Number.isFinite(id)) {
            logger.warn(`[setReminder] cancel called with invalid id: ${JSON.stringify(rawId)}`);
            return { success: false, message: 'Invalid or missing reminder id.' };
        }
        if (activeReminders.has(id)) {
            clearTimeout(activeReminders.get(id));
            activeReminders.delete(id);
            logger.info(`Reminder (TimerID: ${id}) cancelled.`);
            return { success: true, message: `Reminder ${id} cancelled.` };
        }
        return { success: false, message: `Reminder ${id} not found.` };
    }
};
