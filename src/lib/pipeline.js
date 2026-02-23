/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Pipeline
 *  Express-style middleware runner for composable async flows.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: (none)
 *  USED BY:    brain/processor
 * ═══════════════════════════════════════════════════════════════
 */

class Pipeline {
    constructor() {
        this._middleware = [];
        this._errorHandler = null;
    }

    use(fn) {
        if (typeof fn !== 'function') {
            throw new Error('Pipeline middleware must be a function');
        }
        this._middleware.push(fn);
        return this;
    }

    onError(handler) {
        if (typeof handler !== 'function') {
            throw new TypeError('onError handler must be a function');
        }
        this._errorHandler = handler;
        return this;
    }

    async run(context) {
        let index = 0;
        const middleware = this._middleware;

        const next = async () => {
            if (index >= middleware.length) return;
            const fn = middleware[index++];
            await fn(context, next);
        };

        try {
            await next();
        } catch (error) {
            if (this._errorHandler) {
                await this._errorHandler(error, context);
            } else {
                throw error;
            }
        }

        return context;
    }
}

module.exports = { Pipeline };
