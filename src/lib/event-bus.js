/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Event Bus
 *  Pub-sub event emitter — decouples domains without IPC.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: (none)
 *  USED BY:    brain/*, platform/*
 * ═══════════════════════════════════════════════════════════════
 */

class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    on(event, handler) {
        if (typeof handler !== 'function') {
            throw new Error('Event handler must be a function');
        }
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(handler);
        return this;
    }

    off(event, handler) {
        if (!this._listeners.has(event)) return this;
        const handlers = this._listeners.get(event);
        const index = handlers.indexOf(handler);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
        if (handlers.length === 0) {
            this._listeners.delete(event);
        }
        return this;
    }

    emit(event, data) {
        if (!this._listeners.has(event)) return;
        const snapshot = [...this._listeners.get(event)];
        for (const handler of snapshot) {
            try {
                handler(data);
            } catch (e) {
                console.error(`[EventBus] Error in handler for '${event}':`, e);
            }
        }
    }

    async emitAsync(event, data) {
        if (!this._listeners.has(event)) return;
        const snapshot = [...this._listeners.get(event)];
        for (const handler of snapshot) {
            try {
                await handler(data);
            } catch (e) {
                console.error(`[EventBus] Error in async handler for '${event}':`, e);
            }
        }
    }

    removeAllListeners(event) {
        if (event) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
        return this;
    }
}

const globalBus = new EventBus();

module.exports = { EventBus, globalBus };
