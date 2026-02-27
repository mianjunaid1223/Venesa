/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: set-reminder
 *  Set a timed reminder notification.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { logger } = require('./_shared');

const activeReminders = new Map();
let nextReminderId = 1;

module.exports = {
    schema: z.object({
        message: z.string().optional().describe('The reminder message'),
        text: z.string().optional().describe('The reminder message (alias)'),
        delay: z.preprocess((val) => Number(val), z.number()).optional(),
        time: z.string().optional(),
    }),
    name: 'setReminder',
    description: 'Set a timed reminder notification',
    tags: ['reminder', 'timer', 'notification'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    handler(params) {
        const message = params.message || params.text || 'Reminder';
        let delaySec = 5;
        if (params.delay !== undefined) {
            delaySec = parseInt(params.delay, 10);
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

        logger.info(`Reminder scheduled (TimerID: ${reminderId}) for ${delaySec}s (content omitted)`);
        return { success: true, message: `Reminder set in ${delaySec} seconds.`, timerId: reminderId };
    },
    cancel(params) {
        const rawId = params.timerId ?? params.id;
        const id = Number(rawId);
        if (!Number.isFinite(id)) {
            return { success: false, message: 'Invalid or missing reminder id.' };
        }
        if (activeReminders.has(id)) {
            clearTimeout(activeReminders.get(id));
            activeReminders.delete(id);
            return { success: true, message: `Reminder ${id} cancelled.` };
        }
        return { success: false, message: `Reminder ${id} not found.` };
    }
};
